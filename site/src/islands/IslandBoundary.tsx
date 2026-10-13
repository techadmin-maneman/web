// Round each of the site's own forms, the booking and the try-on: a throw while it draws is reported
// (packages/web-kit/client-errors.ts) and, in its place, the way to us on WhatsApp, where the form would be blank.

import { ButtonLink } from "@maneman/ui/Button";
import { ErrorBoundary } from "@maneman/ui/ErrorBoundary";
import { reportRenderError } from "@maneman/web-kit/client-errors";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import type { ReactNode } from "react";
import { islandFailed as words, whatsapp } from "../content/site.ts";
import styles from "./IslandBoundary.module.css";

export function IslandBoundary({ children }: { readonly children: ReactNode }) {
  const fallback = (
    <div class={styles.failed} role="alert">
      <p class={styles.message}>{words.message}</p>
      <ButtonLink variant="primary" size="action" href={whatsappChat(whatsapp.number)}>
        {words.action}
      </ButtonLink>
    </div>
  );
  return (
    <ErrorBoundary fallback={fallback} onError={reportRenderError}>
      {children}
    </ErrorBoundary>
  );
}
