import { describe, expect, it, vi } from "vitest";
import { createMondayClient } from "@/lib/monday/client";

describe("monday GraphQL client", () => {
  it("constructs authenticated read-only GraphQL requests", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { me: { id: "user_123", name: "Malik" } } }),
    );
    const client = createMondayClient({
      accessToken: "monday-access-token",
      fetch: fetchMock,
    });

    const result = await client.request<{ me: { id: string; name: string } }>({
      query: "query CurrentUser { me { id name } }",
      variables: { includeAccount: true },
    });

    expect(result).toEqual({
      status: "ok",
      data: { me: { id: "user_123", name: "Malik" } },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: "Bearer monday-access-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "query CurrentUser { me { id name } }",
        variables: { includeAccount: true },
      }),
      cache: "no-store",
    });
  });

  it("returns safe error outcomes for GraphQL and HTTP failures", async () => {
    const graphQlClient = createMondayClient({
      accessToken: "monday-access-token",
      fetch: vi.fn(async () =>
        Response.json({
          errors: [{ message: "Column does not exist", path: ["items"] }],
        }),
      ),
    });

    await expect(
      graphQlClient.request({ query: "query Items { items(ids: [1]) { id } }" }),
    ).resolves.toEqual({
      status: "error",
      reason: "graphql_error",
      message: "Column does not exist",
    });

    const httpClient = createMondayClient({
      accessToken: "monday-access-token",
      fetch: vi.fn(async () => new Response("rate limited", { status: 429 })),
    });

    await expect(
      httpClient.request({ query: "query CurrentUser { me { id } }" }),
    ).resolves.toEqual({
      status: "error",
      reason: "http_error",
      message: "monday API returned 429.",
    });
  });

  it("rejects mutations so the MVP client cannot perform autonomous writes", async () => {
    const fetchMock = vi.fn();
    const client = createMondayClient({
      accessToken: "monday-access-token",
      fetch: fetchMock,
    });

    await expect(
      client.request({
        query: "mutation PostUpdate { create_update(item_id: 1, body: \"done\") { id } }",
      }),
    ).resolves.toEqual({
      status: "error",
      reason: "writes_not_allowed",
      message: "monday writes are disabled in the MVP client boundary.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provides typed read helpers for current user and items", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          me: {
            id: "user_123",
            name: "Malik",
            email: "malik@example.com",
            account: { id: "account_123", name: "Charlie Oscar" },
          },
        },
      }),
    );
    const client = createMondayClient({
      accessToken: "monday-access-token",
      fetch: fetchMock,
    });

    await expect(client.getCurrentUser()).resolves.toEqual({
      status: "ok",
      data: {
        me: {
          id: "user_123",
          name: "Malik",
          email: "malik@example.com",
          account: { id: "account_123", name: "Charlie Oscar" },
        },
      },
    });
  });
});
