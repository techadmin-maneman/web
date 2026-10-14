// The booking sheet, loaded on the first tap that opens it, so Home draws without it (packages/ui/lazyScreen.ts).

import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Suspense, type ComponentProps } from "react";

const Sheet = lazyScreen(() => import("./BookingSheet.tsx").then((module) => module.BookingSheet));

/** The booking sheet, drawn once its file has come. */
export function BookingSheet(props: ComponentProps<typeof Sheet>) {
  return (
    <Suspense fallback={null}>
      <Sheet {...props} />
    </Suspense>
  );
}
