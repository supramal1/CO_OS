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
import {
  addAndSelectWorkspace,
  normalizeWorkspaces,
} from "@/components/admin/workspace-state";

type AdminWorkspaceContextValue = {
  workspaces: string[];
  adminWorkspaces: string[];
  selectedWorkspace: string | null;
  setSelectedWorkspace: (workspace: string) => void;
  registerWorkspace: (workspace: string) => void;
  hasWorkspaceAccess: boolean;
  hasMultipleWorkspaces: boolean;
};

const AdminWorkspaceContext =
  createContext<AdminWorkspaceContextValue | null>(null);

export function AdminWorkspaceProvider({
  children,
  principalId,
  workspaces,
  adminWorkspaces,
}: {
  children: ReactNode;
  principalId: string | null;
  workspaces: string[];
  adminWorkspaces: string[];
}) {
  const incomingWorkspacesKey = workspaces.join("\0");
  const incomingWorkspaces = useMemo(
    () => normalizeWorkspaces(workspaces),
    [incomingWorkspacesKey],
  );
  const incomingAdminWorkspacesKey = adminWorkspaces.join("\0");
  const incomingAdminWorkspaces = useMemo(
    () => normalizeWorkspaces(adminWorkspaces),
    [incomingAdminWorkspacesKey],
  );

  const storageKey = `co-os:admin:selected-workspace:${principalId ?? "anonymous"}`;
  const [workspaceList, setWorkspaceList] = useState<string[]>(
    () => incomingWorkspaces,
  );
  const [selectedWorkspace, setSelectedWorkspaceState] = useState<string | null>(
    incomingWorkspaces[0] ?? null,
  );

  useEffect(() => {
    setWorkspaceList(incomingWorkspaces);
  }, [incomingWorkspacesKey, incomingWorkspaces]);

  useEffect(() => {
    if (workspaceList.length === 0) {
      setSelectedWorkspaceState(null);
      return;
    }

    if (workspaceList.length === 1) {
      setSelectedWorkspaceState(workspaceList[0]);
      return;
    }

    const saved = window.localStorage.getItem(storageKey);
    setSelectedWorkspaceState((current) => {
      if (current && workspaceList.includes(current)) return current;
      return saved && workspaceList.includes(saved) ? saved : workspaceList[0];
    });
  }, [workspaceList, storageKey]);

  const setSelectedWorkspace = useCallback(
    (workspace: string) => {
      if (!workspaceList.includes(workspace)) return;
      setSelectedWorkspaceState(workspace);
      if (workspaceList.length > 1) {
        window.localStorage.setItem(storageKey, workspace);
      }
    },
    [workspaceList, storageKey],
  );

  const registerWorkspace = useCallback(
    (workspace: string) => {
      const next = addAndSelectWorkspace(workspaceList, workspace);
      setWorkspaceList(next.workspaces);
      setSelectedWorkspaceState(next.selectedWorkspace);
      if (next.selectedWorkspace && next.workspaces.length > 1) {
        window.localStorage.setItem(storageKey, next.selectedWorkspace);
      }
    },
    [workspaceList, storageKey],
  );

  const value = useMemo<AdminWorkspaceContextValue>(
    () => ({
      workspaces: workspaceList,
      adminWorkspaces: incomingAdminWorkspaces,
      selectedWorkspace,
      setSelectedWorkspace,
      registerWorkspace,
      hasWorkspaceAccess: workspaceList.length > 0,
      hasMultipleWorkspaces: workspaceList.length > 1,
    }),
    [
      workspaceList,
      incomingAdminWorkspaces,
      selectedWorkspace,
      setSelectedWorkspace,
      registerWorkspace,
    ],
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
