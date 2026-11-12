import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG_SIGNATURE } from './codex.mjs';
import {
  childEnv,
  G2D_KEY_NAMES,
  probeG2dmedia,
  promptText,
  readG2dKeys,
  readReady,
  resolveDataDir,
  runG2dmedia,
} from './g2dmedia.mjs';

const COMMIT = '72fa5ad92d79b811acff464da32c8f3b1caa010f';
const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-image-bytes')]);

// lib -> scripts -> images -> library -> skills -> yllir -> repository root
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../../../../..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeJob(extra = {}) {
  const jobDir = tempDir('yllir-g2d-job-');
  const job = {
    operation: 'generate',
    prompt: 'a red fox',
    negative: 'text',
    width: 1536,
    height: 1024,
    ...extra,
  };
  fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(job));
  return { jobDir, job };
}

function writeKeys(campaignRoot, data) {
  const dir = path.join(campaignRoot, '.campaign', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify(data));
}

/**
 * Fake spawn. `behavior({ args, opts })` may write files and returns
 * { code, stdout, stderr, error }; the child then emits its output and closes.
 */
function fakeSpawn(behavior = () => ({ code: 0 })) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      const { code = 0, stdout = '', stderr = '', error = null } = behavior({ cmd, args, opts }) ?? {};
      if (error) {
        child.emit('error', error);
        return;
      }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  };
  return { spawnImpl, calls };
}

function argValue(args, flag) {
  return args[args.indexOf(flag) + 1];
}

const READY = { python: '/usr/bin/fake-python', generate2dmedia: '/opt/g2d' };

const successLine = (artifact, route = 'api:gemini') =>
  `${JSON.stringify({ status: 'ok', route, artifact, sha256: 'x', estimateUsd: null, kind: 'image', model: 'm1' })}\n`;

test('childEnv removes key names and FORGE_ settings from the base and sets only the given keys', () => {
  const env = childEnv({
    base: {
      GEMINI_API_KEY: 'base-key',
      OPENAI_API_KEY: 'base-openai',
      FORGE_X: '1',
      FORGE_ROUTE_MEDIA_FAKE: '/x.py',
      PATH: '/bin',
      HOME: '/home/u',
      KEEP: 'yes',
    },
    keys: { GEMINI_API_KEY: 'given' },
    configDir: '/cfg',
  });
  assert.equal(env.GEMINI_API_KEY, 'given');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.FORGE_X, undefined);
  assert.equal(env.FORGE_ROUTE_MEDIA_FAKE, undefined);
  assert.equal(env.XDG_CONFIG_HOME, '/cfg');
  assert.equal(env.APPDATA, '/cfg');
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/home/u');
  assert.equal(env.KEEP, 'yes');
  assert.equal(Object.keys(env).filter((name) => G2D_KEY_NAMES.includes(name)).join(','), 'GEMINI_API_KEY');

  const withFake = childEnv({ base: {}, keys: {}, configDir: '/cfg', fake: '/fake.py' });
  assert.equal(withFake.FORGE_ROUTE_MEDIA_FAKE, '/fake.py');
  assert.equal(childEnv({ base: {}, keys: {}, configDir: '/cfg' }).FORGE_ROUTE_MEDIA_FAKE, undefined);
});

test('readG2dKeys keeps only allowed names with non-empty string values', () => {
  const root = tempDir('yllir-g2d-keys-');
  writeKeys(root, {
    generate2dmedia: { GEMINI_API_KEY: 'g-value', UNKNOWN_KEY: 'u', OPENAI_API_KEY: 42, FAL_KEY: '' },
    codex: { OPENAI_API_KEY: 'other-provider' },
  });
  assert.deepEqual(readG2dKeys(root), { GEMINI_API_KEY: 'g-value' });
});

