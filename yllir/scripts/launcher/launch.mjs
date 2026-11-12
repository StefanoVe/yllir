#!/usr/bin/env node
// Starts the master screen server for one campaign and opens it in the browser.
// Usage: node launch.mjs <campaign dir> [--lang it|en]
// The launcher terminal is the server's lifetime: closing it stops the server.
// Lower-level helpers live in launch-lib.mjs.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browserCommand,
  findLiveServer,
  message,
  parseArgs,
  parseReadyLine,
  readCampaignLanguage,
} from './launch-lib.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY_TIMEOUT_MS = 30000;

function say(text) {
  process.stdout.write(`${text}\n`);
}

function openBrowser(url) {
  const { cmd, args } = browserCommand(url);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed by the caller's message flow; a missing opener is not fatal.
  }
}

/** Starts the server, waits for its READY line and resolves to the exit code. */
function runServer(serverFile, campaign, lang) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [serverFile, '--campaign', campaign, '--framework', FRAMEWORK_ROOT, '--open', '--exit-when-closed'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let ready = false;
    let settled = false;
    let buffer = '';

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      resolve(code);
    };
    const onSigint = () => child.kill('SIGINT');
    const onSigterm = () => child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!ready) {
        say(message('M4', lang));
        child.kill('SIGTERM');
        finish(1);
      }
    }, READY_TIMEOUT_MS);

    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (ready) return;
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (parseReadyLine(line)) {
          ready = true;
          say(message('M1', lang));
          break;
        }
        newline = buffer.indexOf('\n');
      }
    });

    child.on('error', () => {
      if (!ready) say(message('M4', lang));
      finish(1);
    });
    child.on('exit', (code) => {
      if (!ready) {
        say(message('M4', lang));
        finish(1);
        return;
      }
      finish(code ?? 0);
    });
  });
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.campaign === null) {
    say(message('M4', args.lang ?? 'en'));
    return 1;
  }
  const campaign = path.resolve(args.campaign);
  const lang = args.lang ?? readCampaignLanguage(campaign);

  const serverFile = path.join(FRAMEWORK_ROOT, 'master-screen', 'server.mjs');
  if (!fs.existsSync(serverFile)) {
    say(message('M3', lang));
    return 1;
  }
  if (!fs.statSync(campaign, { throwIfNoEntry: false })?.isDirectory()) {
    say(message('M4', lang));
    return 1;
  }

  const live = await findLiveServer(campaign);
  if (live !== null) {
    openBrowser(live);
    return 0;
  }
  return runServer(serverFile, campaign, lang);
}

const code = await main(process.argv.slice(2));
process.exitCode = code;
