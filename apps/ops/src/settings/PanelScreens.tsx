// The panels that were tabs of Settings and are now sections of their own departments: the price book and the
// discount codes under Finance, and the Staff list under Admin. Each is laid out as a Settings panel is. The service
// area is the Served tab of Areas, under Growth.

import type { ReactNode } from "react";
import { Shell } from "../components/Shell.tsx";
import { sectionOf, SECTION_NAMES, type Page } from "../route.ts";
import { DiscountCodes } from "./DiscountCodes.tsx";
import { Services } from "./Services.tsx";
import { Staff } from "./Staff.tsx";
import styles from "../components/forms.module.css";

function PanelScreen({ page, children }: { page: Page; children: ReactNode }) {
  return (
    <Shell section={sectionOf(page).path} title={SECTION_NAMES[page]}>
      <div className={styles.screen}>{children}</div>
    </Shell>
  );
}

export function PricesScreen() {
  return (
    <PanelScreen page="prices">
      <Services />
    </PanelScreen>
  );
}

export function DiscountCodesScreen() {
  return (
    <PanelScreen page="discount-codes">
      <DiscountCodes />
    </PanelScreen>
  );
}

export function StaffScreen() {
  return (
    <PanelScreen page="staff">
      <Staff />
    </PanelScreen>
  );
}
