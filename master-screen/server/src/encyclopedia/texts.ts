// Plain-language sentences of the encyclopedia and print routes, in it and en.
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
    notEnabled: 'The encyclopedia is not turned on for this campaign.',
    readFailed: 'The encyclopedia status could not be read. Try again.',
    buildFailed: 'The encyclopedia could not be built. Try again.',
    checkFailed: 'The site was not built because a check did not pass: ',
    checkGeneric: 'one of the checks did not pass',
    timedOut: 'The build took too long. Try again.',
    noSite: 'The encyclopedia has not been built yet. Build it first.',
    notFound: 'This page does not exist.',
  },
  it: {
    notEnabled: 'L’enciclopedia non è attiva per questa campagna.',
    readFailed: 'Non riesco a leggere lo stato dell’enciclopedia. Riprova.',
    buildFailed: 'Non sono riuscito a generare l’enciclopedia. Riprova.',
    checkFailed: 'Il sito non è stato generato perché un controllo non è passato: ',
    checkGeneric: 'uno dei controlli non è passato',
    timedOut: 'La generazione ha impiegato troppo tempo. Riprova.',
    noSite: 'L’enciclopedia non è ancora stata generata. Generala prima.',
    notFound: 'Questa pagina non esiste.',
  },
};
