// The panels that were tabs of Settings and are now sections of their own departments: the price book and the
// discount codes under Finance, the service area under Growth, and the Staff list under Admin. Each is laid out as
// a Settings panel is.

import type { ReactNode } from "react";
import { Shell } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { sectionOf, SECTION_NAMES, type Page } from "../route.ts";
import { DiscountCodes } from "./DiscountCodes.tsx";
import { ServiceArea } from "./ServiceArea.tsx";
import { Services } from "./Services.tsx";
import { Staff } from "./Staff.tsx";
import styles from "./settings.module.css";

function PanelScreen({ page, children }: { page: Page; children: ReactNode }) {
  return (
    <Shell section={sectionOf(page).path} title={SECTION_NAMES[page]} sub={settings.sub}>
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

export function ServiceAreaScreen() {
  return (
    <PanelScreen page="service-area">
      <ServiceArea />
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
