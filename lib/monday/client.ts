const MONDAY_GRAPHQL_ENDPOINT = "https://api.monday.com/v2";

type FetchLike = typeof fetch;

export type MondayGraphQlRequest = {
  query: string;
  variables?: Record<string, unknown>;
};

export type MondayClientOutcome<T> =
  | { status: "ok"; data: T }
  | {
      status: "error";
      reason:
        | "missing_access_token"
        | "writes_not_allowed"
        | "http_error"
        | "graphql_error"
        | "invalid_response"
        | "network_error";
      message: string;
    };

export type MondayCurrentUserResponse = {
  me: {
    id: string;
    name: string;
    email?: string | null;
    account?: {
      id: string;
      name?: string | null;
    } | null;
  };
};

export type MondayItemSummaryResponse = {
  items: Array<{
    id: string;
    name: string;
    state?: string | null;
    updated_at?: string | null;
    url?: string | null;
    board?: {
      id: string;
      name?: string | null;
    } | null;
    group?: {
      id: string;
      title?: string | null;
    } | null;
  }>;
};

export type MondayClient = {
  request<T>(request: MondayGraphQlRequest): Promise<MondayClientOutcome<T>>;
  getCurrentUser(): Promise<MondayClientOutcome<MondayCurrentUserResponse>>;
  getItemsByIds(
    itemIds: string[],
  ): Promise<MondayClientOutcome<MondayItemSummaryResponse>>;
};

type CreateMondayClientInput = {
  accessToken: string | null | undefined;
  fetch?: FetchLike;
  endpoint?: string;
};

export function createMondayClient({
  accessToken,
  fetch: fetchImpl = fetch,
  endpoint = MONDAY_GRAPHQL_ENDPOINT,
}: CreateMondayClientInput): MondayClient {
  const normalizedAccessToken = accessToken?.trim();

  return {
    async request<T>({
      query,
      variables,
    }: MondayGraphQlRequest): Promise<MondayClientOutcome<T>> {
      if (!normalizedAccessToken) {
        return {
          status: "error",
          reason: "missing_access_token",
          message: "monday access token is unavailable.",
        };
      }

      if (isMutation(query)) {
        return {
          status: "error",
          reason: "writes_not_allowed",
          message: "monday writes are disabled in the MVP client boundary.",
        };
      }

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${normalizedAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
        });

        if (!response.ok) {
          return {
            status: "error",
            reason: "http_error",
            message: `monday API returned ${response.status}.`,
          };
        }

        const payload = (await response.json()) as {
          data?: T;
          errors?: Array<{ message?: unknown }>;
        };

        if (payload.errors?.length) {
          return {
            status: "error",
            reason: "graphql_error",
            message: toGraphQlErrorMessage(payload.errors),
          };
        }

        if (!("data" in payload)) {
          return {
            status: "error",
            reason: "invalid_response",
            message: "monday API response did not include data.",
          };
        }

        return { status: "ok", data: payload.data as T };
      } catch (error) {
        return {
          status: "error",
          reason: "network_error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    getCurrentUser() {
      return this.request<MondayCurrentUserResponse>({
        query: `
          query MondayCurrentUser {
            me {
              id
              name
              email
              account {
                id
                name
              }
            }
          }
        `,
      });
    },

    getItemsByIds(itemIds) {
      return this.request<MondayItemSummaryResponse>({
        query: `
          query MondayItemsByIds($itemIds: [ID!]!) {
            items(ids: $itemIds) {
              id
              name
              state
              updated_at
              url
              board {
                id
                name
              }
              group {
                id
                title
              }
            }
          }
        `,
        variables: { itemIds },
      });
    },
  };
}

function isMutation(query: string): boolean {
  return /^\s*mutation\b/i.test(query);
}

function toGraphQlErrorMessage(errors: Array<{ message?: unknown }>): string {
  return errors
    .map((error) =>
      typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : "Unknown monday GraphQL error.",
    )
    .join("; ");
}
