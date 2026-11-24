// Requests › Deletion requests a client made in their app, decided here (docs/decisions/0049-dpdp.md; the runbook's
// Erasure within the day). A row each, as the redesign draws them, its decision opened in a drawer. An erasure cannot be
// undone, so erasing takes two steps, the second offered only once ops confirm the request with the client on their
// own number. The API refuses while a visit is booked or a payment held, and says which.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { errorText } from "@maneman/web-kit/refusal";
import { Button, RowButton } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, longDate, shortDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { ACTIONS, RowActions, Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { rowId, useTargetRow } from "@maneman/ui/target";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { useHeadingAfter } from "../lib/heading-after.ts";
import { type DeletionRequest } from "../api.ts";
import { Reach } from "../clients/index.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { deletions } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import shared from "./erasure.module.css";
import styles from "./deletions-screen.module.css";
import { Choices, ConfirmDelete, RejectReason, type Choice } from "./DeletionDecision.tsx";
import { Refusal } from "@maneman/ui/Refusal";
import { deletionRequestsApi } from "./deletion-requests-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

/** Where a request is in its decision: listed, asked about, sending, or refused by the API. */
type Deciding =
  | { readonly step: "listed" }
  | { readonly step: "asking"; readonly choice: Choice }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const copy = deletions.queue;
/** A row's kind in its id, as a task's link names it: "request-…". */
const ROW = "request";

interface RequestProps {
  readonly request: DeletionRequest;
  readonly now: Date;
  /** Whether the person's access lets them delete the account or reject the request. */
  readonly mayDecide: boolean;
  /** Opened from a row's Erase or Keep, that step is asked at once. */
  readonly start: Choice | null;
  readonly onDecided: (choice: Choice) => void;
}

/**
 * When the client asked, on which number, a visit they have booked since, which may mean they want to stay, and what
 * must be settled before they can be erased.
 */
function Asked({ request }: { request: DeletionRequest }) {
  return (
    <>
      <p className={shared.who}>{copy.requested(phoneWords(request.mobile), longDate(request.requested_at))}</p>
      {request.booked_since !== null && (
        <p className={shared.who}>{copy.bookedSince(longDate(request.booked_since))}</p>
      )}
      {request.settle_first !== null && (
        <p className={shared.who}>
          {copy.errors[request.settle_first]}
          <SettleOn personId={request.person_id} code={request.settle_first} />
        </p>
      )}
    </>
  );
}

function Request({ request, now, mayDecide, start, onDecided }: RequestProps) {
  const [deciding, setDeciding] = useState<Deciding>(
    start === null ? { step: "listed" } : { step: "asking", choice: start },
  );
  const [reason, setReason] = useState("");
  const openers = { delete: useRef<HTMLButtonElement>(null), reject: useRef<HTMLButtonElement>(null) };

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    // Rejecting keeps the account and needs a reason; deleting sends the field as null.
    const answer = await deletionRequestsApi.decideDeletion(
      request.id,
      choice,
      choice === "reject" ? reason.trim() : null,
    );
    if (answer.ok) onDecided(choice);
    else setDeciding({ step: "failed", code: answer.code });
  };

  const asking = deciding.step === "asking" || deciding.step === "sending" ? deciding : null;
  const sending = deciding.step === "sending";
  /** Back to the list, and the keyboard back to the button that asked, rather than to the top of the page. */
  const listed = (from: Choice) => {
    setDeciding({ step: "listed" });
    requestAnimationFrame(() => openers[from].current?.focus());
  };

  return (
    <>
      <div className={shared.head}>
        <OpsLink className={shared.name} to={clientPath(request.person_id, "consents")}>
          {request.name}
        </OpsLink>
        <Left due={request.due} now={now} />
      </div>
      <Asked request={request} />
      <Reach name={request.name} mobile={request.mobile} />
      {asking?.choice === "delete" && (
        <ConfirmDelete
          request={request}
          sending={sending}
          onDelete={() => void decide("delete")}
          onCancel={() => {
            listed("delete");
          }}
        />
      )}
      {asking?.choice === "reject" && (
        <RejectReason
          reason={reason}
          sending={sending}
          onReason={setReason}
          onReject={() => void decide("reject")}
          onCancel={() => {
            listed("reject");
          }}
        />
      )}
      {asking === null && mayDecide && (
        <Choices
          name={request.name}
          openers={openers}
          onAsk={(choice) => {
            setDeciding({ step: "asking", choice });
          }}
        />
      )}
      {deciding.step === "failed" && (
        <Refusal className={shared.error} said={errorText(copy.errors, { code: deciding.code })}>
          <SettleOn personId={request.person_id} code={deciding.code} />
        </Refusal>
      )}
    </>
  );
}

