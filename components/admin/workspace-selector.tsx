"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AdminWorkspaceContextValue = {
  workspaces: string[];
  selectedWorkspace: string | null;
  setSelectedWorkspace: (workspace: string) => void;
  hasWorkspaceAccess: boolean;
  hasMultipleWorkspaces: boolean;
};

const AdminWorkspaceContext =
  createContext<AdminWorkspaceContextValue | null>(null);

export function AdminWorkspaceProvider({
  children,
  principalId,
  workspaces,
}: {
  children: ReactNode;
  principalId: string | null;
  workspaces: string[];
}) {
  const normalizedWorkspaces = useMemo(
    () =>
      Array.from(
        new Set(workspaces.map((workspace) => workspace.trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [workspaces],
  );

  const storageKey = `co-os:admin:selected-workspace:${principalId ?? "anonymous"}`;
  const [selectedWorkspace, setSelectedWorkspaceState] = useState<string | null>(
    normalizedWorkspaces[0] ?? null,
  );

  useEffect(() => {
    if (normalizedWorkspaces.length === 0) {
      setSelectedWorkspaceState(null);
      return;
    }

    if (normalizedWorkspaces.length === 1) {
      setSelectedWorkspaceState(normalizedWorkspaces[0]);
      return;
    }

    const saved = window.localStorage.getItem(storageKey);
    setSelectedWorkspaceState(
      saved && normalizedWorkspaces.includes(saved)
        ? saved
        : normalizedWorkspaces[0],
    );
  }, [normalizedWorkspaces, storageKey]);

  const setSelectedWorkspace = useCallback(
    (workspace: string) => {
      if (!normalizedWorkspaces.includes(workspace)) return;
      setSelectedWorkspaceState(workspace);
      if (normalizedWorkspaces.length > 1) {
        window.localStorage.setItem(storageKey, workspace);
      }
    },
    [normalizedWorkspaces, storageKey],
  );

  const value = useMemo<AdminWorkspaceContextValue>(
    () => ({
      workspaces: normalizedWorkspaces,
      selectedWorkspace,
      setSelectedWorkspace,
      hasWorkspaceAccess: normalizedWorkspaces.length > 0,
      hasMultipleWorkspaces: normalizedWorkspaces.length > 1,
    }),
    [normalizedWorkspaces, selectedWorkspace, setSelectedWorkspace],
  );

  return (
    <AdminWorkspaceContext.Provider value={value}>
      {children}
    </AdminWorkspaceContext.Provider>
  );
}

export function useAdminWorkspace() {
  const ctx = useContext(AdminWorkspaceContext);
  if (!ctx) {
    throw new Error("useAdminWorkspace must be used inside AdminWorkspaceProvider");
  }
  return ctx;
}

export function WorkspaceSelector() {
  const {
    hasMultipleWorkspaces,
    selectedWorkspace,
    setSelectedWorkspace,
    workspaces,
  } = useAdminWorkspace();

  if (!hasMultipleWorkspaces || !selectedWorkspace) return null;

  return (
    <label
      style={{
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      <span>Workspace</span>
      <select
        value={selectedWorkspace}
        onChange={(event) => setSelectedWorkspace(event.target.value)}
        style={{
          fontFamily: "var(--font-plex-mono)",
          fontSize: 11,
          letterSpacing: 0,
          padding: "5px 8px",
          minWidth: 180,
          background: "var(--bg)",
          color: "var(--ink)",
          border: "1px solid var(--rule)",
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace} value={workspace}>
            {workspace}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AdminWorkspaceGate({ children }: { children: ReactNode }) {
  const { hasWorkspaceAccess } = useAdminWorkspace();

  if (hasWorkspaceAccess) return <>{children}</>;

  return (
    <div
      style={{
        padding: 28,
        maxWidth: 680,
        fontFamily: "var(--font-plex-sans)",
        color: "var(--ink)",
      }}
    >
      <h1
        style={{
          margin: "0 0 8px",
          fontFamily: "var(--font-plex-serif)",
          fontWeight: 400,
          fontSize: 26,
        }}
      >
        No workspace access
      </h1>
      <p
        style={{
          margin: 0,
          color: "var(--ink-dim)",
          fontSize: 15,
          lineHeight: 1.6,
        }}
      >
        This admin session has no workspace grants. Ask another admin to grant
        access before using the control panel.
      </p>
    </div>
  );
}
