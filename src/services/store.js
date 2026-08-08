import { neon } from "@neondatabase/serverless";
import { VALID_STATUSES } from "../utils/csv";

export { VALID_STATUSES };

const LOCAL_GAMES_KEY = "gameInsightsGamesLocal";
const LOCAL_BACKLOG_KEY = "gameInsightsBacklogLocal";

// ---------------------------------------------------------------------------
// Public factory: returns a backend based on whether a Neon URL is configured.
// ---------------------------------------------------------------------------
export function createStore(config) {
  const neonUrl = String(config?.neonUrl ?? "").trim();
  return neonUrl ? createNeonStore(neonUrl) : createLocalStore();
}

export function storeKind(config) {
  return String(config?.neonUrl ?? "").trim() ? "neon" : "local";
}

function normalizeGame(row) {
  return {
    id: row.id,
    name: String(row.name ?? "").trim(),
    platform: String(row.platform ?? "").trim(),
    status: String(row.status ?? "").trim(),
    rating: Number(row.rating ?? 0),
    review: String(row.review ?? ""),
    price: Number(row.price ?? 0)
  };
}

function normalizeBacklog(row) {
  return {
    id: row.id,
    name: String(row.name ?? "").trim(),
    platform: String(row.platform ?? "").trim(),
    price: Number(row.price ?? 0)
  };
}

function sanitizeStatus(status) {
  return VALID_STATUSES.includes(status) ? status : "Ongoing";
}

function clampRating(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value)) return 0;
  return Math.min(10, Math.max(0, value));
}

