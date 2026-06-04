/* Bean's Table — vanilla JS, no backend, localStorage only.
   Sections:
   1. Storage layer (load / migrate / save)
   2. Small helpers (dates, source detection, ingredient parser, calendar/ICS)
   3. State + routing
   4. Views: Library, This Week, Shopping list
   5. Overlays: Dish editor, Dish detail, Settings
   6. Wire-up
*/

"use strict";

/* =========================================================================
   1. STORAGE LAYER
   ========================================================================= */

const STORAGE_KEY = "beansTable";
const SCHEMA_VERSION = 2;

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: { cookDay: 6, cookTime: "10:00", sort: "rating" },
    weekDishId: null,
    listDishIds: [],
    checked: {},
    dishes: [],
  };
}

// Migrate older blobs forward. We only have v1 -> v2 historically; unknown/missing
// shapes are coerced into a valid v2 blob so the app never crashes on bad data.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultState();
  const base = defaultState();
  const out = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    checked: raw.checked && typeof raw.checked === "object" ? raw.checked : {},
    listDishIds: Array.isArray(raw.listDishIds) ? raw.listDishIds : [],
    dishes: Array.isArray(raw.dishes) ? raw.dishes.map(normalizeDish) : [],
  };
  out.version = SCHEMA_VERSION;
  return out;
}

function normalizeDish(d) {
  d = d || {};
  return {
    id: d.id || uid(),
    name: typeof d.name === "string" ? d.name : "Untitled dish",
    servings: d.servings ?? null,
    source: ["youtube", "instagram", "link", "mine"].includes(d.source) ? d.source : "mine",
    sourceUrl: typeof d.sourceUrl === "string" ? d.sourceUrl : "",
    notes: typeof d.notes === "string" ? d.notes : "",
    ingredients: Array.isArray(d.ingredients)
      ? d.ingredients.map((i) => ({
          quantity: String(i.quantity ?? ""),
          unit: String(i.unit ?? ""),
          name: String(i.name ?? ""),
        }))
      : [],
    rating: clampRating(d.rating),
    cookLog: Array.isArray(d.cookLog)
      ? d.cookLog.map((c) => ({
          date: c.date || new Date().toISOString(),
          rating: clampRating(c.rating),
          note: typeof c.note === "string" ? c.note : "",
        }))
      : [],
    timesCooked: Number.isFinite(d.timesCooked) ? d.timesCooked : (Array.isArray(d.cookLog) ? d.cookLog.length : 0),
    lastCooked: d.lastCooked || null,
    added: d.added || new Date().toISOString(),
  };
}

