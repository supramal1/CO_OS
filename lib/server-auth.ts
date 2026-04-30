import { headers } from "next/headers";
import type { Session } from "next-auth";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { resolveAuthSecret } from "@/auth.config";
import { resolveEmailToPrincipal } from "@/lib/cornerstone";

export type ServerAuthSession = Session & {
  apiKey: string | null;
};

export async function authWithApiKey(): Promise<ServerAuthSession | null> {
  const session = await auth();
  if (!session) return null;

  const apiKey =
    getTestSessionApiKey(session) ??
    (await getJwtApiKey()) ??
    (await resolveSessionApiKey(session));
  return { ...session, apiKey };
}

async function getJwtApiKey(): Promise<string | null> {
  const secret = authSecret();
  if (!secret) return null;

  const token = await getToken({
    req: { headers: await headers() },
    secret,
    secureCookie: usesSecureCookie(),
  });

  return typeof token?.apiKey === "string" ? token.apiKey : null;
}

function getTestSessionApiKey(session: Session): string | null {
  if (process.env.NODE_ENV !== "test") return null;
  const value = (session as { apiKey?: unknown }).apiKey;
  return typeof value === "string" ? value : null;
}

async function resolveSessionApiKey(session: Session): Promise<string | null> {
  const email = session.user?.email;
  if (!email) return null;

  const resolved = await resolveEmailToPrincipal(
    email,
    session.user?.name ?? undefined,
  );
  return resolved?.api_key ?? null;
}

function authSecret(): string | null {
  return resolveAuthSecret();
}

function usesSecureCookie(): boolean {
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  return authUrl.startsWith("https://");
}
