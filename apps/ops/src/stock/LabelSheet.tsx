// What the label printer prints (docs/decisions/0161-pieces-as-units.md): one label to a page, 50 by 25 mm, the QR code
// beside the label it holds, the item's name, and its lot and expiry. The sheet prints as soon as it is drawn, alone.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { encode } from "uqr";
import styles from "./label-sheet.module.css";

export interface PrintedLabel {
  readonly code: string;
  readonly name: string;
  /** The lot and its expiry, as the label shows them; null for a piece of no lot. */
  readonly lot: string | null;
}

/** The QR code's dark modules as one path, a module to a unit, inside a quiet border. */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  const path = data
    .flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${String(x)} ${String(y)}h1v1h-1z`] : [])))
    .join("");
  return (
    <svg className={styles.qr} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function LabelSheet({ labels, onPrinted }: { labels: readonly PrintedLabel[]; onPrinted: () => void }) {
  const done = useRef(onPrinted);
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    // A phone's browser prints after print() returns, so the sheet stays until the printing is over.
    window.addEventListener(
      "afterprint",
      () => {
        done.current();
      },
      { once: true },
    );
    window.print();
  }, []);
  return createPortal(
    <div id="label-sheet" className={styles.sheet} data-testid="label-sheet">
      {labels.map((label, index) => (
        <div className={styles.label} key={`${label.code}-${String(index)}`}>
          <QrCode text={label.code} />
          <div className={styles.words}>
            <span className={styles.code}>{label.code}</span>
            <span className={styles.name}>{label.name}</span>
            {label.lot !== null && <span>{label.lot}</span>}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
