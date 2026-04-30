import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

export function buildClientSession(session: Session, token: JWT): Session {
  const principalName =
    typeof token.principalName === "string" ? token.principalName : null;
  const principalId =
    typeof token.principalId === "string" ? token.principalId : null;

  const nextSession = {
    ...session,
    user: {
      ...session.user,
      email: session.user?.email ?? null,
      name: principalName ?? session.user?.name ?? null,
    },
    principalId,
    isAdmin: Boolean(token.isAdmin),
  };

  delete (nextSession as { apiKey?: unknown }).apiKey;
  return nextSession;
}
