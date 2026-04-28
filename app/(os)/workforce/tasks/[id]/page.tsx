"use client";

import { use } from "react";
import { TaskDetailView } from "@/components/workforce/task-detail-view";

export default function WorkforceTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TaskDetailView taskId={id} />;
}
