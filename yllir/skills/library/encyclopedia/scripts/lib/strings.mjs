// Words the encyclopedia shows to visitors and words the report gives to the master,
// in the campaign language (it or en; anything else falls back to en).

const SITE = {
  it: {
    title: 'Enciclopedia',
    search: 'Filtra le voci',
    searchHint: 'Scrivi un nome o una parola',
    count: (n) => (n === 1 ? '1 voce' : `${n} voci`),
    noResults: 'Nessuna voce corrisponde.',
    empty: 'Non ci sono ancora voci pubbliche.',
    home: 'Indice',
    skip: 'Vai al contenuto',
    notFound: 'Pagina non trovata',
    notFoundText: 'Questa pagina non esiste.',
    redirected: 'Questa voce è stata unita a',
    gone: 'Questa voce non è più disponibile.',
    lockedNote: 'Questo testo è protetto da un codice.',
    noScript: 'Per leggere il testo protetto serve un browser con JavaScript.',
    codeLabel: 'Codice',
    unlock: 'Sblocca',
    wrongCode: 'Codice non valido.',
    noCrypto: 'Questo browser non può verificare il codice.',
    unlockedOk: 'Testo sbloccato.',
    filterDone: (n) => (n === 1 ? '1 voce mostrata' : `${n} voci mostrate`),
    filterNone: 'Nessuna voce corrisponde.',
  },
  en: {
    title: 'Encyclopedia',
    search: 'Filter entries',
    searchHint: 'Type a name or a word',
    count: (n) => (n === 1 ? '1 entry' : `${n} entries`),
    noResults: 'No entry matches.',
    empty: 'There are no public entries yet.',
    home: 'Index',
    skip: 'Skip to content',
    notFound: 'Page not found',
    notFoundText: 'This page does not exist.',
    redirected: 'This entry has been merged into',
    gone: 'This entry is no longer available.',
    lockedNote: 'This text is protected by a code.',
    noScript: 'Reading the protected text needs a browser with JavaScript.',
    codeLabel: 'Code',
    unlock: 'Unlock',
    wrongCode: 'The code is not valid.',
    noCrypto: 'This browser cannot check the code.',
    unlockedOk: 'Text unlocked.',
    filterDone: (n) => (n === 1 ? '1 entry shown' : `${n} entries shown`),
    filterNone: 'No entry matches.',
  },
};

const REPORT = {
  it: {
    'module-off': 'Il modulo enciclopedia è disattivato nelle impostazioni della campagna.',
    'config-invalid': 'Le impostazioni della campagna (campaign.yaml) hanno errori: vanno corrette prima di costruire l’enciclopedia.',
    'config-missing': 'Non riesco a leggere le impostazioni della campagna.',
    'build-error': 'La costruzione si è interrotta per un errore interno. La versione precedente è rimasta com’era.',
    reasonPrivateFolder: 'cartella privata: non esce mai',
    reasonMasterCategory: 'categoria riservata al master',
    reasonSeed: 'semi del mondo: riservato',
    reasonExternal: 'documenti di un’altra campagna',
    reasonNoMetadata: 'senza metadati',
    reasonNoId: 'senza id: non ha un indirizzo stabile',
    reasonInvalidId: 'id non valido: usa solo lettere minuscole, cifre e trattini',
    reasonDuplicateId: 'id già usato da un’altra scheda',
    reasonPublicFalse: 'segnata come non pubblica',
    reasonSketch: 'abbozzo: non ancora pubblicabile',
    reasonDraft: 'bozza',
    reasonNoPublicText: 'nessun testo pubblico: non esce né il titolo né il testo',
    reasonNoPublicTitle: 'nessun titolo pubblico (manca il titolo di primo livello nella parte pubblica)',
    reasonUnreadable: 'file non leggibile',
    imageSkipped: (src, why) => `immagine non copiata (${src}): ${why}`,
    imageMissing: (src) => `immagine non trovata: ${src}`,
    imageUnsupported: (src) => `formato non supportato, non copiata: ${src}`,
    imagePrivate: (src) => `immagine in una cartella privata, non copiata: ${src}`,
    retiredSkipped: (id) => `id ritirato ${id} non mostrato: coincide con una voce esistente`,
    mergedSkipped: (id) => `id unito ${id} non reindirizzato: coincide con una voce esistente`,
    mergedDuplicate: (id) => `id unito ${id} indicato da più schede: reindirizzamento non creato`,
    duplicateIdPath: 'Due schede hanno lo stesso id: nessuna delle due è pubblicata.',
  },
  en: {
    'module-off': 'The encyclopedia module is switched off in the campaign settings.',
    'config-invalid': 'The campaign settings (campaign.yaml) have errors: fix them before building the encyclopedia.',
    'config-missing': 'The campaign settings cannot be read.',
    'build-error': 'The build stopped on an internal error. The previous version was left as it was.',
    reasonPrivateFolder: 'private folder: never published',
    reasonMasterCategory: 'category kept for the master',
    reasonSeed: 'world seed: kept for the master',
    reasonExternal: 'documents of another campaign',
    reasonNoMetadata: 'no metadata',
    reasonNoId: 'no id: it has no stable address',
    reasonInvalidId: 'invalid id: use only lowercase letters, digits and hyphens',
    reasonDuplicateId: 'id already used by another entry',
    reasonPublicFalse: 'marked as not public',
    reasonSketch: 'sketch: not ready to publish',
    reasonDraft: 'draft',
    reasonNoPublicText: 'no public text: neither the title nor the text goes out',
    reasonNoPublicTitle: 'no public title (no top-level heading in the public part)',
    reasonUnreadable: 'file cannot be read',
    imageSkipped: (src, why) => `image not copied (${src}): ${why}`,
    imageMissing: (src) => `image not found: ${src}`,
    imageUnsupported: (src) => `unsupported format, not copied: ${src}`,
    imagePrivate: (src) => `image in a private folder, not copied: ${src}`,
    retiredSkipped: (id) => `retired id ${id} not shown: it matches an existing entry`,
    mergedSkipped: (id) => `merged id ${id} not redirected: it matches an existing entry`,
    mergedDuplicate: (id) => `merged id ${id} listed by more than one entry: no redirect made`,
    duplicateIdPath: 'Two sheets have the same id: neither is published.',
  },
};

