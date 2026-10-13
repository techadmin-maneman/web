// A partner added, or one's name and terms changed (docs/decisions/0123-partner-referral-channels.md). It goes as
// every setting does: its boxes, then what it is now beside what it will be, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Partner, type Partners, type PartnerTerms } from "../api.ts";
import { partners as copy } from "../content/partners.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import styles from "../components/forms.module.css";

const { form, check } = copy;

interface Draft {
  readonly name: string;
  readonly friendVisits: string;
  readonly validDays: string;
  readonly commission: string;
  readonly discountCode: string;
}

const draftOf = (partner: Partner | null): Draft => ({
  name: partner?.name ?? "",
  friendVisits: String(partner?.friend_visits ?? 2),
  validDays: String(partner?.valid_days ?? 365),
  commission: partner === null ? "" : String(partner.commission / 100),
  discountCode: partner?.discount_code ?? "",
});

const termsOf = (draft: Draft): PartnerTerms => ({
  name: draft.name.trim(),
  friend_visits: Number(draft.friendVisits),
  valid_days: Number(draft.validDays),
  commission: paiseFromRupees(draft.commission === "" ? "0" : draft.commission),
  discount_code: draft.discountCode.trim() === "" ? null : draft.discountCode.trim().toUpperCase(),
});

/** Whether the terms sit within what the API takes. */
function withinLimits(terms: PartnerTerms, limits: Partners["limits"]): boolean {
  return (
    terms.name !== "" &&
    Number.isInteger(terms.friend_visits) &&
    terms.friend_visits >= 0 &&
    terms.friend_visits <= limits.max_visits &&
    Number.isInteger(terms.valid_days) &&
    terms.valid_days >= limits.min_days &&
    terms.valid_days <= limits.max_days &&
    terms.commission >= 0 &&
    terms.commission <= limits.max_commission
  );
}

/** What the check says: a new partner's terms, or each term that changes, was beside now. */
function checkLines(partner: Partner | null, terms: PartnerTerms): string[] {
  const friend = copy.friendGets(terms.friend_visits, terms.valid_days);
  if (partner === null) {
    const code = terms.discount_code === null ? [] : [check.discountNew(terms.discount_code)];
    return [check.add(terms.name), check.friendNew(friend), check.commissionNew(rupees(terms.commission)), ...code];
  }
  const wasFriend = copy.friendGets(partner.friend_visits, partner.valid_days);
  return [
    partner.name === terms.name ? null : check.name(partner.name, terms.name),
    wasFriend === friend ? null : check.friend(wasFriend, friend),
    partner.commission === terms.commission
      ? null
      : check.commission(rupees(partner.commission), rupees(terms.commission)),
    partner.discount_code === terms.discount_code
      ? null
      : check.discount(partner.discount_code ?? check.none, terms.discount_code ?? check.none),
  ].filter((line) => line !== null);
}

interface Box {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
}

function NumberBox({ label, value, onValue, className }: Box & { readonly className: string | undefined }) {
  return (
    <Field label={label} className={styles.field}>
      {(control) => (
        <NumberInput
          {...control}
          className={className}
          inputMode="numeric"
          step={1}
          min={0}
          value={value}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function PartnerFields({ draft, edit }: { draft: Draft; edit: (change: Partial<Draft>) => void }) {
  return (
    <div className={styles.fields}>
      <Field label={form.name} className={styles.field}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.areaBox}
            maxLength={60}
            value={draft.name}
            onChange={(event) => {
              edit({ name: event.target.value });
            }}
          />
        )}
      </Field>
      <NumberBox
        label={form.friendVisits}
        value={draft.friendVisits}
        className={styles.figureBox}
        onValue={(friendVisits) => {
          edit({ friendVisits });
        }}
      />
      <NumberBox
        label={form.validDays}
        value={draft.validDays}
        className={styles.figureBox}
        onValue={(validDays) => {
          edit({ validDays });
        }}
      />
      <NumberBox
        label={form.commission}
        value={draft.commission}
        className={styles.amountBox}
        onValue={(commission) => {
          edit({ commission });
        }}
      />
      <Field label={form.discountCode} className={styles.field}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.choiceBox}
            maxLength={40}
            value={draft.discountCode}
            onChange={(event) => {
              edit({ discountCode: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

export function PartnerForm(props: {
  /** Null for a new partner. */
  readonly partner: Partner | null;
  readonly limits: Partners["limits"];
  readonly onDone: (list: Partners) => void;
  readonly onCancel: () => void;
}) {
  const { partner } = props;
  const [draft, setDraft] = useState<Draft>(draftOf(partner));
  const terms = termsOf(draft);
  const steps = useSteps(
    async () =>
      sentOf(partner === null ? await api.addPartner(terms) : await api.changePartner(partner.id, terms), (list) => ({
        list,
      })),
    (sent) => {
      props.onDone(sent.list);
    },
  );
  const lines = checkLines(partner, terms);
  return (
    <SettingForm
      title={partner === null ? form.addTitle : form.editTitle(partner.name)}
      steps={steps}
      ready={withinLimits(terms, props.limits)}
      errors={copy.errors}
      onCancel={props.onCancel}
      sendable={lines.length > 0}
      checking={(lines.length > 0 ? lines : [check.nothing]).map((line) => (
        <p key={line} className={styles.checkLine}>
          {line}
        </p>
      ))}
    >
      <PartnerFields
        draft={draft}
        edit={(change) => {
          setDraft({ ...draft, ...change });
          steps.edit();
        }}
      />
    </SettingForm>
  );
}
