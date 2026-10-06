// The business inputs ops set for themselves, behind Access (Ops Console, the
// Settings section the design draws; docs/decisions/0061-ops-editable-inputs.md). The rules are here; the price
// book is ./prices.ts and the service area ./service-area.ts.
//   GET  /api/settings              every rule ops may change, with its unit and its bounds
//   POST /api/settings/:name        set one, or send null to put the default back
//   GET  /api/prices                the price book, with the row in force marked
//   POST /api/prices                a price from the date it applies, for a service or a late fee
//   POST /api/prices/withdraw       a price still to come, taken back
//   POST /api/prices/correct        a price still to come, taken back and set again, in one batch
//   GET  /api/service-area          every pincode, its city, whether we go there and who waits there
//   POST /api/service-area          which pincodes we go to, from when, and what their areas are called
//   POST /api/pincodes              a pincode the service area does not hold, added unserved
//
// A change here needs no release. Every one records the Access identity behind
// it, what the value was and what it is now, in the same batch as the change
// itself (ADR 0031). Serving a pincode launches it, as the waitlist's launch
// does (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A
// visit's price is its service's, so it is set only for a service the console
// holds, and not from the day it is retired by; the services themselves are
// src/routes/ops/services.ts's (docs/decisions/0085-services-ops-can-edit.md).

import { createRoute, z } from "@hono/zod-openapi";
import { setOpsSetting, settingStates } from "../../domain/ops/ops-settings.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import {
  boundsOf,
  checkValue,
  conflictOf,
  isChoice,
  OPS_SETTINGS,
  settingNamed,
  type NumberSetting,
} from "../../policy/ops-settings.ts";

/** One number, or one per key: the two shapes a rule of numbers takes. */
const NumberValue = z.union([z.number().int(), z.record(z.string(), z.number().int())]);

/** One choice per key: the shape a rule of choices takes. */
const ChoiceValue = z.record(z.string(), z.string());

/** The rules ops may set, by name: the listing names them as the path that sets one does. */
const SettingName = z.enum(OPS_SETTINGS.map((setting) => setting.name) as [string, ...string[]]);

/** What every rule says of itself, whatever its figures are. */
const Described = {
  name: SettingName,
  title: z.string(),
  note: z.string(),
  set_by: z.union([z.string(), z.null()]),
  set_at: z.union([z.iso.datetime(), z.null()]),
};

const NumberRuleSchema = z
  .object({
    ...Described,
    kind: z.literal("number"),
    unit: z.string(),
    min: z.number().int(),
    max: z.number().int(),
    keys: z
      .union([z.array(z.string()), z.literal("open"), z.null()])
      .openapi({ description: 'null for one number, a list where the keys are fixed, "open" where ops name them.' }),
    bounds: z
      .union([
        z.record(z.string(), z.object({ min: z.number().int(), max: z.number().int(), unit: z.string() }).strict()),
        z.null(),
      ])
      .openapi({
        description:
          "Each key's own bounds and unit, where a keyed rule's figures measure different things; null where every " +
          "figure takes min to max, in unit.",
      }),
    value: NumberValue,
    default: NumberValue.openapi({ description: "The committed figure, in force until somebody sets one." }),
  })
  .strict()
  .openapi("NumberRule");

const ChoiceRuleSchema = z
  .object({
    ...Described,
    kind: z.literal("choice"),
    keys: z.array(z.string()),
    choices: z.record(z.string(), z.array(z.string())).openapi({
      description: "What each key may be: a kind of visit with no late fee in the price book is offered none.",
    }),
    value: ChoiceValue,
    default: ChoiceValue.openapi({ description: "The committed choices, in force until somebody sets them." }),
  })
  .strict()
  .openapi("ChoiceRule");

const SettingSchema = z.discriminatedUnion("kind", [NumberRuleSchema, ChoiceRuleSchema]).openapi("OpsSetting");

