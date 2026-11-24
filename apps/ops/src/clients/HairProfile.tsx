// The client's hair profile, on their Pieces tab (docs/decisions/0106-a-clients-hair-profile.md): the profile, the fit
// spec a replacement is ordered to, a row each under the design's headings, and every version with who recorded it at
// which visit. Each row is corrected from its own Change (docs/decisions/0314-change-everywhere-and-forms-in-a-grid.md;
// its box, ./ProfileBoxes.tsx); its save sends the whole profile again, that row changed, as a new version.

import { typeLook } from "@maneman/ui/type";
import { errorText } from "@maneman/web-kit/refusal";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Disclosure } from "@maneman/ui/Disclosure";
import { capsLook } from "@maneman/ui/Caps";
import { EditableRow } from "@maneman/ui/EditableRow";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, yearInIndia } from "@maneman/web-kit/dates";
import { bodyOf, fitOf, historyOf, type FigureName } from "@maneman/web-kit/hair-profile";
import { useCallback, useId, useState, type ReactNode } from "react";
import { type ClientHairProfile, type HairProfileVersion, type HairProfileView } from "../api.ts";
import { clients, dispatch, NOT_PERMITTED, OFFLINE } from "../content.ts";
import { EDITING } from "../content/common.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./profile.module.css";
import { isOneOf } from "@rules/lib/one-of.ts";
import {
  draftOf,
  HISTORY_ROWS,
  isCode,
  listOf,
  productOptions,
  RowBox,
  type Code,
  type Draft,
  type Row,
} from "./ProfileBoxes.tsx";
import { Refusal } from "@maneman/ui/Refusal";
import { clientsApi } from "./clients-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.profile;

/** A row's Save, which keeps the whole profile as a new version. */
const WORDS = { ...EDITING, save: copy.save };

/** The fit spec under the design's headings, in the order the technician's phone takes it. */
const FIT_GROUPS = [
  {
    name: "head",
    rows: ["norwood_stage", "head_circumference_in", "front_to_nape_in", "ear_to_ear_in", "temple_to_temple_in"],
  },
  { name: "base", rows: ["base_width_in", "base_length_in"] },
  { name: "hair", rows: ["colour", "grey_percent", "density_percent", "wave", "hairline"] },
  { name: "product", rows: ["product", "attachment"] },
] as const satisfies readonly { readonly name: string; readonly rows: readonly (Code | FigureName)[] }[];

const FIT_ROWS: readonly (Code | FigureName)[] = FIT_GROUPS.flatMap((group) => group.rows);

const isHistory = (row: Row): row is (typeof HISTORY_ROWS)[number] => isOneOf(HISTORY_ROWS, row);

/** A code's words, or the table's gap where none was recorded. */
function wordsOf(field: Code, fit: HairProfileView["fit"]): string {
  const value = fit[field];
  if (value === null) return clients.unknown;
  if (field === "product") return fit.product_name ?? String(value);
  return listOf(field).find((option) => option.value === String(value))?.label ?? String(value);
}

const figureOf = (value: number | null): string => (value === null ? clients.unknown : String(value));

/** A row's value in a version, or the gap where it holds none. */
function valueOf(row: Row, profile: HairProfileView | null): string {
  if (profile === null) return clients.unknown;
  const { fit, history } = profile;
  if (row === "remedies") {
    const remedies = (history?.remedies ?? []).map((remedy) => copy.remedies[remedy]).join(", ");
    return remedies === "" ? clients.unknown : remedies;
  }
  if (row === "transplant_year") return figureOf(history?.transplant_year ?? null);
  if (row === "skin_and_allergies") return history?.skin_and_allergies ?? clients.unknown;
  return isCode(row) ? wordsOf(row, fit) : figureOf(fit[row]);
}

/** What a row was in the version before, where that version holds it. */
const wasOf = (row: Row, previous: HairProfileView | null): string | undefined =>
  previous === null || (isHistory(row) && previous.history === null) ? undefined : valueOf(row, previous);

/** A row's value, saying what it was where it differs from the version before. */
function shownOf(row: Row, profile: HairProfileView | null, previous: HairProfileView | null): ReactNode {
  const value = valueOf(row, profile);
  const was = wasOf(row, previous);
  if (was === undefined || was === value) return value;
  return (
    <>
      {value}
      <span className={styles.was}>{copy.was(was)}</span>
    </>
  );
}

/** A version's rows, each that differs from the version before it saying what it was. */
function ProfileRows({ profile, previous }: { profile: HairProfileView; previous: HairProfileView | null }) {
  const rows: readonly Row[] = profile.history === null ? FIT_ROWS : [...FIT_ROWS, ...HISTORY_ROWS];
  return (
    <DescriptionList
      layout="list"
      items={rows.map((row) => ({ term: copy.rows[row], details: shownOf(row, profile, previous) }))}
    />
  );
}

