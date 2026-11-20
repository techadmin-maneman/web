// A new campaign link's drawer (docs/decisions/0288-attribution-and-conversions.md): a society activation, with its
// society, pincode, day, costs and any discount for the first fit; or an offer link, with its name, where and how it
// goes, its campaign, city and any discount. One field to a row; the link, its code and its QR come once it is made.

import { SelectField, TextField } from "@maneman/ui/FieldRows";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { FormActions } from "@maneman/ui/FormActions";
import { DateInput, Field } from "@maneman/ui/Field";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { Refused } from "@maneman/ui/Refusal";
import { paiseFromRupees } from "@maneman/web-kit/money";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import form from "@maneman/ui/forms.module.css";
import { campaignLinks as copy } from "../content/campaign-links.ts";
import { campaignLinksApi, type CampaignLink, type CampaignLinks, type NewCampaignLink } from "./campaign-links-api.ts";

const BOXES = ["name", "pincode", "held_date", "costs", "utm_campaign", "city", "discount_code_id"];

/** Whole rupees, or nothing typed. */
const rupeesOrNone = (typed: string): number | null => (/^\d+$/.test(typed.trim()) ? Number(typed.trim()) : null);

/** The discount codes a link may carry, and none. */
const discountOptions = (list: CampaignLinks) =>
  [
    ["", copy.noDiscount],
    ...list.discount_codes.map(
      (code) =>
        [
          code.id,
          copy.discountWords(
            code.code,
            code.kind,
            code.kind === "percent" ? String(code.value) : copy.rupees(code.value / 100),
          ),
        ] as const,
    ),
  ] as const;

/** The form's sending: busy while it goes, its refusal kept to mark its boxes. */
function useSend(onMade: (link: CampaignLink) => void) {
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = (link: NewCampaignLink) =>
    once(async () => {
      setFailure(null);
      const answer = await campaignLinksApi.add(link);
      if (answer.ok) onMade(answer.body);
      else setFailure({ code: answer.code, fields: answer.fields });
    });
  return { busy, failure, send, refused: (box: string) => boxError(copy.errors, failure, box) };
}

function Sending(props: {
  busy: boolean;
  failure: Failure | null;
  /** What Make link waits for, said beneath it; null once it can make one. */
  missing: string | null;
  onCancel: () => void;
  onSend: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
    >
      <div className={form.fields}>{props.children}</div>
      <Refused failed={props.failure} errors={copy.errors} boxes={BOXES} />
      <FormActions>
        <Button
          variant="primary"
          size="small"
          type="submit"
          busy={props.busy}
          disabled={props.missing !== null}
          aria-describedby={describedBy("link-missing", props.missing !== null)}
        >
          {props.busy ? copy.making : copy.make}
        </Button>
        <CancelButton disabled={props.busy} onClick={props.onCancel} />
      </FormActions>
      <Missing id="link-missing" what={props.missing} />
    </form>
  );
}

/** What Make link waits for: the name first, then what else the form lacks. */
const missingOf = (name: string, otherwise: string | null): string | null =>
  name.trim() === "" ? copy.missing.name : otherwise;

interface SocietyDraft {
  readonly name: string;
  readonly pincode: string;
  readonly day: string;
  readonly stall: string;
  readonly hours: string;
  readonly rate: string;
  readonly collateral: string;
  readonly other: string;
  readonly otherNote: string;
  readonly discount: string;
}

/** The society's costs as typed, each a spend entry on its link; none for a line left empty. */
function societyCosts(draft: SocietyDraft) {
  const hours = rupeesOrNone(draft.hours);
  const rate = rupeesOrNone(draft.rate);
  const lines = [
    { line: "stall" as const, rupees: rupeesOrNone(draft.stall), note: null },
    {
      line: "staff" as const,
      rupees: hours === null || rate === null ? null : hours * rate,
      note: hours === null || rate === null ? null : copy.staffNote(hours, rate),
    },
    { line: "collateral" as const, rupees: rupeesOrNone(draft.collateral), note: null },
    { line: "other" as const, rupees: rupeesOrNone(draft.other), note: draft.otherNote.trim() || null },
  ];
  return lines.flatMap((cost) =>
    cost.rupees === null || cost.rupees === 0
      ? []
      : [
          {
            line: cost.line,
            amount: paiseFromRupees(String(cost.rupees)),
            ...(cost.note === null ? {} : { note: cost.note }),
          },
        ],
  );
}

/** The society's figures, each a box of whole rupees or hours, one to a row. */
const SOCIETY_FIGURES = [
  { key: "stall", label: copy.society.stall, maxLength: 9 },
  { key: "hours", label: copy.society.staffHours, maxLength: 4 },
  { key: "rate", label: copy.society.staffRate, maxLength: 7 },
  { key: "collateral", label: copy.society.collateral, maxLength: 9 },
  { key: "other", label: copy.society.other, maxLength: 9 },
] as const;

