// Static tests of the Windows launcher: start.ps1 and the .cmd shortcut it is started
// from. Nothing here runs PowerShell or cmd.exe, so these are checks of the text, not of
// the behaviour on a Windows machine. The optional pwsh check runs only when pwsh exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeShortcut } from './write-shortcut.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PS1 = path.join(HERE, 'start.ps1');
const TEMPLATE = path.join(HERE, 'templates', 'windows-shortcut.cmd');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const ps1Bytes = fs.readFileSync(PS1);
const ps1 = ps1Bytes.subarray(3).toString('utf8');
// Code lines only: whole-line comments are dropped, so words in comments never match.
const code = ps1.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');

/**
 * Simple PowerShell scanner: tracks ( ) [ ] { } outside strings and comments, handles
 * '...' (with '' escapes), "..." (with `-escapes and "" escapes), # line comments and
 * <# #> block comments. Returns a list of problems; empty means balanced.
 */
function scanPowerShell(source) {
  const problems = [];
  const closers = { ')': '(', ']': '[', '}': '{' };
  const open = [];
  const n = source.length;
  let line = 1;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '<' && source[i + 1] === '#') {
      const end = source.indexOf('#>', i + 2);
      if (end < 0) { problems.push(`line ${line}: unterminated block comment`); break; }
      line += (source.slice(i, end).match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }
    if (c === '#') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = source[j];
        if (d === '\n') line += 1;
        if (quote === '"' && d === '`') { j += 2; continue; }
        if (d === quote) {
          if (source[j + 1] === quote) { j += 2; continue; }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) { problems.push(`line ${line}: unterminated ${quote === "'" ? 'single' : 'double'}-quoted string`); break; }
      i = j + 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') open.push({ c, line });
    if (c in closers) {
      const top = open.pop();
      if (!top || top.c !== closers[c]) problems.push(`line ${line}: unexpected '${c}'`);
    }
    i += 1;
  }
  for (const { c, line: at } of open) problems.push(`line ${at}: '${c}' never closed`);
  return problems;
}

/** The bytes of the .cmd that writeShortcut produces for a Windows framework path. */
function shortcutFor(frameworkRoot, language = 'it') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-win-cmd-'));
  try {
    const result = writeShortcut({ campaignRoot: dir, frameworkRoot, language, platform: 'win32' });
    return fs.readFileSync(result.path);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The same .cmd text with LF line ends, for line-anchored regular expressions. */
function shortcutLf(frameworkRoot, language = 'it') {
  return shortcutFor(frameworkRoot, language).toString('utf8').replace(/\r\n/g, '\n');
}

// ---------- the scanner itself ----------

test('the PowerShell scanner detects unbalanced code and ignores quotes in comments and strings', () => {
  assert.notEqual(scanPowerShell('if (1) { "a"').length, 0);
  assert.notEqual(scanPowerShell('$x = "unterminated').length, 0);
  assert.notEqual(scanPowerShell('$x = ]').length, 0);
  assert.deepEqual(scanPowerShell("# it's a comment with ( and \"\n$x = \"it's (ok)\" # ]\n$y = 'a''b'"), []);
  assert.deepEqual(scanPowerShell('<# ( #>\n$z = "x`"y"'), []);
});

// ---------- start.ps1 ----------

test('start.ps1 is saved as UTF-8 with BOM (5.1 reads accents only then)', () => {
  assert.deepEqual(ps1Bytes.subarray(0, 3), BOM);
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(ps1Bytes.subarray(3)));
});

test('start.ps1 has no smart quotes that PowerShell would read as string delimiters', () => {
  assert.doesNotMatch(ps1, /[\u2018\u2019\u201C\u201D]/);
});

