// Turns a message coming from a framework CLI into a sentence that may be shown to the master.
// Anything that looks like a path, a file name, a code word or a stack trace is replaced by the
// fallback sentence. Owner: master-screen server.

const JARGON = /\b(commit|commits|sha|index|frontmatter|token|provider|canon|stderr|stack|ENOENT|EACCES|EPERM)\b/i;
const PATH_LIKE = /[\\/]|\.(mjs|cjs|js|ts|json|md|yaml|yml|pdf|png)\b/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The message when it is a short plain sentence, else the fallback. Never throws. */
export function plainSentence(message: unknown, fallback: string): string {
  if (typeof message !== 'string') return fallback;
  const text = message.trim();
  if (text === '' || text.length > 300) return fallback;
  if (CONTROL.test(text) || PATH_LIKE.test(text) || JARGON.test(text)) return fallback;
  return text;
}
