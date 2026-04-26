const RAWG_URL = "https://api.rawg.io/api/games";
const RAWG_CACHE_STORAGE_KEY = "gameInsightsRawgCache";
const RAWG_CACHE_SCHEMA_VERSION = 1;
const rawgCache = new Map();

export async function testRawgKey(rawgApiKey, signal) {
  if (!rawgApiKey) {
    return null;
  }

  const url = `${RAWG_URL}?key=${encodeURIComponent(rawgApiKey)}&search=Portal&page_size=1`;
  let response;

  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new Error("RAWG fetch failed -> continuing without enrichment.");
  }

  if (!response.ok) {
    throw new Error(`RAWG validation failed (${response.status}) -> continuing without enrichment.`);
  }

  await response.json();
  return true;
}

export async function fetchRawgGame(gameName, rawgApiKey, signal) {
  if (!rawgApiKey) {
    return null;
  }

  const cacheKey = normalizeName(gameName);

  if (rawgCache.has(cacheKey)) {
    return rawgCache.get(cacheKey);
  }

  const stored = readStoredRawgGame(cacheKey);

  if (stored) {
    rawgCache.set(cacheKey, stored);
    return stored;
  }

  const url = `${RAWG_URL}?key=${encodeURIComponent(rawgApiKey)}&search=${encodeURIComponent(
    gameName
  )}&page_size=1`;
  let response;

  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new Error("RAWG fetch failed -> continuing without enrichment.");
  }

  if (!response.ok) {
    throw new Error(`RAWG fetch failed (${response.status}) -> continuing without enrichment.`);
  }

  const data = await response.json();
  const match = data.results?.[0];
  const result = match
    ? {
        rawgName: match.name ?? gameName,
        image: match.background_image ?? "",
        genres: Array.isArray(match.genres) ? match.genres.map((genre) => genre.name) : []
      }
    : {
        rawgName: gameName,
        image: "",
        genres: []
      };

  rawgCache.set(cacheKey, result);
  writeStoredRawgGame(cacheKey, result);
  return result;
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function readStoredRawgGame(cacheKey) {
  try {
    const cache = readStoredRawgCache();
    const value = cache.games?.[cacheKey];

    if (!isValidStoredRawgGame(value)) {
      return null;
    }

    return normalizeStoredRawgGame(value);
  } catch {
    return null;
  }
}

function writeStoredRawgGame(cacheKey, value) {
  try {
    const cache = readStoredRawgCache();
    cache.games[cacheKey] = {
      ...normalizeStoredRawgGame(value),
      cachedAt: new Date().toISOString()
    };
    cache.updatedAt = new Date().toISOString();
    window.localStorage.setItem(RAWG_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("[Game Insights] Failed to save RAWG cache", error);
  }
}

function readStoredRawgCache() {
  const emptyCache = {
    schemaVersion: RAWG_CACHE_SCHEMA_VERSION,
    updatedAt: "",
    games: {}
  };

  if (typeof window === "undefined" || !window.localStorage) {
    return emptyCache;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(RAWG_CACHE_STORAGE_KEY) || "null");

    if (
      !stored ||
      stored.schemaVersion !== RAWG_CACHE_SCHEMA_VERSION ||
      !stored.games ||
      typeof stored.games !== "object"
    ) {
      return emptyCache;
    }

    return {
      schemaVersion: RAWG_CACHE_SCHEMA_VERSION,
      updatedAt: String(stored.updatedAt ?? ""),
      games: stored.games
    };
  } catch {
    return emptyCache;
  }
}

function isValidStoredRawgGame(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.rawgName === "string" &&
    typeof value.image === "string" &&
    Array.isArray(value.genres)
  );
}

function normalizeStoredRawgGame(value) {
  return {
    rawgName: String(value?.rawgName ?? ""),
    image: String(value?.image ?? ""),
    genres: Array.isArray(value?.genres)
      ? value.genres.map((genre) => String(genre).trim()).filter(Boolean)
      : []
  };
}
