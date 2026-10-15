// Money › Technician pay: each technician's statement for a month. Their grades and rates are Settings'.

import { TechnicianPay } from "./TechnicianPay.tsx";
import form from "../components/forms.module.css";

export function TechnicianPayScreen() {
  return (
    <div className={form.screen}>
      <TechnicianPay part="statements" />
    </div>
  );
}

/** Settings › Pay grades: the grades, their rates, and each technician's grade. */
export function PayGradesScreen() {
  return (
    <div className={form.screen}>
      <TechnicianPay part="grades" />
    </div>
  );
}
