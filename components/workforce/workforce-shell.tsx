"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicAgent, TaskSummary } from "@/lib/workforce/types";
import { TaskInput } from "./task-input";
import { RecentTasksList } from "./recent-tasks-list";

export function WorkforceShell() {
  const router = useRouter();
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [agentsRes, tasksRes] = await Promise.all([
        fetch("/api/workforce/agents", { cache: "no-store" }),
        fetch("/api/workforce/tasks?limit=50", { cache: "no-store" }),
      ]);
      if (!agentsRes.ok || !tasksRes.ok) {
        setError(`agents=${agentsRes.status} tasks=${tasksRes.status}`);
      } else {
        const a = await agentsRes.json();
        const t = await tasksRes.json();
        setAgents(a.agents ?? []);
        setTasks(t.tasks ?? []);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, []);

  async function handleDispatch(input: {
    agentId: string;
    description: string;
    targetWorkspace?: string;
  }): Promise<void> {
    const res = await fetch("/api/workforce/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { taskId: string };
    router.push(`/workforce/tasks/${body.taskId}`);
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(420px, 1fr) minmax(360px, 480px)",
        gap: 24,
        padding: 28,
      }}
    >
      <section>
        <SectionHeader>Dispatch</SectionHeader>
        {loading ? (
          <Note>Loading roster…</Note>
        ) : error ? (
          <Note tone="error">Failed to load: {error}</Note>
        ) : (
          <TaskInput agents={agents} onDispatch={handleDispatch} />
        )}
      </section>
      <section>
        <SectionHeader>Recent tasks</SectionHeader>
        <RecentTasksList tasks={tasks} />
      </section>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        marginBottom: 16,
        fontFamily: "var(--font-plex-mono)",
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
      }}
    >
      {children}
    </h2>
  );
}

function Note({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: tone === "error" ? "var(--c-forge)" : "var(--ink-dim)",
      }}
    >
      {children}
    </p>
  );
}
