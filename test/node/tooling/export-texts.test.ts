import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copyFiles, messageTexts, placeholderTexts } from "../../../scripts/lib/texts.ts";
import { TEMPLATES } from "../../../src/config/message-templates.ts";

describe("the texts file", () => {
  it("holds every WhatsApp message, with the note written above it", () => {
    const messages = messageTexts(TEMPLATES, readFileSync("src/config/message-templates.ts", "utf8"));
    expect(messages.map((message) => message.name)).toEqual(Object.keys(TEMPLATES));
    const reminder = messages.find((message) => message.name === "no_show_missed_v1");
    expect(reminder?.note).toContain("Ops' ruling on a visit the client was not home for");
  });

  it("holds every line of copy marked PLACEHOLDER, counted apart from how the file finds them", () => {
    const files = copyFiles(process.cwd());
    const marks = files.flatMap(({ path, source }) =>
      source
        .split("\n")
        .map((line, index) => ({ id: `${path}:${String(index + 1)}`, line }))
        .filter(
          ({ line }) => /\bPLACEHOLDER\b/.test(line) && /^\s*(\/\/|\*|\/\*|\{\/\*|<!--)|\/\/.*PLACEHOLDER/.test(line),
        ),
    );
    const found = placeholderTexts(files);
    expect(found.map((item) => item.id).sort()).toEqual(marks.map((mark) => mark.id).sort());
  });

  it("gives each line of copy the code below its mark, so the owner reads the words themselves", () => {
    const source = [
      "export const login = {",
      "  // PLACEHOLDER: the design draws no session that ended while the app was open.",
      '  ended: "Your session has ended. Log in again.",',
      "};",
    ].join("\n");
    const [ended] = placeholderTexts([{ path: "apps/app/src/content.ts", source }]);
    expect(ended?.id).toBe("apps/app/src/content.ts:2");
    expect(ended?.note).toContain("the design draws no session that ended");
    expect(ended?.source).toContain("Your session has ended");
  });

  it("leaves the consent notices out of what may be edited", () => {
    const paths = copyFiles(process.cwd()).map((file) => file.path);
    expect(paths).not.toContain("src/config/notices.ts");
    expect(paths).not.toContain("src/config/message-templates.ts");
  });
});
