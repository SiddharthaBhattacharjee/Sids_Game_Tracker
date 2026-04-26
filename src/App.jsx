import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Gamepad2,
  ImageOff,
  KeyRound,
  Loader2,
  Moon,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Sun,
  Upload,
  XCircle
} from "lucide-react";
import Galaxy from './backgrounds/dark.jsx';
import {
  clearConfig,
  downloadConfig,
  emptyConfig,
  loadConfig,
  normalizeConfig,
  parseImportedConfig,
  saveConfig,
  validateConfigShape
} from "./services/config";
import { extractPreferences, generateRecommendations, testLlmConfig } from "./services/llm";
import { buildLlmCacheHash, loadCachedLlmData, saveCachedLlmData } from "./services/llmCache";
import { fetchRawgGame, testRawgKey } from "./services/rawg";
import { fetchSheetGames } from "./services/sheet";
import { CHART_COLORS, computeAnalytics, ratingToStars } from "./utils/analytics";

const FIELD_META = [
  {
    key: "sheetUrl",
    label: "Google Sheet URL",
    example: "https://docs.google.com/spreadsheets/d/.../edit?gid=0",
    hint: "Public sheet with the exact required columns."
  },
  {
    key: "apiUrl",
    label: "LLM API URL",
    example: "https://api.openai.com/v1",
    hint: "OpenAI-compatible base URL or full /chat/completions URL."
  },
  {
    key: "apiKey",
    label: "LLM API Key",
    example: "sk-...",
    hint: "Stored only in this browser.",
    secret: true
  },
  {
    key: "model",
    label: "Model",
    example: "gpt-4o-mini",
    hint: "Any chat-completions compatible model name."
  },
  {
    key: "rawgApiKey",
    label: "RAWG API Key",
    example: "Optional",
    hint: "Enables covers and genre analytics.",
    secret: true
  }
];

const initialRawgState = (config) =>
  config?.rawgApiKey
    ? { enabled: true, status: "idle", loaded: 0, total: 0, message: "" }
    : { enabled: false, status: "disabled", loaded: 0, total: 0, message: "" };

const waitingPreferences = {
  status: "idle",
  text: "",
  error: ""
};

const waitingRecommendations = {
  status: "idle",
  items: [],
  error: ""
};

