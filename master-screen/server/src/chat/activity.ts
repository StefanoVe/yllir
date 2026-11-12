// Turns a tool use of the agent into one plain-language sentence for the master, and
// makes sure no activity text ever carries a tool name, a path or a technical word.
// A document title is the one exception: it is quoted and inserted after the filter.
// Owner: chat engineer.
import fs from 'node:fs';
import path from 'node:path';
import type { StepKind } from '../../../shared/src/types.js';
import { isInside } from '../agent/gate.js';
import type { Lang } from './text.js';
import { TEXTS } from './text.js';

const ENGINE_CALL = /engine\.mjs"?\s+([a-z-]+)/;
const SCRIPT_NAME = /([A-Za-z0-9_-]+)\.mjs\b/;
const CHECK_COMMANDS = new Set(['index', 'query', 'check']);
const SAVE_COMMANDS = new Set(['commit', 'undo', 'revert']);
const IMAGE_SELECT_SCRIPTS = new Set(['image-select', 'image-probe']);
const IMAGE_RENDER_SCRIPTS = new Set(['codex-run', 'comfyui-run', 'g2dmedia-run', 'command-run', 'http-run']);

/** The campaign and the framework folders: what a Read can tell apart. */
export interface ActivityRoots {
  campaignRoot: string;
  frameworkRoot: string;
}

