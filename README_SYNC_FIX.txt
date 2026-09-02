CORREZIONE SINCRONIZZAZIONE FIREBASE

Questa versione rende più robusta la sincronizzazione PC/telefono:
- il documento Firestore dell'utente viene ascoltato in tempo reale;
- i dati locali vengono caricati automaticamente al primo accesso cloud;
- ogni modifica viene salvata su Firestore con una breve coda anti-ripetizione;
- il documento contiene versione e data di aggiornamento.

IMPORTANTE: accedere con lo stesso account Google su entrambi i dispositivi.
