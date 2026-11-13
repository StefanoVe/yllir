// Fixture of an external category for the tests of the docs, the chat paths and the gate:
// a campaign whose `shared` folder is a symbolic link to a world kept outside the campaign.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The real Yllir plugin folder, whose scripts/lib holds the parsers the docs code loads. */
export const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

export interface WorldFixture {
  /** Parent folder of everything below; the caller removes it. */
  base: string;
  /** The campaign: `shared` is an external category, a link to `world`. */
  campaign: string;
  /** The shared world, outside the campaign. Holds Luoghi/Raatnagar.md. */
  world: string;
  /** A folder outside both the campaign and the world, holding secret.md. */
  outside: string;
}

/**
 * Campaign layout:
 *   campaign/campaign.yaml           structure: shared (external), characters (pc)
 *   campaign/characters/mara.md      an ordinary document
 *   campaign/shared -> world         the external category
 *   campaign/linked.md -> outside/secret.md        a link outside any external folder
 *   campaign/linkdir -> outside                     a folder link outside any external folder
 *   campaign/shared/Luoghi/alias-secret.md -> outside/secret.md   a link inside the external folder that leaves it
 *   world/loop -> world                             a link back to the world (must not loop)
 */
export async function worldFixture(): Promise<WorldFixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'yllir-external-'));
  const campaign = path.join(base, 'campaign');
  const world = path.join(base, 'world');
  const outside = path.join(base, 'outside');
  await fs.mkdir(path.join(campaign, 'characters'), { recursive: true });
  await fs.mkdir(path.join(world, 'Luoghi'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(
    path.join(campaign, 'campaign.yaml'),
    ['name: Test', 'structure:', '  - id: shared', '    folder: shared', '    type: external', '  - id: characters', '    folder: characters', '    type: pc', ''].join('\n'),
  );
  await fs.writeFile(path.join(campaign, 'characters', 'mara.md'), '# Mara\n');
  await fs.writeFile(path.join(world, 'Luoghi', 'Raatnagar.md'), '# Raatnagar\n');
  await fs.writeFile(path.join(outside, 'secret.md'), '# Secret\n');
  await fs.symlink(world, path.join(campaign, 'shared'));
  await fs.symlink(path.join(outside, 'secret.md'), path.join(campaign, 'linked.md'));
  await fs.symlink(outside, path.join(campaign, 'linkdir'));
  await fs.symlink(path.join(outside, 'secret.md'), path.join(world, 'Luoghi', 'alias-secret.md'));
  await fs.symlink(world, path.join(world, 'loop'));
  return { base, campaign, world, outside };
}
