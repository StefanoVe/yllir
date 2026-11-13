import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { tempDir } from '../live/test-support.js';
import { spawnRestart } from './restart.js';

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe('spawnRestart', () => {
  it('starts the launcher only after the old server pid is gone', async () => {
    const dir = tempDir('ms-restart-');
    const launch = path.join(dir, 'launch.mjs');
    // A stand-in launcher: it writes a marker next to the campaign folder it was given.
    fs.writeFileSync(launch, "import fs from 'node:fs';\nfs.writeFileSync(process.argv[2] + '/started.txt', 'ok');\n");
    // The old server: a live process that exits after 1.5 s.
    const old = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });
    const marker = path.join(dir, 'started.txt');
    try {
      spawnRestart({ pid: old.pid as number, launchFile: launch, campaignRoot: dir });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(fs.existsSync(marker), false, 'the launcher must wait for the old server to exit');
      assert.ok(await waitFor(() => fs.existsSync(marker), 15_000), 'the launcher starts after the exit');
    } finally {
      old.kill();
    }
  });
});
