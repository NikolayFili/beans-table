/* Cloud sync for Bean's Table — talks to our own /api/state serverless function,
   which holds the Neon Postgres credentials server-side (never in the browser).

   Zero-config: when the app is served from the same domain as the API (Vercel), it
   auto-syncs on load — nothing to enter. Last-write-wins by state.updatedAt.

   Loaded AFTER app.js, so it shares globals: `state`, `migrate`, `render`,
   `applyRemoteState`, `toast`, `STORAGE_KEY`. */

(() => {
  "use strict";

  const SYNC_KEY = "beansTableSync"; // { apiBase, off } — only needed off-Vercel / to disable

  let cfg = loadCfg();
  let connected = false;
  let busy = false;
  let lastSync = null;
  let pushTimer = null;

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); }

  function setConfig({ apiBase, off }) {
    if (apiBase != null) cfg.apiBase = apiBase.trim().replace(/\/+$/, ""); // strip trailing slash
    if (off != null) cfg.off = !!off;
    saveCfg();
  }

  async function api(method, body) {
    const res = await fetch((cfg.apiBase || "") + "/api/state", {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return method === "GET" ? res.json() : null;
  }

  async function connect() {
    if (cfg.off) { toast("Sync is turned off."); return; }
    busy = true;
    updateUi();
    try {
      const remote = await api("GET");
      const localT = (state && state.updatedAt) || 0;
      const remoteT = (remote && remote.updatedAt) || 0;
      if (remote && remoteT > localT) {
        applyRemoteState(remote);   // cloud is newer — adopt it
      } else {
        await api("PUT", state);    // seed/refresh the cloud from this device
      }
      connected = true;
      lastSync = Date.now();
    } catch (e) {
      connected = false;
      console.warn("Cloud sync failed:", e);
    } finally {
      busy = false;
      updateUi();
    }
  }

  // Manual connect from Settings — gives explicit feedback (boot connect is silent).
  async function connectManual() {
    cfg.off = false; saveCfg();
    await connect();
    toast(connected ? "Synced" : "Couldn't reach the sync server.");
  }

  function disconnect() {
    connected = false;
    cfg.off = true; saveCfg();
    clearTimeout(pushTimer);
    toast("Sync turned off");
    updateUi();
  }

  // Called by app.js saveState() after every local change.
  function onLocalSave() {
    if (!connected) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      api("PUT", state)
        .then(() => { lastSync = Date.now(); updateUi(); })
        .catch((e) => { console.warn("Cloud push failed:", e); });
    }, 1500); // debounce bursts of edits into one write
  }

  /* ---------- settings UI glue ---------- */
  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function statusText() {
    if (cfg.off) return "Sync is off.";
    if (busy) return "Syncing…";
    if (connected) return "Synced" + (lastSync ? " · " + fmtClock(lastSync) : "") + " — saves automatically across your devices.";
    return "Not syncing — open this app on its Vercel address, or set a sync server URL below.";
  }
  function updateUi() {
    const s = document.getElementById("sync-status");
    if (s) s.textContent = statusText();
    const c = document.getElementById("sync-connect");
    if (c) c.textContent = busy ? "Syncing…" : connected ? "Sync now" : "Connect";
    const d = document.getElementById("sync-disconnect");
    if (d) d.hidden = !connected;
  }

  /* ---------- boot: auto-connect unless turned off ---------- */
  function boot() {
    if (!cfg.off) connect(); // silent; on the Vercel app this "just works"
  }

  window.cloudSync = {
    onLocalSave,
    connect: connectManual,
    disconnect,
    setConfig,
    updateUi,
    statusText,
    getConfig: () => ({ ...cfg }),
    isConnected: () => connected,
    isConfigured: () => true, // no setup required
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