function loadState() {
  try {
    const txt = localStorage.getItem(STORAGE_KEY);
    if (!txt) return defaultState();
    return migrate(JSON.parse(txt));
  } catch (err) {
    console.warn("Bean's Table: could not read saved data, starting fresh.", err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast("Couldn't save — storage may be full.");
    console.error(err);
  }
}

/* =========================================================================
   2. HELPERS
   ========================================================================= */

function uid() {
  return "d" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function clampRating(r) {
  r = Math.round(Number(r) || 0);
  return Math.max(0, Math.min(5, r));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "3 days ago", "today", "12 weeks ago" — for last-cooked context.
function relDays(iso) {
  if (!iso) return "never cooked";
  const then = new Date(iso);
  if (isNaN(then)) return "never cooked";
  const days = Math.floor((startOfDay(new Date()) - startOfDay(then)) / 86400000);
  if (days <= 0) return "cooked today";
  if (days === 1) return "1 day ago";
  if (days < 14) return days + " days ago";
  if (days < 60) return Math.floor(days / 7) + " weeks ago";
  return Math.floor(days / 30) + " months ago";
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/* ---- Bean & Boyfriend: our special dates ----
   Hardcoded, recurring annually. `since` is the origin year, so the count is the
   age (birthdays) or the number of years (anniversaries) on the upcoming date. */
const CATS = "Dumpling & Muffinhead";
const OCCASIONS = [
  { name: "Boyfriend's birthday", emoji: "🎂", since: 1994, m: 4, d: 23,
    line: (n) => `Boyfriend turns ${n} — Bean, the kitchen is yours today.` },
  { name: "Bean's birthday", emoji: "🎂", since: 1995, m: 8, d: 24,
    line: (n) => `Bean turns ${n}. Cook her something unforgettable.` },
  { name: "Your first date", emoji: "💕", since: 2022, m: 6, d: 3,
    line: (n) => `${n} year${n === 1 ? "" : "s"} since your first date, Bean & Boyfriend.` },
  { name: "Wedding anniversary", emoji: "💍", since: 2023, m: 9, d: 25,
    line: (n) => `${n} year${n === 1 ? "" : "s"} married — make it a candlelit one.` },
  { name: CATS + "'s birthday", emoji: "🐾", since: 2023, m: 9, d: 27,
    line: (n) => `${CATS} turn ${n}. Treats for them, a feast for you two.` },
  { name: "Bean moved to LA", emoji: "🌴", since: 2023, m: 11, d: 12,
    line: (n) => `${n} year${n === 1 ? "" : "s"} since Bean came home to LA.` },
  { name: "Adopted " + CATS, emoji: "🐱", since: 2024, m: 1, d: 2,
    line: (n) => `${n} year${n === 1 ? "" : "s"} since ${CATS} joined the family.` },
  { name: "Bean's green card", emoji: "🎉", since: 2024, m: 6, d: 30,
    line: (n) => `${n} year${n === 1 ? "" : "s"} since Bean's green card — here to stay.` },
];

// Each occasion's next upcoming date (this year or next), with days-away + the count.
function upcomingOccasions(withinDays) {
  const today = new Date();
  const t0 = startOfDay(today);
  return OCCASIONS.map((o) => {
    let year = today.getFullYear();
    let when = new Date(year, o.m - 1, o.d);
    if (startOfDay(when) < t0) { year += 1; when = new Date(year, o.m - 1, o.d); }
    const days = Math.round((startOfDay(when) - t0) / 86400000);
    return { ...o, when, days, count: year - o.since };
  })
    .sort((a, b) => a.days - b.days)
    .filter((o) => withinDays == null || o.days <= withinDays);
}

function daysLabel(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return "in " + days + " days";
  if (days < 56) return "in " + Math.round(days / 7) + " weeks";
  return "on " + new Date(Date.now() + days * 86400000).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// Big celebratory banner for the single nearest occasion.
function occasionBanner(o) {
  return `<div class="occasion ${o.days === 0 ? "today" : ""}">
    <span class="occ-emoji">${o.emoji}</span>
    <div class="occ-body">
      <p class="occ-line">${esc(o.line(o.count))}</p>
      <p class="occ-sub">${esc(o.name)} · ${daysLabel(o.days)}</p>
    </div>
  </div>`;
}

// Compact row for occasion lists (This Week, Settings).
function occasionRow(o) {
  return `<div class="occ-row">
    <span class="occ-emoji sm">${o.emoji}</span>
    <span class="occ-name">${esc(o.name)}</span>
    <span class="occ-days ${o.days <= 7 ? "soon" : ""}">${daysLabel(o.days)}</span>
  </div>`;
}

// Detect a source type from a URL the user pastes.
function detectSource(url) {
  if (!url || !url.trim()) return "mine";
  const u = url.toLowerCase();
  if (/(?:youtube\.com|youtu\.be)/.test(u)) return "youtube";
  if (/instagram\.com/.test(u)) return "instagram";
  return "link";
}

const SOURCE_LABEL = { youtube: "YouTube", instagram: "Instagram", link: "Link", mine: "Mine" };

// Pull a YouTube video id out of any common URL shape (watch, youtu.be, embed, shorts).
function youtubeId(url) {
  if (!url) return null;
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    url.match(/\/embed\/([A-Za-z0-9_-]{11})/) ||
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Known units we recognise when reshaping a pasted ingredient line.
// Purely cosmetic splitting — we never look anything up or invent quantities.
const KNOWN_UNITS = [
  "tsp", "teaspoon", "teaspoons", "tbsp", "tbs", "tablespoon", "tablespoons",
  "cup", "cups", "c", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "g", "gram", "grams", "kg", "kilogram", "kilograms", "ml", "milliliter",
  "milliliters", "l", "liter", "liters", "litre", "litres", "pinch", "pinches",
  "dash", "dashes", "clove", "cloves", "can", "cans", "stick", "sticks",
  "slice", "slices", "piece", "pieces", "handful", "bunch", "bunches",
  "package", "packages", "pkg", "pint", "pints", "quart", "quarts", "gallon",
  "head", "sprig", "sprigs", "stalk", "stalks", "fl",
];

// Reshape ONE line of the user's own text into {quantity, unit, name}.
// Peel an optional leading number (incl. fractions/decimals/ranges), then an
// optional known unit, the rest is the name. Quantity stays a string so "1/3" survives.
function parseIngredientLine(line) {
  let rest = line.trim().replace(/^[-*••]\s*/, ""); // strip bullet markers
  if (!rest) return null;

  let quantity = "";
  // leading number: "1", "1/2", "1 1/2", "1.5", "2-3", "½"
  const numRe = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?|[¼½¾⅓⅔⅛])\s*/;
  const nm = rest.match(numRe);
  if (nm) {
    quantity = nm[1].replace(/\s*-\s*/, "–").trim();
    rest = rest.slice(nm[0].length);
  }

  let unit = "";
  const firstWord = rest.split(/\s+/)[0] || "";
  const cleaned = firstWord.replace(/\.$/, "").toLowerCase();
  if (quantity && KNOWN_UNITS.includes(cleaned)) {
    unit = firstWord.replace(/\.$/, "");
    rest = rest.slice(firstWord.length).trim();
  }

  return { quantity, unit, name: rest.trim() };
}

function ingredientCount(d) {
  return d.ingredients.filter((i) => (i.name || "").trim()).length;
}

function ingredientText(i) {
  return [i.quantity, i.unit, i.name].filter(Boolean).join(" ").trim();
}

/* ---- Calendar helpers (Google link + .ics) ---- */

// Next occurrence of weekday `day` (0=Sun..6=Sat) at HH:MM, today-or-later.
function nextOccurrence(day, time) {
  const [hh, mm] = (time || "10:00").split(":").map(Number);
  const now = new Date();
  const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 0, mm || 0, 0, 0);
  let delta = (day - result.getDay() + 7) % 7;
  // If it's the right weekday but the time already passed, jump a week.
  if (delta === 0 && result.getTime() <= now.getTime()) delta = 7;
  result.setDate(result.getDate() + delta);
  return result;
}

// Floating local timestamp: YYYYMMDDTHHMMSS (no Z) — interpreted in the user's tz.
function icsLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    "T" + p(d.getHours()) + p(d.getMinutes()) + "00"
  );
}

function googleCalendarUrl(dish) {
  const start = nextOccurrence(state.settings.cookDay, state.settings.cookTime);
  const end = new Date(start.getTime() + 90 * 60000); // assume ~90 min in the kitchen
  const details =
    (dish.sourceUrl ? "Recipe: " + dish.sourceUrl + "\n\n" : "") +
    (ingredientCount(dish) ? "Shopping list:\n" + dish.ingredients.map((i) => "• " + ingredientText(i)).filter((s) => s !== "• ").join("\n") : "Cook something lovely for Bean.");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Cook for Bean: " + dish.name,
    dates: icsLocal(start) + "/" + icsLocal(end),
    details: details,
    recur: "RRULE:FREQ=WEEKLY",
  });
  if (tz) params.set("ctz", tz);
  return "https://calendar.google.com/calendar/render?" + params.toString();
}