function SocietyFields(props: {
  list: CampaignLinks;
  draft: SocietyDraft;
  set: (change: Partial<SocietyDraft>) => void;
  refused: (box: string) => string | null;
}) {
  const { draft, set, refused } = props;
  return (
    <>
      <TextField
        className={form.field}
        label={copy.society.name}
        value={draft.name}
        maxLength={80}
        error={refused("name")}
        onChange={(name) => {
          set({ name });
        }}
      />
      <TextField
        className={form.field}
        label={copy.society.pincode}
        value={draft.pincode}
        maxLength={6}
        width="amount"
        error={refused("pincode")}
        onChange={(pincode) => {
          set({ pincode: pincode.replace(/\D/g, "") });
        }}
      />
      <Field label={copy.society.day} className={form.field} error={refused("held_date")}>
        {(control) => (
          <DateInput
            {...control}
            value={draft.day}
            onChange={(event) => {
              set({ day: event.target.value });
            }}
          />
        )}
      </Field>
      {SOCIETY_FIGURES.map((figure) => (
        <TextField
          className={form.field}
          key={figure.key}
          label={figure.label}
          value={draft[figure.key]}
          maxLength={figure.maxLength}
          width="amount"
          onChange={(value) => {
            set({ [figure.key]: value });
          }}
        />
      ))}
      <TextField
        className={form.field}
        label={copy.society.otherNote}
        value={draft.otherNote}
        maxLength={200}
        onChange={(otherNote) => {
          set({ otherNote });
        }}
      />
      <SelectField
        className={form.field}
        label={copy.discount}
        hint={copy.societyDiscountNote}
        value={draft.discount}
        choices={discountOptions(props.list)}
        error={refused("discount_code_id")}
        onChange={(discount) => {
          set({ discount });
        }}
      />
    </>
  );
}

export function SocietyForm(props: {
  list: CampaignLinks;
  onMade: (link: CampaignLink) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SocietyDraft>({
    name: "",
    pincode: "",
    day: todayInIndia(apiNow()),
    stall: "",
    hours: "",
    rate: "",
    collateral: "",
    other: "",
    otherNote: "",
    discount: "",
  });
  const { busy, failure, send, refused } = useSend(props.onMade);
  return (
    <Sending
      busy={busy}
      failure={failure}
      missing={missingOf(draft.name, /^\d{6}$/.test(draft.pincode) ? null : copy.missing.pincode)}
      onCancel={props.onCancel}
      onSend={() => {
        void send({
          kind: "society",
          name: draft.name.trim(),
          pincode: draft.pincode,
          held_date: draft.day,
          costs: societyCosts(draft),
          ...(draft.discount === "" ? {} : { discount_code_id: draft.discount }),
        });
      }}
    >
      <SocietyFields
        list={props.list}
        draft={draft}
        set={(change) => {
          setDraft({ ...draft, ...change });
        }}
        refused={refused}
      />
    </Sending>
  );
}

interface OfferDraft {
  readonly name: string;
  readonly source: CampaignLinks["sources"][number];
  readonly medium: CampaignLinks["mediums"][number];
  readonly campaign: string;
  readonly city: string;
  readonly discount: string;
}

function OfferFields(props: {
  list: CampaignLinks;
  draft: OfferDraft;
  set: (change: Partial<OfferDraft>) => void;
  refused: (box: string) => string | null;
}) {
  const { list, draft, set, refused } = props;
  return (
    <>
      <TextField
        className={form.field}
        label={copy.offer.name}
        value={draft.name}
        maxLength={80}
        error={refused("name")}
        onChange={(name) => {
          set({ name });
        }}
      />
      <SelectField
        className={form.field}
        label={copy.offer.source}
        value={draft.source}
        choices={list.sources.map((each) => [each, copy.sources[each]] as const)}
        onChange={(value) => {
          set({ source: list.sources.find((each) => each === value) ?? draft.source });
        }}
      />
      <SelectField
        className={form.field}
        label={copy.offer.medium}
        value={draft.medium}
        choices={list.mediums.map((each) => [each, copy.mediums[each]] as const)}
        onChange={(value) => {
          set({ medium: list.mediums.find((each) => each === value) ?? draft.medium });
        }}
      />
      <TextField
        className={form.field}
        label={copy.offer.campaign}
        hint={copy.offer.campaignHint}
        value={draft.campaign}
        maxLength={80}
        error={refused("utm_campaign")}
        onChange={(campaign) => {
          set({ campaign: campaign.toLowerCase() });
        }}
      />
      <SelectField
        className={form.field}
        label={copy.offer.city}
        value={draft.city}
        choices={[["", copy.offer.national], ...list.cities.map((city) => [city, city] as const)]}
        error={refused("city")}
        onChange={(city) => {
          set({ city });
        }}
      />
      <SelectField
        className={form.field}
        label={copy.discount}
        value={draft.discount}
        choices={discountOptions(list)}
        error={refused("discount_code_id")}
        onChange={(discount) => {
          set({ discount });
        }}
      />
    </>
  );
}

export function OfferForm(props: { list: CampaignLinks; onMade: (link: CampaignLink) => void; onCancel: () => void }) {
  const { list } = props;
  const [draft, setDraft] = useState<OfferDraft>({
    name: "",
    source: list.sources[0] ?? "google",
    medium: list.mediums[0] ?? "cpc",
    campaign: "",
    city: "",
    discount: "",
  });
  const { busy, failure, send, refused } = useSend(props.onMade);
  return (
    <Sending
      busy={busy}
      failure={failure}
      missing={missingOf(draft.name, /^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.campaign) ? null : copy.missing.campaign)}
      onCancel={props.onCancel}
      onSend={() => {
        void send({
          kind: "offer",
          name: draft.name.trim(),
          utm_source: draft.source,
          utm_medium: draft.medium,
          utm_campaign: draft.campaign,
          ...(draft.city === "" ? {} : { city: draft.city }),
          ...(draft.discount === "" ? {} : { discount_code_id: draft.discount }),
        });
      }}
    >
      <OfferFields
        list={list}
        draft={draft}
        set={(change) => {
          setDraft({ ...draft, ...change });
        }}
        refused={refused}
      />
    </Sending>
  );
}
