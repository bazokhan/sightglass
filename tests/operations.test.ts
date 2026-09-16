import { describe, expect, it } from "vitest";
import { findProductRelease } from "../apps/server/src/operations.js";

describe("update detection", () => {
  it("selects and normalizes the core package release", () => {
    expect(findProductRelease([
      { tag_name: "@bazokhan/sightglass-prisma@0.1.1", html_url: "https://example.test/prisma" },
      { tag_name: "@bazokhan/sightglass-core@0.1.1", html_url: "https://example.test/core" },
    ])).toEqual({ version: "0.1.1", url: "https://example.test/core" });
  });

  it("supports a conventional product release tag", () => {
    expect(findProductRelease([{ tag_name: "v1.2.3" }])).toEqual({ version: "1.2.3" });
  });
});
