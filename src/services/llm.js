export async function testLlmConfig(config, signal) {
  await callChatCompletion({
    label: "configuration-test",
    config,
    messages: [
      {
        role: "system",
        content: "Reply with OK only."
      },
      {
        role: "user",
        content: "Configuration test."
      }
    ],
    maxTokens: 8,
    temperature: 0,
    signal
  });

  return true;
}

export async function extractPreferences(config, games, enrichments, signal) {
  const dataset = serializeGames(games, enrichments);
  const content = await callChatCompletion({
    label: "preference-extraction",
    config,
    messages: [
      {
        role: "system",
        content:
          "You extract concise player preference signals from a game log. Use only the provided data. Do not recommend games. Do not include private reasoning, hidden thoughts, analysis, scratchpad text, or chain-of-thought. Output only the final user-visible preference bullets."
      },
      {
        role: "user",
        content:
          "Return 5 to 8 concise bullet points about preferred gameplay feel, pacing, structure, challenge, genre patterns, and review themes.\n\nRules:\n- Start each bullet with \"- \".\n- Do not include a heading.\n- Do not include reasoning steps or internal analysis.\n- Do not recommend games.\n\nDataset:\n" +
          JSON.stringify(dataset, null, 2)
      }
    ],
    maxTokens: 700,
    temperature: 0.2,
    signal
  });

  return formatPreferenceOutput(content);
}

export async function generateRecommendations(config, games, preferenceSignals, signal) {
  const existingGames = games.map((game) => game.game);
  const content = await callChatCompletion({
    label: "recommendations",
    config,
    messages: [
      {
        role: "system",
        content:
          "You produce final user-visible game recommendations for a browser app. Do not include private reasoning, hidden thoughts, analysis, scratchpad text, chain-of-thought, markdown tables, or commentary. If you are a reasoning model, keep all thinking hidden and only emit the final recommendation lines."
      },
      {
        role: "user",
        content:
          "Recommend exactly 9 NEW games not present in the existingGames list.\n\nOutput contract:\n- Start immediately with the exact line FINAL_RECOMMENDATIONS.\n- Then return exactly 9 numbered lines.\n- Each line must use this exact format: 1. Game Title | One short user-facing rationale\n- Do not output JSON.\n- Do not output markdown.\n- Do not explain your choices before the list.\n- Do not count words.\n- Do not mention this prompt.\n- Each title must be a real game and must not appear in existingGames.\n- Each rationale must be 12 to 28 words, focused on gameplay feel, pacing, and structure.\n\nexistingGames:\n" +
          JSON.stringify(existingGames, null, 2) +
          "\n\npreferenceSignals:\n" +
          stripPrivateReasoningBlocks(preferenceSignals)
      }
    ],
    maxTokens: 2600,
    temperature: 0.15,
    signal
  });

  const recommendations = parseRecommendationJson(content);
  const existingSet = new Set(existingGames.map(normalizeName));
  const filtered = recommendations
    .filter((item) => item.game && !existingSet.has(normalizeName(item.game)))
    .slice(0, 9);

  if (filtered.length === 0) {
    throw new Error(
      "LLM recommendation output could not be parsed -> check the raw recommendations log in the browser console."
    );
  }

  if (filtered.length < 9) {
    throw new Error(
      `LLM returned ${filtered.length} valid new recommendation${
        filtered.length === 1 ? "" : "s"
      } instead of 9 -> retry recommendations.`
    );
  }

  return filtered;
}

