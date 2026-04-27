const CO_DOMAIN = "charlieoscar.com";

export type InvitationLike = {
  email?: string | null;
  status?: string | null;
};

export type CanSignInEmailOptions = {
  email: string | null | undefined;
  allowedEmails: string[];
  hasPendingInvitation: (email: string) => Promise<boolean>;
};

export function parseAllowedEmails(value: string): string[] {
  return value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function hasPendingInvitationForEmail(
  invitations: InvitationLike[],
  email: string,
): boolean {
  const normalized = email.trim().toLowerCase();
  return invitations.some(
    (invitation) =>
      invitation.status === "pending" &&
      invitation.email?.trim().toLowerCase() === normalized,
  );
}

export async function canSignInEmail({
  email,
  allowedEmails,
  hasPendingInvitation,
}: CanSignInEmailOptions): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith(`@${CO_DOMAIN}`)) return true;
  if (allowedEmails.includes(normalized)) return true;
  return hasPendingInvitation(normalized);
}
