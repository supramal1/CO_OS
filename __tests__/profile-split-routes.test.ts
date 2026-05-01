import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authWithApiKey: vi.fn(),
  buildProfileShellSnapshot: vi.fn(),
  buildProfileConnectorsSnapshot: vi.fn(),
  buildProfilePersonalisationSegmentSnapshot: vi.fn(),
  buildProfilePrivacySnapshot: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  authWithApiKey: () => mocks.authWithApiKey(),
}));

vi.mock("@/lib/profile/profile-snapshot", () => ({
  buildProfileShellSnapshot: (...args: unknown[]) =>
    mocks.buildProfileShellSnapshot(...args),
  buildProfileConnectorsSnapshot: (...args: unknown[]) =>
    mocks.buildProfileConnectorsSnapshot(...args),
  buildProfilePersonalisationSegmentSnapshot: (...args: unknown[]) =>
    mocks.buildProfilePersonalisationSegmentSnapshot(...args),
  buildProfilePrivacySnapshot: (...args: unknown[]) =>
    mocks.buildProfilePrivacySnapshot(...args),
}));

import { GET as getShell } from "@/app/api/profile/shell/route";
import { GET as getConnectors } from "@/app/api/profile/connectors/route";
import { GET as getPersonalisation } from "@/app/api/profile/personalisation/route";
import { GET as getPrivacy } from "@/app/api/profile/privacy/route";

describe("split Profile routes", () => {
  const session = {
    principalId: "principal_123",
    apiKey: "csk_test",
    isAdmin: false,
    user: { email: "malik@example.com", name: "Malik" },
  };

  beforeEach(() => {
    mocks.authWithApiKey.mockReset();
    mocks.buildProfileShellSnapshot.mockReset();
    mocks.buildProfileConnectorsSnapshot.mockReset();
    mocks.buildProfilePersonalisationSegmentSnapshot.mockReset();
    mocks.buildProfilePrivacySnapshot.mockReset();
  });

  it.each([
    ["shell", getShell],
    ["connectors", getConnectors],
    ["personalisation", getPersonalisation],
    ["privacy", getPrivacy],
  ])("returns 401 from /api/profile/%s when the user is not signed in", async (_name, GET) => {
    mocks.authWithApiKey.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns the fast profile shell", async () => {
    const shell = {
      identity: { userId: "principal_123", email: "malik@example.com" },
      stats: [],
      factRows: [],
    };
    mocks.authWithApiKey.mockResolvedValue(session);
    mocks.buildProfileShellSnapshot.mockReturnValue(shell);

    const res = await getShell();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ shell });
    expect(mocks.buildProfileShellSnapshot).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("returns connector state without loading personalisation", async () => {
    const connectors = {
      connectedTools: [{ id: "notion", status: "connected" }],
      stats: [{ label: "Connected tools", value: "2 / 6" }],
    };
    mocks.authWithApiKey.mockResolvedValue(session);
    mocks.buildProfileConnectorsSnapshot.mockResolvedValue(connectors);

    const res = await getConnectors();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connectors });
    expect(mocks.buildProfileConnectorsSnapshot).toHaveBeenCalledExactlyOnceWith({
      session,
    });
    expect(mocks.buildProfilePersonalisationSegmentSnapshot).not.toHaveBeenCalled();
  });

  it("returns personalisation with the session API key", async () => {
    const personalisation = {
      cards: [{ id: "honcho-context-0", source: "honcho" }],
      sources: [{ source: "honcho", status: "ok", label: "Honcho" }],
    };
    const metadata = {
      generatedAt: "2026-05-01T10:00:00.000Z",
      lastChecked: "2026-05-01T10:00:00.000Z",
      status: "live",
    };
    mocks.authWithApiKey.mockResolvedValue(session);
    mocks.buildProfilePersonalisationSegmentSnapshot.mockResolvedValue({
      personalisation,
      metadata,
    });

    const res = await getPersonalisation();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personalisation, metadata });
    expect(
      mocks.buildProfilePersonalisationSegmentSnapshot,
    ).toHaveBeenCalledExactlyOnceWith({ session, apiKey: "csk_test" });
    expect(mocks.buildProfileConnectorsSnapshot).not.toHaveBeenCalled();
  });

  it("returns privacy rows without connector or personalisation lookups", async () => {
    const privacy = {
      factRows: [{ label: "Private to you", value: "Style preferences" }],
    };
    mocks.authWithApiKey.mockResolvedValue(session);
    mocks.buildProfilePrivacySnapshot.mockReturnValue(privacy);

    const res = await getPrivacy();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ privacy });
    expect(mocks.buildProfilePrivacySnapshot).toHaveBeenCalledOnce();
    expect(mocks.buildProfileConnectorsSnapshot).not.toHaveBeenCalled();
    expect(mocks.buildProfilePersonalisationSegmentSnapshot).not.toHaveBeenCalled();
  });
});
