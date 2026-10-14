// Finance › Partner commission: what each partner is owed by month, and the payouts recorded.

import { PartnerCommission } from "./PartnerCommission.tsx";
import form from "../components/forms.module.css";

export function PartnerCommissionScreen() {
  return (
    <div className={form.screen}>
      <PartnerCommission />
    </div>
  );
}
