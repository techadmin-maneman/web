// One home on Today (ADR 0227): its figures, each a tile that opens where the figure is acted on, then two panels side
// by side, what needs the person on the left and the home's own list on the right: a time, what and whom, its state.
// A phone has the figures and what needs the person alone.

import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Columns } from "@maneman/ui/Layout";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Panel } from "@maneman/ui/Panel";
import { StatTile, type StatTone } from "@maneman/ui/StatTile";
import type { ReactNode } from "react";
import { today as copy } from "../content/today.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { useMayCall } from "../lib/access.ts";
import { useIsPhone } from "../lib/media.ts";
import { mayOpen, type Page, SECTION_NAMES, sectionOf } from "../route.ts";
import styles from "./today.module.css";

interface Figure {
  readonly label: string;
  readonly value: number | string;
  /** Where the figure is acted on; a person who may not open it is not shown the figure. */
  readonly page: Page;
  /** The tone a count above nought takes. */
  readonly tone?: StatTone;
  /** A short line beneath the figure. */
  readonly note?: string | undefined;
}

/** A figure, or null until what it counts has loaded or where the person may not read it. */
export type Shown = Figure | null;

const toneOf = (figure: Figure): StatTone =>
  typeof figure.value === "number" && figure.value > 0 ? (figure.tone ?? "plain") : "plain";

function Figures({ figures }: { figures: readonly Shown[] }) {
  const mayCall = useMayCall();
  const shown = figures.filter((figure): figure is Figure => figure !== null && mayOpen(mayCall, figure.page));
  // Where one tile has a line beneath its figure, every tile keeps its room, so the figures stand level.
  const noted = shown.some((figure) => figure.note !== undefined);
  return (
    <Columns row>
      {shown.map((figure) => (
        <StatTile
          key={figure.label}
          label={figure.label}
          value={figure.value}
          tone={toneOf(figure)}
          note={figure.note ?? (noted ? "" : undefined)}
          to={sectionOf(figure.page).path}
        />
      ))}
    </Columns>
  );
}

/** As many as sit beside Needs you without running past it. */
const ASIDE_SHOWN = 6;

export interface AsideRow {
  readonly key: string;
  /** A time, a count, or what the row is. */
  readonly lead: string;
  readonly title: string;
  readonly meta?: string;
  readonly state?: { readonly words: string; readonly tone: BadgeTone };
  readonly to?: string;
}

/**
 * The home's own list, beside Needs you: nothing until it has loaded, where the person may not read it, or where it is
 * empty with no words yet to say so.
 */
export function AsideList(props: {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly AsideRow[] | null;
  readonly none: string | undefined;
  /** The page the list is part of, linked by its name from the panel's head. */
  readonly page: Page;
}) {
  if (props.rows === null || (props.rows.length === 0 && props.none === undefined)) return null;
  return (
    <Panel
      titleId={props.id}
      title={props.title}
      actions={<OpsLink to={sectionOf(props.page).path}>{copy.openPage(SECTION_NAMES[props.page])}</OpsLink>}
    >
      {props.rows.length === 0 ? (
        <EmptyState look="panel" line={props.none ?? ""} />
      ) : (
        <ListRows inPanel>
          {props.rows.slice(0, ASIDE_SHOWN).map((row) => (
            <ListRow
              key={row.key}
              lead={row.lead}
              title={row.title}
              meta={row.meta}
              to={row.to}
              end={row.state === undefined ? undefined : <Badge tone={row.state.tone}>{row.state.words}</Badge>}
            />
          ))}
        </ListRows>
      )}
    </Panel>
  );
}

export function HomeLayout({
  figures,
  needs,
  aside,
}: {
  readonly figures: readonly Shown[];
  readonly needs: ReactNode;
  readonly aside: ReactNode;
}) {
  const phone = useIsPhone();
  return (
    <>
      <Figures figures={figures} />
      <div className={styles.panels}>
        {needs}
        {!phone && aside}
      </div>
    </>
  );
}
