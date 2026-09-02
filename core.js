(function (global) {
  "use strict";
  function localISODate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function parseLocalDate(iso) { const [y,m,d]=String(iso).split("-").map(Number); return new Date(y,m-1,d); }
  function daysBetween(a,b) { const [ay,am,ad]=String(a).split("-").map(Number), [by,bm,bd]=String(b).split("-").map(Number); return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000); }
  function tradingGain(previousBalance, finalBalance, deposit=0, withdrawal=0) { return Number(finalBalance)-Number(previousBalance)-Number(deposit)+Number(withdrawal); }
  function gainPercent(gain, capitalReference) { return capitalReference>0 ? gain/capitalReference*100 : 0; }
  function recalculateEntries(project) { let previous=0; const entries=[...(project.entries||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date)) || String(a.timestamp||"").localeCompare(String(b.timestamp||""))); entries.forEach(e=>{ e.deposito=Number(e.deposito)||0; e.prelievo=Number(e.prelievo)||0; e.inizio=previous; e.fine=Number(e.fine)||0; e.gainEuro=tradingGain(previous,e.fine,e.deposito,e.prelievo); e.gainPercent=gainPercent(e.gainEuro,Number(project.capitaleIniziale)||0); previous=e.fine; }); project.entries=entries; return project; }
  global.BankrollCore={localISODate,parseLocalDate,daysBetween,tradingGain,gainPercent,recalculateEntries};
})(typeof window!=="undefined"?window:globalThis);
