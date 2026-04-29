import type { WorkbenchRetrievedContext } from "../types";

export type WorkbenchRetrievalSource = "cornerstone" | "notion" | "calendar";

export type WorkbenchRetrievalStatus = {
  source: WorkbenchRetrievalSource;
  status: "ok" | "unavailable" | "error";
  reason?: string;
  items_count: number;
};

export type WorkbenchRetrievalAdapterResult = {
  items: WorkbenchRetrievedContext[];
  status: WorkbenchRetrievalStatus;
  warnings?: string[];
};

export type WorkbenchRetrievalSourceResult = {
  source: WorkbenchRetrievalSource;
  status: "available" | "unavailable" | "error";
  items: WorkbenchRetrievedContext[];
  warnings: string[];
};

export type WorkbenchRetrievalResult = {
  context: WorkbenchRetrievedContext[];
  statuses: WorkbenchRetrievalStatus[];
  sources: WorkbenchRetrievalSourceResult[];
  warnings: string[];
  generated_at: string;
};

export type WorkbenchUserConfig = {
  user_id: string;
  notion_parent_page_id: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  google_oauth_grant_status: string | null;
  google_oauth_scopes: string[] | null;
  voice_register: string | null;
  feedback_style: string | null;
  friction_tasks: string[] | null;
};

export function unavailableStatus(
  source: WorkbenchRetrievalSource,
  reason: string,
): WorkbenchRetrievalStatus {
  return { source, status: "unavailable", reason, items_count: 0 };
}

export function errorStatus(
  source: WorkbenchRetrievalSource,
  reason: string,
): WorkbenchRetrievalStatus {
  return { source, status: "error", reason, items_count: 0 };
}

export function okStatus(
  source: WorkbenchRetrievalSource,
  count: number,
): WorkbenchRetrievalStatus {
  return { source, status: "ok", items_count: count };
}
