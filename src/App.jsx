import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Gamepad2,
  ImageOff,
  KeyRound,
  Library,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wallet,
  X,
  XCircle,
  ArrowRight
} from "lucide-react";
import Galaxy from "./backgrounds/dark.jsx";
import {
  clearConfig,
  downloadConfig,
  emptyConfig,
  igdbConfigured,
  loadConfig,
  normalizeConfig,
  parseImportedConfig,
  saveConfig,
  validateConfigShape
} from "./services/config";
import {
  extendPreferences,
  extractPreferences,
  generateMoreRecommendations,
  generateRecommendations,
  testLlmConfig
} from "./services/llm";
import { buildLlmCacheHash, loadCachedLlmData, saveCachedLlmData } from "./services/llmCache";
import { fetchIgdbGame, testIgdbConfig } from "./services/igdb";
import { createStore, storeKind, VALID_STATUSES } from "./services/store";
import { parseGamesCsv } from "./utils/csv";
import { CHART_COLORS, computeAnalytics, ratingToStars } from "./utils/analytics";

const emptyIgdbState = { enabled: false, status: "disabled", loaded: 0, total: 0, message: "" };

const waitingPreferences = { status: "idle", text: "", error: "" };
const waitingRecommendations = { status: "idle", items: [], error: "" };

export default function App() {
  const [config, setConfig] = useState(() => loadConfig());
  const [showSetup, setShowSetup] = useState(() => !config);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem("darkMode", JSON.stringify(darkMode));
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  function handleSaved(nextConfig) {
    setConfig(nextConfig);
    setShowSetup(false);
  }

  function handleClearConfig() {
    clearConfig();
    setConfig(null);
    setShowSetup(true);
  }

  if (!config || showSetup) {
    return (
      <>
        <ThemeBackdrop darkMode={darkMode} />
        <SetupScreen
          initialConfig={config}
          onSaved={handleSaved}
          onCancel={config ? () => setShowSetup(false) : null}
          onClear={config ? handleClearConfig : null}
        />
      </>
    );
  }

  return (
    <>
      <ThemeBackdrop darkMode={darkMode} />
      <AppShell
        key={hashConfig(config)}
        config={config}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((current) => !current)}
        onSettings={() => setShowSetup(true)}
      />
    </>
  );
}

function ThemeBackdrop({ darkMode }) {
  if (!darkMode) {
    return null;
  }

  return (
    <Galaxy
      transparent={false}
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: -1 }}
    />
  );
}

function Tooltip({ children, content }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        style={{
          cursor: "pointer",
          marginLeft: "6px",
          fontSize: "14px",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "50%",
          width: "18px",
          height: "18px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.7
        }}
      >
        ?
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "120%",
            left: 0,
            width: "260px",
            background: "#111",
            color: "#fff",
            padding: "10px",
            borderRadius: "8px",
            fontSize: "12px",
            lineHeight: "1.4",
            zIndex: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)"
          }}
        >
          {content}
        </div>
      )}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Setup screen                                                        */
/* ------------------------------------------------------------------ */

