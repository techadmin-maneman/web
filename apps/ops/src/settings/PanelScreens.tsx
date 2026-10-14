// The panels that were tabs of Settings and are now sections of their own departments: the price book, the
// discount codes, technicians' pay and partners' commission under Finance, and the Staff list under Admin. Each is
// laid out as a Settings panel is. The service area is the Served tab of Areas, under Growth.

import type { ReactNode } from "react";
import { DiscountCodes } from "./DiscountCodes.tsx";
import { PartnerCommission } from "./PartnerCommission.tsx";
import { Services } from "./Services.tsx";
import { StandardCosts } from "./StandardCosts.tsx";
import { Staff } from "./Staff.tsx";
import { TechnicianPay } from "./TechnicianPay.tsx";
import styles from "../components/forms.module.css";

function PanelScreen({ children }: { children: ReactNode }) {
  return <div className={styles.screen}>{children}</div>;
}

export function PricesScreen() {
  return (
    <PanelScreen>
      <Services />
      <StandardCosts />
    </PanelScreen>
  );
}

export function DiscountCodesScreen() {
  return (
    <PanelScreen>
      <DiscountCodes />
    </PanelScreen>
  );
}

export function TechnicianPayScreen() {
  return (
    <PanelScreen>
      <TechnicianPay />
    </PanelScreen>
  );
}

export function PartnerCommissionScreen() {
  return (
    <PanelScreen>
      <PartnerCommission />
    </PanelScreen>
  );
}

export function StaffScreen() {
  return (
    <PanelScreen>
      <Staff />
    </PanelScreen>
  );
}
