import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_GOOGLE_CONNECTOR_SCOPES,
  WORKBENCH_GOOGLE_OAUTH_SCOPE,
  assessWorkbenchGoogleAuthReadiness,
  getWorkbenchGoogleAuthReadiness,
} from "@/lib/workbench/google-auth";

const mocks = vi.hoisted(() => ({
  getWorkbenchSupabase: vi.fn(),
  hasStoredWorkbenchGoogleToken: vi.fn(),
  persistWorkbenchGoogleTokens: vi.fn(),
  ensureWorkbenchDriveSetup: vi.fn(),
  nextAuth: vi.fn((config: unknown) => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    config,
  })),
  checkAdminCapability: vi.fn(),
  hasPendingInvitation: vi.fn(),
  resolveEmailToPrincipal: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: unknown) => mocks.nextAuth(config),
}));

vi.mock("next-auth/providers/google", () => ({
  default: (options: unknown) => ({ id: "google", options }),
}));

vi.mock("@/lib/cornerstone", () => ({
  checkAdminCapability: (...args: unknown[]) =>
    mocks.checkAdminCapability(...args),
  hasPendingInvitation: (...args: unknown[]) => mocks.hasPendingInvitation(...args),
  resolveEmailToPrincipal: (...args: unknown[]) =>
    mocks.resolveEmailToPrincipal(...args),
}));

vi.mock("@/lib/workbench/supabase", () => ({
  getWorkbenchSupabase: () => mocks.getWorkbenchSupabase(),
}));

vi.mock("@/lib/workbench/google-token-store", () => ({
  hasStoredWorkbenchGoogleToken: (...args: unknown[]) =>
    mocks.hasStoredWorkbenchGoogleToken(...args),
  persistWorkbenchGoogleTokens: (...args: unknown[]) =>
    mocks.persistWorkbenchGoogleTokens(...args),
}));

vi.mock("@/lib/workbench/google-drive-setup", () => ({
  ensureWorkbenchDriveSetup: (...args: unknown[]) =>
    mocks.ensureWorkbenchDriveSetup(...args),
}));

