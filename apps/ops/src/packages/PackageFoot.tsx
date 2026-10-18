// The foot of a package's record (./PackageRecord.tsx): its place in the order, retiring it or selling it again, and
// deleting one never sold, each asking in place first where it cannot simply be put back.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { addDays } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { packagesCopy as copy } from "../content/packages.ts";
import { useAccess } from "../lib/access.ts";
import { packagesApi, type Package, type Packages } from "./packages-api.ts";
import styles from "./packages.module.css";

type Sent = Awaited<ReturnType<typeof packagesApi.restore>>;

/** What a press asks: sent once at a time, its refusal said beside it, the page following its answer. */
function useSend(onChanged: (body: Packages) => void) {
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  const send = (call: () => Promise<Sent>) =>
    once(async () => {
      const answer = await call();
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      setRefused(null);
      onChanged(answer.body);
    });
  return { busy, refused, send };
}

/** Up and down the order, as the console, the app and the site list the packages. */
function Order(props: {
  readonly chosen: Package;
  readonly packages: Packages;
  readonly onChanged: (body: Packages) => void;
}) {
  const { busy, refused, send } = useSend(props.onChanged);
  const codes = props.packages.packages.map((each) => each.code);
  const at = codes.indexOf(props.chosen.code);
  const moved = (by: number) => {
    const order = [...codes];
    const [taken] = order.splice(at, 1);
    if (taken !== undefined) order.splice(at + by, 0, taken);
    return order;
  };
  return (
    <div className={styles.order}>
      <Button
        variant="quiet"
        size="small"
        busy={busy}
        disabled={at <= 0}
        onClick={() => void send(() => packagesApi.order(moved(-1)))}
      >
        {copy.foot.up}
      </Button>
      <Button
        variant="quiet"
        size="small"
        busy={busy}
        disabled={at >= codes.length - 1}
        onClick={() => void send(() => packagesApi.order(moved(1)))}
      >
        {copy.foot.down}
      </Button>
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}

/** Selling a retired package again, in one press: retiring it again is as easy. */
function SellAgain(props: { readonly chosen: Package; readonly onChanged: (body: Packages) => void }) {
  const { busy, refused, send } = useSend(props.onChanged);
  return (
    <>
      <Button
        variant="outline"
        size="small"
        busy={busy}
        onClick={() => void send(() => packagesApi.restore(props.chosen.code))}
      >
        {copy.foot.restore}
      </Button>
      {refused !== null && <Refusal said={refused} />}
    </>
  );
}

const asked = (open: string, name: string, warning: (name: string) => string) => ({
  open,
  label: () => `${open} ${name}`,
  warning,
  confirm: open,
  sending: open,
  cancel: copy.cancel,
});

export function PackageFoot(props: {
  readonly chosen: Package;
  readonly packages: Packages;
  readonly onChanged: (body: Packages) => void;
  readonly refresh: () => Promise<void>;
  readonly onGone: () => void;
}) {
  const { chosen } = props;
  const access = useAccess();
  const retired = chosen.retired_date !== null;
  return (
    <div className={styles.foot}>
      {access.mayCall("POST /api/packages/order") && (
        <Order chosen={chosen} packages={props.packages} onChanged={props.onChanged} />
      )}
      {retired && access.mayCall("POST /api/packages/{code}/restore") && (
        <SellAgain chosen={chosen} onChanged={props.onChanged} />
      )}
      {!retired && access.mayCall("POST /api/packages/{code}/retire") && (
        <DeleteAction
          name={chosen.name}
          tone="danger"
          words={asked(copy.foot.retire, chosen.name, copy.foot.retireAsk)}
          send={() => packagesApi.retire(chosen.code, addDays(props.packages.today, 1))}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={props.onChanged}
        />
      )}
      {chosen.deletable && access.mayCall("DELETE /api/packages/{code}") && (
        <DeleteAction
          name={chosen.name}
          words={asked(copy.foot.delete, chosen.name, copy.foot.deleteAsk)}
          send={() => packagesApi.remove(chosen.code)}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={async () => {
            await props.refresh();
            props.onGone();
          }}
        />
      )}
    </div>
  );
}
