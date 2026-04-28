import { describe, expect, it } from "vitest";
import { fetchActiveRunRowsForTasks } from "@/lib/agents-run-rows-client";

describe("fetchActiveRunRowsForTasks", () => {
  it("queries only columns present on the production forge_task_runs schema", async () => {
    const sb = new FakeSupabaseClient();

    await fetchActiveRunRowsForTasks(sb as never, ["task-1", "task-1", "task-2"]);

    expect(sb.selects).toEqual([
      "id, task_id, status, run_type, stage, started_at, created_at",
    ]);
    expect(sb.filters).toEqual([
      ["eq", "status", "running"],
      ["in", "task_id", ["task-1", "task-2"]],
      ["limit", 50],
    ]);
  });
});

class FakeSupabaseClient {
  selects: string[] = [];
  filters: unknown[][] = [];

  from(table: string) {
    expect(table).toBe("forge_task_runs");
    return new FakeQuery(this);
  }
}

class FakeQuery {
  constructor(private readonly client: FakeSupabaseClient) {}

  select(columns: string) {
    this.client.selects.push(columns);
    return this;
  }

  eq(column: string, value: unknown) {
    this.client.filters.push(["eq", column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.client.filters.push(["in", column, values]);
    return this;
  }

  async limit(value: number) {
    this.client.filters.push(["limit", value]);
    return { data: [], error: null };
  }
}
