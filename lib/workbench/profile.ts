import type {
  WorkbenchNotionContextItem,
  WorkbenchNotionKnowledgePage,
} from "./notion";
import type {
  WorkbenchProfileTargetPage,
  WorkbenchProfileUpdateRow,
} from "./learning";
import type { WorkbenchRetrievedContext } from "./types";
import type { WorkbenchUserConfig } from "./retrieval/types";

export type WorkbenchProfileSourceRef = {
  source: "notion" | "user_config" | "profile_update";
  label: string;
  url: string | null;
  page_title?: WorkbenchNotionKnowledgePage | WorkbenchProfileTargetPage;
  updated_at?: string | null;
};

export type WorkbenchProfileContext = {
  role: string | null;
  current_work: string[];
  communication_style: string | null;
  challenge_style: string | null;
  working_context: string[];
  do_not_assume: string[];
  source_refs: WorkbenchProfileSourceRef[];
  updated_at: string;
  warnings: string[];
  summary_text: string;
};

export type WorkbenchProfileConfig = Partial<WorkbenchUserConfig> & {
  updated_at?: string | null;
};

export type CompileWorkbenchProfileInput = {
  notionItems?: readonly WorkbenchProfileNotionItem[] | null;
  userConfig?: WorkbenchProfileConfig | null;
  profileUpdates?: readonly WorkbenchProfileUpdateRow[] | null;
  now?: Date;
};

type WorkbenchProfileNotionItem = WorkbenchRetrievedContext &
  Partial<WorkbenchNotionContextItem>;

type ProfileDraft = Omit<
  WorkbenchProfileContext,
  "role" | "communication_style" | "challenge_style" | "updated_at" | "summary_text"
> & {
  role: string[];
  communication_style: string[];
  challenge_style: string[];
  updatedCandidates: string[];
};

const MAX_FIELD_ITEMS = 8;
const MAX_TEXT_CHARS = 420;

export function compileWorkbenchProfile(
  input: CompileWorkbenchProfileInput,
): WorkbenchProfileContext {
  const draft: ProfileDraft = {
    role: [],
    current_work: [],
    communication_style: [],
    challenge_style: [],
    working_context: [],
    do_not_assume: [],
    source_refs: [],
    warnings: [],
    updatedCandidates: [],
  };

  const notionItems = [...(input.notionItems ?? [])].sort((a, b) =>
    notionPageSortKey(a).localeCompare(notionPageSortKey(b)),
  );
  if (notionItems.length === 0) {
    draft.warnings.push("notion_profile_context_missing");
  }
  for (const item of notionItems) {
    applyNotionItem(draft, item);
  }

  applyUserConfigFallback(draft, input.userConfig ?? null);

  const profileUpdates = [...(input.profileUpdates ?? [])]
    .filter(isWrittenProfileUpdate)
    .sort(compareProfileUpdates);
  if ((input.profileUpdates ?? []).length === 0) {
    draft.warnings.push("profile_update_rows_missing");
  }
  for (const update of profileUpdates) {
    applyProfileUpdate(draft, update);
  }

  const context: WorkbenchProfileContext = {
    role: firstOrNull(draft.role),
    current_work: limit(draft.current_work),
    communication_style: firstOrNull(draft.communication_style),
    challenge_style: firstOrNull(draft.challenge_style),
    working_context: limit(draft.working_context),
    do_not_assume: limit(draft.do_not_assume),
    source_refs: dedupeSourceRefs(draft.source_refs),
    updated_at:
      latestTimestamp(draft.updatedCandidates) ??
      (input.now ?? new Date()).toISOString(),
    warnings: [...new Set(draft.warnings)].sort(),
    summary_text: "",
  };
  context.summary_text = buildSummaryText(context);
  return context;
}

function applyNotionItem(
  draft: ProfileDraft,
  item: WorkbenchProfileNotionItem,
): void {
  const pageTitle = notionPageTitle(item);
  if (!pageTitle) {
    draft.warnings.push("notion_profile_page_title_missing");
    return;
  }

  const text = cleanBlock(item.metadata?.excerpt || item.excerpt || item.claim);
  if (!text) return;

  applyPageText(draft, pageTitle, text);
  draft.source_refs.push({
    source: "notion",
    label: item.source_label || `Notion: ${pageTitle}`,
    url: item.source_url ?? item.url ?? null,
    page_title: pageTitle,
  });
}

function notionPageTitle(
  item: WorkbenchProfileNotionItem,
): WorkbenchNotionKnowledgePage | null {
  const title = item.page_title ?? item.metadata?.page_title;
  return isWorkbenchNotionPage(title) ? title : null;
}

function notionPageSortKey(item: WorkbenchProfileNotionItem): string {
  return notionPageTitle(item) ?? item.source_label ?? item.claim;
}

function applyUserConfigFallback(
  draft: ProfileDraft,
  config: WorkbenchProfileConfig | null,
): void {
  if (!config) {
    draft.warnings.push("user_config_missing");
    return;
  }

  const voice = cleanText(config.voice_register);
  const feedback = cleanText(config.feedback_style);
  const frictionTasks = normalizeList(config.friction_tasks ?? []);

  if (voice && draft.communication_style.length === 0) {
    addUnique(draft.communication_style, voice);
  }
  if (feedback && draft.challenge_style.length === 0) {
    addUnique(draft.challenge_style, feedback);
  }
  for (const task of frictionTasks) {
    addUnique(draft.do_not_assume, `Friction task: ${task}`);
  }

  if (voice || feedback || frictionTasks.length > 0) {
    draft.source_refs.push({
      source: "user_config",
      label: "Workbench user config",
      url: null,
      updated_at: config.updated_at ?? null,
    });
    if (config.updated_at) draft.updatedCandidates.push(config.updated_at);
  }
}

