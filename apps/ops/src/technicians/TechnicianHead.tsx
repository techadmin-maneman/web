// A technician's head and figures on their page (./TechnicianScreen.tsx): their name with where they stand today, their
// number, city, fitting and hours beneath; Call and Edit details at its right; and beneath it, their visits to come,
// their jobs over the roster's period, how often they were on time, and what in their kit is below zero.

import { ButtonLink } from "@maneman/ui/Button";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Icon } from "@maneman/ui/Icon";
import { Columns } from "@maneman/ui/Layout";
import { StatTile } from "@maneman/ui/StatTile";
import { useLoad } from "@maneman/ui/useLoad";
import { GLYPHS } from "@maneman/brand/icons";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import { useCallback, useMemo, type ReactNode } from "react";
import { api, type Technician, type TechnicianSummary } from "../api.ts";
import { technicians } from "../content.ts";
import { PageActions, useRecordHead, useRecordTitle, type RecordHead } from "../frame/PageHead.tsx";
import { phoneWords } from "../lib/phone.ts";
import { weekLines } from "./TechnicianHours.tsx";
import { techniciansApi } from "./technicians-api.ts";
import styles from "./technicians.module.css";

const copy = technicians.head;
const figures = technicians.figures;

const DAY_MS = 86_400_000;

/** Working, on leave today, or switched off. */
function standingOf(active: Technician | null): RecordHead["badges"][number] {
  if (active === null) return { words: copy.off, tone: "neutral" };
  const today = todayInIndia(apiNow());
  const away = active.leave.some((leave) => leave.from <= today && today <= leave.to);
  return away ? { words: copy.onLeave, tone: "attention" } : { words: copy.working, tone: "done" };
}

function headOf(summary: TechnicianSummary, active: Technician | null): RecordHead {
  return {
    badges: [standingOf(active)],
    facts: [
      ...(summary.mobile === null ? [] : [phoneWords(summary.mobile)]),
      ...(summary.city === null ? [] : [summary.city]),
      summary.fits_trained ? copy.trained : copy.notTrained,
      ...(active === null ? [] : weekLines(active.hours)),
    ],
  };
}

/** The technician's name, standing and facts as the page's head, with Call and Edit details at its right. */
export function TechnicianHead(props: {
  readonly summary: TechnicianSummary;
  /** The technician with their leave and hours while they are active; null once switched off. */
  readonly active: Technician | null;
  /** The details' rows, switching off and deleting, in the drawer Edit details opens. */
  readonly details: (close: () => void) => ReactNode;
}) {
  const { summary, active } = props;
  useRecordTitle(summary.name);
  useRecordHead(useMemo(() => headOf(summary, active), [summary, active]));
  return (
    <PageActions>
      {summary.mobile !== null && (
        <ButtonLink variant="outline" size="small" href={`tel:${summary.mobile}`}>
          <Icon d={GLYPHS.phone} size="sm" className={styles.icon} />
          {copy.call}
        </ButtonLink>
      )}
      <DrawerButton label={copy.edit} title={summary.name}>
        {props.details}
      </DrawerButton>
    </PageActions>
  );
}

/** How many items in their kit are below zero, from the stock read; null until it has been. */
export function useBelowZero(technicianId: string): number | null {
  const [loaded] = useLoad(api.stock);
  if (loaded.state !== "loaded") return null;
  return loaded.value.holdings.filter((each) => each.place_id === technicianId && each.quantity < 0).length;
}

/** Their visits to come, jobs over the roster's period, how often on time, and their kit below zero. */
export function TechnicianFigures({ summary, belowZero }: { summary: TechnicianSummary; belowZero: number | null }) {
  const read = useCallback(() => techniciansApi.technicianWork(null), []);
  const [loaded] = useLoad(read);
  const work =
    loaded.state === "loaded" ? loaded.value.technicians.find((each) => each.technician_id === summary.id) : undefined;
  const days =
    loaded.state === "loaded"
      ? Math.round((Date.parse(loaded.value.to) - Date.parse(loaded.value.from)) / DAY_MS)
      : null;
  return (
    <Columns row>
      <StatTile label={figures.toCome} value={summary.visits_to_come} />
      {work !== undefined && days !== null && (
        <StatTile label={figures.jobs(days)} value={figures.jobCount(work.jobs)} />
      )}
      {work !== undefined && work.jobs > 0 && (
        <StatTile label={figures.onTime} value={technicians.work.onTime(work.on_time_jobs, work.jobs)} />
      )}
      {belowZero !== null && (
        <StatTile label={figures.kit} value={quantity(belowZero)} tone={belowZero > 0 ? "warning" : "plain"} />
      )}
    </Columns>
  );
}
