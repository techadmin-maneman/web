// Photos' before and after, at the top of the page once two visits have photographs (design/client-redesign, the
// photos screen): the two visits picked, one angle of both either side of the shared slider's divider
// (@maneman/ui/Compare), which follows the finger and the keyboard, and the angles to choose from. Changing the angle
// cross-fades both sides together. It opens on the first visit with photographs against the latest.

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { SelectCard } from "@maneman/ui/SelectCard";
import { classes } from "@maneman/ui/classes";
import { Compare, COMPARE_BEFORE } from "@maneman/ui/Compare";
import { CLIENT_ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ARRIVE } from "@maneman/ui/motion";
import { fullDate } from "@maneman/web-kit/dates";
import { useEffect, useState } from "react";
import type { Angle, PhotoTimeline } from "../api.ts";
import { photos } from "../content.ts";
import { ANGLES, shownPhase } from "./PhotoRow.tsx";
import type { Relink } from "./relink.ts";
import styles from "./compare.module.css";

type Visit = PhotoTimeline["visits"][number];
/** How long the angles cross-fade: the house's quick 300 ms (tokens.css, --duration-quick). */
const FADE_MS = 300;

const photoOf = (visit: Visit, angle: Angle) =>
  visit.photos[shownPhase(visit.photos)].find((link) => link.angle === angle);

function Picker(props: { label: string; visits: readonly Visit[]; chosen: Visit; onChoose: (visit: Visit) => void }) {
  return (
    <SelectCard
      label={props.label}
      shown={fullDate(props.chosen.date)}
      value={props.chosen.visit_id}
      options={props.visits.map((visit) => ({ value: visit.visit_id, label: fullDate(visit.date) }))}
      onChange={(value) => {
        const visit = props.visits.find((each) => each.visit_id === value);
        if (visit !== undefined) props.onChoose(visit);
      }}
    />
  );
}

/** Both sides of one angle; the earlier is cut at the divider. */
function Sides(props: { from: Visit; to: Visit; angle: Angle; className?: string; onFailed: () => void }) {
  const { from, to, angle, className } = props;
  const side = (visit: Visit, which: string) => {
    const link = photoOf(visit, angle);
    const date = fullDate(visit.date);
    return (
      <div className={which}>
        {link !== undefined && (
          <img
            src={link.url}
            alt={photos.alt(photos.angles[angle], shownPhase(visit.photos), date)}
            onError={props.onFailed}
          />
        )}
        <span className={styles.date}>{date}</span>
      </div>
    );
  };
  return (
    <div className={classes(styles.sides, className)}>
      {side(to, styles.later ?? "")}
      {side(from, classes(styles.earlier, COMPARE_BEFORE))}
    </div>
  );
}

/** The angles beside the one shown load now, so a change of angle fades between two photographs. */
function useBesideLoaded(from: Visit, to: Visit, angle: Angle): void {
  useEffect(() => {
    const at = ANGLES.indexOf(angle);
    const beside = [ANGLES[at - 1], ANGLES[at + 1]].filter((each) => each !== undefined);
    for (const visit of [from, to]) {
      for (const each of beside) {
        const link = photoOf(visit, each);
        if (link !== undefined) new Image().src = link.url;
      }
    }
  }, [from, to, angle]);
}

/** The two visits compared, picked by ID, so the visits read again with fresh links stand in for the ones first shown. */
function usePicked(visits: readonly Visit[], earliest: Visit, latest: Visit) {
  const [fromId, setFromId] = useState(earliest.visit_id);
  const [toId, setToId] = useState(latest.visit_id);
  return {
    from: visits.find((visit) => visit.visit_id === fromId) ?? earliest,
    to: visits.find((visit) => visit.visit_id === toId) ?? latest,
    pickFrom: (visit: Visit) => {
      setFromId(visit.visit_id);
    },
    pickTo: (visit: Visit) => {
      setToId(visit.visit_id);
    },
  };
}

/** The angle shown, and the one fading out for the quick moment after a change. */
function useAngle() {
  const [angle, setAngle] = useState<Angle>("front");
  const [leaving, setLeaving] = useState<Angle | null>(null);
  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => {
      setLeaving(null);
    }, FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, angle]);
  const choose = (each: Angle) => {
    if (each === angle) return;
    setLeaving(angle);
    setAngle(each);
  };
  return { angle, leaving, choose };
}

/** `visits` newest first; with fewer than two, nothing. */
export function PhotoCompare(props: { visits: readonly Visit[]; relink: Relink }) {
  // The latest visit, and the first with photographs.
  const [latest, earliest] = [props.visits[0], props.visits.at(-1)];
  if (latest === undefined || earliest === undefined || latest === earliest) return null;
  return <Both visits={props.visits} earliest={earliest} latest={latest} relink={props.relink} />;
}

function Both(props: { visits: readonly Visit[]; earliest: Visit; latest: Visit; relink: Relink }) {
  const { relink } = props;
  const { from, to, pickFrom, pickTo } = usePicked(props.visits, props.earliest, props.latest);
  const { angle, leaving, choose } = useAngle();
  useBesideLoaded(from, to, angle);
  // The pickers list the visits in time order.
  const inOrder = [...props.visits].reverse();
  return (
    <section className={styles.compare} aria-label={photos.compare}>
      <div className={styles.pickers}>
        <Picker label={photos.from} visits={inOrder} chosen={from} onChoose={pickFrom} />
        <Picker label={photos.to} visits={inOrder} chosen={to} onChoose={pickTo} />
      </div>
      <Compare
        className={styles.stage}
        label={photos.divider}
        // What the number means: how much of each visit is showing, and which is which.
        valueText={(at) => photos.dividerAt(at, fullDate(from.date), fullDate(to.date))}
      >
        {leaving !== null && <Sides from={from} to={to} angle={leaving} onFailed={relink.failed} />}
        <Sides key={angle} from={from} to={to} angle={angle} className={ARRIVE} onFailed={relink.failed} />
      </Compare>
      <div className={styles.angles} role="group" aria-label={photos.angle}>
        {ANGLES.map((each) => (
          <ToggleButton
            pressed={each === angle}
            key={each}
            className={styles.angle}
            onClick={() => {
              choose(each);
            }}
          >
            {photos.angles[each]}
          </ToggleButton>
        ))}
      </div>
      <p className={styles.private}>
        <Icon d={CLIENT_ICONS.lock} size="sm" />
        {photos.private}
      </p>
    </section>
  );
}
