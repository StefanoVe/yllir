// Plain-language refusals of the update actions, in the campaign language. Owner: update engineer.
import type { Lang } from '../chat/text.js';

export interface UpdateTexts {
  alreadyRunning: string;
  offline: string;
  noUpdate: string;
  checkFirst: string;
  turnRunning: string;
  liveOpen: string;
}

export const UPDATE_TEXTS: Record<Lang, UpdateTexts> = {
  en: {
    alreadyRunning: 'An update is already running.',
    offline: 'The update cannot be checked right now. Check your connection and try again.',
    noUpdate: 'There is no update to apply right now.',
    checkFirst: 'The last update did not work. Check for updates again first.',
    turnRunning: 'The assistant is still answering. Wait for it to finish, then update.',
    liveOpen: 'A live session is open. End it, then update.',
  },
  it: {
    alreadyRunning: "Un aggiornamento è già in corso.",
    offline: 'Non riesco a controllare gli aggiornamenti in questo momento. Controlla la connessione e riprova.',
    noUpdate: 'Al momento non c\'è nessun aggiornamento da applicare.',
    checkFirst: "L'ultimo aggiornamento non è riuscito. Controlla di nuovo gli aggiornamenti.",
    turnRunning: "L'assistente sta ancora rispondendo. Aspetta che finisca, poi aggiorna.",
    liveOpen: 'Una sessione live è aperta. Chiudila, poi aggiorna.',
  },
};
