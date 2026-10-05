import { Button } from "@maneman/ui/Button";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import type { Notice } from "./landing.ts";

/** What a move did or why it was refused; a call still to make carries the button that records it. */
export function NoticeLine({
  notice,
  onTold,
}: {
  notice: Notice;
  onTold: (moveId: string, name: string) => Promise<void>;
}) {
  const done = notice.tone === "done";
  return (
    <div className={done ? styles.done : styles.refusal} role={done ? "status" : "alert"}>
      <p className={styles.noticeText}>{notice.text}</p>
      {notice.call !== null && (
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            if (notice.call !== null) void onTold(notice.call.moveId, notice.call.name);
          }}
        >
          {dispatch.landing.told}
        </Button>
      )}
    </div>
  );
}
