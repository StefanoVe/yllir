# Adattatore Fabula Ultima

**Stato:** livelli 1 e 2 implementati (2026-11-20, framework 0.92.0 e 0.93.0): `yllir/modules/systems/fabula-ultima/` con `adapter.yaml`, `checks.mjs`, `difficulty.mjs` ed `encounter.mjs`. Il caso di testbench (punto 3 del piano) resta da fare. Tutto ciò che è marcato **Proposta** non è approvato.
**Parte di:** [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md), che definisce il contratto dell'adattatore.

## Scopo

Secondo adattatore di sistema dopo D&D 2024, e primo a mettere alla prova il contratto con un sistema che non ha punteggi numerici, tabelle di GS né slot di incantesimo. Il modulo sarebbe `yllir/modules/systems/fabula-ultima/` (id `fabula-ultima`).

Valgono le regole già decise per gli adattatori: il manifest è uno **schema**, non contiene le tabelle delle regole né il testo di classi, abilità e incantesimi; i valori di regola si ricavano dalla conoscenza del modello o da una ricerca e lo schema li valida (decisione 10 della [Riprogettazione](Riprogettazione.md)); i calcoli stanno in `checks.mjs`, puri e senza dadi; l'adattatore non decide esiti.

## Fonti e licenza

- Materiale di partenza: Press Start (tutorial), Carica Partita / Load Game, la quick reference, la guida di creazione dei PNG e degli oggetti, le schede di classe e le liste di incantesimi di terzi (pacchetto «Fabulously Fast Character Sheets», v2.2.1, 2026-04-28).
- **Versione di riferimento: la v1.1 del Manuale Base**, quella della quick reference. Press Start ha valori superati (Studio DL 10/13/16 invece di 7/10/13; Tonico che cura un solo status invece di tutti).
- **Da verificare prima di scrivere nel repo:** il pacchetto di terzi è sotto la «Fabula Ultima Third Party Tabletop License 1.0», di cui nessuno ha letto il testo. Load Game porta il nome di un acquirente e Crafting concede solo l'uso personale. Finché la licenza non è letta, in `yllir/` e `testbench/` vanno solo schema e formule, e i fixture sono sintetici. Vedi le questioni aperte.

## Dove il contratto attuale non basta

Il contratto di D&D 2024 assume punteggi numerici, risorse con massimo e recupero, condizioni con durata e una tabella di difficoltà. Fabula Ultima richiede:

| Esigenza | Esempio | Copertura oggi |
| --- | --- | --- |
| Attributi a **taglia di dado** (d6, d8, d10, d12) | DES d10; mai sotto d6 | assente: `creature_sheet` ha campi, non scale di dado |
| Condizioni che **abbassano la taglia** di uno o due attributi | Furente: DES e INS; Avvelenato: MIG e VOL | `conditions` ha solo etichette e durate |
| **Pool di punti** oltre alle risorse a recupero | Punti Fabula, Ultima, Inventario; per classe: Grave, Scambio, Ingredienti | `resources` copre massimo e recupero, non guadagno/spesa per evento |
| **Orologi** a segmenti (4, 6, 8, 10, 12), di progresso o di minaccia | Orologio d'invasione; Cervello, Crescita | nel contratto solo come esempio (`clocks` di «sale-e-catene», **Proposta**) |
| **Legami** con emozioni a coppie e forza 1–3 | Ammirazione o inferiorità, lealtà o sfiducia, affetto o odio | assente |
| **Livello di abilità** (SL) nelle formule di classe | «SL × 5 PM» | assente |
| Gradi dei PNG con moltiplicatori | élite ×2, campione ×N, cattivo con Punti Ultima | `difficulty` è per fasce e GS |
| Difficoltà d'incontro per **offset di livello** e numero di nemici | facile, normale +5, difficile +10 | `difficulty.method` dichiarato solo `band-and-cr` |

