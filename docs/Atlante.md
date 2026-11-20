# Atlante

**Stato:** riprogettato dall'autore il 2026-11-20 (motore a base dipinta, sostituisce quello a livelli generati da script di 0.78.0–0.83.0). Le decisioni qui sotto sono **Deciso** dove indicato; il resto è **Proposta**.
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md) (scheda [L25](Skill%20di%20libreria.md#l25-atlante)) e [Master screen](Master%20screen.md)

## Scopo del documento

Questo file definisce l'atlante della campagna: una carta del mondo (o della parte di mondo che serve, fino a una città o a un quartiere) consultabile nel master screen ed esportabile come sito statico per i giocatori.

## 1. Decisioni dell'autore

Confermate (2026-11-19):

1. **Due forme, un solo atlante.** Vista del master screen e sito statico esportato per i giocatori (progetto a parte, costruibile e distribuibile), con lo stesso visore.
2. **Solo su richiesta.** Si genera solo quando il master lo chiede, a voce o dal pulsante «Genera atlante della campagna» del master screen (che apre il popup con l'assistente). Mai in autorun.
3. **Il più automatico possibile, senza dare nulla per scontato.** L'assistente ricava dai documenti e da fonti esterne; ciò che non può ricavare lo chiede (estensione, nomi mancanti). Non inventa in silenzio.
4. **Il territorio non cambia.** Una nuova generazione non modifica mai la conformazione del territorio già approvato, salvo richiesta esplicita del master. Il mondo che cresce si aggiunge solo fuori dalle terre esistenti.
5. **Sempre aggiornato.** Quando il mondo si espande, i processi che creano luoghi collocano i nuovi luoghi sull'atlante.
6. **Master e giocatori.** Nel master screen l'atlante mostra tutto; il sito per i giocatori esclude ciò che è riservato al master, con gli stessi controlli dell'enciclopedia.
7. **Stili.** L'atlante ha stili (fantasy colorato, pergamena antica, dark fantasy); l'ordine di scelta è: il master, poi l'adattatore del sistema, poi il base. Cambiare stile non tocca i dati.

**Nuove (Deciso, 2026-11-20), che sostituiscono le decisioni 3, 4, 8, 9 e 12 del 2026-11-19 e le sezioni 2b, 5b, 5c di 0.78–0.83:**

8. **Il motore a script generativi è dismesso.** Non si generano più terre, rilievi, acque, biomi, strade, isolati ed edifici con script; non esistono più i timbri e i livelli urbani. Lo ha deciso l'autore perché il sistema non funzionava correttamente.
9. **Base dipinta più dati.** La carta è un'immagine dipinta (`base.png`, senza alcun testo) con accanto dati: maschera di terra, etichette, territori (stati, quartieri), luoghi. Testi, confini e segnaposti non fanno mai parte dell'immagine: li disegna l'esportazione dai dati.
10. **Le modifiche dipinte passano da ritagli.** Un fornitore di immagini non conserva la geometria su una carta intera: si ritaglia e si ingrandisce il riquadro da cambiare (da ×2 a ×3), il fornitore lo ridipinge, lo si ricompone sulla base solo dove è ammesso, con controllo delle coste. L'assistente guarda il confronto prima e dopo. Il metodo deriva dalla skill `world-map` usata a mano dall'autore su una sua campagna, qui reso generico.
11. **Stesso metodo a ogni scala.** Mondo, continente, regione, abitato o quartiere: una base più dati. I quartieri sono territori; le piante di città non hanno asset propri.
12. **Prima base.** Viene dal master o dalle fonti; se mancano, da una sola generazione completa del fornitore di immagini a partire dalle sole parti pubbliche del seme e delle schede. Il master approva la terra prima che si fissi.
13. **Vecchi dati.** Le campagne con dati dell'atlante di 0.78–0.83 non vengono migrate: restano dove sono, ignorate; il master rigenera l'atlante col nuovo metodo.

## 2. Dati

I dati sono canone: stanno nella cartella dell'atlante (localizzata, tipo `atlas` in `structure`) e si salvano in git come ogni documento. Tutto ciò che si disegna (sito, anteprima) è derivato e si rigenera in `.campaign/cache/atlas/`.

- **`atlas.json`:** estensione (`world`, `continent`, `region`, `settlement`, `district`, e i luoghi di primo livello), stile, dimensioni della tela **lette dalla base** (mai fisse), stato e impronta di `base` e `land`, con il blocco (`locked`).
- **`base.png`:** la carta dipinta, senza testo né cornici. **`land.png`:** maschera terra/mare, derivata dalla base con un colore del mare e una tolleranza che sono parametri (non una regola fissa su un solo colore) e che l'assistente controlla in anteprima.
- **`labels.json`:** `lands`, `regions`, `nature` (testi con posizione e corpo), `places` (segnaposto che rimandano alla scheda con l'`id`: nome e descrizione vengono dalla scheda, mai copiati), `territories` (semi sulla terra e regole: stretti da tagliare, poligoni da aggiungere o togliere, sottrazioni di altri territori), legenda. Ogni elemento porta provenienza (`master`, `document`, `agent-choice`), fonti e visibilità (`public`, `master`).
- **Posizioni in pixel della base.** I segnaposto nel visore usano percentuali derivate.

## 3. Processo

1. **Estensione e domande.** L'assistente legge seme e schede, cerca la geografia di un'ambientazione pubblicata (mai inviando il blocco riservato), propone l'estensione e chiede solo ciò che non ricava.
2. **Base.** Immagine data dal master o trovata nelle fonti (con un sì); altrimenti una generazione completa del fornitore con prompt solo pubblico. Si deriva la maschera di terra; il master approva la terra e si fissa (`land`, `base`).
3. **Modifiche dipinte.** Riquadro → ritaglio → prompt (coordinate del ritaglio, terre descritte a parole, **ogni luogo con nome nel ritaglio** elencato perché non sparisca, «nessun testo») → fornitore → ricomposizione (solo terra, riquadro intero o maschera) → verifica delle coste → accettazione. Tentativi riscritti, mai accumulati su un risultato sbagliato.
4. **Dati.** Etichette, territori, luoghi: scritti con `labels-write`, che controlla forma, posizioni (un luogo sulla terra, un porto entro 12 px dal mare) e schede esistenti.
5. **Disegno.** `render` produce il sito del master e quello dei giocatori.

Lo script fa la meccanica (ritagli, composizione, maschere, controlli, esportazione); l'assistente giudica (cosa chiedere al fornitore, se il risultato è buono).

## 4. Stabilità e aggiornamento

- **Blocco.** Dopo l'approvazione la terra è fissata: `accept` rifiuta un cambiamento della maschera di terra, salvo `--extend` (solo mare→terra dentro il riquadro, nessuna terra persa) o `--unlock` su richiesta esplicita del master, con confronto mostrato prima.
- **Aggiornamento continuo.** Come prima: `status` elenca i luoghi del canone non ancora sull'atlante; `build-world` e `write-document` chiamano `yllir:atlas update` a fine lotto; il master screen mostra quanti restano.
- **Ridisegno.** Il disegno è derivato: `render` rifà il sito dai dati e dalla base.

## 5. Visore ed esportazione

Visore unico statico (spostamento e zoom, interruttori per confini, testi e segnaposto, ricerca, scheda del luogo con sinossi pubblica senza spoiler). Il sito del master sta in `.campaign/cache/atlas/master/`; l'esportazione per i giocatori esclude gli elementi `master` e passa i controlli dell'enciclopedia prima di sostituire la cartella. L'immagine di base è pubblica per costruzione (generata e ridipinta solo da testo pubblico).

## 6. Master screen

Invariato nella forma: sezione «Atlante», un solo pulsante «Genera atlante della campagna» se non esiste, popup con l'assistente, visore se esiste, avviso dei luoghi da collocare, attesa dell'approvazione della terra. Il master screen non scrive i dati dell'atlante.

## 7. Requisiti trasversali

- Il blocco riservato non arriva mai al fornitore di immagini, alle ricerche esterne né al sito dei giocatori. I prompt al fornitore contengono solo testo pubblico.
- Nessun riferimento a un mondo o a un sistema di gioco specifico nel codice.
- Modulo `atlas` in `modules`, spento per default.

## 8. Testbench

Casi con fornitore finto (un'immagine fissa) e risposte fuori dalla cartella dell'agente: chiede estensione e nomi mancanti invece di inventarli; un luogo nuovo si colloca senza cambiare la maschera di terra; un luogo riservato manca dal sito dei giocatori; la terra fissata non cambia; una carta di città parte da una base e da quartieri come territori. Una prova reale con Codex, a pagamento, su una campagna sintetica.

## Questioni aperte

- **Fornitori:** oggi il fornitore di immagini con riferimento è solo Codex; ComfyUI e Photoshop da valutare.
- **Maschera di terra su basi atipiche:** la stima automatica del colore del mare può sbagliare su basi dipinte con mare non uniforme; resta il controllo dell'assistente e i parametri.
- **Registrazione pixel-esatta** dopo la ricomposizione: oggi il controllo è delle coste (maschera) e visivo.
- **Carte annidate** (mondo e capitale come due carte collegate): non implementate.
- **Pubblicazione:** il sito dei giocatori resta locale come l'enciclopedia finché non c'è un hosting.
- **Costo:** ogni ridipintura è a pagamento; chi lo sostiene non è deciso.
