import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { findClaudeCode } from './claude-provider.js';

const HOME = path.join(os.tmpdir(), 'yllir-home');

describe('findClaudeCode lookup order', () => {
  it('honours YLLIR_CLAUDE_PATH first when the file exists', () => {
    const launcher = '/opt/custom/claude';
    const found = findClaudeCode({
      whichClaude: () => '/usr/local/bin/claude',
      exists: (file) => file === launcher || file === '/usr/local/bin/claude',
      home: HOME,
      env: { YLLIR_CLAUDE_PATH: launcher },
      platform: 'darwin',
    });
    assert.equal(found, launcher);
  });

  it('skips a YLLIR_CLAUDE_PATH that does not exist', () => {
    const found = findClaudeCode({
      whichClaude: () => '/usr/local/bin/claude',
      exists: (file) => file === '/usr/local/bin/claude',
      home: HOME,
      env: { YLLIR_CLAUDE_PATH: '/gone/claude' },
      platform: 'darwin',
    });
    assert.equal(found, '/usr/local/bin/claude');
  });

  it('finds Claude Code in the user install locations of a minimal PATH', () => {
    const installed = [
      path.join(HOME, '.local', 'bin', 'claude'),
      path.join(HOME, '.npm-global', 'bin', 'claude'),
      path.join(HOME, '.volta', 'bin', 'claude'),
      path.join(HOME, '.bun', 'bin', 'claude'),
    ];
    const base = { whichClaude: () => null, home: HOME, env: {}, platform: 'darwin' as const, readDir: () => [] };
    assert.equal(findClaudeCode({ ...base, exists: (f) => f === installed[0] }), installed[0]);
    assert.equal(findClaudeCode({ ...base, exists: (f) => f === installed[1] }), installed[1]);
    assert.equal(findClaudeCode({ ...base, exists: (f) => f === installed[2] }), installed[2]);
    assert.equal(findClaudeCode({ ...base, exists: (f) => f === installed[3] }), installed[3]);
  });

  it('uses the newest nvm Node version that has Claude Code', () => {
    const nvmNode = path.join(HOME, '.nvm', 'versions', 'node');
    const installed = new Set([
      path.join(nvmNode, 'v9.11.2', 'bin', 'claude'),
      path.join(nvmNode, 'v20.9.0', 'bin', 'claude'),
      path.join(nvmNode, 'v20.11.1', 'bin', 'claude'),
    ]);
    const found = findClaudeCode({
      whichClaude: () => null,
      exists: (file) => installed.has(file),
      readDir: (dir) => (dir === nvmNode ? ['v9.11.2', 'v20.9.0', 'v20.11.1', 'v22.0.0', 'current', 'notes.txt'] : []),
      home: HOME,
      env: {},
      platform: 'linux',
    });
    // v22.0.0 has no claude, so the newest version that has one wins: v20.11.1 (not v20.9.0 or v9.11.2).
    assert.equal(found, path.resolve(path.join(nvmNode, 'v20.11.1', 'bin', 'claude')));
  });

  it('prefers the usual locations over nvm', () => {
    const nvmClaude = path.join(HOME, '.nvm', 'versions', 'node', 'v20.11.1', 'bin', 'claude');
    const found = findClaudeCode({
      whichClaude: () => null,
      exists: (file) => file === nvmClaude || file === '/opt/homebrew/bin/claude',
      readDir: (dir) => (dir.endsWith(path.join('.nvm', 'versions', 'node')) ? ['v20.11.1'] : []),
      home: HOME,
      env: {},
      platform: 'darwin',
    });
    assert.equal(found, '/opt/homebrew/bin/claude');
  });

  it('looks for the npm shim on Windows', () => {
    const appdata = path.join(os.tmpdir(), 'AppData', 'Roaming');
    const target = path.join(appdata, 'npm', 'claude.cmd');
    const found = findClaudeCode({
      whichClaude: () => null,
      exists: (file) => file === target,
      home: '/nonexistent-home',
      env: { APPDATA: appdata },
      platform: 'win32',
    });
    assert.equal(found, path.resolve(target));
  });

  it('returns null when nothing is installed', () => {
    assert.equal(
      findClaudeCode({ whichClaude: () => null, exists: () => false, readDir: () => [], home: HOME, env: {}, platform: 'darwin' }),
      null,
    );
  });
});
