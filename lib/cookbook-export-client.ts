import JSZip from "jszip";

export type ExportedSkill = {
  path: string;
  frontmatter: Record<string, string | string[]>;
  content: string;
};

export type ExportPayload = {
  exported_at: string;
  count: number;
  skills: ExportedSkill[];
  module: Record<string, unknown>;
};

function yamlScalar(v: string): string {
  if (v === "") return '""';
  // Quote if contains special YAML chars or starts with something ambiguous.
  if (/[:#&*!|>'"%@`\n]|^[-?,\[\]{}]|^\s|\s$/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function yamlInlineList(items: string[]): string {
  return `[${items.map(yamlScalar).join(", ")}]`;
}

function toYamlFrontmatter(fm: Record<string, string | string[]>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlInlineList(value)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return lines.join("\n");
}

export function buildSkillMarkdown(skill: ExportedSkill): string {
  const fm = toYamlFrontmatter(skill.frontmatter);
  const body = skill.content.endsWith("\n") ? skill.content : `${skill.content}\n`;
  return `---\n${fm}\n---\n\n${body}`;
}

export async function buildExportZip(payload: ExportPayload): Promise<Blob> {
  const zip = new JSZip();
  zip.file("module.json", JSON.stringify(payload.module, null, 2) + "\n");

  const skillsRoot = zip.folder("skills");
  if (!skillsRoot) throw new Error("failed to create skills/ folder");

  for (const skill of payload.skills) {
    skillsRoot.file(skill.path, buildSkillMarkdown(skill));
  }

  return zip.generateAsync({ type: "blob" });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
