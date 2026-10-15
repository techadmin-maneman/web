// Compare: one angle from two visits, on ink and without the tabs.
// The earlier visit shows left of the shared compare's divider (@maneman/ui/Compare), which follows the finger and the
// keyboard. Changing the angle cross-fades both sides together. It opens on the first visit with photographs against
// the latest.

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { SelectCard } from "@maneman/ui/SelectCard";
import { iconButtonLook } from "@maneman/ui/IconButton";
import { classes } from "@maneman/ui/classes";
import { Compare as CompareStage, COMPARE_BEFORE } from "@maneman/ui/Compare";
import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ARRIVE } from "@maneman/ui/motion";
import { useLiveLoad, whenLoaded } from "@maneman/ui/useLoad";
import { fullDate } from "@maneman/web-kit/dates";
import { useEffect, useState } from "react";
import { api, type PhotoLink, type PhotoTimeline } from "../api.ts";
import { photos } from "../content.ts";
import { AppLink, Shell } from "../components/Shell.tsx";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { shownPhase } from "./PhotoRow.tsx";
import { LINKS_FRESH_MS, type Relink, useRelink } from "./relink.ts";
import styles from "./compare.module.css";

type Visit = PhotoTimeline["visits"][number];
type CompareAngle = keyof typeof photos.compareAngles;
const COMPARE_ANGLES = Object.keys(photos.compareAngles) as CompareAngle[];
/** How long the angles cross-fade: the house's quick 300 ms (tokens.css, --duration-quick). */
const FADE_MS = 300;

const photoOf = (visit: Visit, angle: CompareAngle): PhotoLink | undefined =>
  visit.photos[shownPhase(visit.photos)].find((link) => link.angle === angle);

export function CompareScreen() {
  const { loaded, refresh, retry } = useLiveLoad(api.photos, LINKS_FRESH_MS);
  const relink = useRelink(refresh);
  if (loaded.state === "loaded") {
    // Newest first: the latest visit, and the first with photographs.
    const { visits } = loaded.value;
    const [latest, earliest] = [visits[0], visits.at(-1)];
    if (latest !== undefined && earliest !== undefined && latest !== earliest) {
      return <Compare visits={visits} earliest={earliest} latest={latest} relink={relink} />;
    }
  }
  return (
    <Shell header={{ kind: "back", title: photos.compare, to: "/photos", label: photos.back }} tab="/photos">
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: () => <p className={styles.none}>{photos.compareNone}</p>,
      })}
    </Shell>
  );
}

function Picker(props: { label: string; visits: readonly Visit[]; chosen: Visit; onChoose: (visit: Visit) => void }) {
  return (
    <SelectCard
      onInk
      className={styles.picker}
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
function Sides(props: { from: Visit; to: Visit; angle: CompareAngle; className?: string; onFailed: () => void }) {
  const { from, to, angle, className } = props;
  const side = (visit: Visit, which: string) => {
    const link = photoOf(visit, angle);
    const date = fullDate(visit.date);
    return (
      <div className={which}>
        {link !== undefined && (
          <img
            src={link.url}
            alt={photos.alt(photos.compareAngles[angle], shownPhase(visit.photos), date)}
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
function useBesideLoaded(from: Visit, to: Visit, angle: CompareAngle): void {
  useEffect(() => {
    const at = COMPARE_ANGLES.indexOf(angle);
    const beside = [COMPARE_ANGLES[at - 1], COMPARE_ANGLES[at + 1]].filter((each) => each !== undefined);
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
  const from = visits.find((visit) => visit.visit_id === fromId) ?? earliest;
  const to = visits.find((visit) => visit.visit_id === toId) ?? latest;
  return {
    from,
    to,
    pickFrom: (visit: Visit) => {
      setFromId(visit.visit_id);
    },
    pickTo: (visit: Visit) => {
      setToId(visit.visit_id);
    },
  };
}

function Compare(props: { visits: readonly Visit[]; earliest: Visit; latest: Visit; relink: Relink }) {
  const { relink } = props;
  // The pickers list the visits in time order.
  const inOrder = [...props.visits].reverse();
  const { from, to, pickFrom, pickTo } = usePicked(props.visits, props.earliest, props.latest);
  const [angle, setAngle] = useState<CompareAngle>("front");
  const [leaving, setLeaving] = useState<CompareAngle | null>(null);

  useBesideLoaded(from, to, angle);

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => {
      setLeaving(null);
    }, FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, angle]);

  return (
    <div className={styles.compare}>
      <header className={styles.header}>
        <AppLink className={iconButtonLook(styles.back)} to="/photos" label={photos.back}>
          <Icon d={ICONS.back} size="md" />
        </AppLink>
        <h1 className={styles.title}>{photos.compare}</h1>
      </header>
      <main className={styles.main}>
        <div className={styles.pickers}>
          <Picker label={photos.from} visits={inOrder} chosen={from} onChoose={pickFrom} />
          <Picker label={photos.to} visits={inOrder} chosen={to} onChoose={pickTo} />
        </div>
        <CompareStage
          className={styles.stage}
          label={photos.divider}
          // What the number means: how much of each visit is showing, and which is which.
          valueText={(at) => photos.dividerAt(at, fullDate(from.date), fullDate(to.date))}
        >
          {leaving !== null && <Sides from={from} to={to} angle={leaving} onFailed={relink.failed} />}
          <Sides key={angle} from={from} to={to} angle={angle} className={ARRIVE} onFailed={relink.failed} />
        </CompareStage>
        <div className={styles.angles}>
          {COMPARE_ANGLES.map((each) => (
            <ToggleButton
              onInk
              pressed={each === angle}
              key={each}
              className={styles.angle}
              onClick={() => {
                if (each === angle) return;
                setLeaving(angle);
                setAngle(each);
              }}
            >
              {photos.compareAngles[each]}
            </ToggleButton>
          ))}
        </div>
      </main>
    </div>
  );
}
