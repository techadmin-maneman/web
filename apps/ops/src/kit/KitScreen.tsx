// The kit: every part of packages/ui in each of its states, on paper and on the ink, for the nightly fidelity run to
// shoot (docs/fidelity-method.md) and for anyone building a screen to look up. It is built into local builds alone
// (./App.tsx), so no staging or production console carries it. It calls no API.

import { ICONS } from "@maneman/brand/icons";
import { BUTTON_VARIANTS, Button, RowButton, type ButtonSize } from "@maneman/ui/Button";
import { badgeLook, Caps } from "@maneman/ui/Caps";
import { Chip } from "@maneman/ui/Chip";
import { CodeField } from "@maneman/ui/CodeField";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { Disclosure } from "@maneman/ui/Disclosure";
import { Drawer } from "@maneman/ui/Drawer";
import { EmptyState } from "@maneman/ui/EmptyState";
import {
  Checkbox,
  ChoiceGroup,
  DateInput,
  Field,
  NumberInput,
  Radio,
  Select,
  TextArea,
  TextInput,
} from "@maneman/ui/Field";
import { IconButton } from "@maneman/ui/IconButton";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { MobileInput } from "@maneman/ui/MobileInput";
import { Panel } from "@maneman/ui/Panel";
import { Failed, Loading } from "@maneman/ui/States";
import { Switch } from "@maneman/ui/Switch";
import { SortButton, Table } from "@maneman/ui/Table";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { typeLook, type TextStyle } from "@maneman/ui/type";
import { useState, type ReactNode } from "react";
import { kit as words } from "../content/kit.ts";
import styles from "./kit.module.css";

const SIZES: readonly ButtonSize[] = ["action", "control", "small", "compact"];
const STYLES: readonly TextStyle[] = [
  "display",
  "title-1",
  "title-2",
  "title-3",
  "body-large",
  "body",
  "label",
  "caption",
  "figure",
];

/** A part's states side by side, on paper and on the ink. */
function Grounds(props: { title: string; paper: ReactNode; ink?: ReactNode }) {
  return (
    <section className={styles.section} aria-label={props.title}>
      <h2 className={typeLook("title-3", styles.sectionTitle)}>{props.title}</h2>
      <div className={styles.grounds}>
        <div className={styles.paper}>{props.paper}</div>
        {props.ink !== undefined && (
          <div className={styles.ink} data-ground="ink">
            {props.ink}
          </div>
        )}
      </div>
    </section>
  );
}

function Buttons() {
  const onPaper = BUTTON_VARIANTS.filter((variant) => !["light", "gold", "outlineOnInk"].includes(variant));
  const onInk = BUTTON_VARIANTS.filter((variant) => ["light", "gold", "outlineOnInk"].includes(variant));
  const row = (variants: readonly (typeof BUTTON_VARIANTS)[number][]) =>
    variants.map((variant) => (
      <div className={styles.row} key={variant}>
        {SIZES.map((size) => (
          <Button key={size} variant={variant} size={size}>
            {words.button(variant, size)}
          </Button>
        ))}
        <Button variant={variant} size="control" disabled>
          {words.disabled}
        </Button>
        <Button variant={variant} size="control" busy>
          {words.busy}
        </Button>
      </div>
    ));
  return (
    <Grounds
      title={words.buttons}
      paper={
        <>
          {row(onPaper)}
          <div className={styles.row}>
            <RowButton>{words.rowButton}</RowButton>
            <IconButton d={ICONS.cross} size={16} label={words.iconButton} />
            <TextLink href="#kit">{words.textLink}</TextLink>
            <TextButton>{words.textButton}</TextButton>
            <TextButton tone="danger">{words.textButton}</TextButton>
          </div>
        </>
      }
      ink={row(onInk)}
    />
  );
}

