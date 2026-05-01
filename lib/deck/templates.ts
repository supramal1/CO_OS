import { getWorkbenchSupabase } from "@/lib/workbench/supabase";
import type {
  DeckTemplate,
  DeckTemplateCreateInput,
  DeckTemplateUpdateInput,
} from "./template-types";

const TABLE = "deck_templates";
const TEMPLATE_COLUMNS =
  "id,name,brand,client,use_case,status,source_pptx_path,google_slides_template_id,google_slides_template_url,is_default,layout_manifest,created_at,updated_at" as const;

type SupabaseErrorLike = { message?: string } | null;
type SupabaseSingleResult<T> = PromiseLike<{
  data: T | null;
  error: SupabaseErrorLike;
}>;
type SupabaseListResult<T> = PromiseLike<{
  data: T[] | null;
  error: SupabaseErrorLike;
}>;

type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        options: { ascending: boolean },
      ): SupabaseListResult<DeckTemplate>;
      eq(column: string, value: string | boolean): {
        order(
          column: string,
          options: { ascending: boolean },
        ): SupabaseListResult<DeckTemplate>;
        maybeSingle(): SupabaseSingleResult<DeckTemplate>;
      };
    };
    insert(payload: DeckTemplateCreateInput): {
      select(columns: string): {
        single(): SupabaseSingleResult<DeckTemplate>;
      };
    };
    update(payload: DeckTemplateUpdateInput): {
      eq(column: string, value: string): {
        select(columns: string): {
          single(): SupabaseSingleResult<DeckTemplate>;
        };
      };
    };
  };
};

export type DeckTemplateStore = {
  list(): Promise<DeckTemplate[]>;
  get(id: string): Promise<DeckTemplate | null>;
  insert(input: DeckTemplateCreateInput): Promise<DeckTemplate>;
  update(
    id: string,
    patch: DeckTemplateUpdateInput,
  ): Promise<DeckTemplate | null>;
  unsetActiveDefaults(exceptId?: string): Promise<void>;
};

export function createSupabaseDeckTemplateStore(
  supabase: SupabaseLike,
): DeckTemplateStore {
  return {
    async list() {
      const { data, error } = await supabase
        .from(TABLE)
        .select(TEMPLATE_COLUMNS)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message ?? "deck_templates_list_failed");
      return data ?? [];
    },
    async get(id) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(TEMPLATE_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "deck_template_get_failed");
      return data ?? null;
    },
    async insert(input) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert(input)
        .select(TEMPLATE_COLUMNS)
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "deck_template_create_failed");
      }
      return data;
    },
    async update(id, patch) {
      const { data, error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .select(TEMPLATE_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "deck_template_update_failed");
      return data ?? null;
    },
    async unsetActiveDefaults(exceptId) {
      const templates = await this.list();
      await Promise.all(
        templates
          .filter(
            (template) =>
              template.status === "active" &&
              template.is_default &&
              template.id !== exceptId,
          )
          .map((template) => this.update(template.id, { is_default: false })),
      );
    },
  };
}

export function getDeckTemplateStore(): DeckTemplateStore | null {
  const supabase = getWorkbenchSupabase() as unknown as SupabaseLike | null;
  return supabase ? createSupabaseDeckTemplateStore(supabase) : null;
}

export async function listDeckTemplates(
  store = getDeckTemplateStore(),
): Promise<DeckTemplate[]> {
  if (!store) return [];
  return store.list();
}

export async function listActiveDeckTemplates(
  store = getDeckTemplateStore(),
): Promise<DeckTemplate[]> {
  const templates = await listDeckTemplates(store);
  return templates.filter((template) => template.status === "active");
}

export async function getDeckTemplate(
  store: DeckTemplateStore,
  id: string,
): Promise<DeckTemplate | null> {
  return store.get(id);
}

export async function getDefaultDeckTemplate(
  store = getDeckTemplateStore(),
): Promise<DeckTemplate | null> {
  const templates = await listActiveDeckTemplates(store);
  return templates.find((template) => template.is_default) ?? null;
}

export async function createDeckTemplate(
  store: DeckTemplateStore,
  input: DeckTemplateCreateInput,
): Promise<DeckTemplate> {
  if (input.is_default && input.status === "active") {
    await store.unsetActiveDefaults();
  }
  const template = await store.insert(input);
  if (template.is_default && template.status === "active") {
    await store.unsetActiveDefaults(template.id);
  }
  return template;
}

export async function updateDeckTemplate(
  store: DeckTemplateStore,
  id: string,
  input: DeckTemplateUpdateInput,
): Promise<DeckTemplate | null> {
  if (input.is_default === true && input.status !== "archived") {
    await store.unsetActiveDefaults(id);
  }
  const template = await store.update(id, input);
  if (template?.is_default && template.status === "active") {
    await store.unsetActiveDefaults(template.id);
  }
  return template;
}

export async function archiveDeckTemplate(
  store: DeckTemplateStore,
  id: string,
): Promise<DeckTemplate | null> {
  return store.update(id, { status: "archived", is_default: false });
}

export async function setDefaultDeckTemplate(
  store: DeckTemplateStore,
  id: string,
): Promise<DeckTemplate | null> {
  const template = await store.get(id);
  if (!template || template.status !== "active") return null;
  await store.unsetActiveDefaults(id);
  return store.update(id, { is_default: true });
}
