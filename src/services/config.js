export const CONFIG_STORAGE_KEY = "gameInsightsConfig";

export function emptyConfig() {
  return {
    neonUrl: "",
    igdbClientId: "",
    igdbClientSecret: "",
    igdbProxyUrl: "",
    aiEnabled: false,
    apiUrl: "",
    apiKey: "",
    model: ""
  };
}

export function normalizeConfig(config) {
  return {
    neonUrl: String(config?.neonUrl ?? "").trim(),
    igdbClientId: String(config?.igdbClientId ?? "").trim(),
    igdbClientSecret: String(config?.igdbClientSecret ?? "").trim(),
    igdbProxyUrl: String(config?.igdbProxyUrl ?? "").trim(),
    aiEnabled: Boolean(config?.aiEnabled ?? false),
    apiUrl: String(config?.apiUrl ?? "").trim(),
    apiKey: String(config?.apiKey ?? "").trim(),
    model: String(config?.model ?? "").trim()
  };
}

export function igdbConfigured(config) {
  const normalized = normalizeConfig(config);
  return Boolean(normalized.igdbClientId && normalized.igdbClientSecret);
}

export function validateConfigShape(config) {
  const normalized = normalizeConfig(config);

  if (normalized.neonUrl && !/^postgres(?:ql)?:\/\//i.test(normalized.neonUrl)) {
    throw new Error("Neon URL must be a postgres:// or postgresql:// connection string.");
  }

  if (normalized.aiEnabled) {
    const missing = ["apiUrl", "apiKey", "model"].filter((field) => !normalized[field]);

    if (missing.length > 0) {
      throw new Error(
        `AI is enabled but missing: ${missing.join(", ")}. Disable AI or fill these in.`
      );
    }
  }

  const hasIgdbId = Boolean(normalized.igdbClientId);
  const hasIgdbSecret = Boolean(normalized.igdbClientSecret);

  if (hasIgdbId !== hasIgdbSecret) {
    throw new Error("IGDB needs both Client ID and Client Secret, or leave both empty.");
  }

  return normalized;
}

export function loadConfig() {
  const stored = window.localStorage.getItem(CONFIG_STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    return validateConfigShape(JSON.parse(stored));
  } catch {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY);
    return null;
  }
}

export function saveConfig(config) {
  const normalized = validateConfigShape(config);
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function clearConfig() {
  window.localStorage.removeItem(CONFIG_STORAGE_KEY);
}

export function parseImportedConfig(text) {
  try {
    return validateConfigShape(JSON.parse(text));
  } catch (error) {
    throw new Error(`Import failed: ${error.message || "JSON is invalid."}`);
  }
}

export function downloadConfig(config) {
  const normalized = normalizeConfig(config);
  const blob = new Blob([JSON.stringify(normalized, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "game-insights-config.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
