export type MondayConnectionState =
  | "not_configured"
  | "disconnected"
  | "connected";

export type MondayConnectionStatus = {
  source: "monday";
  state: MondayConnectionState;
  connected: boolean;
  configured: boolean;
  message: string;
  actionLabel: "Set up" | "Connect" | "View";
  nextUrl?: string;
  mondayUserId?: string;
  mondayAccountId?: string;
};

export function getMondayConnectionStatus(input: {
  userId: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, "MONDAY_CLIENT_ID" | "MONDAY_CLIENT_SECRET">>;
}): MondayConnectionStatus {
  const env = input.env ?? process.env;
  const configured = Boolean(env.MONDAY_CLIENT_ID && env.MONDAY_CLIENT_SECRET);

  if (!configured) {
    return {
      source: "monday",
      state: "not_configured",
      connected: false,
      configured: false,
      message: "monday connector is not configured yet.",
      actionLabel: "Set up",
      nextUrl: "/profile",
    };
  }

  return {
    source: "monday",
    state: "disconnected",
    connected: false,
    configured: true,
    message: "monday is ready to connect. Identity confirmation comes next.",
    actionLabel: "Connect",
    nextUrl: "/profile",
  };
}