async function callChatCompletion({ label, config, messages, maxTokens, temperature, signal }) {
  const endpoint = getChatEndpoint(config.apiUrl);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens
      })
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    throw new Error(
      "LLM request failed -> check API URL, browser CORS support, network access, and API key."
    );
  }

  if (!response.ok) {
    const rawError = await safeReadResponseText(response);
    logRawLlmResponse({
      label,
      endpoint,
      model: config.model,
      temperature,
      maxTokens,
      providerResponse: rawError,
      rawContent: rawError,
      normalizedText: rawError
    });
    const detail = formatProviderError(rawError);
    throw new Error(
      `LLM request failed (${response.status}) -> check API URL, model, API key, and CORS settings.${detail}`
    );
  }

  const data = await response.json();
  const rawContent =
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    data.output_text ??
    data.output?.[0]?.content?.[0]?.text;
  const content = extractTextContent(rawContent);

  logRawLlmResponse({
    label,
    endpoint,
    model: config.model,
    temperature,
    maxTokens,
    providerResponse: data,
    rawContent,
    normalizedText: content
  });

  if (!content) {
    throw new Error("LLM response was empty -> verify the model supports chat completions.");
  }

  return content;
}

function getChatEndpoint(apiUrl) {
  const trimmed = String(apiUrl ?? "").trim();

  if (!trimmed) {
    throw new Error("Missing API URL -> enter an OpenAI-compatible chat completion endpoint.");
  }

  const withoutSlash = trimmed.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(withoutSlash)) {
    return withoutSlash;
  }

  return `${withoutSlash}/chat/completions`;
}

function serializeGames(games, enrichments) {
  return games.map((game) => {
    const enrichment = enrichments?.[game.id];

    return {
      game: game.game,
      platform: game.platform,
      status: game.status,
      rating: game.rating,
      review: game.review,
      genres: enrichment?.genres ?? undefined
    };
  });
}

