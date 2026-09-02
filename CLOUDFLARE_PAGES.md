# Bankroll PWA — Cloudflare Pages

Questo pacchetto è pronto per essere pubblicato come sito statico su Cloudflare Pages.

## Metodo consigliato: GitHub + Cloudflare Pages

1. Estrai completamente questo ZIP.
2. Carica tutti i file estratti nella radice di un nuovo repository GitHub.
3. In Cloudflare vai su **Workers & Pages**.
4. Crea una nuova applicazione e scegli **Pages**.
5. Collega il repository GitHub.
6. Imposta:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `exit 0` (oppure lascialo vuoto se l'interfaccia lo consente)
   - Build output directory: `.`
7. Avvia il deploy.

## Aggiornamenti

Questo pacchetto include:
- `_headers` per evitare che `app.js`, `index.html` e il service worker rimangano obsoleti;
- un service worker con strategia **network-first** per i file dell'app;
- pulizia automatica delle vecchie cache `bankroll-*`.

Dopo una nuova pubblicazione, chiudi e riapri la PWA se il telefono mostra ancora una versione precedente.

## Importante

Firebase è configurato lato client. Se utilizzi Firebase, le regole di sicurezza
Firestore e Authentication devono essere configurate correttamente nel tuo progetto Firebase.


## Firebase

Questa versione include la configurazione Firebase e il login con Google. Prima dell'uso:
1. Firebase Authentication → Metodo di accesso → Google deve essere abilitato.
2. Authentication → Impostazioni → Domini autorizzati: aggiungi il dominio `investimento.pages.dev` (oppure il tuo esatto dominio Cloudflare).
3. Firestore → Regole: copia le regole dal file `FIRESTORE_RULES.txt` e pubblicale.
4. Accedi con lo stesso account Google su PC e telefono.
