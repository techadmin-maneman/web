// Whether the rows here stand their name above their value: true inside SettingPairs (./SettingsLayout.tsx), which
// lays them two to a row, and read by EditableRow (./EditableRow.tsx) where it is given no word of its own.

import { createContext } from "react";

export const StackedRows = createContext(false);