test('readG2dKeys gives an empty object when the file or the entry is missing or invalid', () => {
  const missing = tempDir('yllir-g2d-nokeys-');
  assert.deepEqual(readG2dKeys(missing), {});

  const noEntry = tempDir('yllir-g2d-noentry-');
  writeKeys(noEntry, { codex: {} });
  assert.deepEqual(readG2dKeys(noEntry), {});

  const broken = tempDir('yllir-g2d-broken-');
  fs.mkdirSync(path.join(broken, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.campaign', 'state', 'keys.json'), '{ not json');
  assert.deepEqual(readG2dKeys(broken), {});
});

test('runG2dmedia happy path: result.png, run.json, prompt.txt and arguments', async () => {
  const campaignRoot = tempDir('yllir-g2d-campaign-');
  const { jobDir } = makeJob();
  const { spawnImpl, calls } = fakeSpawn(({ opts }) => {
    fs.mkdirSync(path.join(opts.cwd, 'g2d-out'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'g2d-out', 'generated.png'), PNG);
    return { code: 0, stdout: `log line\n${successLine('g2d-out/generated.png')}` };
  });

  const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl });
  assert.deepEqual(result, { ok: true, route: 'api:gemini' });
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), PNG);

  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.equal(run.provider, 'generate2dmedia');
  assert.equal(run.parameters.route, 'api:gemini');
  assert.equal(run.parameters.model, 'm1');
  assert.equal(run.parameters.width, 1536);

  assert.equal(fs.readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8'), 'a red fox\n\nAvoid: text');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/usr/bin/fake-python');
  assert.equal(calls[0].args[0], '/opt/g2d/scripts/route_media.py');
  assert.equal(calls[0].args[1], 'image');
  assert.equal(argValue(calls[0].args, '--size'), '1536x1024');
  assert.equal(argValue(calls[0].args, '--project-dir'), jobDir);
  assert.equal(argValue(calls[0].args, '--out-dir'), 'g2d-out');
  assert.equal(calls[0].args.includes('--reference'), false);
  assert.equal(calls[0].opts.cwd, jobDir);
});

test('prompt.txt holds the prompt alone when there is no negative part; reference is passed only when it exists', async () => {
  const campaignRoot = tempDir('yllir-g2d-ref-');
  const refDir = tempDir('yllir-g2d-refimg-');
  const reference = path.join(refDir, 'identity.png');
  fs.writeFileSync(reference, PNG);
  const { jobDir } = makeJob({ negative: '', reference });
  const { spawnImpl, calls } = fakeSpawn(({ opts }) => {
    fs.mkdirSync(path.join(opts.cwd, 'g2d-out'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'g2d-out', 'generated.png'), PNG);
    return { code: 0, stdout: successLine('g2d-out/generated.png') };
  });
  await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl });
  assert.equal(fs.readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8'), 'a red fox');
  assert.equal(argValue(calls[0].args, '--reference'), reference);

  const { jobDir: other } = makeJob({ reference: path.join(refDir, 'missing.png') });
  const second = fakeSpawn(({ opts }) => {
    fs.mkdirSync(path.join(opts.cwd, 'g2d-out'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'g2d-out', 'generated.png'), PNG);
    return { code: 0, stdout: successLine('g2d-out/generated.png') };
  });
  await runG2dmedia({ campaignRoot, jobDir: other, ready: READY, spawnImpl: second.spawnImpl });
  assert.equal(second.calls[0].args.includes('--reference'), false);
});

test('promptText adds the Avoid line only when there is a negative part', () => {
  assert.equal(promptText({ prompt: 'p', negative: 'n' }), 'p\n\nAvoid: n');
  assert.equal(promptText({ prompt: 'p' }), 'p');
});

test('exit 3 is unavailable with message no route', async () => {
  const campaignRoot = tempDir('yllir-g2d-exit3-');
  const { jobDir } = makeJob();
  const { spawnImpl } = fakeSpawn(() => ({ code: 3, stdout: '{"status":"no-route","fallback":"codeart2d"}\n' }));
  const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl });
  assert.deepEqual(result, { ok: false, error: 'unavailable', message: 'no route' });
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
});

test('other non-zero exit is failed with the last error line', async () => {
  const campaignRoot = tempDir('yllir-g2d-exit1-');
  const { jobDir } = makeJob();
  const { spawnImpl } = fakeSpawn(() => ({
    code: 1,
    stdout: 'trying route\nerror: api:gemini: auth: bad key\n',
  }));
  const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'api:gemini: auth: bad key');
});

test('an artifact that is not a PNG is failed with not a png', async () => {
  const campaignRoot = tempDir('yllir-g2d-notpng-');
  const { jobDir } = makeJob();
  const { spawnImpl } = fakeSpawn(({ opts }) => {
    fs.mkdirSync(path.join(opts.cwd, 'g2d-out'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'g2d-out', 'generated.png'), 'plain text, not an image');
    return { code: 0, stdout: successLine('g2d-out/generated.png') };
  });
  const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl });
  assert.deepEqual(result, { ok: false, error: 'failed', message: 'not a png' });
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
});

test('no ready record is unavailable with message not installed, and nothing is spawned', async () => {
  const campaignRoot = tempDir('yllir-g2d-noready-');
  const { jobDir } = makeJob();
  const { spawnImpl, calls } = fakeSpawn();
  const result = await runG2dmedia({ campaignRoot, jobDir, ready: null, spawnImpl });
  assert.deepEqual(result, { ok: false, error: 'unavailable', message: 'not installed' });
  assert.equal(calls.length, 0);
});

