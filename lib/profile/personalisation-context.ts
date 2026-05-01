const RAW_SECTION_RE =
  /^(?:===\s*)?(GRAPH MEMORY|IDENTITY|FACTS|RECENT FACTS|RELATIONS|MEMORY)(?:\s*===)?$/i;
const GRAPH_SECTION_RE = /^===\s*GRAPH MEMORY/i;
const SECTION_RE = /^===/;
const RAW_IDENTITY_RE =
  /\b(self_entity|user_name|pronoun_mapping|user_role|user_organization|entity_id)\b/i;
const MAX_CONTEXT_SENTENCES = 4;
const MAX_CONTEXT_LENGTH = 900;

export function extractPersonalisationContextText(raw: string): string {
  if (!raw.trim()) return "";
  try {
    return textFromCornerstonePayload(JSON.parse(raw));
  } catch {
    return raw;
  }
}

export function cleanPersonalisationContextText(text: string): string {
  const lines = text
    .replace(/===\s*([^=]+?)\s*===/g, "\n=== $1 ===\n")
    .replace(
      /\s*(\[(?:IDENTITY|FACTS|RECENT FACTS|RELATIONS|GRAPH MEMORY|MEMORY)\])/gi,
      "\n$1\n",
    )
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const kept: string[] = [];
  let inGraphMemory = false;
  let inRawFactSection = false;

  for (const line of lines) {
    const normalizedHeading = line.replace(/^\[|\]$/g, "");

    if (GRAPH_SECTION_RE.test(line) || /^GRAPH MEMORY$/i.test(normalizedHeading)) {
      inGraphMemory = true;
      inRawFactSection = false;
      continue;
    }

    if (SECTION_RE.test(line)) {
      inGraphMemory = false;
      inRawFactSection = false;
      continue;
    }

    if (RAW_SECTION_RE.test(normalizedHeading)) {
      inRawFactSection = /FACTS|MEMORY/i.test(normalizedHeading);
      continue;
    }

    if (inGraphMemory || RAW_IDENTITY_RE.test(line)) continue;

    const cleaned = cleanPersonalisationLine(line, inRawFactSection);
    if (cleaned) kept.push(cleaned);
  }

  return summarizePersonalisationLines(kept);
}

function textFromCornerstonePayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  for (const key of ["context", "result", "answer", "content", "text"]) {
    const text = textFromCornerstonePayload(record[key]);
    if (text.trim()) return text;
  }
  return "";
}

function cleanPersonalisationLine(line: string, rawFactLine: boolean): string {
  const withoutMetadata = line
    .replace(/^[-*]\s*/, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^[a-z0-9][a-z0-9_.-]{2,80}:\s*/i, "")
    .replace(/\s*\(updated:\s*[^)]+\)\s*$/i, "")
    .replace(/\s*\{[^}]*\}\s*$/i, "")
    .trim();

  if (!withoutMetadata || /^\[[^\]]+\]$/.test(withoutMetadata)) return "";
  if (RAW_IDENTITY_RE.test(withoutMetadata)) return "";
  if (rawFactLine && !looksLikeReadablePreference(withoutMetadata)) return "";
  return withoutMetadata;
}

function looksLikeReadablePreference(value: string): boolean {
  if (value.length < 24) return false;
  if (/^[a-z0-9_.:-]+$/i.test(value)) return false;
  return /[.!?]$/.test(value) || /\b(prefers|prioritizes|values|likes|needs|wants|works|use|avoid|focus)/i.test(value);
}

function summarizePersonalisationLines(lines: string[]): string {
  const sentences = lines
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    if (unique.some((existing) => existing.toLowerCase() === normalized)) continue;
    unique.push(sentence);
    if (unique.length >= MAX_CONTEXT_SENTENCES) break;
  }

  return boundedText(unique.join(" "), MAX_CONTEXT_LENGTH);
}

function boundedText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