export default function App() {
  const [config, setConfig] = useState(() => loadConfig());
  const [showSetup, setShowSetup] = useState(() => !config);

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
      <SetupScreen
        initialConfig={config}
        onSaved={handleSaved}
        onCancel={config ? () => setShowSetup(false) : null}
        onClear={config ? handleClearConfig : null}
      />
    );
  }

  return (
    <AppShell
      key={hashConfig(config)}
      config={config}
      onSettings={() => setShowSetup(true)}
    />
  );
}

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
    setTestState({
      status: "idle",
      step: "",
      message: "",
      warning: "",
      hash: ""
    });
  }

  async function handleTest() {
    const controller = new AbortController();
    const normalized = normalizeConfig(draft);

    try {
      validateConfigShape(normalized);
      setTestState({
        status: "testing",
        step: "sheet",
        message: "Testing Google Sheet",
        warning: "",
        hash: ""
      });

      const games = await fetchSheetGames(normalized.sheetUrl, controller.signal);

      setTestState({
        status: "testing",
        step: "llm",
        message: "Testing LLM API",
        warning: "",
        hash: ""
      });

      await testLlmConfig(normalized, controller.signal);

      let warning = "";
      if (normalized.rawgApiKey) {
        setTestState({
          status: "testing",
          step: "rawg",
          message: "Testing RAWG",
          warning: "",
          hash: ""
        });

        try {
          await testRawgKey(normalized.rawgApiKey, controller.signal);
        } catch (error) {
          warning = error.message || "RAWG fetch failed -> continuing without enrichment.";
        }
      }

      setTestState({
        status: warning ? "warning" : "success",
        step: "",
        message: `Configuration works. Sheet rows found: ${games.length}.`,
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
        setTestState({
          status: "error",
          step: "",
          message: error.message,
          warning: "",
          hash: ""
        });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

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
            <button
              className="ghostButton"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
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

        <div className="setupGrid">
          {FIELD_META.map((field) => (
            <label className="fieldGroup" key={field.key}>
              <span>{field.label}</span>
              <input
                type={field.secret ? "password" : "text"}
                value={draft[field.key]}
                placeholder={field.example}
                onChange={(event) => updateField(field.key, event.target.value)}
                autoComplete="off"
              />
              <small>{field.hint}</small>
            </label>
          ))}
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

function AppShell({ config, onSettings }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [sheetState, setSheetState] = useState({
    status: "loading",
    games: [],
    error: ""
  });
  const [enrichments, setEnrichments] = useState({});
  const [rawgState, setRawgState] = useState(() => initialRawgState(config));
  const [preferences, setPreferences] = useState(waitingPreferences);
  const [recommendations, setRecommendations] = useState(waitingRecommendations);
  const [recommendationEnrichments, setRecommendationEnrichments] = useState({});
  const [llmCacheState, setLlmCacheState] = useState({
    status: "idle",
    hash: "",
    data: null
  });
  const manualLlmInFlightRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const controller = new AbortController();

    setSheetState({ status: "loading", games: [], error: "" });
    setEnrichments({});
    setRawgState(initialRawgState(config));
    setPreferences(waitingPreferences);
    setRecommendations(waitingRecommendations);
    setRecommendationEnrichments({});
    setLlmCacheState({ status: "idle", hash: "", data: null });

    fetchSheetGames(config.sheetUrl, controller.signal)
      .then((games) => {
        setSheetState({ status: "ready", games, error: "" });
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return;
        }
        setSheetState({
          status: "error",
          games: [],
          error: error.message || "Sheet failed to load."
        });
      });

    return () => controller.abort();
  }, [config, reloadToken]);

  useEffect(() => {
    if (sheetState.status !== "ready") {
      return undefined;
    }

    let active = true;
    setLlmCacheState({ status: "checking", hash: "", data: null });

    buildLlmCacheHash(config, sheetState.games)
      .then((hash) => {
        if (!active) {
          return;
        }

        setLlmCacheState({
          status: "ready",
          hash,
          data: loadCachedLlmData(hash)
        });
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        console.warn("[Game Insights] Failed to compute LLM cache hash", error);
        setLlmCacheState({ status: "ready", hash: "", data: null });
      });

    return () => {
      active = false;
    };
  }, [config, sheetState.status, sheetState.games]);

  useEffect(() => {
    if (sheetState.status !== "ready") {
      return undefined;
    }

    if (!config.rawgApiKey) {
      setRawgState({ enabled: false, status: "disabled", loaded: 0, total: 0, message: "" });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setEnrichments({});
    setRawgState({
      enabled: true,
      status: "loading",
      loaded: 0,
      total: sheetState.games.length,
      message: ""
    });

    async function enrichGames() {
      const failures = [];

      for (const game of sheetState.games) {
        try {
          const enrichment = await fetchRawgGame(game.game, config.rawgApiKey, controller.signal);

          if (!active) {
            return;
          }

          setEnrichments((current) => ({
            ...current,
            [game.id]: enrichment
          }));
        } catch (error) {
          if (error.name === "AbortError") {
            return;
          }
          const message = error.message || "RAWG fetch failed -> continuing without enrichment.";
          failures.push(message);

          if (/\((401|403)\)/.test(message)) {
            setRawgState({
              enabled: false,
              status: "disabled",
              loaded: failures.length,
              total: sheetState.games.length,
              message
            });
            return;
          }
        } finally {
          if (active) {
            setRawgState((current) =>
              current.status === "loading"
                ? { ...current, loaded: Math.min(current.loaded + 1, current.total) }
                : current
            );
          }
        }
      }

      if (!active) {
        return;
      }

      if (failures.length === sheetState.games.length) {
        setRawgState({
          enabled: false,
          status: "disabled",
          loaded: sheetState.games.length,
          total: sheetState.games.length,
          message: failures[0] || "RAWG fetch failed -> continuing without enrichment."
        });
        return;
      }

      setRawgState({
        enabled: true,
        status: failures.length > 0 ? "warning" : "ready",
        loaded: sheetState.games.length,
        total: sheetState.games.length,
        message:
          failures.length > 0
            ? "Some RAWG matches failed -> showing available enrichment only."
            : ""
      });
    }

    enrichGames();

    return () => {
      active = false;
      controller.abort();
    };
  }, [config.rawgApiKey, sheetState.status, sheetState.games]);

  const llmCanStart =
    sheetState.status === "ready" &&
    llmCacheState.status === "ready" &&
    (hasCachedPreferences(llmCacheState.data) ||
      !config.rawgApiKey ||
      ["ready", "warning", "disabled"].includes(rawgState.status));

  useEffect(() => {
    if (manualLlmInFlightRef.current) {
      return undefined;
    }

    if (!llmCanStart) {
      return undefined;
    }

    if (hasCachedPreferences(llmCacheState.data)) {
      setPreferences({
        status: "ready",
        text: llmCacheState.data.preferencesText,
        error: ""
      });

      if (hasCachedRecommendations(llmCacheState.data)) {
        setRecommendations({
          status: "ready",
          items: llmCacheState.data.recommendationsItems,
          error: ""
        });
      } else {
        setRecommendations(waitingRecommendations);
      }

      setRecommendationEnrichments({});
      return undefined;
    }

    if (config.rawgApiKey && !["ready", "warning", "disabled"].includes(rawgState.status)) {
      return undefined;
    }

    const controller = new AbortController();
    setPreferences({ status: "loading", text: "", error: "" });
    setRecommendations(waitingRecommendations);
    setRecommendationEnrichments({});

    extractPreferences(config, sheetState.games, enrichments, controller.signal)
      .then((text) => {
        setPreferences({ status: "ready", text, error: "" });
        saveCachedLlmData(llmCacheState.hash, { preferencesText: text });
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return;
        }
        setPreferences({
          status: "error",
          text: "",
          error: error.message || "Preference extraction failed."
        });
      });

    return () => controller.abort();
  }, [
    config,
    enrichments,
    llmCacheState.data,
    llmCacheState.hash,
    llmCanStart,
    rawgState.status,
    sheetState.games
  ]);

  useEffect(() => {
    if (manualLlmInFlightRef.current) {
      return undefined;
    }

    if (
      preferences.status !== "ready" ||
      recommendations.status === "ready" ||
      recommendations.status === "loading"
    ) {
      return undefined;
    }

    if (hasCachedRecommendations(llmCacheState.data)) {
      setRecommendations({
        status: "ready",
        items: llmCacheState.data.recommendationsItems,
        error: ""
      });
      return undefined;
    }

    const controller = new AbortController();
    setRecommendations({ status: "loading", items: [], error: "" });
    setRecommendationEnrichments({});

    generateRecommendations(config, sheetState.games, preferences.text, controller.signal)
      .then((items) => {
        setRecommendations({ status: "ready", items, error: "" });
        saveCachedLlmData(llmCacheState.hash, {
          preferencesText: preferences.text,
          recommendationsItems: items
        });
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return;
        }
        setRecommendations({
          status: "error",
          items: [],
          error: error.message || "Recommendation generation failed."
        });
      });

    return () => controller.abort();
  }, [
    config,
    llmCacheState.data,
    llmCacheState.hash,
    preferences.status,
    preferences.text,
    recommendations.status,
    sheetState.games
  ]);

  useEffect(() => {
    if (
      recommendations.status !== "ready" ||
      !config.rawgApiKey ||
      !["ready", "warning"].includes(rawgState.status)
    ) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    async function enrichRecommendations() {
      for (const item of recommendations.items) {
        try {
          const enrichment = await fetchRawgGame(item.game, config.rawgApiKey, controller.signal);

          if (!active) {
            return;
          }

          setRecommendationEnrichments((current) => ({
            ...current,
            [item.game]: enrichment
          }));
        } catch (error) {
          if (error.name === "AbortError") {
            return;
          }
        }
      }
    }

    enrichRecommendations();

    return () => {
      active = false;
      controller.abort();
    };
  }, [config.rawgApiKey, rawgState.status, recommendations.status, recommendations.items]);

  const analytics = useMemo(() => {
    if (sheetState.status !== "ready") {
      return null;
    }

    return computeAnalytics(sheetState.games, enrichments);
  }, [sheetState.status, sheetState.games, enrichments]);

  function retryAll() {
    setReloadToken((token) => token + 1);
  }

  function saveAndHydrateLlmCache(partialData) {
    const saved = saveCachedLlmData(llmCacheState.hash, partialData);

    if (saved) {
      setLlmCacheState((current) =>
        current.hash === llmCacheState.hash ? { ...current, data: saved } : current
      );
    }

    return saved;
  }

  async function regeneratePreferences() {
    if (!canRegeneratePreferences()) {
      return;
    }

    manualLlmInFlightRef.current = true;
    setPreferences({ status: "loading", text: "", error: "" });
    setRecommendations(waitingRecommendations);
    setRecommendationEnrichments({});

    const controller = new AbortController();
    let nextPreferences = "";

    try {
      nextPreferences = await extractPreferences(
        config,
        sheetState.games,
        enrichments,
        controller.signal
      );
      setPreferences({ status: "ready", text: nextPreferences, error: "" });
      saveCachedLlmData(llmCacheState.hash, {
        preferencesText: nextPreferences,
        recommendationsItems: []
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        setPreferences({
          status: "error",
          text: "",
          error: error.message || "Preference extraction failed."
        });
      }
      manualLlmInFlightRef.current = false;
      return;
    }

    setRecommendations({ status: "loading", items: [], error: "" });

    try {
      const items = await generateRecommendations(
        config,
        sheetState.games,
        nextPreferences,
        controller.signal
      );
      setRecommendations({ status: "ready", items, error: "" });
      saveAndHydrateLlmCache({
        preferencesText: nextPreferences,
        recommendationsItems: items
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        setRecommendations({
          status: "error",
          items: [],
          error: error.message || "Recommendation generation failed."
        });
        saveAndHydrateLlmCache({
          preferencesText: nextPreferences,
          recommendationsItems: []
        });
      }
    } finally {
      manualLlmInFlightRef.current = false;
    }
  }

  async function regenerateRecommendations() {
    if (!canRegenerateRecommendations()) {
      return;
    }

    manualLlmInFlightRef.current = true;
    setRecommendations({ status: "loading", items: [], error: "" });
    setRecommendationEnrichments({});

    const controller = new AbortController();

    try {
      const items = await generateRecommendations(
        config,
        sheetState.games,
        preferences.text,
        controller.signal
      );
      setRecommendations({ status: "ready", items, error: "" });
      saveAndHydrateLlmCache({
        preferencesText: preferences.text,
        recommendationsItems: items
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        setRecommendations({
          status: "error",
          items: [],
          error: error.message || "Recommendation generation failed."
        });
      }
    } finally {
      manualLlmInFlightRef.current = false;
    }
  }

  function canRegeneratePreferences() {
    return (
      sheetState.status === "ready" &&
      llmCacheState.status === "ready" &&
      preferences.status !== "loading" &&
      recommendations.status !== "loading" &&
      (!config.rawgApiKey || ["ready", "warning", "disabled"].includes(rawgState.status))
    );
  }

  function canRegenerateRecommendations() {
    return (
      sheetState.status === "ready" &&
      llmCacheState.status === "ready" &&
      preferences.status === "ready" &&
      recommendations.status !== "loading"
    );
  }

  return (
    <main className="appShell">
      {darkMode && <Galaxy transparent={false} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: -1 }} />}
      <header className="appHeader">
        <div className="brandLockup">
          <Gamepad2 size={27} />
          <div>
            <p className="eyebrow">Local browser app</p>
            <h1>SGT (Sid's Game Tracker)</h1>
          </div>
        </div>
        <div className="headerActions">
          <button className="ghostButton" type="button" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            {darkMode ? 'Light' : 'Dark'}
          </button>
          <button className="ghostButton" type="button" onClick={retryAll}>
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

      {sheetState.status === "error" ? (
        <ErrorScreen error={sheetState.error} onRetry={retryAll} onSettings={onSettings} />
      ) : (
        <>
          <DashboardSection
            loading={sheetState.status === "loading"}
            analytics={analytics}
            rawgState={rawgState}
            rawgConfigured={Boolean(config.rawgApiKey)}
          />
          <GameListSection
            loading={sheetState.status === "loading"}
            games={sheetState.games}
            enrichments={enrichments}
            rawgState={rawgState}
            rawgConfigured={Boolean(config.rawgApiKey)}
          />
          <PreferenceSection
            state={preferences}
            waiting={!llmCanStart}
            onRegenerate={regeneratePreferences}
            canRegenerate={canRegeneratePreferences()}
          />
          <RecommendationSection
            state={recommendations}
            enrichments={recommendationEnrichments}
            rawgActive={Boolean(config.rawgApiKey) && ["ready", "warning"].includes(rawgState.status)}
            blocked={preferences.status !== "ready"}
            onRegenerate={regenerateRecommendations}
            canRegenerate={canRegenerateRecommendations()}
          />
        </>
      )}
    </main>
  );
}

function ErrorScreen({ error, onRetry, onSettings }) {
  return (
    <section className="errorScreen framedTool">
      <XCircle size={34} />
      <div>
        <p className="eyebrow">Sheet failed</p>
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

function DashboardSection({ loading, analytics, rawgState, rawgConfigured }) {
  return (
    <section className="contentSection">
      <SectionHeader
        icon={<Database size={20} />}
        title="Dashboard"
        badge="Deterministic"
      />

      {loading || !analytics ? (
        <DashboardSkeleton />
      ) : (
        <div className="dashboardGrid">
          <StatusTile data={analytics.statusDistribution} />
          <PlatformTile data={analytics.platformDistribution} />
          {rawgConfigured ? (
            rawgState.status === "loading" || rawgState.status === "idle" ? (
              <RawgLoadingTile rawgState={rawgState} />
            ) : rawgState.status === "disabled" ? (
              <NoticeTile title="RAWG disabled" message={rawgState.message} />
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
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "13px"
      }}
    >
      <span style={{ opacity: 0.7 }}>{item.label}</span>
      <span
        style={{
          fontWeight: "600",
          color: item.color
        }}
      >
        {item.value}%
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

function PlatformTile({ data }) {
  const topPlatforms = data.sort((a, b) => b.value - a.value).slice(0, 3);

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
              <div
                key={platform.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}
              >
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
                  {platform.value}
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
      style={{
        background: total > 0 ? `conic-gradient(${stops.join(", ")})` : "#e2ded5"
      }}
      aria-label={`Total ${total}`}
    >
      <div className="pieHole">{total}</div>
    </div>
  );
}

function RawgLoadingTile({ rawgState }) {
  return (
    <article className="chartTile">
      <h3>RAWG enrichment</h3>
      <div className="rawgProgress">
        <Loader2 className="spin" size={22} />
        <span>
          {rawgState.loaded} / {rawgState.total || "..."}
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
      <p>{message || "RAWG fetch failed -> continuing without enrichment."}</p>
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
              <span style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}>
                {index + 1}
              </span>
              <div>
                <strong>{genre.genre}</strong>
                <small>
                  {genre.average.toFixed(1)} / 10 across {genre.count} game
                  {genre.count === 1 ? "" : "s"}
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

function GameListSection({ loading, games, enrichments, rawgState, rawgConfigured }) {
  return (
    <section className="contentSection">
      <SectionHeader icon={<Gamepad2 size={20} />} title="Game List" badge="Sheet data" />
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
      ) : (
        <div className="gameGrid">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              enrichment={enrichments[game.id]}
              rawgState={rawgState}
              rawgConfigured={rawgConfigured}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GameCard({ game, enrichment, rawgState, rawgConfigured }) {
  const showRawg = rawgConfigured && rawgState.status !== "disabled";

  return (
    <article className={`gameCard ${showRawg ? "" : "noCover"}`}>
      {showRawg ? <CoverSlot enrichment={enrichment} loading={rawgState.status === "loading"} /> : null}
      <div className="gameBody">
        <div className="gameTitleRow">
          <div>
            <h3>{game.game}</h3>
            <p>{game.platform}</p>
          </div>
          <span className={`statusPill ${statusClass(game.status)}`}>{game.status}</span>
        </div>
        <StarRating rating={game.rating} />
        {showRawg ? (
          <GenreChips enrichment={enrichment} loading={rawgState.status === "loading"} />
        ) : null}
        <p className="reviewText">{game.review || "No review provided."}</p>
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
  const fill = `${Math.max(0, Math.min(100, (stars / 5) * 100))}%`;

  return (
    <div className="ratingRow" aria-label={`${stars.toFixed(1)} out of 5 stars`}>
      <span className="starMeter" style={{ "--star-fill": fill }} />
      <strong>{stars.toFixed(1)}</strong>
      <span>/ 5</span>
    </div>
  );
}

function PreferenceSection({ state, waiting, onRegenerate, canRegenerate }) {
  return (
    <section className="contentSection">
      <SectionHeader
        icon={<Sparkles size={20} />}
        title="Derived Player Preferences"
        badge="LLM"
        action={
          <RegenerateButton
            loading={state.status === "loading"}
            disabled={!canRegenerate}
            onClick={onRegenerate}
          />
        }
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

function RecommendationSection({
  state,
  enrichments,
  rawgActive,
  blocked,
  onRegenerate,
  canRegenerate
}) {
  return (
    <section className="contentSection">
      <SectionHeader
        icon={<KeyRound size={20} />}
        title="Recommended Games"
        badge="LLM"
        action={
          <RegenerateButton
            loading={state.status === "loading"}
            disabled={!canRegenerate}
            onClick={onRegenerate}
          />
        }
      />
      {state.status === "ready" ? (
        <div className="recommendationGrid">
          {state.items.map((item) => (
            <RecommendationCard
              key={item.game}
              item={item}
              enrichment={enrichments[item.game]}
              rawgActive={rawgActive}
            />
          ))}
        </div>
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

function RecommendationCard({ item, enrichment, rawgActive }) {
  return (
    <article className={`recommendationCard ${rawgActive ? "" : "noCover"}`}>
      {rawgActive ? <CoverSlot enrichment={enrichment} loading={!enrichment} /> : null}
      <div>
        <h3>{item.game}</h3>
        {rawgActive ? <GenreChips enrichment={enrichment} loading={!enrichment} /> : null}
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
      <div className="rawgProgress">
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

function statusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
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
