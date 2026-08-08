# [🎮 SGT (Sid's Game Tracker)](https://sids-game-tracker.vercel.app/)

<p align="center">
  <a href="./LICENSE.txt">
  <img src="https://img.shields.io/badge/license-MIT Public License-blue.svg">
  </a>
  <a href="https://sids-game-tracker.vercel.app/">
    <img alt="Website" src="https://img.shields.io/badge/-website-blue">
  </a>
  <a href="http://makeapullrequest.com">
    <img alt="Pull Requests Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat">
  </a>
</p>

A local-first web app that turns your personal game list into meaningful insights,
visualizations, and (optionally) AI-powered recommendations.

Your credentials stay in your browser. Game data lives in **your** Neon database
(or local browser storage) — nothing is stored on our servers.

---
### 🔗 [Available to use here](https://sids-game-tracker.vercel.app/)

---

## ✨ Features

* 📊 Dashboard analytics (status, platform, genres, collection value)
* ✍️ **Add / edit / delete** games directly from the UI
* 🗂️ **Backlog** list (name + platform) — enrich with IGDB and promote to Played with status/rating/review
* 💵 Optional **price** field per game + value analytics (total & average of paid games)
* 📥 **CSV import** (`game,platform,status,rating,review`) straight into your database
* 🖼️ Optional **IGDB** integration for covers & genre enrichment
* 🧠 Optional AI player-preference insights + game recommendations (toggle on/off)
* 💾 Local caching for faster repeated loads
* 🌗 Dark / Light mode with animated backgrounds

---

## 🚀 How it Works

1. You provide a **Neon** Postgres connection string (or leave it empty to use local browser storage).
2. The app reads and writes your games directly from the browser.
3. Analytics (and optional AI insights) are generated locally.
4. Optional IGDB enrichment adds covers and genres.

---

## 🗄️ Data source: NeonDB (optional)

Paste your Neon connection string in setup (from the Neon dashboard → *Connection string*):

```
postgresql://<user>:<password>@<host>/<db>?sslmode=require
```

* The app **auto-creates** two tables on first connect: `games` and `backlog`.
* All queries are parameterized (safe against SQL injection).
* **Leave it empty** to run fully offline using local browser storage — you can still
  add/edit/import games; they just live in this browser only.

> ⚠️ Security note: the connection string is stored in your browser's `localStorage`
> and used directly from the browser via Neon's serverless HTTP driver. Use a database
> role scoped to this app. For a shared/public deployment, prefer a serverless API layer.

### Table schema (auto-created)

```sql
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Ongoing',
  rating NUMERIC NOT NULL DEFAULT 0,
  review TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS backlog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0
);
```

Allowed `status` values: **Finished, Dropped, On Hold, Ongoing**. Rating is `0–10`.

---

## 📥 CSV Import

Use the **Import CSV** button. Expected header (case-insensitive):

```
game,platform,status,rating,review
```

Example:

| game           | platform | status   | rating | review                      |
| -------------- | -------- | -------- | ------ | --------------------------- |
| Cyberpunk 2077 | PC       | Finished | 9      | Strong narrative immersion. |

`price` isn't in the legacy format, so imported games default to `0`.

---

## 🎮 IGDB enrichment (optional)

IGDB provides covers + genres. It replaces the older RAWG integration.

1. Create a **Twitch application** at <https://dev.twitch.tv/console/apps/create>
   (Client Type: **Confidential**), then generate a **Client Secret**.
2. Paste the **Client ID** and **Client Secret** into setup.

### ⚠️ Why a proxy is required

IGDB **blocks direct browser requests** (CORS) — its own docs recommend a backend
proxy. This project ships a tiny relay at [`api/igdb.js`](./api/igdb.js) that performs
the Twitch OAuth token exchange server-side and forwards your query. On Vercel it is
served automatically at `/api/igdb` (free Hobby tier).

* Deploying on **Vercel**? Nothing to do — leave *IGDB Proxy URL* empty.
* Self-hosting the frontend elsewhere? Set **IGDB Proxy URL** to your own relay
  (e.g. a free **Cloudflare Worker** — see below). Users still bring their own IGDB creds.

<details>
<summary>Cloudflare Worker relay (free, ~100k req/day)</summary>

```js
const tokenCache = new Map();

async function getToken(id, secret) {
  const c = tokenCache.get(id);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" }
  );
  const j = await r.json();
  tokenCache.set(id, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

export default {
  async fetch(req) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return new Response("Use POST", { status: 405, headers: cors });

    const { clientId, clientSecret, endpoint = "games", query = "" } = await req.json();
    if (!clientId || !clientSecret) return new Response("Missing creds", { status: 400, headers: cors });

    const token = await getToken(clientId, clientSecret);
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": clientId, Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: query
    });
    const text = await res.text();
    return new Response(text || "[]", {
      status: res.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
```

Then set *IGDB Proxy URL* to your Worker URL (e.g. `https://igdb-proxy.you.workers.dev`).
</details>

> Running the Vite dev server locally? `/api/igdb` isn't available under plain `vite`.
> Either set *IGDB Proxy URL* to a deployed proxy, or run the app with `vercel dev`.

---

## 🤖 AI features (optional)

Turn the **AI features** switch **on** in setup to enable derived player preferences
and recommendations. When off, no LLM credentials are required (the fields are grayed out).

When enabled, provide an OpenAI-compatible endpoint:

* **API URL** — e.g. `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`
* **API Key** — your key (stored only in this browser)
* **Model** — e.g. `gpt-4o-mini`

---

## ⚙️ Setup Instructions

### 1. Clone the repo

```
git clone https://github.com/SiddharthaBhattacharjee/Sids_Game_Tracker
```

### 2. Install dependencies

```
npm install
```

### 3. Run the app

```
npm run dev
```

Open: <http://localhost:5173>

### 4. Configure (first launch)

Fill in the setup screen:

* **Neon Database URL** (optional — empty = local browser storage)
* **IGDB Client ID / Secret** (optional — covers & genres)
* **AI features** toggle + LLM API URL / Key / Model (optional)

Click **Test Configuration**, then **Save**.

---

## ⚠️ Common Issues

**IGDB covers/genres missing** — IGDB needs the proxy. On Vercel it's automatic; elsewhere
set the *IGDB Proxy URL*. Check the Client ID/Secret are valid.

**Neon errors** — confirm the connection string includes `?sslmode=require` and the role
can create tables.

**No recommendations** — make sure AI is toggled on and the API URL/key/model are valid.

---

## 🏗️ Tech Stack

* React (Vite)
* NeonDB (`@neondatabase/serverless`) with a localStorage fallback
* IGDB (via a small serverless / Worker proxy)
* OpenAI-compatible LLM APIs (optional)
* LocalStorage caching

---

## 📜 License

MIT License. You are free to use, modify, and distribute this project, but attribution
is required.

---

## 👤 Author

Made with ❤️ by **Siddhartha Bhattacharjee**

<a href="https://siddhartha-portfolio.vercel.app/"> 🔗 Siddhartha Bhattacharjee </a>
