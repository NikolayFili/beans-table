# Bean's Table 🍽️

A free, no-backend personal web app for cooking one nice dish a week for Bean.
Log dishes, rate them, build a shopping list, and get a **weekly calendar reminder**.

It's a plain static site — `index.html` + `app.js` + `styles.css`, no build step — so
GitHub Pages serves it directly with zero config. Everything runs client-side in your
browser and persists to `localStorage`. **No accounts, no servers, no database, no API
keys, no AI, no tracking, and no running costs.**

## Features

- **Dish library** — cards with name, star rating, times cooked, last-cooked date, a
  source badge (YouTube / Instagram / Link / Mine), and ingredient count. Sort by top
  rating, recently added, or "cook me next" (haven't cooked in longest).
- **Add / edit a dish** — name, optional source URL (YouTube links embed a player),
  servings, notes. Paste ingredients one per line and **split into editable
  quantity / unit / name rows** with a local parser that only reshapes your own text —
  it never looks anything up or invents anything. Fractions like `1/3` are preserved.
- **Rating + cook log** — tap the stars to rate anytime. "Mark as cooked" records the
  date, bumps the times-cooked counter, updates last-cooked, and can attach a note and a
  rating for that specific occasion. A per-dish cook log keeps the history.
- **Schedule** — set cook day + time (default Saturday 10:00) and assign a dish to each
  upcoming week, seeing the whole queue at a glance. "Up next" surfaces the soonest cook
  with an **Add to Google Calendar** link; **Calendar (.ics)** downloads every planned
  cook as one file, each event with an alarm 3 hours before. The library's "Cook this
  week" button schedules a dish for the soonest slot.
- **Shopping list** — ingredients grouped by dish, each with a checkbox that persists.
  Clear checked items or remove a dish.
- **Backup** — JSON **export / import** so you can back up and move between devices.

## A note on reminders (be honest with yourself)

This app **cannot send you notifications** — it has no server, and web push requires one.
Reminders are delivered by **your own calendar app**: add the recurring Google Calendar
event or import the `.ics`, and your phone's calendar does the reminding. That's the
trade for "free forever, no backend."

Likewise, there's **no recipe scraping**. Instagram blocks it and YouTube serves
bot-protection pages, so the app only stores your link (and embeds YouTube where it can).
Recipe entry is manual / paste.

## Running locally

No build step. Either:

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

…or just open `index.html` in a browser. (A server is recommended so the service worker
and PWA install work; `file://` blocks service workers.)

## Cloud sync (Vercel + Neon)

Bean's Table syncs across your devices via a small backend: a Vercel serverless function
(`api/state.js`) that reads/writes the whole app-state JSON in a **Neon Postgres** database.
The database credentials live **only** in Vercel's server-side environment — never in the
browser or this repo. Sync is last-write-wins (the most recently edited device wins).

**No passphrase, no setup.** When the app is served from its Vercel domain, it **auto-syncs
on load** — open it on any device and your data follows. The API endpoint is left open (it's
just a personal recipe list); auth can be re-enabled by setting an `APP_TOKEN` env var (the
function enforces it only when present, and the client would send it via the Settings field).

### Deploy (one time)

1. **Neon:** keep your **pooled** `DATABASE_URL` handy.
2. **Vercel:** **Add New → Project → Import** the `beans-table` repo (preset **Other** —
   zero-config; static files from root, `api/` becomes a function). Or just `vercel deploy`.
3. **Settings → Environment Variables:** add `DATABASE_URL` = your Neon pooled string.
   (Optional: add `APP_TOKEN` to require a passphrase.)
4. **Deploy.** Open `https://<project>.vercel.app` — sync just works. Open it on every device.

Your existing local data **migrates automatically**: the first device you open pushes its
local data up to the (empty) database; after that every device pulls/pushes changes.

The database schema is a single table:

```sql
create table app_state (
  id text primary key,        -- always 'beans-table'
  data jsonb not null,        -- the whole app-state blob
  updated_at bigint not null  -- last-write-wins clock
);
```

> The GitHub Pages copy still works as a local-only app, but its sync needs the Vercel
> backend — set "Sync server URL" to your Vercel URL there, or just use the Vercel app.

## Backup & device migration

- **Settings (⚙︎) → Export backup** downloads a `beans-table-backup-YYYY-MM-DD.json`.
- On another device, **Settings → Import backup** and pick that file. Import replaces the
  current data, so export first if you have anything you want to keep.

## Deploy free on GitHub Pages

Because there's no build step, Pages serves `index.html` directly — no Actions workflow
needed.

```bash
git add -A
git commit -m "Bean's Table"
# create a public repo named e.g. beans-table on GitHub, then:
git remote add origin https://github.com/<you>/beans-table.git
git branch -M main
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch →
`main` / `/ (root)` → Save**. Your live URL appears within a minute or two at
`https://<you>.github.io/beans-table/`.

## Install on your phone (PWA)

Open the live URL on your phone, then **Share → Add to Home Screen**. It launches
full-screen and works offline (the service worker caches the app shell). Your data stays
in that browser — remember to export a backup before switching phones.

## Project structure

```
index.html        markup + app shell
styles.css        warm "paper" theme (Fraunces + Hanken Grotesk)
app.js            storage layer, views, calendar/ICS, ingredient parser
manifest.json     PWA manifest
sw.js             service worker (offline/install only — never push)
icons/            app icons (SVG + PNG)
```

The data model is a single versioned JSON blob in `localStorage` under the key
`beansTable` (schema `version: 2`).
