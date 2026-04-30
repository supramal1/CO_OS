import { describe, expect, it } from "vitest";
import {
  extractCalendarKeywords,
  retrieveCalendarContext,
} from "@/lib/workbench/retrieval/calendar";

describe("Workbench calendar retrieval", () => {
  it("extracts 3 to 5 useful search keywords from an ask", () => {
    const keywords = extractCalendarKeywords(
      "Can you help prep the Nike QBR response Sarah asked for next week?",
    );

    expect(keywords.length).toBeGreaterThanOrEqual(3);
    expect(keywords.length).toBeLessThanOrEqual(5);
    expect(keywords).toContain("Nike");
    expect(keywords).toContain("QBR");
    expect(keywords).toContain("Sarah");
  });

  it("falls back to a bounded 14-day event scan when keyword search is empty", async () => {
    const calls: Array<{ query?: string; start: string; end: string }> = [];
    const result = await retrieveCalendarContext({
      ask: "Prepare the Nike QBR response",
      now: new Date("2026-04-29T12:00:00.000Z"),
      searchEvents: async (input) => {
        calls.push(input);
        if (input.query) return [];
        return [
          {
            id: "event-1",
            title: "Nike QBR prep",
            start: "2026-05-02T10:00:00.000Z",
            end: "2026-05-02T10:30:00.000Z",
            attendees: ["sarah@example.com"],
            url: "https://calendar.google.com/event?eid=event-1",
          },
        ];
      },
    });

    expect(result.status.status).toBe("ok");
    expect(calls.some((call) => call.query === undefined)).toBe(true);
    expect(calls.every((call) => call.start === "2026-04-29T12:00:00.000Z"))
      .toBe(true);
    expect(calls.every((call) => call.end === "2026-05-13T12:00:00.000Z"))
      .toBe(true);
    expect(result.items).toEqual([
      {
        claim: "Calendar event: Nike QBR prep, 2026-05-02T10:00:00.000Z",
        source_type: "calendar",
        source_label: "Nike QBR prep",
        source_url: "https://calendar.google.com/event?eid=event-1",
      },
    ]);
  });
});
