// Plain-language texts of the live session routes, in the campaign language (it or en).
// Owner: live engineer. No code words here: no paths, no ids, no store words.
import type { Lang } from '../chat/text.js';

export interface LiveTexts {
  libMissing: string;
  invalid: string;
  boardConflict: string;
  failed: string;
  unreadable: string;
  emptyPatch: string;
  /** Known domain error codes of the framework libraries, mapped to sentences. */
  codes: Record<string, string>;
}

const unreadable = 'The live session could not be read. Try again.';
const unreadableIt = 'Non riesco a leggere la sessione dal vivo. Riprova.';

const EN: LiveTexts = {
  libMissing: 'This version of Yllir does not support live sessions yet.',
  invalid: 'Some of the information is not valid. Check it and try again.',
  boardConflict:
    'The board was changed somewhere else in the meantime. Look at the board as it is now and try again.',
  failed: 'The live session could not be updated. Try again.',
  unreadable: 'The live session could not be read. Try again.',
  emptyPatch: 'There is nothing to change.',
  codes: {
    'already-open': 'A session is already open. End it before opening another one.',
    'no-live-session': 'No session is open right now. Open one first.',
    'unknown-condition': 'That condition does not exist in this game system.',
    'already-active': 'A combat is already running.',
    'invalid-state': 'The combat is not in the right state for that.',
    'no-combat': 'No combat is running.',
    'bad-sheet': 'That sheet does not exist or cannot be used here.',
    validation: 'Some of the information is not valid. Check it and try again.',
    'not-found': 'That entry does not exist any more.',
    'entry-not-found': 'That entry does not exist any more.',
    'no-active-session': 'No session is open right now. Open one first.',
    'no-session': 'No session is open right now. Open one first.',
    'session-not-found': 'That session does not exist.',
    'no-adapter': 'The game rules are not set for this campaign yet.',
    'encounter-unavailable': 'The combat rules cannot be used right now.',
    'not-a-campaign': 'This folder is not a campaign.',
    'corrupt-state': unreadable,
    'read-failed': unreadable,
    unreadable,
    'write-failed': 'The live session could not be saved. Try again.',
    'bad-op': 'Some of the information is not valid. Check it and try again.',
    'invalid-id': 'Some of the information is not valid. Check it and try again.',
    'invalid-text': 'Some of the information is not valid. Check it and try again.',
    'invalid-kind': 'Some of the information is not valid. Check it and try again.',
    'invalid-patch': 'Some of the information is not valid. Check it and try again.',
    'invalid-scene': 'Some of the information is not valid. Check it and try again.',
    'invalid-subjects': 'Some of the information is not valid. Check it and try again.',
    'invalid-title': 'Some of the information is not valid. Check it and try again.',
    'invalid-by': 'Some of the information is not valid. Check it and try again.',
    'invalid-resolved': 'Some of the information is not valid. Check it and try again.',
    'invalid-session-ref': 'Some of the information is not valid. Check it and try again.',
    'invalid-session-id': 'Some of the information is not valid. Check it and try again.',
    'resolved-not-thread': 'Only an open thread can be marked as resolved.',
  },
};

const IT: LiveTexts = {
  libMissing: 'Questa versione di Yllir non supporta ancora le sessioni dal vivo.',
  invalid: 'Alcune informazioni non sono valide. Controllale e riprova.',
  boardConflict:
    'Il tabellone è stato modificato nel frattempo. Guardalo com\'è ora e riprova.',
  failed: 'Non è stato possibile aggiornare la sessione dal vivo. Riprova.',
  unreadable: 'Non riesco a leggere la sessione dal vivo. Riprova.',
  emptyPatch: 'Non c\'è nulla da cambiare.',
  codes: {
    'already-open': 'C\'è già una sessione aperta. Chiudila prima di aprirne un\'altra.',
    'no-live-session': 'Nessuna sessione è aperta in questo momento. Aprine una prima.',
    'unknown-condition': 'Questa condizione non esiste nel sistema di gioco.',
    'already-active': 'Un combattimento è già in corso.',
    'invalid-state': 'Il combattimento non è nello stato giusto per questa azione.',
    'no-combat': 'Nessun combattimento è in corso.',
    'bad-sheet': 'Questa scheda non esiste o non si può usare qui.',
    validation: 'Alcune informazioni non sono valide. Controllale e riprova.',
    'not-found': 'Questa voce non esiste più.',
    'entry-not-found': 'Questa voce non esiste più.',
    'no-active-session': 'Nessuna sessione è aperta in questo momento. Aprine una prima.',
    'no-session': 'Nessuna sessione è aperta in questo momento. Aprine una prima.',
    'session-not-found': 'Questa sessione non esiste.',
    'no-adapter': 'Le regole del gioco non sono ancora impostate per questa campagna.',
    'encounter-unavailable': 'Le regole del combattimento non si possono usare in questo momento.',
    'not-a-campaign': 'Questa cartella non è una campagna.',
    'corrupt-state': unreadableIt,
    'read-failed': unreadableIt,
    unreadable: unreadableIt,
    'write-failed': 'La sessione dal vivo non si è potuta salvare. Riprova.',
    'bad-op': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-id': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-text': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-kind': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-patch': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-scene': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-subjects': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-title': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-by': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-resolved': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-session-ref': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'invalid-session-id': 'Alcune informazioni non sono valide. Controllale e riprova.',
    'resolved-not-thread': 'Si può segnare come risolto solo un filo aperto.',
  },
};

export function liveTexts(lang: Lang): LiveTexts {
  return lang === 'it' ? IT : EN;
}
