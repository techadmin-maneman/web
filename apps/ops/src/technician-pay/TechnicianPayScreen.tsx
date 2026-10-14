// Finance › Technician pay: the grades and their rates, each technician's grade, and their statements.

import { TechnicianPay } from "./TechnicianPay.tsx";
import form from "../components/forms.module.css";

export function TechnicianPayScreen() {
  return (
    <div className={form.screen}>
      <TechnicianPay />
    </div>
  );
}
