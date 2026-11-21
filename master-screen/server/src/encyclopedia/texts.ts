// Plain-language sentences of the encyclopedia routes, in it and en.
// Owner: master-screen server. No paths, no code words.
import type { Lang } from '../chat/text.js';

export interface EncyclopediaTexts {
  notEnabled: string;
  readFailed: string;
  buildFailed: string;
  checkFailed: string;
  checkGeneric: string;
  timedOut: string;
  noSite: string;
  notFound: string;
}

export const ENCYCLOPEDIA_TEXTS: Record<Lang, EncyclopediaTexts> = {
  en: {
    notEnabled: 'The Codex is not turned on for this campaign.',
    readFailed: 'The Codex status could not be read. Try again.',
    buildFailed: 'The Codex could not be built. Try again.',
    checkFailed: 'The site was not built because a check did not pass: ',
    checkGeneric: 'one of the checks did not pass',
    timedOut: 'The build took too long. Try again.',
    noSite: 'The Codex has not been built yet. Build it first.',
    notFound: 'This page does not exist.',
  },
  it: {
    notEnabled: 'Il Codex non è attivo per questa campagna.',
    readFailed: 'Non riesco a leggere lo stato del Codex. Riprova.',
    buildFailed: 'Non sono riuscito a generare il Codex. Riprova.',
    checkFailed: 'Il sito non è stato generato perché un controllo non è passato: ',
    checkGeneric: 'uno dei controlli non è passato',
    timedOut: 'La generazione ha impiegato troppo tempo. Riprova.',
    noSite: 'Il Codex non è ancora stato generato. Generalo prima.',
    notFound: 'Questa pagina non esiste.',
  },
};