Queste estensioni sono **Proposta** e vanno decise dall'autore: vedi le questioni aperte.

## Manifest (Proposta)

Bozza della forma, non implementata. I nomi seguono quelli di D&D 2024 dove il significato coincide.

```yaml
id: fabula-ultima
name: "Fabula Ultima"
version: 1
encounters: turn-based        # round; iniziativa come Prova di gruppo
progression:
  method: experience
  experience_points: true
  level_up_at: 10
  session_award: 5            # più PX per Punti Ultima spesi e Punti Fabula spesi dal gruppo
attributes:                   # estensione proposta
  ids: [dex, ins, mig, wlp]
  dice: [d6, d8, d10, d12]
  floor: d6
  creation_sets: [[8,8,8,8], [10,8,8,6], [10,10,6,6], [12,8,6,6]]
  upgrade_levels: [20, 40, 60]
conditions: [slow, dazed, weak, shaken, enraged, poisoned]
condition_effects:            # estensione proposta
  slow: [dex]
  dazed: [ins]
  weak: [mig]
  shaken: [wlp]
  enraged: [dex, ins]
  poisoned: [mig, wlp]
pools: []                     # estensione proposta: fabula, ultima, inventory, e quelli di classe
clocks:                       # estensione proposta
  sizes: [4, 6, 8, 10, 12]
bonds:                        # estensione proposta
  pairs: [[admiration, inferiority], [loyalty, mistrust], [affection, hatred]]
  max_emotions: 3
  max_bonds: 6
ranks: [soldier, elite, champion, villain]
difficulty:
  method: level-offset        # estensione proposta
checks: checks.mjs
```

## checks.mjs (Proposta)

Aritmetica pura, nessun dado. Ogni formula ha un caso di prova nel file di test.

