// A new record's few boxes and its Add (docs/decisions/0212-editing-in-place.md): Enter or Add sends it, Cancel puts
// it away. A refusal is said on the box it names, else under the form, and nothing typed is lost.

import { Button } from "@maneman/ui/Button";
import { Fieldset, RefusedBoxes } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useContext, useState, type ReactNode } from "react";
import { FormActions } from "./FormActions.tsx";
import { InDrawer } from "./FormDrawer.tsx";
import { FormRefusal } from "./Refusal.tsx";
import form from "./forms.module.css";

type Answer<Body> = { readonly ok: true; readonly body: Body } | ({ readonly ok: false } & Failure);

export function AddForm<Body>(props: {
  /** What it adds: "Add a consumable". */
  readonly title: string;
  readonly words: { readonly add: string; readonly cancel: string };
  readonly errors: Readonly<Record<string, string>>;
  /** The names the API refuses the boxes by, each a Field's `box`, which says its own refusal. */
  readonly boxes: readonly string[];
  readonly send: () => Promise<Answer<Body>>;
  readonly onAdded: (body: Body) => void | Promise<void>;
  /** Null where there is nothing to go back to, as for a list's first item. */
  readonly onCancel: (() => void) | null;
  readonly children: ReactNode;
}) {
  const inDrawer = useContext(InDrawer);
  const [busy, once] = useOneAtATime();
  const [failed, setFailed] = useState<Failure | null>(null);
  const add = () =>
    once(async () => {
      setFailed(null);
      const answer = await props.send();
      if (!answer.ok) {
        setFailed(answer);
        return;
      }
      await props.onAdded(answer.body);
    });
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Fieldset
        className={inDrawer ? form.inDrawer : form.group}
        legend={props.title}
        legendLook={inDrawer ? "hidden" : "title"}
      >
        <RefusedBoxes.Provider value={(box) => boxError(props.errors, failed, box)}>{props.children}</RefusedBoxes.Provider>
        <FormActions>
          <Button variant="primary" size="small" type="submit" busy={busy}>
            {props.words.add}
          </Button>
          {props.onCancel !== null && (
            <Button variant="outline" size="small" narrow onClick={props.onCancel}>
              {props.words.cancel}
            </Button>
          )}
        </FormActions>
        <FormRefusal className={form.error} errors={props.errors} failure={failed} boxes={props.boxes} />
      </Fieldset>
    </form>
  );
}
