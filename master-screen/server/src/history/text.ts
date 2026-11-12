// Plain-language texts of the history module, in the campaign language (it or en).
// Owner: history engineer. No git words here.

export type Lang = 'it' | 'en';

export interface Messages {
  nothingToUndo: string;
  notFound: string;
  alreadyUndone: string;
  undoOfUndo: string;
  dirty: string;
  conflict: string;
  failed: string;
  unreadable: string;
  badId: string;
  done(summary: string): string;
  undone(summary: string): string;
  changedDocs(count: number): string;
}

const EN: Messages = {
  nothingToUndo: 'There is no change left to undo.',
  notFound: 'That change is not in the history any more.',
  alreadyUndone: 'That change has already been undone.',
  undoOfUndo: 'That entry is an undo. Choose the change it undid instead.',
  dirty:
    'There are edits in progress that are not saved yet. Finish or save them, then try again.',
  conflict:
    'This change cannot be undone safely, because later changes depend on it. Nothing was changed.',
  failed: 'The change could not be undone. Nothing was changed.',
  unreadable: 'The change history could not be read. Try again.',
  badId: 'That change does not exist.',
  done: (summary) => `Undone: ${summary}`,
  undone: (summary) => `Undone: ${summary}`,
  changedDocs: (count) => (count === 1 ? 'Changed 1 document' : `Changed ${count} documents`),
};

const IT: Messages = {
  nothingToUndo: 'Non c\'è nessuna modifica da annullare.',
  notFound: 'Questa modifica non è più nello storico.',
  alreadyUndone: 'Questa modifica è già stata annullata.',
  undoOfUndo: 'Questa voce è un annullamento: scegli la modifica che ha annullato.',
  dirty:
    'Ci sono modifiche in corso non ancora salvate. Completale o salvale, poi riprova.',
  conflict:
    'Questa modifica non si può annullare senza danni, perché modifiche successive dipendono da lei. Non è cambiato nulla.',
  failed: 'La modifica non si è potuta annullare. Non è cambiato nulla.',
  unreadable: 'Non riesco a leggere lo storico delle modifiche. Riprova.',
  badId: 'Questa modifica non esiste.',
  done: (summary) => `Annullato: ${summary}`,
  undone: (summary) => `Annullato: ${summary}`,
  changedDocs: (count) => (count === 1 ? 'Modificato 1 documento' : `Modificati ${count} documenti`),
};

/** The campaign language code from campaign.yaml, reduced to the two supported languages. */
export function langOf(code: string): Lang {
  return /^it\b/i.test(code.trim()) ? 'it' : 'en';
}

export function messages(lang: Lang): Messages {
  return lang === 'it' ? IT : EN;
}
