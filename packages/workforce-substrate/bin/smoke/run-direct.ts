// Direct smoke driver. Bypasses the Cookbook prompt fetch and uses a small
// inline system prompt so we can verify the substrate runtime end-to-end
// without depending on team:ai-ops scope grants on Mal's principal.
//
// This file is NOT used by the production roster — agent prompts MUST load
// from Cookbook by skill name (per the locked architecture). It exists only
// to give us live-network verification of the runtime, Cornerstone tool
// dispatch, and the delegate_task recursion loop while the team:ai-ops grant
// is being sorted out.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_OPS_WORKSPACE,
  invokeAgent,
  newTask,
  ada,
  alan,
  donald,
  grace,
  margaret,
  type Agent,
  type TaskResult,
} from "../../src/index.js";
import { getRoster } from "../../src/roster.js";
import { createEventLog } from "../../src/event-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tiny scenario-specific prompt that gives the model just enough scaffolding
// to use the available tools sensibly. Production agents get their full
// system prompt from Cookbook.
function smokePromptFor(agent: Agent): string {
  const base = [
    `You are ${agent.name}, an AI Ops workforce agent at Charlie Oscar.`,
    `Slug: ${agent.id}. Reports to: ${agent.reportsTo ?? "(none — you are Lead)"}.`,
    "",
    "Available tools are defined in the API request. Use them when relevant.",
    "Respond with concise, structured output. No filler. No preamble.",
  ];
  if (agent.canDelegate) {
    base.push(
      "",
      "You are the Lead. Delegate specialist work via delegate_task — never self-handle research, hygiene, or implementation. After a child returns, synthesise their output into the final answer.",
    );
  }
  if (agent.id === "donald") {
    base.push(
      "",
      "You own Cornerstone hygiene. Use steward_inspect for analysis, steward_advise for recommendations. Do NOT call steward_apply (blocked in v0).",
    );
  }
  if (agent.id === "margaret") {
    base.push(
      "",
      "You research via web_search. Cite sources inline. Output a one-page-style brief with clear sections.",
    );
  }
  return base.join("\n");
}

interface Scenario {
  readonly name: string;
  readonly agent: Agent;
  readonly description: string;
  readonly targetWorkspace?: string;
  readonly maxTurns: number;
}

async function runScenario(
  scenario: Scenario,
  outDir: string,
): Promise<{ name: string; result: TaskResult }> {
  console.log("\n==========================================");
  console.log(`[smoke] scenario: ${scenario.name}`);
  console.log(`  agent: ${scenario.agent.id}`);
  console.log(`  task:  ${scenario.description.slice(0, 80)}${scenario.description.length > 80 ? "…" : ""}`);
  if (scenario.targetWorkspace) console.log(`  ws:    ${scenario.targetWorkspace}`);
  console.log("==========================================");

  const task = newTask({
    description: scenario.description,
    targetWorkspace: scenario.targetWorkspace ?? scenario.agent.defaultWorkspace ?? AI_OPS_WORKSPACE,
  });
  const eventLog = createEventLog(
    { taskId: task.id, agentId: scenario.agent.id },
    (e) => {
      if (
        e.type === "tool_called" ||
        e.type === "tool_returned" ||
        e.type === "delegate_initiated" ||
        e.type === "delegate_completed" ||
        e.type === "task_failed"
      ) {
        const summary: Record<string, unknown> = {
          ...e.payload,
          agent: e.agentId,
        };
        process.stderr.write(`[#${e.seq} ${e.type}] ${JSON.stringify(summary)}\n`);
      }
    },
  );

  const start = Date.now();
  const result = await invokeAgent(scenario.agent, task, {
    eventLog,
    roster: getRoster(),
    depth: 0,
    maxTurns: scenario.maxTurns,
    systemPromptLoader: async (skillName) => {
      const agent =
        [ada, alan, grace, margaret, donald].find((a) => a.systemPromptSkill === skillName) ??
        scenario.agent;
      return smokePromptFor(agent);
    },
  });

  console.log(
    `  exit=${result.status} cost=$${result.costUsd.toFixed(6)} duration=${result.durationMs}ms children=${result.children.length} (wall ${Date.now() - start}ms)`,
  );
  if (result.error) {
    console.log(`  error: ${result.error.code} — ${result.error.message}`);
  }
  if (result.output) {
    console.log("  --- output ---");
    console.log(result.output.split("\n").map((l) => `    ${l}`).join("\n"));
  }
  for (const child of result.children) {
    console.log(
      `  · child ${child.agentId}: ${child.status} ($${child.costUsd.toFixed(6)}, ${child.durationMs}ms)`,
    );
  }

  // Persist full result.
  const path = join(outDir, `${scenario.name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2));

  return { name: scenario.name, result };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(2);
  }
  if (!process.env.MEMORY_API_KEY && !process.env.CORNERSTONE_API_KEY) {
    console.error("MEMORY_API_KEY or CORNERSTONE_API_KEY required for Cornerstone tool dispatch");
    process.exit(2);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(__dirname, "results-direct", ts);
  mkdirSync(outDir, { recursive: true });
  console.log(`[smoke-direct] results → ${outDir}`);

  const scenarios: Scenario[] = [
    {
      name: "donald-solo",
      agent: donald,
      description:
        "Use list_facts to retrieve up to 5 facts from the aiops workspace. Then briefly summarise what you saw — count, any obvious duplicates, and one observation. Do NOT call steward_apply.",
      targetWorkspace: "aiops",
      maxTurns: 6,
    },
    {
      name: "ada-margaret",
      agent: ada,
      description:
        "Delegate to Margaret: in 2-3 sentences, summarise what the OpenAI Realtime API does as of April 2026 (use web_search). Then synthesise Margaret's reply into a one-paragraph answer for me.",
      targetWorkspace: "aiops",
      maxTurns: 4,
    },
    {
      name: "ada-donald-403",
      agent: ada,
      description:
        "Delegate to Donald: list any facts in the client-paid-media workspace (call list_facts there). Donald's principal will likely lack a grant for that workspace — when his tool returns a grant/permission error, surface it cleanly in your final answer (do not retry).",
      targetWorkspace: "client-paid-media",
      maxTurns: 4,
    },
  ];

  const results: { name: string; result: TaskResult }[] = [];
  for (const s of scenarios) {
    try {
      results.push(await runScenario(s, outDir));
    } catch (err) {
      console.error(`[smoke] scenario '${s.name}' threw:`, err);
    }
  }

  console.log("\n[smoke-direct] suite complete");
  for (const { name, result } of results) {
    console.log(
      `  ${name.padEnd(20)} ${result.status.padEnd(10)} cost=$${result.costUsd.toFixed(6)}  delegations=${result.children.length}`,
    );
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
