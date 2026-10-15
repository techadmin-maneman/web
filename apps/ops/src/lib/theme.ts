// The console's theme: the computer's, unless the person has chosen light or dark in the account menu. The choice is
// kept in this browser alone and set on <html> as data-theme, which ../styles/theme.css reads. Storage a browser
// refuses leaves the computer's theme in place.

import { useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const KEPT = "mm-ops-theme";

export function keptTheme(): Theme {
  try {
    const kept = localStorage.getItem(KEPT);
    return kept === "light" || kept === "dark" ? kept : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function keep(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEPT);
    else localStorage.setItem(KEPT, theme);
  } catch {
    // Kept for this page alone.
  }
}

/** The theme in force and the way to choose another, which applies at once and is kept. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(keptTheme);
  return [
    theme,
    (chosen: Theme) => {
      applyTheme(chosen);
      keep(chosen);
      setTheme(chosen);
    },
  ];
}
