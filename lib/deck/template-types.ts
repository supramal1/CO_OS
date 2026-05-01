export type DeckTemplateStatus = "draft" | "active" | "archived";

export type DeckTemplateLayoutManifest = {
  roles?: string[];
};

export type DeckTemplate = {
  id: string;
  name: string;
  brand: string | null;
  client: string | null;
  use_case: string;
  status: DeckTemplateStatus;
  source_pptx_path: string | null;
  google_slides_template_id: string | null;
  google_slides_template_url: string | null;
  is_default: boolean;
  layout_manifest: DeckTemplateLayoutManifest;
  created_at: string;
  updated_at: string;
};

export type DeckTemplateCreateInput = {
  name: string;
  brand: string | null;
  client: string | null;
  use_case: string;
  status: DeckTemplateStatus;
  source_pptx_path: string | null;
  google_slides_template_id: string | null;
  google_slides_template_url: string | null;
  is_default: boolean;
  layout_manifest: DeckTemplateLayoutManifest;
};

export type DeckTemplateUpdateInput = Partial<DeckTemplateCreateInput>;
