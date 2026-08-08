// Vercel-style serverless function (Node runtime) that relays browser requests
// to the IGDB API, performing the Twitch OAuth token exchange server-side so the
// browser never hits IGDB directly (IGDB blocks CORS).
//
// The browser sends { clientId, clientSecret, endpoint, query }. Credentials are
// supplied per-request (users bring their own), so no secrets are stored here.
//
// Self-hosting elsewhere? The same logic works as a Cloudflare Worker / Deno
// Deploy handler — see the README for a drop-in Worker version.

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE_URL = "https://api.igdb.com/v4";
const ALLOWED_ENDPOINTS = new Set(["games", "genres", "covers", "search"]);

// Cache tokens per client id across warm invocations to avoid re-exchanging.
const tokenCache = new Map();

async function getAccessToken(clientId, clientSecret) {
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  });

  const response = await fetch(`${TWITCH_TOKEN_URL}?${params.toString()}`, { method: "POST" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Twitch token exchange failed (${response.status}) ${detail}`.trim());
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Twitch token exchange returned no access_token.");
  }

  tokenCache.set(clientId, {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  });

  return data.access_token;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  const { clientId, clientSecret, endpoint = "games", query = "" } = payload || {};

  if (!clientId || !clientSecret) {
    res.status(400).json({ error: "Missing IGDB clientId/clientSecret." });
    return;
  }

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    res.status(400).json({ error: `Unsupported endpoint: ${endpoint}` });
    return;
  }

  try {
    const token = await getAccessToken(String(clientId), String(clientSecret));
    const igdbResponse = await fetch(`${IGDB_BASE_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": String(clientId),
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      body: String(query)
    });

    const text = await igdbResponse.text();
    res.status(igdbResponse.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text || "[]");
  } catch (error) {
    res.status(502).json({ error: error.message || "IGDB proxy error." });
  }
}
