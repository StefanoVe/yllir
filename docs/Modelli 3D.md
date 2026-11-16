# Modelli 3D

**Stato:** processo **Deciso** dall'autore (2026-11-16); strumenti e dettagli **Proposta**; nessuna implementazione
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md) (scheda [L24](Skill%20di%20libreria.md#l24-modelli-3d-da-stampare))

## Scopo del documento

Questo file definisce come si genera, a partire dalla scheda di un personaggio o di una creatura, un modello 3D adatto alla stampa 3D (formato STL). Le decisioni dell'autore sono marcate **Deciso**. Il resto è **Proposta**, e le questioni aperte in fondo non sono risolte.

## 1. Processo (Deciso, 2026-11-16)

Il processo ha due passi, nell'ordine.

1. **Immagine di partenza.** Si genera un'immagine pulita, con canale alpha, del soggetto in **monocromo**, in una **posa adatta alla stampa**: una posa che riduce al minimo i supporti.
2. **Modello.** Dall'immagine si genera l'STL con **strumenti scaricabili e presenti nel sistema** del master. Quali strumenti, si definisce al momento dell'implementazione.

L'avvio è dal core, solo su richiesta del master, mai in autorun.

## 2. Passo 1: l'immagine

- **Chi la genera.** Lo strumento `images` (vedi [Integrazioni esterne](Integrazioni%20esterne.md)), con il suo ordine di scelta dei fornitori e il suo consenso. Il passo 1 è una modalità di quello strumento, non un secondo percorso di generazione di immagini. **Proposta.**
- **Descrizione.** Costruita da uno script dalla sola parte pubblica della scheda, come per ogni immagine (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md)). Il blocco riservato al master non arriva mai al fornitore di immagini.
- **Requisiti dell'immagine:**
  - sfondo trasparente (canale alpha), senza ombre portate, pavimento o scenografia;
  - un solo colore (monocromo), con sfumature solo di luminosità, senza texture che il modello 3D non può riprodurre;
  - contorno netto e leggibile;
  - soggetto intero, inquadrato frontalmente, in una posa stabile.
- **Posa adatta alla stampa (Deciso come principio; i dettagli sono Proposta):** poggia su una base piana o su un punto di appoggio largo; arti vicini al corpo; niente braccia tese, ali o code a sbalzo, armi sollevate o mantelli al vento; niente parti sottilissime o staccate; angoli di sporgenza contenuti. La posa si chiede al fornitore nella descrizione, e si controlla dopo sul modello (sezione 4).
- **Giudizio.** L'assistente principale confronta l'immagine con la descrizione pubblica e con i requisiti sopra, con al più due tentativi correttivi, come per le altre immagini (decisione D8 di [Integrazioni esterne](Integrazioni%20esterne.md)). Una posa che costringerebbe a molti supporti è un difetto da correggere, non un dettaglio.

## 3. Passo 2: dall'immagine all'STL

- **Strumenti (da definire all'implementazione).** Programmi che il master può scaricare e che girano in locale, nessun servizio in rete obbligatorio. Chi implementa sceglie dopo una verifica (licenza, installazione senza terminale, funzionamento su macOS, Windows e Linux), registra la scelta e la ragione, e dichiara le dipendenze come per gli altri moduli (sezione 6 di [Integrazioni esterne](Integrazioni%20esterne.md)). Qui non se ne indica nessuno.
- **Candidato segnalato dall'autore (2026-11-16):** la skill `image-to-3d-generation` del repository `kngender5/hermes`. Verificato lo stesso giorno: quel nome non esiste nel repository; la skill più vicina è `trellis-3d-generation`, che usa Microsoft TRELLIS in locale (da una o più immagini a un GLB con texture). Limiti emersi, da pesare prima di adottarla:
  - richiede una scheda NVIDIA con CUDA (circa 8 GB di memoria video), Python e PyTorch, pesi da scaricare (circa 13,6 GB), ambiente conda o WSL2 sotto Windows: non gira su Mac e non è installabile da chi non usa il terminale;
  - l'uscita è GLB, non STL: serve una conversione e una pulizia della mesh;
  - il repository è privato, con tutti i diritti riservati, e non dichiara una licenza per la skill; vanno verificate le licenze di TRELLIS e dei pesi;
  - il framework non copia codice altrui (principio di progettazione da zero): al massimo ne trae l'idea, e un modello simile entrerebbe come modulo con la propria dichiarazione.
- **Come i fornitori delle immagini.** Ogni strumento è un modulo con una dichiarazione che dice che cosa sa fare e come si verifica che sia presente; l'ordine di scelta e il ripiego sono del framework, non del master. **Proposta.**
- **Dimensioni.** Il modello esce in millimetri. La scala e il diametro della base dipendono dalla taglia della creatura e vengono dall'adattatore del sistema di gioco, non da costanti nel codice. **Proposta.**
- **Se nessuno strumento è disponibile,** la skill lo dice in parole semplici e propone che cosa installare, senza eseguire comandi che il master non capisce. L'immagine del passo 1 resta valida e collocata.

## 4. Controllo di stampabilità

Deterministico, in uno script, sempre dopo la generazione. Non ci si fida dello strumento che ha prodotto il modello. **Proposta.**

- mesh chiusa e senza spigoli aperti, facce orientate in modo coerente;
- spessore minimo delle pareti e dei dettagli, secondo i parametri di stampa dichiarati;
- sporgenze oltre l'angolo massimo, con stima delle zone che richiedono supporti, riportata al master;
- base piana;
- dimensioni dentro il volume di stampa dichiarato;
- parti staccate dal corpo principale.

I difetti semplici si riparano in automatico e si dichiara cosa è stato riparato. Un modello che non supera il controllo non viene collocato senza dirlo al master; l'assistente decide se riparare, rigenerare l'immagine con una posa più semplice o scartare.

## 5. File prodotti e collocamento

**Proposta.**

- Il modello sta in `3d/`, accanto alla scheda, collocato tramite il motore, e si salva nella cronologia della campagna.
- Accanto al modello un file di provenienza (sidecar) registra l'immagine di partenza, lo strumento e la sua versione, la data e l'esito del controllo.
- Un'anteprima in PNG permette di vedere il risultato senza programmi di taglio.
- La scheda non viene modificata: il modello è un derivato.

## 6. Requisiti trasversali

- Il blocco riservato al master non esce dalla campagna: né verso fornitori di immagini, né verso gli strumenti del passo 2, né in ricerche web.
- I parametri di stampa (volume, diametro della punta, spessore minimo, angolo di sporgenza, scala) sono configurazione del modulo, non costanti nel codice (vedi [Configurazione](Configurazione.md)).
- Un modello alla volta; prima di un lotto si chiede conferma, perché la generazione costa tempo e, con certi fornitori, denaro.
- Il formato di uscita è STL; il resto del file è leggibile dai programmi di taglio più comuni.

## 7. Testbench

**Proposta.** Fixture sintetiche con soggetti dalla posa difficile (ali aperte, arma alzata, coda lunga) e dalla posa semplice. Per l'immagine: sfondo trasparente, un solo colore, nessun elemento a sbalzo, misurati da script. Per l'STL: controlli della sezione 4 su modelli noti, buoni e difettosi. La chiave di risposta sta fuori dalla cartella che l'agente sotto prova può leggere (vedi [Robustezza e test](Robustezza%20e%20test.md)).

## Questioni aperte

- **TRELLIS come strumento del passo 2:** accettabile come modulo facoltativo solo per chi ha una scheda NVIDIA, o serve un percorso che giri anche su Mac e senza GPU (strumenti più leggeri, o un servizio esterno avvolto come fornitore)? Vedi la nota della sezione 3.
- **Strumenti del passo 2:** quali, e se più d'uno con un ordine di ripiego. Da decidere all'implementazione, come indicato dall'autore.
- **Da immagine a volume:** l'immagine, essendo una vista frontale, può dare una sagoma estrusa o un rilievo; una figura a tutto tondo richiede più viste o uno strumento che deduce il volume. Quale forma di modello si vuole: sagoma, rilievo o figura a tutto tondo?
- **Più viste:** serve generare più immagini dello stesso soggetto (fronte, retro, lato), o ne basta una?
- **Formato:** solo STL, o anche 3MF?
- **Parametri della stampante:** in `campaign.yaml` o nella configurazione del modulo? Si possono dichiarare più stampanti?
- **Modulo opzionale:** come la stampa (L10), con un'attivazione nella configurazione, o sempre disponibile?
- **Più parti:** figura e base separate, o un solo pezzo?
