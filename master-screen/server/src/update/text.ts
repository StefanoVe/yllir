// Plain-language refusals of the update actions, in the campaign language. Owner: update engineer.
import type { Lang } from '../chat/text.js';

export interface UpdateTexts {
  alreadyRunning: string;
  offline: string;
  noUpdate: string;
  checkFirst: string;
  /** The 409 when open sessions must be confirmed before the update closes them. */
  confirmClose: string;
  /** The title of a chat conversation that has no title yet. */
  chatTitle: string;
}

export const UPDATE_TEXTS: Record<Lang, UpdateTexts> = {
  en: {
    alreadyRunning: 'An update is already running.',
    offline: 'The update cannot be checked right now. Check your connection and try again.',
    noUpdate: 'There is no update to apply right now.',
    checkFirst: 'The last update did not work. Check for updates again first.',
    confirmClose: 'The update will close the open sessions: confirm to continue.',
    chatTitle: 'Chat',
  },
  it: {
    alreadyRunning: "Un aggiornamento è già in corso.",
    offline: 'Non riesco a controllare gli aggiornamenti in questo momento. Controlla la connessione e riprova.',
    noUpdate: 'Al momento non c\'è nessun aggiornamento da applicare.',
    checkFirst: "L'ultimo aggiornamento non è riuscito. Controlla di nuovo gli aggiornamenti.",
    confirmClose: "L'aggiornamento chiuderà le sessioni aperte: conferma per continuare.",
    chatTitle: 'Chat',
  },
};
