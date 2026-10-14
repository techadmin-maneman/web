// Finance › Prices: the services clients book with every price each has had and is to have, and what the items we stock cost us.

import { Services } from "./Services.tsx";
import { StandardCosts } from "./StandardCosts.tsx";
import form from "../components/forms.module.css";

export function PricesScreen() {
  return (
    <div className={form.screen}>
      <Services />
      <StandardCosts />
    </div>
  );
}