const settingsRoute = createRoute({
  method: "get",
  path: "/api/settings",
  summary: "Every business rule ops may change, with its unit, its bounds and who last set it",
  responses: {
    200: { description: "The rules", ...json(z.object({ settings: z.array(SettingSchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const setSettingRoute = createRoute({
  method: "post",
  path: "/api/settings/{name}",
  summary: "Set one rule, or send a null value to put the committed default back",
  request: {
    params: z.object({ name: SettingName }),
    body: {
      required: true,
      ...json(
        z
          .object({ value: z.union([NumberValue, ChoiceValue, z.null()]) })
          .strict()
          .openapi("SettingChange"),
      ),
    },
  },
  responses: {
    200: { description: "What it is now", ...json(SettingSchema) },
    400: errorResponse("invalid_request: the figure is outside what the rule allows, and fields names it"),
    403: errorResponse("access_required"),
    422: errorResponse("figures_conflict: fields names a box, then the box its figure must reach"),
  },
});

/** The keys a setting takes: those ops name themselves ("open"), these, or none for a single number. */
function keysOf(setting: NumberSetting): "open" | string[] | null {
  if (setting.keys === "open" || setting.keys === null) return setting.keys;
  return [...setting.keys];
}

/** Each key's own bounds, with the unit its figure counts in; null where every figure takes the rule's. */
function boundsBody(setting: NumberSetting) {
  if (setting.bounds === undefined) return null;
  return Object.fromEntries(Object.keys(setting.bounds).map((key) => [key, boundsOf(setting, key)]));
}

type State = Awaited<ReturnType<typeof settingStates>>[number];

const stateBody = ({ setting, value, setBy, setAt }: State) => {
  const described = {
    name: setting.name,
    title: setting.title,
    note: setting.note,
    set_by: setBy,
    set_at: setAt,
  };
  if (isChoice(setting)) {
    return {
      ...described,
      kind: "choice" as const,
      keys: [...setting.keys],
      choices: Object.fromEntries(Object.entries(setting.choices).map(([key, each]) => [key, [...each]])),
      value: value as Readonly<Record<string, string>>,
      default: setting.fallback,
    };
  }
  return {
    ...described,
    kind: "number" as const,
    unit: setting.unit,
    min: setting.min,
    max: setting.max,
    keys: keysOf(setting),
    bounds: boundsBody(setting),
    value: value as number | Readonly<Record<string, number>>,
    default: setting.fallback,
  };
};

export function registerOpsSettings(app: App): void {
  app.openapi(settingsRoute, async (c) => {
    const states = await settingStates(c.env.DB);
    return c.json({ settings: states.map(stateBody) }, 200);
  });

  app.openapi(setSettingRoute, async (c) => {
    // The path only takes a name the register holds; zod refuses any other with 400.
    const setting = settingNamed(c.req.valid("param").name);
    if (setting === undefined) throw new Error("the route allowed a name the register does not hold");
    const { value } = c.req.valid("json");

    if (value !== null) {
      const checked = checkValue(setting, value);
      if (!checked.ok) {
        c.var.log.warn("setting_refused", { setting: setting.name, refusals: checked.refusals.length });
        const fields = checked.refusals.map((refusal) => refusal.field);
        return refuse(c, "invalid_request", fields);
      }
      const conflict = conflictOf(setting, checked.value);
      if (conflict !== null) return refuse(c, "figures_conflict", conflict);
      await setOpsSetting(c.env.DB, {
        setting,
        value: checked.value,
        actor: actorOf(c),
        requestId: c.var.requestId,
        now: c.var.deps.now(),
      });
    } else {
      await setOpsSetting(c.env.DB, {
        setting,
        value: null,
        actor: actorOf(c),
        requestId: c.var.requestId,
        now: c.var.deps.now(),
      });
    }

    const states = await settingStates(c.env.DB);
    const state = states.find((each) => each.setting.name === setting.name);
    if (state === undefined) throw new Error("the register lost a setting between writing and reading it");
    return c.json(stateBody(state), 200);
  });
}
