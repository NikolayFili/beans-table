/* Bean's Table — serverless state API (Vercel function, runs server-side).
   Holds the Neon connection as a SECRET (process.env.DATABASE_URL) so it never
   reaches the browser. Gated by a shared passphrase (process.env.APP_TOKEN) that
   the user also enters in the app — so the endpoint isn't open to the world.

   Stores the whole app-state JSON as one row in `app_state` (id = 'beans-table').
   GET  -> returns the stored state (or null)
   PUT  -> upserts the state (last-write-wins handled client-side via updatedAt) */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  // CORS — safe because every request still needs the passphrase below.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-app-token");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!process.env.DATABASE_URL) return res.status(500).json({ error: "DATABASE_URL not configured" });
  // Auth is OPTIONAL: only enforced if an APP_TOKEN is configured. With no token
  // set, the endpoint is open (simplest UX) — fine for a low-stakes personal app.
  if (process.env.APP_TOKEN && req.headers["x-app-token"] !== process.env.APP_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const sql = neon(process.env.DATABASE_URL);
  try {
    // GET is the load path — keep it to a SINGLE query (no create-table round-trip).
    if (req.method === "GET") {
      try {
        const rows = await sql`select data from app_state where id = 'beans-table'`;
        return res.status(200).json(rows.length ? rows[0].data : null);
      } catch (e) {
        return res.status(200).json(null); // table not created yet → treat as empty
      }
    }

    if (req.method === "PUT") {
      // Ensure the table exists only on writes (rarer, not latency-sensitive).
      await sql`create table if not exists app_state (
        id text primary key,
        data jsonb not null,
        updated_at bigint not null default 0
      )`;
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const updatedAt = Number(body.updatedAt) || 0;
      await sql`insert into app_state (id, data, updated_at)
                values ('beans-table', ${JSON.stringify(body)}::jsonb, ${updatedAt})
                on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
