// Whether a row here is changed in a small dialog of its own, its value and "Change" in the row: true on a page of
// settings (./SettingsLayout.tsx), as the 22 November redesign draws them; false again inside a drawer (./FormDrawer.tsx),
// where a row is changed in place. Read by EditableRow (./EditableRow.tsx).

import { createContext } from "react";

export const ChangeInDialog = createContext(false);
