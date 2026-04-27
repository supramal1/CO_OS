import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { canSignInEmail, parseAllowedEmails } from "./auth-access";
import {
  checkAdminCapability,
  hasPendingInvitation,
  resolveEmailToPrincipal,
} from "./cornerstone";

const ALLOWED_EMAILS = parseAllowedEmails(process.env.CO_OS_ALLOWED_EMAILS ?? "");

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
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
          (profile as { name?: string }).name,
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
      // we keep the existing token values — never invalidate the session.
      const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
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
          // Keep existing token — re-resolve is best-effort.
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        email: session.user?.email ?? null,
        name: (token.principalName as string | undefined) ?? session.user?.name ?? null,
      };
      session.principalId = (token.principalId as string | undefined) ?? null;
      session.apiKey = (token.apiKey as string | undefined) ?? null;
      session.isAdmin = Boolean(token.isAdmin);
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