- PV massimi dei PG: MIG × 5 + livello + bonus. PM: VOL × 5 + livello + bonus. PI: 6 + bonus. Soglia di crisi: metà dei PV massimi, arrotondata per difetto.
- Difesa: taglia di DES (o valore fisso dell'armatura) più bonus. Difesa Magica: taglia di INS più bonus.
- PV e PM dei PNG: 2 × livello + 5 × MIG; livello + 5 × VOL. Moltiplicatori di grado: élite PV ×2, campione ×N.
- Bonus precisione e magia: +1 ogni 10 livelli. Bonus ai danni: +5 ogni 20 livelli.
- Taglia effettiva di un attributo dopo gli status: ogni status abbassa di un passo, mai sotto d6.
- PV del compagno del Viandante: SL × taglia MIG del compagno + metà livello.
- Costo massimo di un oggetto forgiato: livello più alto del gruppo × 60.
- Sezioni di un Orologio riempite: 1, più 1 ogni 3 punti oltre la difficoltà.

Casi di prova già disponibili dalle fonti (scheda compilata di Cross, livello 5, MIG d6, VOL d10): PV 35, PM 65 (con bonus di classe), PI 8, crisi 17, Difesa 9, Difesa Magica 11; compagno Task: 26 PV.

## Schede (Proposta)

- **Personaggio giocante:** nome, pronomi, identità, tema, origine, attributi a taglia di dado, status, affinità ai tipi di danno (assorbe, immune, resiste, vulnerabile), equipaggiamento, legami, abilità eroiche, punti (PF, PX, PV, PM, PI), zenit.
- **PNG:** livello, specie, grado, tratti, attributi, affinità, attacchi base, abilità, incantesimi, PU se cattivo.
- **Oggetto:** costo in zenit, categoria, qualità.
- **Orologio e legame:** voci di campagna, non schede (da decidere).

## Cosa non va nel manifest

Testo di classi, abilità, incantesimi, arcana, simboli, ricette; tabelle di prezzi e di armi; elenchi di specie e di abilità PNG. Restano alla conoscenza del modello o a una ricerca, validati dallo schema.

## Regole comuni

Valgono quelle di [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md): il master decide, l'adattatore non tira dadi (le ricariche e le tabelle casuali di Fabula Ultima, come Gamble o gli ingredienti, si ricordano e non si eseguono), la regola è la fonte, le schede dei PG restano dati.

## Piano (Proposta)

1. **Livello 1 (fatto, 0.92.0):** manifest minimo, `checks.mjs` con le formule sopra e i test, schede PG e PNG, intestazioni, `do_not`. Cosa contiene:
   - Il manifest usa solo le chiavi del contratto attuale. Restano fuori `attributes`, `condition_effects`, `pools`, `clocks`, `bonds`, `ranks` e `difficulty`, che sono il livello 2. Mancano anche `battle_grid` ed `encounter_ops`, perciò il tracker di scontro risponde che il sistema non ha regole di combattimento.
   - Scheda PNG: tabella `### Caratteristiche` con Livello, Grado, PV, PM, DES, INT, VIG, VOL, Difesa, Difesa Magica (in inglese Level, Rank, HP, MP, DEX, INS, MIG, WLP, Defense, Magic Defense).
   - `checkCreature` controlla le taglie di dado, il livello da 1 a 60 e il grado (soldato, élite, campione da 2 a 6). Controlla anche i minimi dei PNG: PV almeno (2 × livello + 5 × VIG) × moltiplicatore di grado, PM almeno livello + 5 × VOL, Difesa Magica almeno la taglia di INT. Se è scritta, la crisi deve essere la metà dei PV. Sono minimi perché abilità ed equipaggiamento possono alzare i valori. La Difesa non si confronta, perché l'armatura può fissarla.
   - Le formule dei PG (PV, PM, PI, crisi, Difesa Magica, compagno, costo forgiato, sezioni d'Orologio) sono funzioni pure con i loro test. Nessun controllo le applica ancora alle schede dei PG, che restano trascrizioni.
   - Le prove di scena non hanno ancora un formato: senza `checkSceneCheck` il motore le accetta come sono.
   - Etichette italiane scelte dall'autore il 2026-11-20, da confermare sul testo di Need Games: DES, INT, VIG, VOL; PV, PM, Difesa, Difesa Magica, Livello, Grado; status Lento, Confuso, Debole, Scosso, Furente, Avvelenato.
2. **Livello 2 (fatto, 0.93.0).** Decisioni dell'autore del 2026-11-20:
   - nel contratto entra solo ciò che il tracker usa: taglie di dado, effetti degli status e pool. Orologi e Legami restano fuori finché non si decide dove vivono;
   - i Punti Ultima stanno nella scheda del cattivo e, durante lo scontro, nel tracker;
   - i lati si alternano e il master sceglie chi agisce;
   - rientrano la difficoltà `level-offset`, il formato delle prove di scena con la sigla DL anche in italiano, e i supplementi.

   Cosa contiene:
   - **Contratto** (`yllir/scripts/lib/adapter.mjs`). Ci sono tre chiavi nuove, tutte facoltative:
     - `attributes`: id, taglie e minimo;
     - `condition_effects`: per ogni status, gli attributi che abbassa, validati contro `attributes` e `conditions`;
     - `pools`: id, `owner` (i lati del tracker `pc`, `ally`, `enemy`) ed etichetta; un id non può coincidere con quello di una risorsa.
     Il metodo di difficoltà `level-offset` usa `level_offsets`, scarti crescenti per fascia.
   - **Manifest.** Pool `fabula` (proprietario `pc`) e `ultima` (proprietario `enemy`). Effetti degli status: Lento DES, Confuso INT, Debole VIG, Scosso VOL, Furente DES e INT, Avvelenato VIG e VOL. Fasce facile 0, normale +5, difficile +10. Fonti: quick reference e scheda PNG di FFCS 2.2.1, parti non marcate come playtest.
   - **Tracker** (`encounter.mjs`). Lo stato ha la stessa forma di quello di D&D, così il master screen non cambia; si aggiungono `turns` e `acted` per combattente e `first`, il lato che apre ogni round. Funzionamento:
     - eroi (`pc`, `ally`) e nemici si alternano; quando un lato ha finito, l'altro continua; il round finisce quando nessuno può più agire;
     - chi parte per primo e quanti turni ha un campione li dichiara il master (`next --id`, `--turns`, op `turns`): le regole playtest (il cattivo agisce per primo, turni per grado) non sono codificate;
     - a 0 PV chiunque è sconfitto;
     - la crisi compare solo nel testo dello storico: il master screen conosce solo le notifiche esistenti;
     - l'aggiunta di uno status nomina gli attributi abbassati;
     - i Punti Ultima si danno solo ai nemici e i Punti Fabula solo ai PG.
     D&D rifiuta `next --id` e `--turns`.
   - **Difficoltà** (`difficulty.mjs`):
     - fascia di livello, dallo scarto fra il livello medio pesato dei nemici e il livello medio del gruppo;
     - fascia di numero, dai nemici in soldati equivalenti (élite 2, campione N) contro il numero di PG;
     - la fascia finale è la più dura delle due. Questa combinazione è una scelta di Yllir, non una regola del gioco.
     Il censimento del motore (`query encounters`) legge livello e grado dalle schede e riporta `no-level` al posto di `no-cr`. Per D&D l'uscita è invariata.
   - **Prove di scena** (`checkSceneCheck`). La forma è `DES + INT DL 10` oppure `VIG + VOL contrapposta`; in inglese `DEX + INS DL 10` e `MIG + WLP opposed`. Il DL è solo 7, 10, 13 o 16.
   - **Supplementi.** Nessun nome di classe o di pool di classe entra nel manifest, finché la licenza non è letta. Le meccaniche di classe, compresi i pool dei supplementi, restano trascritte nella scheda del PG.
   - **Limiti noti:**
     - se il master rimuove il combattente che sta agendo, il `next` successivo apre un round nuovo;
     - una scena FU scritta sotto la 0.92.0 con una prova in forma libera va riscritta alla prossima modifica;
     - il prompt del cockpit del master screen parla ancora di iniziativa.
3. **Testbench:** caso con scheda sintetica (non quella di Cross), trappole: omonimi fra incantesimi di classi diverse (Barriera e Aura hanno la stessa forma), status cumulativi sullo stesso attributo, versione 1.1 contro Press Start.

Stima dei costi: nostra, non misurata.

## Questioni aperte

- **Licenza.** Cosa consente la «Third Party Tabletop License 1.0» per un plugin distribuito? Serve la lettura del testo.
- **Ambito.** Solo gioco base, o anche i supplementi (Atlanti: Pilota, Mutante, Esper, Floralista, Invocatore, Mercante, Simbolista, Comandante, Cantore, Danzatore; Bonus: Asso di Carte, Negromante; Arcanista playtest)? Le classi dei supplementi hanno pool propri.
- **Estensioni del contratto.** Taglie di dado, effetti degli status, pool, Orologi e Legami diventano campi dichiarativi del contratto, o resta tutto in `checks.mjs`? Gli Orologi sono oggi una **Proposta** in [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md).
- **Livello 1 o 2 per primo.** Il livello 1 non ha il tracker.
- **Difficoltà.** `level-offset` è un metodo nuovo accanto a `band-and-cr`; il contratto attuale ne ammette altri?
- **Lingua dei titoli.** Le intestazioni e le etichette sono in inglese e italiano; la traduzione italiana ufficiale dei termini (Punti Fabula, Legami, Orologi) va controllata sul testo di Need Games.
- **Cattivi e Punti Ultima.** Sono risorse del master, non dei PG: dove vivono nello stato della campagna, e il blocco riservato li copre?
