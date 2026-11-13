// Fakes for the update tests: a campaign with a plugin install folder, and injected network, Claude
// Code and process calls, so that no test touches the network, runs Claude Code or restarts anything.
// Used only by *.test.ts files.
import fs from 'node:fs';
import path from 'node:path';
import { makeCampaign } from '../live/test-support.js';
import type { UpdateDeps } from './service.js';
import { NEWS_DOWNLOAD_PREFIX, NEWS_LIST_URL, PLUGIN_MANIFEST_URL } from './source.js';

export const FAKE_TODAY = '2026-11-14';

export interface FakeWorld {
  published: string;
  installed: string;
  news: string;
  offline: boolean;
  turn: boolean;
  live: boolean;
  installPath: string;
}

export interface FakeUpdate {
  deps: UpdateDeps;
  world: FakeWorld;
  execs: Array<{ file: string; args: string[] }>;
  restarts: Array<{ pid: number; launchFile: string; campaignRoot: string }>;
  clock: { now: number };
  shutdowns: () => number;
  logs: string[];
  order: string[];
  campaignRoot: string;
  installDir: string;
}

/** A campaign folder with a plugin install folder that has its launcher. */
export function updateCampaign(): { root: string; installDir: string } {
  const root = makeCampaign();
  const installDir = path.join(root, 'plugin-install');
  fs.mkdirSync(path.join(installDir, 'scripts', 'launcher'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'scripts', 'launcher', 'launch.mjs'), '// fake launcher\n');
  return { root, installDir };
}

export function newsUrl(name: string): string {
  return `${NEWS_DOWNLOAD_PREFIX}StefanoVe/yllir/main/yllir/news/${name}`;
}

export function fakeUpdate(): FakeUpdate {
  const { root, installDir } = updateCampaign();
  const world: FakeWorld = {
    published: '1.2.0',
    installed: '1.1.0',
    news: 'Something new for the master.',
    offline: false,
    turn: false,
    live: false,
    installPath: installDir,
  };
  const execs: Array<{ file: string; args: string[] }> = [];
  const restarts: Array<{ pid: number; launchFile: string; campaignRoot: string }> = [];
  const logs: string[] = [];
  const order: string[] = [];
  const clock = { now: 1_000_000 };
  let shutdowns = 0;
  const deps: UpdateDeps = {
    campaignRoot: root,
    pid: 4242,
    now: () => clock.now,
    today: () => FAKE_TODAY,
    fetchText: async (url) => {
      if (world.offline) throw new Error('offline');
      if (url === PLUGIN_MANIFEST_URL) return JSON.stringify({ version: world.published });
      if (url === NEWS_LIST_URL) return JSON.stringify([{ name: `${world.published}.md`, download_url: newsUrl(`${world.published}.md`) }]);
      if (url === newsUrl(`${world.published}.md`)) return world.news;
      throw new Error(`unexpected url in test: ${url}`);
    },
    exec: async (file, args) => {
      execs.push({ file, args });
      order.push(`exec ${args.join(' ')}`);
      if (args[1] === 'list') return JSON.stringify([{ id: 'yllir@yllir', installPath: world.installPath }]);
      return '';
    },
    findClaude: () => '/fake/bin/claude',
    installedVersion: async () => world.installed,
    language: () => 'en',
    liveOpen: async () => world.live,
    chatTurnOpen: () => world.turn,
    restart: (opts) => {
      restarts.push(opts);
      order.push('restart');
    },
    requestShutdown: () => {
      shutdowns += 1;
      order.push('shutdown');
    },
    log: (msg) => logs.push(msg),
  };
  return {
    deps,
    world,
    execs,
    restarts,
    clock,
    shutdowns: () => shutdowns,
    logs,
    order,
    campaignRoot: root,
    installDir,
  };
}

/** Lets pending promise callbacks and background checks settle. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
