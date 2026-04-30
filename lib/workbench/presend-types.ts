import type {
  WorkbenchInvocationLogRow,
  WorkbenchPreflightResult,
  WorkbenchRetrievedContext,
} from "./types";
import type {
  GoogleDriveUploaderFactoryResult,
  WorkbenchSaveBackResult,
} from "./save-back";
import type { WorkbenchUserConfig } from "./retrieval/types";
import type { WorkbenchGoogleTokenStore } from "./google-token";

export type WorkbenchPresendArtifactIntent = {
  artifact_type: string;
  title: string;
  audience: string | null;
  purpose: string;
};

export type WorkbenchPresendSection = {
  heading: string;
  purpose: string | null;
};

export type WorkbenchPresendArtifactSpec = {
  format: string;
  sections: WorkbenchPresendSection[];
  source_context: WorkbenchRetrievedContext[];
};

export type WorkbenchPresendQualityCheck = {
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string | null;
};

export type WorkbenchPresendSaveBackRequirement = {
  target: "drive" | "notion" | "calendar" | "none" | string;
  action: string;
  required: boolean;
  reason: string | null;
};

export type WorkbenchPresendResult = {
  artifact_intent: WorkbenchPresendArtifactIntent;
  artifact_spec: WorkbenchPresendArtifactSpec;
  quality_checks: WorkbenchPresendQualityCheck[];
  save_back_requirements: WorkbenchPresendSaveBackRequirement[];
  warnings: string[];
};

export type WorkbenchPresendReviewedArtifact = {
  artifact_type: string | null;
  title: string | null;
  review_status: string | null;
  source_count: number;
  destination: string;
};

export type BuildPresendPromptInput = {
  preflightResult: WorkbenchPreflightResult | Record<string, unknown>;
  draftInput?: string | null;
  artifactSpecInput?: string | null;
};

export type RunWorkbenchPresendInput = {
  preflightResult: WorkbenchPreflightResult | Record<string, unknown>;
  draftInput?: string | null;
  artifactSpecInput?: string | null;
  userId: string;
  apiKey: string;
  anthropicApiKey: string;
  reviewedArtifact?: WorkbenchPresendReviewedArtifact | null;
  now?: Date;
  getUserConfig?: (userId: string) => Promise<WorkbenchUserConfig | null>;
  googleAccessTokenProvider?: WorkbenchPresendGoogleAccessTokenProvider;
  googleTokenStore?: WorkbenchGoogleTokenStore;
  driveFetch?: typeof fetch;
  createDriveUploader?: (input: {
    accessToken?: string | null;
    driveFolderId?: string | null;
    fetch?: typeof fetch;
  }) => GoogleDriveUploaderFactoryResult;
};

export type WorkbenchPresendInvocationLogRow = Omit<
  WorkbenchInvocationLogRow,
  "invocation_type"
> & {
  invocation_type: "presend";
};

export type WorkbenchPresendResponse = {
  result: WorkbenchPresendResult;
  invocation: WorkbenchPresendInvocationLogRow;
  save_back: WorkbenchPresendSaveBackResult;
};

export type WorkbenchPresendGoogleAccessTokenProviderResult =
  | string
  | null
  | undefined
  | {
      status: "available";
      accessToken?: string | null;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type WorkbenchPresendGoogleAccessTokenProvider = (input: {
  userId: string;
  now?: Date;
}) => Promise<WorkbenchPresendGoogleAccessTokenProviderResult>;

export type WorkbenchPresendSaveBackResult = {
  artifact?: WorkbenchPresendReviewedArtifact;
} & (
  | {
      status: "skipped";
      target: "drive";
      reason: "drive_save_back_not_required";
    }
  | ({
      target: "drive";
    } & WorkbenchSaveBackResult)
  | {
      status: "unavailable";
      target: "drive";
      reason:
        | "user_workbench_config_missing"
        | "missing_drive_folder"
        | "missing_drive_uploader"
        | "missing_access_token"
        | string;
    }
  | {
      status: "error";
      target: "drive";
      reason:
        | "google_access_token_error"
        | "drive_upload_failed"
        | "drive_save_back_failed";
      message: string;
    }
);
