import { describe, expect, it } from "vitest";
import { generateNewsroomBrief } from "@/lib/newsroom/brief";
import type {
  NewsroomAdapterContext,
  NewsroomSource,
  NewsroomSourceSnapshot,
} from "@/lib/newsroom/types";

const now = new Date("2026-04-30T09:00:00.000Z");
type TestNewsroomAdapter = ((
  context: NewsroomAdapterContext,
) => Promise<NewsroomSourceSnapshot>) & { source?: NewsroomSource };

function snapshot(overrides: Partial<NewsroomSourceSnapshot>): NewsroomSourceSnapshot {
  return {
    source: "workbench",
    status: {
      source: "workbench",
      status: "ok",
      itemsCount: 1,
    },
    candidates: [],
    ...overrides,
  };
}

function adapter(source: NewsroomSource, load: TestNewsroomAdapter): TestNewsroomAdapter {
  return Object.assign(load, { source });
}

describe("generateNewsroomBrief", () => {
  it("combines adapter candidates into brief sections and actions", async () => {
    const brief = await generateNewsroomBrief({
      userId: "principal_123",
      now,
      adapters: [
        async () =>
          snapshot({
            source: "calendar",
            status: { source: "calendar", status: "ok", itemsCount: 1 },
            candidates: [
              {
                id: "calendar-event-1",
                title: "Prepare for 11:00 Client X check-in",
                reason: "Client X appears in today's calendar.",
                source: "calendar",
                confidence: "high",
                section: "today",
                href: "https://calendar.google.com/event?eid=event-1",
                action: {
                  label: "Open Calendar",
                  target: "calendar",
                  href: "https://calendar.google.com/event?eid=event-1",
                },
                signals: ["meeting_today", "action_available"],
                sourceRefs: ["calendar:event-1"],
              },
            ],
          }),
      ],
    });

    expect(brief).toMatchObject({
      userId: "principal_123",
      generatedAt: now.toISOString(),
      today: [{ title: "Prepare for 11:00 Client X check-in" }],
      suggestedNextActions: [{ label: "Open Calendar" }],
      sourceStatuses: [{ source: "calendar", status: "ok", itemsCount: 1 }],
    });
    expect(brief.range.from).toBe("2026-04-30T00:00:00.000Z");
    expect(brief.range.to).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns a valid partial brief when one adapter throws", async () => {
    const brief = await generateNewsroomBrief({
      userId: "principal_123",
      now,
      adapters: [
        adapter("cornerstone", async () => {
          throw new Error("Cornerstone timeout");
        }),
        async () =>
          snapshot({
            source: "review",
            status: { source: "review", status: "empty", itemsCount: 0 },
            candidates: [],
          }),
      ],
    });

    expect(brief.today).toEqual([]);
    expect(brief.sourceStatuses).toEqual([
      {
        source: "cornerstone",
        status: "error",
        reason: "Cornerstone timeout",
        itemsCount: 0,
      },
      { source: "review", status: "empty", itemsCount: 0 },
    ]);
  });

  it("launches adapters concurrently", async () => {
    let started = 0;
    let releaseFirst: (snapshot: NewsroomSourceSnapshot) => void = () => {};
    let releaseSecond: (snapshot: NewsroomSourceSnapshot) => void = () => {};

    const briefPromise = generateNewsroomBrief({
      userId: "principal_123",
      now,
      adapters: [
        adapter(
          "calendar",
          async () =>
            new Promise<NewsroomSourceSnapshot>((resolve) => {
              started += 1;
              releaseFirst = resolve;
            }),
        ),
        adapter(
          "review",
          async () =>
            new Promise<NewsroomSourceSnapshot>((resolve) => {
              started += 1;
              releaseSecond = resolve;
            }),
        ),
      ],
    });

    await Promise.resolve();
    const startedBeforeAnyAdapterResolved = started;

    releaseFirst(
      snapshot({
        source: "calendar",
        status: { source: "calendar", status: "empty", itemsCount: 0 },
      }),
    );
    await Promise.resolve();
    releaseSecond(
      snapshot({
        source: "review",
        status: { source: "review", status: "empty", itemsCount: 0 },
      }),
    );
    await briefPromise;

    expect(startedBeforeAnyAdapterResolved).toBe(2);
  });
});
