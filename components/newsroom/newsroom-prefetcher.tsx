"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { writeCachedNewsroomBrief } from "./newsroom-cache";
import type { NewsroomBrief } from "@/lib/newsroom/types";

type NewsroomBriefResponse = {
  brief?: NewsroomBrief;
};

export function NewsroomPrefetcher() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;

    const controller = new AbortController();
    const run = window.setTimeout(() => {
      void fetch("/api/newsroom/brief", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as NewsroomBriefResponse;
        })
        .then((payload) => {
          if (payload?.brief) writeCachedNewsroomBrief(payload.brief);
        })
        .catch(() => {
          // Warm-up is opportunistic; Newsroom will still load on visit.
        });
    }, 400);

    return () => {
      window.clearTimeout(run);
      controller.abort();
    };
  }, [status]);

  return null;
}
