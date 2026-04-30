import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export function resolveAuthSecret(): string {
  return (
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "co-os-local-development-secret"
  );
}

const authConfig = {
  secret: resolveAuthSecret(),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
  },
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth);
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