function formatPreferenceOutput(content) {
  const withoutReasoning = stripReasoningSections(stripPrivateReasoningBlocks(content));
  const parsed = parsePreferenceJson(withoutReasoning);

  if (parsed.length > 0) {
    return parsed.map((item) => `- ${item}`).join("\n");
  }

  const cleanedLines = withoutReasoning
    .replace(/```(?:text|markdown|md)?/gi, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isPrivateReasoningLine(line));

  const bulletLines = cleanedLines.filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line));
  const finalLines = bulletLines.length >= 2 ? bulletLines : cleanedLines;

  return finalLines
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "- "))
    .join("\n")
    .trim();
}

function parsePreferenceJson(content) {
  for (const candidate of getJsonCandidates(content)) {
    const parsed = tryParseJson(candidate);
    const values = preferenceValuesFromParsed(parsed);

    if (values.length > 0) {
      return values.map((value) => sanitizeVisibleText(value)).filter(Boolean);
    }
  }

  return [];
}

function preferenceValuesFromParsed(parsed) {
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) => (typeof item === "string" ? item : item?.preference ?? item?.signal));
  }

  if (typeof parsed === "object") {
    const keys = ["preferences", "preferenceSignals", "signals", "playerPreferences", "bullets"];

    for (const key of keys) {
      if (Array.isArray(parsed[key])) {
        return parsed[key].map((item) =>
          typeof item === "string" ? item : item?.preference ?? item?.signal ?? item?.text
        );
      }
    }
  }

  return [];
}

function parseRecommendationJson(content) {
  const cleaned = stripPrivateReasoningBlocks(content);
  const segments = [...new Set([getFinalRecommendationSegment(cleaned), cleaned].filter(Boolean))];
  const found = [];

  for (const segment of segments) {
    for (const candidate of getJsonCandidates(segment)) {
      const parsed = tryParseJson(candidate);
      const items = recommendationValuesFromParsed(parsed);

      if (items.length > 0) {
        found.push(...items);
      }
    }

    found.push(...parseLooseRecommendations(segment));
    found.push(...parsePlanningCandidateTitles(segment));
  }

  const normalized = normalizeRecommendationItems(found);

  if (normalized.length > 0) {
    return normalized;
  }

  throw new Error("LLM recommendation output could not be parsed -> retry recommendations.");
}

function recommendationValuesFromParsed(parsed) {
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (typeof parsed === "object") {
    const keys = [
      "recommendations",
      "recommendedGames",
      "games",
      "items",
      "results",
      "data"
    ];

    for (const key of keys) {
      if (Array.isArray(parsed[key])) {
        return parsed[key];
      }
    }

    if (parsed.game || parsed.name || parsed.title) {
      return [parsed];
    }
  }

  return [];
}

function normalizeRecommendationItems(items) {
  const seen = new Set();

  return items
    .map((item) => {
      if (typeof item === "string") {
        return {
          game: sanitizeGameName(item),
          reasoning: defaultRecommendationReason()
        };
      }

      const game = sanitizeGameName(
        item?.game ?? item?.name ?? item?.title ?? item?.gameName ?? item?.game_title
      );
      const reasoning = sanitizeVisibleText(
        item?.reason ??
          item?.reasoning ??
          item?.rationale ??
          item?.why ??
          item?.description ??
          item?.explanation ??
          item?.short_reason ??
          item?.shortReason
      );

      return {
        game,
        reasoning:
          reasoning ||
          defaultRecommendationReason()
      };
    })
    .filter((item) => {
      if (!item.game) {
        return false;
      }

      const key = normalizeName(item.game);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function defaultRecommendationReason() {
  return "Matches the pacing, structure, discovery, and play-feel patterns reflected across your game log.";
}

function parseLooseRecommendations(content) {
  const text = stripCodeFences(content);
  const finalLineItems = parseFinalRecommendationLines(text);

  if (finalLineItems.length > 0) {
    return finalLineItems;
  }

  const gameReasonItems = parseGameReasonBlocks(text);

  if (gameReasonItems.length > 0) {
    return gameReasonItems;
  }

  const tableItems = parseMarkdownTableRecommendations(text);

  if (tableItems.length > 0) {
    return tableItems;
  }

  const yamlItems = parseYamlRecommendationBlocks(text);

  if (yamlItems.length > 0) {
    return yamlItems;
  }

  const objectItems = extractBalancedSnippets(text, "{", "}")
    .map(parseLooseObject)
    .filter(Boolean);

  if (objectItems.length > 0) {
    return objectItems;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""))
    .map(parseLooseLine)
    .filter(Boolean);
}

function parseLooseObject(text) {
  const game = matchLooseField(text, ["game", "name", "title", "gameName", "game_title"]);
  const reason = matchLooseField(text, [
    "reason",
    "reasoning",
    "rationale",
    "why",
    "description",
    "explanation",
    "short_reason",
    "shortReason"
  ]);

  if (!game) {
    return null;
  }

  return { game, reason };
}

function getFinalRecommendationSegment(text) {
  const markers = [
    "FINAL_RECOMMENDATIONS",
    "FINAL RECOMMENDATIONS",
    "Final recommendations",
    "Recommendations"
  ];
  const lower = String(text ?? "").toLowerCase();
  let bestIndex = -1;
  let bestMarker = "";

  markers.forEach((marker) => {
    const index = lower.lastIndexOf(marker.toLowerCase());
    if (index > bestIndex) {
      bestIndex = index;
      bestMarker = marker;
    }
  });

  if (bestIndex < 0) {
    return "";
  }

  return text.slice(bestIndex + bestMarker.length).replace(/^[:\s-]+/, "").trim();
}

function parseFinalRecommendationLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, ""))
    .map(parseLooseLine)
    .filter(Boolean);
}

function parseGameReasonBlocks(text) {
  const items = [];
  let current = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    const gameMatch =
      line.match(/^Game\s*\d+\s*:\s*(.+)$/i) ||
      line.match(/^\d+[.)]\s*(?:Game\s*)?[:.-]?\s*(.+)$/i);
    const reasonMatch = line.match(
      /^(?:Reason|Rationale|Why|Description)\s*:\s*["\u201C]?(.+?)["\u201D]?\s*$/i
    );

    if (gameMatch) {
      if (current?.game) {
        items.push(current);
      }
      current = { game: gameMatch[1], reason: "" };
      return;
    }

    if (reasonMatch && current) {
      current.reason = reasonMatch[1];
    }
  });

  if (current?.game) {
    items.push(current);
  }

  return items;
}

function parsePlanningCandidateTitles(text) {
  const items = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line) => {
    const candidateMatch = line.match(
      /(?:potential games|potential recommendations|candidate games|candidates|we can pick|let'?s choose)\s*:\s*(.+)$/i
    );

    if (!candidateMatch) {
      return;
    }

    const titles = extractTitleList(candidateMatch[1]);
    titles.forEach((title) => {
      items.push({ game: title, reason: defaultRecommendationReason() });
    });
  });

  return items;
}

function extractTitleList(text) {
  const quoted = [...String(text ?? "").matchAll(/["\u201C]([^"\u201D]+)["\u201D]/g)]
    .map((match) => match[1])
    .filter(Boolean);

  if (quoted.length > 0) {
    return quoted;
  }

  return String(text ?? "")
    .split(/\s*,\s*/)
    .map((part) =>
      part
        .replace(/\betc\.?$/i, "")
        .replace(/\s+and\s+others?$/i, "")
        .trim()
    )
    .filter((part) => part.length > 1);
}

function parseMarkdownTableRecommendations(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim())
    );

  if (rows.length < 2) {
    return [];
  }

  const header = rows[0].map((cell) => cell.toLowerCase());
  const gameIndex = header.findIndex((cell) => /game|title|name/.test(cell));
  const reasonIndex = header.findIndex((cell) => /reason|why|rationale|description/.test(cell));

  if (gameIndex < 0) {
    return [];
  }

  return rows
    .slice(1)
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .map((cells) => ({
      game: cells[gameIndex] || "",
      reason: reasonIndex >= 0 ? cells[reasonIndex] || "" : ""
    }))
    .filter((item) => item.game);
}

function parseYamlRecommendationBlocks(text) {
  const items = [];
  let current = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    const startMatch = line.match(/^-\s*(?:game|title|name)\s*:\s*(.+)$/i);
    const gameMatch = line.match(/^(?:game|title|name)\s*:\s*(.+)$/i);
    const reasonMatch = line.match(/^(?:reason|reasoning|rationale|why|description)\s*:\s*(.+)$/i);

    if (startMatch) {
      if (current?.game) {
        items.push(current);
      }
      current = { game: startMatch[1], reason: "" };
      return;
    }

    if (gameMatch) {
      if (current?.game) {
        items.push(current);
      }
      current = { game: gameMatch[1], reason: "" };
      return;
    }

    if (reasonMatch && current) {
      current.reason = reasonMatch[1];
    }
  });

  if (current?.game) {
    items.push(current);
  }

  return items;
}

function parseLooseLine(line) {
  const withoutMarkdown = line.replace(/\*\*/g, "").replace(/__/g, "").trim();
  const fieldMatch = withoutMarkdown.match(
    /(?:game|title|name)\s*:\s*(.+?)(?:\s+(?:reason|why|rationale|because)\s*:\s*(.+))?$/i
  );

  if (fieldMatch) {
    return {
      game: fieldMatch[1],
      reason: fieldMatch[2] || ""
    };
  }

  const separators = [
    " | ",
    "|",
    " - ",
    " -- ",
    " : ",
    ": ",
    " \u2013 ",
    "\u2013 ",
    " \u2014 ",
    "\u2014 "
  ];

  for (const separator of separators) {
    const index = withoutMarkdown.indexOf(separator);
    if (index > 0) {
      return {
        game: withoutMarkdown.slice(0, index),
        reason: withoutMarkdown.slice(index + separator.length)
      };
    }
  }

  return { game: withoutMarkdown, reason: "" };
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function formatProviderError(text) {
  if (!text) {
    return "";
  }

  try {
    const message = JSON.parse(text)?.error?.message || text;
    return message ? ` Provider message: ${message.slice(0, 220)}` : "";
  } catch {
    return ` Provider message: ${text.slice(0, 220)}`;
  }
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function logRawLlmResponse({
  label,
  endpoint,
  model,
  temperature,
  maxTokens,
  providerResponse,
  rawContent,
  normalizedText
}) {
  const name = label || "unknown";
  const title = `[Game Insights] Raw LLM response: ${name}`;

  try {
    console.groupCollapsed(title);
    console.log("request", {
      endpoint,
      model,
      temperature,
      maxTokens
    });
    console.log("raw provider response", providerResponse);
    console.log("raw content", rawContent);
    console.log("normalized text", normalizedText);
    console.groupEnd();
  } catch {
    console.log(title, {
      endpoint,
      model,
      temperature,
      maxTokens,
      providerResponse,
      rawContent,
      normalizedText
    });
  }
}

function extractTextContent(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((part) =>
        extractTextContent(part?.text ?? part?.content ?? part?.output_text ?? part?.value ?? part)
      )
      .join("\n")
      .trim();
  }

  if (value && typeof value === "object") {
    return extractTextContent(value.text ?? value.content ?? value.output_text ?? "");
  }

  return String(value ?? "").trim();
}

function stripPrivateReasoningBlocks(value) {
  let text = String(value ?? "");
  const patterns = [
    /<think\b[^>]*>[\s\S]*?<\/think>/gi,
    /<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi,
    /<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi,
    /<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi,
    /```(?:thinking|reasoning|analysis|scratchpad)[\s\S]*?```/gi
  ];

  patterns.forEach((pattern) => {
    text = text.replace(pattern, "\n");
  });

  return text.trim();
}

function stripReasoningSections(value) {
  let text = String(value ?? "");
  const finalMatch = [...text.matchAll(/(?:^|\n)\s*(?:final answer|final|answer|output)\s*:\s*/gi)].pop();

  if (finalMatch) {
    text = text.slice(finalMatch.index + finalMatch[0].length);
  }

  return text
    .split(/\r?\n/)
    .filter((line) => !isPrivateReasoningLine(line))
    .join("\n")
    .trim();
}

function isPrivateReasoningLine(line) {
  return /^\s*(?:reasoning|analysis|thinking|thought process|chain[- ]of[- ]thought|scratchpad|internal notes?)\s*:/i.test(
    line
  );
}

function getJsonCandidates(content) {
  const text = stripPrivateReasoningBlocks(content);
  const candidates = [text];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch = fenceRegex.exec(text);

  while (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
    fenceMatch = fenceRegex.exec(text);
  }

  candidates.push(...extractBalancedSnippets(text, "{", "}"));
  candidates.push(...extractBalancedSnippets(text, "[", "]"));

  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function extractBalancedSnippets(text, opener, closer) {
  const snippets = [];
  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === opener) {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === closer && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        snippets.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return snippets;
}

function tryParseJson(candidate) {
  const repaired = repairJson(candidate);

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function repairJson(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^[^\[{]*/, "")
    .replace(/[^\]}]*$/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(
      /([{,]\s*)(recommendations|recommendedGames|games|items|results|data|game|name|title|gameName|game_title|reason|reasoning|rationale|why|description|explanation|short_reason|shortReason)\s*:/gi,
      '$1"$2":'
    )
    .replace(/,\s*([}\]])/g, "$1");
}

function stripCodeFences(value) {
  return String(value ?? "")
    .replace(/```(?:json|text|markdown|md)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function matchLooseField(text, fields) {
  for (const field of fields) {
    const pattern = new RegExp(`["']?${field}["']?\\s*[:=-]\\s*["']?([^"',}\\n|]+)`, "i");
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function sanitizeGameName(value) {
  return sanitizeVisibleText(value)
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
    .replace(/^(?:game|title|name)\s*:\s*/i, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function sanitizeVisibleText(value) {
  return stripReasoningSections(stripPrivateReasoningBlocks(value))
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}