function buildIcs(dish) {
  const start = nextOccurrence(state.settings.cookDay, state.settings.cookTime);
  const end = new Date(start.getTime() + 90 * 60000);
  const fold = (s) => s; // lines are short enough; keep simple
  const escIcs = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const desc = escIcs(
    (dish.sourceUrl ? "Recipe: " + dish.sourceUrl + "\n" : "") +
    (ingredientCount(dish) ? "Ingredients:\n" + dish.ingredients.map((i) => "- " + ingredientText(i)).filter((s) => s !== "- ").join("\n") : "")
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bean's Table//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + dish.id + "@beans-table",
    "DTSTAMP:" + icsLocal(new Date()),
    "DTSTART:" + icsLocal(start),
    "DTEND:" + icsLocal(end),
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:" + escIcs("Cook for Bean: " + dish.name),
    "DESCRIPTION:" + desc,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + escIcs("Time to prep: " + dish.name),
    "TRIGGER:-PT3H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n");
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

/* =========================================================================
   3. STATE + ROUTING
   ========================================================================= */

let state = loadState();
let currentTab = "library";

const app = document.getElementById("app");

function render() {
  // sync tab bar
  document.querySelectorAll(".tab").forEach((t) =>
    t.setAttribute("aria-current", t.dataset.tab === currentTab ? "page" : "false")
  );
  if (currentTab === "library") renderLibrary();
  else if (currentTab === "week") renderWeek();
  else if (currentTab === "list") renderList();
  // restart the rise animation on tab switch
  app.style.animation = "none";
  void app.offsetWidth;
  app.style.animation = "";
}

function goTab(tab) {
  currentTab = tab;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function findDish(id) {
  return state.dishes.find((d) => d.id === id) || null;
}

/* =========================================================================
   4a. LIBRARY VIEW
   ========================================================================= */

const SORTS = {
  rating: { label: "Top rated", fn: (a, b) => b.rating - a.rating || (b.added || "").localeCompare(a.added || "") },
  recent: { label: "Recently added", fn: (a, b) => (b.added || "").localeCompare(a.added || "") },
  stale: {
    label: "Cook me next",
    fn: (a, b) => {
      // never-cooked first, then oldest lastCooked first
      const av = a.lastCooked ? new Date(a.lastCooked).getTime() : -Infinity;
      const bv = b.lastCooked ? new Date(b.lastCooked).getTime() : -Infinity;
      return av - bv;
    },
  },
};

function sortedDishes() {
  const sort = SORTS[state.settings.sort] ? state.settings.sort : "rating";
  return [...state.dishes].sort(SORTS[sort].fn);
}

function starsHtml(rating, opts = {}) {
  const cls = opts.large ? "stars lg" : "stars";
  let s = `<span class="${cls}" data-stars ${opts.dishId ? `data-dish="${opts.dishId}"` : ""} ${opts.context ? `data-context="${opts.context}"` : ""}>`;
  for (let i = 1; i <= 5; i++) {
    s += `<button type="button" data-star="${i}" aria-label="${i} star${i > 1 ? "s" : ""}" class="${i <= rating ? "on" : ""}">★</button>`;
  }
  if (opts.showNum) s += `<span class="rating-num">${rating ? rating.toFixed(0) : "—"}</span>`;
  s += `</span>`;
  return s;
}

function dishCard(d) {
  const count = ingredientCount(d);
  const inList = state.listDishIds.includes(d.id);
  const isWeek = state.weekDishId === d.id;
  return `
  <article class="card" data-card="${d.id}">
    <div class="card-top">
      <h3 class="card-title" data-open="${d.id}">${esc(d.name)}</h3>
      <span class="badge ${d.source}">${SOURCE_LABEL[d.source]}</span>
    </div>
    ${starsHtml(d.rating, { dishId: d.id, context: "library", showNum: false })}
    <div class="meta-row">
      <span><b>${d.timesCooked}</b> cook${d.timesCooked === 1 ? "" : "s"}</span>
      <span>${esc(relDays(d.lastCooked))}</span>
      <span><b>${count}</b> ingredient${count === 1 ? "" : "s"}</span>
    </div>
    <div class="card-actions">
      <button class="btn sm ${isWeek ? "primary" : ""}" data-cook-week="${d.id}">${isWeek ? "This week ✓" : "Cook this week"}</button>
      <button class="btn sm" data-add-list="${d.id}">${inList ? "On list ✓" : "Add to list"}</button>
      <button class="btn sm ghost" data-open="${d.id}">Open</button>
    </div>
  </article>`;
}

function renderLibrary() {
  const dishes = sortedDishes();
  const sortBtns = Object.entries(SORTS)
    .map(([k, v]) => `<button data-sort="${k}" aria-pressed="${state.settings.sort === k}">${v.label}</button>`)
    .join("");

  const soon = upcomingOccasions(16)[0];

  app.innerHTML = `
    ${soon ? occasionBanner(soon) : ""}
    <div class="section-head">
      <div>
        <p class="eyebrow">Dish library</p>
        <h2>What shall we cook?</h2>
      </div>
      <button class="btn primary" data-new>＋ Add dish</button>
    </div>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Sort dishes">${sortBtns}</div>
    </div>
    ${
      dishes.length
        ? `<div class="grid">${dishes.map(dishCard).join("")}</div>`
        : `<div class="empty">
             <p class="big">Your table is empty</p>
             <p>Add the first dish you'd like to cook for Bean.</p>
             <button class="btn primary" data-new>＋ Add your first dish</button>
           </div>`
    }`;
}

/* =========================================================================
   4b. THIS WEEK VIEW
   ========================================================================= */

function renderWeek() {
  const dish = state.weekDishId ? findDish(state.weekDishId) : null;
  const dishOptions =
    (state.weekDishId ? "" : `<option value="" selected>Choose a dish…</option>`) +
    state.dishes
      .map((d) => `<option value="${d.id}" ${d.id === state.weekDishId ? "selected" : ""}>${esc(d.name)}</option>`)
      .join("");
  const next = dish ? nextOccurrence(state.settings.cookDay, state.settings.cookTime) : null;
  const soonWeek = upcomingOccasions(12)[0];   // nearest occasion worth flagging on the cook
  const ahead = upcomingOccasions(75).slice(0, 4); // short list of what's coming up

  app.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">This week</p>
        <h2>Plan the cook</h2>
      </div>
    </div>

    ${
      state.dishes.length === 0
        ? `<div class="empty"><p class="big">No dishes yet</p><p>Add a dish first, then plan your week.</p><button class="btn primary" data-new>＋ Add dish</button></div>`
        : `
      <div class="week-card">
        <div class="field">
          <label for="weekDish">Dish for this week</label>
          <select id="weekDish">${dishOptions}</select>
        </div>
        <div class="inline-grid">
          <div class="field" style="margin:0">
            <label for="cookDay">Cook day</label>
            <select id="cookDay">
              ${WEEKDAYS.map((w, i) => `<option value="${i}" ${i === state.settings.cookDay ? "selected" : ""}>${w}</option>`).join("")}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label for="cookTime">Time</label>
            <input type="time" id="cookTime" value="${state.settings.cookTime}" />
          </div>
        </div>
      </div>

      ${
        dish
          ? `
        <div class="week-card">
          <p class="eyebrow">Up next</p>
          <h3 style="font-size:22px;margin:2px 0 6px">${esc(dish.name)}</h3>
          <p class="muted" style="margin:0 0 14px">${WEEKDAYS[state.settings.cookDay]} at ${fmtTime(state.settings.cookTime)} · next on ${esc(fmtDate(next.toISOString()))}</p>

          ${soonWeek ? `<div class="note-soft accent" style="margin-bottom:14px">${soonWeek.emoji} <b>${esc(soonWeek.name)}</b> is ${daysLabel(soonWeek.days)} — a lovely week to make it special for Bean.</div>` : ""}

          <p class="eyebrow">Weekly reminder</p>
          <div class="pill-row" style="margin:6px 0 14px">
            <a class="btn primary" href="${googleCalendarUrl(dish)}" target="_blank" rel="noopener">Add to Google Calendar</a>
            <button class="btn" data-ics="${dish.id}">Download .ics</button>
          </div>
          <div class="note-soft">Bean's Table doesn't send notifications itself — it has no server. Your <b>calendar app</b> does the reminding once you add this recurring event. The .ics also sets an alarm 3 hours before.</div>

          <hr class="divider" />
          <button class="btn block" data-build-list="${dish.id}">🛒 Build shopping list from this dish</button>
        </div>`
          : `<div class="note-soft">Pick a dish above to generate this week's reminder.</div>`
      }

      ${
        ahead.length
          ? `<div class="week-card">
               <p class="eyebrow">Occasions ahead</p>
               <p class="muted" style="margin:2px 0 12px">For Bean &amp; Boyfriend — cook something memorable.</p>
               <div class="occ-list">${ahead.map(occasionRow).join("")}</div>
             </div>`
          : ""
      }
      `
    }`;
}

function fmtTime(t) {
  const [h, m] = (t || "10:00").split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return h12 + ":" + String(m).padStart(2, "0") + " " + ap;
}

/* =========================================================================
   4c. SHOPPING LIST VIEW
   ========================================================================= */

function renderList() {
  const groups = state.listDishIds.map(findDish).filter(Boolean);

  app.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">Shopping list</p>
        <h2>What to buy</h2>
      </div>
      ${groups.length ? `<button class="btn sm ghost" data-clear-checked>Clear checked</button>` : ""}
    </div>
    ${
      groups.length === 0
        ? `<div class="empty"><p class="big">Nothing on the list</p><p>Add dishes from your library or from This Week.</p></div>`
        : groups
            .map((d) => {
              const items = d.ingredients
                .map((ing, idx) => ({ ing, idx }))
                .filter((x) => (x.ing.name || "").trim());
              if (!items.length) return "";
              const rows = items
                .map((x) => {
                  const key = d.id + ":" + x.idx;
                  const done = !!state.checked[key];
                  return `
                  <div class="check-row ${done ? "done" : ""}">
                    <input type="checkbox" id="chk-${esc(key)}" data-check="${esc(key)}" ${done ? "checked" : ""} />
                    <label for="chk-${esc(key)}">${esc(ingredientText(x.ing))}</label>
                  </div>`;
                })
                .join("");
              return `
              <div class="list-group">
                <div class="list-group-head">
                  <h3>${esc(d.name)}</h3>
                  <button class="btn sm ghost danger" data-remove-list="${d.id}">Remove</button>
                </div>
                ${rows}
              </div>`;
            })
            .join("")
    }`;
}

/* =========================================================================
   5. OVERLAYS (editor / detail / settings)
   ========================================================================= */

const overlay = document.getElementById("overlay");
const sheet = document.getElementById("sheet");

function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-handle"></div>` + html;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  sheet.scrollTop = 0;
}
function closeSheet() {
  overlay.hidden = true;
  sheet.innerHTML = "";
  document.body.style.overflow = "";
}

/* ---- Dish editor (add / edit) ---- */
// Held in a draft object so paste/split and row edits don't churn global state.
let draft = null;

function openEditor(dishId) {
  const existing = dishId ? findDish(dishId) : null;
  draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : normalizeDish({ name: "", ingredients: [] });
  renderEditor(!!existing);
}

function renderEditor(isEdit) {
  const yt = youtubeId(draft.sourceUrl);
  const ingRows = draft.ingredients.length
    ? draft.ingredients
        .map(
          (i, idx) => `
        <div class="ing-row" data-ing="${idx}">
          <input type="text" value="${esc(i.quantity)}" data-ing-field="quantity" placeholder="1" inputmode="text" />
          <input type="text" value="${esc(i.unit)}" data-ing-field="unit" placeholder="cup" />
          <input type="text" value="${esc(i.name)}" data-ing-field="name" placeholder="flour" />
          <button type="button" class="x" data-ing-remove="${idx}" aria-label="Remove">×</button>
        </div>`
        )
        .join("")
    : "";

  openSheet(`
    <div class="sheet-head">
      <h2>${isEdit ? "Edit dish" : "Add a dish"}</h2>
      <button class="sheet-close" data-close aria-label="Close">×</button>
    </div>

    <div class="field">
      <label for="f-name">Name</label>
      <input type="text" id="f-name" value="${esc(draft.name)}" placeholder="Miso-glazed salmon" />
    </div>

    <div class="field">
      <label for="f-url">Source link <span class="hint" style="display:inline">(optional)</span></label>
      <input type="url" id="f-url" value="${esc(draft.sourceUrl)}" placeholder="https://youtube.com/watch?v=…" />
      <p class="hint">Paste a YouTube, Instagram, or recipe link. We just store it — nothing is fetched or scraped.</p>
    </div>

    ${yt ? `<div class="embed"><iframe src="https://www.youtube.com/embed/${yt}" title="Recipe video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}

    <div class="inline-grid">
      <div class="field">
        <label for="f-servings">Servings</label>
        <input type="number" id="f-servings" min="1" value="${draft.servings ?? ""}" placeholder="2" />
      </div>
    </div>

    <div class="field">
      <label for="f-notes">Notes</label>
      <textarea id="f-notes" placeholder="Bean loves it extra crispy…">${esc(draft.notes)}</textarea>
    </div>

    <hr class="divider" />

    <div class="field">
      <label for="f-paste">Quick add ingredients</label>
      <textarea id="f-paste" placeholder="2 cups flour&#10;1/3 cup sugar&#10;3 cloves garlic, minced"></textarea>
      <p class="hint">One ingredient per line, then split into rows. This only reshapes your own text — it never looks anything up.</p>
      <button class="btn sm" id="f-split" type="button" style="margin-top:8px">Split into rows ↓</button>
    </div>

    <div class="field">
      <label>Ingredients</label>
      <div class="ing-head"><span>Qty</span><span>Unit</span><span>Name</span><span></span></div>
      <div class="ing-rows" id="ing-rows">${ingRows}</div>
      <button class="btn sm ghost" id="f-add-row" type="button" style="margin-top:8px">＋ Add row</button>
    </div>

    <hr class="divider" />
    <div class="stack">
      <button class="btn primary block" id="f-save">${isEdit ? "Save changes" : "Add dish"}</button>
      ${isEdit ? `<button class="btn ghost block danger" data-delete="${draft.id}">Delete dish</button>` : ""}
    </div>
  `);
}

// Pull current DOM field values back into the draft (before re-render / save).
function syncDraftFromDom() {
  const g = (id) => document.getElementById(id);
  if (g("f-name")) draft.name = g("f-name").value.trim();
  if (g("f-url")) {
    draft.sourceUrl = g("f-url").value.trim();
    draft.source = detectSource(draft.sourceUrl);
  }
  if (g("f-servings")) draft.servings = g("f-servings").value ? Number(g("f-servings").value) : null;
  if (g("f-notes")) draft.notes = g("f-notes").value;
  // ingredient rows
  const rows = [...document.querySelectorAll(".ing-row")];
  if (rows.length || document.getElementById("ing-rows")) {
    draft.ingredients = rows.map((row) => ({
      quantity: row.querySelector('[data-ing-field="quantity"]').value.trim(),
      unit: row.querySelector('[data-ing-field="unit"]').value.trim(),
      name: row.querySelector('[data-ing-field="name"]').value.trim(),
    }));
  }
}

function saveDraft() {
  syncDraftFromDom();
  if (!draft.name.trim()) {
    toast("Give the dish a name first.");
    document.getElementById("f-name")?.focus();
    return;
  }
  draft.ingredients = draft.ingredients.filter((i) => i.quantity || i.unit || i.name);
  const existingIdx = state.dishes.findIndex((d) => d.id === draft.id);
  if (existingIdx >= 0) state.dishes[existingIdx] = draft;
  else state.dishes.push(draft);
  saveState();
  closeSheet();
  render();
  toast(existingIdx >= 0 ? "Saved" : "Dish added");
}

/* ---- Dish detail ---- */
function openDetail(id) {
  const d = findDish(id);
  if (!d) return;
  const yt = youtubeId(d.sourceUrl);
  const ings = d.ingredients.filter((i) => (i.name || "").trim());
  const log = [...d.cookLog].reverse();

  openSheet(`
    <div class="sheet-head">
      <h2>${esc(d.name)}</h2>
      <button class="sheet-close" data-close aria-label="Close">×</button>
    </div>

    <div class="row-between" style="margin-bottom:8px">
      <span class="badge ${d.source}">${SOURCE_LABEL[d.source]}</span>
      ${d.sourceUrl ? `<a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>` : ""}
    </div>

    ${starsHtml(d.rating, { dishId: d.id, context: "detail", large: true, showNum: true })}

    <div class="meta-row" style="margin-top:12px">
      <span><b>${d.timesCooked}</b> cook${d.timesCooked === 1 ? "" : "s"}</span>
      <span>${esc(relDays(d.lastCooked))}</span>
      ${d.servings ? `<span>serves <b>${esc(String(d.servings))}</b></span>` : ""}
    </div>

    ${yt ? `<div class="embed" style="margin-top:14px"><iframe src="https://www.youtube.com/embed/${yt}" title="Recipe video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}

    ${d.notes ? `<div class="detail-section"><h3>Notes</h3><p style="margin:0">${esc(d.notes)}</p></div>` : ""}

    <div class="detail-section">
      <h3>Ingredients</h3>
      ${
        ings.length
          ? `<ul class="ing-list">${ings.map((i) => `<li><span class="q">${esc([i.quantity, i.unit].filter(Boolean).join(" ")) || "—"}</span><span>${esc(i.name)}</span></li>`).join("")}</ul>`
          : `<p class="muted" style="margin:0">No ingredients yet.</p>`
      }
    </div>

    <div class="pill-row" style="margin:6px 0 14px">
      <button class="btn primary" data-mark-cooked="${d.id}">🍳 Mark as cooked</button>
      <button class="btn" data-add-list="${d.id}">Add to list</button>
      <button class="btn ghost" data-edit="${d.id}">Edit</button>
    </div>

    ${
      log.length
        ? `<div class="detail-section">
            <h3>Cook log</h3>
            <ul class="log-list">
              ${log
                .map(
                  (c) => `<li>
                    <span class="log-date">${esc(fmtDate(c.date))} ${c.rating ? "· " + "★".repeat(c.rating) : ""}</span>
                    ${c.note ? `<span class="log-note">${esc(c.note)}</span>` : ""}
                  </li>`
                )
                .join("")}
            </ul>
          </div>`
        : ""
    }
  `);
}

// Mark-cooked mini form (note + optional occasion rating), appended into the sheet.
function openMarkCooked(id) {
  const d = findDish(id);
  if (!d) return;
  openSheet(`
    <div class="sheet-head">
      <h2>Mark as cooked</h2>
      <button class="sheet-close" data-close aria-label="Close">×</button>
    </div>
    <p class="muted" style="margin-top:0">Logging <b>${esc(d.name)}</b> for today, ${esc(fmtDate(new Date().toISOString()))}.</p>

    <div class="field">
      <label>How did it go this time? (optional)</label>
      ${starsHtml(0, { context: "occasion", large: true })}
    </div>
    <div class="field">
      <label for="cooked-note">Note for this cook (optional)</label>
      <textarea id="cooked-note" placeholder="Reduced the salt, Bean wanted seconds."></textarea>
    </div>
    <button class="btn primary block" data-confirm-cooked="${d.id}">Log it</button>
  `);
}
let occasionRating = 0;

function confirmCooked(id) {
  const d = findDish(id);
  if (!d) return;
  const note = document.getElementById("cooked-note")?.value.trim() || "";
  const today = new Date().toISOString();
  d.cookLog.push({ date: today, rating: occasionRating, note });
  d.timesCooked = d.cookLog.length;
  d.lastCooked = today;
  if (occasionRating) d.rating = occasionRating; // latest occasion updates the headline rating
  occasionRating = 0;
  saveState();
  closeSheet();
  render();
  toast("Logged — Bean's a lucky one 🍽️");
}

/* ---- Settings / backup ---- */
function openSettings() {
  openSheet(`
    <div class="sheet-head">
      <h2>Backup &amp; about</h2>
      <button class="sheet-close" data-close aria-label="Close">×</button>
    </div>

    <div class="detail-section">
      <h3>Your data</h3>
      <p class="muted" style="margin-top:0">Everything lives in this browser only — ${state.dishes.length} dish${state.dishes.length === 1 ? "" : "es"} saved. Export a backup before switching phones.</p>
      <div class="stack">
        <button class="btn block" id="export-btn">⬇︎ Export backup (JSON)</button>
        <button class="btn block ghost" id="import-btn">⬆︎ Import backup (JSON)</button>
      </div>
    </div>

    <hr class="divider" />

    <div class="detail-section">
      <h3>Bean &amp; Boyfriend — our calendar</h3>
      <div class="occ-list">${upcomingOccasions(null).map(occasionRow).join("")}</div>
    </div>

    <hr class="divider" />
    <div class="note-soft">
      Bean's Table is a free, no-backend app. No accounts, no servers, no AI, no tracking.
      Reminders are delivered by <b>your own calendar app</b> — this app can't send push notifications.
    </div>
    <p class="signoff">Made for Bean, by Boyfriend. 🤍</p>
  `);
}

/* =========================================================================
   6. WIRE-UP (event delegation)
   ========================================================================= */

// Tab bar
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) goTab(tab.dataset.tab);
});

