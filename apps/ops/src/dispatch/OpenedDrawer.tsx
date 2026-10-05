// The drawer of the job open on the dispatch board (./DispatchScreen.tsx): a tray job's, or a block's, with the
// actions the person's access reaches.

import type { Access } from "../lib/access.ts";
import { BlockDrawer } from "./BlockDrawer.tsx";
import { changeFor, type Changing } from "./ChangePanel.tsx";
import { mayLetIn, nameOf, type Job } from "./job.ts";
import { TrayDrawer } from "./TrayDrawer.tsx";

export function OpenedDrawer({
  opened,
  access,
  onClose,
  onTake,
  onTold,
  onChange,
}: {
  opened: Job;
  access: Access;
  onClose: () => void;
  /** Takes the job up to move it; with the technician's check-in cleared, when ops chose that past the warning. */
  onTake: (job: Job, clearingCheckIn?: boolean) => void;
  onTold: (moveId: string, name: string) => void;
  onChange: (changing: Changing) => void;
}) {
  const mayMove = access.mayCall("POST /api/dispatch/move");
  if (opened.kind === "unassigned") {
    return (
      <TrayDrawer
        each={opened.job}
        onClose={onClose}
        onAssign={
          access.mayCall("POST /api/dispatch/assign")
            ? () => {
                onTake(opened);
              }
            : null
        }
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
      change={changeFor(opened, access)}
      onChange={(change) => {
        onChange({ job: opened, change });
      }}
      onLetIn={
        mayLetIn(opened.block, Date.now()) && access.mayCall("POST /api/visits/{id}/let-in")
          ? () => {
              onChange({ job: opened, change: "let_in" });
            }
          : null
      }
    />
  );
}
