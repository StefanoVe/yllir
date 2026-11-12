// Turns a tool use of the agent into one plain-language sentence for the master, and
// makes sure no activity text ever carries a tool name, a path or a technical word.
// Owner: chat engineer.
import type { Lang } from './text.js';
import { TEXTS } from './text.js';

const MUSIC_SENTENCE: Record<Lang, string> = {
  it: 'Sto cercando della musica…',
  en: 'Looking for music…',
};

const ENGINE_CALL = /engine\.mjs"?\s+([a-z-]+)/;
const CHECK_COMMANDS = new Set(['index', 'query', 'check']);
const SAVE_COMMANDS = new Set(['commit', 'undo', 'revert']);

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

/**
 * The sentence for one tool use, or null when the tool has no visible meaning.
 * `input` is the tool input as the SDK reports it; only its shape is read here.
 */
export function toolActivity(name: string, input: Record<string, unknown>, lang: Lang): string | null {
  const t = TEXTS[lang];
  switch (name) {
    case 'Read':
      return t.reading;
    case 'Glob':
    case 'Grep':
    case 'mcp__yllir__search_docs':
      return t.searching;
    case 'Write':
    case 'Edit':
      return t.drafting;
    case 'Skill':
      return t.preparing;
    case 'mcp__yllir__open_document':
      return t.opening;
    case 'Task':
    case 'Agent':
      return t.reviewing;
    case 'mcp__yllir__suggest_music':
      return MUSIC_SENTENCE[lang];
    case 'Bash': {
      const match = ENGINE_CALL.exec(stringField(input, 'command'));
      if (!match) return t.working;
      const command = match[1];
      if (SAVE_COMMANDS.has(command)) return t.saving;
      if (CHECK_COMMANDS.has(command)) return t.checking;
      return t.preparingDocs;
    }
    default:
      return null;
  }
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

/**
 * Keeps an activity sentence safe: a text with a path, a tool name or a technical word
 * is replaced by the generic sentence of the language.
 */
export function safeActivity(text: string, lang: Lang): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > 160 || FORBIDDEN.test(trimmed)) return TEXTS[lang].working;
  return trimmed;
}
