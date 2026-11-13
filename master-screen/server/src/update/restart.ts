// Starts the updated launcher once this server has exited. A detached helper process outlives the
// server: it waits until the server's pid is gone (poll 200 ms, at most 30 s), then starts the
// launcher of the new framework for the campaign. Owner: update engineer.
import { spawn } from 'node:child_process';

const RESTART_SCRIPT = [
  "const { spawn } = require('node:child_process');",
  'const [pid, launchFile, campaignRoot] = process.argv.slice(1);',
  'const alive = (id) => { try { process.kill(id, 0); return true; } catch (err) { return err.code === \'EPERM\'; } };',
  'const started = Date.now();',
  'const timer = setInterval(() => {',
  '  if (alive(Number(pid)) && Date.now() - started < 30000) return;',
  '  clearInterval(timer);',
  '  const child = spawn(process.execPath, [launchFile, campaignRoot], { detached: true, stdio: \'ignore\', windowsHide: true });',
  "  child.on('error', () => {});",
  '  child.unref();',
  '}, 200);',
].join('\n');

export type SpawnRestart = (opts: { pid: number; launchFile: string; campaignRoot: string }) => void;

export const spawnRestart: SpawnRestart = ({ pid, launchFile, campaignRoot }) => {
  const child = spawn(process.execPath, ['-e', RESTART_SCRIPT, String(pid), launchFile, campaignRoot], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
};
