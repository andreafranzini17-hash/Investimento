(function () {
  "use strict";

  const $app = document.getElementById("app");

  const fmtEuro = (n) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(
      Number.isFinite(n) ? n : 0
    );
  const fmtPct = (n, digits = 2) => `${Number.isFinite(n) ? n.toFixed(digits) : "0.00"}%`;
  const escapeHTML = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const parseLocalDate = (iso) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const fmtDate = (d) => parseLocalDate(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const isoFromLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayISO = () => isoFromLocalDate(new Date());
  const daysBetween = (a, b) => Math.round((Date.UTC(...String(b).split("-").map((v, i) => i === 1 ? Number(v) - 1 : Number(v))) - Date.UTC(...String(a).split("-").map((v, i) => i === 1 ? Number(v) - 1 : Number(v)))) / 86400000);
  const addDays = (iso, n) => { const d = parseLocalDate(iso); d.setDate(d.getDate() + Math.round(n)); return isoFromLocalDate(d); };
  const newId = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : "p_" + Date.now() + "_" + Math.random().toString(36).slice(2));

  // Configurazione Firebase del progetto. La sicurezza dei dati è gestita da Authentication e dalle regole Firestore.
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC-pTZ7aqdRVcSiLYImyE9Z3mmzqCsSNnw",
    authDomain: "investimento-120ae.firebaseapp.com",
    projectId: "investimento-120ae",
    storageBucket: "investimento-120ae.firebasestorage.app",
    messagingSenderId: "705759841870",
    appId: "1:705759841870:web:6685dca9af6324093f3d1f"
  };

  const store = {
    getProjects() { try { return JSON.parse(localStorage.getItem("bf_projects")) || []; } catch (e) { return []; } },
    setProjects(list) { localStorage.setItem("bf_projects", JSON.stringify(list)); },
    getActiveId() { return localStorage.getItem("bf_active_id") || null; },
    setActiveId(id) { localStorage.setItem("bf_active_id", id || ""); },
    getFirebaseConfig() { try { return JSON.parse(localStorage.getItem("bf_firebase_config")) || DEFAULT_FIREBASE_CONFIG; } catch (e) { return DEFAULT_FIREBASE_CONFIG; } },
    setFirebaseConfig(cfg) { localStorage.setItem("bf_firebase_config", JSON.stringify(cfg)); },
    clearFirebaseConfig() { localStorage.removeItem("bf_firebase_config"); },
    migrateLegacy() {
      const already = localStorage.getItem("bf_projects");
      if (already) return;
      try {
        const legacyConfig = JSON.parse(localStorage.getItem("bf_config"));
        const legacyEntries = JSON.parse(localStorage.getItem("bf_entries")) || [];
        if (legacyConfig) {
          const p = {
            id: newId(), nome: "Progetto 1", stato: "aperto", chiusoIl: null,
            capitaleIniziale: legacyConfig.capitaleIniziale, dataInizio: legacyConfig.dataInizio,
            dataObiettivo: legacyConfig.dataObiettivo, budgetTarget: legacyConfig.budgetTarget,
            stakePercent: legacyConfig.stakePercent, entries: legacyEntries,
          };
          this.setProjects([p]);
          this.setActiveId(p.id);
        }
      } catch (e) {}
    },
  };
  store.migrateLegacy();

  let state = {
    projects: store.getProjects(),
    activeId: store.getActiveId(),
    editingSetup: false,
    creatingNew: false,
    error: "",
    dailyInput: "",
    depositoInput: "",
    prelievoInput: "",
    stakeEdit: false,
    page: "progetti",
    authUser: null,
    syncError: "",
    syncMode: "google",
    configInput: "",
    askingFirstDeposit: false,
    projectDraft: null,
    firstDepositInput: "",
  };

  // Normalizzazione e migrazione non distruttiva dei dati esistenti.
  state.projects.forEach((p) => {
    p.entries = Array.isArray(p.entries) ? p.entries : [];
    p.entries.forEach((en) => {
      en.deposito = Number(en.deposito) || 0;
      en.prelievo = Number(en.prelievo) || 0;
      en.fine = Number(en.fine) || 0;
      en.stakePercent = Number(en.stakePercent ?? p.stakePercent) || 0;
    });
  });

  // Migrazione robusta: il capitale di riferimento NON è mai un deposito.
  // Per i progetti creati dalle versioni precedenti, se il primo movimento
  // rappresenta il saldo iniziale ma il deposito non è stato salvato, lo
  // riconosciamo come deposito iniziale. Questo evita il falso -100%.
  state.projects.forEach((p) => {
    p.entries = Array.isArray(p.entries) ? p.entries : [];
    if (p.entries.length) {
      const first = p.entries[0];
      const fine = Number(first.fine) || 0;
      const dep = Number(first.deposito) || 0;
      if (first.tipo === "deposito_iniziale" || first.initialDeposit === true || (dep === 0 && fine > 0 && (Number(first.inizio) || 0) === 0)) {
        first.tipo = "deposito_iniziale";
        first.initialDeposit = true;
        first.deposito = fine;
      }
    }
    ricalcolaCatena(p);
  });
  store.setProjects(state.projects);

  function setState(patch) { state = { ...state, ...patch }; render(); }

  function attivo() { return state.projects.find((p) => p.id === state.activeId) || null; }
  function saldoRealeOf(p) { return p.entries.length ? Number(p.entries[p.entries.length - 1].fine) || 0 : 0; }

  // Calcola la performance direttamente dai dati finanziari reali.
  // Non si fida del gainEuro salvato, perché progetti creati con versioni precedenti
  // potrebbero contenere un valore storico errato (es. primo deposito = -50 €).
  function saldoPerformanceOf(p) {
    const entries = Array.isArray(p.entries) ? p.entries.slice() : [];
    entries.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    let prevFine = 0;
    let totale = 0;
    for (const en of entries) {
      const fine = Number(en.fine) || 0;
      const deposito = Number(en.deposito) || 0;
      const prelievo = Number(en.prelievo) || 0;
      const isInitialDeposit = en.tipo === "deposito_iniziale" || en.initialDeposit === true;
      totale += isInitialDeposit ? 0 : (fine - prevFine - deposito + prelievo);
      prevFine = fine;
    }
    return totale;
  } // profitto/perdita puro di trading: depositi e prelievi non incidono
  function totaliMovimentiOf(p) {
    return p.entries.reduce((acc, en) => ({ depositi: acc.depositi + (en.deposito || 0), prelievi: acc.prelievi + (en.prelievo || 0) }), { depositi: 0, prelievi: 0 });
  }
  function persistProjects() {
    store.setProjects(state.projects);
    store.setActiveId(state.activeId);
    writeToCloud();
  }

  // ---------------- Sincronizzazione cloud (Firebase, opzionale) ----------------
  let fbApp = null, fbAuth = null, fbDb = null, fbUnsub = null;
  let suppressCloudWrite = false;

  function utenteStaScrivendo() {
    return state.editingSetup || state.creatingNew || !!state.dailyInput || !!state.depositoInput || !!state.prelievoInput || !!state.configInput;
  }

  function parseFirebaseConfigInput(text) {
    try {
      const match = text.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\n\})/) || text.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\})/);
      let cleaned = match ? match[1] : text.trim();
      cleaned = cleaned.replace(/^\s*(export\s+)?(const|var|let)\s+\w+\s*=\s*/, "");
      cleaned = cleaned.replace(/;\s*$/, "");
      // Accetta esclusivamente JSON: non eseguire mai testo incollato come JavaScript.
      const normalized = cleaned
        .replace(/([,{]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,\s*}/g, '}');
      const obj = JSON.parse(normalized);
      if (obj && obj.apiKey && obj.projectId) return obj;
      return null;
    } catch (e) { return null; }
  }

  function initFirebaseIfConfigured() {
    const cfg = store.getFirebaseConfig();
    if (!cfg || typeof firebase === "undefined") return;
    try {
      fbApp = firebase.apps && firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(cfg);
      fbAuth = firebase.auth();
      fbDb = firebase.firestore();
      fbAuth.onAuthStateChanged((user) => {
        state.authUser = user ? { email: user.email, uid: user.uid } : null;
        if (user) subscribeCloud(user.uid); else unsubscribeCloud();
        render();
      });
    } catch (e) {
      state.syncError = "Errore nell'inizializzazione di Firebase: " + (e && e.message ? e.message : String(e));
    }
  }

  function subscribeCloud(uid) {
    unsubscribeCloud();
    fbUnsub = fbDb.collection("users").doc(uid).onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        suppressCloudWrite = true;
        if (data.projects) {
          state.projects = data.projects;
          state.activeId = data.activeId || (data.projects[0] && data.projects[0].id) || null;
        } else if (data.config) {
          // migrazione dal formato precedente (progetto singolo)
          const p = {
            id: newId(), nome: "Progetto 1", stato: "aperto", chiusoIl: null,
            capitaleIniziale: data.config.capitaleIniziale, dataInizio: data.config.dataInizio,
            dataObiettivo: data.config.dataObiettivo, budgetTarget: data.config.budgetTarget,
            stakePercent: data.config.stakePercent, entries: data.entries || [],
          };
          state.projects = [p];
          state.activeId = p.id;
        }
        store.setProjects(state.projects);
        store.setActiveId(state.activeId);
        suppressCloudWrite = false;
        if (!utenteStaScrivendo()) render();
      } else if (state.projects.length) {
        writeToCloud();
      }
    }, (err) => {
      state.syncError = "Errore di sincronizzazione: " + (err && err.message ? err.message : String(err));
      if (!utenteStaScrivendo()) render();
    });
  }

  function unsubscribeCloud() { if (fbUnsub) { fbUnsub(); fbUnsub = null; } }

  async function signInWithGoogle() {
    if (!fbAuth || typeof firebase === "undefined") return;
    state.syncError = "";
    render();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await fbAuth.signInWithPopup(provider);
    } catch (err) {
      const code = err && err.code ? err.code : "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await fbAuth.signInWithRedirect(provider);
        return;
      }
      state.syncError = "Errore nell'accesso con Google: " + (err && err.message ? err.message : String(err));
      render();
    }
  }

  function writeToCloud() {
    if (suppressCloudWrite || !fbAuth || !fbAuth.currentUser || !fbDb) return;
    fbDb.collection("users").doc(fbAuth.currentUser.uid).set({ projects: state.projects, activeId: state.activeId }).catch((err) => {
      state.syncError = "Errore nel salvataggio cloud: " + (err && err.message ? err.message : String(err));
      if (!utenteStaScrivendo()) render();
    });
  }

  // ---------------- Setup form (nuovo progetto o modifica) ----------------
  function renderSetup() {
    const editing = state.editingSetup;
    const p = editing ? attivo() : null;
    const f = state.setupForm || {
      nome: p ? p.nome : "",
      capitaleIniziale: p ? String(p.capitaleIniziale) : "",
      budgetTarget: p ? String(p.budgetTarget) : "",
      dataObiettivo: p ? p.dataObiettivo : "",
      stakePercent: p ? String(p.stakePercent) : "2",
    };
    $app.innerHTML = `
      ${state.projects.length ? `<button id="backBtn" class="btn-small" style="margin-bottom:1rem;">← Indietro</button>` : ""}
      <div class="eyebrow">Bankroll tracker</div>
      <div class="title" style="margin-bottom:1.4rem;">${editing ? "Modifica progetto" : "Nuovo progetto"}</div>
      <form id="setupForm" class="card">
        <div class="label">Nome progetto</div>
        <input id="f_nome" type="text" placeholder="es. Ciclo autunno 2026" value="${escapeHTML(f.nome)}">
        <div class="label">Capitale di riferimento (€)</div>
        <div class="muted" style="font-size:11px;margin-bottom:6px;">usato solo per calcolare le %, non deve corrispondere a un deposito reale</div>
        <input id="f_capitale" type="number" step="0.01" placeholder="1000" value="${f.capitaleIniziale}">
        <div class="label">Profitto netto da raggiungere (€)</div>
        <div class="muted" style="font-size:11px;margin-bottom:6px;">quanto vuoi guadagnare in totale, al netto di depositi/prelievi</div>
        <input id="f_target" type="number" step="0.01" placeholder="5000" value="${f.budgetTarget}">
        <div class="label">Data obiettivo</div>
        <input id="f_data" type="date" min="${todayISO()}" value="${f.dataObiettivo}">
        <div class="label">Stake % (sul saldo reale)</div>
        <input id="f_stake" type="number" step="0.1" placeholder="2" value="${f.stakePercent}" style="margin-bottom:0;">
        ${state.error ? `<div class="error">${state.error}</div>` : ""}
        <button type="submit" class="btn-primary" style="margin-top:1rem;">${editing ? "Salva modifiche" : "Crea progetto"}</button>
      </form>
    `;
    document.getElementById("setupForm").addEventListener("submit", onSetupSubmit);
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", () => setState({ editingSetup: false, creatingNew: false, error: "", setupForm: null, editReturnPage: null, page: state.editReturnPage || "progetti" }));
    ["f_nome", "f_capitale", "f_target", "f_data", "f_stake"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        state.setupForm = {
          nome: document.getElementById("f_nome").value,
          capitaleIniziale: document.getElementById("f_capitale").value,
          budgetTarget: document.getElementById("f_target").value,
          dataObiettivo: document.getElementById("f_data").value,
          stakePercent: document.getElementById("f_stake").value,
        };
      });
    });
  }

  function onSetupSubmit(e) {
    e.preventDefault();
    try {
      const nome = document.getElementById("f_nome").value.trim();
      const capitaleIniziale = parseFloat(document.getElementById("f_capitale").value);
      const budgetTarget = parseFloat(document.getElementById("f_target").value);
      const stakePercent = parseFloat(document.getElementById("f_stake").value);
      const dataObiettivo = document.getElementById("f_data").value;

      if (!capitaleIniziale || capitaleIniziale <= 0) return setState({ error: "Inserisci un capitale di riferimento valido." });
      if (!budgetTarget || budgetTarget <= 0) return setState({ error: "Inserisci un profitto obiettivo valido." });
      if (!dataObiettivo) return setState({ error: "Inserisci una data obiettivo." });
      if (daysBetween(todayISO(), dataObiettivo) <= 0) return setState({ error: "La data obiettivo deve essere futura." });
      if (!stakePercent || stakePercent <= 0) return setState({ error: "Inserisci una percentuale di stake valida." });

      if (state.editingSetup) {
        const p = attivo();
        p.nome = nome || p.nome;
        p.capitaleIniziale = capitaleIniziale;
        p.budgetTarget = budgetTarget;
        p.dataObiettivo = dataObiettivo;
        p.stakePercent = stakePercent;
        const tornaA = state.editReturnPage || "progetti";
        setState({ editingSetup: false, error: "", setupForm: null, editReturnPage: null, page: tornaA });
        persistProjects();
      } else {
        const draft = {
          id: newId(), nome: nome || `Progetto ${state.projects.length + 1}`, stato: "aperto", chiusoIl: null,
          capitaleIniziale, dataInizio: todayISO(), dataObiettivo, budgetTarget, stakePercent, entries: [],
        };
        setState({ creatingNew: false, error: "", setupForm: null, askingFirstDeposit: true, projectDraft: draft, firstDepositInput: "" });
      }
    } catch (err) {
      setState({ error: "Errore imprevisto: " + (err && err.message ? err.message : String(err)) });
    }
  }

  function renderPrimoDeposito() {
    const d = state.projectDraft;
    $app.innerHTML = `
      <div class="eyebrow">Bankroll tracker</div>
      <div class="title" style="margin-bottom:0.3rem;">Primo deposito</div>
      <div class="muted" style="font-size:12px;margin-bottom:1.4rem;">"${escapeHTML(d.nome)}" è pronto — quanto versi ora, per davvero, su Betfair?</div>
      <form id="firstDepositForm" class="card">
        <div class="label">Primo deposito reale (€)</div>
        <input id="firstDepositInput" type="number" step="0.01" placeholder="es. 100" value="${state.firstDepositInput}" autofocus>
        ${state.error ? `<div class="error">${state.error}</div>` : ""}
        <button type="submit" class="btn-primary" style="margin-top:0.8rem;">Conferma deposito</button>
        <button type="button" id="skipDepositBtn" class="btn-ghost">Non deposito ancora, salta</button>
      </form>
    `;
    document.getElementById("firstDepositForm").addEventListener("submit", onFirstDepositSubmit);
    document.getElementById("firstDepositInput").addEventListener("input", (e) => { state.firstDepositInput = e.target.value; });
    document.getElementById("skipDepositBtn").addEventListener("click", () => finalizzaNuovoProgetto(null));
  }

  function onFirstDepositSubmit(e) {
    e.preventDefault();
    const importo = parseFloat(document.getElementById("firstDepositInput").value);
    if (!Number.isFinite(importo) || importo <= 0) return setState({ error: "Inserisci un importo valido." });
    finalizzaNuovoProgetto(importo);
  }

  function finalizzaNuovoProgetto(primoDeposito) {
    const p = state.projectDraft;
    if (primoDeposito) {
      p.entries.push({
        date: p.dataInizio, timestamp: new Date().toISOString(),
        tipo: "deposito_iniziale", initialDeposit: true,
        inizio: 0, fine: primoDeposito, deposito: primoDeposito, prelievo: 0,
        gainEuro: 0, gainPercent: 0, stakePercent: p.stakePercent, stakeConsigliato: primoDeposito * (p.stakePercent / 100),
      });
    }
    const newProjects = [...state.projects, p];
    setState({ projects: newProjects, activeId: p.id, askingFirstDeposit: false, projectDraft: null, firstDepositInput: "", error: "", page: "dashboard" });
    persistProjects();
  }

  // ---------------- Derived numbers ----------------
  function computeDerived(p) {
    const giorniTotali = daysBetween(p.dataInizio, p.dataObiettivo);
    const giorniTrascorsi = Math.max(0, daysBetween(p.dataInizio, todayISO()));

    const reale = saldoRealeOf(p);
    const perf = saldoPerformanceOf(p); // profitto netto di trading puro, da 0
    const movimenti = totaliMovimentiOf(p);
    const flussoDP = movimenti.prelievi - movimenti.depositi;
    const flussoDPPercent = p.capitaleIniziale > 0 ? (flussoDP / p.capitaleIniziale) * 100 : 0;
    const cumGainEuro = perf;
    const cumGainPercent = p.capitaleIniziale > 0 ? (perf / p.capitaleIniziale) * 100 : 0;

    // curva di riferimento LINEARE (il target e' un profitto netto assoluto, non piu'
    // una crescita composta legata al CI): a meta' percorso, dovresti aver fatto meta'
    // del profitto obiettivo, e cosi' via.
    const teoricoOggi = giorniTotali > 0 ? p.budgetTarget * (giorniTrascorsi / giorniTotali) : 0;
    const scostamentoEuro = perf - teoricoOggi;

    let dEquiv = giorniTrascorsi, dataEquiv = todayISO(), scostamentoGiorni = 0;
    if (p.budgetTarget > 0) {
      dEquiv = (perf / p.budgetTarget) * giorniTotali;
      dataEquiv = addDays(p.dataInizio, dEquiv);
      scostamentoGiorni = Math.round(dEquiv - giorniTrascorsi);
    }

    const giorniRimanentiOggi = Math.max(0, daysBetween(todayISO(), p.dataObiettivo));
    const importoRimanente = p.budgetTarget - perf;
    let mediaGiornoDinamica = 0;
    if (giorniRimanentiOggi > 0) mediaGiornoDinamica = importoRimanente / giorniRimanentiOggi;

    // tasso composto necessario, calcolato sul saldo REALE (non sul CI, che e' arbitrario):
    // "di che % al giorno deve crescere il mio saldo vero per arrivare al profitto
    // obiettivo nei giorni rimanenti". Ben definito solo se hai gia' un saldo reale > 0
    // (cioe' almeno un deposito fatto) e manca ancora profitto da fare.
    let rateComposto = null;
    if (reale > 0 && giorniRimanentiOggi > 0 && importoRimanente > 0) {
      rateComposto = Math.pow(1 + importoRimanente / reale, 1 / giorniRimanentiOggi) - 1;
    } else if (importoRimanente <= 0) {
      rateComposto = 0;
    }

    const prossimoStake = reale * (p.stakePercent / 100);
    const mov = totaliMovimentiOf(p);
    // Flusso esterno: prelievi positivi, depositi negativi.
    // Non è un profitto trading: indica soltanto il denaro entrato/uscito dalle tue tasche.
    const flussoDPNetto = mov.prelievi - mov.depositi;

    return {
      giorniTotali, giorniTrascorsi, giorniRimanentiOggi,
      reale, perf, cumGainEuro, cumGainPercent, scostamentoEuro, scostamentoGiorni, dataEquiv,
      mediaGiornoDinamica, rateComposto, prossimoStake, importoRimanente, mov, flussoDPNetto,
    };
  }

  function renderChart(p, giorniTotali) {
    const w = 400, h = 140, padL = 34, padB = 16, padT = 8, padR = 4;
    const points = [];
    for (let d = 0; d <= giorniTotali; d++) points.push({ d, teorico: giorniTotali > 0 ? p.budgetTarget * (d / giorniTotali) : 0 });

    // un solo punto per giornata di calendario: se ci sono piu' registrazioni nello
    // stesso giorno, il grafico mostra solo il valore cumulato di fine giornata,
    // evitando uno zig-zag visivo sullo stesso "giorno" sull'asse X.
    const cumPerDay = {};
    let running = 0;
    p.entries.forEach((en) => { running += en.gainEuro; cumPerDay[daysBetween(p.dataInizio, en.date)] = running; });
    const perfPoints = [{ d: 0, v: 0 }, ...Object.keys(cumPerDay).map(Number).sort((a, b) => a - b).map((d) => ({ d, v: cumPerDay[d] }))];

    const allVals = [p.budgetTarget, 0, ...perfPoints.map((pt) => pt.v)];
    const maxVal = Math.max(...allVals) * 1.05 || 1;
    const minVal = Math.min(...allVals) * 1.05;
    const xScale = (d) => padL + (Math.min(d, giorniTotali) / giorniTotali) * (w - padL - padR);
    const yScale = (v) => padT + (1 - (v - minVal) / (maxVal - minVal)) * (h - padT - padB);

    const teoricoPath = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${xScale(pt.d).toFixed(1)} ${yScale(pt.teorico).toFixed(1)}`).join(" ");
    const perfPath = perfPoints.map((pt, i) => `${i === 0 ? "M" : "L"} ${xScale(pt.d).toFixed(1)} ${yScale(pt.v).toFixed(1)}`).join(" ");

    const gridLines = [0, 0.5, 1].map((t) => {
      const v = minVal + t * (maxVal - minVal);
      return `<line x1="${padL}" y1="${yScale(v).toFixed(1)}" x2="${w - padR}" y2="${yScale(v).toFixed(1)}" stroke="rgba(232,236,241,0.08)" />
              <text x="2" y="${(yScale(v) + 3).toFixed(1)}" font-size="9" fill="#8592A8">${Math.round(v)}</text>`;
    }).join("");

    return `
      <svg viewBox="0 0 ${w} ${h}" class="chart-wrap" preserveAspectRatio="xMidYMid meet" style="width:100%;height:140px;">
        ${gridLines}
        <path d="${teoricoPath}" fill="none" stroke="#8592A8" stroke-width="1.5" stroke-dasharray="4 3" />
        <path d="${perfPath}" fill="none" stroke="#D4A94E" stroke-width="2" />
        ${perfPoints.map((pt) => `<circle cx="${xScale(pt.d).toFixed(1)}" cy="${yScale(pt.v).toFixed(1)}" r="2.5" fill="#D4A94E" />`).join("")}
      </svg>
    `;
  }

  function renderTabbar() {
    return `
      <div class="tabbar">
        <button class="tab ${state.page === "dashboard" ? "active" : ""}" data-page="dashboard">Dashboard</button>
        <button class="tab ${state.page === "statistiche" ? "active" : ""}" data-page="statistiche">Stats</button>
        <button class="tab ${state.page === "storico" ? "active" : ""}" data-page="storico">Storico</button>
        <button class="tab ${state.page === "progetti" ? "active" : ""}" data-page="progetti">Progetti</button>
      </div>
    `;
  }
  function bindTabbar() {
    document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => setState({ page: btn.dataset.page, error: "" })));
  }

  // ---------------- Cedola mensile ----------------
  function isLastDayOfMonth(iso) {
    const d = new Date(iso);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === lastDay;
  }
  function meseKey(y, m) { return `${y}-${String(m + 1).padStart(2, "0")}`; }
  function meseDaNotificare(todayIso) {
    const d = new Date(todayIso);
    if (isLastDayOfMonth(todayIso)) return meseKey(d.getFullYear(), d.getMonth());
    const prevMonthDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return meseKey(prevMonthDate.getFullYear(), prevMonthDate.getMonth());
  }
  function profittoMese(p, key) {
    const [y, m] = key.split("-").map(Number);
    return p.entries.filter((en) => { const e = new Date(en.date); return e.getFullYear() === y && e.getMonth() === m - 1; }).reduce((s, en) => s + en.gainEuro, 0);
  }
  function haEntrateNelMese(p, key) {
    const [y, m] = key.split("-").map(Number);
    return p.entries.some((en) => { const e = new Date(en.date); return e.getFullYear() === y && e.getMonth() === m - 1; });
  }
  function cedolaMeseDismesso(key) { return localStorage.getItem("bf_cedola_dismissed_month_" + state.activeId) === key; }
  function dismissCedolaMese(key) { localStorage.setItem("bf_cedola_dismissed_month_" + state.activeId, key); }

  // ---------------- Statistiche ----------------
  function computeStats(p) {
    const entries = p.entries;
    const n = entries.length;
    if (n === 0) return null;

    const positivi = entries.filter((e) => e.gainEuro > 0);
    const negativi = entries.filter((e) => e.gainEuro < 0);
    const pari = entries.filter((e) => e.gainEuro === 0);

    const winRate = (positivi.length / n) * 100;
    const sommaVincite = positivi.reduce((s, e) => s + e.gainEuro, 0);
    const sommaPerdite = Math.abs(negativi.reduce((s, e) => s + e.gainEuro, 0));
    const profitFactor = sommaPerdite > 0 ? sommaVincite / sommaPerdite : (sommaVincite > 0 ? Infinity : 0);
    const mediaVincita = positivi.length ? sommaVincite / positivi.length : 0;
    const mediaPerdita = negativi.length ? negativi.reduce((s, e) => s + e.gainEuro, 0) / negativi.length : 0;
    const mediaGiornaliera = entries.reduce((s, e) => s + e.gainEuro, 0) / n;

    let migliore = entries[0], peggiore = entries[0];
    entries.forEach((e) => { if (e.gainEuro > migliore.gainEuro) migliore = e; if (e.gainEuro < peggiore.gainEuro) peggiore = e; });

    let streakAttualeTipo = null, streakAttuale = 0;
    for (let i = n - 1; i >= 0; i--) {
      const seg = entries[i].gainEuro > 0 ? "pos" : entries[i].gainEuro < 0 ? "neg" : "zero";
      if (i === n - 1) { streakAttualeTipo = seg; streakAttuale = seg === "zero" ? 0 : 1; if (seg === "zero") break; }
      else { if (seg === streakAttualeTipo) streakAttuale++; else break; }
    }

    let maxPos = 0, maxNeg = 0, curPos = 0, curNeg = 0;
    entries.forEach((e) => {
      if (e.gainEuro > 0) { curPos++; curNeg = 0; } else if (e.gainEuro < 0) { curNeg++; curPos = 0; } else { curPos = 0; curNeg = 0; }
      if (curPos > maxPos) maxPos = curPos;
      if (curNeg > maxNeg) maxNeg = curNeg;
    });

    return { n, positivi: positivi.length, negativi: negativi.length, pari: pari.length, winRate, profitFactor, mediaVincita, mediaPerdita, mediaGiornaliera, migliore, peggiore, streakAttualeTipo, streakAttuale, maxPos, maxNeg };
  }

  function renderStatistiche() {
    const p = attivo();
    const s = p ? computeStats(p) : null;
    $app.innerHTML = `
      ${renderTabbar()}
      <div class="title" style="margin-bottom:1rem;">Statistiche — ${p ? p.nome : ""}</div>
      ${!s ? `<div class="card muted" style="text-align:center;">Nessun dato ancora — registra almeno una giornata.</div>` : `
        <div class="grid-2">
          <div class="card">
            <div class="label">Giornate registrate</div>
            <div class="mono" style="font-size:20px;font-weight:600;">${s.n}</div>
          </div>
          <div class="card">
            <div class="label">Win rate</div>
            <div class="mono gold" style="font-size:20px;font-weight:600;">${fmtPct(s.winRate, 1)}</div>
          </div>
        </div>

        <div class="card">
          <div class="label">Fattore di profitto</div>
          <div class="mono ${s.profitFactor >= 1 ? "green" : "red"}" style="font-size:22px;font-weight:600;">
            ${s.profitFactor === Infinity ? "∞ (solo vincite)" : s.profitFactor.toFixed(2) + "x"}
          </div>
          <div class="muted" style="font-size:12px;margin-top:2px;">guadagni totali ÷ perdite totali — sopra 1 sei in profitto complessivo</div>
        </div>

        <div class="card">
          <div class="label" style="margin-bottom:10px;">Giornate per esito</div>
          <div class="pace-grid">
            <div><div class="muted" style="font-size:11px;">Positive</div><div class="mono green" style="font-size:16px;font-weight:600;">${s.positivi}</div></div>
            <div><div class="muted" style="font-size:11px;">Negative</div><div class="mono red" style="font-size:16px;font-weight:600;">${s.negativi}</div></div>
            <div><div class="muted" style="font-size:11px;">Pari</div><div class="mono" style="font-size:16px;font-weight:600;">${s.pari}</div></div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card"><div class="label">Media vincita</div><div class="mono green" style="font-size:16px;font-weight:600;">+${fmtEuro(s.mediaVincita)}</div></div>
          <div class="card"><div class="label">Media perdita</div><div class="mono red" style="font-size:16px;font-weight:600;">${fmtEuro(s.mediaPerdita)}</div></div>
        </div>

        <div class="card">
          <div class="label">Media giornaliera complessiva</div>
          <div class="mono ${s.mediaGiornaliera >= 0 ? "green" : "red"}" style="font-size:18px;font-weight:600;">${s.mediaGiornaliera >= 0 ? "+" : ""}${fmtEuro(s.mediaGiornaliera)}</div>
        </div>

        <div class="grid-2">
          <div class="card"><div class="label">Miglior giornata</div><div class="mono green" style="font-size:16px;font-weight:600;">+${fmtEuro(s.migliore.gainEuro)}</div><div class="muted" style="font-size:12px;margin-top:2px;">${fmtDate(s.migliore.date)}</div></div>
          <div class="card"><div class="label">Peggior giornata</div><div class="mono red" style="font-size:16px;font-weight:600;">${fmtEuro(s.peggiore.gainEuro)}</div><div class="muted" style="font-size:12px;margin-top:2px;">${fmtDate(s.peggiore.date)}</div></div>
        </div>

        <div class="card">
          <div class="label">Streak attuale</div>
          <div class="mono ${s.streakAttualeTipo === "pos" ? "green" : s.streakAttualeTipo === "neg" ? "red" : ""}" style="font-size:18px;font-weight:600;">
            ${s.streakAttuale === 0 ? "—" : `${s.streakAttuale} giorni ${s.streakAttualeTipo === "pos" ? "positivi" : "negativi"} di fila`}
          </div>
        </div>

        <div class="grid-2">
          <div class="card"><div class="label">Record positivo</div><div class="mono green" style="font-size:16px;font-weight:600;">${s.maxPos} giorni di fila</div></div>
          <div class="card"><div class="label">Record negativo</div><div class="mono red" style="font-size:16px;font-weight:600;">${s.maxNeg} giorni di fila</div></div>
        </div>
      `}
    `;
    bindTabbar();
  }

  // ---------------- Dashboard ----------------
  function renderDashboard() {
    const p = attivo();
    if (!p) { setState({ page: "progetti" }); return; }
    const chiuso = p.stato === "chiuso";
    const d = computeDerived(p);

    $app.innerHTML = `
      ${renderTabbar()}
      <div class="header-row">
        <div>
          <div class="eyebrow">${p.nome}${chiuso ? " · CHIUSO" : ""}</div>
          <div class="label" style="margin-bottom:4px;">💸 Flusso D/P netto</div>
          <div class="title mono ${d.flussoDP >= 0 ? "green" : "red"}">${d.flussoDP >= 0 ? "+" : ""}${fmtEuro(d.flussoDP)}</div>
          <div style="font-size:13px;margin-bottom:10px;">
            <span class="mono ${d.flussoDP >= 0 ? "green" : "red"}">${d.flussoDP >= 0 ? "+" : ""}${fmtPct(d.flussoDPPercent)}</span>
          </div>
          <div class="muted" style="font-size:12px;">🏦 Saldo conto: <span class="mono">${fmtEuro(d.reale)}</span> · 📈 Trading: <span class="mono ${d.perf >= 0 ? "green" : "red"}">${d.perf >= 0 ? "+" : ""}${fmtEuro(d.perf)}</span></div>
        </div>
        <button id="editBtn" class="btn-small">Modifica</button>
      </div>

      <div style="margin-bottom:0.9rem;">
        <button id="syncBtn" class="btn-small" style="width:100%;text-align:left;">
          ${state.authUser ? `🔄 Sincronizzato · ${state.authUser.email}` : "🔄 Sincronizza dispositivi"}
        </button>
      </div>

      ${chiuso ? `
        <div class="card" style="border-color:#8592A8;">
          <div class="label" style="margin-bottom:4px;">Progetto chiuso il ${fmtDate(p.chiusoIl)}</div>
          <div class="muted" style="font-size:12px;">Puoi consultare Statistiche e Storico, ma non registrare nuove giornate qui. Vai su "Progetti" per aprirne uno nuovo.</div>
        </div>
      ` : (() => {
        const key = meseDaNotificare(todayISO());
        if (cedolaMeseDismesso(key) || !haEntrateNelMese(p, key)) return "";
        const profitto = profittoMese(p, key);
        const cedola = profitto * 0.30;
        const [yy, mm] = key.split("-").map(Number);
        const nomeMese = new Date(yy, mm - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
        return `
        <div class="card" style="border-color:#D4A94E;">
          <div class="label" style="margin-bottom:4px;">📅 Cedola di ${nomeMese}</div>
          ${profitto > 0 ? `
            <div class="muted" style="font-size:12px;margin-bottom:8px;">Profitto di trading del mese: <span class="mono green">+${fmtEuro(profitto)}</span></div>
            <div class="gold mono" style="font-size:22px;font-weight:600;margin-bottom:8px;">${fmtEuro(cedola)}</div>
            <div class="muted" style="font-size:12px;margin-bottom:10px;">30% del profitto del mese — è il momento di prelevarla.</div>
          ` : `
            <div class="muted" style="font-size:13px;margin-bottom:10px;">Il mese ha un profitto di trading pari a ${fmtEuro(profitto)} — niente cedola questo mese.</div>
          `}
          <button id="dismissCedolaBtn" data-key="${key}" class="btn-ghost" style="margin-top:0;">Ho capito</button>
        </div>
      `; })()}

      ${(d.mov.depositi > 0 || d.mov.prelievi > 0) ? `
        <div class="card">
          <div class="label" style="margin-bottom:10px;">Riepilogo movimenti</div>
          <div class="grid-2" style="margin-bottom:10px;">
            <div><div class="muted" style="font-size:11px;">Depositi totali</div><div class="mono red">-${fmtEuro(d.mov.depositi)}</div></div>
            <div><div class="muted" style="font-size:11px;">Prelievi totali</div><div class="mono green">+${fmtEuro(d.mov.prelievi)}</div></div>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">
            <div class="muted" style="font-size:11px;">Flusso D/P netto</div>
            <div class="mono ${d.flussoDPNetto >= 0 ? "green" : "red"}" style="font-size:18px;font-weight:600;">${d.flussoDPNetto >= 0 ? "+" : ""}${fmtEuro(d.flussoDPNetto)}</div>
            <div class="muted" style="font-size:11px;margin-top:3px;">Prelievi − Depositi</div>
          </div>
        </div>
      ` : ""}

      <div class="grid-2">
        <div class="card">
          <div class="label">Obiettivo (profitto netto)</div>
          <div class="mono" style="font-size:17px;font-weight:600;">${fmtEuro(p.budgetTarget)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">entro il ${fmtDate(p.dataObiettivo)}</div>
        </div>
        <div class="card">
          <div class="label">Giorni rimanenti</div>
          <div class="mono" style="font-size:17px;font-weight:600;">${d.giorniRimanentiOggi}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">su ${d.giorniTotali} totali</div>
        </div>
      </div>

      <div class="card">
        <div class="label" style="margin-bottom:2px;">Ritmo necessario da oggi</div>
        <div class="muted" style="font-size:11px;margin-bottom:10px;">€ = media lineare · % = tasso composto sul tuo saldo reale attuale</div>
        <div class="pace-grid">
          <div><div class="muted" style="font-size:11px;">Giorno</div><div class="mono" style="font-size:14px;">${fmtEuro(d.mediaGiornoDinamica)}</div><div class="gold mono" style="font-size:11px;">${d.rateComposto === null ? "—" : fmtPct(d.rateComposto * 100, 3)}</div></div>
          <div><div class="muted" style="font-size:11px;">Settimana</div><div class="mono" style="font-size:14px;">${fmtEuro(d.mediaGiornoDinamica * 7)}</div><div class="gold mono" style="font-size:11px;">${d.rateComposto === null ? "—" : fmtPct((Math.pow(1 + d.rateComposto, 7) - 1) * 100, 2)}</div></div>
          <div><div class="muted" style="font-size:11px;">Mese</div><div class="mono" style="font-size:14px;">${fmtEuro(d.mediaGiornoDinamica * 30.44)}</div><div class="gold mono" style="font-size:11px;">${d.rateComposto === null ? "—" : fmtPct((Math.pow(1 + d.rateComposto, 30.44) - 1) * 100, 2)}</div></div>
        </div>
        ${d.rateComposto === null ? `<div class="muted" style="font-size:11px;margin-top:8px;">La % composta si calcola sul saldo reale — registra il primo deposito per vederla.</div>` : ""}
      </div>

      <div class="card">
        <div class="header-row" style="margin-bottom:6px;">
          <div class="label" style="margin:0;">Vs piano originale (performance pura)</div>
          <div class="mono ${d.scostamentoEuro >= 0 ? "green" : "red"}" style="font-size:13px;font-weight:600;">${d.scostamentoEuro >= 0 ? "+" : ""}${fmtEuro(d.scostamentoEuro)}</div>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:10px;">
          Escludendo depositi/prelievi, la tua performance (${fmtEuro(d.perf)}) era prevista per il <b style="color:#E8ECF1">${fmtDate(d.dataEquiv)}</b> —
          sei <b class="${d.scostamentoGiorni >= 0 ? 'green' : 'red'}">${d.scostamentoGiorni >= 0 ? "in anticipo" : "in ritardo"} di ${Math.abs(d.scostamentoGiorni)} giorni</b>.
        </div>
        ${renderChart(p, d.giorniTotali)}
      </div>

      <div class="card">
        <div class="stake-row">
          <div class="label" style="margin:0;">Stake %</div>
          <div id="stakeArea">
            ${state.stakeEdit
              ? `<div class="stake-edit"><input id="stakeInput" type="number" step="0.1" value="${p.stakePercent}"><button id="stakeSave">OK</button></div>`
              : `<button id="stakeEditBtn" class="stake-link" ${chiuso ? "disabled" : ""}>${p.stakePercent}% ✎</button>`
            }
          </div>
        </div>
        <div class="muted" style="font-size:12px;">Prossimo stake consigliato (sul saldo reale)</div>
        <div class="gold mono" style="font-size:19px;font-weight:600;">${fmtEuro(d.prossimoStake)}</div>
      </div>

      ${!chiuso ? `
        <form id="dailyForm" class="card">
          <div class="label">Data</div>
          <input id="entryDateInput" type="date" max="${todayISO()}" value="${state.entryDateInput || todayISO()}">
          <div class="label">Nuovo saldo reale</div>
          <input id="dailyInput" type="number" step="0.01" placeholder="${d.reale.toFixed(2)}" value="${state.dailyInput}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div class="label" style="font-size:11px;">Depositato (€)</div><input id="depositoInput" type="number" step="0.01" placeholder="0" value="${state.depositoInput}" style="margin-bottom:0.4rem;"></div>
            <div><div class="label" style="font-size:11px;">Prelevato (€)</div><input id="prelievoInput" type="number" step="0.01" placeholder="0" value="${state.prelievoInput}" style="margin-bottom:0.4rem;"></div>
          </div>
          ${state.error ? `<div class="error">${state.error}</div>` : ""}
          <button type="submit" class="btn-primary" style="margin-top:0.4rem;">Registra</button>
        </form>

        <button id="chiudiProgettoBtn" class="btn-ghost">Chiudi questo progetto</button>
      ` : ""}
    `;

    bindTabbar();
    document.getElementById("editBtn").addEventListener("click", () => setState({ editingSetup: true, error: "", page: "dashboard", editReturnPage: "dashboard" }));
    document.getElementById("syncBtn").addEventListener("click", () => setState({ page: "sync" }));
    const dismissCedolaBtn = document.getElementById("dismissCedolaBtn");
    if (dismissCedolaBtn) dismissCedolaBtn.addEventListener("click", () => { dismissCedolaMese(dismissCedolaBtn.dataset.key); render(); });

    if (!chiuso) {
      document.getElementById("dailyForm").addEventListener("submit", onDailySubmit);
      document.getElementById("entryDateInput").addEventListener("input", (e) => { state.entryDateInput = e.target.value; });
      document.getElementById("dailyInput").addEventListener("input", (e) => { state.dailyInput = e.target.value; });
      document.getElementById("depositoInput").addEventListener("input", (e) => { state.depositoInput = e.target.value; });
      document.getElementById("prelievoInput").addEventListener("input", (e) => { state.prelievoInput = e.target.value; });
      document.getElementById("chiudiProgettoBtn").addEventListener("click", () => {
        if (confirm(`Chiudere "${p.nome}"? Non potrai più registrare nuove giornate su questo progetto (resterà consultabile in Statistiche e Storico).`)) {
          p.stato = "chiuso";
          p.chiusoIl = todayISO();
          setState({});
          persistProjects();
        }
      });
    }

    const stakeEditBtn = document.getElementById("stakeEditBtn");
    if (stakeEditBtn) stakeEditBtn.addEventListener("click", () => setState({ stakeEdit: true }));
    const stakeSaveBtn = document.getElementById("stakeSave");
    if (stakeSaveBtn) stakeSaveBtn.addEventListener("click", () => {
      const v = parseFloat(document.getElementById("stakeInput").value);
      if (v && v > 0) { p.stakePercent = v; setState({ stakeEdit: false }); persistProjects(); }
      else setState({ stakeEdit: false });
    });
  }

  function ricalcolaCatena(p) {
    // Il capitale di riferimento NON entra mai nella catena dei saldi.
    // Si parte sempre da zero e solo depositi/prelievi modificano il saldo
    // senza generare automaticamente profitto o perdita.
    let prevFine = 0;
    p.entries = Array.isArray(p.entries) ? p.entries : [];
    p.entries.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    for (let i = 0; i < p.entries.length; i++) {
      const en = p.entries[i];
      const fine = Number(en.fine) || 0;
      const dep = Number(en.deposito) || 0;
      const prel = Number(en.prelievo) || 0;
      // Il primo deposito è sempre un movimento finanziario, non trading.
      // La formula generale è: saldo finale - saldo precedente - depositi + prelievi.
      // Per sicurezza, un movimento marcato come deposito iniziale ha sempre gain 0.
      const g = (en.tipo === "deposito_iniziale" || en.initialDeposit === true)
        ? 0
        : fine - prevFine - dep + prel;
      const stakePercent = Number(en.stakePercent ?? p.stakePercent) || 0;
      p.entries[i] = { ...en, fine, deposito: dep, prelievo: prel, inizio: prevFine, gainEuro: g, gainPercent: p.capitaleIniziale > 0 ? (g / p.capitaleIniziale) * 100 : 0, stakePercent, stakeConsigliato: fine * (stakePercent / 100) };
      prevFine = fine;
    }
  }

  function onDailySubmit(e) {
    e.preventDefault();
    const p = attivo();
    const fine = parseFloat(document.getElementById("dailyInput").value);
    if (!Number.isFinite(fine) || fine < 0) return setState({ error: "Inserisci un saldo valido." });
    const deposito = parseFloat(document.getElementById("depositoInput").value) || 0;
    const prelievo = parseFloat(document.getElementById("prelievoInput").value) || 0;
    if (deposito < 0 || prelievo < 0) return setState({ error: "Depositi e prelievi non possono essere negativi." });
    const data = document.getElementById("entryDateInput").value || todayISO();

    const timestamp = new Date().toISOString();
    p.entries.push({
      date: data, timestamp,
      inizio: 0, fine, deposito, prelievo, gainEuro: 0, gainPercent: 0,
      stakePercent: p.stakePercent, stakeConsigliato: 0,
    });
    // ordina cronologicamente (data, poi timestamp di inserimento a parita' di data)
    // cosi' un movimento retrodatato finisce nel punto giusto della catena
    p.entries.sort((a, b) => (a.date + a.timestamp).localeCompare(b.date + b.timestamp));
    ricalcolaCatena(p);

    setState({ dailyInput: "", depositoInput: "", prelievoInput: "", entryDateInput: null, error: "" });
    persistProjects();
  }

  // ---------------- Storico page ----------------
  function renderStorico() {
    const p = attivo();
    if (!p) { setState({ page: "progetti" }); return; }
    const mov = totaliMovimentiOf(p);
    $app.innerHTML = `
      ${renderTabbar()}
      <div class="title" style="margin-bottom:1rem;">Storico — ${escapeHTML(p.nome)}</div>
      ${(mov.depositi > 0 || mov.prelievi > 0) ? `
        <div class="card" style="padding:0.7rem 1.1rem;">
          <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span class="muted">Depositi totali: <span class="mono red">+${fmtEuro(mov.depositi)}</span></span>
            <span class="muted">Prelievi totali: <span class="mono green">-${fmtEuro(mov.prelievi)}</span></span>
          </div>
        </div>
      ` : ""}
      ${p.entries.length === 0 ? `<div class="card muted" style="text-align:center;">Nessun movimento registrato ancora.</div>` : `
        <div class="card">
          <div class="history-list" style="max-height:none;">
            ${p.entries.slice().reverse().map((en, revIdx) => {
              const idx = p.entries.length - 1 - revIdx;
              const badges = [];
              if (en.deposito) badges.push(`<span class="mono red" style="font-size:11px;">+${fmtEuro(en.deposito)} deposito</span>`);
              if (en.prelievo) badges.push(`<span class="mono green" style="font-size:11px;">-${fmtEuro(en.prelievo)} prelievo</span>`);
              return `
              <div class="history-row">
                <div>
                  <div class="muted" style="font-size:12px;">${fmtDate(en.date)}</div>
                  <div class="mono" style="font-size:14px;">${fmtEuro(en.fine)}</div>
                  <div class="muted" style="font-size:11px;">stake ${en.stakePercent}%</div>
                  ${badges.length ? `<div style="margin-top:2px;">${badges.join(" · ")}</div>` : ""}
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="mono ${en.gainEuro >= 0 ? "green" : "red"}" style="text-align:right;font-size:13px;">
                    ${en.gainEuro >= 0 ? "+" : ""}${fmtEuro(en.gainEuro)}
                    <div style="font-size:11px;">${en.gainEuro >= 0 ? "+" : ""}${fmtPct(en.gainPercent)}</div>
                  </div>
                  ${p.stato === "aperto" ? `<button class="btn-small delEntry" data-idx="${idx}" title="Elimina">✕</button>` : ""}
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>
      `}
      <button id="exportBtn" class="btn-primary">Scarica Excel</button>
      <button id="backupBtn" class="btn-ghost">Esporta backup JSON</button>
      <button id="importBtn" class="btn-ghost">Importa backup JSON</button>
      <input id="importFile" type="file" accept="application/json,.json" style="display:none;">
      ${p.stato === "aperto" && p.entries.length > 0 ? `<button id="svuotaStoricoBtn" class="btn-ghost">Svuota storico</button>` : ""}
    `;
    bindTabbar();
    document.getElementById("exportBtn").addEventListener("click", () => exportExcel(p));
    document.getElementById("backupBtn").addEventListener("click", exportBackup);
    document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", (e) => { if (e.target.files && e.target.files[0]) importBackupFile(e.target.files[0]); });
    document.querySelectorAll(".delEntry").forEach((btn) => btn.addEventListener("click", () => deleteEntry(parseInt(btn.dataset.idx, 10))));
    const svuotaBtn = document.getElementById("svuotaStoricoBtn");
    if (svuotaBtn) svuotaBtn.addEventListener("click", () => {
      if (confirm(`Cancellare tutti i ${p.entries.length} movimenti di "${p.nome}"? Il progetto e le sue impostazioni restano, solo lo storico si azzera. Operazione non reversibile.`)) {
        p.entries = [];
        setState({});
        persistProjects();
      }
    });
  }

  function deleteEntry(idx) {
    if (!confirm("Eliminare questo movimento?")) return;
    const p = attivo();
    p.entries = p.entries.filter((_, i) => i !== idx);
    ricalcolaCatena(p);
    setState({});
    persistProjects();
  }

  // ---------------- Backup JSON completo ----------------
  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    downloadJson(`bankroll_backup_${todayISO()}.json`, {
      version: 2, exportedAt: new Date().toISOString(), projects: state.projects, activeId: state.activeId
    });
  }
  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.projects)) throw new Error("Formato backup non valido");
        const ok = confirm(`Importare ${data.projects.length} progetti? I dati attuali verranno sostituiti.`);
        if (!ok) return;
        state.projects = data.projects;
        state.activeId = data.activeId || (data.projects[0] && data.projects[0].id) || null;
        state.projects.forEach((p) => { p.entries = Array.isArray(p.entries) ? p.entries : []; ricalcolaCatena(p); });
        persistProjects(); setState({ page: "progetti", error: "" });
        alert("Backup importato correttamente.");
      } catch (err) { alert("Impossibile importare il backup: " + (err.message || "file non valido")); }
    };
    reader.readAsText(file);
  }

  function exportExcel(p) {
    const giorniTotali = daysBetween(p.dataInizio, p.dataObiettivo);
    const mov = totaliMovimentiOf(p);
    const perf = saldoPerformanceOf(p);
    const wb = XLSX.utils.book_new();

    const riepilogo = [
      [`Bankroll Betfair - ${p.nome}`], [],
      ["Stato", p.stato], ["Capitale di riferimento (per le %)", p.capitaleIniziale], ["Data inizio", p.dataInizio],
      ["Data obiettivo", p.dataObiettivo], ["Profitto netto obiettivo", p.budgetTarget], ["Giorni totali periodo", giorniTotali],
      ["Stake % attuale", p.stakePercent], [],
      ["Profitto medio giornaliero necessario (lineare) (€)", giorniTotali > 0 ? (p.budgetTarget / giorniTotali) : 0], [],
      ["Saldo conto attuale", saldoRealeOf(p)], ["Depositi totali", mov.depositi], ["Prelievi totali", mov.prelievi],
      ["Flusso D/P netto (Prelievi - Depositi)", mov.prelievi - mov.depositi],
      ["Profitto/Perdita trading €", perf],
      ["Performance pura %", p.capitaleIniziale > 0 ? (perf / p.capitaleIniziale) * 100 : 0],
    ];
    const wsR = XLSX.utils.aoa_to_sheet(riepilogo);
    wsR["!cols"] = [{ wch: 42 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsR, "Riepilogo");

    const header = ["Data", "Saldo inizio", "Saldo fine", "Deposito", "Prelievo", "Gain/loss trading (€)", "Gain/loss trading (% su cap. riferimento)", "Stake % usato", "Stake consigliato successivo (€)"];
    const rows = p.entries.map((en) => [en.date, Number(en.inizio.toFixed(2)), Number(en.fine.toFixed(2)), Number((en.deposito || 0).toFixed(2)), Number((en.prelievo || 0).toFixed(2)), Number(en.gainEuro.toFixed(2)), Number(en.gainPercent.toFixed(2)), en.stakePercent, Number(en.stakeConsigliato.toFixed(2))]);
    const wsS = XLSX.utils.aoa_to_sheet([header, ...rows]);
    wsS["!cols"] = header.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, wsS, "Storico");

    XLSX.writeFile(wb, `bankroll_${p.nome.replace(/[^a-z0-9]/gi, "_")}_${todayISO()}.xlsx`);
  }

  // ---------------- Progetti (overview) ----------------
  function renderProgetti() {
    if (!state.projectsTab) state.projectsTab = "aperti";
    const aperti = state.projects.filter((p) => p.stato === "aperto");
    const chiusi = state.projects.filter((p) => p.stato === "chiuso").slice().reverse();
    const lista = state.projectsTab === "aperti" ? aperti : chiusi;

    function riga(p) {
      const reale = saldoRealeOf(p);
      const perf = saldoPerformanceOf(p);
      // La performance è già il profitto/perdita puro: il capitale di riferimento
      // non è un deposito e non deve essere sottratto una seconda volta.
      const movimenti = totaliMovimentiOf(p);
      const risultatoEuro = movimenti.prelievi - movimenti.depositi; // Flusso D/P netto: dato principale
      const risultatoPct = p.capitaleIniziale > 0 ? (risultatoEuro / p.capitaleIniziale) * 100 : 0;
      const positivo = risultatoEuro >= 0;
      return `
        <div class="card">
          <div class="header-row" style="margin-bottom:6px;">
            <div>
              <div class="mono" style="font-size:15px;font-weight:600;">${escapeHTML(p.nome)}</div>
              <div class="muted" style="font-size:11px;">${p.stato === "aperto" ? "Aperto" : `Chiuso il ${fmtDate(p.chiusoIl)}`} · dal ${fmtDate(p.dataInizio)}</div>
            </div>
            <div class="mono ${positivo ? "green" : "red"}" style="font-size:15px;font-weight:600;text-align:right;">
              ${positivo ? "+" : ""}${fmtEuro(risultatoEuro)}<div style="font-size:11px;">${positivo ? "+" : ""}${fmtPct(risultatoPct)}</div>
            </div>
          </div>
          <div class="muted" style="font-size:12px;margin-bottom:4px;">Capitale iniziale: ${fmtEuro(p.capitaleIniziale)} · Saldo conto: ${fmtEuro(reale)} · Obiettivo: ${fmtEuro(p.budgetTarget)}</div>
          <div class="muted" style="font-size:11px;margin-bottom:10px;">💸 Flusso D/P netto: <span class="${risultatoEuro >= 0 ? "green" : "red"} mono">${risultatoEuro >= 0 ? "+" : ""}${fmtEuro(risultatoEuro)}</span> · 📈 Trading: <span class="${perf >= 0 ? "green" : "red"} mono">${perf >= 0 ? "+" : ""}${fmtEuro(perf)}</span></div>
          <div style="display:grid;grid-template-columns:${p.stato === "aperto" ? "1fr auto auto" : "1fr auto"};gap:6px;">
            <button class="btn-small apriProgetto" data-id="${p.id}">Apri</button>
            ${p.stato === "aperto" ? `<button class="btn-small modificaProgetto" data-id="${p.id}">✎</button>` : ""}
            <button class="btn-small eliminaProgetto" data-id="${p.id}" style="color:#E0665A;">✕</button>
          </div>
        </div>
      `;
    }

    $app.innerHTML = `
      <div class="title" style="margin-bottom:1rem;">Progetti</div>
      <div class="tabbar" style="margin-bottom:1rem;">
        <button class="tab ${state.projectsTab === "aperti" ? "active" : ""}" data-ptab="aperti">Aperti (${aperti.length})</button>
        <button class="tab ${state.projectsTab === "chiusi" ? "active" : ""}" data-ptab="chiusi">Storico (${chiusi.length})</button>
      </div>
      <button id="nuovoProgettoBtn" class="btn-primary" style="margin-bottom:1rem;">+ Nuovo progetto</button>
      ${lista.length ? lista.map(riga).join("") : `<div class="card muted" style="text-align:center;">${state.projectsTab === "aperti" ? "Nessun progetto aperto." : "Nessun progetto chiuso ancora."}</div>`}
    `;

    document.querySelectorAll("[data-ptab]").forEach((btn) => btn.addEventListener("click", () => setState({ projectsTab: btn.dataset.ptab })));
    document.getElementById("nuovoProgettoBtn").addEventListener("click", () => setState({ creatingNew: true, setupForm: null, error: "" }));
    document.querySelectorAll(".apriProgetto").forEach((btn) => btn.addEventListener("click", () => {
      state.activeId = btn.dataset.id;
      store.setActiveId(btn.dataset.id);
      setState({ page: "dashboard" });
      writeToCloud();
    }));
    document.querySelectorAll(".modificaProgetto").forEach((btn) => btn.addEventListener("click", () => {
      state.activeId = btn.dataset.id;
      store.setActiveId(btn.dataset.id);
      setState({ editingSetup: true, editReturnPage: "progetti", error: "", setupForm: null });
    }));
    document.querySelectorAll(".eliminaProgetto").forEach((btn) => btn.addEventListener("click", () => {
      const target = state.projects.find((p) => p.id === btn.dataset.id);
      if (!confirm(`Eliminare definitivamente "${target ? target.nome : "questo progetto"}"? L'operazione non è reversibile e cancella tutto il suo storico.`)) return;
      deleteProject(btn.dataset.id);
    }));
  }

  function deleteProject(id) {
    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.activeId === id) state.activeId = state.projects.length ? state.projects[0].id : null;
    setState({});
    persistProjects();
  }

  // ---------------- Sync page ----------------
  function renderSync() {
    $app.innerHTML = `
      ${state.projects.length ? renderTabbar() : `<button id="backBtn" class="btn-small" style="margin-bottom:1rem;">← Indietro</button>`}
      <div class="title" style="margin-bottom:1rem;">Sincronizzazione</div>
      ${state.authUser ? `
        <div class="card">
          <div class="label">Connesso come</div>
          <div class="mono" style="font-size:15px;margin-bottom:1rem;">${escapeHTML(state.authUser.email || "Utente Google")}</div>
          <div class="muted" style="font-size:12px;margin-bottom:1rem;">I dati si sincronizzano automaticamente tra PC e telefono quando accedi con lo stesso account Google.</div>
          <button id="logoutBtn" class="btn-ghost" style="margin-top:0;">Disconnetti da questo dispositivo</button>
        </div>
      ` : `
        <div class="card">
          <div class="label">Sincronizza i tuoi dati</div>
          <div class="muted" style="font-size:13px;margin-bottom:1rem;">Accedi con lo stesso account Google sul PC e sul telefono per vedere automaticamente gli stessi progetti.</div>
          ${state.syncError ? `<div class="error">${escapeHTML(state.syncError)}</div>` : ""}
          <button id="googleLoginBtn" class="btn-primary" style="margin-top:0.4rem;">Accedi con Google</button>
        </div>
      `}
    `;
    bindTabbar();
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", () => setState({ page: "progetti" }));
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => { if (fbAuth) fbAuth.signOut(); });
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    if (googleLoginBtn) googleLoginBtn.addEventListener("click", signInWithGoogle);
  }

  function traduciErroreFirebase(err) {
    const code = err && err.code;
    const map = {
      "auth/invalid-email": "Email non valida.", "auth/user-not-found": "Nessun account con questa email. Prova a registrarti.",
      "auth/wrong-password": "Password errata.", "auth/email-already-in-use": "Esiste già un account con questa email. Prova ad accedere.",
      "auth/weak-password": "Password troppo corta (minimo 6 caratteri).", "auth/invalid-credential": "Email o password non corrette.",
    };
    return map[code] || ("Errore: " + (err && err.message ? err.message : String(err)));
  }

  function render() {
    if (state.askingFirstDeposit) renderPrimoDeposito();
    else if (state.page === "sync") renderSync();
    else if (state.creatingNew || state.editingSetup) renderSetup();
    else if (state.projects.length === 0) renderSetup();
    else if (state.page === "storico") renderStorico();
    else if (state.page === "statistiche") renderStatistiche();
    else if (state.page === "progetti") renderProgetti();
    else renderDashboard();
  }

  // Migrazione automatica: corregge lo storico dei progetti creati con versioni precedenti.
  // Un deposito iniziale di 50 deve quindi risultare sempre in gain 0.
  state.projects.forEach((p) => ricalcolaCatena(p));
  store.setProjects(state.projects);

  render();
  initFirebaseIfConfigured();
})();
