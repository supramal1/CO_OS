export type WorkbenchOutputKind = "docx" | "pptx" | "sheets";

export type WorkbenchOutputMetadata = {
  requestedBy?: string | null;
  taskType?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

export type WorkbenchTextBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullet_list"; items: string[] };

export type WorkbenchDocxScaffoldSpec = {
  kind: "docx";
  title: string;
  metadata: WorkbenchOutputMetadata;
  sections: Array<{
    heading: string;
    blocks: WorkbenchTextBlock[];
  }>;
};

export type WorkbenchPptxScaffoldSpec = {
  kind: "pptx";
  title: string;
  slides: Array<{
    title: string;
    layout: "title-and-bullets";
    blocks: WorkbenchTextBlock[];
    speakerNotes: string | null;
  }>;
};

export type WorkbenchSheetsCell = string | number | boolean | null;

export type WorkbenchSheetsScaffoldSpec = {
  kind: "sheets";
  title: string;
  sheets: Array<{
    name: string;
    columns: string[];
    rows: WorkbenchSheetsCell[][];
  }>;
};

export type WorkbenchScaffoldSpec =
  | WorkbenchDocxScaffoldSpec
  | WorkbenchPptxScaffoldSpec
  | WorkbenchSheetsScaffoldSpec;

type DocxSectionInput = {
  heading: string;
  body?: string | null;
  bullets?: string[];
};

export function buildDocxScaffoldSpec(input: {
  title: string;
  sections: DocxSectionInput[];
  metadata?: WorkbenchOutputMetadata;
}): WorkbenchDocxScaffoldSpec {
  return {
    kind: "docx",
    title: input.title,
    metadata: input.metadata ?? {},
    sections: input.sections.map((section) => ({
      heading: section.heading,
      blocks: sectionBlocks(section),
    })),
  };
}

export function buildPptxScaffoldSpec(input: {
  title: string;
  slides: Array<{
    title: string;
    bullets?: string[];
    speakerNotes?: string | null;
  }>;
}): WorkbenchPptxScaffoldSpec {
  return {
    kind: "pptx",
    title: input.title,
    slides: input.slides.map((slide) => ({
      title: slide.title,
      layout: "title-and-bullets",
      blocks:
        slide.bullets && slide.bullets.length > 0
          ? [{ type: "bullet_list", items: [...slide.bullets] }]
          : [],
      speakerNotes: slide.speakerNotes ?? null,
    })),
  };
}

export function buildSheetsScaffoldSpec(input: {
  title: string;
  sheets: Array<{
    name: string;
    columns: string[];
    rows: WorkbenchSheetsCell[][];
  }>;
}): WorkbenchSheetsScaffoldSpec {
  return {
    kind: "sheets",
    title: input.title,
    sheets: input.sheets.map((sheet) => ({
      name: sheet.name,
      columns: [...sheet.columns],
      rows: sheet.rows.map((row) => [...row]),
    })),
  };
}

function sectionBlocks(section: DocxSectionInput): WorkbenchTextBlock[] {
  const blocks: WorkbenchTextBlock[] = [];

  if (section.body) {
    blocks.push({ type: "paragraph", text: section.body });
  }

  if (section.bullets && section.bullets.length > 0) {
    blocks.push({ type: "bullet_list", items: [...section.bullets] });
  }

  return blocks;
}