/** The client's tab where what the refusal names is settled: the visit to cancel, or the refund to see through. */
const SETTLED_ON: Readonly<Record<string, "visits" | "payments">> = {
  visit_booked: "visits",
  payment_held: "payments",
};

function SettleOn({ personId, code }: { personId: string; code: string }) {
  const tab = SETTLED_ON[code];
  if (tab === undefined) return null;
  return (
    <>
      {" "}
      <OpsLink className={styles.settleOn} to={clientPath(personId, tab)}>
        {copy.settleOn[tab]}
      </OpsLink>
    </>
  );
}

/** A row each's decision for those who may decide: Erase, or keep the account with a reason, each in the drawer. */
function RowDecision({ request, onOpen }: { request: DeletionRequest; onOpen: (id: string, start: Choice) => void }) {
  return (
    <td className={ACTIONS}>
      <RowActions>
        <Button
          icon={ACTION_ICONS.trash}
          variant="destructive"
          size="compact"
          aria-label={copy.deleteLabel(request.name)}
          onClick={() => {
            onOpen(request.id, "delete");
          }}
        >
          {copy.delete}
        </Button>
        <RowButton
          icon={ACTION_ICONS.circleX}
          aria-label={copy.rejectLabel(request.name)}
          onClick={() => {
            onOpen(request.id, "reject");
          }}
        >
          {copy.reject}
        </RowButton>
      </RowActions>
    </td>
  );
}

interface RowsProps {
  readonly requests: readonly DeletionRequest[];
  readonly now: Date;
  readonly mayDecide: boolean;
  readonly onOpen: (id: string, start: Choice | null) => void;
}

/** The requests waiting, a row each: whose, when they asked, when it falls due, and what to settle first. */
function RequestRows({ requests, now, mayDecide, onOpen }: RowsProps) {
  return (
    <TableScroll labelledBy="deletions">
      <Table>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
            {mayDecide && (
              <th scope="col">
                <VisuallyHidden>{copy.actions}</VisuallyHidden>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} id={rowId(ROW, request.id)} tabIndex={-1}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.openLabel(request.name)}
                  onClick={() => {
                    onOpen(request.id, null);
                  }}
                >
                  {request.name}
                </TextButton>
              </RowHead>
              <td>{shortDate(indiaDate(request.requested_at))}</td>
              <td>
                <span className={styles.due}>{shortDate(indiaDate(request.due))}</span>
                <Left due={request.due} now={now} />
              </td>
              <td>{copy.settle[request.settle_first ?? "none"]}</td>
              {mayDecide && <RowDecision request={request} onOpen={onOpen} />}
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

export function DeletionsScreen() {
  const [loaded, retry] = useLoad(deletionRequestsApi.deletionRequests);
  const mayDecide = useAccess().mayCall("POST /api/deletion-requests/{id}/decision");
  const [decided, setDecided] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<{ readonly id: string; readonly start: Choice | null } | null>(null);
  // Keyed by how many were said, so the same words said again show again.
  const [said, setSaid] = useState<{ readonly words: string; readonly count: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useHeadingAfter(heading);
  const requests = loaded.state === "loaded" ? loaded.value.requests.filter((each) => !decided.includes(each.id)) : [];
  useHeaderSub(requests.length === 0 ? undefined : copy.toDecide(requests.length));
  // A task links to its request's row ("#request-…"), which opens it once the list is read.
  const target = useTargetRow(loaded.state === "loaded");
  useEffect(() => {
    if (loaded.state === "loaded" && target?.startsWith(`${ROW}-`) === true) {
      setOpen({ id: target.slice(ROW.length + 1), start: null });
    }
  }, [loaded.state, target]);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date(apiNow());
  const opened = requests.find((each) => each.id === open?.id) ?? null;
  return (
    // Titled as its page, so its heading is read, not shown again, and its count stands beside the page's title.
    <Panel titleId="deletions" title={deletions.title} count={requests.length} headingRef={heading}>
      {requests.length === 0 ? (
        <EmptyState look="panel" line={copy.empty} />
      ) : (
        <RequestRows
          requests={requests}
          now={now}
          mayDecide={mayDecide}
          onOpen={(id, start) => {
            setOpen({ id, start });
          }}
        />
      )}
      {said !== null && <Toast key={said.count}>{said.words}</Toast>}
      {opened !== null && (
        <FormDrawer
          title={opened.name}
          onClose={() => {
            setOpen(null);
          }}
        >
          <Request
            request={opened}
            now={now}
            mayDecide={mayDecide}
            start={open?.start ?? null}
            onDecided={(choice) => {
              setDecided((already) => [...already, opened.id]);
              setSaid((was) => ({ words: copy.done[choice], count: (was?.count ?? 0) + 1 }));
              focusHeading(opened.id);
              setOpen(null);
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}