function Fields() {
  const [code, setCode] = useState("12");
  const [on, setOn] = useState(true);
  const [pressed, setPressed] = useState(true);
  const boxes = (onInk: boolean) => (
    <>
      <Field label={words.textInput} hint={words.hint} onInk={onInk} className={styles.field}>
        {(control) => <TextInput {...control} onInk={onInk} defaultValue={words.typed} />}
      </Field>
      <Field label={words.textInput} error={words.error} onInk={onInk} className={styles.field}>
        {(control) => <TextInput {...control} onInk={onInk} defaultValue={words.typed} />}
      </Field>
      <Field label={words.select} onInk={onInk} className={styles.field}>
        {(control) => (
          <Select {...control} onInk={onInk}>
            <option>{words.option}</option>
          </Select>
        )}
      </Field>
      <MobileInput prefix="+91" onInk={onInk} aria-label={words.mobile} defaultValue="98100 00000" />
      <CodeField label={words.code} value={code} onChange={setCode} />
      <CodeField label={words.code} value="123456" invalid onChange={setCode} />
    </>
  );
  return (
    <Grounds
      title={words.fields}
      paper={
        <>
          {boxes(false)}
          <Field label={words.number} className={styles.field}>
            {(control) => <NumberInput {...control} defaultValue={15} />}
          </Field>
          <Field label={words.date} className={styles.field}>
            {(control) => <DateInput {...control} defaultValue="2026-10-14" />}
          </Field>
          <Field label={words.textArea} className={styles.field}>
            {(control) => <TextArea {...control} defaultValue={words.typed} />}
          </Field>
          <Checkbox label={words.checkbox} defaultChecked />
          <ChoiceGroup legend={words.choices} ruled>
            <Radio name="kit-radio" label={words.option} defaultChecked />
            <Radio name="kit-radio" label={words.otherOption} />
          </ChoiceGroup>
          <div className={styles.row}>
            <span id="kit-switch">{words.switch}</span>
            <Switch
              checked={on}
              labelledBy="kit-switch"
              onToggle={() => {
                setOn(!on);
              }}
            />
            <ToggleButton
              pressed={pressed}
              onClick={() => {
                setPressed(!pressed);
              }}
            >
              {words.toggle}
            </ToggleButton>
            <Chip removeLabel={words.removeChip} onRemove={() => undefined}>
              {words.chip}
            </Chip>
          </div>
        </>
      }
      ink={boxes(true)}
    />
  );
}

function Messages() {
  const lines = (
    <>
      <InlineMessage tone="error">{words.errorLine}</InlineMessage>
      <InlineMessage tone="saved">{words.savedLine}</InlineMessage>
      <InlineMessage tone="note">{words.noteLine}</InlineMessage>
    </>
  );
  return (
    <Grounds
      title={words.messages}
      paper={
        <>
          {lines}
          <EmptyState look="page" lines={words.emptyLines} />
          <EmptyState look="panel" line={words.emptyLine} />
          <Loading label={words.loading} />
          <Failed message={words.failed} retry={words.retry} onRetry={() => undefined} />
        </>
      }
      ink={
        <>
          {lines}
          <Loading label={words.loading} ground="ink" />
        </>
      }
    />
  );
}

function Labels() {
  return (
    <Grounds
      title={words.labels}
      paper={
        <>
          {STYLES.map((style) => (
            <p key={style} className={typeLook(style, styles.style)}>
              {words.textStyle(style)}
            </p>
          ))}
          <div className={styles.row}>
            <Caps>{words.caps}</Caps>
            <span className={badgeLook("brass")}>{words.badge}</span>
          </div>
        </>
      }
      ink={
        <div className={styles.row}>
          <span className={badgeLook("muted")}>{words.badge}</span>
          <span className={badgeLook("onInk")}>{words.badge}</span>
        </div>
      }
    />
  );
}

/** The parts that open over the page: the console's drawer and the technician app's question. */
function Modals() {
  const [open, setOpen] = useState<"drawer" | "sheet" | null>(null);
  return (
    <>
      <div className={styles.row}>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            setOpen("drawer");
          }}
        >
          {words.openDrawer}
        </Button>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            setOpen("sheet");
          }}
        >
          {words.openSheet}
        </Button>
      </div>
      {open === "drawer" && (
        <Drawer
          titleId="kit-drawer"
          title={words.drawer}
          sub={words.noteLine}
          canClose
          onDismiss={() => {
            setOpen(null);
          }}
        >
          <p>{words.noteLine}</p>
        </Drawer>
      )}
      {open === "sheet" && (
        <ConfirmSheet
          title={words.sheet}
          body={words.noteLine}
          yes={words.yes}
          no={words.no}
          onYes={() => {
            setOpen(null);
          }}
          onNo={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function Frames() {
  const [tab, setTab] = useState(0);
  return (
    <Grounds
      title={words.frames}
      paper={
        <>
          <Tabs label={words.tabs}>
            {[words.tab(1), words.tab(2)].map((name, index) => (
              <TabButton
                key={name}
                current={tab === index}
                onClick={() => {
                  setTab(index);
                }}
              >
                {name}
              </TabButton>
            ))}
          </Tabs>
          <Panel titleId="kit-panel" title={words.panel} count={2}>
            <Table>
              <thead>
                <tr>
                  <th scope="col" aria-sort="ascending">
                    <SortButton direction="ascending" onSort={() => undefined}>
                      {words.column}
                    </SortButton>
                  </th>
                  <th scope="col">{words.figure}</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2].map((row) => (
                  <tr key={row}>
                    <td>{words.cell(row)}</td>
                    <td>{row * 1250}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          <Disclosure summary={words.disclosure}>
            <p>{words.noteLine}</p>
          </Disclosure>
          <Modals />
        </>
      }
    />
  );
}

export function KitScreen() {
  return (
    <main className={styles.kit} id="kit">
      <h1 className={typeLook("title-1")}>{words.title}</h1>
      <Buttons />
      <Fields />
      <Messages />
      <Labels />
      <Frames />
    </main>
  );
}
