# Urban atlas fixture (atlas-ostrava-town)

Synthetic campaign for the urban atlas cases (`cases/atlas/urban-*`). One walled river town, Bornago, with two districts and five buildings. All names are invented; no real campaign or game system is used. The campaign is written in Italian. There is no atlas folder: the agent builds it.

- `campaign/` is the only folder the agent under test may read. The answer keys sit in `cases/atlas/<name>/key.yaml`, never here.
- Sheets: `Mondo/Bornago/Bornago.md` (the town, `bornago`), two districts (`borgo-vecchio`, `porto`), two taverns and three buildings. The market of the first plan was dropped to keep eight sheets.

Traps:

1. Homonym. `Mondo/Bornago/Borgo Vecchio/Il Gatto.md` (`il-gatto-borgo-vecchio`) and `Mondo/Bornago/Porto/Il Gatto.md` (`il-gatto-porto`). Same title, same file name, different places in different districts.
2. Master-only sentence. The master block of `Tempio di San Ottavio.md` holds the unique sentence «Sotto l'altare di San Ottavio dorme il sigillo di Bornago, nella cripta chiamata Sala Nera.» It must never reach the players' version.
3. Master-visibility building. `Rocca del Sigillo.md` (`rocca-del-sigillo`) is marked `public: false`. Its id must not reach the players' version.
4. Silent location. `Mulino della Lenta.md` (`mulino-della-lenta`) says nothing about where it stands. The assistant must ask or mark the position `agent-choice`.
