FIX DEPOSITO / PERFORMANCE

Correzione del bug mostrato nella schermata Progetti:
- Primo deposito: non è un guadagno né una perdita.
- Esempio: capitale di riferimento 50 €, deposito 50 €, saldo reale 50 € -> risultato 0,00 € / 0,00%.
- La performance viene ora calcolata direttamente da saldo, depositi e prelievi e non si fida di vecchi gainEuro salvati da versioni precedenti.
- All'avvio l'intero storico viene ricalcolato automaticamente e salvato.
