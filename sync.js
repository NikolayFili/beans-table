/* Google Sheets sync — an optional cloud database for Bean's Table.
   Pure client-side, no Apps Script, no server:
     • Google Identity Services (GIS) for OAuth (the user signs in with Google)
     • the Sheets REST API for read/write
   The entire app-state JSON lives in ONE cell (A2 of the first sheet). Sync is
   last-write-wins by `state.updatedAt`. The OAuth Client ID and Sheet id are the
   user's own (entered in Settings, stored locally) — nothing secret is shipped.

   Loaded AFTER app.js, so it shares globals: `state`, `migrate`, `render`,
   `applyRemoteState`, `toast`, `STORAGE_KEY`. */

(() => {
  "use strict";

  const SYNC_KEY = "beansTableSync"; // { clientId, spreadsheetId } — kept separate from the data blob
  const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
  const DATA_RANGE = "A2"; // first sheet, cell A2 holds the JSON blob
  const NOTE_RANGE = "A1"; // a friendly label so the sheet self-documents

  let cfg = loadCfg();
  let accessToken = null;
  let tokenClient = null;
  let tokenResolve = null;
  let tokenReject = null;
  let connected = false;
  let busy = false;
  let lastSync = null;
  let pushTimer = null;

  /* ---------- config ---------- */
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); }

  // Accept a full Sheet URL or a bare id.
  function parseSheetId(linkOrId) {
    if (!linkOrId) return "";
    const m = String(linkOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(linkOrId).trim();
  }

  function setConfig({ clientId, spreadsheetId }) {
    if (clientId != null) cfg.clientId = clientId.trim();
    if (spreadsheetId != null) cfg.spreadsheetId = parseSheetId(spreadsheetId);
    saveCfg();
    tokenClient = null; // client id may have changed
  }

  /* ---------- GIS token ---------- */
  function gisReady() {
    return !!(window.google && window.google.accounts && window.google.accounts.oauth2);
  }

  function settleToken(ok, value) {
    const resolve = tokenResolve, reject = tokenReject;
    tokenResolve = tokenReject = null;
    if (ok) { if (resolve) resolve(value); }
    else if (reject) reject(value instanceof Error ? value : new Error(String(value || "auth failed")));
  }

  function ensureTokenClient() {
    if (tokenClient || !gisReady() || !cfg.clientId) return tokenClient;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) { accessToken = resp.access_token; settleToken(true, resp.access_token); }
        else settleToken(false, resp && resp.error);
      },
      // Fires when the popup can't open or the user dismisses it — without this
      // the promise would hang and the UI would stay stuck on "Connecting…".
      error_callback: (err) => settleToken(false, err && err.type),
    });
    return tokenClient;
  }

  function requestToken(interactive) {
    return new Promise((resolve, reject) => {
      ensureTokenClient();
      if (!tokenClient) return reject(new Error("Google sign-in isn't ready yet"));
      tokenResolve = resolve;
      tokenReject = reject;
      // Safety net: if GIS never calls back (rare), don't hang forever.
      const guard = setTimeout(() => settleToken(false, "timeout"), 60000);
      const wrap = (fn) => (v) => { clearTimeout(guard); fn(v); };
      tokenResolve = wrap(resolve);
      tokenReject = wrap(reject);
      try {
        tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) {
        clearTimeout(guard);
        settleToken(false, e);
      }
    });
  }

  /* ---------- Sheets REST ---------- */
  async function sheetFetch(method, range, body) {
    const id = cfg.spreadsheetId;
    let url = "https://sheets.googleapis.com/v4/spreadsheets/" + id + "/values/" + encodeURIComponent(range);
    if (method === "PUT") url += "?valueInputOption=RAW";
    const go = () =>
      fetch(url, {
        method,
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    let res = await go();
    if (res.status === 401) {
      // token likely expired — try a silent refresh once
      await requestToken(false).catch(() => {});
      res = await go();
    }
    if (!res.ok) throw new Error("Sheets API " + res.status);
    return res.json();
  }

  async function readRemote() {
    const j = await sheetFetch("GET", DATA_RANGE);
    const cell = j.values && j.values[0] && j.values[0][0];
    if (!cell) return null;
    try { return JSON.parse(cell); } catch (e) { return null; }
  }

  async function writeRemote(seedNote) {
    await sheetFetch("PUT", DATA_RANGE, { values: [[JSON.stringify(state)]] });
    if (seedNote) {
      sheetFetch("PUT", NOTE_RANGE, {
        values: [["Bean's Table — app data (managed automatically; edit in the app, not here)"]],
      }).catch(() => {});
    }
  }

  /* ---------- orchestration ---------- */
  async function connect(interactive) {
    if (!cfg.clientId || !cfg.spreadsheetId) {
      toast("Add your Sheet link and Client ID first.");
      return;
    }
    busy = true;
    updateUi();
    try {
      await requestToken(interactive);
      const remote = await readRemote();
      const localT = (state && state.updatedAt) || 0;
      const remoteT = (remote && remote.updatedAt) || 0;
      if (remote && remoteT > localT) {
        applyRemoteState(remote); // adopt the newer cloud copy
        toast("Pulled latest from Google Sheets");
      } else {
        await writeRemote(!remote); // seed (with note) or refresh the cloud copy
        toast("Synced to Google Sheets");
      }
      connected = true;
      lastSync = Date.now();
    } catch (e) {
      connected = false;
      console.warn("Sheets sync failed:", e);
      toast("Couldn't connect — double-check the setup.");
    } finally {
      busy = false;
      updateUi();
    }
  }

  function disconnect() {
    connected = false;
    accessToken = null;
    clearTimeout(pushTimer);
    toast("Stopped syncing");
    updateUi();
  }

  // Called by app.js saveState() after every local change.
  function onLocalSave() {
    if (!connected) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      writeRemote(false)
        .then(() => { lastSync = Date.now(); updateUi(); })
        .catch((e) => { console.warn("Sheets push failed:", e); });
    }, 1500); // debounce bursts of edits into one write
  }

  /* ---------- settings UI glue ---------- */
  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function statusText() {
    if (!cfg.clientId || !cfg.spreadsheetId) return "Not connected. Add your Sheet link and Client ID, then connect.";
    if (busy) return "Connecting…";
    if (connected) return "Connected" + (lastSync ? " · synced at " + fmtClock(lastSync) : "");
    return "Saved your details — tap Connect Google.";
  }
  // Light, focus-safe DOM updates (no full re-render while the inputs are in use).
  function updateUi() {
    const s = document.getElementById("sync-status");
    if (s) s.textContent = statusText();
    const c = document.getElementById("sync-connect");
    if (c) c.textContent = busy ? "Connecting…" : connected ? "Sync now" : "Connect Google";
    const d = document.getElementById("sync-disconnect");
    if (d) d.hidden = !connected;
  }

  /* ---------- boot: try a silent reconnect if previously set up ---------- */
  function boot() {
    if (!cfg.clientId || !cfg.spreadsheetId) return;
    let tries = 0;
    const iv = setInterval(() => {
      if (gisReady()) { clearInterval(iv); connect(false); }
      else if (++tries > 40) clearInterval(iv); // give up after ~10s
    }, 250);
  }

  /* ---------- public surface ---------- */
  window.cloudSync = {
    onLocalSave,
    connect,
    disconnect,
    setConfig,
    updateUi,
    statusText,
    getConfig: () => ({ ...cfg }),
    isConnected: () => connected,
    isConfigured: () => !!(cfg.clientId && cfg.spreadsheetId),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
