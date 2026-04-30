export const WORKBENCH_GOOGLE_CONNECTOR_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const WORKBENCH_GOOGLE_SIGN_IN_SCOPES = [
  "openid",
  "email",
  "profile",
  ...WORKBENCH_GOOGLE_CONNECTOR_SCOPES,
] as const;

export const WORKBENCH_GOOGLE_OAUTH_SCOPE =
  WORKBENCH_GOOGLE_SIGN_IN_SCOPES.join(" ");

export type WorkbenchGoogleGrantStatus =
  | "pending"
  | "granted"
  | "revoked"
  | "error"
  | string;

export type WorkbenchGoogleAuthConfig = {
  google_oauth_grant_status: WorkbenchGoogleGrantStatus | null;
  google_oauth_scopes: string[] | null;
};

export type WorkbenchGoogleAuthReadinessStatus =
  | "ready"
  | "unauthenticated"
  | "config_unavailable"
  | "config_missing"
  | "grant_missing"
  | "scope_missing"
  | "token_lookup_unavailable"
  | "token_missing";

export type WorkbenchGoogleAuthReadiness = {
  ready: boolean;
  status: WorkbenchGoogleAuthReadinessStatus;
  required_scopes: string[];
  granted_scopes: string[];
  missing_scopes: string[];
  blockers: string[];
};

export function assessWorkbenchGoogleAuthReadiness(input: {
  principalId: string | null | undefined;
  config: WorkbenchGoogleAuthConfig | null | undefined;
  configAvailable?: boolean;
  storedTokenPresent?: boolean;
  tokenPersistencePresent?: boolean;
  tokenLookupAvailable?: boolean;
}): WorkbenchGoogleAuthReadiness {
  const requiredScopes = [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES];
  const grantedScopes = [...new Set(input.config?.google_oauth_scopes ?? [])];
  const missingScopes = requiredScopes.filter(
    (scope) => !grantedScopes.includes(scope),
  );
  const storedTokenPresent =
    input.storedTokenPresent ?? input.tokenPersistencePresent;

  if (!input.principalId) {
    return {
      ready: false,
      status: "unauthenticated",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: missingScopes,
      blockers: ["missing_authenticated_principal"],
    };
  }

  if (input.configAvailable === false) {
    return {
      ready: false,
      status: "config_unavailable",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: missingScopes,
      blockers: ["workbench_config_unavailable"],
    };
  }

  if (!input.config) {
    return {
      ready: false,
      status: "config_missing",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: missingScopes,
      blockers: ["workbench_google_config_missing"],
    };
  }

  if (input.config?.google_oauth_grant_status !== "granted") {
    return {
      ready: false,
      status: "grant_missing",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: missingScopes,
      blockers: ["google_oauth_grant_missing"],
    };
  }

  if (missingScopes.length > 0) {
    return {
      ready: false,
      status: "scope_missing",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: missingScopes,
      blockers: ["google_oauth_scope_missing"],
    };
  }

  if (input.tokenLookupAvailable === false) {
    return {
      ready: false,
      status: "token_lookup_unavailable",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: [],
      blockers: ["google_token_lookup_unavailable"],
    };
  }

  if (!storedTokenPresent) {
    return {
      ready: false,
      status: "token_missing",
      required_scopes: requiredScopes,
      granted_scopes: grantedScopes,
      missing_scopes: [],
      blockers: ["google_stored_token_missing"],
    };
  }

  return {
    ready: true,
    status: "ready",
    required_scopes: requiredScopes,
    granted_scopes: grantedScopes,
    missing_scopes: [],
    blockers: [],
  };
}

export async function getWorkbenchGoogleAuthReadiness(
  principalId: string | null | undefined,
): Promise<WorkbenchGoogleAuthReadiness> {
  if (!principalId) {
    return assessWorkbenchGoogleAuthReadiness({
      principalId,
      config: null,
      storedTokenPresent: false,
    });
  }

  const { getWorkbenchSupabase } = await import("./supabase");
  const sb = getWorkbenchSupabase();
  if (!sb) {
    return assessWorkbenchGoogleAuthReadiness({
      principalId,
      config: null,
      configAvailable: false,
      storedTokenPresent: false,
    });
  }

  const { data, error } = await sb
    .from("user_workbench_config")
    .select("google_oauth_grant_status, google_oauth_scopes")
    .eq("user_id", principalId)
    .maybeSingle();

  if (error) {
    console.warn("[workbench] Google auth readiness lookup failed:", error.message);
    return assessWorkbenchGoogleAuthReadiness({
      principalId,
      config: null,
      configAvailable: false,
      storedTokenPresent: false,
    });
  }

  const config = data as WorkbenchGoogleAuthConfig | null;
  const configReadiness = assessWorkbenchGoogleAuthReadiness({
    principalId,
    config,
    storedTokenPresent: true,
  });
  if (!configReadiness.ready) return configReadiness;

  const { hasStoredWorkbenchGoogleToken } = await import("./google-token-store");
  const tokenCheck = await hasStoredWorkbenchGoogleToken(principalId);
  if (tokenCheck.status === "error") {
    console.warn(
      "[workbench] Google token persistence lookup failed:",
      tokenCheck.message,
    );
  }

  return assessWorkbenchGoogleAuthReadiness({
    principalId,
    config,
    storedTokenPresent:
      tokenCheck.status === "available" ? tokenCheck.present : false,
    tokenLookupAvailable: tokenCheck.status === "available",
  });
}
