"use client";

import { TaskDetailView } from "@/components/workforce/task-detail-view";

export default function WorkforceTaskPage({
  params,
}: {
  params: { id: string };
}) {
  return <TaskDetailView taskId={params.id} />;
}
