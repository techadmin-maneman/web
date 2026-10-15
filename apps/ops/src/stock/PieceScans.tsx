// The pieces of a hair system a movement names, by their labels (docs/decisions/0162-scanning-labels.md): read by the
// camera, a USB scanner or typed, each once. Their count is the movement's quantity.

import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { ScanField } from "@maneman/ui/ScanField";
import { stockLabels as copy } from "../content/stock-labels.ts";
import form from "../components/forms.module.css";
import styles from "./piece-scans.module.css";

export function PieceScans({
  units,
  onUnits,
}: {
  units: readonly string[];
  onUnits: (units: readonly string[]) => void;
}) {
  return (
    <div className={form.group}>
      <ScanField
        className={form.field}
        words={copy.scan}
        onScan={(label) => {
          if (!units.includes(label)) onUnits([...units, label]);
        }}
      />
      {units.length > 0 && (
        <>
          <Note>{copy.scanned(units.length)}</Note>
          <ul className={styles.scans}>
            {units.map((label) => (
              <li className={styles.scan} key={label}>
                <span className={styles.scanCode}>{label}</span>
                <Button
                  variant="outline"
                  size="small"
                  aria-label={copy.removeLabel(label)}
                  onClick={() => {
                    onUnits(units.filter((each) => each !== label));
                  }}
                >
                  {copy.remove}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
