// Admin › Staff: who may sign in to the console and what each may do, and the service tokens.

import { Staff } from "./Staff.tsx";
import form from "../components/forms.module.css";

export function StaffScreen() {
  return (
    <div className={form.screen}>
      <Staff />
    </div>
  );
}
