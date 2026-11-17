// The hair system step scan-first (docs/decisions/0270-the-design-checks-api-side.md), as the prototype draws it: what
// is expected, the product with its spec and the piece it replaces; the scanner, with "Type the code" and "Can't fit
// today" beneath it, until a label reads; then the piece confirmed, against the profile and the kit. The base, the lot
// and the piece that came off are the label's and the card's, so the screen asks for the scan alone.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { QrCamera } from "@maneman/ui/ScanField";
import { StepMark } from "@maneman/ui/StepMark";
import { TextButton } from "@maneman/ui/TextLink";
import { useState, type ReactNode } from "react";
import type { Job } from "../api.ts";
import { job as jobCopy, profile as profileCopy, steps } from "../content.ts";
import { sayKnown } from "../lang/index.ts";
import { paidFor, profileNamesAnother } from "../lib/paid-for.ts";
import { dayMonth } from "../lib/when.ts";
import { asLabel, isLabel } from "./label.ts";
import type { Looked } from "./PieceFields.tsx";
import { cameOff, given, type Choice } from "./piece-form.ts";
import styles from "./piece-scan.module.css";

const copy = steps.piece;

type Fit = NonNullable<Job["profile"]>["fit"];
type MatchFit = Pick<Fit, "base_width_in" | "base_length_in" | "colour" | "grey_percent" | "density_percent">;

