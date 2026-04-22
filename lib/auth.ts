import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { checkAdminCapability, resolveEmailToPrincipal } from "./cornerstone";

const CO_DOMAIN = "charlieoscar.com";
const ALLOWED_EMAILS = (process.env.CO_OS_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      if (email.endsWith(`@${CO_DOMAIN}`)) return true;
      if (ALLOWED_EMAILS.includes(email)) return true;
      return false;
    },
    async jwt({ token, profile }) {
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
