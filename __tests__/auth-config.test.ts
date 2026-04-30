import { describe, expect, it } from "vitest";
import authConfig from "@/auth.config";

describe("Auth config", () => {
  it("provides a development fallback secret so local Next/Auth routes do not throw MissingSecret", () => {
    expect(authConfig.secret).toBeTruthy();
  });
});
