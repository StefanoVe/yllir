// Runs the real framework CLIs in <repo>/yllir when they exist. Skipped until they are built.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createCtx } from './context.js';
import { runFrameworkCli } from './cli.js';
import { ENCYCLOPEDIA_CLI } from './encyclopedia/service.js';
import { PRINT_CLI } from './print/service.js';
import os from 'node:os';

const FRAMEWORK = fileURLToPath(new URL('../../../yllir', import.meta.url));
const CLIS_PRESENT = existsSync(path.join(FRAMEWORK, ENCYCLOPEDIA_CLI)) && existsSync(path.join(FRAMEWORK, PRINT_CLI));

describe('real framework CLIs', () => {
  it('the encyclopedia status CLI answers with built and report', { skip: CLIS_PRESENT ? false : 'framework CLIs are not built yet' }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-real-campaign-'));
    try {
      await fs.writeFile(path.join(root, 'campaign.yaml'), 'schema: 1\nlanguage:\n  main: en\nmodules:\n  encyclopedia: true\n');
      const ctx = createCtx({ campaignRoot: root, frameworkRoot: FRAMEWORK, port: 1, log: () => {} });
      const result = await runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['status', root]);
      assert.equal(result.code, 0);
      assert.equal((result.json as { built: boolean }).built, false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