document.getElementById("menuBtn").addEventListener("click", openSettings);

// Overlay close (scrim / × buttons)
overlay.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target.classList.contains("overlay-scrim")) closeSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.hidden) closeSheet();
});

// Main app delegated clicks
app.addEventListener("click", (e) => {
  const t = e.target;

  if (t.closest("[data-new]")) return openEditor(null);
  const open = t.closest("[data-open]");
  if (open) return openDetail(open.dataset.open);

  const sort = t.closest("[data-sort]");
  if (sort) {
    state.settings.sort = sort.dataset.sort;
    saveState();
    return renderLibrary();
  }

  const cookWeek = t.closest("[data-cook-week]");
  if (cookWeek) {
    state.weekDishId = cookWeek.dataset.cookWeek;
    saveState();
    toast("Set as this week's dish");
    return render();
  }

  const addList = t.closest("[data-add-list]");
  if (addList) return addToList(addList.dataset.addList);

  const star = t.closest("[data-stars] [data-star]");
  if (star) return handleStarClick(star);

  // shopping list
  const chk = t.closest("[data-check]");
  if (chk && chk.tagName === "INPUT") return; // handled on change
  const removeList = t.closest("[data-remove-list]");
  if (removeList) return removeFromList(removeList.dataset.removeList);
  if (t.closest("[data-clear-checked]")) return clearChecked();

  // this week
  const ics = t.closest("[data-ics]");
  if (ics) {
    const d = findDish(ics.dataset.ics);
    if (d) download(`bean-${d.name.replace(/\W+/g, "-").toLowerCase()}.ics`, buildIcs(d), "text/calendar");
    return;
  }
  const buildList = t.closest("[data-build-list]");
  if (buildList) {
    addToList(buildList.dataset.buildList);
    goTab("list");
    return;
  }
});

