import { describe, expect, it } from "vitest";
import { APPROVED_TEMPLATES, approvedParams, approvedTemplate } from "../../../src/config/approved-templates.ts";
import { TEMPLATES } from "../../../src/config/message-templates.ts";

const VARIABLES = /\{\{(\d+)\}\}/g;

describe("the templates submitted to WhatsApp", () => {
  it("number their variables from 1 in the order the text uses them, each once", () => {
    for (const template of APPROVED_TEMPLATES.filter((each) => each.category === "utility")) {
      const order = [...template.body.matchAll(VARIABLES)].map((match) => Number(match[1]));
      const firsts = order.filter((value, index) => order.indexOf(value) === index);
      expect(firsts, template.name).toEqual(firsts.map((_value, index) => index + 1));
      expect(template.takes, template.name).toHaveLength(firsts.length);
    }
  });

  it("neither start nor end on a variable, which WhatsApp refuses", () => {
    for (const template of APPROVED_TEMPLATES.filter((each) => each.category === "utility")) {
      expect(template.body, template.name).not.toMatch(/^\{\{\d+\}\}/);
      expect(template.body, template.name).not.toMatch(/\{\{\d+\}\}$/);
    }
  });

  it("carry no link in the text: a link is a button", () => {
    for (const template of APPROVED_TEMPLATES) expect(template.body, template.name).not.toMatch(/https?:\/\//);
  });

  it("put our params where the renumbered text takes them", () => {
    const arrived = approvedTemplate("technician_arrived_v1");
    if (arrived === null) throw new Error("technician_arrived_v1 is submitted");
    expect(arrived.body).toBe("Hi {{1}}, {{2}} is at your door for your {{3}}.");
    expect(approvedParams(arrived, ["Arjun", "service visit", "Thu", "12 to 4 pm", "Imran"])).toEqual([
      "Arjun",
      "Imran",
      "service visit",
    ]);
    expect(approvedParams(arrived, ["Arjun"])).toBeNull();
  });

  it("send a login code as an authentication template, and leave out the stop line and STOP's answer", () => {
    expect(approvedTemplate("login_code_v1")).toMatchObject({
      category: "authentication",
      buttons: [{ kind: "copy_code" }],
    });
    expect(approvedTemplate("stop_link_v1")).toBeNull();
    expect(approvedTemplate("messages_stopped_v1")).toBeNull();
    expect(APPROVED_TEMPLATES).toHaveLength(Object.keys(TEMPLATES).length - 2);
  });

  it("give every reminder sent with a stop link a button to stop it", () => {
    for (const name of ["visit_reminder_v1", "next_visit_due_v1", "credits_expiring_v1", "launch_alert_v1"] as const) {
      expect(
        approvedTemplate(name)?.buttons.some((button) => button.kind === "stop"),
        name,
      ).toBe(true);
    }
  });
});