function applyProfileUpdate(
  draft: ProfileDraft,
  update: WorkbenchProfileUpdateRow,
): void {
  const text = cleanBlock(update.candidate_text);
  if (!text) return;

  applyPageText(draft, update.target_page, text);
  draft.source_refs.push({
    source: "profile_update",
    label: `Profile update: ${update.target_page}`,
    url: null,
    page_title: update.target_page,
    updated_at: update.updated_at,
  });
  draft.updatedCandidates.push(update.updated_at, update.created_at);
}

function applyPageText(
  draft: ProfileDraft,
  page: WorkbenchNotionKnowledgePage | WorkbenchProfileTargetPage,
  text: string,
): void {
  const labelled = extractLabelledValues(text);
  addAll(draft.role, labelled.role);
  addAll(draft.current_work, labelled.current_work);
  addAll(draft.communication_style, labelled.communication_style);
  addAll(draft.challenge_style, labelled.challenge_style);
  addAll(draft.working_context, labelled.working_context);
  addAll(draft.do_not_assume, labelled.do_not_assume);

  const unlabelled = stripLabelledLines(text);
  if (!unlabelled) return;

  if (page === "Working On") addUnique(draft.current_work, unlabelled);
  if (page === "Voice") addUnique(draft.communication_style, unlabelled);
  if (page === "Patterns" || page === "References") {
    addUnique(draft.working_context, unlabelled);
  }
  if (page === "Personal Profile") addUnique(draft.working_context, unlabelled);
}

function extractLabelledValues(text: string): Record<
  | "role"
  | "current_work"
  | "communication_style"
  | "challenge_style"
  | "working_context"
  | "do_not_assume",
  string[]
> {
  const values = {
    role: [] as string[],
    current_work: [] as string[],
    communication_style: [] as string[],
    challenge_style: [] as string[],
    working_context: [] as string[],
    do_not_assume: [] as string[],
  };

  for (const line of text.split(/\n| • /)) {
    const match = line
      .replace(/^[-*]\s*/, "")
      .match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    const value = cleanText(match[2]);
    if (!value) continue;
    if (key === "role" || key === "title") addUnique(values.role, value);
    if (key === "current_work" || key === "working_on") {
      addUnique(values.current_work, value);
    }
    if (key === "communication_style" || key === "voice") {
      addUnique(values.communication_style, value);
    }
    if (key === "challenge_style" || key === "feedback_style") {
      addUnique(values.challenge_style, value);
    }
    if (key === "working_context" || key === "context") {
      addUnique(values.working_context, value);
    }
    if (
      key === "do_not_assume" ||
      key === "dont_assume" ||
      key === "do_not"
    ) {
      addUnique(values.do_not_assume, value);
    }
  }

  return values;
}

function stripLabelledLines(text: string): string {
  return cleanText(
    text
      .split(/\n| • /)
      .filter((line) => !/^[-*]?\s*[^:]{2,40}:\s*\S/.test(line))
      .join(" "),
  );
}

function isWorkbenchNotionPage(
  value: unknown,
): value is WorkbenchNotionKnowledgePage {
  return (
    value === "Personal Profile" ||
    value === "Working On" ||
    value === "Patterns" ||
    value === "References" ||
    value === "Voice"
  );
}

function isWrittenProfileUpdate(row: WorkbenchProfileUpdateRow): boolean {
  return row.status === "written" && !row.undone_at && !row.undo_of_update_id;
}

function compareProfileUpdates(
  a: WorkbenchProfileUpdateRow,
  b: WorkbenchProfileUpdateRow,
): number {
  const created = a.created_at.localeCompare(b.created_at);
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

function buildSummaryText(context: WorkbenchProfileContext): string {
  const lines = [
    context.role ? `Role: ${context.role}` : null,
    context.current_work.length
      ? `Current work: ${context.current_work.join("; ")}`
      : null,
    context.communication_style
      ? `Communication style: ${context.communication_style}`
      : null,
    context.challenge_style ? `Challenge style: ${context.challenge_style}` : null,
    context.working_context.length
      ? `Working context: ${context.working_context.join("; ")}`
      : null,
    context.do_not_assume.length
      ? `Do not assume: ${context.do_not_assume.join("; ")}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function cleanBlock(value: unknown): string {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|csk|ntn|ghp|gho)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z]+(?:-[A-Za-z0-9]+){2,}\b/g, "[id]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{13,}\b/gi, "[id]");
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeList(values: readonly unknown[]): string[] {
  return values
    .map(cleanText)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function addAll(target: string[], values: readonly string[]): void {
  for (const value of values) addUnique(target, value);
}

function addUnique(target: string[], value: string): void {
  const normalized = cleanText(value);
  if (normalized && !target.includes(normalized)) target.push(normalized);
}

function firstOrNull(values: readonly string[]): string | null {
  return values[0] ?? null;
}

function limit(values: readonly string[]): string[] {
  return values.slice(0, MAX_FIELD_ITEMS);
}

function latestTimestamp(values: readonly string[]): string | null {
  const valid = values
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort((a, b) => b.localeCompare(a));
  return valid[0] ?? null;
}

function dedupeSourceRefs(
  refs: readonly WorkbenchProfileSourceRef[],
): WorkbenchProfileSourceRef[] {
  const seen = new Set<string>();
  const deduped: WorkbenchProfileSourceRef[] = [];
  for (const ref of refs) {
    const key = [
      ref.source,
      ref.label,
      ref.url ?? "",
      ref.page_title ?? "",
      ref.updated_at ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}
