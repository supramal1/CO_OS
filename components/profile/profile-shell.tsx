"use client";

import { signIn, useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildWorkbenchConfigPayload,
  buildWorkbenchOnboardingPayload,
  deriveWorkbenchConnectorManagementActions,
  deriveWorkbenchConnectorSummary,
  deriveWorkbenchOAuthNotice,
  deriveWorkbenchSetupAffordances,
  deriveWorkbenchSetupSummary,
  getInitialWorkbenchConfigForm,
  toWorkbenchHealthRows,
  type WorkbenchConfigForm,
  type WorkbenchConnectorState,
  type WorkbenchOnboardingForm,
} from "@/components/workbench/workbench-shell";
import {
  deriveWorkbenchPersonalisationSummary,
  sanitizeWorkbenchDetail,
} from "@/lib/workbench/ui-state";
import type { WorkbenchOnboardingDraft } from "@/lib/workbench/personalisation";
import type { WorkbenchProfileContext } from "@/lib/workbench/profile";
import type { WorkbenchUserConfig } from "@/lib/workbench/retrieval/types";

type WorkbenchGoogleReadiness = {
  ready: boolean;
  status: string;
  required_scopes: string[];
  granted_scopes: string[];
  missing_scopes: string[];
  blockers: string[];
};

type WorkbenchConfigResponse = {
  config: WorkbenchUserConfig | null;
  google_readiness: WorkbenchGoogleReadiness | null;
};

type WorkbenchCheckResponse = {
  checks: Array<{
    source?: string;
    name?: string;
    status: string;
    reason?: string;
    message?: string;
    blockers?: string[];
    action?: "google_reconsent";
    items_count?: number;
  }>;
  generated_at: string;
};

type WorkbenchHealthRow = ReturnType<typeof toWorkbenchHealthRows>[number];
type WorkbenchSetupAffordanceSummary = ReturnType<
  typeof deriveWorkbenchSetupAffordances
>;
type WorkbenchSetupAffordance = WorkbenchSetupAffordanceSummary["notion"];
type WorkbenchSetupSummary = ReturnType<typeof deriveWorkbenchSetupSummary>;
type WorkbenchOAuthNotice = ReturnType<typeof deriveWorkbenchOAuthNotice>;
type WorkbenchConnectorSummary = ReturnType<typeof deriveWorkbenchConnectorSummary>;
type ConnectorManagementAction = ReturnType<
  typeof deriveWorkbenchConnectorManagementActions
>[number];

type SetupState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "checking" }
  | { status: "error"; message: string };

type WorkbenchOnboardingState =
  | { status: "idle" }
  | { status: "drafting" }
  | { status: "drafted"; draft: WorkbenchOnboardingDraft }
  | { status: "saving"; draft: WorkbenchOnboardingDraft }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

type ConnectorManagementState =
  | { status: "idle" }
  | { status: "running"; actionId: string }
  | { status: "loaded"; actionId: string; message: string }
  | { status: "error"; actionId: string; message: string };

type WorkbenchConnectorManagementResponse = {
  next_url?: string;
  message?: string;
  reason?: string;
  error?: string;
  detail?: string;
};

type WorkbenchProfileSourceStatus = {
  source: "notion" | "profile_updates";
  status: "ok" | "unavailable" | "error";
  items_count: number;
  reason?: string;
};

type WorkbenchProfileResponse = {
  profile: WorkbenchProfileContext;
  config: WorkbenchUserConfig | null;
  sources: WorkbenchProfileSourceStatus[];
  generated_at: string;
};

type ProfileState =
  | { status: "loading" }
  | { status: "loaded"; response: WorkbenchProfileResponse }
  | { status: "error"; message: string };

const EMPTY_ONBOARDING_FORM: WorkbenchOnboardingForm = {
  role_title: "",
  current_focus_bullets: "",
  work_type_chips: [],
  work_type_other: "",
  communication_style: [],
  challenge_style: [],
  helpful_context: [],
  helpful_context_other: "",
};

const NOTION_SETUP_HREF = "/api/workbench/notion/start";
const PROFILE_CALLBACK_URL = "/profile?google_oauth=returned";
const PROFILE_GOOGLE_SETUP_HREF = "/profile?google_oauth=start";

const WORK_TYPE_OPTIONS = [
  "Client responses",
  "Decks",
  "Research",
  "Meeting prep",
  "Status updates",
  "Internal briefing",
] as const;

const COMMUNICATION_STYLE_OPTIONS = [
  "Concise",
  "Polished",
  "Direct",
  "Source-led",
  "Warm",
  "Detailed when needed",
] as const;

