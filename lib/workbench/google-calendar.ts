import type {
  WorkbenchCalendarClient,
  WorkbenchCalendarRawEvent,
  WorkbenchCalendarSearchInput,
} from "./calendar";

export type GoogleCalendarClientFactoryInput = {
  accessToken?: string | null;
  calendarId?: string;
  fetch?: typeof fetch;
};

export type GoogleCalendarClientFactoryResult =
  | {
      status: "available";
      reason?: never;
      client: WorkbenchCalendarClient;
    }
  | {
      status: "unavailable";
      reason: "google_calendar_access_token_missing";
      client: null;
    };

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Array<{
    email?: string;
  }>;
};

type GoogleCalendarEventsListResponse = {
  items?: GoogleCalendarEvent[];
  error?: {
    message?: string;
  };
};

export function createGoogleCalendarClient(
  input: GoogleCalendarClientFactoryInput,
): GoogleCalendarClientFactoryResult {
  const accessToken = input.accessToken?.trim();
  if (!accessToken) {
    return {
      status: "unavailable",
      reason: "google_calendar_access_token_missing",
      client: null,
    };
  }

  const calendarId = input.calendarId?.trim() || "primary";
  const fetchImpl = input.fetch ?? fetch;

  return {
    status: "available",
    client: {
      async searchEvents(searchInput) {
        return searchGoogleCalendarEvents({
          accessToken,
          calendarId,
          fetchImpl,
          searchInput,
        });
      },
    },
  };
}

async function searchGoogleCalendarEvents(input: {
  accessToken: string;
  calendarId: string;
  fetchImpl: typeof fetch;
  searchInput: WorkbenchCalendarSearchInput;
}): Promise<WorkbenchCalendarRawEvent[]> {
  const url = buildEventsListUrl(input.calendarId, input.searchInput);
  const response = await input.fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
  });
  const body = (await response.json()) as GoogleCalendarEventsListResponse;

  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `Google Calendar request failed: ${response.status}`,
    );
  }

  return (body.items ?? []).map(toRawEvent).filter(isRawEvent);
}

function buildEventsListUrl(
  calendarId: string,
  input: WorkbenchCalendarSearchInput,
): string {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", input.timeMin);
  url.searchParams.set("timeMax", input.timeMax);
  if (input.query) url.searchParams.set("q", input.query);
  return url.toString();
}

function toRawEvent(
  event: GoogleCalendarEvent,
): WorkbenchCalendarRawEvent | null {
  const id = event.id?.trim();
  const start = event.start?.dateTime ?? event.start?.date;
  if (!id || !start) return null;

  return {
    id,
    title: event.summary?.trim() || "Untitled Calendar event",
    start,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    attendees:
      event.attendees
        ?.map((attendee) => attendee.email?.trim())
        .filter(isNonEmptyString) ?? [],
    url: event.htmlLink ?? null,
    reference: id,
    description: event.description ?? null,
  };
}

function isRawEvent(
  event: WorkbenchCalendarRawEvent | null,
): event is WorkbenchCalendarRawEvent {
  return event !== null;
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}
