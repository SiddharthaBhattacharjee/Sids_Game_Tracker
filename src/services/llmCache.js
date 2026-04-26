import { normalizeConfig } from "./config";

export const LLM_CACHE_STORAGE_KEY = "gameInsightsLlmCache";

const CACHE_SCHEMA_VERSION = 1;

export async function buildLlmCacheHash(config, games) {
  const payload = stableStringify({
    config: normalizeConfig(config),
    games: games.map((game) => ({
      id: game.id,
      game: game.game,
      platform: game.platform,
      status: game.status,
      rating: game.rating,
      review: game.review
    }))
  });

  return sha256(payload);
}

export function loadCachedLlmData(hash) {
  if (!hash) {
    return null;
  }

  try {
    const record = JSON.parse(window.localStorage.getItem(LLM_CACHE_STORAGE_KEY) || "null");

    if (
      !record ||
      record.schemaVersion !== CACHE_SCHEMA_VERSION ||
      record.hash !== hash ||
      !record.data
    ) {
      return null;
    }

    return normalizeCachedData(record.data);
  } catch {
    return null;
  }
}

export function saveCachedLlmData(hash, partialData) {
  if (!hash) {
    return null;
  }

  const existing = loadCachedLlmData(hash) || {};
  const data = normalizeCachedData({
    ...existing,
    ...partialData
  });

  const record = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    hash,
    savedAt: new Date().toISOString(),
    data
  };

  try {
    window.localStorage.setItem(LLM_CACHE_STORAGE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn("[Game Insights] Failed to save LLM cache", error);
  }

  return data;
}

function normalizeCachedData(data) {
  const preferencesText =
    typeof data?.preferencesText === "string"
      ? data.preferencesText
      : typeof data?.preferences?.text === "string"
        ? data.preferences.text
        : "";
  const recommendationsItems = Array.isArray(data?.recommendationsItems)
    ? data.recommendationsItems
    : Array.isArray(data?.recommendations?.items)
      ? data.recommendations.items
      : [];

  return {
    preferencesText,
    recommendationsItems: recommendationsItems
      .map((item) => ({
        game: String(item?.game ?? "").trim(),
        reasoning: String(item?.reasoning ?? item?.reason ?? "").trim()
      }))
      .filter((item) => item.game)
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function sha256(value) {
  if (window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);

    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return fallbackHash(value);
}

function fallbackHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
