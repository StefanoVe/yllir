// UI strings of the atlas site, in the two languages the export knows. The export picks `it` for an
// Italian campaign and `en` for any other language; the viewer receives the chosen set inside the page
// data and never chooses a language itself.

export const STRINGS = {
  it: {
    atlas: 'Atlante',
    mapLabel: 'Mappa dell\'atlante',
    search: 'Cerca un luogo',
    searchToggle: 'Apri la ricerca',
    searchNone: 'Nessun luogo trovato',
    layers: 'Livelli',
    layersToggle: 'Apri i livelli',
    alwaysOn: 'sempre visibile',
    layerNames: {
      terrain: 'Terreno',
      relief: 'Rilievo',
      biomes: 'Biomi',
      water: 'Acque',
      political: 'Territori',
      routes: 'Strade',
      places: 'Luoghi',
      labels: 'Etichette',
    },
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    zoomFit: 'Adatta alla finestra',
    close: 'Chiudi',
    documentPath: 'Documento',
    openDocument: 'Apri il documento',
    openEncyclopedia: 'Apri la voce dell\'enciclopedia',
  },
  en: {
    atlas: 'Atlas',
    mapLabel: 'Campaign atlas map',
    search: 'Search for a place',
    searchToggle: 'Open search',
    searchNone: 'No place found',
    layers: 'Layers',
    layersToggle: 'Open layers',
    alwaysOn: 'always visible',
    layerNames: {
      terrain: 'Terrain',
      relief: 'Relief',
      biomes: 'Biomes',
      water: 'Water',
      political: 'Realms',
      routes: 'Routes',
      places: 'Places',
      labels: 'Labels',
    },
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomFit: 'Fit to window',
    close: 'Close',
    documentPath: 'Document',
    openDocument: 'Open the document',
    openEncyclopedia: 'Open the encyclopedia entry',
  },
};

/** The UI strings for a campaign language: Italian for `it`, English for any other. */
export function stringsFor(lang) {
  return lang === 'it' ? STRINGS.it : STRINGS.en;
}
