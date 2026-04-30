import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    principalId: string | null;
    isAdmin: boolean;
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    principalId?: string;
    principalName?: string;
    apiKey?: string;
    isAdmin?: boolean;
    resolvedAt?: number;
  }
}
