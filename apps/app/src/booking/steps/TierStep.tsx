// A replacement's choice of hair system (design/client-redesign, "Choose your next hair system";
// docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md): every replacement on sale, the one worn marked
// Keep it and each other by how it compares, Upgrade, Downgrade or Switch, with its three facts; and, for a change,
// what it means beneath: the price, how long it lasts, the service, and that the old one costs nothing.

import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { ChoiceGroup, Radio } from "@maneman/ui/Field";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type OfferedService } from "../../api.ts";
import { booking, hairSystems, missing } from "../../content.ts";
import { PackageFacts, type OfferedPackage as Package } from "../../home/index.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import { useSession } from "../../session.ts";
import bookingSheet from "../booking.module.css";
import styles from "./service-step.module.css";
import { Frame, type StepAt } from "./shared.tsx";

const copy = booking.tier;

/** How a hair system on sale compares with the one worn: kept, or a change up, down or across, by its price. */
export function howItCompares(offered: OfferedService, worn: OfferedService | undefined): string {
  if (worn === undefined) return copy.change;
  if (offered.tier === worn.tier) return copy.keep;
  if (offered.price.amount > worn.price.amount) return copy.upgrade;
  return offered.price.amount < worn.price.amount ? copy.downgrade : copy.change;
}

/** The service after a change of hair system: the same as the one worn's, or what it changes from and to. */
function serviceLine(was: Package | undefined, now: Package | undefined): string | null {
  if (was?.service === null || was?.service === undefined || now?.service === null || now?.service === undefined) {
    return null;
  }
  const [before, after] = [rupees(was.service.amount), rupees(now.service.amount)];
  const [wasEvery, nowEvery] = [hairSystems.every(was.service_every_days), hairSystems.every(now.service_every_days)];
  if (before === after && wasEvery === nowEvery) return copy.serviceStays(after, nowEvery);
  return copy.serviceChanges(before, wasEvery, after, nowEvery);
}

/** A change of hair system, in words: what it costs and lasts, its service against the one worn's, and the old one's fate. */
export function changeLine(chosen: OfferedService, worn: OfferedService, packages: readonly Package[]): string {
  const [was, now] = [
    packages.find((each) => each.code === worn.tier),
    packages.find((each) => each.code === chosen.tier),
  ];
  const costs = now === undefined ? null : copy.costs(rupees(chosen.price.amount), now.replace_after_months);
  return [costs, serviceLine(was, now), copy.oldBack(worn.name)].filter((part) => part !== null).join(" ");
}

/** One hair system on sale: its name and how it compares, what it is, and its three facts once they are read. */
function TierChoice(props: {
  offered: OfferedService;
  worn: OfferedService | undefined;
  packages: readonly Package[] | null;
  checked: boolean;
  onChoose: () => void;
}) {
  const { offered } = props;
  const how = howItCompares(offered, props.worn);
  const facts = props.packages?.find((each) => each.code === offered.tier);
  return (
    <div className={styles.tier}>
      <Radio
        name="replacement-tier"
        checked={props.checked}
        onChange={props.onChoose}
        label={
          <span className={styles.tierHead}>
            <span className={styles.tierName}>{offered.name}</span>
            <Badge tone={how === copy.keep ? "neutral" : "attention"}>{how}</Badge>
          </span>
        }
        detail={offered.description ?? undefined}
      />
      {/* Beside the choice rather than in its label, which holds words alone. */}
      {facts !== undefined && (
        <PackageFacts
          priceTerm={hairSystems.replacementPrice}
          price={offered.price}
          months={facts.replace_after_months}
          service={facts.service}
          everyDays={facts.service_every_days}
        />
      )}
    </div>
  );
}

/** The choice itself, given the hair system worn and the packages' facts, null until they are read. */
export function TierChoices(props: {
  services: readonly OfferedService[];
  worn: Me["hair_system"];
  packages: readonly Package[] | null;
  chosen: OfferedService | null;
  onChoose: (service: OfferedService) => void;
}) {
  const { worn, chosen, packages } = props;
  const wornOffered = props.services.find((service) => service.tier === worn?.package);
  const changing = chosen !== null && wornOffered !== undefined && chosen.tier !== wornOffered.tier;
  return (
    <>
      <ChoiceGroup legend={copy.title} legendLook="title">
        {/* Under the title, as the design draws it: the hair system worn and when it is due. */}
        {worn !== null && <p className={styles.tierDue}>{copy.due(worn.name, shortDate(worn.due_on))}</p>}
        {props.services.map((service) => (
          <TierChoice
            key={service.tier}
            offered={service}
            worn={wornOffered}
            packages={packages}
            checked={service.tier === chosen?.tier}
            onChoose={() => {
              props.onChoose(service);
            }}
          />
        ))}
      </ChoiceGroup>
      {changing && (
        <p className={styles.tierChange} role="status">
          <strong className={styles.tierChangeTitle}>
            {copy.from(howItCompares(chosen, wornOffered), wornOffered.name, chosen.name)}
          </strong>
          {changeLine(chosen, wornOffered, packages ?? [])}
        </p>
      )}
      <p className={styles.tierNote}>
        {`${hairSystems.gst} ${copy.carries} `}
        <TextLink inline href={whatsappWith(copy.asking)}>
          {copy.ask}
        </TextLink>
      </p>
    </>
  );
}

/** The replacement's first step: the hair system it is, then its date. */
export function TierStep(props: {
  step: StepAt;
  services: readonly OfferedService[];
  chosen: OfferedService | null;
  onChoose: (service: OfferedService) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { me } = useSession();
  const [loaded] = useLoad(api.packages);
  // The facts are a help to choosing, never a condition of it: without them each choice keeps its name and price.
  const packages = loaded.state === "loaded" ? loaded.value.packages : null;
  return (
    <Frame
      title={copy.head}
      step={props.step}
      onClose={props.onClose}
      footer={
        <>
          <Button
            variant="primary"
            size="action"
            className={bookingSheet.primary}
            disabled={props.chosen === null}
            aria-describedby={describedBy("pick-tier", props.chosen === null)}
            onClick={props.onNext}
          >
            {copy.next}
          </Button>
          <Missing id="pick-tier" what={props.chosen === null ? missing.pickService : null} />
        </>
      }
    >
      <TierChoices
        services={props.services}
        worn={me.hair_system}
        packages={packages}
        chosen={props.chosen}
        onChoose={props.onChoose}
      />
    </Frame>
  );
}
