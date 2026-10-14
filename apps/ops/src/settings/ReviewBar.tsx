// A section of Rules' Review, and what its last change came to: the section's own first step
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { review } from "../content/common.ts";
import { settings } from "../content/settings.ts";
import form from "../components/forms.module.css";

export function ReviewBar(props: { ready: boolean; saved: boolean; onReview: () => void }) {
  return (
    <>
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!props.ready} onClick={props.onReview}>
          {review.next}
        </Button>
      </div>
      {props.saved && (
        <InlineMessage tone="saved" className={form.saved}>
          {settings.rules.saved}
        </InlineMessage>
      )}
    </>
  );
}
