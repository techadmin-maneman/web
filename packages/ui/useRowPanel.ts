import { useId, useState } from "react";

/** A row's button's props; `opening` runs as it opens, to fetch the detail, say. */
export type RowOpener = (
  key: string,
  opening?: () => void,
) => { "aria-expanded": boolean; "aria-controls": string | undefined; onClick: () => void };

/**
 * A list whose rows each open their detail in one panel beneath it. Each row's button says whether its panel is open
 * and which panel it opens, and pressing it again closes it; the panel, drawn as `<Panel id={panelId} opened>`, takes
 * the keyboard as it opens, so a press is never followed by nothing a screen reader can hear.
 */
export function useRowPanel(): {
  readonly open: string | null;
  readonly setOpen: (key: string | null) => void;
  readonly panelId: string;
  readonly opener: RowOpener;
} {
  const panelId = useId();
  const [open, setOpen] = useState<string | null>(null);
  const opener: RowOpener = (key, opening) => ({
    "aria-expanded": open === key,
    "aria-controls": open === key ? panelId : undefined,
    onClick: () => {
      if (open === key) {
        setOpen(null);
        return;
      }
      setOpen(key);
      opening?.();
    },
  });
  return { open, setOpen, panelId, opener };
}
