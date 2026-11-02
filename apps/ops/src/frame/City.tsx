// The city the console is narrowed to (../lib/city.ts): a picker in the header at a desk, and on a phone a row of
// chips under Today's and Dispatch's titles and on More. Each offers every city, then each city served.

import { GLYPHS } from "@maneman/brand/icons";
import { Popover, PopoverChoice } from "@maneman/ui/Popover";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { shell, tables } from "../content.ts";
import { useCity } from "../lib/city.ts";
import styles from "./city.module.css";

/** Every city first, as null, then each served. */
const choicesOf = (cities: readonly string[]): readonly (string | null)[] => [null, ...cities];

export function CityPicker({ className }: { readonly className?: string }) {
  const { city, cities, choose } = useCity();
  if (cities.length === 0) return null;
  const shown = city ?? tables.allCities;
  return (
    <Popover look="field" icon={GLYPHS.pin} className={className} label={shell.city.label(shown)} button={shown}>
      {(close) =>
        choicesOf(cities).map((each) => (
          <PopoverChoice
            key={each ?? ""}
            chosen={each === city}
            onClick={() => {
              choose(each);
              close();
            }}
          >
            {each ?? tables.allCities}
          </PopoverChoice>
        ))
      }
    </Popover>
  );
}

export function CityChips({ className }: { readonly className?: string }) {
  const { city, cities, choose } = useCity();
  if (cities.length === 0) return null;
  return (
    <div className={className} role="radiogroup" aria-label={shell.city.name}>
      <div className={styles.chips}>
        {choicesOf(cities).map((each) => (
          <ToggleButton
            key={each ?? ""}
            asRadio
            filled
            pressed={each === city}
            onClick={() => {
              choose(each);
            }}
          >
            {each ?? tables.allCities}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
