// Plain-language sentences of the print routes, in it and en. Owner: master-screen server.
import type { Lang } from '../chat/text.js';

export interface PrintTexts {
  notEnabled: string;
  readFailed: string;
  stateFailed: string;
  renderFailed: string;
  photoshop: string;
  sheetsFailed: string;
  invalid: string;
  notFound: string;
  timedOut: string;
  warningGeneric: string;
  reasonGeneric: string;
  /** The framework's reason codes (its `error` field), as sentences. */
  reasons: Record<string, string>;
}

export const PRINT_TEXTS: Record<Lang, PrintTexts> = {
  en: {
    notEnabled: 'Printing is not turned on for this campaign.',
    readFailed: 'The print list could not be read. Try again.',
    stateFailed: 'The card could not be updated. Try again.',
    renderFailed: 'The card image could not be made. Try again.',
    photoshop: 'Cards with Photoshop are made by the assistant; ask it in the chat.',
    sheetsFailed: 'The sheets could not be made. Try again.',
    invalid: 'Some of the information is not valid. Check it and try again.',
    notFound: 'This file does not exist.',
    timedOut: 'That took too long. Try again.',
    warningGeneric: 'Something needs a look.',
    reasonGeneric: 'This card was left out.',
    reasons: {
      'not-found': 'That card does not exist.',
      exists: 'The card image already exists.',
      'duplicate-id': 'Two cards have the same id.',
      'retired-id': 'That card has been retired and cannot be printed.',
      'master-only-category': 'That card is master-only and cannot be printed.',
      'no-public-text': 'That card has no public text to print yet.',
      'invalid-id': 'That card cannot be printed: its id is missing or not valid.',
      'no-id': 'That card cannot be printed: its id is missing or not valid.',
    },
  },
  it: {
    notEnabled: 'La stampa non è attiva per questa campagna.',
    readFailed: 'Non riesco a leggere l’elenco delle schede da stampare. Riprova.',
    stateFailed: 'La scheda non è stata aggiornata. Riprova.',
    renderFailed: 'L’immagine della scheda non è stata creata. Riprova.',
    photoshop: 'Le schede con Photoshop le prepara l’assistente: chiediglielo in chat.',
    sheetsFailed: 'I fogli non sono stati creati. Riprova.',
    invalid: 'Alcune informazioni non sono valide. Controllale e riprova.',
    notFound: 'Questo file non esiste.',
    timedOut: 'Ci è voluto troppo tempo. Riprova.',
    warningGeneric: 'Qualcosa va controllato.',
    reasonGeneric: 'Questa scheda è stata esclusa.',
    reasons: {
      'not-found': 'Questa scheda non esiste.',
      exists: 'L’immagine della scheda esiste già.',
      'duplicate-id': 'Due schede hanno lo stesso identificativo.',
      'retired-id': 'Questa scheda è stata ritirata e non può essere stampata.',
      'master-only-category': 'Questa scheda è riservata al master e non può essere stampata.',
      'no-public-text': 'Questa scheda non ha ancora un testo pubblico da stampare.',
      'invalid-id': 'Questa scheda non può essere stampata: l’identificativo manca o non è valido.',
      'no-id': 'Questa scheda non può essere stampata: l’identificativo manca o non è valido.',
    },
  },
};
