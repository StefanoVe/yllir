import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { setExternalFrameworkRoot } from '../docs/external.js';
import { REAL_FRAMEWORK, worldFixture } from '../docs/test-support.js';
import { validateOpenPath } from './paths.js';

describe('validateOpenPath with external categories', () => {
  let fixture: Awaited<ReturnType<typeof worldFixture>>;

  before(async () => {
    setExternalFrameworkRoot(REAL_FRAMEWORK);
    fixture = await worldFixture();
  });

  after(async () => {
    setExternalFrameworkRoot(null);
    await fs.rm(fixture.base, { recursive: true, force: true });
  });

  it('accepts an existing Markdown document of the external folder', async () => {
    assert.equal(await validateOpenPath(fixture.campaign, 'shared/Luoghi/Raatnagar.md'), 'shared/Luoghi/Raatnagar.md');
  });

  it('accepts an ordinary campaign document', async () => {
    assert.equal(await validateOpenPath(fixture.campaign, 'characters/mara.md'), 'characters/mara.md');
  });

  it('refuses links that leave the campaign or the external folder, and paths with ..', async () => {
    for (const rel of ['linked.md', 'linkdir/secret.md', 'shared/Luoghi/alias-secret.md', 'shared/../outside/secret.md']) {
      assert.equal(await validateOpenPath(fixture.campaign, rel), null, rel);
    }
  });

  it('refuses a missing file, a non-Markdown file and an absolute path', async () => {
    assert.equal(await validateOpenPath(fixture.campaign, 'shared/Luoghi/Missing.md'), null);
    assert.equal(await validateOpenPath(fixture.campaign, `${fixture.world}/Luoghi/Raatnagar.md`), null);
    assert.equal(await validateOpenPath(fixture.campaign, '.campaign/state/x.md'), null);
  });
});
