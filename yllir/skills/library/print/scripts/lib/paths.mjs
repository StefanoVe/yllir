// Fixed locations used by the print skill. Everything is derived from this file's
// place in the framework, so the skill works from the plugin folder wherever it is installed.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The framework root (the folder that holds scripts/ and skills/). */
export const FRAMEWORK_ROOT = path.resolve(here, '../../../../..');

/** The write cycle of the framework. */
export const ENGINE_SCRIPT = path.join(FRAMEWORK_ROOT, 'scripts', 'engine.mjs');

/** The bundled libraries (qrcode matrix, pdf-lib, pngjs), one ESM file. */
export const VENDOR_BUNDLE = path.resolve(here, '../../vendor/print-libs.mjs');

/** Generated print files, relative to the campaign folder (git-ignored, regenerable). */
export const PRINT_CACHE_DIR = '.campaign/cache/print';

/** Folder of the drafts the write cycle reads, relative to the campaign folder. */
export const DRAFTS_DIR = '.campaign/drafts';
