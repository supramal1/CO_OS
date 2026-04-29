import {
  type WorkbenchCalendarClient,
  type WorkbenchCalendarRawEvent,
  type WorkbenchCalendarSearchInput,
} from "../calendar";
import type { WorkbenchRetrievedContext } from "../types";
import type { WorkbenchRetrievalAdapterResult } from "./types";

export type CalendarEventReference = WorkbenchCalendarRawEvent;

export type CalendarSearchInput = {
  query?: string;
  start: string;
  end: string;
};

export type CalendarSearchEvents = (
  input: CalendarSearchInput,
) => Promise<CalendarEventReference[]>;

export type RetrieveCalendarContextInput = {
  ask: string;
  now?: Date;
  client?: WorkbenchCalendarClient | null;
  searchEvents?: CalendarSearchEvents;
};

const DEFAULT_SEARCH_WINDOW_DAYS = 14;
const MAX_TERMS = 5;
const MIN_TERMS = 3;
const CALENDAR_FALLBACK_WARNING =
  "Calendar returned context from a bounded scan because no keyword matches were found.";

const WEAK_TERMS = new Set([
  "a",
  "after",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "can",
  "could",
  "for",
  "from",
  "get",
  "help",
  "hey",
  "hi",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "maybe",
  "on",
  "or",
  "our",
  "please",
  "prep",
  "prepare",
  "pull",
  "the",
  "thanks",
  "thank",
  "this",
  "to",
  "together",
  "we",
  "with",
  "you",
]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_ALIASES: ReadonlyMap<string, string> = new Map([
  ["jan", "January"],
  ["january", "January"],
  ["feb", "February"],
  ["february", "February"],
  ["mar", "March"],
  ["march", "March"],
  ["apr", "April"],
  ["april", "April"],
  ["may", "May"],
  ["jun", "June"],
  ["june", "June"],
  ["jul", "July"],
  ["july", "July"],
  ["aug", "August"],
  ["august", "August"],
  ["sep", "September"],
  ["sept", "September"],
  ["september", "September"],
  ["oct", "October"],
  ["october", "October"],
  ["nov", "November"],
  ["november", "November"],
  ["dec", "December"],
  ["december", "December"],
]);

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const RELATIVE_DATE_HINTS = [
  "today",
  "tomorrow",
  "next week",
  "next month",
  "this week",
  "this month",
  "q1",
  "q2",
  "q3",
  "q4",
];

const DELIVERABLE_TERMS = [
  "brief",
  "deck",
  "doc",
  "document",
  "memo",
  "model",
  "plan",
  "proposal",
  "qbr",
  "report",
  "response",
  "sheet",
  "slides",
  "spreadsheet",
];

export function extractCalendarKeywords(ask: string): string[] {
  const normalizedAsk = ask.replace(/[’']/g, "'");
  const lower = normalizedAsk.toLowerCase();
  const titleCasePhraseWords = new Set<string>();
  const phraseTerms: string[] = [];
  const explicitDateTerms: string[] = [];
  const namedTerms: string[] = [];
  const dateHintTerms: string[] = [];
  const acronymTerms: string[] = [];
  const deliverableTerms: string[] = [];
  const fallbackTerms: string[] = [];

  for (const match of normalizedAsk.matchAll(
    /\b[A-Z][a-z][a-zA-Z&.-]*(?:\s+[A-Z][a-z][a-zA-Z&.-]*)+\b/g,
  )) {
    const term = cleanTerm(match[0]);
    if (!term || termWords(term).some((word) => isDateWord(word) || isWeakTerm(word))) {
      continue;
    }
    addUnique(phraseTerms, term);
    for (const word of termWords(term)) titleCasePhraseWords.add(word.toLowerCase());
  }

  for (const match of normalizedAsk.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi,
  )) {
    const day = Number(match[1]);
    const month = MONTH_ALIASES.get(match[2].toLowerCase());
    if (day > 0 && month) addUnique(explicitDateTerms, `${day} ${month}`);
  }

  for (const match of normalizedAsk.matchAll(/\b[A-Z][a-z][a-zA-Z&.-]*\b/g)) {
    const term = cleanTerm(match[0]);
    const lowerTerm = term.toLowerCase();
    if (
      !term ||
      titleCasePhraseWords.has(lowerTerm) ||
      isWeakTerm(term) ||
      isDateWord(term)
    ) {
      continue;
    }
    addUnique(namedTerms, term);
  }

  for (const weekday of WEEKDAYS) {
    if (new RegExp(`\\b${weekday.toLowerCase()}\\b`).test(lower)) {
      addUnique(dateHintTerms, weekday);
    }
  }
  for (const hint of RELATIVE_DATE_HINTS) {
    if (new RegExp(`\\b${hint.replace(" ", "\\s+")}\\b`).test(lower)) {
      addUnique(dateHintTerms, titleCase(hint));
    }
  }

  for (const match of normalizedAsk.matchAll(/\b[A-Z0-9]{2,}\b/g)) {
    const term = cleanTerm(match[0]);
    if (!/^\d+$/.test(term)) addUnique(acronymTerms, term);
  }

  for (const term of DELIVERABLE_TERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(normalizedAsk)) {
      addUnique(deliverableTerms, term === "qbr" ? "QBR" : titleCase(term));
    }
  }

  const ordered = [
    ...phraseTerms,
    ...explicitDateTerms,
    ...namedTerms,
    ...dateHintTerms,
    ...acronymTerms,
    ...deliverableTerms,
  ];

  if (ordered.length < MIN_TERMS) {
    for (const match of normalizedAsk.matchAll(/\b[a-zA-Z][a-zA-Z0-9&.-]{3,}\b/g)) {
      const term = titleCase(match[0].toLowerCase());
      if (!isWeakTerm(term) && !isDateWord(term)) addUnique(fallbackTerms, term);
      if (ordered.length + fallbackTerms.length >= MIN_TERMS) break;
    }
  }

  return uniqueTerms([...ordered, ...fallbackTerms]).slice(0, MAX_TERMS);
}

export async function retrieveCalendarContext(
  input: RetrieveCalendarContextInput,
): Promise<WorkbenchRetrievalAdapterResult> {
  const client: WorkbenchCalendarClient | null = input.client
    ? input.client
    : input.searchEvents
    ? {
        searchEvents: (searchInput: WorkbenchCalendarSearchInput) =>
          input.searchEvents!({
            query: searchInput.query,
            start: searchInput.timeMin,
            end: searchInput.timeMax,
          }),
      }
    : null;

  if (!client) {
    return {
      items: [],
      status: {
        source: "calendar",
        status: "unavailable",
        reason: "calendar_client_missing",
        items_count: 0,
      },
    };
  }

  const now = input.now ?? new Date();
  const timeMin = now.toISOString();
  const timeMax = addDays(now, DEFAULT_SEARCH_WINDOW_DAYS).toISOString();
  const terms = extractCalendarKeywords(input.ask);
  const warnings: string[] = [];

  try {
    const resultSets =
      terms.length > 0
        ? await Promise.all(
            terms.map((query) => client.searchEvents({ query, timeMin, timeMax })),
          )
        : [];
    let events = dedupeEvents(resultSets.flat());
    if (events.length === 0) {
      events = dedupeEvents(await client.searchEvents({ timeMin, timeMax }));
      warnings.push(
        terms.length > 0
          ? CALENDAR_FALLBACK_WARNING
          : "Calendar returned context from a bounded scan because the ask did not include strong search terms.",
      );
    }

    const items = rankEvents(events, terms).map((event) =>
      toRetrievedContext(toEventRef(event)),
    );
    if (items.length === 0) {
      warnings.push("Calendar returned no events for the next 14 days.");
    }

    return {
      items,
      status: {
        source: "calendar",
        status: "ok",
        items_count: items.length,
      },
      warnings,
    };
  } catch (err) {
    return {
      items: [],
      status: {
        source: "calendar",
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
        items_count: 0,
      },
    };
  }
}

type CalendarEventRef = {
  claim: string;
  source_type: "calendar";
  source_label: string;
  source_url: string | null;
};

function toEventRef(event: WorkbenchCalendarRawEvent): CalendarEventRef {
  const sourceUrl = event.url ?? event.reference ?? null;
  return {
    claim: `Calendar event: ${event.title}, ${event.start}`,
    source_type: "calendar",
    source_label: event.title,
    source_url: sourceUrl,
  };
}

function toRetrievedContext(item: CalendarEventRef): WorkbenchRetrievedContext {
  return {
    claim: item.claim,
    source_type: item.source_type,
    source_label: item.source_label,
    source_url: item.source_url,
  };
}

function rankEvents(
  events: WorkbenchCalendarRawEvent[],
  terms: string[],
): WorkbenchCalendarRawEvent[] {
  return events
    .map((event, index) => ({
      event,
      index,
      score: scoreCalendarEvent(event, terms),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aStart = Date.parse(a.event.start);
      const bStart = Date.parse(b.event.start);
      if (Number.isFinite(aStart) && Number.isFinite(bStart) && aStart !== bStart) {
        return aStart - bStart;
      }
      return a.index - b.index;
    })
    .map((ranked) => ranked.event);
}

function scoreCalendarEvent(
  event: WorkbenchCalendarRawEvent,
  terms: string[],
): number {
  const title = event.title.toLowerCase();
  const description = event.description?.toLowerCase() ?? "";
  const attendees = (event.attendees ?? []).join(" ").toLowerCase();
  const eventDateTerms = formatEventDateTerms(event.start).map((term) =>
    term.toLowerCase(),
  );
  let score = 0;

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    if (title.includes(normalizedTerm)) score += 50;
    if (description.includes(normalizedTerm)) score += 30;
    if (attendees.includes(normalizedTerm)) score += 20;
    if (eventDateTerms.includes(normalizedTerm)) score += 55;
    if (term.includes(" ")) score += 10;
  }

  return score;
}

function dedupeEvents(
  events: WorkbenchCalendarRawEvent[],
): WorkbenchCalendarRawEvent[] {
  const seen = new Set<string>();
  const deduped: WorkbenchCalendarRawEvent[] = [];
  for (const event of events) {
    if (!event.id || seen.has(event.id)) continue;
    seen.add(event.id);
    deduped.push(event);
  }
  return deduped;
}

function cleanTerm(rawTerm: string): string {
  return rawTerm.trim().replace(/^[^\w]+|[.,:;!?)]$/g, "");
}

function uniqueTerms(terms: string[]): string[] {
  const unique: string[] = [];
  for (const term of terms) addUnique(unique, term);
  return unique;
}

function addUnique(terms: string[], rawTerm: string): void {
  const term = cleanTerm(rawTerm);
  if (!term || isWeakTerm(term)) return;
  if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
    return;
  }
  terms.push(term);
}

function termWords(term: string): string[] {
  return term.split(/\s+/).filter(Boolean);
}

function isWeakTerm(term: string): boolean {
  return WEAK_TERMS.has(term.toLowerCase());
}

function isDateWord(term: string): boolean {
  const lower = term.toLowerCase();
  return (
    MONTH_ALIASES.has(lower) ||
    WEEKDAYS.some((weekday) => weekday.toLowerCase() === lower)
  );
}

function formatEventDateTerms(start: string): string[] {
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) return [];
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const weekday = WEEKDAYS[date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1];
  return [`${day} ${month}`, `${month} ${day}`, weekday];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
