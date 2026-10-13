// The technician's kit (docs/decisions/0164-the-kit-screen.md): what is on its way to it, received once in hand, a hair
// system's pieces scanned one by one; what it holds, each lot's expiry beside it; and the pieces that came off clients
// and any expired stock, handed back to the stockroom. Never a cost. Its writes need signal, and say so without it.

import { Field, TextInput } from "@maneman/ui/Field";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { IconButton } from "@maneman/ui/IconButton";
import { QrCamera } from "@maneman/ui/ScanField";
import { scanned } from "@maneman/ui/scanned";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { Offline } from "../components/Banners.tsx";
import { kit as copy, steps } from "../content.ts";
import { STROKE } from "../icons.ts";
import { useScreen } from "../lib/useScreen.ts";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { dayMonth } from "../lib/when.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { Failed, Loading } from "../states/States.tsx";
import frame from "../components/frame.module.css";
import styles from "./kit.module.css";

type Coming = Kit["coming"][number];

/** A label read in: typed and added, or read by the camera. */
function ScanLabel({ onLabel }: { onLabel: (label: string) => void }) {
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const add = (text: string) => {
    const label = scanned(text);
    if (label === "") return;
    onLabel(label);
    setTyped("");
  };
  return (
    <>
      <Field onInk className={styles.fieldLabel} label={copy.scan.label}>
        {(control) => (
          <TextInput
            {...control}
            onInk
            value={typed}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add(typed);
            }}
          />
        )}
      </Field>
      <div className={styles.buttons}>
        <Button
          variant="outlineOnInk"
          size="small"
          disabled={typed.trim() === ""}
          onClick={() => {
            add(typed);
          }}
        >
          {copy.scan.add}
        </Button>
        <Button
          variant="outlineOnInk"
          size="small"
          aria-pressed={scanning}
          onClick={() => {
            setScanning(!scanning);
          }}
        >
          {scanning ? copy.scan.stop : copy.scan.camera}
        </Button>
      </div>
      {scanning && (
        <QrCamera
          words={steps.piece.camera}
          onRead={(text) => {
            setScanning(false);
            add(text);
          }}
        />
      )}
    </>
  );
}

