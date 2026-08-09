export const VALID_STATUSES = ["Finished", "Dropped", "On Hold", "Ongoing"];
export const IMPORT_COLUMNS = ["game", "platform", "status", "rating", "review"];

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Builds a single CSV covering both lists; backlog rows leave play-only fields blank.
export function gamesToCsv(games = [], backlog = []) {
  const rows = [["List", "Game", "Platform", "Status", "Rating", "Review", "Price", "Image"]];

  games.forEach((game) => {
    rows.push([
      "Played",
      game.name,
      game.platform,
      game.status,
      game.rating,
      game.review,
      game.price,
      game.image ?? ""
    ]);
  });

  backlog.forEach((item) => {
    rows.push(["Backlog", item.name, item.platform, "", "", "", item.price, item.image ?? ""]);
  });

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

// Low-level RFC-4180-ish CSV parser (handles quotes, escaped quotes, CRLF).
export function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  rows.push(row);

  return rows;
}

function getCell(row, index) {
  return String(row[index] ?? "").trim();
}

function parsePriceCell(text) {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Parses either the exported CSV (with a `List` column, plus Price/Image and
// backlog rows) or the legacy `game,platform,status,rating,review` format.
// Returns { games, backlog } ready to write into the store.
export function parseImportCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));

  if (rows.length <= 1) {
    throw new Error("Empty CSV -> include a header row plus at least one game.");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const indexByColumn = new Map(headers.map((header, index) => [header, index]));
  const has = (column) => indexByColumn.has(column);
  const cell = (row, column) => getCell(row, indexByColumn.get(column));

  const missingCore = ["game", "platform"].filter((column) => !has(column));
  if (missingCore.length > 0) {
    throw new Error(`Missing column "${missingCore[0]}" -> expected at least game and platform.`);
  }

  const hasList = has("list");
  if (!hasList) {
    const missing = IMPORT_COLUMNS.filter((column) => !has(column));
    if (missing.length > 0) {
      throw new Error(
        `Missing column "${missing[0]}" -> expected header: game,platform,status,rating,review (or the exported format).`
      );
    }
  }

  const games = [];
  const backlog = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const displayRow = rowIndex + 2;
    const name = cell(row, "game");
    const platform = cell(row, "platform");

    if (!name) {
      throw new Error(`Missing game name on row ${displayRow}.`);
    }
    if (!platform) {
      throw new Error(`Missing platform on row ${displayRow}.`);
    }

    const price = has("price") ? parsePriceCell(cell(row, "price")) : 0;
    const image = has("image") ? cell(row, "image") : "";
    const listType = hasList ? cell(row, "list").toLowerCase() : "played";

    if (listType === "backlog") {
      backlog.push({ name, platform, price, image });
      return;
    }

    const status = cell(row, "status");
    const ratingText = cell(row, "rating");
    const rating = Number(ratingText);
    const review = has("review") ? cell(row, "review") : "";

    if (!VALID_STATUSES.includes(status)) {
      throw new Error(
        `Invalid status "${status || "(empty)"}" on row ${displayRow} -> use Finished, Dropped, On Hold, or Ongoing.`
      );
    }

    if (ratingText === "" || !Number.isFinite(rating) || rating < 0 || rating > 10) {
      throw new Error(`Invalid rating on row ${displayRow} -> Rating must be numeric (0-10).`);
    }

    games.push({ name, platform, status, rating, review, price, image });
  });

  if (games.length === 0 && backlog.length === 0) {
    throw new Error("No valid rows found in CSV.");
  }

  return { games, backlog };
}