/** The spec a hair system is made to: "8 × 10 in · #1B · 20% grey · 120% density", each part only where it is known. */
export function specOf(fit: MatchFit): string {
  const rows = profileCopy.card;
  return [
    fit.base_width_in === null || fit.base_length_in === null ? null : rows.size(fit.base_width_in, fit.base_length_in),
    fit.colour === null ? null : rows.shade(profileCopy.colours[fit.colour], fit.grey_percent),
    fit.density_percent === null ? null : copy.density(fit.density_percent),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The product fitted, by name: chosen on a one visit, paid for on a first fit, the profile's on a replacement. */
export function productName(job: Job, choice: Choice): string | null {
  if (job.one_visit) return job.products.find((product) => product.tier === choice)?.name ?? null;
  if (job.type === "replacement") return job.profile?.fit.product_name ?? paidFor(job);
  return paidFor(job) ?? job.profile?.fit.product_name ?? null;
}

/** The first row's key: what the client chose, the new piece a replacement fits, or what a first fit was sold as. */
function productKey(job: Job): string {
  if (job.one_visit) return copy.expected.chosen;
  if (job.type === "replacement") return copy.expected.newPiece;
  return job.badge === "at_visit" ? jobCopy.piece.rows.bookedAs : jobCopy.piece.rows.paidFor;
}

function Row({ name, last = false, children }: { name: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={last ? styles.lastRow : styles.row}>
      <dt className={styles.key}>{name}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

/** What is expected: the product, the spec it is made to, and on a replacement the piece it replaces. */
export function Expected({ job, fit, choice }: { job: Job; fit: MatchFit | null; choice: Choice }) {
  const product = productName(job, choice);
  const spec = fit === null ? "" : specOf(fit);
  const old = cameOff(job);
  const inProfile = profileNamesAnother(job);
  return (
    <>
      <h2 className={styles.title}>{copy.scanTitle}</h2>
      <dl className={styles.rows}>
        {product !== null && <Row name={productKey(job)}>{sayKnown(product)}</Row>}
        {spec !== "" && <Row name={copy.expected.spec}>{spec}</Row>}
        {old !== null && (
          <Row name={copy.expected.replacing} last>
            {copy.listed(old.piece_code, old.fitted_at === null ? null : dayMonth(old.fitted_at))}
          </Row>
        )}
      </dl>
      {inProfile !== null && (
        <p className={styles.warn} role="alert">
          {jobCopy.piece.mismatch(inProfile)}
        </p>
      )}
    </>
  );
}

/** What the label's check found, beneath the scanner: nothing, another client's piece, or no answer. */
function LookedNote({ looked }: { looked: Looked }) {
  if (looked.state === "unknown" || looked.state === "offline") {
    return (
      <p className={styles.note} role="status">
        {looked.state === "unknown" ? copy.unknown : copy.offline}
      </p>
    );
  }
  if (looked.state !== "found" || looked.found.belongs_to_this_job) return null;
  return (
    <p className={styles.warn} role="alert">
      {copy.notThisClient}
    </p>
  );
}

/** The code typed in, checked as it reads; tried again once a check found no signal. */
function TypedCode(props: {
  code: string;
  offline: boolean;
  looking: boolean;
  onCode: (code: string) => void;
  onLook: () => void;
}) {
  const malformed = given(props.code) && !isLabel(props.code);
  return (
    <>
      <Field
        label={copy.typedLabel}
        error={malformed ? copy.malformed : null}
        look={{ label: styles.typedLabel, error: styles.warn }}
      >
        {(control) => (
          <TextInput
            {...control}
            value={props.code}
            placeholder={copy.placeholder}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              props.onCode(asLabel(event.target.value));
            }}
          />
        )}
      </Field>
      {props.offline && (
        <Button variant="outline" size="control" busy={props.looking} onClick={props.onLook}>
          {copy.checkAgain}
        </Button>
      )}
    </>
  );
}

/**
 * The scanner, live in the step, a label read going in as typed; "Type the code" and "Can't fit today" beneath it; and
 * the code typed, what the check says of it, and what it warns of.
 */
export function Scanner(props: {
  code: string;
  looked: Looked;
  looking: boolean;
  /** What the label warns of (piece-form's labelWarning); null for nothing. */
  warning: string | null;
  cannotFit: ReactNode;
  onCode: (code: string) => void;
  onLook: () => void;
}) {
  const [typing, setTyping] = useState(given(props.code));
  // Each read opens the camera afresh, so a label the check refuses can be followed by another.
  const [round, setRound] = useState(0);
  // A code that is no label, read or typed, shows in its box with what is wrong with it.
  const typed = typing || (given(props.code) && !isLabel(props.code));
  return (
    <div className={styles.scanner}>
      <QrCamera
        key={round}
        words={copy.camera}
        aim={copy.pointAt}
        onRead={(text) => {
          setRound(round + 1);
          props.onCode(asLabel(text));
        }}
      />
      <div className={styles.links}>
        <TextButton
          className={styles.link}
          aria-expanded={typed}
          onClick={() => {
            setTyping(!typed);
          }}
        >
          {copy.typeCode}
        </TextButton>
        {props.cannotFit}
      </div>
      {typed && (
        <TypedCode
          code={props.code}
          offline={props.looked.state === "offline"}
          looking={props.looking}
          onCode={props.onCode}
          onLook={props.onLook}
        />
      )}
      {props.warning !== null && (
        <p className={styles.warn} role="alert">
          {props.warning}
        </p>
      )}
      {props.looking ? (
        <p className={styles.note} role="status">
          {copy.checking}
        </p>
      ) : (
        <LookedNote looked={props.looked} />
      )}
    </div>
  );
}

/**
 * The piece read: its label, what it is, whether it is made to the client's profile and how many of it the kit keeps
 * after it; Rescan to read another. `matches` null where nothing tells, a piece from elsewhere or no profile; `left`
 * null for a piece from outside the kit.
 */
export function Confirmed(props: {
  code: string;
  line: string;
  matches: boolean | null;
  left: number | null;
  onRescan: () => void;
}) {
  return (
    <section className={styles.confirmed} aria-labelledby="piece-read">
      <div className={styles.read}>
        <StepMark state="done" />
        <div>
          <p className={styles.code} id="piece-read">
            {props.code}
          </p>
          {props.line !== "" && <p className={styles.line}>{props.line}</p>}
        </div>
      </div>
      <dl className={styles.rows}>
        {props.matches !== null && (
          <Row name={copy.confirmed.profile} last={props.left === null}>
            {props.matches ? (
              <span className={styles.match}>{copy.confirmed.match}</span>
            ) : (
              <span className={styles.mismatch}>{copy.otherThanFitted}</span>
            )}
          </Row>
        )}
        {props.left !== null && (
          <Row name={copy.confirmed.kit} last>
            {copy.confirmed.left(props.left)}
          </Row>
        )}
      </dl>
      <div className={styles.rescan}>
        <TextButton className={styles.link} onClick={props.onRescan}>
          {copy.confirmed.rescan}
        </TextButton>
      </div>
    </section>
  );
}

/**
 * The confirmed piece's line: the kit's hair system read, by its name; else what was expected, the product in Hindi
 * where a catalog holds its name, and the spec.
 */
export function lineOf(
  job: Job,
  read: { readonly choice: Choice; readonly stock: string | null; readonly fit: MatchFit | null },
): string {
  const name = job.kit_hair_systems.find((each) => each.code === read.stock)?.name;
  if (name !== undefined) return name;
  const product = productName(job, read.choice);
  const spec = read.fit === null ? "" : specOf(read.fit);
  return [product === null ? null : sayKnown(product), spec === "" ? null : spec]
    .filter((part) => part !== null)
    .join(" · ");
}
