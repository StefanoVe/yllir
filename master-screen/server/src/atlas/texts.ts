// Plain-language sentences of the atlas, and the fixed prompts the assistant gets for it.
// The prompts are English (the framework's language); the assistant answers the master in the
// campaign language. Owner: master-screen server.
import type { Lang } from '../chat/text.js';

export interface AtlasTexts {
  alreadyRunning: string;
  alreadyExists: string;
  noAtlas: string;
  startFailed: string;
  readFailed: string;
  redrawFailed: string;
  redrawBusy: string;
  invalidMode: string;
  noSite: string;
  notFound: string;
}

export const ATLAS_TEXTS: Record<Lang, AtlasTexts> = {
  en: {
    alreadyRunning: 'The atlas is already being prepared.',
    alreadyExists: 'The campaign already has an atlas.',
    noAtlas: 'The campaign has no atlas yet.',
    startFailed: 'The atlas could not be started. Nothing was changed.',
    readFailed: 'The atlas status could not be read. Try again.',
    redrawFailed: 'The map could not be drawn. Try again.',
    redrawBusy: 'The atlas is being prepared. Wait until it is done, then redraw.',
    invalidMode: 'The atlas request is not valid.',
    noSite: 'The atlas has not been drawn yet.',
    notFound: 'There is no such file in the atlas.',
  },
  it: {
    alreadyRunning: "L'atlante è già in preparazione.",
    alreadyExists: "La campagna ha già un atlante.",
    noAtlas: "La campagna non ha ancora un atlante.",
    startFailed: "L'atlante non è potuto partire. Non è cambiato nulla.",
    readFailed: "Non è stato possibile leggere lo stato dell'atlante. Riprova.",
    redrawFailed: 'La mappa non è stata disegnata. Riprova.',
    redrawBusy: "L'atlante è in preparazione. Aspetta che finisca, poi ridisegna.",
    invalidMode: "La richiesta dell'atlante non è valida.",
    noSite: "L'atlante non è ancora stato disegnato.",
    notFound: "In questo atlante non c'è questo file.",
  },
};

/** The fixed prompt of each mode. Its first line is the title of the conversation. */
export const ATLAS_PROMPTS = {
  create: [
    'Campaign atlas.',
    '',
    'This conversation runs inside the master screen: the master sees the previews and the atlas there, so never use --open.',
    'Invoke the skill yllir:atlas now, with no argument, and follow it to create the atlas of this campaign. Ask the master every question one at a time and wait for the answer. Write every sentence to the master in the campaign language set in campaign.yaml.',
  ].join('\n'),
  update: [
    'Campaign atlas: new places.',
    '',
    'This conversation runs inside the master screen: the master sees the previews and the atlas there, so never use --open.',
    'Invoke the skill yllir:atlas now, with no argument, and follow its Step 8 to place on the atlas the places that are not on it yet. Ask the master only what the documents cannot tell. Write every sentence to the master in the campaign language set in campaign.yaml.',
  ].join('\n'),
} as const;
