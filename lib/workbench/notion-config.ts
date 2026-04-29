export type WorkbenchNotionRuntimeConfig =
  | {
      status: "ready";
      apiToken: string;
      notionVersion: string;
    }
  | {
      status: "unavailable";
      reason: "notion_api_token_missing";
    };

export type WorkbenchNotionRuntimeEnv = {
  NOTION_API_TOKEN?: string | null;
  NOTION_VERSION?: string | null;
};

export function getWorkbenchNotionRuntimeConfig(
  env: WorkbenchNotionRuntimeEnv = getProcessEnv(),
): WorkbenchNotionRuntimeConfig {
  const apiToken = env.NOTION_API_TOKEN?.trim();
  if (!apiToken) {
    return {
      status: "unavailable",
      reason: "notion_api_token_missing",
    };
  }

  return {
    status: "ready",
    apiToken,
    notionVersion: env.NOTION_VERSION?.trim() || "2022-06-28",
  };
}

function getProcessEnv(): WorkbenchNotionRuntimeEnv {
  if (typeof process === "undefined") return {};
  return {
    NOTION_API_TOKEN: process.env.NOTION_API_TOKEN,
    NOTION_VERSION: process.env.NOTION_VERSION,
  };
}
