import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const smokeChecklist = () =>
  readFileSync(join(process.cwd(), "config/workbench-v1-smoke.md"), "utf8");

describe("Workbench V1 release readiness gate", () => {
  it("defines an ordered manual operator smoke sequence", () => {
    const doc = smokeChecklist();

    const orderedSteps = [
      /setup Notion/i,
      /disconnect Notion/i,
      /setup Notion again/i,
      /setup Google Workspace\/Drive/i,
      /disconnect Google Workspace\/Drive/i,
      /setup Google Workspace\/Drive again/i,
      /run ask/i,
      /save-back/i,
      /feedback/i,
      /recent runs/i,
      /duplicate checks/i,
      /env\/secret checks/i,
    ];

    let cursor = -1;
    for (const step of orderedSteps) {
      const match = doc.slice(cursor + 1).search(step);
      expect(match, `missing or out-of-order step: ${step}`).toBeGreaterThanOrEqual(0);
      cursor += match + 1;
    }
  });

  it("covers connector setup, disconnect, and setup-again idempotency", () => {
    const doc = smokeChecklist();

    expect(doc).toMatch(/Notion[\s\S]*CO Workbench[\s\S]*Personal Profile[\s\S]*Working On[\s\S]*Patterns[\s\S]*References[\s\S]*Voice/i);
    expect(doc).toMatch(/Google Workspace\/Drive/i);
    expect(doc).toMatch(/reuse or repair/i);
    expect(doc).toMatch(/duplicate active/i);
  });

  it("covers the staff ask, retrieval, save-back, history, and feedback path", () => {
    const doc = smokeChecklist();

    expect(doc).toMatch(/run ask/i);
    expect(doc).toMatch(/retrieval status|source status/i);
    expect(doc).toMatch(/Drive artifact|Drive save-back|save-back/i);
    expect(doc).toMatch(/recent runs/i);
    expect(doc).toMatch(/feedback_useful|feedback_not_useful|feedback action/i);
  });

  it("names release blockers for env, migrations, wording, Gmail, and secrets", () => {
    const doc = smokeChecklist();

    expect(doc).toMatch(/GOOGLE_CLIENT_ID/);
    expect(doc).toMatch(/GOOGLE_CLIENT_SECRET/);
    expect(doc).toMatch(/NEXTAUTH_URL|AUTH_URL/);
    expect(doc).toMatch(/NOTION_OAUTH_CLIENT_ID/);
    expect(doc).toMatch(/NOTION_OAUTH_CLIENT_SECRET/);
    expect(doc).toMatch(/NOTION_OAUTH_REDIRECT_URI/);
    expect(doc).toMatch(/OAuth redirect URL/i);
    expect(doc).toMatch(/20260429123000_workbench_poc/);
    expect(doc).toMatch(/20260429150000_workbench_google_tokens/);
    expect(doc).toMatch(/20260429170000_workbench_notion_tokens/);
    expect(doc).toMatch(/20260429213000_workbench_run_history/);
    expect(doc).toMatch(/20260429214500_workbench_output_feedback/);
    expect(doc).toMatch(/Gmail[\s\S]*(forbidden|not allowed|blocker)/i);
    expect(doc).toMatch(/POC|proof-of-concept|demo/i);
    expect(doc).toMatch(/exposed secret|exposed credential|pasted into logs/i);
  });

  it("only mentions Gmail as a forbidden release blocker", () => {
    const doc = smokeChecklist();
    const gmailLines = doc
      .split("\n")
      .filter((line) => line.toLowerCase().includes("gmail"));

    expect(gmailLines).toHaveLength(1);
    expect(gmailLines[0]).toMatch(/forbidden/i);
    expect(gmailLines[0]).toMatch(/blocker/i);
  });
});