// This Week selects/inputs
app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "weekDish") {
    state.weekDishId = t.value || null;
    saveState();
    return renderWeek();
  }
  if (t.id === "cookDay") {
    state.settings.cookDay = Number(t.value);
    saveState();
    return renderWeek();
  }
  if (t.id === "cookTime") {
    state.settings.cookTime = t.value || "10:00";
    saveState();
    return renderWeek();
  }
  const chk = t.closest("[data-check]");
  if (chk) {
    const key = chk.dataset.check;
    if (chk.checked) state.checked[key] = true;
    else delete state.checked[key];
    saveState();
    chk.closest(".check-row").classList.toggle("done", chk.checked);
  }
});

// Sheet delegated clicks
sheet.addEventListener("click", (e) => {
  const t = e.target;

  const star = t.closest("[data-stars] [data-star]");
  if (star) return handleStarClick(star);

  if (t.closest("#f-split")) return splitPaste();
  if (t.closest("#f-add-row")) return addIngRow();
  const rm = t.closest("[data-ing-remove]");
  if (rm) return removeIngRow(Number(rm.dataset.ingRemove));
  if (t.closest("#f-save")) return saveDraft();

  const del = t.closest("[data-delete]");
  if (del) return deleteDish(del.dataset.delete);

  const edit = t.closest("[data-edit]");
  if (edit) return openEditor(edit.dataset.edit);

  const markCooked = t.closest("[data-mark-cooked]");
  if (markCooked) return openMarkCooked(markCooked.dataset.markCooked);

  const confirm = t.closest("[data-confirm-cooked]");
  if (confirm) return confirmCooked(confirm.dataset.confirmCooked);

  const addList = t.closest("[data-add-list]");
  if (addList) return addToList(addList.dataset.addList);

  if (t.closest("#export-btn")) return exportData();
  if (t.closest("#import-btn")) return document.getElementById("importFile").click();
});

