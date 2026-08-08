export const VALID_STATUSES = ["Finished", "Dropped", "On Hold", "Ongoing"];
export const IMPORT_COLUMNS = ["game", "platform", "status", "rating", "review"];

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

// Parses the legacy import format: game,platform,status,rating,review
// Returns normalized game objects ready to write into the store (price defaults to 0).
export function parseGamesCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));

  if (rows.length <= 1) {
    throw new Error("Empty CSV -> include a header row plus at least one game.");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const missing = IMPORT_COLUMNS.filter((column) => !headers.includes(column));

  if (missing.length > 0) {
    throw new Error(`Missing column "${missing[0]}" -> expected header: game,platform,status,rating,review.`);
  }

  const indexByColumn = new Map(headers.map((header, index) => [header, index]));
  const games = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const displayRow = rowIndex + 2;
    const name = getCell(row, indexByColumn.get("game"));
    const platform = getCell(row, indexByColumn.get("platform"));
    const status = getCell(row, indexByColumn.get("status"));
    const ratingText = getCell(row, indexByColumn.get("rating"));
    const rating = Number(ratingText);
    const review = getCell(row, indexByColumn.get("review"));

    if (!name) {
      throw new Error(`Missing game name on row ${displayRow}.`);
    }

    if (!platform) {
      throw new Error(`Missing platform on row ${displayRow}.`);
    }

    if (!VALID_STATUSES.includes(status)) {
      throw new Error(
        `Invalid status "${status || "(empty)"}" on row ${displayRow} -> use Finished, Dropped, On Hold, or Ongoing.`
      );
    }

    if (ratingText === "" || !Number.isFinite(rating) || rating < 0 || rating > 10) {
      throw new Error(`Invalid rating on row ${displayRow} -> Rating must be numeric (0-10).`);
    }

    games.push({ name, platform, status, rating, review, price: 0 });
  });

  if (games.length === 0) {
    throw new Error("No valid rows found in CSV.");
  }

  return games;
}
