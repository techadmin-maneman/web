// The drawer of the job open on the dispatch board (./DispatchScreen.tsx): a tray job's, or a block's, with the
// actions the person's access reaches.

import type { BoardRow } from "../api.ts";
import type { Target } from "./job.ts";
import type { Access } from "../lib/access.ts";
import { BlockDrawer } from "./BlockDrawer.tsx";
import { changeFor, type Changing } from "./ChangePanel.tsx";
import { mayLetIn, nameOf, type Job } from "./job.ts";
import { TrayDrawer } from "./TrayDrawer.tsx";
import { apiNow } from "@maneman/web-kit/clock";

/** A tray job's drawer, with who is free to take it, for a person who may put a job on a technician. */
function OpenedTray(props: {
  opened: Extract<Job, { kind: "unassigned" }>;
  access: Access;
  technicians: readonly BoardRow[];
  onAssignTo: (job: Job, to: Target) => void;
  onTake: (job: Job) => void;
  onClose: () => void;
}) {
  const { opened } = props;
  const mayAssign = props.access.mayCall("POST /api/dispatch/assign");
  return (
    <TrayDrawer
      each={opened.job}
      technicians={props.technicians}
      onAssignTo={
        mayAssign
          ? (to) => {
              props.onAssignTo(opened, to);
            }
          : null
      }
      onClose={props.onClose}
      onAssign={
        mayAssign
          ? () => {
              props.onTake(opened);
            }
          : null
      }
    />
  );
}

export function OpenedDrawer({
  opened,
  access,
  onClose,
  onTake,
  onAssignTo,
  technicians,
  onTold,
  onWithdraw,
  onChange,
}: {
  opened: Job;
  access: Access;
  onClose: () => void;
  /** Takes the job up to move it; with the technician's check-in cleared, when ops chose that past the warning. */
  onTake: (job: Job, clearingCheckIn?: boolean) => void;
  /** Puts a tray job on a technician chosen of those free. */
  onAssignTo: (job: Job, to: Target) => void;
  technicians: readonly BoardRow[];
  onTold: (moveId: string, name: string) => void;
  /** Takes back a move to another day the client was asked to confirm. */
  onWithdraw: (proposalId: string, name: string) => void;
  onChange: (changing: Changing) => void;
}) {
  const mayMove = access.mayCall("POST /api/dispatch/move");
  if (opened.kind === "unassigned") {
    return (
      <OpenedTray
        opened={opened}
        access={access}
        technicians={technicians}
        onAssignTo={onAssignTo}
        onTake={onTake}
        onClose={onClose}
      />
    );
  }
  return (
    <BlockDrawer
      job={opened}
      onClose={onClose}
      onMove={
        mayMove
          ? () => {
              onTake(opened);
            }
          : null
      }
      onMoveAnyway={
        mayMove
          ? () => {
              onTake(opened, true);
            }
          : null
      }
      onTold={
        access.mayCall("POST /api/dispatch/moves/{id}/told")
          ? (moveId) => {
              onTold(moveId, opened.block.person?.name ?? nameOf(opened));
            }
          : null
      }
      onWithdraw={
        access.mayCall("POST /api/dispatch/proposals/{id}/withdraw")
          ? (proposalId) => {
              onWithdraw(proposalId, nameOf(opened));
            }
          : null
      }
      change={changeFor(opened, access)}
      onChange={(change) => {
        onChange({ job: opened, change });
      }}
      onLetIn={
        mayLetIn(opened.block, apiNow()) && access.mayCall("POST /api/visits/{id}/let-in")
          ? () => {
              onChange({ job: opened, change: "let_in" });
            }
          : null
      }
    />
  );
}
