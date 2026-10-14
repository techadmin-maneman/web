// Inventory › Items: the items we stock, each service's expected use, and the hair systems.

import { Consumables } from "./Consumables.tsx";
import form from "../components/forms.module.css";

export function ItemsScreen() {
  return (
    <div className={form.screen}>
      <Consumables />
    </div>
  );
}
