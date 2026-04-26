export const CONFIG_STORAGE_KEY = "gameInsightsConfig";

const REQUIRED_FIELDS = ["sheetUrl", "apiUrl", "apiKey", "model"];

export function emptyConfig() {
  return {
    sheetUrl: "",
    apiUrl: "",
    apiKey: "",
    model: "",
    rawgApiKey: ""
  };
}

export function normalizeConfig(config) {
  return {
    sheetUrl: String(config?.sheetUrl ?? "").trim(),
    apiUrl: String(config?.apiUrl ?? "").trim(),
    apiKey: String(config?.apiKey ?? "").trim(),
    model: String(config?.model ?? "").trim(),
    rawgApiKey: String(config?.rawgApiKey ?? "").trim()
  };
}

export function validateConfigShape(config) {
  const normalized = normalizeConfig(config);
  const missing = REQUIRED_FIELDS.filter((field) => !normalized[field]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}.`);
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
