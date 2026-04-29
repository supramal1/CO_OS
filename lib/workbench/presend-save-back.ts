import {
  createGoogleDriveUploader,
  saveWorkbenchArtifactToDrive,
  type GoogleDriveUploaderFactoryResult,
  type WorkbenchArtifact,
} from "./save-back";
import {
  getWorkbenchGoogleAccessToken,
  type WorkbenchGoogleTokenStore,
} from "./google-token";
import { createWorkbenchGoogleTokenStore } from "./google-token-store";
import type {
  WorkbenchPresendGoogleAccessTokenProvider,
  WorkbenchPresendGoogleAccessTokenProviderResult,
  WorkbenchPresendResult,
  WorkbenchPresendSaveBackResult,
} from "./presend-types";
import type { WorkbenchUserConfig } from "./retrieval/types";

export type RunWorkbenchPresendSaveBackInput = {
  result: WorkbenchPresendResult;
  userId: string;
  now?: Date;
  getUserConfig: (userId: string) => Promise<WorkbenchUserConfig | null>;
  googleAccessTokenProvider?: WorkbenchPresendGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  driveFetch?: typeof fetch;
  createDriveUploader?: (input: {
    accessToken?: string | null;
    driveFolderId?: string | null;
    fetch?: typeof fetch;
  }) => GoogleDriveUploaderFactoryResult;
};

export async function runWorkbenchPresendSaveBack(
  input: RunWorkbenchPresendSaveBackInput,
): Promise<WorkbenchPresendSaveBackResult> {
  if (!requiresDriveSaveBack(input.result)) {
    return {
      status: "skipped",
      target: "drive",
      reason: "drive_save_back_not_required",
    };
  }

  try {
    const config = await input.getUserConfig(input.userId);
    if (!config) {
      return {
        status: "unavailable",
        target: "drive",
        reason: "user_workbench_config_missing",
      };
    }

    const driveFolderId = config.drive_folder_id?.trim();
    if (!driveFolderId) {
      return {
        status: "unavailable",
        target: "drive",
        reason: "missing_drive_folder",
      };
    }

    const tokenProvider =
      input.googleAccessTokenProvider ??
      createDefaultGoogleAccessTokenProvider(input.googleTokenStore);
    const token = normalizeTokenResult(
      await tokenProvider({ userId: input.userId, now: input.now }),
    );
    if (!token.accessToken) {
      return {
        status: "unavailable",
        target: "drive",
        reason: token.reason ?? "missing_access_token",
      };
    }

    const uploaderResult = (input.createDriveUploader ?? createGoogleDriveUploader)({
      accessToken: token.accessToken,
      driveFolderId,
      fetch: input.driveFetch,
    });
    if (uploaderResult.status === "unavailable") {
      return {
        status: "unavailable",
        target: "drive",
        reason: uploaderResult.reason,
      };
    }

    const artifact = buildPresendDriveArtifact(input.result);
    const saved = await saveWorkbenchArtifactToDrive({
      artifact,
      driveFolderId,
      uploader: uploaderResult.uploader,
    });

    return {
      target: "drive",
      ...saved,
    };
  } catch (error) {
    return {
      status: "error",
      target: "drive",
      reason: "drive_upload_failed",
      message: errorMessage(error),
    };
  }
}

export function buildPresendDriveArtifact(
  result: WorkbenchPresendResult,
): WorkbenchArtifact {
  const slug = slugify(result.artifact_intent.title || "workbench-presend");
  return {
    id: `presend-${slug}`,
    name: `${slug}-presend.md`,
    mimeType: "text/markdown",
    content: buildPresendMarkdown(result),
    metadata: {
      artifactType: result.artifact_intent.artifact_type,
      format: result.artifact_spec.format,
      target: "drive",
    },
  };
}

function buildPresendMarkdown(result: WorkbenchPresendResult): string {
  const intent = result.artifact_intent;
  const spec = result.artifact_spec;
  const sections = spec.sections.length
    ? spec.sections.map((section) =>
        section.purpose
          ? `- ${section.heading}: ${section.purpose}`
          : `- ${section.heading}`,
      )
    : ["- None specified"];
  const sourceContext = spec.source_context.length
    ? spec.source_context.map((source) => {
        const url = source.source_url ? ` (${source.source_url})` : "";
        return `- [${source.source_type}] ${source.source_label}: ${source.claim}${url}`;
      })
    : ["- None supplied"];
  const qualityChecks = result.quality_checks.length
    ? result.quality_checks.map((check) =>
        check.detail
          ? `- ${check.status}: ${check.check} - ${check.detail}`
          : `- ${check.status}: ${check.check}`,
      )
    : ["- None supplied"];
  const warnings = result.warnings.length
    ? result.warnings.map((warning) => `- ${warning}`)
    : ["- None"];

  return [
    `# ${intent.title || "Workbench Presend"}`,
    "",
    "## Purpose",
    intent.purpose || "Not specified",
    "",
    "## Audience",
    intent.audience || "Not specified",
    "",
    "## Format",
    spec.format || "Not specified",
    "",
    "## Sections",
    ...sections,
    "",
    "## Source Context",
    ...sourceContext,
    "",
    "## Quality Checks",
    ...qualityChecks,
    "",
    "## Warnings",
    ...warnings,
    "",
  ].join("\n");
}

function requiresDriveSaveBack(result: WorkbenchPresendResult): boolean {
  return result.save_back_requirements.some(
    (requirement) => requirement.required && requirement.target === "drive",
  );
}

function createDefaultGoogleAccessTokenProvider(
  tokenStore?: WorkbenchGoogleTokenStore,
): WorkbenchPresendGoogleAccessTokenProvider {
  return async ({ userId, now }) => {
    const result = await getWorkbenchGoogleAccessToken({
      principalId: userId,
      now,
      tokenStore: tokenStore ?? createWorkbenchGoogleTokenStore(),
    });
    if (result.status === "available") {
      return { status: "available", accessToken: result.accessToken };
    }
    if (result.status === "unavailable") {
      return { status: "unavailable", reason: result.reason };
    }
    throw new Error(`${result.reason}: ${result.message}`);
  };
}

function normalizeTokenResult(
  result: WorkbenchPresendGoogleAccessTokenProviderResult,
): { accessToken: string | null; reason?: string } {
  if (typeof result === "string") return { accessToken: result.trim() || null };
  if (!result) return { accessToken: null };
  if (result.status === "unavailable") {
    return { accessToken: null, reason: result.reason };
  }
  return { accessToken: result.accessToken?.trim() || null };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workbench-presend";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
