/* Cloud sync for Bean's Table — talks to our own /api/state serverless function,
   which holds the Neon Postgres credentials server-side. The browser only ever
   sends a shared passphrase (the user types it on each device; it gates the API).
   No DB credentials ever reach the client.

   Last-write-wins by state.updatedAt. Loaded AFTER app.js, so it shares globals:
   `state`, `migrate`, `render`, `applyRemoteState`, `toast`, `STORAGE_KEY`. */

(() => {
  "use strict";

  const SYNC_KEY = "beansTableSync"; // { apiBase, token } — kept out of the data blob and the repo

  let cfg = loadCfg();
  let connected = false;
  let busy = false;
  let lastSync = null;
  let pushTimer = null;

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); }

  function setConfig({ apiBase, token }) {
    if (apiBase != null) cfg.apiBase = apiBase.trim().replace(/\/+$/, ""); // strip trailing slash
    if (token != null) cfg.token = token.trim();
    saveCfg();
  }

  async function api(method, body) {
    const res = await fetch((cfg.apiBase || "") + "/api/state", {
      method,
      headers: { "content-type": "application/json", "x-app-token": cfg.token || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("HTTP " + res.status);
    return method === "GET" ? res.json() : null;
  }

  async function connect() {
    if (!cfg.token) { toast("Enter your sync passphrase first."); return; }
    busy = true;
    updateUi();
    try {
      const remote = await api("GET");
      const localT = (state && state.updatedAt) || 0;
      const remoteT = (remote && remote.updatedAt) || 0;
      if (remote && remoteT > localT) {
        applyRemoteState(remote);   // cloud is newer — adopt it
        toast("Pulled latest from the cloud");
      } else {
        await api("PUT", state);    // seed/refresh the cloud from this device
        toast("Synced to the cloud");
      }
      connected = true;
      lastSync = Date.now();
    } catch (e) {
      connected = false;
      console.warn("Cloud sync failed:", e);
      toast(e.message === "unauthorized" ? "Wrong passphrase." : "Couldn't reach the sync server.");
    } finally {
      busy = false;
      updateUi();
    }
  }

  function disconnect() {
    connected = false;
    clearTimeout(pushTimer);
    toast("Stopped syncing");
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
    if (!cfg.token) return "Not connected. Enter your passphrase, then connect.";
    if (busy) return "Connecting…";
    if (connected) return "Connected" + (lastSync ? " · synced at " + fmtClock(lastSync) : "");
    return "Saved your passphrase — tap Connect.";
  }
  function updateUi() {
    const s = document.getElementById("sync-status");
    if (s) s.textContent = statusText();
    const c = document.getElementById("sync-connect");
    if (c) c.textContent = busy ? "Connecting…" : connected ? "Sync now" : "Connect";
    const d = document.getElementById("sync-disconnect");
    if (d) d.hidden = !connected;
  }

  /* ---------- boot: silently reconnect if previously set up ---------- */
  function boot() {
    if (cfg.token) connect();
  }

  window.cloudSync = {
    onLocalSave,
    connect,
    disconnect,
    setConfig,
    updateUi,
    statusText,
    getConfig: () => ({ ...cfg }),
    isConnected: () => connected,
    isConfigured: () => !!cfg.token,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