/* ---- Stars: works in library, detail, and the occasion form ---- */
function handleStarClick(btn) {
  const wrap = btn.closest("[data-stars]");
  const value = Number(btn.dataset.star);
  const context = wrap.dataset.context;

  if (context === "occasion") {
    occasionRating = value;
    wrap.querySelectorAll("[data-star]").forEach((b) => b.classList.toggle("on", Number(b.dataset.star) <= value));
    return;
  }
  const dishId = wrap.dataset.dish;
  const d = findDish(dishId);
  if (!d) return;
  d.rating = value;
  saveState();
  wrap.querySelectorAll("[data-star]").forEach((b) => b.classList.toggle("on", Number(b.dataset.star) <= value));
  const num = wrap.querySelector(".rating-num");
  if (num) num.textContent = value.toFixed(0);
  // keep the library card grid in sync if rating sort is active
  if (context === "detail" && currentTab === "library") {/* re-render on close */}
}

/* ---- Ingredient editor row ops ---- */
function splitPaste() {
  const ta = document.getElementById("f-paste");
  const lines = ta.value.split("\n").map(parseIngredientLine).filter(Boolean);
  if (!lines.length) {
    toast("Type one ingredient per line first.");
    return;
  }
  syncDraftFromDom();
  // drop empty placeholder rows, then append the parsed ones
  draft.ingredients = draft.ingredients.filter((i) => i.quantity || i.unit || i.name).concat(lines);
  ta.value = "";
  renderEditor(state.dishes.some((d) => d.id === draft.id));
  toast(`Added ${lines.length} ingredient${lines.length === 1 ? "" : "s"}`);
}

