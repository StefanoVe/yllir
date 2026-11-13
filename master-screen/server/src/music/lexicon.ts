// Data of the music search: stopwords, synonym groups (weight 0.85, a direct match) and vibe
// groups (weight 0.6, a loose match). Words are folded: lowercase, no accents, no punctuation,
// one word per entry. A word may belong to several groups. Owner: music engineer.

/** Words that carry no music meaning. Dropped from every query. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // Italian articles and prepositions
  'il', 'lo', 'la', 'gli', 'le', 'uno', 'una', 'del', 'dello', 'della', 'dei', 'degli', 'delle',
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
  'con', 'per', 'tra', 'fra', 'che', 'chi', 'non', 'piu', 'come', 'dove', 'quando', 'anche', 'ma',
  'sono', 'suo', 'sua', 'loro', 'questo', 'questa', 'quello', 'quella', 'molto',
  // English articles and prepositions
  'the', 'and', 'for', 'with', 'from', 'into', 'you', 'are', 'was', 'its',
  // Words about the music itself
  'musica', 'brano', 'scena', 'traccia', 'ost', 'bgm', 'music', 'track', 'scene',
]);

/** Synonyms, settings and moods. Members of one group match each other at weight 0.85. */
export const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  // Fights
  ['battaglia', 'combattimento', 'scontro', 'lotta', 'duello', 'battle', 'fight', 'boss', 'bossfight'],
  // Places and settings
  ['taverna', 'locanda', 'osteria', 'tavern', 'inn'],
  ['bosco', 'foresta', 'selva', 'forest', 'woods'],
  ['nord', 'north', 'settentrione', 'boreale'],
  ['deserto', 'desert', 'duna', 'sabbia', 'dune'],
  ['citta', 'capitale', 'metropoli', 'city', 'town'],
  ['mare', 'oceano', 'sea', 'ocean'],
  ['porto', 'molo', 'port', 'harbor', 'harbour'],
  ['viaggio', 'strada', 'cammino', 'marcia', 'percorso', 'sentiero', 'travel', 'road', 'journey'],
  ['rovina', 'rovine', 'maceria', 'ruins', 'ruin'],
  ['neve', 'ghiaccio', 'gelo', 'inverno', 'snow', 'ice', 'winter'],
  ['tomba', 'sepolcro', 'cripta', 'cimitero', 'tomb', 'crypt', 'graveyard'],
  ['caverna', 'grotta', 'cave', 'cavern', 'dungeon', 'sotterraneo'],
  ['castello', 'fortezza', 'rocca', 'castle', 'fortress'],
  ['tempio', 'chiesa', 'santuario', 'temple', 'church', 'shrine'],
  ['mercato', 'bazar', 'market', 'bazaar'],
  ['notte', 'night'],
  ['tempesta', 'uragano', 'burrasca', 'storm', 'tempest'],
  ['fuoco', 'fiamme', 'incendio', 'fire', 'flame'],
  ['magia', 'incantesimo', 'arcano', 'magic', 'spell'],
  ['nonmorti', 'zombi', 'scheletri', 'undead', 'zombie'],
  ['montagna', 'monte', 'vetta', 'mountain', 'peak'],
  ['fiume', 'torrente', 'river', 'stream'],
  ['villaggio', 'borgo', 'paese', 'village', 'hamlet'],
  ['palude', 'acquitrino', 'swamp', 'marsh', 'bog'],
  ['pioggia', 'temporale', 'rain'],
  ['palazzo', 'reggia', 'corte', 'palace', 'court'],
  ['biblioteca', 'libreria', 'archivio', 'library'],
  // Moods
  ['tensione', 'suspense', 'ansia', 'tension'],
  ['mistero', 'misterioso', 'enigma', 'mystery', 'mysterious'],
  ['triste', 'malinconia', 'lutto', 'dolore', 'sad', 'sorrow', 'melancholy'],
  ['epico', 'eroico', 'trionfo', 'epic', 'heroic', 'triumph'],
  ['calma', 'quiete', 'serenita', 'riposo', 'peaceful', 'calm', 'serene'],
  ['inquietante', 'spaventoso', 'macabro', 'orrore', 'creepy', 'horror', 'eerie'],
  ['romantico', 'amore', 'romantic', 'love'],
  ['inseguimento', 'fuga', 'chase', 'pursuit', 'escape'],
  ['furtivo', 'nascosto', 'sneak', 'stealth', 'stealthy'],
  ['festa', 'banchetto', 'celebrazione', 'celebration', 'party', 'feast'],
  ['pericolo', 'minaccia', 'danger', 'threat', 'peril'],
  ['meraviglia', 'fiaba', 'incanto', 'wonder', 'fairytale'],
  ['allegria', 'gioia', 'allegro', 'joyful', 'cheerful', 'happy'],
];

/** Loosely related words. Members match each other at weight 0.6 (vibe neighbours). */
export const VIBE_GROUPS: ReadonlyArray<readonly string[]> = [
  ['battaglia', 'tensione', 'pericolo', 'inseguimento', 'epico'],
  ['mistero', 'notte', 'tomba', 'inquietante', 'magia'],
  ['triste', 'pioggia', 'inverno', 'lutto', 'rovina'],
  ['calma', 'bosco', 'fiume', 'villaggio', 'biblioteca'],
  ['meraviglia', 'magia', 'montagna', 'bosco'],
  ['furtivo', 'notte', 'palude', 'mistero'],
  ['festa', 'taverna', 'mercato', 'allegria'],
  ['neve', 'nord', 'montagna', 'inverno'],
  ['mare', 'porto', 'pioggia', 'tempesta'],
  ['rovina', 'tomba', 'nonmorti', 'inquietante'],
  ['viaggio', 'bosco', 'deserto', 'montagna'],
  ['romantico', 'festa', 'calma', 'taverna'],
];