function SetupScreen({ initialConfig, onSaved, onCancel, onClear }) {
  const [draft, setDraft] = useState(() => normalizeConfig(initialConfig ?? emptyConfig()));
  const [testState, setTestState] = useState({
    status: "idle",
    step: "",
    message: "",
    warning: "",
    hash: ""
  });
  const fileInputRef = useRef(null);
  const currentHash = hashConfig(draft);
  const canSave =
    ["success", "warning"].includes(testState.status) && testState.hash === currentHash;

  function updateField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestState({ status: "idle", step: "", message: "", warning: "", hash: "" });
  }

  async function handleTest() {
    const controller = new AbortController();
    const normalized = normalizeConfig(draft);

    try {
      validateConfigShape(normalized);

      setTestState({ status: "testing", step: "store", message: "Testing data store", warning: "", hash: "" });
      const store = createStore(normalized);
      await store.testConnection();
      const games = await store.listGames();

      let warning = "";

      if (igdbConfigured(normalized)) {
        setTestState({ status: "testing", step: "igdb", message: "Testing IGDB", warning: "", hash: "" });
        try {
          await testIgdbConfig(normalized, controller.signal);
        } catch (error) {
          warning = error.message || "IGDB check failed -> continuing without enrichment.";
        }
      }

      if (normalized.aiEnabled) {
        setTestState({ status: "testing", step: "llm", message: "Testing LLM API", warning, hash: "" });
        await testLlmConfig(normalized, controller.signal);
      }

      const storeLabel = normalized.neonUrl ? "Neon" : "local browser storage";
      setTestState({
        status: warning ? "warning" : "success",
        step: "",
        message: `Configuration works. Using ${storeLabel}. Existing games: ${games.length}.`,
        warning,
        hash: hashConfig(normalized)
      });
    } catch (error) {
      setTestState({
        status: "error",
        step: "",
        message: error.message || "Configuration test failed.",
        warning: "",
        hash: ""
      });
    }
  }

  function handleSave() {
    const saved = saveConfig(draft);
    onSaved(saved);
  }

  function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseImportedConfig(String(reader.result ?? ""));
        setDraft(imported);
        setTestState({
          status: "idle",
          step: "",
          message: "Imported config. Test before saving.",
          warning: "",
          hash: ""
        });
      } catch (error) {
        setTestState({ status: "error", step: "", message: error.message, warning: "", hash: "" });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  const aiDisabled = !draft.aiEnabled;

  return (
    <main className="setupShell">
      <section className="setupPanel framedTool">
        <div className="setupTopline">
          <div>
            <p className="eyebrow">Client-side setup</p>
            <h1>Game Insights Tracker</h1>
          </div>
          <div className="setupActions">
            <button className="ghostButton" type="button" onClick={() => downloadConfig(draft)}>
              <Download size={17} />
              Export JSON
            </button>
            <button className="ghostButton" type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={17} />
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              className="hiddenInput"
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
            />
          </div>
        </div>

        <div className="setupGroup">
          <p className="setupGroupTitle">
            <Database size={16} /> Data source
          </p>
          <div className="setupGrid">
            <label className="fieldGroup fullSpan">
              <span style={{ display: "flex", alignItems: "center" }}>
                Neon Database URL
                <Tooltip
                  content={
                    <div>
                      Paste your Neon Postgres connection string (from the Neon dashboard). Tables
                      are created automatically. Leave empty to store games in this browser only.
                    </div>
                  }
                />
              </span>
              <input
                type="password"
                value={draft.neonUrl}
                placeholder="postgresql://user:pass@host/db?sslmode=require (optional)"
                onChange={(event) => updateField("neonUrl", event.target.value)}
                autoComplete="off"
              />
              <small>Optional. Empty = local browser storage. Stored only in this browser.</small>
            </label>
          </div>
        </div>

        <div className="setupGroup">
          <p className="setupGroupTitle">
            <Gamepad2 size={16} /> IGDB enrichment (optional)
          </p>
          <div className="setupGrid">
            <label className="fieldGroup">
              <span>IGDB Client ID</span>
              <input
                type="text"
                value={draft.igdbClientId}
                placeholder="Twitch application client id"
                onChange={(event) => updateField("igdbClientId", event.target.value)}
                autoComplete="off"
              />
              <small>Enables covers and genre analytics.</small>
            </label>
            <label className="fieldGroup">
              <span>IGDB Client Secret</span>
              <input
                type="password"
                value={draft.igdbClientSecret}
                placeholder="Twitch application client secret"
                onChange={(event) => updateField("igdbClientSecret", event.target.value)}
                autoComplete="off"
              />
              <small>Stored only in this browser.</small>
            </label>
            <label className="fieldGroup fullSpan">
              <span style={{ display: "flex", alignItems: "center" }}>
                IGDB Proxy URL
                <Tooltip
                  content={
                    <div>
                      IGDB blocks direct browser calls (CORS). Requests route through a small proxy
                      that does the token exchange. Leave empty to use the bundled <code>/api/igdb</code>{" "}
                      function, or point to your own Cloudflare Worker / Deno Deploy relay.
                    </div>
                  }
                />
              </span>
              <input
                type="text"
                value={draft.igdbProxyUrl}
                placeholder="/api/igdb (default) or https://your-proxy.workers.dev"
                onChange={(event) => updateField("igdbProxyUrl", event.target.value)}
                autoComplete="off"
              />
              <small>Optional. Defaults to the same-origin /api/igdb function.</small>
            </label>
          </div>
        </div>

        <div className="setupGroup">
          <div className="setupGroupTitle" style={{ justifyContent: "space-between", width: "100%" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} /> AI features (optional)
            </span>
            <ToggleSwitch
              checked={draft.aiEnabled}
              onChange={(value) => updateField("aiEnabled", value)}
              label={draft.aiEnabled ? "On" : "Off"}
            />
          </div>
          <p className="setupHint">
            AI-derived preferences and recommendations. When off, no LLM credentials are required.
          </p>
          <div className={`setupGrid ${aiDisabled ? "disabledGroup" : ""}`}>
            <label className="fieldGroup">
              <span>LLM API URL</span>
              <input
                type="text"
                value={draft.apiUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => updateField("apiUrl", event.target.value)}
                disabled={aiDisabled}
                autoComplete="off"
              />
              <small>OpenAI-compatible base URL or full /chat/completions URL.</small>
            </label>
            <label className="fieldGroup">
              <span>LLM API Key</span>
              <input
                type="password"
                value={draft.apiKey}
                placeholder="sk-..."
                onChange={(event) => updateField("apiKey", event.target.value)}
                disabled={aiDisabled}
                autoComplete="off"
              />
              <small>Stored only in this browser.</small>
            </label>
            <label className="fieldGroup">
              <span>Model</span>
              <input
                type="text"
                value={draft.model}
                placeholder="gpt-4o-mini"
                onChange={(event) => updateField("model", event.target.value)}
                disabled={aiDisabled}
                autoComplete="off"
              />
              <small>Any chat-completions compatible model name.</small>
            </label>
          </div>
        </div>

        <ValidationStatus state={testState} />

        <div className="setupFooter">
          <div className="setupSecondaryActions">
            {onCancel ? (
              <button className="ghostButton" type="button" onClick={onCancel}>
                Close
              </button>
            ) : null}
            {onClear ? (
              <button className="dangerButton" type="button" onClick={onClear}>
                Clear Saved Config
              </button>
            ) : null}
          </div>
          <div className="primaryActions">
            <button
              className="secondaryButton"
              type="button"
              onClick={handleTest}
              disabled={testState.status === "testing"}
            >
              {testState.status === "testing" ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              Test Configuration
            </button>
            <button className="primaryButton" type="button" onClick={handleSave} disabled={!canSave}>
              <Save size={18} />
              Save Configuration
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className={`toggleSwitch ${checked ? "on" : "off"}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggleTrack">
        <span className="toggleThumb" />
      </span>
      {label ? <span className="toggleLabel">{label}</span> : null}
    </button>
  );
}

function ValidationStatus({ state }) {
  if (state.status === "idle" && !state.message) {
    return null;
  }

  const icon =
    state.status === "success" ? (
      <CheckCircle2 size={19} />
    ) : state.status === "testing" ? (
      <Loader2 className="spin" size={19} />
    ) : state.status === "warning" ? (
      <AlertTriangle size={19} />
    ) : (
      <XCircle size={19} />
    );

  return (
    <div className={`statusBox ${state.status}`}>
      {icon}
      <div>
        <strong>{state.message}</strong>
        {state.warning ? <p>{state.warning}</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App shell                                                           */
/* ------------------------------------------------------------------ */

function AppShell({ config, darkMode, onToggleDarkMode, onSettings }) {
  const store = useMemo(() => createStore(config), [config]);
  const igdbOn = igdbConfigured(config);
  const aiOn = Boolean(config.aiEnabled);

  const [reloadToken, setReloadToken] = useState(0);
  const [dataState, setDataState] = useState({
    status: "loading",
    games: [],
    backlog: [],
    error: ""
  });
  const [enrichments, setEnrichments] = useState({});
  const [backlogEnrichments, setBacklogEnrichments] = useState({});
  const [igdbState, setIgdbState] = useState(igdbOn ? { ...emptyIgdbState, enabled: true, status: "idle" } : emptyIgdbState);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // AI state
  const [preferences, setPreferences] = useState(waitingPreferences);
  const [recommendations, setRecommendations] = useState(waitingRecommendations);
  const [recommendationEnrichments, setRecommendationEnrichments] = useState({});
  const [llmCacheState, setLlmCacheState] = useState({ status: "idle", hash: "", data: null });
  const manualLlmInFlightRef = useRef(false);

  // Load games + backlog
  useEffect(() => {
    let active = true;
    setDataState({ status: "loading", games: [], backlog: [], error: "" });
    setEnrichments({});
    setBacklogEnrichments({});
    setPreferences(waitingPreferences);
    setRecommendations(waitingRecommendations);
    setRecommendationEnrichments({});
    setLlmCacheState({ status: "idle", hash: "", data: null });

    Promise.all([store.listGames(), store.listBacklog()])
      .then(([games, backlog]) => {
        if (!active) return;
        setDataState({ status: "ready", games, backlog, error: "" });
      })
      .catch((error) => {
        if (!active) return;
        setDataState({
          status: "error",
          games: [],
          backlog: [],
          error: error.message || "Failed to load data."
        });
      });

    return () => {
      active = false;
    };
  }, [store, reloadToken]);

  // IGDB enrichment for played games
  useEffect(() => {
    if (dataState.status !== "ready" || !igdbOn) {
      setIgdbState(igdbOn ? { ...emptyIgdbState, enabled: true, status: "idle" } : emptyIgdbState);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setIgdbState({ enabled: true, status: "loading", loaded: 0, total: dataState.games.length, message: "" });

    (async () => {
      let failures = 0;
      for (const game of dataState.games) {
        try {
          const enrichment = await fetchIgdbGame(game.name, config, controller.signal);
          if (!active) return;
          if (enrichment) {
            setEnrichments((current) => ({ ...current, [game.id]: enrichment }));
          }
        } catch (error) {
          if (error.name === "AbortError") return;
          failures += 1;
          if (/\((401|403)\)/.test(error.message || "")) {
            setIgdbState({ enabled: false, status: "disabled", loaded: 0, total: dataState.games.length, message: error.message });
            return;
          }
        } finally {
          if (active) {
            setIgdbState((current) =>
              current.status === "loading"
                ? { ...current, loaded: Math.min(current.loaded + 1, current.total) }
                : current
            );
          }
        }
      }
      if (!active) return;
      setIgdbState((current) => ({
        ...current,
        status: failures >= dataState.games.length && dataState.games.length > 0 ? "disabled" : failures > 0 ? "warning" : "ready",
        message: failures > 0 ? "Some IGDB matches failed -> showing available enrichment only." : ""
      }));
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [config, igdbOn, dataState.status, dataState.games]);

  // IGDB enrichment for backlog
  useEffect(() => {
    if (dataState.status !== "ready" || !igdbOn) {
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    (async () => {
      for (const item of dataState.backlog) {
        try {
          const enrichment = await fetchIgdbGame(item.name, config, controller.signal);
          if (!active) return;
          if (enrichment) {
            setBacklogEnrichments((current) => ({ ...current, [item.id]: enrichment }));
          }
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, igdbOn, dataState.status, dataState.backlog]);

  // LLM cache hash
  useEffect(() => {
    if (dataState.status !== "ready" || !aiOn) {
      return undefined;
    }
    let active = true;
    setLlmCacheState({ status: "checking", hash: "", data: null });
    buildLlmCacheHash(config, dataState.games)
      .then((hash) => {
        if (!active) return;
        setLlmCacheState({ status: "ready", hash, data: loadCachedLlmData(hash) });
      })
      .catch(() => {
        if (!active) return;
        setLlmCacheState({ status: "ready", hash: "", data: null });
      });
    return () => {
      active = false;
    };
  }, [config, aiOn, dataState.status, dataState.games]);

  const igdbReadyForLlm = !igdbOn || ["ready", "warning", "disabled"].includes(igdbState.status);
  const llmCanStart =
    aiOn &&
    dataState.status === "ready" &&
    dataState.games.length > 0 &&
    llmCacheState.status === "ready" &&
    (hasCachedPreferences(llmCacheState.data) || igdbReadyForLlm);

  // Auto preferences
  useEffect(() => {
    if (!llmCanStart || manualLlmInFlightRef.current) {
      return undefined;
    }

    if (hasCachedPreferences(llmCacheState.data)) {
      setPreferences({ status: "ready", text: llmCacheState.data.preferencesText, error: "" });
      if (hasCachedRecommendations(llmCacheState.data)) {
        setRecommendations({ status: "ready", items: llmCacheState.data.recommendationsItems, error: "" });
      }
      return undefined;
    }

    if (preferences.status !== "idle") {
      return undefined;
    }

    const controller = new AbortController();
    setPreferences({ status: "loading", text: "", error: "" });
    extractPreferences(config, dataState.games, enrichments, controller.signal)
      .then((text) => {
        setPreferences({ status: "ready", text, error: "" });
        saveAndHydrateLlmCache({ preferencesText: text });
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setPreferences({ status: "error", text: "", error: error.message || "Preference extraction failed." });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmCanStart, llmCacheState.data, preferences.status, enrichments]);

  // Auto recommendations
  useEffect(() => {
    if (!aiOn || manualLlmInFlightRef.current) {
      return undefined;
    }
    if (preferences.status !== "ready" || recommendations.status !== "idle") {
      return undefined;
    }
    if (hasCachedRecommendations(llmCacheState.data)) {
      setRecommendations({ status: "ready", items: llmCacheState.data.recommendationsItems, error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setRecommendations({ status: "loading", items: [], error: "" });
    generateRecommendations(config, dataState.games, preferences.text, controller.signal)
      .then((items) => {
        setRecommendations({ status: "ready", items, error: "" });
        saveAndHydrateLlmCache({ preferencesText: preferences.text, recommendationsItems: items });
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRecommendations({ status: "error", items: [], error: error.message || "Recommendation generation failed." });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, preferences.status, preferences.text, recommendations.status, llmCacheState.data]);

  // Enrich recommendation covers
  useEffect(() => {
    if (recommendations.status !== "ready" || !igdbOn || !["ready", "warning"].includes(igdbState.status)) {
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    (async () => {
      for (const item of recommendations.items) {
        try {
          const enrichment = await fetchIgdbGame(item.game, config, controller.signal);
          if (!active) return;
          if (enrichment) {
            setRecommendationEnrichments((current) => ({ ...current, [item.game]: enrichment }));
          }
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, igdbOn, igdbState.status, recommendations.status, recommendations.items]);

  const analytics = useMemo(() => {
    if (dataState.status !== "ready") {
      return null;
    }
    return computeAnalytics(dataState.games, enrichments);
  }, [dataState.status, dataState.games, enrichments]);

  function saveAndHydrateLlmCache(partialData) {
    const saved = saveCachedLlmData(llmCacheState.hash, partialData);
    if (saved) {
      setLlmCacheState((current) =>
        current.hash === llmCacheState.hash ? { ...current, data: saved } : current
      );
    }
    return saved;
  }

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  async function runAction(fn) {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      setModal(null);
      refresh();
    } catch (error) {
      setActionError(error.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  // Write handlers
  const handleAddGame = (values) => runAction(() => store.addGame(values));
  const handleUpdateGame = (id, values) => runAction(() => store.updateGame(id, values));
  const handleDeleteGame = (id) => runAction(() => store.deleteGame(id));
  const handleAddBacklog = (values) => runAction(() => store.addBacklog(values));
  const handleUpdateBacklog = (id, values) => runAction(() => store.updateBacklog(id, values));
  const handleDeleteBacklog = (id) => runAction(() => store.deleteBacklog(id));
  const handleMoveBacklog = (id, details) => runAction(() => store.moveBacklogToGames(id, details));
  const handleImport = (games) => runAction(() => store.importGames(games));

  async function regeneratePreferences() {
    manualLlmInFlightRef.current = true;
    setPreferences({ status: "loading", text: "", error: "" });
    const controller = new AbortController();
    try {
      const text = await extractPreferences(config, dataState.games, enrichments, controller.signal);
      setPreferences({ status: "ready", text, error: "" });
      setRecommendations(waitingRecommendations);
      saveAndHydrateLlmCache({ preferencesText: text });
    } catch (error) {
      if (error.name !== "AbortError") {
        setPreferences({ status: "error", text: "", error: error.message || "Preference extraction failed." });
      }
    } finally {
      manualLlmInFlightRef.current = false;
    }
  }

  async function regenerateRecommendations() {
    if (preferences.status !== "ready") return;
    manualLlmInFlightRef.current = true;
    setRecommendations({ status: "loading", items: [], error: "" });
    setRecommendationEnrichments({});
    const controller = new AbortController();
    try {
      const items = await generateRecommendations(config, dataState.games, preferences.text, controller.signal);
      setRecommendations({ status: "ready", items, error: "" });
      saveAndHydrateLlmCache({ preferencesText: preferences.text, recommendationsItems: items });
    } catch (error) {
      if (error.name !== "AbortError") {
        setRecommendations({ status: "error", items: [], error: error.message || "Recommendation generation failed." });
      }
    } finally {
      manualLlmInFlightRef.current = false;
    }
  }

  async function extendRecommendations() {
    if (preferences.status !== "ready" || recommendations.status !== "ready") return;
    manualLlmInFlightRef.current = true;
    const controller = new AbortController();
    try {
      const nextItems = await generateMoreRecommendations(
        config,
        dataState.games,
        preferences.text,
        recommendations.items,
        controller.signal
      );
      const merged = mergeRecommendationItems(recommendations.items, nextItems);
      setRecommendations({ status: "ready", items: merged, error: "" });
      saveAndHydrateLlmCache({ preferencesText: preferences.text, recommendationsItems: merged });
    } catch (error) {
      if (error.name !== "AbortError") {
        setRecommendations((current) => ({ ...current, error: error.message || "Recommendation extension failed." }));
      }
    } finally {
      manualLlmInFlightRef.current = false;
    }
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="brandLockup">
          <Gamepad2 size={27} />
          <div>
            <p className="eyebrow">
              {storeKind(config) === "neon" ? "Neon-backed" : "Local browser app"}
            </p>
            <h1>Sid's Game Tracker</h1>
          </div>
        </div>
        <div className="headerActions">
          <button className="ghostButton" type="button" onClick={onToggleDarkMode}>
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            {darkMode ? "Light" : "Dark"}
          </button>
          <button className="ghostButton" type="button" onClick={refresh}>
            <RefreshCw size={17} />
            Refresh
          </button>
          <button className="ghostButton" type="button" onClick={() => downloadConfig(config)}>
            <Download size={17} />
            Export
          </button>
          <button className="secondaryButton compactButton" type="button" onClick={onSettings}>
            <Settings size={17} />
            Settings
          </button>
        </div>
      </header>

      {dataState.status === "error" ? (
        <ErrorScreen error={dataState.error} onRetry={refresh} onSettings={onSettings} />
      ) : (
        <>
          <DashboardSection
            loading={dataState.status === "loading"}
            analytics={analytics}
            igdbState={igdbState}
            igdbConfigured={igdbOn}
          />

          <div className="toolbar">
            <button className="primaryButton compactButton" type="button" onClick={() => setModal({ type: "game" })}>
              <Plus size={16} />
              Add Game
            </button>
            <button className="secondaryButton compactButton" type="button" onClick={() => setModal({ type: "backlog" })}>
              <Library size={16} />
              Add to Backlog
            </button>
            <button className="secondaryButton compactButton" type="button" onClick={() => setModal({ type: "import" })}>
              <FileUp size={16} />
              Import CSV
            </button>
          </div>

          <GameListSection
            loading={dataState.status === "loading"}
            games={dataState.games}
            enrichments={enrichments}
            igdbState={igdbState}
            igdbConfigured={igdbOn}
            onEdit={(game) => setModal({ type: "game", payload: game })}
            onDelete={(game) => setModal({ type: "deleteGame", payload: game })}
          />

          <BacklogSection
            loading={dataState.status === "loading"}
            backlog={dataState.backlog}
            enrichments={backlogEnrichments}
            igdbConfigured={igdbOn}
            onEdit={(item) => setModal({ type: "backlog", payload: item })}
            onDelete={(item) => setModal({ type: "deleteBacklog", payload: item })}
            onMove={(item) => setModal({ type: "move", payload: item })}
          />

          {aiOn ? (
            <>
              <PreferenceSection
                state={preferences}
                waiting={!llmCanStart}
                onRegenerate={regeneratePreferences}
                canRegenerate={dataState.status === "ready" && preferences.status !== "loading"}
              />
              <RecommendationSection
                state={recommendations}
                enrichments={recommendationEnrichments}
                igdbActive={igdbOn && ["ready", "warning"].includes(igdbState.status)}
                blocked={preferences.status !== "ready"}
                onRegenerate={regenerateRecommendations}
                canRegenerate={preferences.status === "ready" && recommendations.status !== "loading"}
                onExtend={extendRecommendations}
                canExtend={preferences.status === "ready" && recommendations.status === "ready"}
              />
            </>
          ) : null}
        </>
      )}

      <footer
        style={{ marginTop: "40px", padding: "16px", textAlign: "center", fontSize: "12px", opacity: 0.6 }}
      >
        Made with ❤️ by Siddhartha Bhattacharjee •{" "}
        <a
          href="https://github.com/SiddharthaBhattacharjee/Sids_Game_Tracker/blob/master/LICENSE.txt"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          © MIT License
        </a>
      </footer>

      {modal ? (
        <ModalHost
          modal={modal}
          busy={busy}
          error={actionError}
          onClose={() => {
            setModal(null);
            setActionError("");
          }}
          onAddGame={handleAddGame}
          onUpdateGame={handleUpdateGame}
          onDeleteGame={handleDeleteGame}
          onAddBacklog={handleAddBacklog}
          onUpdateBacklog={handleUpdateBacklog}
          onDeleteBacklog={handleDeleteBacklog}
          onMoveBacklog={handleMoveBacklog}
          onImport={handleImport}
        />
      ) : null}
    </main>
  );
}

function mergeRecommendationItems(currentItems, nextItems) {
  const seen = new Set();
  return [...currentItems, ...nextItems].filter((item) => {
    const key = String(item?.game ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function ErrorScreen({ error, onRetry, onSettings }) {
  return (
    <section className="errorScreen framedTool">
      <XCircle size={34} />
      <div>
        <p className="eyebrow">Data failed to load</p>
        <h2>{error}</h2>
      </div>
      <div className="primaryActions">
        <button className="secondaryButton" type="button" onClick={onRetry}>
          <RefreshCw size={17} />
          Retry
        </button>
        <button className="primaryButton" type="button" onClick={onSettings}>
          <Settings size={17} />
          Settings
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function DashboardSection({ loading, analytics, igdbState, igdbConfigured }) {
  return (
    <section className="contentSection">
      <SectionHeader icon={<Database size={20} />} title="Dashboard" badge="Analytics" />
      {loading || !analytics ? (
        <DashboardSkeleton />
      ) : (
        <div className="dashboardGrid">
          <StatusTile data={analytics.statusDistribution} />
          <PlatformTile data={analytics.platformDistribution} />
          {analytics.price.pricedCount > 0 ? <PriceTile price={analytics.price} /> : null}
          {igdbConfigured ? (
            igdbState.status === "loading" || igdbState.status === "idle" ? (
              <IgdbLoadingTile igdbState={igdbState} />
            ) : igdbState.status === "disabled" ? (
              <NoticeTile title="IGDB disabled" message={igdbState.message} />
            ) : (
              <>
                <PieTile title="Genre distribution" data={analytics.genreDistribution} />
                <LikedGenresTile genres={analytics.topLikedGenres} />
              </>
            )
          ) : null}
        </div>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboardGrid">
      {[0, 1, 2].map((item) => (
        <article className="metricTile skeletonTile" key={item}>
          <div className="skeletonLine short" />
          <div className="skeletonCircle" />
          <div className="skeletonLine" />
        </article>
      ))}
    </div>
  );
}

function PriceTile({ price }) {
  return (
    <article className="chartTile">
      <h3>
        <Wallet size={16} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
        Collection value
      </h3>
      <div className="priceStats">
        <div className="priceStat">
          <span className="priceLabel">Total value</span>
          <strong className="priceValue">{formatMoney(price.totalValue)}</strong>
        </div>
        <div className="priceStat">
          <span className="priceLabel">Avg / paid game</span>
          <strong className="priceValue">{formatMoney(price.averageValue)}</strong>
        </div>
        <div className="priceStat">
          <span className="priceLabel">Paid games</span>
          <strong className="priceValue">{price.pricedCount}</strong>
        </div>
      </div>
    </article>
  );
}

function PieTile({ title, data }) {
  return (
    <article className="chartTile">
      <h3>{title}</h3>
      {data.length > 0 ? (
        <div className="chartContent">
          <PieChart data={data} />
          <ul className="legendList">
            {data.map((item) => (
              <li key={item.label}>
                <span className="legendSwatch" style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mutedText">No data yet.</p>
      )}
    </article>
  );
}

function StatusTile({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const statusMap = Object.fromEntries(data.map((item) => [item.label, item.value]));
  const completed = statusMap["Finished"] ?? 0;
  const dropped = statusMap["Dropped"] ?? 0;
  const onHold = statusMap["On Hold"] ?? 0;
  const completionPct = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
  const dropPct = total > 0 ? ((dropped / total) * 100).toFixed(1) : 0;
  const holdPct = total > 0 ? ((onHold / total) * 100).toFixed(1) : 0;

  return (
    <article className="chartTile">
      <h3>Status distribution</h3>
      {data.length > 0 ? (
        <>
          <div className="chartContent">
            <PieChart data={data} />
            <ul className="legendList">
              {data.map((item) => (
                <li key={item.label}>
                  <span className="legendSwatch" style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="tileFooter"
            style={{
              marginTop: "12px",
              paddingTop: "10px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}
          >
            {[
              { label: "Finished", value: completionPct, color: "#22c55e" },
              { label: "Dropped", value: dropPct, color: "#ef4444" },
              { label: "On Hold", value: holdPct, color: "#f59e0b" }
            ].map((item) => (
              <div
                key={item.label}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}
              >
                <span style={{ opacity: 0.7 }}>{item.label}</span>
                <span style={{ fontWeight: "600", color: item.color }}>{item.value}%</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mutedText">No data yet.</p>
      )}
    </article>
  );
}

function PlatformTile({ data }) {
  const topPlatforms = [...data].sort((a, b) => b.value - a.value).slice(0, 3);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <article className="chartTile">
      <h3>Platform distribution</h3>
      {data.length > 0 ? (
        <>
          <div className="chartContent">
            <PieChart data={data} />
            <ul className="legendList">
              {data.map((item) => (
                <li key={item.label}>
                  <span className="legendSwatch" style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="tileFooter"
            style={{
              marginTop: "12px",
              paddingTop: "10px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}
          >
            {topPlatforms.map((platform, index) => (
              <div key={platform.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    background: platform.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#000"
                  }}
                >
                  {index + 1}
                </span>
                <span style={{ flex: 1 }}>{platform.label}</span>
                <span style={{ fontWeight: "600", opacity: 0.8 }}>
                  {((platform.value / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mutedText">No data yet.</p>
      )}
    </article>
  );
}

function PieChart({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = data.map((item) => {
    const start = cursor;
    const percent = total > 0 ? (item.value / total) * 100 : 0;
    cursor += percent;
    return `${item.color} ${start}% ${cursor}%`;
  });

  return (
    <div
      className="pieChart"
      style={{ background: total > 0 ? `conic-gradient(${stops.join(", ")})` : "#e2ded5" }}
      aria-label={`Total ${total}`}
    >
      <div className="pieHole">{total}</div>
    </div>
  );
}

function IgdbLoadingTile({ igdbState }) {
  return (
    <article className="chartTile">
      <h3>IGDB enrichment</h3>
      <div className="loadProgress">
        <Loader2 className="spin" size={22} />
        <span>
          {igdbState.loaded} / {igdbState.total || "..."}
        </span>
      </div>
      <div className="skeletonLine" />
      <div className="skeletonLine short" />
    </article>
  );
}

function NoticeTile({ title, message }) {
  return (
    <article className="chartTile noticeTile">
      <AlertTriangle size={24} />
      <h3>{title}</h3>
      <p>{message || "IGDB fetch failed -> continuing without enrichment."}</p>
    </article>
  );
}

function LikedGenresTile({ genres }) {
  return (
    <article className="chartTile likedTile">
      <h3>Top 5 liked genres</h3>
      {genres.length > 0 ? (
        <ol className="genreRank">
          {genres.map((genre, index) => (
            <li key={genre.genre}>
              <span style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}>{index + 1}</span>
              <div>
                <strong>{genre.genre}</strong>
                <small>
                  {genre.average.toFixed(1)} / 10 across {genre.count} game{genre.count === 1 ? "" : "s"}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mutedText">No genre ratings found.</p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Played games list                                                   */
/* ------------------------------------------------------------------ */

function GameListSection({ loading, games, enrichments, igdbState, igdbConfigured, onEdit, onDelete }) {
  return (
    <section className="contentSection">
      <SectionHeader icon={<Gamepad2 size={20} />} title="Played Games" badge={`${games.length}`} />
      {loading ? (
        <div className="gameGrid">
          {[0, 1, 2, 3].map((item) => (
            <div className="gameCard skeletonGame" key={item}>
              <div className="coverSkeleton" />
              <div className="gameBody">
                <div className="skeletonLine short" />
                <div className="skeletonLine" />
                <div className="skeletonLine" />
              </div>
            </div>
          ))}
        </div>
      ) : games.length === 0 ? (
        <EmptyState message="No games yet. Add one or import a CSV to get started." />
      ) : (
        <div className="gameGrid">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              enrichment={enrichments[game.id]}
              igdbState={igdbState}
              igdbConfigured={igdbConfigured}
              onEdit={() => onEdit(game)}
              onDelete={() => onDelete(game)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GameCard({ game, enrichment, igdbState, igdbConfigured, onEdit, onDelete }) {
  const showCover = igdbConfigured && igdbState.status !== "disabled";
  return (
    <article className={`gameCard ${showCover ? "" : "noCover"}`}>
      {showCover ? <CoverSlot enrichment={enrichment} loading={igdbState.status === "loading"} /> : null}
      <div className="gameBody">
        <div className="gameTitleRow">
          <div>
            <h3>{game.name}</h3>
            <p>{game.platform}</p>
          </div>
          <span className={`statusPill ${statusClass(game.status)}`}>{game.status}</span>
        </div>
        <StarRating rating={game.rating} />
        {showCover ? <GenreChips enrichment={enrichment} loading={igdbState.status === "loading"} /> : null}
        <p className="reviewText">{game.review || "No review provided."}</p>
        <div className="cardFooter">
          {game.price > 0 ? <span className="priceTag">{formatMoney(game.price)}</span> : <span className="priceTag free">Free</span>}
          <div className="cardActions">
            <button className="iconButton" type="button" title="Edit" onClick={onEdit}>
              <Pencil size={15} />
            </button>
            <button className="iconButton danger" type="button" title="Delete" onClick={onDelete}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Backlog                                                             */
/* ------------------------------------------------------------------ */

function BacklogSection({ loading, backlog, enrichments, igdbConfigured, onEdit, onDelete, onMove }) {
  return (
    <section className="contentSection">
      <SectionHeader icon={<Library size={20} />} title="Backlog" badge={`${backlog.length}`} />
      {loading ? (
        <div className="gameGrid">
          {[0, 1, 2].map((item) => (
            <div className="gameCard skeletonGame" key={item}>
              <div className="gameBody">
                <div className="skeletonLine short" />
                <div className="skeletonLine" />
              </div>
            </div>
          ))}
        </div>
      ) : backlog.length === 0 ? (
        <EmptyState message="Backlog is empty. Add games you plan to play." />
      ) : (
        <div className="gameGrid">
          {backlog.map((item) => (
            <BacklogCard
              key={item.id}
              item={item}
              enrichment={enrichments[item.id]}
              igdbConfigured={igdbConfigured}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
              onMove={() => onMove(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BacklogCard({ item, enrichment, igdbConfigured, onEdit, onDelete, onMove }) {
  return (
    <article className={`gameCard ${igdbConfigured ? "" : "noCover"}`}>
      {igdbConfigured ? <CoverSlot enrichment={enrichment} loading={!enrichment} /> : null}
      <div className="gameBody">
        <div className="gameTitleRow">
          <div>
            <h3>{item.name}</h3>
            <p>{item.platform}</p>
          </div>
          <span className="statusPill backlog">Backlog</span>
        </div>
        {igdbConfigured ? <GenreChips enrichment={enrichment} loading={!enrichment} /> : null}
        <div className="cardFooter">
          {item.price > 0 ? <span className="priceTag">{formatMoney(item.price)}</span> : <span className="priceTag free">Free</span>}
          <div className="cardActions">
            <button className="iconButton primary" type="button" title="Move to Played" onClick={onMove}>
              <ArrowRight size={15} />
            </button>
            <button className="iconButton" type="button" title="Edit" onClick={onEdit}>
              <Pencil size={15} />
            </button>
            <button className="iconButton danger" type="button" title="Delete" onClick={onDelete}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function CoverSlot({ enrichment, loading }) {
  if (enrichment?.image) {
    return <img className="coverImage" src={enrichment.image} alt="" loading="lazy" />;
  }
  if (loading && !enrichment) {
    return <div className="coverSkeleton" />;
  }
  return (
    <div className="coverFallback">
      <ImageOff size={24} />
    </div>
  );
}

function GenreChips({ enrichment, loading }) {
  if (enrichment?.genres?.length) {
    return (
      <div className="chipRow">
        {enrichment.genres.map((genre) => (
          <span className="genreChip" key={genre}>
            {genre}
          </span>
        ))}
      </div>
    );
  }
  if (loading && !enrichment) {
    return (
      <div className="chipRow">
        <span className="genreChip loadingChip">Loading</span>
      </div>
    );
  }
  return (
    <div className="chipRow">
      <span className="genreChip mutedChip">No genres found</span>
    </div>
  );
}

function StarRating({ rating }) {
  const stars = ratingToStars(rating);
  const fullStars = Math.floor(stars);
  const halfStar = stars - fullStars >= 0.5;

  return (
    <div className="ratingRow" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {[1, 2, 3, 4, 5].map((i) => {
        if (i <= fullStars) {
          return <span key={i} style={{ color: "#facc15" }}>★</span>;
        }
        if (i === fullStars + 1 && halfStar) {
          return (
            <span key={i} style={{ position: "relative", display: "inline-block", color: "#555" }}>
              ★
              <span
                style={{ position: "absolute", top: 0, left: 0, width: "50%", overflow: "hidden", color: "#facc15" }}
              >
                ★
              </span>
            </span>
          );
        }
        return <span key={i} style={{ color: "#555" }}>★</span>;
      })}
      <strong style={{ marginLeft: "6px" }}>{stars.toFixed(1)}</strong>
      <span>/ 5</span>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="emptyState">
      <p>{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI sections                                                         */
/* ------------------------------------------------------------------ */

function PreferenceSection({ state, waiting, onRegenerate, canRegenerate }) {
  return (
    <section className="contentSection">
      <SectionHeader
        icon={<Sparkles size={20} />}
        title="Derived Player Preferences"
        badge="AI"
        action={<RegenerateButton loading={state.status === "loading"} disabled={!canRegenerate} onClick={onRegenerate} />}
      />
      <article className="llmPanel">
        {state.status === "ready" ? (
          <div className="llmText">{state.text}</div>
        ) : state.status === "error" ? (
          <InlineError message={state.error} onRetry={onRegenerate} />
        ) : (
          <LlmLoadingLines label={waiting ? "Waiting for data" : "Extracting preferences"} />
        )}
      </article>
    </section>
  );
}

function RecommendationSection({ state, enrichments, igdbActive, blocked, onRegenerate, canRegenerate, onExtend, canExtend }) {
  return (
    <section className="contentSection">
      <SectionHeader
        icon={<KeyRound size={20} />}
        title="Recommended Games"
        badge="AI"
        action={
          <>
            <RegenerateButton loading={state.status === "loading"} disabled={!canRegenerate} onClick={onRegenerate} />
            <ExtendButton loading={false} disabled={!canExtend} onClick={onExtend} title="Ask the LLM for more recommendations" />
          </>
        }
      />
      {state.status === "ready" ? (
        <>
          <div className="recommendationGrid">
            {state.items.map((item) => (
              <RecommendationCard key={item.game} item={item} enrichment={enrichments[item.game]} igdbActive={igdbActive} />
            ))}
          </div>
          {state.error ? (
            <article className="llmPanel extensionPanel">
              <InlineError message={state.error} onRetry={onExtend} />
            </article>
          ) : null}
        </>
      ) : state.status === "error" ? (
        <article className="llmPanel">
          <InlineError message={state.error} onRetry={onRegenerate} />
        </article>
      ) : (
        <article className="llmPanel">
          <LlmLoadingLines label={blocked ? "Waiting for preferences" : "Generating recommendations"} />
        </article>
      )}
    </section>
  );
}

function RegenerateButton({ loading, disabled, onClick }) {
  return (
    <button
      className="secondaryButton compactButton"
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title="Generate a fresh LLM result and replace the cached output"
    >
      {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
      Regenerate
    </button>
  );
}

function ExtendButton({ loading, disabled, onClick, title }) {
  return (
    <button className="secondaryButton compactButton" type="button" onClick={onClick} disabled={disabled || loading} title={title}>
      {loading ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
      Extend
    </button>
  );
}

function RecommendationCard({ item, enrichment, igdbActive }) {
  return (
    <article className={`recommendationCard ${igdbActive ? "" : "noCover"}`}>
      {igdbActive ? <CoverSlot enrichment={enrichment} loading={!enrichment} /> : null}
      <div>
        <h3>{item.game}</h3>
        {igdbActive ? <GenreChips enrichment={enrichment} loading={!enrichment} /> : null}
        <p>{item.reasoning}</p>
      </div>
    </article>
  );
}

function InlineError({ message, onRetry }) {
  return (
    <div className="inlineError">
      <AlertTriangle size={20} />
      <p>{message}</p>
      <button className="secondaryButton compactButton" type="button" onClick={onRetry}>
        <RefreshCw size={16} />
        Retry
      </button>
    </div>
  );
}

function LlmLoadingLines({ label }) {
  return (
    <div className="llmLoading">
      <div className="loadProgress">
        <Loader2 className="spin" size={20} />
        <span>{label}</span>
      </div>
      <div className="skeletonLine" />
      <div className="skeletonLine" />
      <div className="skeletonLine short" />
    </div>
  );
}

function SectionHeader({ icon, title, badge, action }) {
  return (
    <div className="sectionHeader">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="sectionHeaderMeta">
        <span>{badge}</span>
        {action}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

function ModalHost({
  modal,
  busy,
  error,
  onClose,
  onAddGame,
  onUpdateGame,
  onDeleteGame,
  onAddBacklog,
  onUpdateBacklog,
  onDeleteBacklog,
  onMoveBacklog,
  onImport
}) {
  let title = "";
  let body = null;

  if (modal.type === "game") {
    const editing = Boolean(modal.payload);
    title = editing ? "Edit Game" : "Add Game";
    body = (
      <GameForm
        initial={modal.payload}
        busy={busy}
        onSubmit={(values) => (editing ? onUpdateGame(modal.payload.id, values) : onAddGame(values))}
        onCancel={onClose}
      />
    );
  } else if (modal.type === "backlog") {
    const editing = Boolean(modal.payload);
    title = editing ? "Edit Backlog Entry" : "Add to Backlog";
    body = (
      <BacklogForm
        initial={modal.payload}
        busy={busy}
        onSubmit={(values) => (editing ? onUpdateBacklog(modal.payload.id, values) : onAddBacklog(values))}
        onCancel={onClose}
      />
    );
  } else if (modal.type === "move") {
    title = "Move to Played Games";
    body = (
      <MoveForm
        item={modal.payload}
        busy={busy}
        onSubmit={(details) => onMoveBacklog(modal.payload.id, details)}
        onCancel={onClose}
      />
    );
  } else if (modal.type === "import") {
    title = "Import Games from CSV";
    body = <ImportForm busy={busy} onSubmit={onImport} onCancel={onClose} />;
  } else if (modal.type === "deleteGame") {
    title = "Delete Game";
    body = (
      <ConfirmDelete
        message={`Delete "${modal.payload.name}" from your played games?`}
        busy={busy}
        onConfirm={() => onDeleteGame(modal.payload.id)}
        onCancel={onClose}
      />
    );
  } else if (modal.type === "deleteBacklog") {
    title = "Delete Backlog Entry";
    body = (
      <ConfirmDelete
        message={`Remove "${modal.payload.name}" from your backlog?`}
        busy={busy}
        onConfirm={() => onDeleteBacklog(modal.payload.id)}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard framedTool" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <h2>{title}</h2>
          <button className="iconButton" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="statusBox error">
            <XCircle size={18} />
            <div>
              <strong>{error}</strong>
            </div>
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
}

function GameForm({ initial, busy, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({
    name: initial?.name ?? "",
    platform: initial?.platform ?? "",
    status: initial?.status ?? "Ongoing",
    rating: initial?.rating != null ? String(initial.rating) : "",
    review: initial?.review ?? "",
    price: initial?.price != null ? String(initial.price) : ""
  }));
  const [localError, setLocalError] = useState("");

  function set(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const validationError = validateGameValues(values);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    setLocalError("");
    onSubmit({
      name: values.name.trim(),
      platform: values.platform.trim(),
      status: values.status,
      rating: Number(values.rating),
      review: values.review.trim(),
      price: values.price === "" ? 0 : Number(values.price)
    });
  }

  return (
    <form className="modalForm" onSubmit={submit}>
      {localError ? <p className="formError">{localError}</p> : null}
      <label className="fieldGroup">
        <span>Game name</span>
        <input type="text" value={values.name} onChange={(e) => set("name", e.target.value)} autoFocus />
      </label>
      <label className="fieldGroup">
        <span>Platform</span>
        <input type="text" value={values.platform} onChange={(e) => set("platform", e.target.value)} />
      </label>
      <div className="formRow">
        <label className="fieldGroup">
          <span>Status</span>
          <select value={values.status} onChange={(e) => set("status", e.target.value)}>
            {VALID_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldGroup">
          <span>Rating (0-10)</span>
          <input type="number" min="0" max="10" step="0.1" value={values.rating} onChange={(e) => set("rating", e.target.value)} />
        </label>
        <label className="fieldGroup">
          <span>Price (optional)</span>
          <input type="number" min="0" step="0.01" placeholder="0" value={values.price} onChange={(e) => set("price", e.target.value)} />
        </label>
      </div>
      <label className="fieldGroup">
        <span>Review</span>
        <textarea rows={3} value={values.review} onChange={(e) => set("review", e.target.value)} />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel={initial ? "Save Changes" : "Add Game"} />
    </form>
  );
}

function BacklogForm({ initial, busy, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({
    name: initial?.name ?? "",
    platform: initial?.platform ?? "",
    price: initial?.price != null ? String(initial.price) : ""
  }));
  const [localError, setLocalError] = useState("");

  function set(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!values.name.trim()) {
      setLocalError("Game name is required.");
      return;
    }
    if (!values.platform.trim()) {
      setLocalError("Platform is required.");
      return;
    }
    if (values.price !== "" && (!Number.isFinite(Number(values.price)) || Number(values.price) < 0)) {
      setLocalError("Price must be a non-negative number.");
      return;
    }
    setLocalError("");
    onSubmit({
      name: values.name.trim(),
      platform: values.platform.trim(),
      price: values.price === "" ? 0 : Number(values.price)
    });
  }

  return (
    <form className="modalForm" onSubmit={submit}>
      {localError ? <p className="formError">{localError}</p> : null}
      <label className="fieldGroup">
        <span>Game name</span>
        <input type="text" value={values.name} onChange={(e) => set("name", e.target.value)} autoFocus />
      </label>
      <label className="fieldGroup">
        <span>Platform</span>
        <input type="text" value={values.platform} onChange={(e) => set("platform", e.target.value)} />
      </label>
      <label className="fieldGroup">
        <span>Price (optional)</span>
        <input type="number" min="0" step="0.01" placeholder="0" value={values.price} onChange={(e) => set("price", e.target.value)} />
      </label>
      <p className="setupHint">Image and genre are enriched from IGDB automatically when configured.</p>
      <FormActions busy={busy} onCancel={onCancel} submitLabel={initial ? "Save Changes" : "Add to Backlog"} />
    </form>
  );
}

function MoveForm({ item, busy, onSubmit, onCancel }) {
  const [values, setValues] = useState({
    status: "Finished",
    rating: "",
    review: "",
    price: item?.price != null ? String(item.price) : ""
  });
  const [localError, setLocalError] = useState("");

  function set(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const rating = Number(values.rating);
    if (values.rating === "" || !Number.isFinite(rating) || rating < 0 || rating > 10) {
      setLocalError("Rating must be a number between 0 and 10.");
      return;
    }
    if (values.price !== "" && (!Number.isFinite(Number(values.price)) || Number(values.price) < 0)) {
      setLocalError("Price must be a non-negative number.");
      return;
    }
    setLocalError("");
    onSubmit({
      status: values.status,
      rating,
      review: values.review.trim(),
      price: values.price === "" ? 0 : Number(values.price)
    });
  }

  return (
    <form className="modalForm" onSubmit={submit}>
      {localError ? <p className="formError">{localError}</p> : null}
      <div className="movePreview">
        <strong>{item.name}</strong>
        <span>{item.platform}</span>
      </div>
      <div className="formRow">
        <label className="fieldGroup">
          <span>Status</span>
          <select value={values.status} onChange={(e) => set("status", e.target.value)}>
            {VALID_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldGroup">
          <span>Rating (0-10)</span>
          <input type="number" min="0" max="10" step="0.1" value={values.rating} onChange={(e) => set("rating", e.target.value)} autoFocus />
        </label>
        <label className="fieldGroup">
          <span>Price (optional)</span>
          <input type="number" min="0" step="0.01" placeholder="0" value={values.price} onChange={(e) => set("price", e.target.value)} />
        </label>
      </div>
      <label className="fieldGroup">
        <span>Review</span>
        <textarea rows={3} value={values.review} onChange={(e) => set("review", e.target.value)} />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Move to Played" />
    </form>
  );
}

function ImportForm({ busy, onSubmit, onCancel }) {
  const [games, setGames] = useState([]);
  const [parseError, setParseError] = useState("");
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseGamesCsv(String(reader.result ?? ""));
        setGames(parsed);
        setParseError("");
      } catch (error) {
        setGames([]);
        setParseError(error.message || "Could not parse CSV.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <div className="modalForm">
      <p className="setupHint">
        Expected header: <code>game,platform,status,rating,review</code>. Price defaults to 0.
      </p>
      <button className="secondaryButton" type="button" onClick={() => fileInputRef.current?.click()}>
        <Upload size={16} />
        {fileName || "Choose CSV file"}
      </button>
      <input ref={fileInputRef} className="hiddenInput" type="file" accept=".csv,text/csv" onChange={handleFile} />

      {parseError ? <p className="formError">{parseError}</p> : null}

      {games.length > 0 ? (
        <div className="importPreview">
          <p className="importCount">{games.length} game{games.length === 1 ? "" : "s"} ready to import.</p>
          <ul>
            {games.slice(0, 6).map((game, index) => (
              <li key={`${game.name}-${index}`}>
                <strong>{game.name}</strong> — {game.platform} · {game.status} · {game.rating}/10
              </li>
            ))}
            {games.length > 6 ? <li className="mutedText">…and {games.length - 6} more</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="formActions">
        <button className="ghostButton" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="primaryButton" type="button" onClick={() => onSubmit(games)} disabled={busy || games.length === 0}>
          {busy ? <Loader2 className="spin" size={16} /> : <FileUp size={16} />}
          Import {games.length > 0 ? games.length : ""}
        </button>
      </div>
    </div>
  );
}

function ConfirmDelete({ message, busy, onConfirm, onCancel }) {
  return (
    <div className="modalForm">
      <p>{message}</p>
      <div className="formActions">
        <button className="ghostButton" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="dangerButton" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
          Delete
        </button>
      </div>
    </div>
  );
}

function FormActions({ busy, onCancel, submitLabel }) {
  return (
    <div className="formActions">
      <button className="ghostButton" type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
        {submitLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function validateGameValues(values) {
  if (!values.name.trim()) {
    return "Game name is required.";
  }
  if (!values.platform.trim()) {
    return "Platform is required.";
  }
  const rating = Number(values.rating);
  if (values.rating === "" || !Number.isFinite(rating) || rating < 0 || rating > 10) {
    return "Rating must be a number between 0 and 10.";
  }
  if (values.price !== "" && (!Number.isFinite(Number(values.price)) || Number(values.price) < 0)) {
    return "Price must be a non-negative number.";
  }
  return "";
}

function formatMoney(value) {
  const number = Number(value) || 0;
  return `$${number.toFixed(2)}`;
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/\s+/g, "-");
}

function hasCachedPreferences(data) {
  return Boolean(data?.preferencesText);
}

function hasCachedRecommendations(data) {
  return Array.isArray(data?.recommendationsItems) && data.recommendationsItems.length > 0;
}

function hashConfig(config) {
  return JSON.stringify(normalizeConfig(config ?? emptyConfig()));
}
