import { getMondayConnectionStatus } from "./status";

export type MondayItemSummary = {
  itemId: string;
  boardId: string;
  groupId?: string;
  name: string;
  status?: string;
  owner?: string;
  dueDate?: string;
  lastUpdatedAt?: string;
  isBlocked?: boolean;
  url?: string;
  assignedToUser?: boolean;
  linkedActiveWork?: boolean;
  projectName?: string;
};

export type MondayItemLoadResult =
  | {
      status: "ok";
      items: MondayItemSummary[];
    }
  | {
      status: "empty";
      items: [];
    }
  | {
      status: "unavailable" | "error";
      reason: string;
      items: [];
    };

export async function loadRelevantMondayItems(input: {
  userId: string;
  now?: Date;
}): Promise<MondayItemLoadResult> {
  void input.now;

  const status = getMondayConnectionStatus({ userId: input.userId });
  if (!status.connected) {
    return {
      status: "unavailable",
      reason: status.configured ? "monday_disconnected" : "monday_not_configured",
      items: [],
    };
  }

  return { status: "empty", items: [] };
}
