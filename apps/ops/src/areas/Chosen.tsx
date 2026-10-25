// Settings › Areas' chosen pincodes (./Served.tsx): the bar that serves them or stops serving them together, shown
// once one is chosen, and the question a change waits on, the launch check where it would message people waiting.

import { Button } from "@maneman/ui/Button";
import { Toolbar } from "@maneman/ui/Toolbar";
import { TextButton } from "@maneman/ui/TextLink";
import { areas } from "../content.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { LaunchCheck } from "./ServedParts.tsx";
import type { Asking } from "./useAreaSaves.ts";
import styles from "./served.module.css";

const copy = areas.served.chosen;

export function ChosenBar(props: {
  readonly count: number;
  readonly onServe: (served: boolean) => void;
  readonly onClear: () => void;
}) {
  return (
    <Toolbar
      label={copy.count(props.count)}
      className={styles.chosen}
      end={
        <TextButton tone="muted" compact onClick={props.onClear}>
          {copy.clear}
        </TextButton>
      }
    >
      <span className={styles.count}>{copy.count(props.count)}</span>
      {[true, false].map((served) => (
        <Button
          key={String(served)}
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            props.onServe(served);
          }}
        >
          {served ? copy.serve : copy.stop}
        </Button>
      ))}
    </Toolbar>
  );
}

/** What a change waits on: who serving would message, or the bar's question. */
export function AskingCheck(props: {
  readonly asking: Asking;
  readonly busy: boolean;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}) {
  const { asking } = props;
  return (
    <div className={styles.inPanel}>
      {asking.launching.length > 0 ? (
        <LaunchCheck launching={asking.launching} busy={props.busy} onSend={props.onSend} onCancel={props.onCancel} />
      ) : (
        <CheckPanel question={asking.question ?? ""} busy={props.busy} onSend={props.onSend} onBack={props.onCancel} />
      )}
    </div>
  );
}
