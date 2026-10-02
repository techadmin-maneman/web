// Which tier of CI an event runs (scripts/lib/ci-tier.ts; docs/decisions/0006-deployment-pipeline.md, "Two tiers").

import { describe, expect, it } from "vitest";
import { ciTier, type CiEvent } from "../../scripts/lib/ci-tier.ts";

const push = (overrides: Partial<CiEvent> = {}): CiEvent => ({
  event: "pull_request",
  action: "synchronize",
  draft: false,
  label: "",
  labels: [],
  ...overrides,
});

describe("the CI tier", () => {
  it("is quick for every push to a pull request, draft or ready", () => {
    expect(ciTier(push())).toBe("quick");
    expect(ciTier(push({ draft: true }))).toBe("quick");
    expect(ciTier(push({ action: "opened", draft: true }))).toBe("quick");
  });

  it("is full once a pull request is ready for review, or opened ready", () => {
    expect(ciTier(push({ action: "ready_for_review" }))).toBe("full");
    expect(ciTier(push({ action: "opened" }))).toBe("full");
    expect(ciTier(push({ action: "reopened" }))).toBe("full");
  });

  it("is full when the full-ci label is added, and on every push while it is on", () => {
    expect(ciTier(push({ action: "labeled", label: "full-ci", labels: ["full-ci"] }))).toBe("full");
    expect(ciTier(push({ labels: ["full-ci"] }))).toBe("full");
    expect(ciTier(push({ action: "labeled", label: "docs", labels: ["docs", "full-ci"] }))).toBe("quick");
  });

  it("is full for a staging deploy, which checks what merged", () => {
    expect(ciTier(push({ event: "push", action: "" }))).toBe("full");
  });
});