function addIngRow() {
  syncDraftFromDom();
  draft.ingredients.push({ quantity: "", unit: "", name: "" });
  renderEditor(state.dishes.some((d) => d.id === draft.id));
  // focus the new name field
  const rows = document.querySelectorAll(".ing-row");
  rows[rows.length - 1]?.querySelector('[data-ing-field="quantity"]')?.focus();
}

function removeIngRow(idx) {
  syncDraftFromDom();
  draft.ingredients.splice(idx, 1);
  renderEditor(state.dishes.some((d) => d.id === draft.id));
}

function deleteDish(id) {
  const d = findDish(id);
  if (!d) return;
  if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
  state.dishes = state.dishes.filter((x) => x.id !== id);
  state.listDishIds = state.listDishIds.filter((x) => x !== id);
  if (state.weekDishId === id) state.weekDishId = null;
  Object.keys(state.checked).forEach((k) => { if (k.startsWith(id + ":")) delete state.checked[k]; });
  saveState();
  closeSheet();
  render();
  toast("Dish deleted");
}

/* ---- Shopping list ops ---- */
function addToList(id) {
  if (!state.listDishIds.includes(id)) {
    state.listDishIds.push(id);
    saveState();
    toast("Added to shopping list");
  } else {
    toast("Already on the list");
  }
  render();
}
function removeFromList(id) {
  state.listDishIds = state.listDishIds.filter((x) => x !== id);
  Object.keys(state.checked).forEach((k) => { if (k.startsWith(id + ":")) delete state.checked[k]; });
  saveState();
  renderList();
  toast("Removed from list");
}
function clearChecked() {
  state.checked = {};
  saveState();
  renderList();
  toast("Cleared checked items");
}

/* ---- Export / import ---- */
function exportData() {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`beans-table-backup-${stamp}.json`, JSON.stringify(state, null, 2), "application/json");
  toast("Backup downloaded");
}

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.dishes)) throw new Error("Not a Bean's Table backup");
      if (!window.confirm("Importing will replace your current data. Continue?")) return;
      state = migrate(parsed);
      saveState();
      closeSheet();
      currentTab = "library";
      render();
      toast(`Imported ${state.dishes.length} dishes`);
    } catch (err) {
      toast("That file isn't a valid backup.");
      console.error(err);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

/* =========================================================================
   BOOT
   ========================================================================= */
render();

// PWA service worker — installability / offline only (never push).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
