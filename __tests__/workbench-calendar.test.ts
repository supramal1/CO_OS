import { describe, expect, it } from "vitest";
import {
  createGoogleCalendarClient,
  extractCalendarSearchTerms,
  retrieveWorkbenchCalendarContext,
  type WorkbenchCalendarClient,
} from "@/lib/workbench/calendar";

describe("Workbench calendar adapter", () => {
  it("extracts 3 to 5 deterministic search terms from a pasted ask", () => {
    const terms = extractCalendarSearchTerms(
      "Sarah asked if we can prep the Nike QBR response for next Thursday's steering meeting.",
    );

    expect(terms.length).toBeGreaterThanOrEqual(3);
    expect(terms.length).toBeLessThanOrEqual(5);
    expect(terms).toEqual(
      expect.arrayContaining(["Sarah", "Nike", "QBR", "Thursday"]),
    );
  });

  it("searches the next 14 days and returns source-shaped event references", async () => {
    const calls: Array<{ query?: string; timeMin: string; timeMax: string }> = [];
    const client: WorkbenchCalendarClient = {
      async searchEvents(input) {
        calls.push(input);
        if (input.query !== "Nike") return [];
        return [
          {
            id: "event-1",
            title: "Nike QBR prep",
            start: "2026-05-04T09:00:00.000Z",
            end: "2026-05-04T09:30:00.000Z",
            attendees: ["sarah@example.com", "malik@example.com"],
            url: "https://calendar.google.com/calendar/event?eid=event-1",
            description: "Prep the steering response.",
          },
        ];
      },
    };

    const result = await retrieveWorkbenchCalendarContext({
      ask: "Sarah asked for Nike QBR prep next week",
      client,
      now: new Date("2026-04-29T12:00:00.000Z"),
    });

    expect(result.status).toEqual({
      source: "calendar",
      status: "ok",
      items_count: 1,
    });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((call) => call.timeMin === "2026-04-29T12:00:00.000Z"))
      .toBe(true);
    expect(calls.every((call) => call.timeMax === "2026-05-13T12:00:00.000Z"))
      .toBe(true);
    expect(result.items).toEqual([
      {
        claim: "Calendar event: Nike QBR prep, 2026-05-04T09:00:00.000Z",
        event_id: "event-1",
        title: "Nike QBR prep",
        start: "2026-05-04T09:00:00.000Z",
        end: "2026-05-04T09:30:00.000Z",
        attendees: ["sarah@example.com", "malik@example.com"],
        url: "https://calendar.google.com/calendar/event?eid=event-1",
        excerpt: "Prep the steering response.",
        relevance_reason: "Matched search terms: Nike, QBR",
        source_type: "calendar",
        source_label: "Nike QBR prep",
        source_url: "https://calendar.google.com/calendar/event?eid=event-1",
      },
    ]);
  });

  it("returns a typed unavailable result when the calendar client is missing", async () => {
    const result = await retrieveWorkbenchCalendarContext({
      ask: "Prep the Nike QBR",
      client: null,
      now: new Date("2026-04-29T12:00:00.000Z"),
    });

    expect(result).toEqual({
      items: [],
      status: {
        source: "calendar",
        status: "unavailable",
        reason: "calendar_client_missing",
        items_count: 0,
      },
    });
  });

  it("falls back to a bounded scan when no search terms can be extracted", async () => {
    const calls: Array<{ query?: string; timeMin: string; timeMax: string }> = [];
    const result = await retrieveWorkbenchCalendarContext({
      ask: "it",
      now: new Date("2026-04-29T12:00:00.000Z"),
      extractSearchTerms: () => [],
      client: {
        searchEvents: async (input) => {
          calls.push(input);
          return [
            {
              id: "event-1",
              title: "Planning review",
              start: "2026-05-01T11:00:00.000Z",
              url: "https://calendar.google.com/event?eid=event-1",
            },
          ];
        },
      },
    });

    expect(result.status).toEqual({
      source: "calendar",
      status: "ok",
      items_count: 1,
    });
    expect(calls).toEqual([
      {
        timeMin: "2026-04-29T12:00:00.000Z",
        timeMax: "2026-05-13T12:00:00.000Z",
      },
    ]);
  });

  it("returns a typed unavailable Google Calendar factory result when the access token is missing", () => {
    const result = createGoogleCalendarClient({ accessToken: null });

    expect(result).toEqual({
      status: "unavailable",
      reason: "google_calendar_access_token_missing",
      client: null,
    });
  });

  it("sends bounded Google Calendar events.list parameters and maps event details", async () => {
    const requests: URL[] = [];
    const result = createGoogleCalendarClient({
      accessToken: "calendar-token",
      fetch: async (url, init) => {
        requests.push(new URL(String(url)));
        expect(init?.headers).toEqual({
          Authorization: "Bearer calendar-token",
          Accept: "application/json",
        });

        return new Response(
          JSON.stringify({
            items: [
              {
                id: "event-1",
                summary: "Nike QBR prep",
                description: "Prep the steering response.",
                htmlLink: "https://calendar.google.com/event?eid=event-1",
                start: { dateTime: "2026-05-04T09:00:00.000Z" },
                end: { dateTime: "2026-05-04T09:30:00.000Z" },
                attendees: [
                  { email: "sarah@example.com" },
                  { email: "malik@example.com" },
                ],
              },
              {
                id: "event-2",
                summary: "All-day planning",
                htmlLink: "https://calendar.google.com/event?eid=event-2",
                start: { date: "2026-05-06" },
                end: { date: "2026-05-07" },
                attendees: [
                  { email: "ops@example.com" },
                  { email: " " },
                  {},
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    expect(result.status).toBe("available");
    const events = await result.client!.searchEvents({
      query: "Nike",
      timeMin: "2026-04-29T12:00:00.000Z",
      timeMax: "2026-05-13T12:00:00.000Z",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.origin).toBe("https://www.googleapis.com");
    expect(requests[0]?.pathname).toBe(
      "/calendar/v3/calendars/primary/events",
    );
    expect(requests[0]?.searchParams.get("singleEvents")).toBe("true");
    expect(requests[0]?.searchParams.get("orderBy")).toBe("startTime");
    expect(requests[0]?.searchParams.get("timeMin")).toBe(
      "2026-04-29T12:00:00.000Z",
    );
    expect(requests[0]?.searchParams.get("timeMax")).toBe(
      "2026-05-13T12:00:00.000Z",
    );
    expect(requests[0]?.searchParams.get("q")).toBe("Nike");
    expect(requests[0]?.searchParams.has("scope")).toBe(false);
    expect(events).toEqual([
      {
        id: "event-1",
        title: "Nike QBR prep",
        start: "2026-05-04T09:00:00.000Z",
        end: "2026-05-04T09:30:00.000Z",
        attendees: ["sarah@example.com", "malik@example.com"],
        url: "https://calendar.google.com/event?eid=event-1",
        reference: "event-1",
        description: "Prep the steering response.",
      },
      {
        id: "event-2",
        title: "All-day planning",
        start: "2026-05-06",
        end: "2026-05-07",
        attendees: ["ops@example.com"],
        url: "https://calendar.google.com/event?eid=event-2",
        reference: "event-2",
        description: null,
      },
    ]);
  });

  it("surfaces Google Calendar events.list error messages", async () => {
    const result = createGoogleCalendarClient({
      accessToken: "calendar-token",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Calendar API quota exceeded",
            },
          }),
          { status: 403 },
        ),
    });

    expect(result.status).toBe("available");
    await expect(
      result.client!.searchEvents({
        query: "Nike",
        timeMin: "2026-04-29T12:00:00.000Z",
        timeMax: "2026-05-13T12:00:00.000Z",
      }),
    ).rejects.toThrow("Calendar API quota exceeded");
  });
});
