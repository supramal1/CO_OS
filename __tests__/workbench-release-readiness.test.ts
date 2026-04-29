import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const smokeChecklist = () =>
  readFileSync(join(process.cwd(), "config/workbench-v1-smoke.md"), "utf8");

describe("Workbench V1 release readiness gate", () => {
  it("covers connector setup, disconnect, and setup-again idempotency", () => {
    const doc = smokeChecklist();

    expect(doc).toMatch(/setup/i);
    expect(doc).toMatch(/disconnect/i);
    expect(doc).toMatch(/setup-again|setup again/i);
    expect(doc).toMatch(/Notion[\s\S]*CO Workbench[\s\S]*Personal Profile[\s\S]*Working On[\s\S]*Patterns[\s\S]*References[\s\S]*Voice/i);
    expect(doc).toMatch(/Google Drive|Drive/i);
    expect(doc).toMatch(/duplicate active/i);
  });

  it("covers the staff ask, retrieval, save-back, history, and feedback path", () => {
    const doc = smokeChecklist();

    expect(doc).toMatch(/run an ask/i);
    expect(doc).toMatch(/retrieval status|source status/i);
    expect(doc).toMatch(/Drive artifact|Drive save-back|save-back/i);
    expect(doc).toMatch(/\/api\/workbench\/runs/);
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
});
