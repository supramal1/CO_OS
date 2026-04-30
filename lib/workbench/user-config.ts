import { getWorkbenchGoogleAuthReadiness } from "./google-auth";
import { getWorkbenchSupabase } from "./supabase";

type SupabaseWriteResult<T> = PromiseLike<{
  data: T | null;
  error: { message?: string } | null;
}>;

type SupabaseMaybeSingleResult<T> = PromiseLike<{
  data: T | null;
  error: { message?: string } | null;
}>;

type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): SupabaseMaybeSingleResult<WorkbenchUserConfig>;
      };
    };
    upsert(
      payload: WorkbenchUserConfigPayload | WorkbenchUserConfigPatchPayload,
      options: { onConflict: string },
    ): {
      select(columns: string): {
        single(): SupabaseWriteResult<WorkbenchUserConfig>;
      };
    };
  };
};

export type WorkbenchUserConfig = {
  user_id: string;
  notion_parent_page_id: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  google_oauth_grant_status?: string | null;
  google_oauth_scopes?: string[] | null;
  voice_register?: string | null;
  feedback_style?: string | null;
  friction_tasks?: string[] | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkbenchUserConfigInput = {
  notion_parent_page_id?: unknown;
  drive_folder_id?: unknown;
  drive_folder_url?: unknown;
  voice_register?: unknown;
  feedback_style?: unknown;
  friction_tasks?: unknown;
};

type WorkbenchUserConfigPayload = {
  user_id: string;
  notion_parent_page_id: string;
  drive_folder_id: string;
  drive_folder_url: string;
  voice_register: string | null;
  feedback_style: string | null;
  friction_tasks: string[] | null;
};

export type WorkbenchUserConfigPatchInput = {
  notion_parent_page_id?: string | null;
  drive_folder_id?: string | null;
  drive_folder_url?: string | null;
  google_oauth_grant_status?: string | null;
  google_oauth_scopes?: string[] | null;
  voice_register?: string | null;
  feedback_style?: string | null;
  friction_tasks?: string[] | null;
};

type WorkbenchUserConfigPatchPayload = WorkbenchUserConfigPatchInput & {
  user_id: string;
  updated_at: string;
};

export type WorkbenchConfigResult =
  | {
      status: "ok";
      config: WorkbenchUserConfig | null;
      google_readiness: Awaited<ReturnType<typeof getWorkbenchGoogleAuthReadiness>>;
    }
  | { status: "unavailable"; error: "workbench_config_unavailable" }
  | { status: "error"; error: "workbench_config_failed"; detail: string };

export type WorkbenchConfigValidationResult =
  | { ok: true; payload: Omit<WorkbenchUserConfigPayload, "user_id"> }
  | {
      ok: false;
      error: "invalid_workbench_config";
      required: ["notion_parent_page_id", "drive_folder_id", "drive_folder_url"];
    };
export type WorkbenchConfigValidationError = Extract<
  WorkbenchConfigValidationResult,
  { ok: false }
>;

export async function getWorkbenchUserConfig(
  principalId: string,
): Promise<WorkbenchConfigResult> {
  const sb = getWorkbenchConfigSupabase();
  if (!sb) return { status: "unavailable", error: "workbench_config_unavailable" };

  const { data, error } = await sb
    .from("user_workbench_config")
    .select("*")
    .eq("user_id", principalId)
    .maybeSingle();

  if (error) {
    return {
      status: "error",
      error: "workbench_config_failed",
      detail: error.message ?? "Unknown Workbench config lookup error.",
    };
  }

  const google_readiness = await getWorkbenchGoogleAuthReadiness(principalId);
  return { status: "ok", config: data, google_readiness };
}

export async function saveWorkbenchUserConfig(
  principalId: string,
  input: WorkbenchUserConfigInput,
): Promise<WorkbenchConfigResult | WorkbenchConfigValidationError> {
  const parsed = parseWorkbenchUserConfigInput(input);
  if (!parsed.ok) return parsed;

  const sb = getWorkbenchConfigSupabase();
  if (!sb) return { status: "unavailable", error: "workbench_config_unavailable" };

  const { data, error } = await sb
    .from("user_workbench_config")
    .upsert(
      {
        user_id: principalId,
        ...parsed.payload,
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (error) {
    return {
      status: "error",
      error: "workbench_config_failed",
      detail: error.message ?? "Unknown Workbench config save error.",
    };
  }

  const google_readiness = await getWorkbenchGoogleAuthReadiness(principalId);
  return { status: "ok", config: data, google_readiness };
}

export async function patchWorkbenchUserConfig(
  principalId: string,
  patch: WorkbenchUserConfigPatchInput,
): Promise<WorkbenchConfigResult> {
  const sb = getWorkbenchConfigSupabase();
  if (!sb) return { status: "unavailable", error: "workbench_config_unavailable" };

  const { data, error } = await sb
    .from("user_workbench_config")
    .upsert(
      {
        user_id: principalId,
        ...normalizeWorkbenchConfigPatch(patch),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (error) {
    return {
      status: "error",
      error: "workbench_config_failed",
      detail: error.message ?? "Unknown Workbench config patch error.",
    };
  }

  const google_readiness = await getWorkbenchGoogleAuthReadiness(principalId);
  return { status: "ok", config: data, google_readiness };
}

export function parseWorkbenchUserConfigInput(
  input: WorkbenchUserConfigInput,
): WorkbenchConfigValidationResult {
  const notionParentPageId = requiredString(input.notion_parent_page_id);
  const driveFolderId = requiredString(input.drive_folder_id);
  const driveFolderUrl = requiredString(input.drive_folder_url);

  if (!notionParentPageId || !driveFolderId || !driveFolderUrl) {
    return {
      ok: false,
      error: "invalid_workbench_config",
      required: [
        "notion_parent_page_id",
        "drive_folder_id",
        "drive_folder_url",
      ],
    };
  }

  return {
    ok: true,
    payload: {
      notion_parent_page_id: notionParentPageId,
      drive_folder_id: driveFolderId,
      drive_folder_url: driveFolderUrl,
      voice_register: optionalString(input.voice_register),
      feedback_style: optionalString(input.feedback_style),
      friction_tasks: optionalStringArray(input.friction_tasks),
    },
  };
}

function getWorkbenchConfigSupabase(): SupabaseLike | null {
  return getWorkbenchSupabase() as unknown as SupabaseLike | null;
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length > 0 ? strings : null;
}

function normalizeWorkbenchConfigPatch(
  input: WorkbenchUserConfigPatchInput,
): Omit<WorkbenchUserConfigPatchPayload, "user_id" | "updated_at"> {
  const patch: Omit<WorkbenchUserConfigPatchPayload, "user_id" | "updated_at"> =
    {};

  if ("notion_parent_page_id" in input) {
    patch.notion_parent_page_id = nullableString(input.notion_parent_page_id);
  }
  if ("drive_folder_id" in input) {
    patch.drive_folder_id = nullableString(input.drive_folder_id);
  }
  if ("drive_folder_url" in input) {
    patch.drive_folder_url = nullableString(input.drive_folder_url);
  }
  if ("google_oauth_grant_status" in input) {
    patch.google_oauth_grant_status = nullableString(
      input.google_oauth_grant_status,
    );
  }
  if ("google_oauth_scopes" in input) {
    patch.google_oauth_scopes = Array.isArray(input.google_oauth_scopes)
      ? [
          ...new Set(
            input.google_oauth_scopes
              .map((scope) => scope.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  }
  if ("voice_register" in input) {
    patch.voice_register = nullableString(input.voice_register);
  }
  if ("feedback_style" in input) {
    patch.feedback_style = nullableString(input.feedback_style);
  }
  if ("friction_tasks" in input) {
    patch.friction_tasks = Array.isArray(input.friction_tasks)
      ? [
          ...new Set(
            input.friction_tasks
              .map((task) => task.trim())
              .filter(Boolean),
          ),
        ]
      : null;
  }

  return patch;
}

function nullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
