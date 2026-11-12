// Atmosphere lexicon of the music search. A word of the PUBLIC part of a place
// sheet becomes a generic English search term only when it is listed here, so
// free prose of a sheet never reaches a search. Keys are accent-free and
// lowercase (the form `words()` produces). Values are English search terms.

const PAIRS = [
  // places and scenery (Italian)
  ['taverna', 'tavern'], ['osteria', 'tavern'], ['locanda', 'inn'], ['foresta', 'forest'],
  ['bosco', 'woods'], ['boschi', 'woods'], ['porto', 'harbor'], ['molo', 'pier'], ['mare', 'sea'],
  ['oceano', 'ocean'], ['lago', 'lake'], ['fiume', 'river'], ['palude', 'swamp'], ['paludi', 'swamp'],
  ['montagna', 'mountains'], ['montagne', 'mountains'], ['deserto', 'desert'], ['caverna', 'cave'],
  ['grotta', 'cave'], ['grotte', 'cave'], ['sotterraneo', 'underground'], ['sotterranea', 'underground'],
  ['sotterranei', 'dungeon'], ['rovine', 'ruins'], ['rovina', 'ruins'], ['tempio', 'temple'],
  ['chiesa', 'church'], ['cattedrale', 'cathedral'], ['cimitero', 'graveyard'], ['cripta', 'crypt'],
  ['villaggio', 'village'], ['citta', 'city'], ['mercato', 'market'], ['castello', 'castle'],
  ['fortezza', 'fortress'], ['torre', 'tower'], ['strada', 'street'], ['vicolo', 'alley'],
  ['vicoli', 'alley'], ['nave', 'ship'], ['miniera', 'mine'], ['abisso', 'abyss'],
  ['ghiaccio', 'ice'], ['ghiacciaio', 'glacier'], ['giungla', 'jungle'], ['pianura', 'plains'],
  ['prateria', 'plains'], ['collina', 'hills'], ['colline', 'hills'], ['scogliera', 'cliffs'],
  ['spiaggia', 'beach'], ['sabbia', 'sand'],
  // weather, time and light (Italian)
  ['notte', 'night'], ['pioggia', 'rain'], ['piove', 'rain'], ['nebbia', 'fog'], ['nebbioso', 'fog'],
  ['fuoco', 'fire'], ['fiamme', 'fire'], ['neve', 'snow'], ['vento', 'wind'], ['tempesta', 'storm'],
  ['temporale', 'storm'], ['luna', 'moon'], ['alba', 'dawn'], ['tramonto', 'dusk'],
  ['inverno', 'winter'], ['estate', 'summer'], ['autunno', 'autumn'],
  // mood and sound (Italian)
  ['battaglia', 'battle'], ['rituale', 'ritual'], ['mistero', 'mystery'], ['misterioso', 'mysterious'],
  ['tetro', 'gloomy'], ['cupo', 'gloomy'], ['cupa', 'gloomy'], ['malinconico', 'melancholic'],
  ['sereno', 'peaceful'], ['teso', 'tense'], ['tensione', 'tense'], ['inquietante', 'eerie'],
  ['sinistro', 'ominous'], ['allegro', 'cheerful'], ['festa', 'festive'], ['silenzio', 'quiet'],
  ['silenzioso', 'quiet'], ['desolato', 'desolate'], ['abbandonato', 'abandoned'],
  ['infestato', 'haunted'], ['freddo', 'cold'], ['caldo', 'warm'], ['affollato', 'crowded'],
  // places, weather and mood (English)
  ['tavern', 'tavern'], ['inn', 'inn'], ['forest', 'forest'], ['woods', 'woods'], ['harbor', 'harbor'],
  ['harbour', 'harbor'], ['pier', 'pier'], ['sea', 'sea'], ['ocean', 'ocean'], ['lake', 'lake'],
  ['river', 'river'], ['swamp', 'swamp'], ['marsh', 'marsh'], ['mountain', 'mountains'],
  ['mountains', 'mountains'], ['desert', 'desert'], ['cave', 'cave'], ['cavern', 'cave'],
  ['dungeon', 'dungeon'], ['underground', 'underground'], ['ruins', 'ruins'], ['temple', 'temple'],
  ['church', 'church'], ['cathedral', 'cathedral'], ['graveyard', 'graveyard'], ['cemetery', 'graveyard'],
  ['crypt', 'crypt'], ['village', 'village'], ['city', 'city'], ['market', 'market'],
  ['castle', 'castle'], ['fortress', 'fortress'], ['tower', 'tower'], ['street', 'street'],
  ['alley', 'alley'], ['ship', 'ship'], ['mine', 'mine'], ['abyss', 'abyss'], ['glacier', 'glacier'],
  ['jungle', 'jungle'], ['plains', 'plains'], ['hills', 'hills'], ['cliffs', 'cliffs'],
  ['beach', 'beach'], ['sand', 'sand'], ['night', 'night'], ['rain', 'rain'], ['fog', 'fog'],
  ['mist', 'fog'], ['fire', 'fire'], ['snow', 'snow'], ['wind', 'wind'], ['storm', 'storm'],
  ['moon', 'moon'], ['dawn', 'dawn'], ['dusk', 'dusk'], ['sunset', 'dusk'], ['winter', 'winter'],
  ['summer', 'summer'], ['autumn', 'autumn'], ['battle', 'battle'], ['ritual', 'ritual'],
  ['mystery', 'mystery'], ['mysterious', 'mysterious'], ['gloomy', 'gloomy'],
  ['melancholic', 'melancholic'], ['peaceful', 'peaceful'], ['tense', 'tense'], ['eerie', 'eerie'],
  ['ominous', 'ominous'], ['cheerful', 'cheerful'], ['quiet', 'quiet'], ['desolate', 'desolate'],
  ['abandoned', 'abandoned'], ['haunted', 'haunted'], ['dark', 'dark'], ['cold', 'cold'],
  ['warm', 'warm'], ['crowded', 'crowded'], ['busy', 'busy'], ['lively', 'lively'],
];

/** Lowercase, accent-free atmosphere word -> English search term. */
export const MOOD_TERMS = new Map(PAIRS);

/** Most atmosphere terms that one query may carry. */
export const MAX_MOOD_TERMS = 6;
