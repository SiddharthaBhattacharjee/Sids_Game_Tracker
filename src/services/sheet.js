export const EXPECTED_COLUMNS = ["Game", "Platform", "Status", "Rating (number out of 10)", "Review"];
export const VALID_STATUSES = ["Finished", "Dropped", "On Hold", "Ongoing"];

export async function fetchSheetGames(sheetUrl, signal) {
  const csvUrl = toCsvUrl(sheetUrl);

  let response;
  try {
    response = await fetch(csvUrl, { cache: "no-store", signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    throw new Error(
      "Sheet not public or unreachable -> enable public access and confirm the Google Sheet URL."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Sheet fetch failed (${response.status}) -> enable public access and confirm the Google Sheet URL.`
    );
  }

  const text = await response.text();

  if (/^\s*<!doctype html|<html[\s>]/i.test(text)) {
    throw new Error("Sheet not public -> enable public access and confirm the Google Sheet URL.");
  }

  if (!text.trim()) {
    throw new Error("Empty dataset -> add at least one game row to the sheet.");
  }

  return parseSheetCsv(text);
}

export function toCsvUrl(sheetUrl) {
  const trimmed = String(sheetUrl ?? "").trim();

  if (!trimmed) {
    throw new Error("Missing sheet URL -> paste a public Google Sheet URL.");
  }

  if (/tqx=out:csv|output=csv|format=csv/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (!url.hostname.includes("docs.google.com")) {
      return trimmed;
    }

    const sheetId = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];

    if (!sheetId) {
      throw new Error("Invalid Google Sheet URL -> use the share URL from Google Sheets.");
    }

    const hashGid = url.hash.match(/gid=(\d+)/)?.[1];
    const gid = url.searchParams.get("gid") || hashGid || "0";

    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  } catch (error) {
    if (error.message.includes("Invalid Google Sheet URL")) {
      throw error;
    }

    return trimmed;
  }
}

export function parseSheetCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim()));

  if (rows.length <= 1) {
    throw new Error("Empty dataset -> add at least one game row to the sheet.");
  }

  const headers = rows[0].map((header) => header.trim());
  const missing = EXPECTED_COLUMNS.filter((column) => !headers.includes(column));

  if (missing.length > 0) {
    throw new Error(`Missing column "${missing[0]}" -> add the exact header to the sheet.`);
  }

  const indexByColumn = new Map(headers.map((header, index) => [header, index]));
  const games = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const displayRow = rowIndex + 2;
    const ratingText = getCell(row, indexByColumn.get("Rating (number out of 10)"));
    const rating = Number(ratingText);
    const status = getCell(row, indexByColumn.get("Status"));

    if (ratingText === "" || !Number.isFinite(rating) || rating < 0 || rating > 10) {
      throw new Error(
        `Invalid rating on row ${displayRow} -> Rating must be numeric (0-10).`
      );
    }

    if (!VALID_STATUSES.includes(status)) {
      throw new Error(
        `Invalid status on row ${displayRow} -> Status must be Finished, Dropped, On Hold, or Ongoing.`
      );
    }

    const game = getCell(row, indexByColumn.get("Game"));
    const platform = getCell(row, indexByColumn.get("Platform"));

    if (!game) {
      throw new Error(`Missing game name on row ${displayRow} -> fill the Game column.`);
    }

    if (!platform) {
      throw new Error(`Missing platform on row ${displayRow} -> fill the Platform column.`);
    }

    games.push({
      id: `${displayRow}-${normalizeKey(game)}-${normalizeKey(platform)}`,
      game,
      platform,
      status,
      rating,
      review: getCell(row, indexByColumn.get("Review"))
    });
  });

  if (games.length === 0) {
    throw new Error("Empty dataset -> add at least one game row to the sheet.");
  }

  return games;
}

function parseCsv(input) {
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

function normalizeKey(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
