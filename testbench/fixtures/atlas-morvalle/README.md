# Atlas fixture (atlas-morvalle)

Synthetic campaign for the atlas cases (`cases/atlas/`). It is the Morvalle campaign with a second region and four traps. All names are invented; no real campaign or game system is used. The campaign is written in Italian.

- `campaign/` is the only folder the agent under test may read. The answer keys sit in `cases/atlas/<name>/key.yaml`, never here.
- Land and sea: the documents give no sea. The atlas must show no sea name.

Traps (the new sheets and the edit are in `campaign/`):

1. Homonym. `Mondo/Morvalle/Borgo Cenere/Pozzo Vecchio.md` (`pozzo-vecchio-borgo`, a well in the town square) and `Mondo/Valdaspra/Pozzo Vecchio.md` (`pozzo-vecchio-valdaspra`, a ruined well). Same title, different places. Region `Mondo/Valdaspra/Valdaspra.md` (`valdaspra`) lies «a ovest di Morvalle, oltre le colline».
2. Hidden place. `Mondo/Morvalle/Rifugio dei Contrabbandieri.md` (`rifugio-contrabbandieri`). It is marked `public: false` in its metadata (the existing way to keep a sheet out of the public outputs) and its master block says the smugglers use it. Its public text places a cave on the north shore of the Lago Grigio.
3. Silent direction. `Mondo/Morvalle/Pozzo di Nàrem.md` used to say «sul versante est della valle». That was removed, so no document says where the well lies relative to Borgo Cenere. The atlas must ask or mark the position `agent-choice`.
4. No sea name. No document names a sea, a gulf or a bay.

Stated facts the atlas may use: Lago Grigio lies «a sud del borgo» (south of the village); Morvalle is the valley with Borgo Cenere on its valley floor.
