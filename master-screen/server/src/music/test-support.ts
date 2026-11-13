// Fixtures of the music tests: a temporary campaign with music sheets (master block and public
// part), and the real framework folder. Used only by *.test.ts files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignYaml, makeCampaign } from '../live/test-support.js';

export const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

/**
 * A framework of an older release: the same scripts, but no music-search parser (links.mjs).
 */
export function oldFramework(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-old-framework-'));
  fs.symlinkSync(path.join(REAL_FRAMEWORK, 'scripts'), path.join(root, 'scripts'), 'dir');
  fs.mkdirSync(path.join(root, 'skills', 'library', 'music-search', 'scripts', 'lib'), { recursive: true });
  return root;
}

export const MUSIC_ON_YAML = `${campaignYaml('en')}modules:\n  music: true\n`;
export const MUSIC_OFF_YAML = `${campaignYaml('en')}modules:\n  music: false\n`;

export const PORTO_SHEET = [
  '<!-- yllir',
  'id: porto',
  'kind: place',
  '-->',
  '',
  '# Porto di Vetro',
  '',
  'Public description of the port.',
  '',
  '### Musica',
  '',
  '- [Public leak](https://youtube.com/watch?v=PUBLICLEAK1) — public part, must be ignored',
  '',
  '<!-- master -->',
  '## Master',
  '',
  'Secret plot of the port.',
  '',
  '### Musica',
  '',
  '- [Taverna rumori](https://www.youtube.com/watch?v=abcdefghijk) — caldo, affollato',
  '- [Nebbia](https://youtu.be/ABCDEFGHIJK) — Preferita: nebbia sul porto',
  '- [Lista](https://www.youtube.com/playlist?list=PL123abc) — lista di brani',
  '- [Music site](https://music.youtube.com/watch?v=MUSIC012345) — ritmo lento',
  '- [Short](https://youtube.com/shorts/SHORTID1234) — shorts',
  '- [Embed](https://www.youtube.com/embed/EMBEDID1234) — embed',
  '- [Insecure](http://youtube.com/watch?v=abcdefghijk) — http, dropped',
  '- [Script](javascript:alert(1)) — javascript, dropped',
  '- [Ext](https://example.org/track) — altro',
  '<!-- /master -->',
  '',
].join('\n');

export const MERCATO_SHEET = [
  '# Mercato',
  '',
  'Public only.',
  '',
  '### Musica',
  '',
  '- [Fake](https://youtube.com/watch?v=abcdefghijk) — public part only',
  '',
].join('\n');

export const FORESTA_SHEET = [
  '<!-- master -->',
  '## Master',
  '',
  '### Music',
  '',
  '- [Forest theme](https://youtube.com/watch?v=FORESTID123) — Preferred: wind in the trees',
  '<!-- /master -->',
  '',
].join('\n');

/** A campaign with music sheets, a CLAUDE.md and a .campaign file that must not be scanned. */
export function musicCampaign(yaml: string = MUSIC_ON_YAML): string {
  return makeCampaign({
    'campaign.yaml': yaml,
    'Places/Porto/Porto.md': PORTO_SHEET,
    'Places/Mercato/Mercato.md': MERCATO_SHEET,
    'Places/Foresta/Foresta.md': FORESTA_SHEET,
    'CLAUDE.md': '# Generated\n\n### Musica\n\n- [Agent file](https://youtube.com/watch?v=AGENTFILE12) — must be ignored\n',
    '.campaign/notes.md': '<!-- master -->\n### Musica\n- [Hidden](https://youtube.com/watch?v=HIDDENFILE1) — ignored\n<!-- /master -->\n',
  });
}

/** A campaign with a plain sheet and no soundtrack link anywhere. */
export function silentCampaign(yaml: string = MUSIC_OFF_YAML): string {
  return makeCampaign({
    'campaign.yaml': yaml,
    'Places/Porto/Porto.md': '# Porto di Vetro\n\nPublic description only, no music.\n',
  });
}

/** The fake mpv of fake-mpv.mjs, behind a shell wrapper so it can be used as MPV_PATH. */
export const FAKE_MPV = fileURLToPath(new URL('./fake-mpv.mjs', import.meta.url));

export function fakeMpvBinary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-fake-mpv-'));
  const file = path.join(dir, 'mpv');
  fs.writeFileSync(file, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_MPV)} "$@"\n`, { mode: 0o755 });
  return file;
}