/** One step of the agent: its kind and the sentence for the master. */
export interface ToolDescription {
  kind: StepKind;
  text: string;
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

/** Quotes are stripped from a title, which is capped at 60 characters and kept on one line. */
function cleanTitle(raw: string): string {
  const oneLine = raw
    .replace(/[\r\n`«»“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > TITLE_MAX ? oneLine.slice(0, TITLE_MAX).trimEnd() : oneLine;
}

const TITLE_MAX = 60;
const TITLE_READ_BYTES = 4096;

/** The text of the first `# ` heading of a text, or null. */
export function headingOf(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const found = /^# (.+)$/.exec(line);
    if (found && found[1].trim() !== '') return found[1].trim();
  }
  return null;
}

/**
 * The title of a campaign Markdown file: its first `# ` heading in the first 4 KB, else the
 * file name without extension. Null when nothing usable is found. Synchronous, never throws.
 */
export function documentTitle(file: string): string | null {
  const fallback = path.basename(file, path.extname(file));
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(TITLE_READ_BYTES);
      const read = fs.readSync(fd, buffer, 0, TITLE_READ_BYTES, 0);
      const title = cleanTitle(headingOf(buffer.toString('utf8', 0, read)) ?? fallback);
      return title === '' ? null : title;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    const title = cleanTitle(fallback);
    return title === '' ? null : title;
  }
}

function describeRead(input: Record<string, unknown>, lang: Lang, roots?: ActivityRoots): ToolDescription {
  const t = TEXTS[lang];
  const file = stringField(input, 'file_path');
  if (roots && file !== '') {
    const target = path.resolve(roots.campaignRoot, file);
    if (isInside(target, roots.frameworkRoot)) return { kind: 'read', text: t.readingInstructions };
    const inCampaign = isInside(target, roots.campaignRoot);
    const inState = isInside(target, path.join(roots.campaignRoot, '.campaign'));
    if (inCampaign && !inState && target.endsWith('.md')) {
      const title = documentTitle(target);
      if (title) return { kind: 'read', text: t.readingDoc(title) };
    }
  }
  return { kind: 'read', text: t.reading };
}

function describeDraft(name: string, input: Record<string, unknown>, lang: Lang, roots?: ActivityRoots): ToolDescription {
  const t = TEXTS[lang];
  const file = stringField(input, 'file_path');
  const content = stringField(input, name === 'Write' ? 'content' : 'new_string');
  if (roots && file !== '') {
    const target = path.resolve(roots.campaignRoot, file);
    const drafts = path.join(roots.campaignRoot, '.campaign', 'drafts');
    const heading = headingOf(content);
    if (heading !== null && isInside(target, drafts)) {
      const title = cleanTitle(heading);
      if (title !== '') return { kind: 'write', text: t.draftingDoc(title) };
    }
  }
  return { kind: 'write', text: t.drafting };
}

function describeSkill(input: Record<string, unknown>, lang: Lang): ToolDescription {
  const t = TEXTS[lang];
  const raw = stringField(input, 'skill');
  const name = raw.slice(raw.lastIndexOf(':') + 1).trim();
  const known = Object.prototype.hasOwnProperty.call(t.skills, name);
  return { kind: name === 'images' ? 'image' : 'skill', text: known ? t.skills[name] : t.preparing };
}

function describeAgent(input: Record<string, unknown>, lang: Lang): ToolDescription {
  const description = stringField(input, 'description').replace(/\s+/g, ' ').trim();
  const usable = description !== '' && description.length <= NARRATION_MAX && !NARRATION_UNSAFE.test(description);
  return { kind: 'agent', text: usable ? description : TEXTS[lang].reviewing };
}

function describeBash(input: Record<string, unknown>, lang: Lang): ToolDescription {
  const t = TEXTS[lang];
  const command = stringField(input, 'command');
  const engine = ENGINE_CALL.exec(command);
  if (engine) {
    if (SAVE_COMMANDS.has(engine[1])) return { kind: 'save', text: t.saving };
    if (CHECK_COMMANDS.has(engine[1])) return { kind: 'check', text: t.checking };
    return { kind: 'other', text: t.preparingDocs };
  }
  const script = SCRIPT_NAME.exec(command)?.[1] ?? '';
  if (IMAGE_SELECT_SCRIPTS.has(script)) return { kind: 'image', text: t.imageSelect };
  if (script === 'image-prompt') return { kind: 'image', text: t.imagePrompt };
  if (IMAGE_RENDER_SCRIPTS.has(script)) return { kind: 'image', text: t.imageRender };
  if (script === 'image-place') return { kind: 'image', text: t.imagePlace };
  if (/[/\\]maps[/\\]/.test(command)) return { kind: 'image', text: t.mapDrawing };
  return { kind: 'other', text: t.working };
}

/**
 * The step (kind and sentence) of one tool use, or null when the tool has no visible meaning.
 * `input` is the tool input as the SDK reports it; only its shape is read here. `roots`, when
 * given, lets a Read name a campaign document by its title and tells framework files apart.
 */
export function describeTool(
  name: string,
  input: Record<string, unknown>,
  lang: Lang,
  roots?: ActivityRoots,
): ToolDescription | null {
  const t = TEXTS[lang];
  switch (name) {
    case 'Read':
      return describeRead(input, lang, roots);
    case 'Glob':
    case 'Grep':
    case 'mcp__yllir__search_docs':
      return { kind: 'search', text: t.searching };
    case 'Write':
    case 'Edit':
      return describeDraft(name, input, lang, roots);
    case 'Skill':
      return describeSkill(input, lang);
    case 'mcp__yllir__open_document':
      return { kind: 'open', text: t.opening };
    case 'Task':
    case 'Agent':
      return describeAgent(input, lang);
    case 'mcp__yllir__suggest_music':
      return { kind: 'music', text: t.musicSearch };
    case 'Bash':
      return describeBash(input, lang);
    default:
      if (name.startsWith('mcp__plugin_yllir_photoshop__') || name.includes('photoshop_')) {
        return { kind: 'image', text: t.photoshopRetouch };
      }
      return null;
  }
}

/**
 * The sentence for one tool use, or null when the tool has no visible meaning.
 * `input` is the tool input as the SDK reports it; only its shape is read here.
 */
export function toolActivity(name: string, input: Record<string, unknown>, lang: Lang, roots?: ActivityRoots): string | null {
  return describeTool(name, input, lang, roots)?.text ?? null;
}

/** Text that must never be shown as narration: a path, a file name, backticks, or internal words. */
const NARRATION_UNSAFE = /[/\\`]|\.(?:md|mjs|cjs|js|ts|json|ya?ml)\b|\b(?:migrat\w*|migrazion\w*|hooks?|scripts?|json)\b/i;
const NARRATION_MAX = 80;

/**
 * The activity line for the intermediate text of an agent message (text before a tool use):
 * one line, at most 80 characters, or the generic sentence when the text is unsafe.
 * Returns '' for empty text.
 */
export function narrationActivity(text: string, lang: Lang): string {
  const body = text.trim();
  if (body === '') return '';
  if (NARRATION_UNSAFE.test(body)) return TEXTS[lang].working;
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '';
  const oneLine = firstLine.replace(/\s+/g, ' ');
  if (oneLine.length <= NARRATION_MAX) return oneLine;
  return `${oneLine.slice(0, NARRATION_MAX - 1).trimEnd()}…`;
}

/** Words that must never reach the master in an activity sentence. */
const FORBIDDEN = /[/\\]|\.mjs|\.yaml|\.md\b|mcp__|\b(?:bash|read|write|edit|grep|glob|skill|task|agent|git|commit|sha|index|frontmatter|token|provider|query)\b/i;

function isSafeText(trimmed: string): boolean {
  return trimmed !== '' && trimmed.length <= 160 && !FORBIDDEN.test(trimmed);
}

/**
 * Keeps an activity sentence safe: a text with a path, a tool name or a technical word
 * is replaced by the generic sentence of the language.
 */
export function safeActivity(text: string, lang: Lang): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return isSafeText(trimmed) ? trimmed : TEXTS[lang].working;
}

const QUOTED_TITLE = /[«“][^»”]*[»”]/;

/**
 * Like safeActivity, but a quoted document title is left out of the check: the title is
 * inserted after the filter, so a title with a word such as "index" is kept.
 */
export function safeSentence(text: string, lang: Lang): string {
  const quoted = QUOTED_TITLE.exec(text);
  if (!quoted) return safeActivity(text, lang);
  const template = `${text.slice(0, quoted.index)}«»${text.slice(quoted.index + quoted[0].length)}`;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return isSafeText(template.replace(/\s+/g, ' ').trim()) ? trimmed : TEXTS[lang].working;
}
