// Settings › Areas' chosen pincodes (./Served.tsx): the bar that serves them, stops serving them, schedules them for a
// later day or pauses them, shown once one is chosen, and the question a change waits on, the launch check where it
// would message people waiting (docs/decisions/0221-launches-scheduled-paused-and-checked.md).

import { Button } from "@maneman/ui/Button";
import { Toast } from "@maneman/ui/Toast";
import { Toolbar } from "@maneman/ui/Toolbar";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import type { ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { useAccess } from "../lib/access.ts";
import { LaunchCheck } from "./ServedParts.tsx";
import { ChosenForms, type ChosenForm } from "./Launches.tsx";
import type { Asking } from "./useAreaSaves.ts";
import { areasApi } from "./areas-api.ts";
import styles from "./served.module.css";

const copy = areas.served.chosen;

/** The bar's buttons: Schedule for pincodes not served yet, Pause for those served, each where the person may. */
function ChosenButtons(props: {
  readonly chosen: readonly ServedPincode[];
  readonly busy: boolean;
  readonly onServe: () => void;
  readonly onStop: () => void;
  readonly onOpen: (form: ChosenForm) => void;
}) {
  const access = useAccess();
  const offers = [
    { form: "schedule", words: areas.launches.schedule, shown: props.chosen.some((each) => !each.served) },
    { form: "pause", words: areas.pause.pause, shown: props.chosen.some((each) => each.served) },
  ] as const;
  const may = { schedule: "POST /api/pincode-launches", pause: "POST /api/service-area/pause" } as const;
  return (
    <>
      <Button variant="outline" size="small" narrow onClick={props.onServe}>
        {copy.serve}
      </Button>
      <Button variant="outline" size="small" narrow disabled={props.busy} onClick={props.onStop}>
        {copy.stop}
      </Button>
      {offers
        .filter((each) => each.shown && access.mayCall(may[each.form]))
        .map((each) => (
          <Button
            key={each.form}
            variant="outline"
            size="small"
            narrow
            onClick={() => {
              props.onOpen(each.form);
            }}
          >
            {each.words}
          </Button>
        ))}
    </>
  );
}

export function ChosenBar(props: {
  readonly city: string;
  readonly chosen: readonly ServedPincode[];
  /** `note`, beneath the question: what stopping leaves in place. */
  readonly onServe: (served: boolean, note?: string) => void;
  readonly onPaused: (pincodes: readonly string[], until: string | null) => void;
  readonly onClear: () => void;
}) {
  const [open, setOpen] = useState<ChosenForm>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const count = props.chosen.length;

  const stop = () =>
    once(async () => {
      const answer = await areasApi.stopImpact(props.chosen.map((each) => each.pincode));
      props.onServe(false, answer.ok ? copy.stopLeaves(answer.body.visits, answer.body.clients) : "");
    });

  if (open !== null) {
    return (
      <ChosenForms
        open={open}
        city={props.city}
        chosen={props.chosen}
        onPaused={props.onPaused}
        onClose={(done) => {
          setOpen(null);
          setSaid(done);
        }}
      />
    );
  }
  return (
    <Toolbar
      label={copy.count(count)}
      className={styles.chosen}
      end={
        <TextButton tone="muted" compact onClick={props.onClear}>
          {copy.clear}
        </TextButton>
      }
    >
      <span className={styles.count}>{copy.count(count)}</span>
      <ChosenButtons
        chosen={props.chosen}
        busy={busy}
        onServe={() => {
          props.onServe(true);
        }}
        onStop={() => void stop()}
        onOpen={setOpen}
      />
      {said !== null && <Toast>{said}</Toast>}
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
