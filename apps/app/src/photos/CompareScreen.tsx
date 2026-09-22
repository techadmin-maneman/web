// Compare (board D2): one angle from two visits, on ink and without the tabs.
// The earlier visit shows left of a divider that follows the finger, with no
// easing and no snap; the keyboard moves it too. Changing the angle
// cross-fades both sides together. It opens on the first visit with
// photographs against the latest.

import { ICONS } from "@maneman/brand/icons";
import { fullDate } from "@maneman/web-kit/dates";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { api, type PhotoLink, type PhotoTimeline } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { photos } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { shownPhase } from "./PhotoRow.tsx";
import styles from "./compare.module.css";

type Visit = PhotoTimeline["visits"][number];
type CompareAngle = keyof typeof photos.compareAngles;
const COMPARE_ANGLES = Object.keys(photos.compareAngles) as CompareAngle[];
/** How long the angles cross-fade: the one curve's 300 ms (tokens.css, --ease). */
const FADE_MS = 300;

const photoOf = (visit: Visit, angle: CompareAngle): PhotoLink | undefined =>
  visit.photos[shownPhase(visit.photos)].find((link) => link.angle === angle);

export function CompareScreen() {
  const [loaded, retry] = useLoad(api.photos);
  if (loaded.state === "loaded") {
    // Newest first: the latest visit, and the first with photographs.
    const { visits } = loaded.value;
    const [latest, earliest] = [visits[0], visits.at(-1)];
    if (latest !== undefined && earliest !== undefined && latest !== earliest) {
      return <Compare visits={visits} earliest={earliest} latest={latest} />;
    }
  }
  return (
    <Shell header={{ kind: "back", title: photos.compare, to: "/photos", label: photos.back }} tab="/photos">
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <p className={styles.none}>{photos.compareNone}</p>
      )}
    </Shell>
  );
}

function Picker(props: { label: string; visits: readonly Visit[]; chosen: Visit; onChoose: (visit: Visit) => void }) {
  return (
    <label className={styles.picker}>
      <span className={styles.pickerLabel}>{props.label}</span>
      <span className={styles.pickerValue} aria-hidden="true">
        {fullDate(props.chosen.date)}
      </span>
      <select
        aria-label={props.label}
        value={props.chosen.visit_id}
        onChange={(event) => {
          const visit = props.visits.find((each) => each.visit_id === event.target.value);
          if (visit !== undefined) props.onChoose(visit);
        }}
      >
        {props.visits.map((visit) => (
          <option key={visit.visit_id} value={visit.visit_id}>
            {fullDate(visit.date)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Both sides of one angle; the earlier is cut at the divider. */
function Sides({ from, to, angle, className }: { from: Visit; to: Visit; angle: CompareAngle; className?: string }) {
  const side = (visit: Visit, which: string) => {
    const link = photoOf(visit, angle);
    const date = fullDate(visit.date);
    return (
      <div className={which}>
        {link !== undefined && (
          <img src={link.url} alt={photos.alt(photos.compareAngles[angle], shownPhase(visit.photos), date)} />
        )}
        <span className={styles.date}>{date}</span>
      </div>
    );
  };
  return (
    <div className={`${styles.sides} ${className ?? ""}`}>
      {side(to, styles.later ?? "")}
      {side(from, styles.earlier ?? "")}
    </div>
  );
}

function Compare({ visits, earliest, latest }: { visits: readonly Visit[]; earliest: Visit; latest: Visit }) {
  // The pickers list the visits in time order.
  const inOrder = [...visits].reverse();
  const [from, setFrom] = useState(earliest);
  const [to, setTo] = useState(latest);
  const [angle, setAngle] = useState<CompareAngle>("front");
  const [leaving, setLeaving] = useState<CompareAngle | null>(null);
  const [at, setAt] = useState(50);
  const stage = useRef<HTMLDivElement>(null);

  // The other angles of both visits load now, so a change of angle fades between two photographs.
  useEffect(() => {
    for (const visit of [from, to]) {
      for (const each of COMPARE_ANGLES) {
        const link = photoOf(visit, each);
        if (link !== undefined) new Image().src = link.url;
      }
    }
  }, [from, to]);

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => {
      setLeaving(null);
    }, FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, angle]);

  // The divider's place goes to the stylesheet through the CSSOM, which the policy allows where it refuses
  // a style attribute.
  useLayoutEffect(() => {
    stage.current?.style.setProperty("--at", `${String(at)}%`);
  }, [at]);

  const follow = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    setAt(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
  }, []);

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Readonly<Record<string, (now: number) => number>> = {
      ArrowLeft: (now) => now - 2,
      ArrowDown: (now) => now - 2,
      ArrowRight: (now) => now + 2,
      ArrowUp: (now) => now + 2,
      PageDown: (now) => now - 10,
      PageUp: (now) => now + 10,
      Home: () => 0,
      End: () => 100,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setAt((now) => Math.min(100, Math.max(0, move(now))));
  };

  return (
    <div className={styles.compare}>
      <header className={styles.header}>
        <AppLink className={styles.back} to="/photos" label={photos.back}>
          <Icon d={ICONS.back} size={22} />
        </AppLink>
        <h1 className={styles.title}>{photos.compare}</h1>
      </header>
      <main className={styles.main}>
        <div className={styles.pickers}>
          <Picker label={photos.from} visits={inOrder} chosen={from} onChoose={setFrom} />
          <Picker label={photos.to} visits={inOrder} chosen={to} onChoose={setTo} />
        </div>
        <div
          ref={stage}
          className={styles.stage}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            follow(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event);
          }}
        >
          {leaving !== null && <Sides from={from} to={to} angle={leaving} />}
          <Sides key={angle} from={from} to={to} angle={angle} className={styles.arriving} />
          <div className={styles.divider} />
          <div
            className={styles.handle}
            role="slider"
            tabIndex={0}
            aria-label={photos.divider}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(at)}
            onKeyDown={step}
          >
            <Icon d={ICONS.handleLeft} size={14} />
            <Icon d={ICONS.handleRight} size={14} />
          </div>
        </div>
        <div className={styles.angles}>
          {COMPARE_ANGLES.map((each) => (
            <button
              key={each}
              className={styles.angle}
              type="button"
              aria-pressed={each === angle}
              onClick={() => {
                if (each === angle) return;
                setLeaving(angle);
                setAngle(each);
              }}
            >
              {photos.compareAngles[each]}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
