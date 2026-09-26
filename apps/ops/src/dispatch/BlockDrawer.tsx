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
// dragging it, and everything the drag does can be done from here.

import { shortDate } from "@maneman/web-kit/dates";
import { ICONS } from "@maneman/brand/icons";
import { OpsLink } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { Dialog } from "./Dialog.tsx";
import styles from "./dispatch.module.css";
import { phoneWords } from "../lib/phone.ts";
import { firstNameOf, isMovable, nameOf, whatsAppLink, type BlockJob } from "./job.ts";

interface Props {
  readonly job: BlockJob;
  readonly onMove: () => void;
  readonly onTold: (moveId: string) => void;
  readonly onClose: () => void;
}

export function BlockDrawer({ job, onMove, onTold, onClose }: Props) {
  const copy = dispatch.drawer;
  const { block } = job;
  const person = block.person;

  // A move the client has not heard of still stands, so the block is where it put the visit.
  const movedTo = `${shortDate(job.date)}, ${dispatch.windows[block.window] ?? block.window}`;
  const referredBy = person === null ? null : person.referred_by;
  const typeName = block.type === null ? dispatch.unknown : (dispatch.typeNames[block.type] ?? dispatch.unknown);
  const rows = [
    { key: copy.rows.type, value: copy.type(typeName, block.slots) },
    { key: copy.rows.area, value: block.sector === null ? dispatch.unknown : copy.area(block.sector, block.pincode) },
    { key: copy.rows.state, value: copy.states[block.status] ?? block.status },
    ...(referredBy === null ? [] : [{ key: copy.rows.referred, value: referredBy }]),
  ];

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
            <p className={styles.untoldLine}>{copy.untold(movedTo, phoneWords(person.mobile))}</p>
            <button
              className={styles.quiet}
              type="button"
              onClick={() => {
                if (block.untold !== null) onTold(block.untold.move_id);
              }}
            >
              {dispatch.landing.told}
            </button>
          </div>
        )}
        <div className={styles.drawerActions}>
          {person !== null && (
            <>
              <a className={styles.quiet} href={whatsAppLink(person.mobile)} target="_blank" rel="noopener noreferrer">
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={ICONS.whatsapp} />
                </svg>
                {copy.whatsapp(firstNameOf(person))}
              </a>
              <OpsLink className={styles.quiet} to={`/clients/${person.id}`}>
                {copy.openClient}
              </OpsLink>
            </>
          )}
          {isMovable(block) && (
            <button className={styles.quiet} type="button" onClick={onMove}>
              {copy.move}
            </button>
          )}
          <button className={styles.quiet} type="button" onClick={onClose}>
            {copy.close}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
