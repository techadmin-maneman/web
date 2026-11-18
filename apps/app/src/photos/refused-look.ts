// A try-on look WhatsApp refused, shown once (docs/decisions/0276-a-message-whatsapp-refuses.md): the first time the
// app opens after the refusal, it says so and opens Photos, where the look is.

import { useEffect } from "react";
import { api } from "../api.ts";
import { go } from "../route.ts";

/** Opens Photos for the look Home names, once the API has taken it as shown; null asks nothing. */
export function useRefusedLook(look: string | null): void {
  useEffect(() => {
    if (look === null) return;
    void api.lookShown(look).then((answer) => {
      if (answer.ok) go("/photos");
    });
  }, [look]);
}