/** One top-up on its way: received whole, or of a hair system the pieces scanned, the rest lost on the way. */
function TopUp({ topUp, offline, onKit }: { topUp: Coming; offline: boolean; onKit: (kit: Kit) => void }) {
  const [scanned, setScanned] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const pieces = topUp.units.length > 0;
  const receive = async () => {
    const answer = await api.receiveTopUp(topUp.id, pieces ? scanned : null);
    if (answer.ok) onKit(answer.body);
    else setProblem(answer.status === 409 ? copy.coming.settled : copy.failed);
  };
  const label = pieces ? copy.coming.receiveScanned(scanned.length) : copy.coming.receive;
  return (
    <li>
      <p className={styles.line}>
        {topUp.name} · {topUp.quantity} {topUp.unit}
      </p>
      <p className={styles.note}>{copy.coming.from(topUp.from, dayMonth(indiaDate(topUp.sent_at)))}</p>
      {pieces && (
        <>
          <ScanLabel
            onLabel={(scan) => {
              if (!topUp.units.includes(scan)) {
                setProblem(copy.coming.notOnIt);
                return;
              }
              setProblem(null);
              if (!scanned.includes(scan)) setScanned([...scanned, scan]);
            }}
          />
          <p className={styles.note}>{copy.coming.scanned(scanned.length, topUp.units.length)}</p>
        </>
      )}
      {problem !== null && (
        <p className={styles.expired} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.buttons}>
        <Button
          variant="outlineOnInk"
          size="small"
          disabled={offline || (pieces && scanned.length === 0)}
          onClick={() => void receive()}
        >
          {offline ? copy.needsSignal : label}
        </Button>
      </div>
    </li>
  );
}

/** What the kit holds, each lot's expiry beside it, an expired one marked. */
function Held({ kit }: { kit: Kit }) {
  return (
    <section className={styles.section} aria-labelledby="kit-held">
      <h2 className={styles.sectionTitle} id="kit-held">
        {copy.held.title}
      </h2>
      {kit.held.length === 0 ? (
        <p className={styles.note}>{copy.held.none}</p>
      ) : (
        <ul className={styles.list}>
          {kit.held.map((item) => (
            <li key={item.code}>
              <p className={styles.line}>
                {item.name} · {item.quantity} {item.unit}
              </p>
              {item.hair_system && <p className={styles.note}>{copy.held.pieces(item.units.length)}</p>}
              {item.lots
                .filter((lot) => lot.expires_on !== null)
                .map((lot) => {
                  const on = fullDate(lot.expires_on ?? kit.today);
                  const gone = (lot.expires_on ?? kit.today) < kit.today;
                  return (
                    <p className={gone ? styles.expired : styles.note} key={lot.lot_code}>
                      {lot.lot_code} · {lot.quantity} · {gone ? copy.held.expired(on) : copy.held.expires(on)}
                    </p>
                  );
                })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The pieces that came off clients, and the kit's expired stock, handed back together or apart. */
function HandBack({ kit, offline, onKit }: { kit: Kit; offline: boolean; onKit: (kit: Kit) => void }) {
  const [done, setDone] = useState(false);
  const expired = kit.held.some((item) =>
    item.lots.some((lot) => lot.expires_on !== null && lot.expires_on < kit.today),
  );
  if (kit.returned.length === 0 && !expired) return done ? <p className={styles.status}>{copy.handedBack}</p> : null;
  const hand = async (body: { pieces: string[]; expired: boolean }) => {
    const answer = await api.handBack(body);
    if (!answer.ok) return;
    setDone(true);
    onKit(answer.body);
  };
  return (
    <section className={styles.section} aria-labelledby="kit-returned">
      <h2 className={styles.sectionTitle} id="kit-returned">
        {copy.returned.title}
      </h2>
      <ul className={styles.list}>
        {kit.returned.map((piece) => (
          <li className={styles.line} key={piece.piece_code}>
            {copy.returned.line(piece.piece_code, dayMonth(indiaDate(piece.returned_at)))}
          </li>
        ))}
      </ul>
      <div className={styles.buttons}>
        {kit.returned.length > 0 && (
          <Button
            variant="outlineOnInk"
            size="small"
            disabled={offline}
            onClick={() => void hand({ pieces: kit.returned.map((piece) => piece.piece_code), expired: false })}
          >
            {offline ? copy.needsSignal : copy.returned.handBack(kit.returned.length)}
          </Button>
        )}
        {expired && (
          <Button
            variant="outlineOnInk"
            size="small"
            disabled={offline}
            onClick={() => void hand({ pieces: [], expired: true })}
          >
            {offline ? copy.needsSignal : copy.expired.handBack}
          </Button>
        )}
      </div>
    </section>
  );
}

export function KitScreen() {
  const { offline } = useSession();
  const heading = useScreen(copy.title);
  const [loaded, retry] = useLoad(api.kit);
  const [after, setAfter] = useState<Kit | null>(null);
  const kit = after ?? (loaded.state === "loaded" ? loaded.value : null);
  return (
    <main className={styles.screen}>
      <header className={frame.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size={24}
          stroke={STROKE}
          label={copy.back}
          onClick={() => {
            go("/");
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>
      {offline && <Offline />}
      {kit === null && loaded.state === "loading" && <Loading />}
      {kit === null && loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {kit !== null && (
        <>
          {kit.coming.length > 0 && (
            <section className={styles.section} aria-labelledby="kit-coming">
              <h2 className={styles.sectionTitle} id="kit-coming">
                {copy.coming.title}
              </h2>
              <ul className={styles.list}>
                {kit.coming.map((topUp) => (
                  <TopUp key={topUp.id} topUp={topUp} offline={offline} onKit={setAfter} />
                ))}
              </ul>
            </section>
          )}
          <Held kit={kit} />
          <HandBack kit={kit} offline={offline} onKit={setAfter} />
        </>
      )}
    </main>
  );
}
