// A replacement's choice of hair system (design/client-redesign, "Choose your next hair system";
// docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md): every replacement on sale, the one worn marked
// Keep it and each other by how it compares, Upgrade, Downgrade or Switch, with its three facts; and, for a change,
// what it means beneath: the price, how long it lasts, the service, and that the old one costs nothing.

import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { ChoiceCard, TickBox } from "@maneman/ui/ChoiceCard";
import { ChoiceGroup } from "@maneman/ui/Field";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me, type OfferedService } from "../../api.ts";
import { booking, hairSystems } from "../../content.ts";
import { PackageFacts, type OfferedPackage as Package } from "../../home/index.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import { useSession } from "../../session.ts";
import bookingSheet from "../booking.module.css";
import styles from "./service-step.module.css";
import { Frame, type StepAt } from "./shared.tsx";

const copy = booking.tier;

/** The hair system worn, as the choice weighs the others against it: its package, name and replacement's price. */
export interface Worn {
  readonly tier: string;
  readonly name: string;
  /** Null where neither the replacements on sale nor the packages' figures say it. */
  readonly price: number | null;
}

/** The hair system worn, priced by its replacement on sale, else by its package's figures. */
export function wornOf(
  worn: NonNullable<Me["hair_system"]>,
  services: readonly OfferedService[],
  packages: readonly Package[] | null,
): Worn {
  const onSale = services.find((service) => service.tier === worn.package)?.price.amount;
  const listed = packages?.find((each) => each.code === worn.package)?.replacement?.amount;
  return { tier: worn.package, name: worn.name, price: onSale ?? listed ?? null };
}

/**
 * A hair system's name as clients read it, its package's: the one worn's own, else the packages' figures', else its
 * replacement visit's, "Mane Man Essential replacement", where neither says it.
 */
export function hairSystemName(
  offered: OfferedService,
  worn: Worn | null,
  packages: readonly Package[] | null,
): string {
  if (worn !== null && offered.tier === worn.tier) return worn.name;
  return packages?.find((each) => each.code === offered.tier)?.name ?? offered.name;
}

/** How a hair system on sale compares with the one worn: kept, or a change up, down or across, by its price. */
export function howItCompares(offered: OfferedService, worn: Worn): string {
  if (offered.tier === worn.tier) return copy.keep;
  if (worn.price === null || offered.price.amount === worn.price) return copy.change;
  return offered.price.amount > worn.price ? copy.upgrade : copy.downgrade;
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
export function changeLine(chosen: OfferedService, worn: Worn, packages: readonly Package[]): string {
  const [was, now] = [
    packages.find((each) => each.code === worn.tier),
    packages.find((each) => each.code === chosen.tier),
  ];
  const costs = now === undefined ? null : copy.costs(rupees(chosen.price.amount), now.replace_after_months);
  return [costs, serviceLine(was, now), copy.oldBack(worn.name)].filter((part) => part !== null).join(" ");
}

/** One hair system on sale, the whole card a choice: its name and how it compares, what it is, and its facts. */
function TierChoice(props: {
  offered: OfferedService;
  worn: Worn | null;
  packages: readonly Package[] | null;
  checked: boolean;
  onChoose: () => void;
}) {
  const { offered, worn } = props;
  const how = worn === null ? null : howItCompares(offered, worn);
  const facts = props.packages?.find((each) => each.code === offered.tier);
  return (
    <ChoiceCard
      name="replacement-tier"
      look="ticked"
      className={styles.tier}
      checked={props.checked}
      onChange={props.onChoose}
    >
      <span className={styles.tierHead}>
        <TickBox checked={props.checked} />
        <span className={styles.tierName}>{hairSystemName(offered, worn, props.packages)}</span>
        {how !== null && <Badge tone={how === copy.keep ? "neutral" : "attention"}>{how}</Badge>}
      </span>
      {offered.description !== null && <span className={styles.tierWords}>{offered.description}</span>}
      {facts !== undefined && (
        <PackageFacts
          inLabel
          priceTerm={hairSystems.replacementPrice}
          price={offered.price}
          months={facts.replace_after_months}
          service={facts.service}
          everyDays={facts.service_every_days}
        />
      )}
    </ChoiceCard>
  );
}

/** When the hair system worn is due, or was, where the replacement is booked after its day. */
function dueLine(worn: NonNullable<Me["hair_system"]>, today: string): string {
  const said = worn.due_on < today ? copy.wasDue : copy.due;
  return said(worn.name, shortDate(worn.due_on));
}

/** The choice itself, given the hair system worn and the packages' facts, null until they are read. */
export function TierChoices(props: {
  services: readonly OfferedService[];
  worn: Me["hair_system"];
  packages: readonly Package[] | null;
  chosen: OfferedService | null;
  today: string;
  onChoose: (service: OfferedService) => void;
}) {
  const { chosen, packages } = props;
  const worn = props.worn === null ? null : wornOf(props.worn, props.services, packages);
  return (
    <>
      <ChoiceGroup legend={copy.title} legendLook="title">
        {/* Under the title, as the design draws it: the hair system worn and when it is due. */}
        {props.worn !== null && <p className={styles.tierDue}>{dueLine(props.worn, props.today)}</p>}
        {props.services.map((service) => (
          <TierChoice
            key={service.tier}
            offered={service}
            worn={worn}
            packages={packages}
            checked={service.tier === chosen?.tier}
            onChoose={() => {
              props.onChoose(service);
            }}
          />
        ))}
      </ChoiceGroup>
      {chosen !== null && worn !== null && chosen.tier !== worn.tier && (
        <p className={styles.tierChange} role="status">
          <strong className={styles.tierChangeTitle}>
            {copy.from(howItCompares(chosen, worn), worn.name, hairSystemName(chosen, worn, packages))}
          </strong>
          {changeLine(chosen, worn, packages ?? [])}
        </p>
      )}
      <p className={styles.tierNote}>
        {`${copy.carries} `}
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
          <Missing id="pick-tier" what={props.chosen === null ? copy.missing : null} />
        </>
      }
    >
      <TierChoices
        services={props.services}
        worn={me.hair_system}
        packages={packages}
        chosen={props.chosen}
        today={todayInIndia(apiNow())}
        onChoose={props.onChoose}
      />
    </Frame>
  );
}
