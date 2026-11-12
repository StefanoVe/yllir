#!/usr/bin/env node
// Verifies one music link: https, allow-listed host, at most three redirects, 200 KB, title present.
// Usage: node verify-link.mjs <url>
// Output: one JSON line, {"ok","finalUrl","status","title","reason"?}.
// Exit codes: 0 verified, 1 not verified, 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHosts, verifyLink } from './lib/verify.mjs';

const HOSTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'hosts.json');

function print(obj, code) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = code;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('--')) {
    print({ ok: false, finalUrl: null, status: null, title: null, reason: 'usage: node verify-link.mjs <url>' }, 2);
    return;
  }
  const loaded = loadHosts(HOSTS_FILE);
  if (!loaded.ok) {
    print({ ok: false, finalUrl: null, status: null, title: null, reason: loaded.error }, 1);
    return;
  }
  const result = await verifyLink(args[0], { hosts: loaded.hosts });
  print(result, result.ok ? 0 : 1);
}

main();
