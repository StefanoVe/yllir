// Safety net for the final answer of a turn: drops a leading line of intermediate narration
// that the model may still put before the real answer. Owner: chat engineer.

const LEADING_NARRATION = /^(Pending migration|Post-update|Migration)\b[^\n]*\n+/i;

/** The answer without a leading narration line such as "Pending migration: read x.md." */
export function stripLeadingNarration(text: string): string {
  return text.replace(LEADING_NARRATION, '');
}
