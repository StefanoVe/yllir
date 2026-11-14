// The framework update of the master screen: the status the screen shows (checked at most once an
// hour), the snooze of the notice, and the one update that runs at a time: plugin update, then a
// restart of the screen on the new framework. Owner: update engineer.
import fs from 'node:fs';
import path from 'node:path';
import type { OpenSession, Turn, UpdateStatus } from '../../../shared/src/types.js';
import { findClaudeCode } from '../agent/claude-provider.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import { readFrameworkVersion } from '../campaign.js';
import { CockpitStore } from '../cockpit/store.js';
import type { Ctx } from '../context.js';
import { callLog } from '../live/framework.js';
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
  /** The sessions the update would close: the open live session and the chat conversations with a turn queued or running. */
  openSessions(): Promise<OpenSession[]>;
  /** Cancels every chat and cockpit turn and ends the live session, waiting for them to end. Never throws. */
  closeSessions(): Promise<void>;
  restart: SpawnRestart;
  requestShutdown(): void;
  log(msg: string): void;
}

export interface ApplyOptions {
  /** True when the master confirmed that the open sessions are closed. */
  confirmClose?: boolean;
}

/**
 * ok: false with `sessions` means the update needs the master's confirmation first (nothing was
 * closed or started); the caller answers it with those sessions.
 */
export type ApplyResult =
  | { ok: true; done: Promise<void> }
  | { ok: false; error: string; sessions?: OpenSession[] };

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
   * Starts the update when it is allowed. Open sessions are closed first when the master confirmed
   * it; without the confirmation the result carries the sessions and nothing is closed or started.
   * `accept` runs once the work is about to start, so the caller can answer 202 before the server
   * may shut down.
   */
  async apply(accept: () => void = () => {}, options: ApplyOptions = {}): Promise<ApplyResult> {
    const current = await this.compose();
    if (this.phase === 'updating' || this.phase === 'restarting') {
      return { ok: false, error: this.texts().alreadyRunning };
    }
    if (current.state === 'offline') return { ok: false, error: this.texts().offline };
    if (current.state === 'failed') return { ok: false, error: this.texts().checkFirst };
    if (current.state !== 'available') return { ok: false, error: this.texts().noUpdate };
    const sessions = await this.safeOpenSessions();
    if (sessions.length > 0 && options.confirmClose !== true) {
      return { ok: false, error: this.texts().confirmClose, sessions };
    }
    // No await between this re-check and the next line: two requests cannot both start an update.
    if (this.isBusy()) {
      return { ok: false, error: this.texts().alreadyRunning };
    }
    this.phase = 'updating';
    accept();
    return { ok: true, done: this.run(sessions.length > 0) };
  }

  /** True while an update runs or restarts the screen. */
  private isBusy(): boolean {
    return this.phase === 'updating' || this.phase === 'restarting';
  }

  private async safeOpenSessions(): Promise<OpenSession[]> {
    try {
      return await this.deps.openSessions();
    } catch (err) {
      this.deps.log(`open sessions failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
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
    const idle: UpdateStatus = { state: 'idle', news: null, snoozed, canApply: false, blockedReason: null, sessions: [] };
    if (this.phase === 'updating' || this.phase === 'restarting') return { ...idle, state: this.phase };
    if (this.phase === 'failed') return { ...idle, state: 'failed' };
    const snap = this.snapshot;
    if (snap === null) return idle;
    if (snap.published === null) {
      return { ...idle, state: 'offline', snoozed, blockedReason: 'offline' };
    }
    const installed = await this.deps.installedVersion();
    if (compareVersions(snap.published, installed) !== 1) return idle;
    return {
      state: 'available',
      news: snap.news,
      snoozed,
      canApply: true,
      blockedReason: null,
      sessions: await this.safeOpenSessions(),
    };
  }

  /** The update itself. Never rejects: every failure ends in the 'failed' phase. */
  private async run(closed: boolean): Promise<void> {
    try {
      if (closed) await this.deps.closeSessions();
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

/** Conversations that have a turn queued or running, by the turn events on the bus. */
function trackOpenChatTurns(ctx: Ctx): () => string[] {
  const openByTurn = new Map<string, string>();
  ctx.onTurn((turn: Turn) => {
    const open = turn.state === 'queued' || turn.state === 'running';
    if (open && turn.conversationId) openByTurn.set(turn.id, turn.conversationId);
    else openByTurn.delete(turn.id);
  });
  return () => [...new Set(openByTurn.values())];
}

/** The title of the cockpit session attached to the live session, or null when there is none. */
async function cockpitTitleOf(root: string, liveId: string): Promise<string | null> {
  const sessionsRoot = path.join(root, '.campaign', 'state', 'live', 'cockpit');
  if (!fs.existsSync(sessionsRoot)) return null;
  const store = new CockpitStore(root, { sessionsRoot });
  for (const summary of await store.list()) {
    const session = await store.get(summary.id);
    if (session.liveSessionId === liveId) return session.title;
  }
  return null;
}

export function createUpdateService(ctx: Ctx, overrides: Partial<UpdateDeps> = {}): UpdateService {
  const root = ctx.campaignRoot;
  const openChatIds = trackOpenChatTurns(ctx);
  const chatTitle = (id: string): string => {
    const found = ctx.chat?.store.conversations().find((c) => c.id === id);
    return found && found.title !== '' ? found.title : UPDATE_TEXTS[campaignLanguage(root)].chatTitle;
  };
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
    openSessions: async () => {
      const sessions: OpenSession[] = [];
      const liveId = await readActiveId(root);
      if (liveId !== null) {
        const title = await cockpitTitleOf(root, liveId).catch(() => null);
        sessions.push({ kind: 'live', id: liveId, title: title || liveId });
      }
      for (const id of openChatIds()) sessions.push({ kind: 'chat', id, title: chatTitle(id) });
      return sessions;
    },
    closeSessions: async () => {
      try {
        const ids = openChatIds();
        const runner = ctx.chat?.runner;
        if (runner) {
          for (const id of ids) runner.cancelConversation(id);
          for (const id of ids) await runner.settleConversation(id);
        }
      } catch (err) {
        ctx.log(`closing chat turns failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        await ctx.cancelCockpitTurns?.();
      } catch (err) {
        ctx.log(`cancelling cockpit turns failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        const ended = await callLog(ctx, (lib) => lib.endSession(root));
        if (!ended.ok) ctx.log(`ending the live session failed: ${ended.error.message}`);
      } catch (err) {
        ctx.log(`ending the live session failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    restart: spawnRestart,
    requestShutdown: () => ctx.requestShutdown(),
    log: (msg) => ctx.log(msg),
    ...overrides,
  });
}
