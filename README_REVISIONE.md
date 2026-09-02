# Revisione completa

## Implementato
1. Corretto il calcolo della performance del progetto: il capitale di riferimento non viene più sottratto al profitto.
2. Rimossa l'esecuzione di configurazione Firebase tramite `new Function`; la configurazione viene interpretata come JSON.
3. Aggiunta funzione centralizzata di escaping HTML per i dati testuali inseriti nelle viste principali.
4. Date locali e differenze tra date gestite senza dipendere da `toISOString()` per il giorno locale.
5. Esportazione e importazione di backup JSON completi dalla sezione Storico.
6. Iniziata la modularizzazione con `js/core.js`, contenente funzioni pure e riutilizzabili per date e calcoli finanziari.
7. Aggiunti test automatici di base in `tests/calculations.test.js`; possono essere aperti tramite `tests/index.html`.
8. Capitale di riferimento e deposito reale sono separati: il primo deposito è una registrazione reale con gain pari a zero.

## Nota
La modularizzazione è volutamente progressiva: `app.js` continua a gestire l'interfaccia per evitare una riscrittura rischiosa dell'app, mentre la logica nuova e testabile viene spostata gradualmente in `js/core.js`.