function createConfigSupabaseDouble(config: unknown) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: config, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("Workbench Google auth foundation", () => {
  beforeEach(() => {
    mocks.getWorkbenchSupabase.mockReset();
    mocks.hasStoredWorkbenchGoogleToken.mockReset();
    mocks.persistWorkbenchGoogleTokens.mockReset();
    mocks.ensureWorkbenchDriveSetup.mockReset();
    mocks.nextAuth.mockClear();
    mocks.checkAdminCapability.mockReset();
    mocks.hasPendingInvitation.mockReset();
    mocks.resolveEmailToPrincipal.mockReset();
  });

  it("defines only the V1 Google connector scopes", () => {
    expect(WORKBENCH_GOOGLE_CONNECTOR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(WORKBENCH_GOOGLE_OAUTH_SCOPE).toContain("openid");
    expect(WORKBENCH_GOOGLE_OAUTH_SCOPE).not.toContain(["g", "mail"].join(""));
  });

  it("requires an authenticated co-os principal", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: null,
      config: null,
      storedTokenPresent: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("unauthenticated");
    expect(readiness.blockers).toContain("missing_authenticated_principal");
  });

  it("reports missing scopes from user_workbench_config", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: "principal_123",
      config: {
        google_oauth_grant_status: "granted",
        google_oauth_scopes: ["https://www.googleapis.com/auth/drive.file"],
      },
      storedTokenPresent: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("scope_missing");
    expect(readiness.missing_scopes).toEqual([
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
  });

  it("blocks all-scopes grants when the specific user has no stored token", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: "principal_123",
      config: {
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
      },
      storedTokenPresent: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("token_missing");
    expect(readiness.blockers).toContain("google_stored_token_missing");
  });

  it("marks Google connectors ready when grant, scopes, and stored token are present", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: "principal_123",
      config: {
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
      },
      storedTokenPresent: true,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.status).toBe("ready");
    expect(readiness.blockers).toEqual([]);
  });

  it("degrades clearly when Workbench config has no Google grant row", () => {
    const readiness = assessWorkbenchGoogleAuthReadiness({
      principalId: "principal_123",
      config: null,
      storedTokenPresent: true,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("config_missing");
    expect(readiness.blockers).toContain("workbench_google_config_missing");
  });

  it("degrades clearly when Supabase config lookup is unavailable", async () => {
    mocks.getWorkbenchSupabase.mockReturnValue(null);

    await expect(
      getWorkbenchGoogleAuthReadiness("principal_123"),
    ).resolves.toMatchObject({
      ready: false,
      status: "config_unavailable",
      blockers: ["workbench_config_unavailable"],
    });
    expect(mocks.hasStoredWorkbenchGoogleToken).not.toHaveBeenCalled();
  });

  it("checks the user's stored token after config grants all required scopes", async () => {
    mocks.getWorkbenchSupabase.mockReturnValue(
      createConfigSupabaseDouble({
        google_oauth_grant_status: "granted",
        google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
      }),
    );
    mocks.hasStoredWorkbenchGoogleToken.mockResolvedValue({
      status: "available",
      present: false,
    });

    await expect(
      getWorkbenchGoogleAuthReadiness("principal_123"),
    ).resolves.toMatchObject({
      ready: false,
      status: "token_missing",
      blockers: ["google_stored_token_missing"],
    });
    expect(mocks.hasStoredWorkbenchGoogleToken).toHaveBeenCalledWith(
      "principal_123",
    );
  });

  it("runs idempotent Drive setup after Google OAuth token persistence stores tokens", async () => {
    vi.resetModules();
    const config = {
      drive_folder_id: "folder-existing-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-existing-1",
      google_oauth_grant_status: "granted",
      google_oauth_scopes: [...WORKBENCH_GOOGLE_CONNECTOR_SCOPES],
    };
    mocks.getWorkbenchSupabase.mockReturnValue(createConfigSupabaseDouble(config));
    mocks.persistWorkbenchGoogleTokens.mockResolvedValue({ status: "stored" });
    mocks.ensureWorkbenchDriveSetup.mockResolvedValue({
      status: "ready",
      reason: "existing_valid",
      repaired: false,
      drive_folder_id: "folder-existing-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-existing-1",
      updated: false,
    });

    await import("@/auth");
    const authConfig = mocks.nextAuth.mock.calls[0]?.[0] as {
      callbacks: {
        jwt(input: {
          token: Record<string, unknown>;
          profile?: null;
          account?: Record<string, unknown>;
        }): Promise<Record<string, unknown>>;
      };
    };

    await authConfig.callbacks.jwt({
      token: { principalId: "principal_123" },
      profile: null,
      account: {
        provider: "google",
        access_token: "access-token-123",
        scope: WORKBENCH_GOOGLE_OAUTH_SCOPE,
      },
    });

    expect(mocks.persistWorkbenchGoogleTokens).toHaveBeenCalledWith({
      principalId: "principal_123",
      account: {
        provider: "google",
        access_token: "access-token-123",
        scope: WORKBENCH_GOOGLE_OAUTH_SCOPE,
      },
    });
    expect(mocks.ensureWorkbenchDriveSetup).toHaveBeenCalledTimes(1);
    expect(mocks.ensureWorkbenchDriveSetup.mock.calls[0]?.[0]).toMatchObject({
      userId: "principal_123",
      config,
      accessToken: "access-token-123",
    });
    expect(
      mocks.ensureWorkbenchDriveSetup.mock.calls[0]?.[0].updateConfig,
    ).toEqual(expect.any(Function));
  });

  it("runs Drive setup after Google OAuth even before a Workbench config row exists", async () => {
    vi.resetModules();
    mocks.getWorkbenchSupabase.mockReturnValue(createConfigSupabaseDouble(null));
    mocks.persistWorkbenchGoogleTokens.mockResolvedValue({ status: "stored" });
    mocks.ensureWorkbenchDriveSetup.mockResolvedValue({
      status: "ready",
      reason: "created",
      repaired: false,
      drive_folder_id: "folder-created-1",
      drive_folder_url: "https://drive.google.com/drive/folders/folder-created-1",
      updated: true,
    });

    await import("@/auth");
    const authConfig = mocks.nextAuth.mock.calls[0]?.[0] as {
      callbacks: {
        jwt(input: {
          token: Record<string, unknown>;
          profile?: null;
          account?: Record<string, unknown>;
        }): Promise<Record<string, unknown>>;
      };
    };

    await authConfig.callbacks.jwt({
      token: { principalId: "principal_123" },
      profile: null,
      account: {
        provider: "google",
        access_token: "access-token-123",
        scope: WORKBENCH_GOOGLE_OAUTH_SCOPE,
      },
    });

    expect(mocks.ensureWorkbenchDriveSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal_123",
        config: null,
        accessToken: "access-token-123",
        updateConfig: expect.any(Function),
      }),
    );
  });
});
