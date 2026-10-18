// A partner's record (docs/decisions/0123-partner-referral-channels.md): its name, what its friend gets, its
// commission per fit and its discount code, each changed where it reads; its link; and at the foot its QR code to
// print, and pausing it, asked once, or resuming it.

import { Button } from "@maneman/ui/Button";
import { TextLink } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Partner, type Partners, type PartnerTerms } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { figureOrNone, FigureRow, MoneyRow, ReadRow, TextRow } from "../components/RecordRows.tsx";
import { Refusal } from "../components/Refusal.tsx";
import form from "../components/forms.module.css";
import { partners as copy } from "../content/partners.ts";
import { useAccess } from "../lib/access.ts";
import { saveFile } from "../lib/save-file.ts";
import { partnerQr } from "./partner-qr.ts";
import { referralsApi } from "./referrals-api.ts";

const rows = copy.rows;

interface Props {
  readonly partner: Partner;
  readonly list: Partners;
  /** The site the partner's link opens. */
  readonly site: URL;
  readonly onSaved: (list: Partners) => void;
}

const termsOf = (partner: Partner): PartnerTerms => ({
  name: partner.name,
  friend_visits: partner.friend_visits,
  valid_days: partner.valid_days,
  commission: partner.commission,
  discount_code: partner.discount_code,
});

/** Its QR code to print, and pausing it, asked once, or resuming it on one press. */
function PartnerFoot({ partner, site, onSaved }: Omit<Props, "list">) {
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  const mayPause = useAccess().mayCall("POST /api/referral-channels/{id}/pause");
  const resume = () =>
    once(async () => {
      setRefused(null);
      const answer = await referralsApi.pausePartner(partner.id, false);
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      onSaved(answer.body);
    });
  return (
    <div className={form.recordFoot}>
      <Button
        variant="outline"
        size="small"
        narrow
        aria-label={copy.qrLabel(partner.name)}
        onClick={() => {
          saveFile(copy.qrName(partner.code), partnerQr(`${site.origin}/r/${partner.code}`), "image/svg+xml");
        }}
      >
        {copy.qr}
      </Button>
      {mayPause && partner.paused_at === null && (
        <DeleteAction
          name={partner.name}
          tone="danger"
          words={copy.pausing}
          send={() => referralsApi.pausePartner(partner.id, true)}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={onSaved}
        />
      )}
      {mayPause && partner.paused_at !== null && (
        <Button
          variant="outline"
          size="small"
          narrow
          busy={busy}
          aria-label={copy.resumeLabel(partner.name)}
          onClick={() => void resume()}
        >
          {copy.resume}
        </Button>
      )}
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}

export function PartnerRecord(props: Props) {
  const { partner, list, site, onSaved } = props;
  const mayChange = useAccess().mayCall("PATCH /api/referral-channels/{id}");
  const errors = { ...copy.errors, commission: copy.commissionUpTo(rupees(list.limits.max_commission)) };
  const save = async (change: Partial<PartnerTerms>) => {
    const answer = await referralsApi.changePartner(partner.id, { ...termsOf(partner), ...change });
    if (!answer.ok) return errorText(errors, answer);
    onSaved(answer.body);
    return null;
  };
  const whole = (field: "friend_visits" | "valid_days") => (typed: string) => {
    const figure = figureOrNone(typed);
    return figure === undefined || figure === null ? Promise.resolve(errors[field]) : save({ [field]: figure });
  };
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={rows.name}
          value={partner.name}
          maxLength={60}
          mayChange={mayChange}
          save={(typed) => save({ name: typed.trim() })}
        />
        <FigureRow
          label={rows.friendVisits}
          value={partner.friend_visits}
          shown={partner.friend_visits}
          mayChange={mayChange}
          save={whole("friend_visits")}
        />
        <FigureRow
          label={rows.validDays}
          value={partner.valid_days}
          shown={rows.days(partner.valid_days)}
          unit={rows.daysUnit}
          mayChange={mayChange}
          save={whole("valid_days")}
        />
        <MoneyRow
          label={rows.commission}
          paise={partner.commission}
          mayChange={mayChange}
          save={(typed) => save({ commission: paiseFromRupees(typed.trim() === "" ? "0" : typed) })}
        />
        <TextRow
          label={rows.discountCode}
          value={partner.discount_code ?? ""}
          shown={partner.discount_code ?? rows.none}
          maxLength={40}
          mayChange={mayChange}
          save={(typed) => save({ discount_code: typed.trim() === "" ? null : typed.trim().toUpperCase() })}
        />
        <ReadRow
          label={rows.link}
          value={
            <TextLink href={`${site.origin}/r/${partner.code}`} newTab>
              {copy.link(site.host, partner.code)}
            </TextLink>
          }
        />
        <ReadRow label={rows.status} value={partner.paused_at === null ? rows.active : copy.paused} />
      </div>
      <PartnerFoot partner={partner} site={site} onSaved={onSaved} />
    </>
  );
}
