import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const WORKBENCH_RUNTIME_ROOTS = [
  "app/(os)/workbench",
  "app/api/workbench",
  "components/workbench",
  "lib/workbench",
] as const;

export type WorkbenchRuntimeMatch = {
  file: string;
  pattern: string;
  match: string;
};

export function workbenchRuntimeFiles(
  roots: readonly string[] = WORKBENCH_RUNTIME_ROOTS,
): string[] {
  return roots.flatMap((root) => {
    const absoluteRoot = path.join(process.cwd(), root);
    if (!existsSync(absoluteRoot)) return [];
    return filesUnder(absoluteRoot);
  });
}

export function findWorkbenchRuntimeMatches(
  patterns: Record<string, RegExp>,
  files: readonly string[] = workbenchRuntimeFiles(),
): WorkbenchRuntimeMatch[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return Object.entries(patterns).flatMap(([pattern, rawRegex]) => {
      const regex = resettableGlobalRegex(rawRegex);
      return [...text.matchAll(regex)].map((match) => ({
        file: path.relative(process.cwd(), file),
        pattern,
        match: match[0],
      }));
    });
  });
}

function filesUnder(root: string): string[] {
  const stat = statSync(root);
  if (stat.isFile()) return isRuntimeSourceFile(root) ? [root] : [];

  return readdirSync(root).flatMap((entry) => filesUnder(path.join(root, entry)));
}

function isRuntimeSourceFile(file: string): boolean {
  return /\.(ts|tsx)$/.test(file);
}

function resettableGlobalRegex(regex: RegExp): RegExp {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}
