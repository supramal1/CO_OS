import NextAuth from "next-auth";
import authConfig from "./auth.config";
import { canSignInEmail, parseAllowedEmails } from "./lib/auth-access";
import {
  checkAdminCapability,
  hasPendingInvitation,
  resolveEmailToPrincipal,
} from "./lib/cornerstone";

const ALLOWED_EMAILS = parseAllowedEmails(process.env.CO_OS_ALLOWED_EMAILS ?? "");
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      return canSignInEmail({
        email: profile?.email,
        allowedEmails: ALLOWED_EMAILS,
        hasPendingInvitation,
      });
    },
    async jwt({ token, profile }) {
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
        return token;
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
