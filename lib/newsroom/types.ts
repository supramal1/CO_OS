export type NewsroomSource =
  | "cornerstone"
  | "notion"
  | "calendar"
  | "workbench"
  | "review"
  | "forge";

export type NewsroomConfidence = "high" | "medium" | "low";
export type NewsroomSection = "today" | "changedSinceYesterday" | "needsAttention";

export type NewsroomBrief = {
  userId: string;
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  today: NewsroomItem[];
  changedSinceYesterday: NewsroomItem[];
  needsAttention: NewsroomItem[];
  suggestedNextActions: NewsroomAction[];
  sourceStatuses: NewsroomSourceStatus[];
};

export type NewsroomItem = {
  id: string;
  title: string;
  reason: string;
  source: NewsroomSource;
  confidence: NewsroomConfidence;
  href?: string;
  action?: NewsroomAction;
};

export type NewsroomAction = {
  label: string;
  target: "workbench" | "review" | "notion" | "forge" | "calendar";
  href: string;
};

export type NewsroomSourceStatus = {
  source: NewsroomSource;
  status: "ok" | "empty" | "unavailable" | "error";
  reason?: string;
  itemsCount: number;
};

export type NewsroomSignal =
  | "meeting_today"
  | "review_unresolved"
  | "missing_evidence"
  | "missing_context"
  | "cross_source_match"
  | "changed_since_yesterday"
  | "human_decision"
  | "action_available"
  | "active_work"
  | "generic_update"
  | "low_confidence";

export type NewsroomCandidate = NewsroomItem & {
  section: NewsroomSection;
  signals: NewsroomSignal[];
  sourceRefs: string[];
};

export type NewsroomSourceSnapshot = {
  source: NewsroomSource;
  status: NewsroomSourceStatus;
  candidates: NewsroomCandidate[];
};

export type NewsroomAdapterContext = {
  userId: string;
  apiKey: string | null;
  now: Date;
  range: {
    from: Date;
    to: Date;
    since: Date;
  };
};

export type NewsroomAdapterLoad = (
  context: NewsroomAdapterContext,
) => Promise<NewsroomSourceSnapshot>;

export type NewsroomAdapter = {
  source: NewsroomSource;
  load: NewsroomAdapterLoad;
};

export type NewsroomAdapterInput = NewsroomAdapter | NewsroomAdapterLoad;

export type GenerateNewsroomBriefInput = {
  userId: string;
  apiKey?: string | null;
  now?: Date;
  adapters?: NewsroomAdapterInput[];
};
