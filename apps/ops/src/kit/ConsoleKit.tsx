// The kit's console frame (./KitScreen.tsx): a page's head, the row that narrows a list, its figures and badges, a
// record's facts, Settings, the account's panel and the navigation open and folded. Each follows the theme.

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { Breadcrumbs } from "@maneman/ui/Breadcrumbs";
import { Button } from "@maneman/ui/Button";
import { Caps } from "@maneman/ui/Caps";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Field, NumberInput, Select } from "@maneman/ui/Field";
import { Icon } from "@maneman/ui/Icon";
import { Columns, Stack } from "@maneman/ui/Layout";
import { PageHeader } from "@maneman/ui/PageHeader";
import { Panel } from "@maneman/ui/Panel";
import { Popover, PopoverItem, PopoverLink, PopoverNote } from "@maneman/ui/Popover";
import { SearchInput } from "@maneman/ui/SearchInput";
import { SettingRow, SettingValue } from "@maneman/ui/SettingRow";
import { ChangeBar, SettingsLayout, SubNav } from "@maneman/ui/SettingsLayout";
import { NavButton, NavItem, SideNav } from "@maneman/ui/SideNav";
import { StatTile } from "@maneman/ui/StatTile";
import { Table } from "@maneman/ui/Table";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { Toolbar } from "@maneman/ui/Toolbar";
import { typeLook } from "@maneman/ui/type";
import { useState } from "react";
import { kit as words } from "../content/kit.ts";
import styles from "./kit.module.css";

const NAV_ICONS = [TAB_ICONS.home, GLYPHS.tasks, GLYPHS.board, GLYPHS.person] as const;
const TONES: readonly BadgeTone[] = ["neutral", "done", "attention", "warning", "error"];

function Head() {
  return (
    <PageHeader
      title={words.page}
      meta={words.meta}
      crumbs={
        <Breadcrumbs
          label={words.where}
          crumbs={[{ label: words.crumbs[0], to: "#kit" }, { label: words.crumbs[1] }]}
        />
      }
      actions={
        <>
          <Button variant="outline" size="small">
            {words.more}
          </Button>
          <Button variant="primary" size="small">
            {words.action}
          </Button>
        </>
      }
      tabs={
        <Tabs label={words.tabs}>
          <TabButton current>{words.tab(1)}</TabButton>
          <TabButton current={false}>{words.tab(2)}</TabButton>
        </Tabs>
      }
    />
  );
}

function Figures() {
  return (
    <>
      <DescriptionList items={words.facts} />
      <Columns>
        {words.tiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            tone={"tone" in tile ? tile.tone : "plain"}
            to="#kit"
          />
        ))}
      </Columns>
    </>
  );
}

function List() {
  const [find, setFind] = useState("");
  return (
    <>
      <Toolbar label={words.narrow} end={words.matching}>
        <SearchInput label={words.search} value={find} onChange={setFind} />
        <Field label={words.city} labelHidden>
          {(control) => (
            <Select {...control} width="choice">
              {words.cities.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </Select>
          )}
        </Field>
      </Toolbar>
      <Panel
        titleId="kit-console-panel"
        title={words.panel}
        count={TONES.length}
        actions={
          <Popover label={words.more} button={<Icon d={GLYPHS.more} size="sm" weight="heavy" />}>
            {(close) => (
              <PopoverItem tone="danger" onClick={close}>
                {words.remove}
              </PopoverItem>
            )}
          </Popover>
        }
      >
        <Table>
          <thead>
            <tr>
              <th scope="col">{words.column}</th>
              <th scope="col">{words.figure}</th>
            </tr>
          </thead>
          <tbody>
            {TONES.map((tone, at) => (
              <tr key={tone}>
                <td>{words.cell(at + 1)}</td>
                <td>
                  <Badge tone={tone}>{words.badges[tone]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

function Settings() {
  const [radius, setRadius] = useState("200");
  const groups = words.settingsGroups.map((group, first) => ({
    name: group.name,
    items: group.items.map((name, at) => ({ name, to: `#${name}`, current: first === 0 && at === 0 })),
  }));
  return (
    <SettingsLayout menu={<SubNav label={words.settingsMenu} groups={groups} />}>
      <Panel titleId="kit-settings" title={words.settingsGroups[0].items[0]}>
        <SettingRow label={words.radius} unit={words.metres}>
          {(control) => (
            <NumberInput
              {...control}
              width="figure"
              value={radius}
              onChange={(event) => {
                setRadius(event.currentTarget.value);
              }}
            />
          )}
        </SettingRow>
        <SettingRow label={words.wait} unit={words.minutes} error={words.error}>
          {(control) => <NumberInput {...control} width="figure" defaultValue={500} />}
        </SettingRow>
        <SettingValue label={words.radius} value={words.viewOnly} />
      </Panel>
      <ChangeBar count={words.changes}>
        <Button variant="quiet" size="small">
          {words.discard}
        </Button>
        <Button variant="primary" size="small">
          {words.review}
        </Button>
      </ChangeBar>
    </SettingsLayout>
  );
}

function Navigation() {
  return (
    <>
      <div className={styles.row}>
        <Popover label={words.account} button={<span>PN</span>}>
          {(close) => (
            <>
              <PopoverNote>{words.signedIn}</PopoverNote>
              <PopoverItem onClick={close}>{words.toggle}</PopoverItem>
              <PopoverLink href="#kit">{words.signOut}</PopoverLink>
            </>
          )}
        </Popover>
      </div>
      <div className={styles.navs}>
        {[false, true].map((folded) => (
          <SideNav
            key={String(folded)}
            label={`${words.nav} ${String(folded)}`}
            folded={folded}
            head={<Caps>{words.nav}</Caps>}
            foot={<NavButton icon={GLYPHS.fold} name={words.fold} onClick={() => undefined} />}
          >
            {words.navItems.map((item, at) => (
              <NavItem
                key={item.name}
                to="#kit"
                icon={NAV_ICONS[at] ?? GLYPHS.tasks}
                name={item.name}
                current={at === 1}
                count={item.count}
                urgent={"urgent" in item}
              />
            ))}
          </SideNav>
        ))}
      </div>
    </>
  );
}

export function ConsoleKit() {
  return (
    <section className={styles.section} aria-label={words.console}>
      <h2 className={typeLook("title-3", styles.sectionTitle)}>{words.console}</h2>
      <Stack gap="24">
        <Head />
        <Figures />
        <List />
        <Settings />
        <Navigation />
      </Stack>
    </section>
  );
}