function sanitizePrice(price) {
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// Neon backend (SQL over HTTP). All inputs are parameterized via tagged
// templates, so user input can never be interpolated into the SQL text.
// ---------------------------------------------------------------------------
function createNeonStore(connectionString) {
  const sql = neon(connectionString);
  let initialized = false;

  async function init() {
    if (initialized) return;
    await sql`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Ongoing',
        rating NUMERIC NOT NULL DEFAULT 0,
        review TEXT NOT NULL DEFAULT '',
        price NUMERIC NOT NULL DEFAULT 0
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS backlog (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        price NUMERIC NOT NULL DEFAULT 0
      )
    `;
    initialized = true;
  }

  return {
    kind: "neon",

    async testConnection() {
      await init();
      await sql`SELECT 1`;
      return true;
    },

    async listGames() {
      await init();
      const rows = await sql`SELECT id, name, platform, status, rating, review, price FROM games ORDER BY id ASC`;
      return rows.map(normalizeGame);
    },

    async listBacklog() {
      await init();
      const rows = await sql`SELECT id, name, platform, price FROM backlog ORDER BY id ASC`;
      return rows.map(normalizeBacklog);
    },

    async addGame(game) {
      await init();
      const rows = await sql`
        INSERT INTO games (name, platform, status, rating, review, price)
        VALUES (${game.name}, ${game.platform}, ${sanitizeStatus(game.status)}, ${clampRating(game.rating)}, ${String(game.review ?? "")}, ${sanitizePrice(game.price)})
        RETURNING id, name, platform, status, rating, review, price
      `;
      return normalizeGame(rows[0]);
    },

    async updateGame(id, game) {
      await init();
      const rows = await sql`
        UPDATE games
        SET name = ${game.name},
            platform = ${game.platform},
            status = ${sanitizeStatus(game.status)},
            rating = ${clampRating(game.rating)},
            review = ${String(game.review ?? "")},
            price = ${sanitizePrice(game.price)}
        WHERE id = ${id}
        RETURNING id, name, platform, status, rating, review, price
      `;
      return normalizeGame(rows[0]);
    },

    async deleteGame(id) {
      await init();
      await sql`DELETE FROM games WHERE id = ${id}`;
    },

    async addBacklog(item) {
      await init();
      const rows = await sql`
        INSERT INTO backlog (name, platform, price)
        VALUES (${item.name}, ${item.platform}, ${sanitizePrice(item.price)})
        RETURNING id, name, platform, price
      `;
      return normalizeBacklog(rows[0]);
    },

    async updateBacklog(id, item) {
      await init();
      const rows = await sql`
        UPDATE backlog
        SET name = ${item.name}, platform = ${item.platform}, price = ${sanitizePrice(item.price)}
        WHERE id = ${id}
        RETURNING id, name, platform, price
      `;
      return normalizeBacklog(rows[0]);
    },

    async deleteBacklog(id) {
      await init();
      await sql`DELETE FROM backlog WHERE id = ${id}`;
    },

    async moveBacklogToGames(id, details) {
      await init();
      const existing = await sql`SELECT id, name, platform, price FROM backlog WHERE id = ${id}`;
      if (existing.length === 0) {
        throw new Error("Backlog entry not found.");
      }
      const entry = normalizeBacklog(existing[0]);
      const price = details.price === undefined || details.price === null ? entry.price : details.price;
      const rows = await sql`
        INSERT INTO games (name, platform, status, rating, review, price)
        VALUES (${entry.name}, ${entry.platform}, ${sanitizeStatus(details.status)}, ${clampRating(details.rating)}, ${String(details.review ?? "")}, ${sanitizePrice(price)})
        RETURNING id, name, platform, status, rating, review, price
      `;
      await sql`DELETE FROM backlog WHERE id = ${id}`;
      return normalizeGame(rows[0]);
    },

    async importGames(games) {
      await init();
      if (!games.length) return 0;
      await sql.transaction(
        games.map(
          (game) => sql`
            INSERT INTO games (name, platform, status, rating, review, price)
            VALUES (${game.name}, ${game.platform}, ${sanitizeStatus(game.status)}, ${clampRating(game.rating)}, ${String(game.review ?? "")}, ${sanitizePrice(game.price)})
          `
        )
      );
      return games.length;
    }
  };
}

// ---------------------------------------------------------------------------
// Local backend (browser localStorage). Same interface, no network.
// ---------------------------------------------------------------------------
function createLocalStore() {
  function read(key) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function write(key, rows) {
    window.localStorage.setItem(key, JSON.stringify(rows));
  }

  function nextId(rows) {
    return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  }

  return {
    kind: "local",

    async testConnection() {
      return true;
    },

    async listGames() {
      return read(LOCAL_GAMES_KEY).map(normalizeGame);
    },

    async listBacklog() {
      return read(LOCAL_BACKLOG_KEY).map(normalizeBacklog);
    },

    async addGame(game) {
      const rows = read(LOCAL_GAMES_KEY);
      const record = normalizeGame({
        id: nextId(rows),
        ...game,
        status: sanitizeStatus(game.status),
        rating: clampRating(game.rating),
        price: sanitizePrice(game.price)
      });
      rows.push(record);
      write(LOCAL_GAMES_KEY, rows);
      return record;
    },

    async updateGame(id, game) {
      const rows = read(LOCAL_GAMES_KEY);
      const index = rows.findIndex((row) => String(row.id) === String(id));
      if (index === -1) throw new Error("Game not found.");
      const record = normalizeGame({
        id,
        ...game,
        status: sanitizeStatus(game.status),
        rating: clampRating(game.rating),
        price: sanitizePrice(game.price)
      });
      rows[index] = record;
      write(LOCAL_GAMES_KEY, rows);
      return record;
    },

    async deleteGame(id) {
      write(
        LOCAL_GAMES_KEY,
        read(LOCAL_GAMES_KEY).filter((row) => String(row.id) !== String(id))
      );
    },

    async addBacklog(item) {
      const rows = read(LOCAL_BACKLOG_KEY);
      const record = normalizeBacklog({ id: nextId(rows), ...item, price: sanitizePrice(item.price) });
      rows.push(record);
      write(LOCAL_BACKLOG_KEY, rows);
      return record;
    },

    async updateBacklog(id, item) {
      const rows = read(LOCAL_BACKLOG_KEY);
      const index = rows.findIndex((row) => String(row.id) === String(id));
      if (index === -1) throw new Error("Backlog entry not found.");
      const record = normalizeBacklog({ id, ...item, price: sanitizePrice(item.price) });
      rows[index] = record;
      write(LOCAL_BACKLOG_KEY, rows);
      return record;
    },

    async deleteBacklog(id) {
      write(
        LOCAL_BACKLOG_KEY,
        read(LOCAL_BACKLOG_KEY).filter((row) => String(row.id) !== String(id))
      );
    },

    async moveBacklogToGames(id, details) {
      const backlog = read(LOCAL_BACKLOG_KEY);
      const entry = backlog.find((row) => String(row.id) === String(id));
      if (!entry) throw new Error("Backlog entry not found.");
      const games = read(LOCAL_GAMES_KEY);
      const price = details.price === undefined || details.price === null ? entry.price : details.price;
      const record = normalizeGame({
        id: nextId(games),
        name: entry.name,
        platform: entry.platform,
        status: sanitizeStatus(details.status),
        rating: clampRating(details.rating),
        review: details.review ?? "",
        price: sanitizePrice(price)
      });
      games.push(record);
      write(LOCAL_GAMES_KEY, games);
      write(
        LOCAL_BACKLOG_KEY,
        backlog.filter((row) => String(row.id) !== String(id))
      );
      return record;
    },

    async importGames(games) {
      if (!games.length) return 0;
      const rows = read(LOCAL_GAMES_KEY);
      let id = nextId(rows);
      games.forEach((game) => {
        rows.push(
          normalizeGame({
            id: id++,
            ...game,
            status: sanitizeStatus(game.status),
            rating: clampRating(game.rating),
            price: sanitizePrice(game.price)
          })
        );
      });
      write(LOCAL_GAMES_KEY, rows);
      return games.length;
    }
  };
}
