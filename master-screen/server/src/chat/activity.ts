// Turns a tool use of the agent into one plain-language sentence for the master, and
// makes sure no activity text ever carries a tool name, a path or a technical word.
// Owner: chat engineer.
import type { Lang } from './text.js';
import { TEXTS } from './text.js';

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
