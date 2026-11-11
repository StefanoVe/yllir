// Creates a new campaign in an empty folder: campaign.yaml, the git repository,
// and the generated instructions. Nothing is committed here: the first saved
// version is made by the write sequence.

import fs from 'node:fs';
import path from 'node:path';
import { stringifyConfig } from '../../../../../scripts/lib/config-write.mjs';
import { ensureRepo } from '../../../../../scripts/lib/versions.mjs';
import { generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { listAdapters, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';
import { slugify } from '../../../../../scripts/lib/normalize.mjs';

const FILE = 'campaign.yaml';
const REGISTERS = ['elevated', 'plain', 'colloquial', 'mixed'];
const LANG_RE = /^[a-z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @returns {{ created: string[], slug: string|null, errors: Array<{code: string, path: string|null, message: string}> }}
 */
export function initCampaign(root, { name, language, register, world, description, seed, adapter = 'none', today = localToday() } = {}) {
  const dir = path.resolve(root);
  const refuse = (code, message) => ({ created: [], slug: null, errors: [{ code, path: null, message }] });

  // 1. The folder must be empty apart from hidden entries.
  if (fs.existsSync(path.join(dir, FILE))) {
    return refuse('already-campaign', 'this folder already holds a campaign');
  }
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) {
      return refuse('bad-root', 'the campaign folder is not a folder');
    }
    const visible = fs.readdirSync(dir).filter((entry) => !entry.startsWith('.'));
    if (visible.length > 0) {
      return refuse('not-empty', 'the folder already holds files; a campaign needs an empty folder');
    }
  }
  const rootExisted = fs.existsSync(dir);

  // 2. Inputs.
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const slug = slugify(trimmedName);
  if (trimmedName === '' || slug === '') {
    return refuse('bad-input', 'the name must contain at least one letter or digit');
  }
  if (typeof language !== 'string' || !LANG_RE.test(language)) {
    return refuse('bad-input', 'language must be a two-letter lowercase code, such as it');
  }
  if (!REGISTERS.includes(register)) {
    return refuse('bad-input', `register must be one of: ${REGISTERS.join(', ')}`);
  }
  const worldText = optionalText(world);
  const descriptionText = optionalText(description);
  const seedText = optionalText(seed);
  if (worldText === false || descriptionText === false || seedText === false) {
    return refuse('bad-input', 'world, description and seed must be text');
  }
  if (typeof today !== 'string' || !DATE_RE.test(today) || !isRealDate(today)) {
    return refuse('bad-input', 'today must be a real date written as YYYY-MM-DD');
  }
  // Checked before anything is written, so a refused seed or adapter leaves the folder clean.
  if (seedText && !isSafeSeedName(seedText)) {
    return refuse('bad-input', 'seed must be a relative path to a .md file inside the campaign, without ..');
  }
  if (typeof adapter !== 'string') {
    return refuse('bad-input', 'adapter must be text');
  }
  if (adapter !== 'none' && !listAdapters(pluginRootFromHere()).includes(adapter)) {
    return refuse('unknown-adapter', `the game-rules adapter ${adapter} is not installed`);
  }

  // 3. campaign.yaml.
  const campaign = { name: trimmedName, slug };
  if (worldText) campaign.world = worldText;
  if (descriptionText) campaign.description = descriptionText;
  campaign.created = today;
  // The seed file itself is written later, by the first write of the campaign.
  if (seedText) campaign.seed = seedText;
  const config = {
    schema: 1,
    campaign,
    language: { main: language, other: [] },
    prose: { register },
    system: { adapter },
  };
  const file = path.join(dir, FILE);
  const rollback = () => {
    fs.rmSync(file, { force: true });
    if (!rootExisted) {
      try {
        fs.rmdirSync(dir);
      } catch {
        // Not empty: leave the folder as it is.
      }
    }
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, stringifyConfig(config));

  // 4. Git repository.
  let repo;
  try {
    repo = ensureRepo(dir);
  } catch (err) {
    rollback();
    return { created: [], slug, errors: [{ code: err.code ?? 'git-failed', path: null, message: err.message }] };
  }

  // 5. Instructions.
  const generated = generateInstructions(dir);
  if (generated.errors.length > 0) {
    return { created: [], slug, errors: generated.errors };
  }

  // 6. The result must validate (a missing category list is only a warning).
  const check = validateConfig(dir);
  if (!check.ok) {
    return { created: [], slug, errors: check.errors };
  }

  // 7. Created paths.
  const created = [
    FILE,
    ...(repo.created ? ['.git'] : []),
    '.gitignore',
    ...generated.written,
  ];
  return { created: [...new Set(created)], slug, errors: [] };
}

/** Undefined or blank text counts as not given; other non-text is false. */
function optionalText(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') return false;
  return value.trim();
}

/** Same rule as campaign.seed in config.mjs. */
function isSafeSeedName(text) {
  return text.endsWith('.md') && !text.startsWith('/') && !text.includes('\\') && !text.split('/').includes('..');
}

function isRealDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