/** Who recorded a version: the technician at the visit, or the member of staff who corrected it. */
function byWhom(version: HairProfileVersion): string {
  if (version.recorded_by.kind === "ops") return copy.byOps(version.recorded_by.staff);
  const name = version.recorded_by.name ?? copy.unnamed;
  const type = version.visit?.type ?? null;
  return copy.atVisit(name, type === null ? copy.aVisit : dispatch.typeNames[type]);
}

function Versions({ versions }: { versions: readonly HairProfileVersion[] }) {
  return (
    <section className={styles.versions} aria-labelledby="hair-profile-versions">
      <h4 className={capsLook(styles.subtitle)} id="hair-profile-versions">
        {copy.versions}
      </h4>
      <ol className={styles.versionList}>
        {versions.map((version, index) => (
          <li key={version.id}>
            <Disclosure
              className={styles.version}
              summary={copy.version(longDate(version.recorded_at), byWhom(version))}
            >
              <ProfileRows profile={version} previous={versions[index + 1] ?? null} />
            </Disclosure>
          </li>
        ))}
      </ol>
    </section>
  );
}

type GroupName = keyof typeof copy.groups;

/** The headings a profile is corrected under, each with its rows: a transplant's year only where one was tried. */
function groupsToCorrect(latest: HairProfileView | null): readonly { name: GroupName; rows: readonly Row[] }[] {
  const transplant = latest?.history?.remedies.includes("transplant") ?? false;
  return [
    ...FIT_GROUPS,
    { name: "history", rows: HISTORY_ROWS.filter((row) => row !== "transplant_year" || transplant) },
  ];
}

/** A heading and its rows, which it names for a screen reader. */
function Group(props: { name: GroupName; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.group} role="group" aria-labelledby={id}>
      <h4 className={styles.groupTitle} id={id}>
        {copy.groups[props.name]}
      </h4>
      {props.children}
    </div>
  );
}

/**
 * The latest profile, a row each, each corrected from its own Change: the whole profile sent again as a new version,
 * from the version it was read from, so one recorded meanwhile is never silently replaced.
 */
function LatestRows(props: {
  clientId: string;
  page: ClientHairProfile;
  mayCorrect: boolean;
  onSaved: (page: ClientHairProfile) => void;
  /** Another version became the latest while a row was open: the profile is to be read again. */
  onMoved: () => void;
}) {
  const { page } = props;
  const latest = page.latest;
  const previous = page.versions[1] ?? null;
  const products = productOptions(page.products, latest);
  const save = async (draft: Draft): Promise<string | null> => {
    const thisYear = yearInIndia(apiNow());
    const fit = fitOf(draft.fit);
    const history = historyOf(draft.history, thisYear);
    if (fit === null || history === null) return copy.invalid;
    const answer = await clientsApi.correctHairProfile(props.clientId, bodyOf(fit, history, latest?.id ?? null));
    if (answer.ok) {
      props.onSaved(answer.body);
      return null;
    }
    if (answer.status === 409) {
      props.onMoved();
      return copy.moved;
    }
    if (answer.status === 400 && answer.fields.length > 0) return copy.invalid;
    return errorText({ not_permitted: NOT_PERMITTED, offline: OFFLINE, unknown: copy.failed }, answer);
  };
  return (
    <div className={styles.rows}>
      {groupsToCorrect(latest).map((group) => (
        <Group key={group.name} name={group.name}>
          {group.rows.map((row) => (
            <EditableRow<Draft>
              key={row}
              label={copy.rows[row]}
              words={WORDS}
              mayChange={props.mayCorrect}
              value={shownOf(row, latest, latest === null ? null : previous)}
              now={valueOf(row, latest)}
              start={() => draftOf(latest)}
              save={save}
            >
              {(control, draft, setDraft) => (
                <RowBox row={row} control={control} draft={draft} setDraft={setDraft} products={products} />
              )}
            </EditableRow>
          ))}
        </Group>
      ))}
    </div>
  );
}

export function HairProfile({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.clientHairProfile(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  // What a correction answered, which stands over what was read when the tab opened.
  const [saved, setSaved] = useState<ClientHairProfile | null>(null);
  // A correction refused because another version became the latest meanwhile: the profile was read again.
  const [moved, setMoved] = useState(false);
  const mayCorrect = useAccess().mayCall("POST /api/clients/{id}/hair-profile");

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const page = saved ?? loaded.value;
  return (
    <section className={styles.profile} aria-labelledby="hair-profile-title">
      <h3 className={typeLook("title-4", styles.title)} id="hair-profile-title">
        {copy.title}
      </h3>
      {moved && <Refusal className={styles.error} said={copy.moved} />}
      {page.latest === null && <p className={styles.hint}>{copy.none}</p>}
      {(page.latest !== null || mayCorrect) && (
        <LatestRows
          clientId={clientId}
          page={page}
          mayCorrect={mayCorrect}
          onSaved={(next) => {
            setSaved(next);
            setMoved(false);
          }}
          onMoved={() => {
            setSaved(null);
            setMoved(true);
            retry();
          }}
        />
      )}
      {page.versions.length > 0 && <Versions versions={page.versions} />}
    </section>
  );
}
