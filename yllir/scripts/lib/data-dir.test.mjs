import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultDataDir, resolveDataDir } from './data-dir.mjs';

test('darwin default is under Application Support', () => {
  assert.equal(
    defaultDataDir({ platform: 'darwin', env: {}, home: '/Users/a' }),
    '/Users/a/Library/Application Support/yllir',
  );
});

test('win32 default uses LOCALAPPDATA', () => {
  assert.equal(
    defaultDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, home: 'C:\\Users\\a' }),
    'C:\\Users\\a\\AppData\\Local\\yllir',
  );
});

test('win32 falls back to home when LOCALAPPDATA is missing', () => {
  assert.equal(
    defaultDataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\a' }),
    'C:\\Users\\a\\AppData\\Local\\yllir',
  );
});

test('linux uses XDG_DATA_HOME when set', () => {
  assert.equal(
    defaultDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/x' }, home: '/home/a' }),
    '/data/x/yllir',
  );
});

test('linux falls back to ~/.local/share when XDG_DATA_HOME is empty or missing', () => {
  assert.equal(defaultDataDir({ platform: 'linux', env: {}, home: '/home/a' }), '/home/a/.local/share/yllir');
  assert.equal(
    defaultDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '' }, home: '/home/a' }),
    '/home/a/.local/share/yllir',
  );
});

test('a usable given folder is resolved to an absolute path', () => {
  assert.equal(resolveDataDir('/tmp/some-data', { platform: 'darwin', env: {}, home: '/Users/a' }), path.resolve('/tmp/some-data'));
});

test('a given path containing ${ is ignored and the default is used', () => {
  assert.equal(
    resolveDataDir('${CLAUDE_PLUGIN_DATA}/yllir', { platform: 'darwin', env: {}, home: '/Users/a' }),
    path.resolve('/Users/a/Library/Application Support/yllir'),
  );
});

test('an empty or missing given path uses the default', () => {
  const opts = { platform: 'linux', env: {}, home: '/home/a' };
  assert.equal(resolveDataDir('', opts), path.resolve('/home/a/.local/share/yllir'));
  assert.equal(resolveDataDir(undefined, opts), path.resolve('/home/a/.local/share/yllir'));
});