const CHALLENGE_STYLE_OPTIONS = [
  "Flag weak logic",
  "Challenge assumptions",
  "Suggest stronger framing",
  "Point out missing context",
  "Be direct",
  "Show risks/tradeoffs",
] as const;

const HELPFUL_CONTEXT_OPTIONS = [
  "New to this account/project",
  "Need source links",
  "Working across multiple clients",
  "Often preparing client-ready outputs",
  "Prefer short next steps",
  "Tight turnaround work",
] as const;

export function ProfileShell() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "CO OS user";
  const email = session?.user?.email ?? "No email available";
  const initials = initialsFromName(name);
  const [connectorState, setConnectorState] =
    useState<WorkbenchConnectorState>({ status: "loading" });
  const [configForm, setConfigForm] = useState<WorkbenchConfigForm>(
    getInitialWorkbenchConfigForm(null),
  );
  const [profileState, setProfileState] = useState<ProfileState>({
    status: "loading",
  });
  const [onboardingForm, setOnboardingForm] = useState<WorkbenchOnboardingForm>(
    EMPTY_ONBOARDING_FORM,
  );
  const [onboardingState, setOnboardingState] =
    useState<WorkbenchOnboardingState>({ status: "idle" });
  const [setupState, setSetupState] = useState<SetupState>({ status: "idle" });
  const [healthRows, setHealthRows] = useState<WorkbenchHealthRow[]>([]);
  const [healthGeneratedAt, setHealthGeneratedAt] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<WorkbenchOAuthNotice>(null);
  const [connectorManagementState, setConnectorManagementState] =
    useState<ConnectorManagementState>({ status: "idle" });
  const [showProfileBuilder, setShowProfileBuilder] = useState(false);

  const config = connectorState.status === "loaded" ? connectorState.config : null;
  const connectorSummary = useMemo(
    () => deriveWorkbenchConnectorSummary(connectorState),
    [connectorState],
  );
  const setupAffordances = useMemo(
    () => deriveWorkbenchSetupAffordances({ connectorState, healthRows }),
    [connectorState, healthRows],
  );
  const setupSummary = useMemo(
    () => deriveWorkbenchSetupSummary(setupAffordances),
    [setupAffordances],
  );
  const profile = profileState.status === "loaded" ? profileState.response.profile : null;
  const profileReady = Boolean(
    profile?.summary_text.trim() || hasProfilePersonalisationSeed(config),
  );
  const personalisationSummary = useMemo(
    () =>
      deriveWorkbenchPersonalisationSummary({
        setupReady: setupSummary.state === "ready",
        config,
      }),
    [config, setupSummary.state],
  );
  const stats = useMemo(
    () => buildProfileStats(connectorSummary, profile, profileReady),
    [connectorSummary, profile, profileReady],
  );

  const loadConfig = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setConnectorState({ status: "loading" });
    try {
      const res = await fetch("/api/workbench/config", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchConfigResponse
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(responseDetail(body, res.status));
      }

      const payload = body as WorkbenchConfigResponse | null;
      const nextConfig = payload?.config ?? null;
      setConnectorState({
        status: "loaded",
        config: nextConfig,
        google_readiness: payload?.google_readiness ?? null,
      });
      setConfigForm(getInitialWorkbenchConfigForm(nextConfig));
    } catch (err) {
      setConnectorState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const loadProfile = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setProfileState({ status: "loading" });
    try {
      const res = await fetch("/api/workbench/profile", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchProfileResponse
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(responseDetail(body, res.status));
      }

      setProfileState({
        status: "loaded",
        response: body as WorkbenchProfileResponse,
      });
    } catch (err) {
      setProfileState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const refreshProfileHub = useCallback(async () => {
    await Promise.all([loadConfig({ silent: true }), loadProfile({ silent: true })]);
  }, [loadConfig, loadProfile]);

  useEffect(() => {
    void refreshProfileHub();
  }, [refreshProfileHub]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadProfile({ silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadProfile]);

  useEffect(() => {
    const search = window.location.search;
    setOauthNotice(deriveWorkbenchOAuthNotice(search));

    if (isGoogleOAuthStartUrl(`${window.location.pathname}${search}`)) {
      window.history.replaceState(null, "", "/profile");
      void signIn("google", { callbackUrl: PROFILE_CALLBACK_URL });
    }
  }, []);

  useEffect(() => {
    if (profileReady) setShowProfileBuilder(false);
  }, [profileReady]);

  async function handleConfigSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupState({ status: "saving" });
    try {
      const res = await fetch("/api/workbench/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildWorkbenchConfigPayload(configForm)),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchConfigResponse
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) throw new Error(responseDetail(body, res.status));
      await refreshProfileHub();
      setSetupState({ status: "saved" });
    } catch (err) {
      setSetupState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleOnboardingDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOnboardingState({ status: "drafting" });
    try {
      const res = await fetch("/api/workbench/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "draft",
          payload: buildWorkbenchOnboardingPayload(onboardingForm, configForm),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { status?: string; draft?: WorkbenchOnboardingDraft; message?: string }
        | { error?: string; fields?: string[]; message?: string }
        | null;

      if (!res.ok || !body || !("draft" in body) || !body.draft) {
        const detail =
          body && "message" in body && body.message
            ? body.message
            : body && "fields" in body && body.fields?.length
              ? `Add ${body.fields.join(", ")}.`
              : responseDetail(body, res.status);
        throw new Error(detail);
      }

      setOnboardingState({ status: "drafted", draft: body.draft });
    } catch (err) {
      setOnboardingState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleOnboardingSave() {
    if (onboardingState.status !== "drafted") return;
    const draft = onboardingState.draft;
    setOnboardingState({ status: "saving", draft });
    try {
      const res = await fetch("/api/workbench/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "save",
          payload: buildWorkbenchOnboardingPayload(onboardingForm, configForm),
          draft,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { status?: string; message?: string }
        | { error?: string; message?: string }
        | null;

      if (!res.ok) throw new Error(responseDetail(body, res.status));
      await refreshProfileHub();
      setShowProfileBuilder(false);
      setOnboardingState({
        status: "saved",
        message:
          body && "message" in body && body.message
            ? body.message
            : "Profile saved.",
      });
    } catch (err) {
      setOnboardingState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCheck() {
    setSetupState({ status: "checking" });
    try {
      const res = await fetch("/api/workbench/check", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchCheckResponse
        | { error?: string; detail?: string }
        | null;

      if (!res.ok) throw new Error(responseDetail(body, res.status));
      const payload = body as WorkbenchCheckResponse | null;
      setHealthRows(toWorkbenchHealthRows(payload));
      setHealthGeneratedAt(payload?.generated_at ?? null);
      setSetupState({ status: "idle" });
      await refreshProfileHub();
    } catch (err) {
      setSetupState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleConnectorManagementAction(
    action: ConnectorManagementAction,
  ) {
    setConnectorManagementState({ status: "running", actionId: action.id });
    try {
      const res = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(action.payload),
      });
      const body = (await res.json().catch(() => null)) as
        | WorkbenchConnectorManagementResponse
        | null;

      if (!res.ok) throw new Error(responseDetail(body, res.status));

      setConnectorManagementState({
        status: "loaded",
        actionId: action.id,
        message:
          body?.message ?? body?.reason ?? `${action.label} request accepted.`,
      });

      if (body?.next_url) {
        if (isGoogleOAuthStartUrl(body.next_url)) {
          void signIn("google", { callbackUrl: PROFILE_CALLBACK_URL });
          return;
        }
        window.location.assign(body.next_url);
        return;
      }

      await handleCheck();
    } catch (err) {
      setConnectorManagementState({
        status: "error",
        actionId: action.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const shouldShowBuilder = showProfileBuilder || !profileReady;

  return (
    <div
      style={{
        minHeight: "calc(100vh - var(--shell-h))",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "30px 32px 48px",
        }}
      >
        <header>
          <MetaLabel>Profile</MetaLabel>
          <h1
            style={{
              margin: "8px 0 0",
              maxWidth: 680,
              fontFamily: "var(--font-plex-serif)",
              fontSize: 38,
              lineHeight: 1.08,
              fontWeight: 400,
              color: "var(--ink)",
            }}
          >
            Personalisation hub
          </h1>
        </header>

        <IdentityStrip
          name={name}
          email={email}
          initials={initials}
          stats={stats}
        />

        <div
          className="profile-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.08fr) minmax(320px, 0.92fr)",
            gap: 38,
            alignItems: "start",
            marginTop: 34,
          }}
        >
          <div style={{ display: "grid", gap: 22 }}>
            <PersonalisationCard
              profileState={profileState}
              profileReady={profileReady}
              personalisationSummary={personalisationSummary}
              onRefresh={() => loadProfile()}
              onEdit={() => setShowProfileBuilder(true)}
            />
            {shouldShowBuilder ? (
              <ProfileBuilder
                form={onboardingForm}
                state={onboardingState}
                hasProfileSeed={hasProfilePersonalisationSeed(config)}
                onFormChange={setOnboardingForm}
                onDraft={handleOnboardingDraft}
                onSave={handleOnboardingSave}
              />
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 22 }}>
            <ConnectorHub
              connectorSummary={connectorSummary}
              setupAffordances={setupAffordances}
              setupSummary={setupSummary}
              oauthNotice={oauthNotice}
              healthRows={healthRows}
              healthGeneratedAt={healthGeneratedAt}
              setupState={setupState}
              connectorManagementState={connectorManagementState}
              onCheck={handleCheck}
              onSetupNotion={() => window.location.assign(NOTION_SETUP_HREF)}
              onConnectGoogle={() =>
                signIn("google", { callbackUrl: PROFILE_CALLBACK_URL })
              }
              onConnectorManagementAction={handleConnectorManagementAction}
            />
            <ManualConfigPanel
              form={configForm}
              setupState={setupState}
              onFormChange={setConfigForm}
              onSave={handleConfigSave}
            />
          </div>
        </div>
      </div>
      <style jsx>{`
        @media (max-width: 980px) {
          .profile-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function PersonalisationCard({
  profileState,
  profileReady,
  personalisationSummary,
  onRefresh,
  onEdit,
}: {
  profileState: ProfileState;
  profileReady: boolean;
  personalisationSummary: ReturnType<typeof deriveWorkbenchPersonalisationSummary>;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const profile =
    profileState.status === "loaded" ? profileState.response.profile : null;
  const rows = profile ? profileRows(profile) : [];

  return (
    <ProfileSection
      title="Personalisation"
      meta={profileReady ? "Live from Notion" : "Setup"}
    >
      <div
        style={{
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
          padding: "18px 0",
          display: "grid",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            gap: 16,
          }}
        >
          <div>
            <StatusPill status={personalisationSummary.statusLabel} />
            <p
              style={{
                margin: "10px 0 0",
                maxWidth: 640,
                color: "var(--ink-dim)",
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {profileReady
                ? "Workbench uses this profile for tone, context, and judgement prompts. The card refreshes from your Notion second brain."
                : personalisationSummary.detail}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <QuietButton onClick={onRefresh}>Refresh</QuietButton>
            <QuietButton onClick={onEdit}>
              {profileReady ? "Update profile" : "Build profile"}
            </QuietButton>
          </div>
        </div>

        {profileState.status === "loading" ? (
          <MutedText>Loading your profile.</MutedText>
        ) : null}
        {profileState.status === "error" ? (
          <InlineStatus
            tone="error"
            message={sanitizeWorkbenchDetail(profileState.message)}
          />
        ) : null}
        {profileState.status === "loaded" && !profileReady ? (
          <MutedText>
            Fill in the short profile once. After that, this area becomes your
            persistent personalisation card.
          </MutedText>
        ) : null}

        {profileReady && profile ? (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              {rows.map((row) => (
                <FactRow key={row.label} label={row.label} value={row.value} />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                color: "var(--ink-faint)",
                fontFamily: "var(--font-plex-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <span>{profile.source_refs.length} profile sources</span>
              <span>
                Updated {formatCompactDate(profile.updated_at)}
              </span>
              {profile.warnings.length > 0 ? (
                <span>{profile.warnings.length} warnings</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </ProfileSection>
  );
}

function ProfileBuilder({
  form,
  state,
  hasProfileSeed,
  onFormChange,
  onDraft,
  onSave,
}: {
  form: WorkbenchOnboardingForm;
  state: WorkbenchOnboardingState;
  hasProfileSeed: boolean;
  onFormChange: (form: WorkbenchOnboardingForm) => void;
  onDraft: (event: FormEvent<HTMLFormElement>) => void;
  onSave: () => void;
}) {
  const busy = state.status === "drafting" || state.status === "saving";

  function updateField<K extends keyof WorkbenchOnboardingForm>(
    field: K,
    value: WorkbenchOnboardingForm[K],
  ) {
    onFormChange({ ...form, [field]: value });
  }

  function toggleListItem(
    field:
      | "work_type_chips"
      | "communication_style"
      | "challenge_style"
      | "helpful_context",
    value: string,
  ) {
    const selected = form[field];
    updateField(
      field,
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  }

  return (
    <ProfileSection title="Build Your Profile" meta="5 minutes">
      <form
        onSubmit={onDraft}
        style={{
          borderTop: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          paddingTop: 16,
        }}
      >
        <SetupInput
          label="Role / title"
          value={form.role_title}
          onChange={(value) => updateField("role_title", value)}
          required={!hasProfileSeed}
        />
        <SetupInput
          label="Other work"
          value={form.work_type_other}
          onChange={(value) => updateField("work_type_other", value)}
        />
        <label style={fieldLabelStyle("1 / -1")}>
          What are you working on?
          <textarea
            value={form.current_focus_bullets}
            onChange={(event) =>
              updateField("current_focus_bullets", event.target.value)
            }
            rows={3}
            required={!hasProfileSeed}
            style={inputStyle({ minHeight: 72, resize: "vertical" })}
            placeholder="A few bullets is enough."
          />
        </label>
        <SetupCheckboxGroup
          label="Work types"
          options={WORK_TYPE_OPTIONS}
          selected={form.work_type_chips}
          onToggle={(value) => toggleListItem("work_type_chips", value)}
        />
        <SetupCheckboxGroup
          label="Communication style"
          options={COMMUNICATION_STYLE_OPTIONS}
          selected={form.communication_style}
          onToggle={(value) => toggleListItem("communication_style", value)}
        />
        <SetupCheckboxGroup
          label="Challenge style"
          options={CHALLENGE_STYLE_OPTIONS}
          selected={form.challenge_style}
          onToggle={(value) => toggleListItem("challenge_style", value)}
        />
        <SetupCheckboxGroup
          label="Helpful context"
          options={HELPFUL_CONTEXT_OPTIONS}
          selected={form.helpful_context}
          onToggle={(value) => toggleListItem("helpful_context", value)}
        />
        <SetupInput
          label="Other context"
          value={form.helpful_context_other}
          onChange={(value) => updateField("helpful_context_other", value)}
        />
        <OnboardingPreview state={state} />
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <ActionButton type="submit" disabled={busy}>
            {state.status === "drafting" ? "Previewing" : "Preview profile"}
          </ActionButton>
          <ActionButton
            type="button"
            onClick={onSave}
            disabled={state.status !== "drafted"}
          >
            {state.status === "saving" ? "Saving" : "Save profile"}
          </ActionButton>
          <StateMessage state={state} />
        </div>
      </form>
    </ProfileSection>
  );
}

function ConnectorHub({
  connectorSummary,
  setupAffordances,
  setupSummary,
  oauthNotice,
  healthRows,
  healthGeneratedAt,
  setupState,
  connectorManagementState,
  onCheck,
  onSetupNotion,
  onConnectGoogle,
  onConnectorManagementAction,
}: {
  connectorSummary: WorkbenchConnectorSummary;
  setupAffordances: WorkbenchSetupAffordanceSummary;
  setupSummary: WorkbenchSetupSummary;
  oauthNotice: WorkbenchOAuthNotice;
  healthRows: WorkbenchHealthRow[];
  healthGeneratedAt: string | null;
  setupState: SetupState;
  connectorManagementState: ConnectorManagementState;
  onCheck: () => void;
  onSetupNotion: () => void;
  onConnectGoogle: () => void;
  onConnectorManagementAction: (action: ConnectorManagementAction) => void;
}) {
  return (
    <ProfileSection title="Connected Tools" meta="Setup">
      <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <StatusPill status={setupSummary.label} />
          <ActionButton
            type="button"
            onClick={onCheck}
            disabled={setupState.status === "checking"}
          >
            {setupState.status === "checking" ? "Checking" : "Check setup"}
          </ActionButton>
        </div>

        {oauthNotice ? <SetupNotice notice={oauthNotice} /> : null}
        <MutedText>{setupSummary.detail}</MutedText>

        <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
          <SetupActionRow
            affordance={setupAffordances.notion}
            managementState={connectorManagementState}
            onAction={onSetupNotion}
            onManagementAction={onConnectorManagementAction}
          />
          <SetupActionRow
            affordance={setupAffordances.googleWorkspace}
            managementState={connectorManagementState}
            onAction={onConnectGoogle}
            onManagementAction={onConnectorManagementAction}
          />
        </div>
        <ConnectorManagementStatus state={connectorManagementState} />
        <ConnectorList summary={connectorSummary} />
        <ConnectorHealthRows rows={healthRows} generatedAt={healthGeneratedAt} />
      </div>
    </ProfileSection>
  );
}

function ManualConfigPanel({
  form,
  setupState,
  onFormChange,
  onSave,
}: {
  form: WorkbenchConfigForm;
  setupState: SetupState;
  onFormChange: (form: WorkbenchConfigForm) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function updateField(field: keyof WorkbenchConfigForm, value: string) {
    onFormChange({ ...form, [field]: value });
  }

  return (
    <details style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
      <summary
        style={{
          cursor: "pointer",
          color: "var(--ink-dim)",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Manual connector fields
      </summary>
      <form
        onSubmit={onSave}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginTop: 12,
        }}
      >
        <SetupInput
          label="Notion parent"
          value={form.notion_parent_page_id}
          onChange={(value) => updateField("notion_parent_page_id", value)}
        />
        <SetupInput
          label="Drive folder"
          value={form.drive_folder_id}
          onChange={(value) => updateField("drive_folder_id", value)}
        />
        <div style={{ gridColumn: "1 / -1" }}>
          <SetupInput
            label="Drive URL"
            value={form.drive_folder_url}
            onChange={(value) => updateField("drive_folder_url", value)}
          />
        </div>
        <SetupInput
          label="Communication style"
          value={form.voice_register}
          onChange={(value) => updateField("voice_register", value)}
        />
        <SetupInput
          label="Challenge style"
          value={form.feedback_style}
          onChange={(value) => updateField("feedback_style", value)}
        />
        <label style={fieldLabelStyle("1 / -1")}>
          Work types
          <textarea
            value={form.friction_tasks}
            onChange={(event) =>
              updateField("friction_tasks", event.target.value)
            }
            rows={2}
            style={inputStyle({ minHeight: 54, resize: "vertical" })}
          />
        </label>
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <ActionButton type="submit" disabled={setupState.status === "saving"}>
            {setupState.status === "saving" ? "Saving" : "Save fields"}
          </ActionButton>
          {setupState.status === "saved" ? <MutedText>Saved.</MutedText> : null}
          {setupState.status === "error" ? (
            <InlineStatus
              tone="error"
              message={sanitizeWorkbenchDetail(setupState.message)}
            />
          ) : null}
        </div>
      </form>
    </details>
  );
}

function IdentityStrip({
  name,
  email,
  initials,
  stats,
}: {
  name: string;
  email: string;
  initials: string;
  stats: Array<{ label: string; value: string; subValue?: string }>;
}) {
  return (
    <section
      className="identity-strip"
      style={{
        marginTop: 30,
        padding: "20px 0",
        borderTop: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 26,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          border: "1px solid var(--rule-2)",
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-plex-mono)",
          fontSize: 15,
          letterSpacing: "0.06em",
          color: "var(--ink-dim)",
          background: "var(--panel)",
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
        <div
          style={{
            fontFamily: "var(--font-plex-serif)",
            fontSize: 24,
            lineHeight: 1.1,
            color: "var(--ink)",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {email}
        </div>
      </div>
      <div
        className="identity-stats"
        style={{
          display: "flex",
          gap: 26,
          borderLeft: "1px solid var(--rule)",
          paddingLeft: 26,
        }}
      >
        {stats.map((stat) => (
          <StatBlock key={stat.label} stat={stat} />
        ))}
      </div>
      <style jsx>{`
        @media (max-width: 780px) {
          .identity-strip {
            grid-template-columns: auto minmax(0, 1fr) !important;
          }

          .identity-stats {
            grid-column: 1 / -1;
            border-left: 0 !important;
            border-top: 1px solid var(--rule);
            padding-left: 0 !important;
            padding-top: 16px;
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px !important;
          }
        }
      `}</style>
    </section>
  );
}

function StatBlock({
  stat,
}: {
  stat: { label: string; value: string; subValue?: string };
}) {
  return (
    <div style={{ minWidth: 90, display: "grid", gap: 2 }}>
      <MetaLabel>{stat.label}</MetaLabel>
      <div
        style={{
          fontFamily: "var(--font-plex-serif)",
          fontSize: 22,
          lineHeight: 1.1,
          color: "var(--ink)",
        }}
      >
        {stat.value}
      </div>
      {stat.subValue ? (
        <div
          style={{
            fontFamily: "var(--font-plex-mono)",
            fontSize: 10,
            color: "var(--ink-dim)",
          }}
        >
          {stat.subValue}
        </div>
      ) : null}
    </div>
  );
}

function ProfileSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-plex-serif)",
            fontSize: 22,
            lineHeight: 1.1,
            fontWeight: 400,
            color: "var(--ink)",
          }}
        >
          {title}
        </h2>
        <MetaLabel>{meta}</MetaLabel>
      </div>
      {children}
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="fact-row"
      style={{
        display: "grid",
        gridTemplateColumns: "150px minmax(0, 1fr)",
        gap: 16,
        alignItems: "baseline",
        padding: "11px 0",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <MetaLabel>{label}</MetaLabel>
      <div
        style={{
          minWidth: 0,
          color: "var(--ink)",
          fontSize: 14,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SetupActionRow({
  affordance,
  onAction,
  managementState,
  onManagementAction,
}: {
  affordance: WorkbenchSetupAffordance;
  onAction: () => void;
  managementState: ConnectorManagementState;
  onManagementAction: (action: ConnectorManagementAction) => void;
}) {
  const managementActions = deriveWorkbenchConnectorManagementActions(affordance);
  const repairAction = managementActions.find(
    (action) => action.payload.action === "repair",
  );
  const secondaryActions = managementActions.filter(
    (action) => action.payload.action !== "repair",
  );
  const primaryAction = repairAction ?? null;
  const primaryRunning =
    primaryAction &&
    managementState.status === "running" &&
    managementState.actionId === primaryAction.id;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--rule)",
        padding: "10px 0",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: "var(--ink)" }}>
          {affordance.label}
        </div>
        <div
          style={{
            marginTop: 3,
            color: "var(--ink-dim)",
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          {affordance.detail}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "end" }}>
        <StatusPill status={affordance.statusLabel} />
        <ActionButton
          type="button"
          onClick={() =>
            primaryAction ? onManagementAction(primaryAction) : onAction()
          }
          disabled={primaryAction ? Boolean(primaryRunning) : affordance.disabled}
        >
          {primaryRunning ? "Working" : affordance.buttonLabel}
        </ActionButton>
        {secondaryActions.map((action) => {
          const running =
            managementState.status === "running" &&
            managementState.actionId === action.id;
          return (
            <ActionButton
              key={action.id}
              type="button"
              onClick={() => onManagementAction(action)}
              disabled={running}
            >
              {running ? "Working" : action.label}
            </ActionButton>
          );
        })}
      </div>
    </div>
  );
}

function ConnectorList({ summary }: { summary: WorkbenchConnectorSummary }) {
  return (
    <div style={{ display: "grid", marginTop: 16 }}>
      {summary.rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "grid",
            gridTemplateColumns: "116px 112px minmax(0, 1fr)",
            gap: 8,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid var(--rule)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--ink)" }}>{row.label}</span>
          <StatusPill status={row.status} />
          <span style={{ color: "var(--ink-dim)", lineHeight: 1.35 }}>
            {row.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConnectorHealthRows({
  rows,
  generatedAt,
}: {
  rows: WorkbenchHealthRow[];
  generatedAt: string | null;
}) {
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 7 }}>
      <MetaLabel>
        Health {generatedAt ? formatCompactDate(generatedAt) : ""}
      </MetaLabel>
      {rows.map((row) => (
        <div
          key={row.source}
          style={{
            display: "grid",
            gridTemplateColumns: "84px 94px minmax(0, 1fr)",
            gap: 8,
            alignItems: "center",
            fontSize: 11,
            lineHeight: 1.3,
          }}
        >
          <span style={{ fontFamily: "var(--font-plex-mono)" }}>
            {row.source}
          </span>
          <StatusPill status={row.status} />
          <span style={{ color: "var(--ink-dim)" }}>
            {sanitizeWorkbenchDetail(row.reason, "Clear")}
          </span>
        </div>
      ))}
    </div>
  );
}

function OnboardingPreview({ state }: { state: WorkbenchOnboardingState }) {
  if (state.status !== "drafted" && state.status !== "saving") return null;
  const draft = state.draft;
  const rows = [
    { label: "Personal Profile", bullets: draft.personal_profile.bullets },
    { label: "Working On", bullets: draft.working_on.bullets },
    { label: "Voice", bullets: draft.voice.bullets },
  ];

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderTop: "1px solid var(--rule)",
        paddingTop: 10,
        display: "grid",
        gap: 9,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ fontSize: 12, lineHeight: 1.4 }}>
          <MetaLabel>{row.label}</MetaLabel>
          <ul style={{ margin: "5px 0 0", paddingLeft: 16 }}>
            {row.bullets.map((bullet, index) => (
              <li key={`${row.label}-${index}`}>{bullet}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SetupNotice({ notice }: { notice: NonNullable<WorkbenchOAuthNotice> }) {
  return (
    <InlineStatus
      tone={notice.tone === "error" ? "error" : "info"}
      message={`${notice.label}: ${notice.detail}`}
    />
  );
}

function ConnectorManagementStatus({
  state,
}: {
  state: ConnectorManagementState;
}) {
  if (state.status === "idle" || state.status === "running") return null;
  return (
    <InlineStatus
      tone={state.status === "error" ? "error" : "info"}
      message={sanitizeWorkbenchDetail(state.message, "Connector updated.")}
    />
  );
}

function StateMessage({ state }: { state: WorkbenchOnboardingState }) {
  if (state.status === "idle" || state.status === "drafting") return null;
  if (state.status === "error") {
    return (
      <InlineStatus
        tone="error"
        message={sanitizeWorkbenchDetail(state.message)}
      />
    );
  }
  if (state.status === "saved") {
    return <MutedText>{state.message}</MutedText>;
  }
  return <MutedText>Preview ready.</MutedText>;
}

function SetupCheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      <MetaLabel>{label}</MetaLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              style={{
                border: "1px solid var(--rule)",
                background: checked ? "var(--bg)" : "var(--panel)",
                color: checked ? "var(--ink)" : "var(--ink-dim)",
                padding: "6px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                lineHeight: 1.2,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option)}
                style={{ margin: 0 }}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SetupInput({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label style={fieldLabelStyle()}>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        style={inputStyle()}
      />
    </label>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  type,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: "1px solid var(--rule-2)",
        color: disabled ? "var(--ink-faint)" : "var(--ink)",
        padding: "7px 10px",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function QuietButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-dim)",
        padding: "7px 10px",
        border: "1px solid var(--rule-2)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function InlineStatus({
  tone,
  message,
}: {
  tone: "info" | "error";
  message: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        border: "1px solid var(--rule)",
        padding: "8px 10px",
        color: tone === "error" ? "var(--danger, #9f1d1d)" : "var(--ink-dim)",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {message}
    </div>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--ink-dim)", fontSize: 13, lineHeight: 1.45 }}>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        width: "fit-content",
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: statusColor(status),
        border: "1px solid var(--rule-2)",
        padding: "3px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {friendlyStatus(status)}
    </span>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-plex-mono)",
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--ink-faint)",
      }}
    >
      {children}
    </span>
  );
}

function profileRows(profile: WorkbenchProfileContext) {
  return [
    profile.role ? { label: "Role", value: profile.role } : null,
    profile.current_work.length
      ? { label: "Working on", value: profile.current_work.join("\n") }
      : null,
    profile.communication_style
      ? { label: "Communication", value: profile.communication_style }
      : null,
    profile.challenge_style
      ? { label: "Challenge me by", value: profile.challenge_style }
      : null,
    profile.working_context.length
      ? { label: "Useful context", value: profile.working_context.join("\n") }
      : null,
    profile.do_not_assume.length
      ? { label: "Do not assume", value: profile.do_not_assume.join("\n") }
      : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
}

function buildProfileStats(
  connectorSummary: WorkbenchConnectorSummary,
  profile: WorkbenchProfileContext | null,
  profileReady: boolean,
) {
  const connected = connectorSummary.rows.filter(
    (row) => row.status === "ready",
  ).length;
  return [
    {
      label: "Connected",
      value: `${connected} / ${connectorSummary.rows.length}`,
      subValue: "Tools",
    },
    {
      label: "Profile",
      value: profileReady ? "Live" : "Setup",
      subValue: profileReady ? "Notion-backed" : "Needs basics",
    },
    {
      label: "Sources",
      value: String(profile?.source_refs.length ?? 0),
      subValue: profile?.updated_at ? formatCompactDate(profile.updated_at) : "No profile yet",
    },
  ];
}

function hasProfilePersonalisationSeed(
  config:
    | {
        voice_register?: string | null;
        feedback_style?: string | null;
        friction_tasks?: string[] | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    config?.voice_register?.trim() ||
      config?.feedback_style?.trim() ||
      config?.friction_tasks?.some((item) => item.trim()),
  );
}

function fieldLabelStyle(gridColumn?: string): React.CSSProperties {
  return {
    gridColumn,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    color: "var(--ink-faint)",
    fontFamily: "var(--font-plex-mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  };
}

function inputStyle(
  extra: React.CSSProperties = {},
): React.CSSProperties {
  return {
    width: "100%",
    border: "1px solid var(--rule)",
    background: "var(--bg)",
    color: "var(--ink)",
    padding: "8px 9px",
    fontFamily: "var(--font-plex-sans)",
    fontSize: 13,
    lineHeight: 1.35,
    textTransform: "none",
    letterSpacing: 0,
    ...extra,
  };
}

function responseDetail(
  body: unknown,
  status: number,
  fallback = `HTTP ${status}`,
): string {
  if (body && typeof body === "object") {
    if ("detail" in body && typeof body.detail === "string") return body.detail;
    if ("message" in body && typeof body.message === "string") return body.message;
    if ("error" in body && typeof body.error === "string") return body.error;
    if ("reason" in body && typeof body.reason === "string") return body.reason;
  }
  return fallback;
}

function isGoogleOAuthStartUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return (
      (url.pathname === "/workbench" || url.pathname === "/profile") &&
      url.searchParams.get("google_oauth") === "start"
    );
  } catch {
    return value === PROFILE_GOOGLE_SETUP_HREF;
  }
}

function friendlyStatus(status: string): string {
  const normalized = status.toLowerCase().replace(/_/g, " ");
  if (normalized === "ready") return "Connected";
  if (normalized === "ok") return "Clear";
  if (normalized === "unavailable") return "Needs setup";
  if (normalized === "error") return "Check setup";
  return status;
}

function statusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (
    normalized === "ready" ||
    normalized === "connected" ||
    normalized === "ok" ||
    normalized === "live"
  ) {
    return "var(--c-cornerstone)";
  }
  if (normalized.includes("error") || normalized.includes("failed")) {
    return "var(--danger, #9f1d1d)";
  }
  return "var(--ink-dim)";
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "CO";
}
