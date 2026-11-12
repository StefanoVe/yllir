// Plain-language strings of the chat: activity sentences, turn messages and the
// campaign language lookup. Everything shown to the master is here, in it and en.
// Owner: chat engineer.
import fs from 'node:fs';
import path from 'node:path';

export type Lang = 'it' | 'en';

export interface ChatTexts {
  queued: string;
  preparing: string;
  reading: string;
  searching: string;
  drafting: string;
  checking: string;
  saving: string;
  preparingDocs: string;
  opening: string;
  working: string;
  reviewing: string;
  idleTimeout: string;
  hardLimit: string;
  stopped: string;
  authFailed: string;
  tooLong: string;
  genericError: string;
  noClaudeCode: string;
  notRunning: string;
  closing: string;
  invalidText: string;
  unavailable: string;
  noSuchTurn: string;
}

export const TEXTS: Record<Lang, ChatTexts> = {
  it: {
    queued: 'In attesa che finisca il messaggio precedente…',
    preparing: 'Sto preparando la risposta…',
    reading: 'Sto leggendo un documento…',
    searching: 'Sto cercando nei documenti…',
    drafting: 'Sto scrivendo una bozza…',
    checking: 'Sto controllando i collegamenti…',
    saving: 'Sto salvando le modifiche…',
    preparingDocs: 'Sto preparando i documenti…',
    opening: 'Sto aprendo un documento…',
    working: 'Sto lavorando…',
    reviewing: 'Sto controllando le bozze…',
    idleTimeout: 'L’assistente non ha risposto per troppo tempo. Riprova.',
    hardLimit: 'La richiesta ha richiesto troppo tempo. Riprova con una richiesta più piccola.',
    stopped: 'L’assistente si è fermato prima di finire. Riprova.',
    authFailed: 'Claude non è autenticato su questo computer. Apri Claude Code e accedi, poi riprova.',
    tooLong: 'La richiesta è troppo lunga per essere completata in un solo passo. Riprova con una richiesta più piccola.',
    genericError: 'L’assistente non è riuscito a completare la richiesta. Riprova.',
    noClaudeCode: 'Claude Code non è installato su questo computer',
    notRunning: 'Nessuna risposta è in corso con questo numero.',
    closing: 'Lo schermo si sta chiudendo. Riapri la campagna per scrivere di nuovo.',
    invalidText: 'Scrivi un messaggio di almeno un carattere, fino a 8000.',
    unavailable: 'L’assistente non è disponibile in questo momento.',
    noSuchTurn: 'Questa risposta non esiste.',
  },
  en: {
    queued: 'Waiting for the previous message to finish…',
    preparing: 'Preparing the answer…',
    reading: 'Reading a document…',
    searching: 'Searching the documents…',
    drafting: 'Writing a draft…',
    checking: 'Checking the links…',
    saving: 'Saving the changes…',
    preparingDocs: 'Preparing the documents…',
    opening: 'Opening a document…',
    working: 'Working…',
    reviewing: 'Checking the drafts…',
    idleTimeout: 'The assistant did not answer for too long. Try again.',
    hardLimit: 'The request took too long. Try again with a smaller request.',
    stopped: 'The assistant stopped before finishing. Try again.',
    authFailed: 'Claude is not signed in on this computer. Open Claude Code and sign in, then try again.',
    tooLong: 'The request is too long to finish in one step. Try again with a smaller request.',
    genericError: 'The assistant could not complete the request. Try again.',
    noClaudeCode: 'Claude Code is not installed on this computer',
    notRunning: 'No answer is running with this number.',
    closing: 'The screen is closing. Open the campaign again to write.',
    invalidText: 'Write a message of at least one character, up to 8000.',
    unavailable: 'The assistant is not available right now.',
    noSuchTurn: 'This answer does not exist.',
  },
};

/** Maps a campaign language code to a supported language; anything else is English. */
export function langOf(code: string | undefined): Lang {
  return code === 'it' ? 'it' : 'en';
}

/**
 * Reads `language.main` from campaign.yaml without a YAML parser: the chat only needs
 * to know it/en for its sentences. Synchronous and never throws.
 */
export function campaignLanguage(campaignRoot: string): Lang {
  try {
    const raw = fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8');
    const lines = raw.split(/\r?\n/);
    const start = lines.findIndex((line) => /^language:\s*$/.test(line));
    if (start === -1) return 'en';
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      if (!/^\s/.test(line)) break;
      const match = /^\s+main:\s*["']?([A-Za-z-]+)/.exec(line);
      if (match) return langOf(match[1].toLowerCase());
    }
  } catch {
    // no readable campaign.yaml: English
  }
  return 'en';
}