const CHECKS = {
  it: {
    'no-reserved-text': {
      ok: 'Nessun testo riservato compare nei file generati.',
      fail: (n) => `Ho trovato ${n} frasi riservate nei file generati: non è stato pubblicato nulla. Togli dalla parte pubblica le frasi che la rivelano.`,
    },
    'no-private-folders': {
      ok: 'Nessun file delle cartelle private è incluso.',
      fail: 'Un file di una cartella privata è finito nell’enciclopedia: non è stato costruito nulla.',
    },
    'no-secret-shapes': {
      ok: 'Nessuna forma di chiave o segreto nei file generati.',
      fail: (n) => `Ho trovato ${n} cose che sembrano una chiave o un segreto nei file generati. Non è stato costruito nulla: togli quel testo dalla campagna.`,
    },
    'no-image-metadata': {
      ok: 'Le immagini copiate non hanno dati di posizione o di persone.',
      fail: (n) => `${n} immagini contengono ancora dati nascosti (per esempio posizione o autore). Esportale di nuovo senza quei dati.`,
    },
    'no-master-links': {
      ok: 'Nessun collegamento punta a una nota riservata.',
      fail: 'Un collegamento punta a una nota riservata: non è stato costruito nulla.',
    },
    'locked-codes': {
      ok: 'Ogni testo protetto ha il suo codice nella parte riservata.',
      fail: (list) => `Questi testi protetti non sono pronti: ${list}. Controlla il codice nella parte riservata della scheda.`,
      short: 'il codice è troppo corto (almeno 4 caratteri)',
      missing: (label) => `il blocco «${label}» non ha un codice nella parte riservata`,
      codeInText: (label) => `il codice del blocco «${label}» compare nei testi pubblici: cambialo`,
    },
    'locked-roundtrip': {
      ok: 'La prova di sblocco dei testi protetti è riuscita.',
      fail: 'La prova di sblocco dei testi protetti non è riuscita: non è stato costruito nulla.',
    },
    'real-player-names': {
      skipped: 'Nessun elenco di nomi di giocatori è configurato: il controllo non è stato eseguito.',
    },
    'no-player-references': {
      skipped: 'Il controllo dei riferimenti ai giocatori non è ancora disponibile: non è stato eseguito.',
    },
    'change-summary': {
      ok: 'Confronto con la versione precedente fatto.',
      first: 'Prima versione: nessun confronto con quella precedente.',
      diff: (a, r, c) => `Rispetto alla versione precedente: ${a} voci nuove, ${r} rimosse, ${c} cambiate.`,
    },
  },
  en: {
    'no-reserved-text': {
      ok: 'No reserved text appears in the generated files.',
      fail: (n) => `Found ${n} reserved sentences in the generated files: nothing was published. Remove from the public part the sentences that reveal them.`,
    },
    'no-private-folders': {
      ok: 'No file from a private folder is included.',
      fail: 'A file from a private folder reached the encyclopedia: nothing was built.',
    },
    'no-secret-shapes': {
      ok: 'No key or secret shape in the generated files.',
      fail: (n) => `Found ${n} things that look like a key or a secret in the generated files. Nothing was built: remove that text from the campaign.`,
    },
    'no-image-metadata': {
      ok: 'The copied pictures carry no location or person data.',
      fail: (n) => `${n} pictures still carry hidden data (for example location or author). Export them again without that data.`,
    },
    'no-master-links': {
      ok: 'No link points to a reserved note.',
      fail: 'A link points to a reserved note: nothing was built.',
    },
    'locked-codes': {
      ok: 'Every locked text has its code in the reserved part.',
      fail: (list) => `These locked texts are not ready: ${list}. Check the code in the reserved part of the sheet.`,
      short: 'the code is too short (at least 4 characters)',
      missing: (label) => `the block «${label}» has no code in the reserved part`,
      codeInText: (label) => `the code of the block «${label}» appears in public texts: change it`,
    },
    'locked-roundtrip': {
      ok: 'The unlock test of the locked texts passed.',
      fail: 'The unlock test of the locked texts failed: nothing was built.',
    },
    'real-player-names': {
      skipped: 'No list of player names is configured: the check was not run.',
    },
    'no-player-references': {
      skipped: 'The check of references to players is not available yet: it was not run.',
    },
    'change-summary': {
      ok: 'Comparison with the previous version done.',
      first: 'First version: nothing to compare with.',
      diff: (a, r, c) => `Compared with the previous version: ${a} new entries, ${r} removed, ${c} changed.`,
    },
  },
};

/** Language code to use for a campaign: it or en. */
export function langOf(code) {
  return code === 'it' ? 'it' : 'en';
}

export function siteText(lang) {
  return SITE[langOf(lang)];
}

export function reportText(lang) {
  return REPORT[langOf(lang)];
}

export function checkText(lang) {
  return CHECKS[langOf(lang)];
}
