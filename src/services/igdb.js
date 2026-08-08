import { normalizeConfig } from "./config";

const DEFAULT_PROXY_PATH = "/api/igdb";
const IGDB_CACHE_STORAGE_KEY = "gameInsightsIgdbCache";
const IGDB_CACHE_SCHEMA_VERSION = 1;
const IMAGE_SIZE = "t_cover_big";
const igdbCache = new Map();

function proxyEndpoint(config) {
  const normalized = normalizeConfig(config);
  return normalized.igdbProxyUrl || DEFAULT_PROXY_PATH;
}

function escapeSearch(value) {
  return String(value ?? "").replace(/["\\]/g, " ").trim();
}

function buildImageUrl(imageId) {
  if (!imageId) return "";
  return `https://images.igdb.com/igdb/image/upload/${IMAGE_SIZE}/${imageId}.jpg`;
}

async function queryIgdb(config, query, signal) {
  const normalized = normalizeConfig(config);

  if (!normalized.igdbClientId || !normalized.igdbClientSecret) {
    return [];
  }

  let response;
  try {
    response = await fetch(proxyEndpoint(config), {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: normalized.igdbClientId,
        clientSecret: normalized.igdbClientSecret,
        endpoint: "games",
        query
      })
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new Error("IGDB proxy unreachable -> confirm the IGDB Proxy URL or deploy the /api/igdb function.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `IGDB request failed (${response.status})${detail ? ` -> ${detail.slice(0, 160)}` : ""}.`
    );
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function testIgdbConfig(config, signal) {
  const results = await queryIgdb(config, 'search "Portal"; fields name; limit 1;', signal);
  if (!Array.isArray(results)) {
    throw new Error("IGDB validation failed -> unexpected response from proxy.");
  }
  return true;
}

export async function fetchIgdbGame(gameName, config, signal) {
  const normalized = normalizeConfig(config);

  if (!normalized.igdbClientId || !normalized.igdbClientSecret) {
    return null;
  }

  const cacheKey = normalizeName(gameName);

  if (igdbCache.has(cacheKey)) {
    return igdbCache.get(cacheKey);
  }

  const stored = readStoredIgdbGame(cacheKey);
  if (stored) {
    igdbCache.set(cacheKey, stored);
    return stored;
  }

  const search = escapeSearch(gameName);
  const query = `search "${search}"; fields name,cover.image_id,genres.name; limit 1;`;
  const results = await queryIgdb(config, query, signal);
  const match = results[0];

  const result = match
    ? {
        igdbName: match.name ?? gameName,
        image: buildImageUrl(match.cover?.image_id),
        genres: Array.isArray(match.genres) ? match.genres.map((genre) => genre.name).filter(Boolean) : []
      }
    : { igdbName: gameName, image: "", genres: [] };

  igdbCache.set(cacheKey, result);
  writeStoredIgdbGame(cacheKey, result);
  return result;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readStoredIgdbGame(cacheKey) {
  try {
    const cache = readStoredIgdbCache();
    const value = cache.games?.[cacheKey];
    if (!isValidStoredIgdbGame(value)) {
      return null;
    }
    return normalizeStoredIgdbGame(value);
  } catch {
    return null;
  }
}

function writeStoredIgdbGame(cacheKey, value) {
  try {
    const cache = readStoredIgdbCache();
    cache.games[cacheKey] = {
      ...normalizeStoredIgdbGame(value),
      cachedAt: new Date().toISOString()
    };
    cache.updatedAt = new Date().toISOString();
    window.localStorage.setItem(IGDB_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("[Game Insights] Failed to save IGDB cache", error);
  }
}

function readStoredIgdbCache() {
  const emptyCache = { schemaVersion: IGDB_CACHE_SCHEMA_VERSION, updatedAt: "", games: {} };

  if (typeof window === "undefined" || !window.localStorage) {
    return emptyCache;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(IGDB_CACHE_STORAGE_KEY) || "null");
    if (
      !stored ||
      stored.schemaVersion !== IGDB_CACHE_SCHEMA_VERSION ||
      !stored.games ||
      typeof stored.games !== "object"
    ) {
      return emptyCache;
    }
    return {
      schemaVersion: IGDB_CACHE_SCHEMA_VERSION,
      updatedAt: String(stored.updatedAt ?? ""),
      games: stored.games
    };
  } catch {
    return emptyCache;
  }
}

function isValidStoredIgdbGame(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.igdbName === "string" &&
    typeof value.image === "string" &&
    Array.isArray(value.genres)
  );
}

function normalizeStoredIgdbGame(value) {
  return {
    igdbName: String(value?.igdbName ?? ""),
    image: String(value?.image ?? ""),
    genres: Array.isArray(value?.genres)
      ? value.genres.map((genre) => String(genre).trim()).filter(Boolean)
      : []
  };
}
