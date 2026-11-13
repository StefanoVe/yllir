// Plain-language sentences of the campaign alignment, and the fixed prompt the assistant gets for it.
// The prompt is English (the framework's language); the assistant answers the master in the campaign
// language. Owner: update engineer.
import type { Lang } from '../chat/text.js';

export interface AlignTexts {
  notNeeded: string;
  alreadyRunning: string;
  alignBusy: string;
  startFailed: string;
}

export const ALIGN_TEXTS: Record<Lang, AlignTexts> = {
  en: {
    notNeeded: 'The campaign is already aligned with the assistant. There is nothing to do.',
    alreadyRunning: 'The campaign alignment is already running.',
    alignBusy: 'The campaign is being aligned with the assistant. Wait until it is done, then update.',
    startFailed: 'The campaign alignment could not be started. Nothing was changed.',
  },
  it: {
    notNeeded: "La campagna è già allineata con l'assistente. Non c'è niente da fare.",
    alreadyRunning: "L'allineamento della campagna è già in corso.",
    alignBusy: "La campagna si sta allineando con l'assistente. Aspetta che finisca, poi aggiorna.",
    startFailed: "L'allineamento della campagna non è potuto partire. Non è cambiato nulla.",
  },
};

/** The model the alignment turn runs with. */
export const ALIGN_MODEL = 'sonnet' as const;

/**
 * The one prompt of every alignment run. Its first line is the title of the conversation
 * (the chat takes the title from the first master message).
 */
export const ALIGN_PROMPT = [
  'Campaign alignment after a framework update.',
  '',
  'Invoke the skill yllir:update now. For this campaign only, follow its Part A (campaign alignment) and then its "Sheet format follow-up" (the post-update steps), exactly as the skill describes them.',
  'Write every sentence to the master in the campaign language set in campaign.yaml, and use only the words of the lexicon.',
  'If the skill says that an earlier update was not finished, offer the two choices (continue the update, or go back to how it was) as one question, and wait for the answer.',
  'Ask the master at most one precise question at a time, and only when a step cannot go on without the answer. Do not repeat a question the master has already answered.',
  'Do not take on any other task. Do not answer requests that are not about this alignment: say that they can be asked once the alignment is finished.',
  'Do not do Part B of the update skill (the update notice).',
  'When everything is aligned, say so in one sentence.',
].join('\n');