test('operation other than generate is unsupported', async () => {
  const campaignRoot = tempDir('yllir-g2d-op-');
  const { jobDir } = makeJob({ operation: 'remove_background' });
  const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl: fakeSpawn().spawnImpl });
  assert.equal(result.error, 'unsupported');
});

test('route is passed to route_media only when given; an unknown route is refused before anything is spawned', async () => {
  const campaignRoot = tempDir('yllir-g2d-route-');
  const okBehavior = ({ opts }) => {
    fs.mkdirSync(path.join(opts.cwd, 'g2d-out'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'g2d-out', 'generated.png'), PNG);
    return { code: 0, stdout: successLine('g2d-out/generated.png', 'api:gemini') };
  };

  const given = makeJob();
  const withRoute = fakeSpawn(okBehavior);
  const ok = await runG2dmedia({ campaignRoot, jobDir: given.jobDir, ready: READY, spawnImpl: withRoute.spawnImpl, route: 'gemini' });
  assert.equal(ok.ok, true);
  assert.equal(argValue(withRoute.calls[0].args, '--route'), 'gemini');
  assert.equal(withRoute.calls[0].args.filter((arg) => arg === '--route').length, 1);

  const unset = makeJob();
  const withoutRoute = fakeSpawn(okBehavior);
  await runG2dmedia({ campaignRoot, jobDir: unset.jobDir, ready: READY, spawnImpl: withoutRoute.spawnImpl });
  assert.equal(withoutRoute.calls[0].args.includes('--route'), false);

  for (const bad of ['midjourney', 'Gemini', '', 'auto']) {
    const { jobDir } = makeJob();
    const refused = fakeSpawn(okBehavior);
    const result = await runG2dmedia({ campaignRoot, jobDir, ready: READY, spawnImpl: refused.spawnImpl, route: bad });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid');
    assert.equal(refused.calls.length, 0);
    assert.equal(fs.existsSync(path.join(jobDir, 'prompt.txt')), false);
  }
});

test('probe passes --route to resolve only when given; an unknown route is refused', async () => {
  const campaignRoot = tempDir('yllir-g2d-probe-route-');
  const args = [];
  const recording = fakeSpawn(({ args: callArgs }) => {
    args.push(callArgs);
    return { code: 0 };
  });
  assert.deepEqual(await probeG2dmedia({ campaignRoot, ready: READY, spawnImpl: recording.spawnImpl, route: 'fal' }), {
    available: true,
    reason: null,
  });
  assert.equal(argValue(args[0], '--route'), 'fal');
  assert.equal(args[0][1], 'resolve');

  await probeG2dmedia({ campaignRoot, ready: READY, spawnImpl: recording.spawnImpl });
  assert.equal(args[1].includes('--route'), false);

  const refused = fakeSpawn();
  assert.deepEqual(await probeG2dmedia({ campaignRoot, ready: READY, spawnImpl: refused.spawnImpl, route: 'bogus' }), {
    available: false,
    reason: 'invalid',
  });
  assert.equal(refused.calls.length, 0);
});

test('CLI refuses an unknown --route with usage exit 2 and never reads the install', () => {
  const cli = path.resolve(here, '../g2dmedia-run.mjs');
  const campaignRoot = tempDir('yllir-g2d-cli-');
  const { jobDir } = makeJob();
  const result = spawnSync(process.execPath, [cli, campaignRoot, jobDir, '--route', 'midjourney'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: node g2dmedia-run\.mjs/);
  assert.match(result.stdout, /exit: 2\n$/);
  assert.equal(fs.existsSync(path.join(jobDir, 'g2d-config')), false);
});

test('readReady reads a valid install record and rejects a wrong commit or a missing script', () => {
  const dataDir = tempDir('yllir-g2d-data-');
  const install = path.join(dataDir, 'third-party', 'agent-sprite-forge', COMMIT);
  const g2d = path.join(install, 'repo', 'skills', 'generate2dmedia');
  fs.mkdirSync(path.join(g2d, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(g2d, 'scripts', 'route_media.py'), '');
  const record = {
    schema: 'yllir.third-party.ready.v1',
    commit: COMMIT,
    python: path.join(install, 'venv', 'bin', 'python'),
    generate2dmedia: g2d,
    installed: '2026-11-11T10:00:00Z',
  };
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, 'ready.json'), JSON.stringify(record));
  assert.deepEqual(readReady(dataDir), { python: record.python, generate2dmedia: g2d });

  fs.writeFileSync(path.join(install, 'ready.json'), JSON.stringify({ ...record, commit: 'abc' }));
  assert.equal(readReady(dataDir), null);

  fs.writeFileSync(path.join(install, 'ready.json'), JSON.stringify(record));
  fs.rmSync(path.join(g2d, 'scripts', 'route_media.py'));
  assert.equal(readReady(dataDir), null);

  assert.equal(readReady(tempDir('yllir-g2d-empty-')), null);
});

