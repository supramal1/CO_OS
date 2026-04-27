// Admin-domain types shared by the admin module.
// Ported from cornerstone-ui/lib/supabase.ts, scoped to governance entities only.
// Memory-inspector types (Fact, Note, Session, Thread, Embedding, Personality)
// belong to a separate module and are intentionally not included here.

export type Namespace = {
  id: string;
  name: string;
  display_name: string;
  type: string;
  status: string;
  description: string;
  retention_policy: Record<string, unknown>;
  created_at: string;
};

export type Principal = {
  id: string;
  name: string;
  email: string | null;
  type: string;
  status: string;
  created_at: string;
  archived_at?: string | null;
  deleted_at?: string | null;
  archived_by?: string | null;
  deleted_by?: string | null;
  _credential_count?: number;
  _grant_count?: number;
};

export type Credential = {
  id: string;
  principal_id: string;
  label: string;
  key_prefix: string;
  capabilities: string[];
  status: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at?: string | null;
  revoked_reason?: string | null;
};

export type Role = {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  description: string;
};

export type NamespaceGrant = {
  id: string;
  principal_id: string;
  namespace: string;
  access_level: string;
  namespace_display_name?: string;
};

export type AuditEvent = {
  id: string;
  principal_id: string | null;
  credential_id: string | null;
  namespace: string | null;
  action: string;
  endpoint: string;
  decision: string;
  reason: string | null;
  source_ip: string | null;
  created_at: string;
};

export type Invitation = {
  id: string;
  email: string;
  invited_by: string | null;
  role_template: string;
  capabilities: string[];
  namespace_grants: Array<{ namespace: string; access_level: string }>;
  status: "pending" | "claimed" | "revoked" | "expired";
  invited_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  expires_at: string;
  notes: string | null;
};

export type AdminStatus = {
  governance: boolean;
  principal_count: number;
  namespace_count: number;
  credential_count: number;
  role_count: number;
};

export type SetupClientResult = {
  principal: { id: string; name: string; type: string; status: string };
  credential: {
    id: string;
    key_prefix: string;
    label: string;
    capabilities: string[];
    status: string;
  };
  role: string;
  workspace: string;
  raw_key?: string;
};

export type RegenerateResult = {
  credential: {
    id: string;
    key_prefix: string;
    label: string;
    capabilities: string[];
    status: string;
  };
  raw_key: string;
  revoked_count: number;
};

export type VerifyResult = {
  status: "verified" | "failed";
  principal?: string;
  credential_status?: string;
  allowed_workspaces?: string[];
  granted_roles?: string[];
  audit_status?: string;
  last_verified?: string;
  api_latency_ms?: number;
  reason_code?: string;
  message?: string;
  recovery?: string;
};
