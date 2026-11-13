// The framework update of the master screen: the status the screen shows (checked at most once an
// hour), the snooze of the notice, and the one update that runs at a time: plugin update, then a
// restart of the screen on the new framework. Owner: update engineer.
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateStatus } from '../../../shared/src/types.js';
import { findClaudeCode } from '../agent/claude-provider.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import { readFrameworkVersion } from '../campaign.js';
import type { Ctx } from '../context.js';
import { readActiveId } from '../live/snapshot.js';
import { execText, installPathOf, LIST_TIMEOUT_MS, PLUGIN_ID, UPDATE_TIMEOUT_MS, type ExecText } from './claude.js';
import { fetchNews, fetchPublishedVersion, fetchText, type FetchText } from './source.js';
import { isSnoozed, localDate, readNotice, writeSnooze } from './notice.js';
import { spawnRestart, type SpawnRestart } from './restart.js';
import { UPDATE_TEXTS } from './text.js';
import { compareVersions } from './version.js';

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

type Phase = 'updating' | 'restarting' | 'failed';

interface Snapshot {
  checkedAt: number;
  /** The newest published version, or null when the source could not be read. */
  published: string | null;
  news: string | null;
}

export interface UpdateDeps {
  campaignRoot: string;
  pid: number;
  now(): number;
  today(): string;
  fetchText: FetchText;
  exec: ExecText;
  findClaude(): string | null;
  installedVersion(): Promise<string>;
  language(): Lang;
  liveOpen(): Promise<boolean>;
  chatTurnOpen(): boolean;
  restart: SpawnRestart;
  requestShutdown(): void;
  log(msg: string): void;
}

export type ApplyResult = { ok: true; done: Promise<void> } | { ok: false; error: string };

export class UpdateService {
  private snapshot: Snapshot | null = null;
  private checking: Promise<void> | null = null;
  private phase: Phase | null = null;

  constructor(private readonly deps: UpdateDeps) {}

  /** The current status. When the last check is over an hour old, a check starts in the background. */
  async status(): Promise<UpdateStatus> {
    if (this.snapshot === null || this.deps.now() - this.snapshot.checkedAt >= CHECK_INTERVAL_MS) {
      void this.refresh(false);
    }
    return this.compose();
  }

  /** Forces a fresh check. A failed update is cleared here, so the master can try again. */
  async check(): Promise<UpdateStatus> {
    if (this.phase === 'failed') this.phase = null;
    await this.refresh(true);
    return this.compose();
  }

  /** Snoozes the notice for one day. Only an available update has a notice to snooze. */
  async snooze(): Promise<UpdateStatus> {
    const current = await this.compose();
    const published = this.snapshot?.published ?? null;
    if (current.state === 'available' && published !== null) {
      writeSnooze(this.deps.campaignRoot, { version: published, today: this.deps.today() });
    }
    return this.compose();
  }

  /**
   * Starts the update when it is allowed. `accept` runs after the checks pass and before any work
   * starts, so the caller can answer 202 before the server may shut down.
   */
  async apply(accept: () => void = () => {}): Promise<ApplyResult> {
    const current = await this.compose();
    if (this.phase === 'updating' || this.phase === 'restarting') {
      return { ok: false, error: this.texts().alreadyRunning };
    }
    if (current.state === 'offline') return { ok: false, error: this.texts().offline };
    if (current.state === 'failed') return { ok: false, error: this.texts().checkFirst };
    if (current.state !== 'available') return { ok: false, error: this.texts().noUpdate };
    if (current.blockedReason === 'turn-running') return { ok: false, error: this.texts().turnRunning };
    if (current.blockedReason === 'live-open') return { ok: false, error: this.texts().liveOpen };
    // No await between this check and the next line: two requests cannot both start an update.
    this.phase = 'updating';
    accept();
    return { ok: true, done: this.run() };
  }

  private texts() {
    return UPDATE_TEXTS[this.deps.language()];
  }

  private refresh(force: boolean): Promise<void> {
    if (this.checking !== null) return this.checking;
    if (!force && this.snapshot !== null && this.deps.now() - this.snapshot.checkedAt < CHECK_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.checking = this.fetchSnapshot().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  /** Reads the published version and, when it is newer, its news. Never throws. */
  private async fetchSnapshot(): Promise<void> {
    const checkedAt = this.deps.now();
    let published: string | null = null;
    let news: string | null = null;
    try {
      published = await fetchPublishedVersion(this.deps.fetchText);
    } catch {
      published = null;
    }
    if (published !== null) {
      const installed = await this.deps.installedVersion();
      if (compareVersions(published, installed) === 1) {
        news = await fetchNews(this.deps.fetchText, { installed, published, language: this.deps.language() });
      }
    }
    this.snapshot = { checkedAt, published, news };
  }

  private async compose(): Promise<UpdateStatus> {
    const snoozed = isSnoozed(readNotice(this.deps.campaignRoot), this.deps.today());
    const idle: UpdateStatus = { state: 'idle', news: null, snoozed, canApply: false, blockedReason: null };
    if (this.phase === 'updating' || this.phase === 'restarting') return { ...idle, state: this.phase };
    if (this.phase === 'failed') return { ...idle, state: 'failed' };
    const snap = this.snapshot;
    if (snap === null) return idle;
    if (snap.published === null) {
      return { ...idle, state: 'offline', snoozed, blockedReason: 'offline' };
    }
    const installed = await this.deps.installedVersion();
    if (compareVersions(snap.published, installed) !== 1) return idle;
    const blockedReason = this.deps.chatTurnOpen()
      ? 'turn-running'
      : (await this.deps.liveOpen())
        ? 'live-open'
        : null;
    return {
      state: 'available',
      news: snap.news,
      snoozed,
      canApply: blockedReason === null,
      blockedReason,
    };
  }

  /** The update itself. Never rejects: every failure ends in the 'failed' phase. */
  private async run(): Promise<void> {
    try {
      const claude = this.deps.findClaude();
      if (claude === null) throw new Error('Claude Code was not found');
      await this.deps.exec(claude, ['plugin', 'update', PLUGIN_ID, '--json'], { timeout: UPDATE_TIMEOUT_MS });
      const listing = await this.deps.exec(claude, ['plugin', 'list', '--json'], { timeout: LIST_TIMEOUT_MS });
      const installPath = installPathOf(listing);
      if (installPath === null) throw new Error('the yllir plugin is not listed after the update');
      const launchFile = path.join(installPath, 'scripts', 'launcher', 'launch.mjs');
      if (!fs.existsSync(launchFile)) throw new Error('the updated launcher is missing');
      this.phase = 'restarting';
      this.deps.restart({ pid: this.deps.pid, launchFile, campaignRoot: this.deps.campaignRoot });
      this.deps.requestShutdown();
    } catch (err) {
      this.phase = 'failed';
      this.deps.log(`update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function createUpdateService(ctx: Ctx, overrides: Partial<UpdateDeps> = {}): UpdateService {
  const root = ctx.campaignRoot;
  return new UpdateService({
    campaignRoot: root,
    pid: process.pid,
    now: () => Date.now(),
    today: () => localDate(new Date()),
    fetchText,
    exec: execText,
    findClaude: () => findClaudeCode(),
    installedVersion: () => readFrameworkVersion(ctx.frameworkRoot),
    language: () => campaignLanguage(root),
    liveOpen: async () => (await readActiveId(root)) !== null,
    chatTurnOpen: () => ctx.chatTurnOpen(),
    restart: spawnRestart,
    requestShutdown: () => ctx.requestShutdown(),
    log: (msg) => ctx.log(msg),
    ...overrides,
  });
}
