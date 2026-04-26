#!/usr/bin/env bash
# CO Workforce Substrate v0 — smoke suite.
#
# Three real-service scenarios per the sprint brief Phase 8:
#  1. Donald solo audit (Cornerstone read/write to aiops workspace)
#  2. Ada delegates to Margaret (delegate_task + web_search)
#  3. Ada delegates to Donald with cross-workspace ask (expects graceful
#     403/grant-missing handling, not crash)
#
# Usage: bin/smoke/run-all.sh
# Requires: ANTHROPIC_API_KEY + MEMORY_API_KEY in env, or co-os/.env.local
# present and readable. Outputs to bin/smoke/results/<timestamp>/.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBSTRATE_DIR="$(cd "$PKG_DIR/.." && pwd)"
COOS_DIR="$(cd "$SUBSTRATE_DIR/../.." && pwd)"
RESULTS_ROOT="$SUBSTRATE_DIR/bin/smoke/results"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_DIR="$RESULTS_ROOT/$TS"
mkdir -p "$RESULTS_DIR"

# ---- Load env from .env.local (authoritative for the smoke run) ----
# We always source .env.local when it exists, even if Cornerstone keys are
# already in the parent shell. Sticky exports from prior sessions can hold
# stale csk_* keys that point at principals without the team:ai-ops grant,
# which produces a confusing "skill_out_of_scope" failure several layers
# down. Smoke results must be reproducible from the file on disk.
if [[ -f "$COOS_DIR/.env.local" ]]; then
  echo "[smoke] sourcing $COOS_DIR/.env.local (overrides sticky shell env)"
  set -a
  # shellcheck disable=SC1091
  source "$COOS_DIR/.env.local"
  set +a
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "[smoke] FATAL: ANTHROPIC_API_KEY not set" >&2
  exit 2
fi
if [[ -z "${CORNERSTONE_API_KEY:-}" && -z "${MEMORY_API_KEY:-}" ]]; then
  echo "[smoke] FATAL: CORNERSTONE_API_KEY or MEMORY_API_KEY required" >&2
  exit 2
fi

echo "[smoke] results → $RESULTS_DIR"

run_scenario() {
  local name="$1"
  local agent="$2"
  local task="$3"
  shift 3
  local extra_flags=("$@")
  local out="$RESULTS_DIR/$name.json"
  local err="$RESULTS_DIR/$name.err.log"
  echo
  echo "=========================================="
  echo "[smoke] scenario: $name"
  echo "  agent: $agent"
  echo "  task:  $task"
  echo "  flags: ${extra_flags[*]:-}"
  echo "=========================================="
  set +e
  npx tsx "$SUBSTRATE_DIR/bin/invoke.ts" "$agent" "$task" \
    --output=json --max-turns=8 "${extra_flags[@]}" \
    >"$out" 2>"$err"
  local code=$?
  set -e
  echo "  exit: $code"
  echo "  json: $out"
  echo "  log:  $err"
  if [[ -s "$out" ]]; then
    # Print summary line if JSON parses.
    node -e 'try { const r = JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(`  status=${r.status} cost=$${(r.costUsd ?? 0).toFixed(6)} duration=${r.durationMs}ms children=${(r.children||[]).length}`); if (r.error) console.log(`  error=${r.error.code}: ${r.error.message}`); } catch (e) { console.log("  (no JSON parsed)"); }' "$out"
  fi
}

# ---- Scenario 1: Donald solo audit ----
run_scenario donald-solo donald \
  "Audit the aiops workspace for duplicate facts. Use steward_inspect with operation=duplicate_groups to find candidates, then steward_advise to surface the top 3 dedup recommendations. Do NOT call steward_apply — return your findings as a short report." \
  --target-workspace=aiops

# ---- Scenario 2: Ada delegates to Margaret ----
run_scenario ada-margaret ada \
  "Research the current state of the OpenAI Realtime API as of April 2026 and produce a one-page brief covering: (a) current capabilities, (b) pricing, (c) one production use case. Delegate the research itself to Margaret; you synthesise her output into the final brief." \
  --target-workspace=aiops

# ---- Scenario 3: Ada delegates to Donald with cross-workspace ask ----
run_scenario ada-donald-403 ada \
  "Audit the client-paid-media workspace for duplicate facts. Delegate this to Donald with targetWorkspace=client-paid-media. If Donald's tools return a grant/permissions error, surface it cleanly in your final response — do not retry blindly." \
  --target-workspace=client-paid-media

echo
echo "[smoke] suite complete — review $RESULTS_DIR"