test('start.ps1 scans cleanly: balanced brackets, closed quotes, no here-strings', () => {
  assert.deepEqual(scanPowerShell(ps1), []);
  assert.doesNotMatch(ps1, /@['"]\s*$/m);
});

test('start.ps1 stops on errors and prints the message in a try/catch with exit 1', () => {
  assert.match(code, /^\$ErrorActionPreference = 'Stop'$/m);
  assert.match(code, /^try \{$/m);
  assert.match(code, /catch \{\s*\$key = 'M4'[\s\S]*?Say \$key\s*\}?\s*exit 1/);
  assert.match(code, /\^yllir:\(M\\d\+\)\$/);
});

test('start.ps1 silences the progress bar and forces TLS 1.2 for PowerShell 5.1', () => {
  assert.match(code, /^\$ProgressPreference = 'SilentlyContinue'$/m);
  assert.match(code, /\[Net\.ServicePointManager\]::SecurityProtocol = \[Net\.SecurityProtocolType\]::Tls12/);
});

test('start.ps1 compares the SHA256 case-insensitively against node-version.txt', () => {
  assert.match(code, /\$actual\s+-ieq\s+\$expected/);
  assert.doesNotMatch(code, /\$actual\s+-(eq|ne)\s/);
  assert.match(code, /Get-FileHash -Algorithm SHA256 -LiteralPath/);
  assert.match(code, /Read-Pin "sha256\.\$platform"/);
});

test('start.ps1 downloads with a timeout and without a progress bar', () => {
  assert.match(code, /Invoke-WebRequest .*-UseBasicParsing .*-TimeoutSec \d+/);
});

test('start.ps1 detects the architecture through PROCESSOR_ARCHITEW6432 first, then PROCESSOR_ARCHITECTURE', () => {
  const w6432 = code.indexOf('$env:PROCESSOR_ARCHITEW6432');
  const arch = code.indexOf('$env:PROCESSOR_ARCHITECTURE');
  assert.ok(w6432 > 0 && arch > w6432, 'ARCHITEW6432 must come before ARCHITECTURE');
  assert.match(code, /'AMD64' \{ return 'win-x64' \}/);
  assert.match(code, /'ARM64' \{ return 'win-arm64' \}/);
});

test('start.ps1 extracts into a temp folder and moves only the inner node folder', () => {
  assert.match(code, /\$extract = Join-Path \$tmp 'extract'/);
  assert.match(code, /Expand-Archive -LiteralPath \$archive -DestinationPath \$extract -Force/);
  assert.match(code, /\$name = "node-v\$version-\$platform"/);
  assert.match(code, /\$src = Join-Path \$extract \$name/);
  assert.match(code, /Invoke-Retry \{ Move-Item -LiteralPath \$src -Destination \$target \}/);
});

test('start.ps1 never leaves a half-replaced node folder: the old one is kept until the new one is in place', () => {
  assert.match(code, /Invoke-Retry \{ Move-Item -LiteralPath \$target -Destination \$old \}/);
  assert.match(code, /Invoke-Retry \{ Move-Item -LiteralPath \$old -Destination \$target \}/);
  assert.match(code, /if \(\$hadOld\) \{ Remove-Tree \$old \}/);
});

test('start.ps1 removes its temp folder in a finally block, on success and on failure', () => {
  assert.match(code, /\} finally \{\s*Remove-Tree \$tmp\s*\}/);
  assert.match(code, /\$tmp = Join-Path \$yhome \('tmp\.' \+ \[guid\]::NewGuid\(\)\.ToString\('N'\)\.Substring\(0, 8\)\)/);
});

test('start.ps1 retries file moves and removals that antivirus may block, with LiteralPath', () => {
  assert.match(code, /function Invoke-Retry/);
  assert.match(code, /function Remove-Tree/);
  for (const line of code.split('\n').filter((l) => /\b(Move-Item|Remove-Item)\b/.test(l))) {
    assert.match(line, /-LiteralPath|Remove-Tree|Invoke-Retry/, `no LiteralPath: ${line.trim()}`);
  }
});

test('start.ps1 reads YLLIR_HOME and USERPROFILE (the overrides used by tests)', () => {
  assert.match(code, /\$env:YLLIR_HOME/);
  assert.match(code, /Join-Path \$env:USERPROFILE '\.yllir'/);
  assert.match(code, /\$env:YLLIR_NODE_SHA256_OVERRIDE/);
  assert.match(code, /\$env:YLLIR_NODE_BASE_URL/);
});

test('start.ps1 does not use aliases that differ between PowerShell 5.1 and 7', () => {
  const aliases = /^\s*(iwr|irm|iex|gc|rm|mi|cpi|ni|cat|ls|dir|cls|copy|move|del|md|rd|sc|sleep)\b/i;
  for (const line of code.split('\n')) assert.doesNotMatch(line, aliases, line.trim());
  assert.doesNotMatch(code, /\|\s*[%?]\s*\{/);
});

test('start.ps1 forwards the arguments and drops a trailing backslash from the campaign path', () => {
  assert.match(code, /\$forward = @\(\$args\)/);
  assert.match(code, /\$forward\[0\] = \$forward\[0\]\.TrimEnd\('\\'\)/);
  assert.match(code, /& \$node \(Join-Path \$here 'launch\.mjs'\) @forward/);
  assert.match(code, /exit \$LASTEXITCODE/);
});

test('start.ps1 uses the node-version.txt pins through one reader', () => {
  assert.match(code, /Get-Content -LiteralPath \(Join-Path \$here 'node-version\.txt'\) -Encoding UTF8/);
  assert.match(code, /\$minimum -notmatch '\^\\d\+\$'/);
});

test('pwsh parses start.ps1 without errors, when pwsh is installed', (t) => {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('pwsh is not installed: start.ps1 was not checked by the PowerShell parser');
    return;
  }
  const res = spawnSync(
    'pwsh',
    ['-NoProfile', '-Command', '$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:YLLIR_PS1, [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }'],
    { encoding: 'utf8', env: { ...process.env, YLLIR_PS1: PS1 } },
  );
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

// ---------- the .cmd shortcut ----------

test('the .cmd template turns off delayed expansion and sets code page 65001 before any non-ASCII line', () => {
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  assert.doesNotMatch(tpl, /enabledelayedexpansion/i);
  assert.match(tpl, /^setlocal DisableDelayedExpansion$/m);
  assert.match(tpl, /^chcp 65001 >nul$/m);
  assert.ok(tpl.indexOf('chcp 65001') < tpl.indexOf('{{NOT_FOUND}}'));
  assert.doesNotMatch(tpl, /[^\x00-\x7f]/, 'the template itself stays ASCII');
});

test('the generated .cmd uses CRLF only, no BOM, and is UTF-8', () => {
  const bytes = shortcutFor('C:\\Yllir\\framework');
  assert.notDeepEqual(bytes.subarray(0, 3), BOM);
  const text = bytes.toString('utf8');
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'bare LF found');
  assert.equal(text.replace(/\r\n/g, '').includes('\r'), false, 'bare CR found');
  assert.equal(text.split('\r\n')[0], '@rem yllir-shortcut v1');
  assert.equal(text.split('\r\n')[1], '@echo off');
});

test('the generated .cmd prints its Italian message only after chcp 65001', () => {
  const text = shortcutLf('C:\\fw', 'it');
  const echo = text.split('\n').find((l) => l.trimStart().startsWith('echo '));
  assert.match(echo, /Non riesco ad avviare il master screen/);
  assert.ok(text.indexOf('chcp 65001') < text.indexOf(echo));
});

test('every path variable in the generated .cmd is inside double quotes', () => {
  const text = shortcutLf('C:\\Yllir (x86)\\fw');
  const all = text.match(/%(FW|HERE|USERPROFILE)%/g) ?? [];
  const quoted = text.match(/"%(FW|HERE|USERPROFILE)%/g) ?? [];
  assert.ok(all.length >= 6, `expected path expansions, found ${all.length}`);
  assert.equal(quoted.length, all.length);
});

test('the generated .cmd reads the framework path, falls back to the baked one, and checks both', () => {
  const text = shortcutLf('C:\\fw');
  assert.match(text, /^if exist "%USERPROFILE%\\\.yllir\\framework-path" set \/p FW=<"%USERPROFILE%\\\.yllir\\framework-path"$/m);
  assert.match(text, /^if "%FW%"=="" set "FW=C:\\fw"$/m);
  assert.match(text, /^if not exist "%FW%\\scripts\\launcher\\start\.ps1" set "FW=C:\\fw"$/m);
  assert.match(text, /^if not exist "%FW%\\scripts\\launcher\\start\.ps1" \($/m);
});

test('the generated .cmd runs start.ps1 with the execution policy bypass, quoted paths and the language', () => {
  const text = shortcutLf('C:\\fw', 'en');
  assert.match(text, /^powershell -NoProfile -ExecutionPolicy Bypass -File "%FW%\\scripts\\launcher\\start\.ps1" "%HERE%" --lang en$/m);
  assert.match(text, /^set "HERE=%~dp0"$/m);
  assert.match(text, /^set "HERE=%HERE:~0,-1%"$/m);
});

test('the generated .cmd pauses only on failure', () => {
  const text = shortcutLf('C:\\fw');
  const pauses = text.split('\n').filter((l) => !/^\s*rem\b/i.test(l) && /\bpause\b/.test(l));
  assert.deepEqual(pauses.map((l) => l.trim()), ['pause', 'if errorlevel 1 pause']);
});

test('the generated .cmd explains that closing the window stops the server', () => {
  assert.match(shortcutLf('C:\\fw'), /^rem Closing the console window ends the master screen/m);
});

test('a framework path with percent, ampersand, parentheses, apostrophe and exclamation mark is written verbatim', () => {
  const root = "C:\\Dev (x86)\\Yllir & co\\it's !\\fw 100%";
  const lines = shortcutLf(root).split('\n').filter((l) => l.includes('set "FW=C:'));
  assert.equal(lines.length, 2, 'the default is set in the fallback and the not-found check');
  for (const line of lines) {
    const tail = line.slice(line.indexOf('set "FW=') + 'set "FW='.length);
    assert.equal(tail, `C:\\Dev (x86)\\Yllir & co\\it's !\\fw 100%%"`);
  }
});

test('a framework path that cannot be written safely is refused, not written', () => {
  assert.throws(() => shortcutFor('C:\\bad"quote'), /cannot be written/);
});

test('the .cmd message for echo escapes cmd special characters inside its block', () => {
  const echo = shortcutLf('C:\\fw', 'it').split('\n').find((l) => l.trimStart().startsWith('echo '));
  assert.ok(echo, 'echo line present');
  assert.doesNotMatch(echo.replace(/\^[%^&|<>()]/g, ''), /[&|<>()]/);
});
