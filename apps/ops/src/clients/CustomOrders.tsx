// The client's custom orders, beneath the stock their profile matches (docs/decisions/0174-custom-orders.md): each
// with its spec, price and where it stands, its payment link sent again or the order cancelled while unpaid; and a new
// one raised.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Toast } from "@maneman/ui/Toast";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Panel } from "@maneman/ui/Panel";
import { TextLink, textLinkLook } from "@maneman/ui/TextLink";
import { rowPath } from "@maneman/ui/target";
import { OpsLink } from "../frame/Shell.tsx";
import { Button, RowButton } from "@maneman/ui/Button";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { Field, Select } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { ACTIONS, FIGURE, RowActions, Table } from "@maneman/ui/Table";
import { useAskFocus } from "@maneman/ui/useAskFocus";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { rupees } from "@maneman/web-kit/money";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { focusIfLost } from "@maneman/ui/arrival";
import { useCallback, useEffect, useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { customOrders as copy } from "../content/custom-orders.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { RaiseCustomOrder, type CustomOrders } from "./RaiseCustomOrder.tsx";
import { Refusal } from "@maneman/ui/Refusal";
import { RowHead } from "@maneman/ui/RowHead";
import { FormActions } from "@maneman/ui/FormActions";
import { clientsApi } from "./clients-api.ts";

type Order = CustomOrders["orders"][number];
/** What a step answered: the client's whole list, or the refusal. */
type Answer =
  | { readonly ok: true; readonly body: CustomOrders }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

const TITLE_ID = "custom-orders";

const REFUND_REASONS = ["not_ordered", "late", "failed_check"] as const;

/** A paid order refunded in full, for the reason chosen, which the API checks holds: in a drawer from its row. */
function Refund({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  const [open, setOpen] = useState(false);
  if (order.status !== "paid" && order.status !== "ordered") return null;
  if (!access.mayCall("POST /api/custom-orders/{id}/refund")) return null;
  const number = copy.number(order.number);
  return (
    <>
      <RowButton
        icon={ACTION_ICONS.banknoteArrowDown}
        aria-label={copy.refundLabel(number)}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.refundOpen}
      </RowButton>
      {open && (
        <FormDrawer
          title={copy.refundLabel(number)}
          onClose={() => {
            setOpen(false);
          }}
        >
          <RefundForm
            order={order}
            onAnswer={(answer, said) => {
              // Refused, the drawer stays open and says why; refunded, it closes on the order's new state.
              if (!answer.ok) return;
              setOpen(false);
              onAnswer(answer, said);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        </FormDrawer>
      )}
    </>
  );
}

/** Why the order is refunded, and the refund itself, one press. */
function RefundForm(props: { order: Order; onAnswer: (answer: Answer, said: string) => void; onCancel: () => void }) {
  const { order, onAnswer } = props;
  const [reason, setReason] = useState<(typeof REFUND_REASONS)[number]>(
    order.status === "paid" ? "not_ordered" : "late",
  );
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <div className={form.fields}>
      {refused !== null && <Refusal className={form.error} said={refused} />}
      <Field label={copy.refundWhy} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={reason}
            onChange={(event) => {
              setReason(REFUND_REASONS.find((each) => each === event.target.value) ?? "late");
            }}
          >
            {REFUND_REASONS.map((each) => (
              <option key={each} value={each}>
                {copy.reasons[each]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <FormActions>
        <Button
          icon={ACTION_ICONS.banknoteArrowDown}
          variant="destructive"
          size="small"
          onClick={() =>
            void clientsApi.refundCustomOrder(order.id, reason).then((answer) => {
              setRefused(answer.ok ? null : errorText(copy.errors, { code: answer.code, fields: answer.fields }));
              onAnswer(answer, copy.refunded);
            })
          }
        >
          {copy.refund}
        </Button>
        <CancelButton onClick={props.onCancel} />
      </FormActions>
    </div>
  );
}

function Steps({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  if (order.status !== "awaiting_payment") return <Refund order={order} onAnswer={onAnswer} />;
  return (
    <RowActions>
      {order.link_sent_at === null && access.mayCall("POST /api/custom-orders/{id}/send-link") && (
        <RowButton
          icon={ACTION_ICONS.send}
          onClick={() =>
            void clientsApi.sendCustomOrderLink(order.id).then((answer) => {
              onAnswer(answer, copy.sent);
            })
          }
        >
          {copy.sendAgain}
        </RowButton>
      )}
      {access.mayCall("POST /api/custom-orders/{id}/cancel") && <CancelOrder order={order} onAnswer={onAnswer} />}
    </RowActions>
  );
}

/** Cancel, asked once more: the order's payment link stops working. The ask opens on Keep, and Keep goes back. */
function CancelOrder({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const [asking, setAsking] = useState(false);
  // One cancelling per intent: a second press inside the first's round trip asks nothing.
  const [busy, once] = useOneAtATime();
  const { opener, question, safe } = useAskFocus(asking);
  if (!asking) {
    return (
      <RowButton
        icon={ACTION_ICONS.fileX}
        ref={opener}
        onClick={() => {
          setAsking(true);
        }}
      >
        {copy.cancelOrder}
      </RowButton>
    );
  }
  return (
    <div ref={question} role="group" aria-label={copy.cancelAsk}>
      <p className={form.fieldLabel}>{copy.cancelAsk}</p>
      <FormActions>
        <Button
          icon={ACTION_ICONS.fileX}
          variant="destructive"
          size="small"
          busy={busy}
          onClick={() =>
            void once(async () => {
              onAnswer(await clientsApi.cancelCustomOrder(order.id), copy.cancelled);
            })
          }
        >
          {busy ? copy.cancelling : copy.cancelYes}
        </Button>
        <CancelButton
          ref={safe}
          keep
          disabled={busy}
          onClick={() => {
            setAsking(false);
          }}
        />
      </FormActions>
    </div>
  );
}

function OrdersTable({
  customOrders,
  onAnswer,
}: {
  customOrders: CustomOrders;
  onAnswer: (answer: Answer, said: string) => void;
}) {
  if (customOrders.orders.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <Table controls>
      <thead>
        <tr>
          {copy.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
          <th scope="col">
            <VisuallyHidden>{copy.actions}</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {customOrders.orders.map((order) => (
          <tr key={order.id}>
            <RowHead>{copy.number(order.number)}</RowHead>
            <td>{copy.spec(order)}</td>
            <td className={FIGURE}>{rupees(order.amount)}</td>
            <td>
              {copy.statuses[order.status]}
              {order.status === "awaiting_payment" && order.short_url !== null && (
                <>
                  {" · "}
                  <TextLink href={order.short_url} newTab>
                    {copy.link}
                  </TextLink>
                </>
              )}
              {(order.status === "paid" || order.status === "ordered") &&
                order.po_id !== null &&
                order.po_number !== null && (
                  <>
                    {" · "}
                    <OpsLink
                      className={textLinkLook({ compact: true })}
                      to={rowPath("/purchasing", "order", order.po_id)}
                    >
                      {copy.purchaseOrder(order.po_number)}
                    </OpsLink>
                  </>
                )}
              {order.status === "arrived" && order.piece_at !== null && ` · ${copy.pieceAt(order.piece_at)}`}
            </td>
            <td className={ACTIONS}>
              <Steps order={order} onAnswer={onAnswer} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function CustomOrders({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.customOrders(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const [customOrders, setCustomOrders] = useState<CustomOrders | null>(null);
  const [raising, setRaising] = useState(false);
  const [said, setSaid] = useState<{ readonly text: string; readonly count: number } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  const current = customOrders ?? (loaded.state === "loaded" ? loaded.value : null);
  // A change takes the button that made it with it, as Cancel the order or Send the link: the focus lands on the
  // panel's heading rather than on nothing.
  useEffect(() => {
    if (said !== null) focusIfLost(document.getElementById(TITLE_ID));
  }, [said]);
  const changed = (next: CustomOrders, words: string) => {
    setCustomOrders(next);
    setSaid((last) => ({ text: words, count: (last?.count ?? 0) + 1 }));
    setFailure(null);
    setRaising(false);
  };
  const answered = (answer: Answer, words: string) => {
    if (answer.ok) changed(answer.body, words);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId={TITLE_ID} title={copy.title}>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && <OrdersTable customOrders={current} onAnswer={answered} />}
      {current !== null && raising && (
        <RaiseCustomOrder
          clientId={clientId}
          customOrders={current}
          onRaised={changed}
          onClose={() => {
            setRaising(false);
          }}
        />
      )}
      {current !== null && !current.profile_ready && access.mayCall("POST /api/clients/{id}/custom-orders") && (
        <Note>{copy.errors.profile}</Note>
      )}
      {current !== null &&
        current.profile_ready &&
        !raising &&
        access.mayCall("POST /api/clients/{id}/custom-orders") && (
          <FormActions>
            <Button
              icon={ACTION_ICONS.plus}
              variant="outline"
              size="small"
              onClick={() => {
                setRaising(true);
              }}
            >
              {copy.raise.open}
            </Button>
          </FormActions>
        )}
      {said !== null && <Toast>{said.text}</Toast>}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
