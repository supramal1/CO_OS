import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import authConfig from "./auth.config";
import { canSignInEmail, parseAllowedEmails } from "./lib/auth-access";
import {
  checkAdminCapability,
  hasPendingInvitation,
  resolveEmailToPrincipal,
} from "./lib/cornerstone";
import { WORKBENCH_GOOGLE_OAUTH_SCOPE } from "./lib/workbench/google-auth";
import {
  ensureWorkbenchDriveSetup,
  type WorkbenchDriveSetupConfig,
  type WorkbenchDriveSetupUpdate,
} from "./lib/workbench/google-drive-setup";
import { persistWorkbenchGoogleTokens } from "./lib/workbench/google-token-store";
import { getWorkbenchSupabase } from "./lib/workbench/supabase";
import { patchWorkbenchUserConfig } from "./lib/workbench/user-config";

const ALLOWED_EMAILS = parseAllowedEmails(process.env.CO_OS_ALLOWED_EMAILS ?? "");
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: WORKBENCH_GOOGLE_OAUTH_SCOPE,
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      return canSignInEmail({
        email: profile?.email,
        allowedEmails: ALLOWED_EMAILS,
        hasPendingInvitation,
      });
    },
    async jwt({ token, profile, account }) {
      const now = Date.now();

      if (profile?.email && !token.principalId) {
        const resolved = await resolveEmailToPrincipal(
          profile.email,
          profile.name ?? undefined,
        );
        if (resolved) {
          token.principalId = resolved.principal_id;
          token.principalName = resolved.principal_name;
          token.apiKey = resolved.api_key;
          token.isAdmin = await checkAdminCapability(resolved.principal_id);
          token.resolvedAt = now;
        }
      }

      if (account?.provider === "google") {
        const principalId =
          typeof token.principalId === "string" ? token.principalId : null;
        const outcome = await persistWorkbenchGoogleTokens({
          principalId,
          account,
        });
        if (outcome.status === "error") {
          console.warn(
            "[workbench] Google token persistence failed:",
            outcome.message,
          );
        }
        if (outcome.status === "stored") {
          await ensureWorkbenchDriveSetupAfterGoogleOAuth({
            principalId,
            accessToken: account.access_token,
          });
        }
      }

      // Re-resolve principal+apiKey every 24h so key rotations and admin
      // capability changes propagate without forcing sign-out. On failure
      // we keep the existing token values, never invalidate the session.
      const stale =
        token.principalId &&
        typeof token.email === "string" &&
        (typeof token.resolvedAt !== "number" ||
          now - token.resolvedAt > TWENTY_FOUR_HOURS_MS);

      if (stale && typeof token.email === "string") {
        try {
          const resolved = await resolveEmailToPrincipal(
            token.email,
            token.name ?? undefined,
          );
          if (resolved) {
            token.principalId = resolved.principal_id;
            token.principalName = resolved.principal_name;
            token.apiKey = resolved.api_key;
            token.isAdmin = await checkAdminCapability(resolved.principal_id);
            token.resolvedAt = now;
          }
        } catch {
          // Keep existing token because re-resolve is best-effort.
        }
      }

      return token;
    },
    async session({ session, token }) {
      const principalName =
        typeof token.principalName === "string" ? token.principalName : null;
      const principalId =
        typeof token.principalId === "string" ? token.principalId : null;
      const apiKey = typeof token.apiKey === "string" ? token.apiKey : null;
      session.user = {
        ...session.user,
        email: session.user?.email ?? null,
        name: principalName ?? session.user?.name ?? null,
      };
      session.principalId = principalId;
      session.apiKey = apiKey;
      session.isAdmin = Boolean(token.isAdmin);
      return session;
    },
  },
});

export const { GET, POST } = handlers;

type WorkbenchDriveSetupSupabase = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: unknown | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

async function ensureWorkbenchDriveSetupAfterGoogleOAuth(input: {
  principalId: string | null;
  accessToken?: string | null;
}): Promise<void> {
  if (!input.principalId || !input.accessToken) return;

  const sb =
    getWorkbenchSupabase() as unknown as WorkbenchDriveSetupSupabase | null;
  if (!sb) return;

  try {
    const { data, error } = await sb
      .from("user_workbench_config")
      .select("drive_folder_id, drive_folder_url")
      .eq("user_id", input.principalId)
      .maybeSingle();

    if (error) {
      console.warn(
        "[workbench] Google Drive setup config lookup failed:",
        error.message,
      );
      return;
    }
    await ensureWorkbenchDriveSetup({
      userId: input.principalId,
      config: (data as WorkbenchDriveSetupConfig | null) ?? null,
      accessToken: input.accessToken,
      updateConfig: updateWorkbenchDriveConfig,
    });
  } catch (error) {
    console.warn(
      "[workbench] Google Drive setup after OAuth failed:",
      errorMessage(error),
    );
  }
}

async function updateWorkbenchDriveConfig(
  update: WorkbenchDriveSetupUpdate,
): Promise<void> {
  const result = await patchWorkbenchUserConfig(update.userId, {
    drive_folder_id: update.drive_folder_id,
    drive_folder_url: update.drive_folder_url,
  });

  if (result.status !== "ok") {
    throw new Error(workbenchConfigErrorMessage(result));
  }
}

function workbenchConfigErrorMessage(
  result: Exclude<
    Awaited<ReturnType<typeof patchWorkbenchUserConfig>>,
    { status: "ok" }
  >,
): string {
  if (result.status === "unavailable") return result.error;
  return result.detail;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
