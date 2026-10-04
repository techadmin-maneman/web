// Board A3: the drawer one block on the board opens. The client in full, the
// time and the technician, the payment badge, the visit's details, and the
// board's two ways to the client: WhatsApp {client} and Open client.
//
// What the board draws and a block does not carry (the client's tier, access
// note, payment and visit count) is on the client's page, one tap away
// (docs/fidelity-method.md). A move the client has not heard of is named here,
// with his number, and closed here once ops have called him.
//
// The drawer is also the keyboard way into a move: the design moves a block by
// dragging it, and everything the drag does can be done from here. A visit the
// technician has started has no move, and the drawer says why; one he has only
// checked in at moves from here alone, after a warning that it clears his
// check-in. A visit still ahead can be cancelled for the client here, and one
// whose time has come closed by hand, each in its own panel.

import { ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink, buttonLook } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { shortDate } from "@maneman/web-kit/dates";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { OpsLink } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { firstNameOf, isMovable, movesIfCheckInCleared, nameOf, type BlockJob, type VisitChange } from "./job.ts";

/** Each action is null when the person's access does not let them take it. */
interface Props {
  readonly job: BlockJob;
  readonly onMove: (() => void) | null;
  /** Takes up a visit the technician has checked in at, to move once his check-in is cleared. */
  readonly onMoveAnyway: (() => void) | null;
  readonly onTold: ((moveId: string) => void) | null;
  /** The change the visit takes now, if their access reaches it: cancelled ahead, or closed by hand after. */
  readonly change: VisitChange | null;
  readonly onChange: (change: VisitChange) => void;
  readonly onClose: () => void;
}

/** The State row: how far the technician has got, from his phone, until the visit is done. */
function stateOf(block: BlockJob["block"]): string {
  const copy = dispatch.drawer;
  if (block.begun !== null && block.status !== "completed") return copy.begun[block.begun] ?? block.begun;
  return copy.states[block.status] ?? block.status;
}

/** Why a visit under way has no ordinary move: it stays where it is, or moves only once the check-in is cleared. */
function warningOf(job: BlockJob): string | null {
  const { block } = job;
  if (isMovable(block) || block.status === "completed") return null;
  if (movesIfCheckInCleared(block)) return dispatch.drawer.checkedIn(job.technician.name);
  return dispatch.drawer.stays;
}

export function BlockDrawer({ job, onMove, onMoveAnyway, onTold, change, onChange, onClose }: Props) {
  const copy = dispatch.drawer;
  const { block } = job;
  const person = block.person;

  // A move the client has not heard of still stands, so the block is where it put the visit.
  const movedTo = `${shortDate(job.date)}, ${dispatch.windows[block.window] ?? block.window}`;
  const referredBy = person === null ? null : person.referred_by;
  const typeName = block.type === null ? dispatch.unknown : (dispatch.typeNames[block.type] ?? dispatch.unknown);
  const rows = [
    { key: copy.rows.type, value: copy.type(typeName, block.slots) },
    ...(block.service === null ? [] : [{ key: copy.rows.service, value: block.service }]),
    { key: copy.rows.area, value: block.sector === null ? dispatch.unknown : copy.area(block.sector, block.pincode) },
    { key: copy.rows.state, value: stateOf(block) },
    ...(referredBy === null ? [] : [{ key: copy.rows.referred, value: referredBy }]),
    ...(block.client_note === null ? [] : [{ key: copy.rows.note, value: block.client_note }]),
  ];
  const warning = warningOf(job);

  return (
    <Dialog className={styles.panel} labelledBy="drawer-title" canClose onDismiss={onClose}>
      <div className={styles.drawerHead}>
        <div>
          <h2 className={styles.drawerTitle} id="drawer-title">
            {person?.name ?? nameOf(job)}
          </h2>
          <p className={styles.drawerWhen}>
            {copy.when(
              shortDate(job.date),
              dispatch.windowHours[block.window] ?? dispatch.unknown,
              job.technician.name,
            )}
          </p>
        </div>
        <span className={styles.badge}>{copy.badges[block.badge] ?? block.badge}</span>
      </div>
      <div className={styles.drawerBody}>
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div className={styles.row} key={row.key}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {block.untold !== null && person !== null && (
          <div className={styles.untold}>
            <p className={styles.untoldLine}>{copy.untold[block.untold.reason](movedTo, phoneWords(person.mobile))}</p>
            {onTold !== null && (
              <Button
                variant="outline"
                size="small"
                onClick={() => {
                  if (block.untold !== null) onTold(block.untold.move_id);
                }}
              >
                {dispatch.landing.told}
              </Button>
            )}
          </div>
        )}
        {warning !== null && <p className={styles.untoldLine}>{warning}</p>}
        <div className={styles.drawerActions}>
          {person !== null && (
            <>
              <ButtonLink
                variant="outline"
                size="small"
                href={whatsappChat(person.mobile)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={ICONS.whatsapp} />
                </svg>
                {copy.whatsapp(firstNameOf(person))}
              </ButtonLink>
              <OpsLink
                className={buttonLook({ variant: "outline", size: "small" })}
                to={clientPath(person.id, "visits")}
              >
                {copy.openClient}
              </OpsLink>
            </>
          )}
          {isMovable(block) && onMove !== null && (
            <Button variant="outline" size="small" onClick={onMove}>
              {copy.move}
            </Button>
          )}
          {movesIfCheckInCleared(block) && onMoveAnyway !== null && (
            <Button variant="outline" size="small" onClick={onMoveAnyway}>
              {copy.moveAnyway}
            </Button>
          )}
          {change !== null && (
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                onChange(change);
              }}
            >
              {change === "cancel" ? copy.cancel : copy.closeByHand}
            </Button>
          )}
          <Button variant="outline" size="small" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
