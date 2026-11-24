// Whether a row here is changed in a small dialog of its own: true on a page, as the 22 November redesign draws a
// setting; false inside a drawer (./Drawer.tsx), where no dialog opens over it and a row is changed in place. Read by
// EditableRow (./EditableRow.tsx) and SettingPairs (./SettingsLayout.tsx).

import { createContext } from "react";

export const ChangeInDialog = createContext(true);
