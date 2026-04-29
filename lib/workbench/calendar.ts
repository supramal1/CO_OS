import type { WorkbenchRetrievedContext } from "./types";

export {
  createGoogleCalendarClient,
  type GoogleCalendarClientFactoryInput,
  type GoogleCalendarClientFactoryResult,
} from "./google-calendar";

export type WorkbenchCalendarSearchInput = {
  query?: string;
  timeMin: string;
  timeMax: string;
};

export type WorkbenchCalendarRawEvent = {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  attendees?: string[];
  url?: string | null;
  reference?: string | null;
  description?: string | null;
};

export type WorkbenchCalendarClient = {
  searchEvents(
    input: WorkbenchCalendarSearchInput,
  ): Promise<WorkbenchCalendarRawEvent[]>;
};

export type WorkbenchCalendarEventRef = WorkbenchRetrievedContext & {
  event_id: string;
  title: string;
  start: string;
  end: string | null;
  attendees: string[];
  url: string | null;
  excerpt: string;
  relevance_reason: string;
};

export type WorkbenchCalendarRetrievalStatus = {
  source: "calendar";
  status: "ok" | "unavailable" | "error";
  reason?: string;
  items_count: number;
};

export type WorkbenchCalendarRetrievalResult = {
  items: WorkbenchCalendarEventRef[];
  status: WorkbenchCalendarRetrievalStatus;
};

export type CalendarSearchTermExtractor = (ask: string) => string[];

export type RetrieveWorkbenchCalendarContextInput = {
  ask: string;
  client: WorkbenchCalendarClient | null | undefined;
  now?: Date;
  searchWindowDays?: number;
  extractSearchTerms?: CalendarSearchTermExtractor;
};

const DEFAULT_SEARCH_WINDOW_DAYS = 14;
const MAX_TERMS = 5;
const MIN_TERMS = 3;

const STOP_WORDS = new Set([
  "A",
  "An",
  "And",
  "Are",
  "As",
  "At",
  "Be",
  "Can",
  "Could",
  "For",
  "From",
  "Help",
  "I",
  "If",
  "In",
  "Is",
  "It",
  "Me",
  "On",
  "Or",
  "Our",
  "Please",
  "Prep",
  "Prepare",
  "Response",
  "The",
  "This",
  "To",
  "We",
  "With",
  "You",
]);

const DATE_HINTS = new Set([
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "week",
  "weekly",
  "next week",
  "next month",
  "q1",
  "q2",
  "q3",
  "q4",
]);

export function extractCalendarSearchTerms(ask: string): string[] {
  const terms: string[] = [];
  const normalizedAsk = ask.replace(/[’']/g, "'");

  for (const match of normalizedAsk.matchAll(/\b[A-Z][a-zA-Z0-9&.-]{1,}\b/g)) {
    addTerm(terms, match[0]);
  }

  for (const match of normalizedAsk.matchAll(/\b[A-Z0-9]{2,}\b/g)) {
    addTerm(terms, match[0]);
  }

  const lower = normalizedAsk.toLowerCase();
  for (const hint of DATE_HINTS) {
    if (lower.includes(hint)) addTerm(terms, titleCase(hint));
  }

  if (terms.length < MIN_TERMS) {
    for (const match of normalizedAsk.matchAll(/\b[a-zA-Z][a-zA-Z0-9&.-]{3,}\b/g)) {
      addTerm(terms, titleCase(match[0].toLowerCase()));
      if (terms.length >= MIN_TERMS) break;
    }
  }

  return terms.slice(0, MAX_TERMS);
}

export async function retrieveWorkbenchCalendarContext(
  input: RetrieveWorkbenchCalendarContextInput,
): Promise<WorkbenchCalendarRetrievalResult> {
  if (!input.client) {
    return unavailable("calendar_client_missing");
  }

  const now = input.now ?? new Date();
  const timeMin = now.toISOString();
  const timeMax = addDays(
    now,
    input.searchWindowDays ?? DEFAULT_SEARCH_WINDOW_DAYS,
  ).toISOString();
  const terms = (input.extractSearchTerms ?? extractCalendarSearchTerms)(
    input.ask,
  ).slice(0, MAX_TERMS);

  try {
    const resultSets =
      terms.length > 0
        ? await Promise.all(
            terms.map((query) =>
              input.client!.searchEvents({ query, timeMin, timeMax }),
            ),
          )
        : [];
    let events = dedupeEvents(resultSets.flat());
    if (events.length === 0) {
      events = dedupeEvents(
        await input.client.searchEvents({ timeMin, timeMax }),
      );
    }
    const items = events.map((event) => toEventRef(event, terms));

    return {
      items,
      status: {
        source: "calendar",
        status: "ok",
        items_count: items.length,
      },
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

function toEventRef(
  event: WorkbenchCalendarRawEvent,
  terms: string[],
): WorkbenchCalendarEventRef {
  const sourceUrl = event.url ?? event.reference ?? null;
  const matchedTerms = terms.filter((term) =>
    eventSearchText(event).includes(term.toLowerCase()),
  );

  return {
    claim: `Calendar event: ${event.title}, ${event.start}`,
    event_id: event.id,
    title: event.title,
    start: event.start,
    end: event.end ?? null,
    attendees: event.attendees ?? [],
    url: sourceUrl,
    excerpt: event.description?.trim() || `${event.title}, ${event.start}`,
    relevance_reason:
      matchedTerms.length > 0
        ? `Matched search terms: ${matchedTerms.join(", ")}`
        : "Matched bounded Calendar keyword search",
    source_type: "calendar",
    source_label: event.title,
    source_url: sourceUrl,
  };
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

function addTerm(terms: string[], rawTerm: string): void {
  const term = rawTerm.trim().replace(/[.,:;!?)]$/, "");
  if (!term || STOP_WORDS.has(term)) return;
  if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
    return;
  }
  terms.push(term);
}

function eventSearchText(event: WorkbenchCalendarRawEvent): string {
  return [event.title, event.description ?? ""].join(" ").toLowerCase();
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

function unavailable(reason: string): WorkbenchCalendarRetrievalResult {
  return {
    items: [],
    status: {
      source: "calendar",
      status: "unavailable",
      reason,
      items_count: 0,
    },
  };
}
