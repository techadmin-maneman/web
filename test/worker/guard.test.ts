import { describe, expect, it } from "vitest";
import { ConfigError, validateStaticConfig } from "../../src/guard.ts";

const REAL = { IMAGE_PROVIDER: "ailabtools", CRM_PROVIDER: "zoho", MESSAGING_PROVIDER: "bsp" };
const STUBS = { IMAGE_PROVIDER: "stub", CRM_PROVIDER: "stub", MESSAGING_PROVIDER: "stub" };

function problemsOf(env: Record<string, unknown>): readonly string[] {
  try {
    validateStaticConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("validateStaticConfig", () => {
  it("accepts local with stubs", () => {
    expect(validateStaticConfig({ ENVIRONMENT: "local", ...STUBS })).toEqual({
      environment: "local",
      providers: STUBS,
    });
  });

  it("accepts production with real providers", () => {
    expect(validateStaticConfig({ ENVIRONMENT: "production", ...REAL }).environment).toBe("production");
  });

  it("allows staging to hold a stub, for a provider not yet chosen", () => {
    expect(validateStaticConfig({ ENVIRONMENT: "staging", ...REAL, MESSAGING_PROVIDER: "stub" }).environment).toBe(
      "staging",
    );
  });

  it.each([
    [{ ...STUBS }, "ENVIRONMENT is not set"],
    [{ ENVIRONMENT: "", ...STUBS }, "ENVIRONMENT is not set"],
    [{ ENVIRONMENT: "prod", ...STUBS }, 'ENVIRONMENT has unknown value "prod"'],
  ])("refuses a missing or unknown ENVIRONMENT (%o)", (env, problem) => {
    expect(problemsOf(env)).toContain(problem);
  });

  it("refuses a production Worker holding any stub provider, naming each one", () => {
    expect(problemsOf({ ENVIRONMENT: "production", ...REAL, CRM_PROVIDER: "stub" })).toEqual([
      "CRM_PROVIDER is a stub in production",
    ]);
    expect(problemsOf({ ENVIRONMENT: "production", ...STUBS })).toHaveLength(3);
  });

  it("refuses a missing or unknown provider", () => {
    expect(problemsOf({ ENVIRONMENT: "local", CRM_PROVIDER: "stub", MESSAGING_PROVIDER: "stub" })).toEqual([
      "IMAGE_PROVIDER must be one of ailabtools, stub",
    ]);
    expect(problemsOf({ ENVIRONMENT: "local", ...STUBS, CRM_PROVIDER: "salesforce" })).toEqual([
      "CRM_PROVIDER must be one of zoho, stub",
    ]);
  });

  it("reports every problem at once in the error message", () => {
    expect(() => validateStaticConfig({ ENVIRONMENT: "production", ...STUBS })).toThrow(
      /refuses to start: IMAGE_PROVIDER is a stub in production; CRM_PROVIDER/,
    );
  });
});
