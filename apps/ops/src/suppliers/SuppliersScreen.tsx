// Inventory › Suppliers: the suppliers we buy from, and what each supplies.

import { Suppliers } from "./Suppliers.tsx";
import form from "../components/forms.module.css";

export function SuppliersScreen() {
  return (
    <div className={form.screen}>
      <Suppliers />
    </div>
  );
}
