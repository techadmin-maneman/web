// Board A1's tray, opened: a job nobody holds yet, read before it is put on a
// technician. The client, the window asked beside the one offered, the visit's
// details, the block drawer's two ways to the client, and Assign, which takes
// the job up as a drag from the tray does.

import { ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink, buttonLook } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import type { Unassigned } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { clientPath } from "../route.ts";
import styles from "./dispatch.module.css";
import { firstNameOf, nameOf } from "./job.ts";
import { askedWord, offeredWord } from "./Tray.tsx";

interface Props {
  readonly each: Unassigned;
  /** Null when the person's access does not let them put a job on a technician. */
  readonly onAssign: (() => void) | null;
  readonly onClose: () => void;
}

export function TrayDrawer({ each, onAssign, onClose }: Props) {
  const copy = dispatch.drawer;
  const person = each.person;
  const referredBy = person === null ? null : person.referred_by;
  const typeName = each.type === null ? dispatch.unknown : (dispatch.typeNames[each.type] ?? dispatch.unknown);
  const rows = [
    { key: copy.rows.type, value: copy.type(typeName, each.slots) },
    ...(each.service === null ? [] : [{ key: copy.rows.service, value: each.service }]),
    { key: copy.rows.area, value: each.sector === null ? dispatch.unknown : copy.area(each.sector, each.pincode) },
    ...(referredBy === null ? [] : [{ key: copy.rows.referred, value: referredBy }]),
  ];

  return (
    <Dialog className={styles.panel} labelledBy="tray-drawer-title" canClose onDismiss={onClose}>
      <div className={styles.drawerHead}>
        <div>
          <h2 className={styles.drawerTitle} id="tray-drawer-title">
            {person?.name ?? nameOf({ kind: "unassigned", job: each })}
          </h2>
          <p className={styles.drawerWhen}>
            {askedWord(each)} · {dispatch.tray.offered(offeredWord(each.date, each.offered_window))}
          </p>
        </div>
        <span className={styles.badge}>{copy.badges[each.badge] ?? each.badge}</span>
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
        {each.was_technician !== null && (
          <p className={styles.untoldLine}>{dispatch.tray.was(each.was_technician.name)}</p>
        )}
        <div className={styles.drawerActions}>
          {onAssign !== null && (
            <Button variant="outline" size="small" onClick={onAssign}>
              {copy.assign}
            </Button>
          )}
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
          <Button variant="outline" size="small" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