test('resolveDataDir: empty or unresolved value means the default folder', () => {
  const fallback = resolveDataDir(undefined);
  assert.equal(resolveDataDir(''), fallback);
  assert.equal(resolveDataDir('${DATA_DIR}'), fallback);
  assert.equal(resolveDataDir('/custom/data'), path.resolve('/custom/data'));
});

test('probeG2dmedia: not installed, no route, route found, probe failed', async () => {
  const campaignRoot = tempDir('yllir-g2d-probe-');
  assert.deepEqual(await probeG2dmedia({ campaignRoot, ready: null, spawnImpl: fakeSpawn().spawnImpl }), {
    available: false,
    reason: 'not-installed',
  });

  const seen = [];
  const run = (code) => {
    const fake = fakeSpawn(({ args, opts }) => {
      seen.push({ args, env: opts.env });
      return { code };
    });
    return probeG2dmedia({ campaignRoot, ready: READY, spawnImpl: fake.spawnImpl });
  };
  assert.deepEqual(await run(0), { available: true, reason: null });
  assert.equal(seen[0].args[1], 'resolve');
  assert.equal(seen[0].args.includes('--kind'), true);
  assert.equal(seen[0].env.PYTHONUTF8, '1');
  assert.deepEqual(await run(3), { available: false, reason: 'no-route' });
  assert.deepEqual(await run(1), { available: false, reason: 'probe-failed' });
  assert.deepEqual(
    await probeG2dmedia({
      campaignRoot,
      ready: READY,
      spawnImpl: fakeSpawn(() => ({ error: Object.assign(new Error('spawn fail'), { code: 'EACCES' }) })).spawnImpl,
    }),
    { available: false, reason: 'probe-failed' },
  );
});

// ---- real seam: runs the real route_media.py, with a fake generator behind it ----
// Runs only when YLLIR_TEST_PYTHON names a Python interpreter (the third-party venv).

const FAKE_GENERATOR = `import json, os, sys
argv = sys.argv[1:]

def value(flag):
    return argv[argv.index(flag) + 1]

leaked = [name for name in ("OPENAI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "ARK_API_KEY", "FAL_KEY") if name in os.environ]
if leaked or os.environ.get("GEMINI_API_KEY") != "test-gemini-value":
    print("error: leak: unexpected key environment")
    sys.exit(1)

job_dir = value("--project-dir")
with open(os.path.join(job_dir, "job.json"), encoding="utf-8") as f:
    job = json.load(f)
with open(value("--prompt-file"), encoding="utf-8") as f:
    prompt = f.read()
if prompt != job["prompt"]:
    print("error: leak: prompt differs from the job prompt")
    sys.exit(1)

out_dir = value("--out-dir")
os.makedirs(out_dir, exist_ok=True)
artifact = os.path.join(out_dir, "generated.png")
with open(artifact, "wb") as f:
    f.write(b"\\x89PNG\\r\\n\\x1a\\n" + b"fake-image-bytes")
print(json.dumps({"status": "ok", "route": "api:gemini", "artifact": artifact, "sha256": "x", "estimateUsd": None, "model": "m"}))
`;

test(
  'seam: real route_media.py gets only the job prompt and the campaign GEMINI key',
  { skip: !process.env.YLLIR_TEST_PYTHON },
  async () => {
    const campaignRoot = tempDir('yllir-g2d-seam-campaign-');
    writeKeys(campaignRoot, { generate2dmedia: { GEMINI_API_KEY: 'test-gemini-value' } });
    const { jobDir } = makeJob({ negative: '', width: 1024, height: 1024 });
    const fakeDir = tempDir('yllir-g2d-seam-fake-');
    const fake = path.join(fakeDir, 'fake_generator.py');
    fs.writeFileSync(fake, FAKE_GENERATOR);

    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'decoy';
    try {
      const ready = {
        python: process.env.YLLIR_TEST_PYTHON,
        generate2dmedia: path.join(ROOT, '.claude', 'scratchpad', 'asf', 'repo', 'skills', 'generate2dmedia'),
      };
      const result = await runG2dmedia({ campaignRoot, jobDir, ready, fake });
      const log = fs.readFileSync(path.join(jobDir, 'g2d.log'), 'utf8');
      assert.equal(result.ok, true, log);
      assert.equal(result.route, 'api:gemini');
      assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-image-bytes')]));
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  },
);
