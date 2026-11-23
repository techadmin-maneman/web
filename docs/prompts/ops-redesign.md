# Prompt: implement the ops console redesign

Copy everything below the line into the coding agent.

---

You are implementing a redesign of the Mane Man ops console (the staff tool at ops.maneman.in) in this repo. The redesign is specified by a clickable prototype. The rule that overrides everything else: **no existing functionality is lost.** Every field, action, filter, tab, state, role rule and server behaviour that exists today must exist after your change. The only exceptions are the items Adwate approves in the changes file.

## Inputs (in `docs/ops-redesign/`)

- **`prototype/index.html`:** the clickable prototype. Open it in a browser. The left guide lists all 108 screens and has toggles for Laptop/Phone, light/dark, role and page state (data, loading, empty, error).
- **`prototype/src/`:** the prototype's source:
  - `style.css` holds the design tokens and component styles.
  - `core.js` holds the components (button, pill, card, table, tabs, chips, field, kv, list row, empty, note, meter).
  - `shell.js` holds the sidebar, top bar, phone tab bar and the single panel pattern.
  - `main.js` holds the render loop.
  - The `pages_*.js`, `settings*.js` and `hairprofile.js` files hold each screen's content and copy.

  Treat it as a spec, not code to paste. Its data is example data.
- **`01-changes-for-approval.md`:**
  - Section A lists deliberate changes. Implement each only after Adwate has marked it approved. Where it isn't marked, ask.
  - Section B lists current features the prototype doesn't draw. Keep them all, restyled.
  - Section C lists new features.
- **Screenshots of the current console** (1,271 PNGs, one per action) are in `ops-console-screens-2026-11-22` if Adwate gives you the folder. Use them to see the current behaviour of anything in section B.

## Step 1: map before you change anything

1. Find the ops console app in the repo. Find its framework, router, data layer, permission checks and existing e2e tests.
2. Write `docs/ops-redesign/parity.md`: a table with one row per screen and, under it, every field, action, filter, tab and state that the current code renders. Get it from the code, not from the prototype. For each row add:
   - where it lives in the redesign (the prototype screen);
   - whether the redesign keeps it, changes it (cite the A item) or adds it (cite the C item).

   Any row with no home in the redesign is a gap. List the gaps at the top of the file and stop. Ask Adwate before going further.
3. List the server changes the new features need, and propose the smallest migration for each:
   - technician start date;
   - hair profile versions (an append-only table, with the latest version as the current profile);
   - the "consultation and first fit" visit type, if it isn't already a type;
   - package, hair system, discount code, city and pincode retire/delete state plus the linked-record checks;
   - discount code usage history, if it isn't already queryable;
   - reorder level per item;
   - booked-visit usage per kit for the next 4 weeks.

   Don't change any server rule that the redesign doesn't require.

## Step 2: build the design system

Implement these once and use them everywhere. Don't style a screen by hand.

1. **Type:** IBM Plex Sans, 14px body, 1.45 line height. Use tabular figures for every number.
2. **Colour tokens:** take them exactly from `prototype/src/style.css` `:root`, plus the `.dark` theme.
   - Navy `#16233A` for the sidebar and primary buttons.
   - Gilt `#C9A363` on navy only.
   - Brass `#B98B45` for the focus ring.
   - Canvas `#F2F3F5`, with white surfaces.
   - Semantic green, red, amber and blue, each with a wash colour.
   - Radius 6px, with 4px for small items.
3. **Logo:** use the official Mane Man lockup and mark SVG files from the brand kit, not a redrawn version.
   - Expanded sidebar: gilt lockup, a thin divider and "Ops".
   - Collapsed sidebar: the mark only.
   - Paths are in `prototype/src/logo.js`; use the repo's existing brand asset if one exists.
4. **Control height and alignment:**
   - Every button, input, select, chip and search box is 34px tall; small buttons are 28px.
   - Card headers have a fixed minimum height of 52px.
   - In any row where text sits beside a button (settings rows, list rows, panel rows), put both on the same text baseline and give the button the same font size as the text. A centred box with a smaller font sits 2px high; this was a reported bug.
   - Table cells don't wrap, except the secondary line.
5. **Overlays (one pattern):**
   - Every record, form, edit, flow and confirmation opens in one right-hand panel, which becomes a bottom sheet on phone.
   - The panel header holds the title, the subtitle, a status pill and contact actions (Call, WhatsApp).
   - The footer puts a destructive action on the left and the primary action on the right.
   - The search palette (`/` or Ctrl K) is the only centred window. Dropdown menus are used only for the city picker and the account menu.
   - Toasts confirm actions; an undo appears where the action can be undone. Switches save on click.
   - A destructive action always opens a confirmation in the same panel. The confirmation says what happens and what stays.
6. **Editing settings:** each setting row shows the label, optional helper text, the value and "Change". "Change" opens the panel with a control for the value only:
   - a number input with the unit fixed beside it;
   - a time picker for times;
   - a radio choice for Yes/No, Allowed/Not allowed, or a fixed set;
   - checkboxes for lists;
   - free text only when the value is genuinely text.

   Show "Now: <value>" under the control. The same rule applies inside add and edit forms: never put a unit inside a text input.
7. **States:** every page has loading (skeleton), empty (says what to do next, with the action) and error (says what failed, with Retry) states, as in the prototype's page-state toggle.
8. **Phone:**
   - A bottom tab bar (Today, Tasks, Dispatch, Messages, More).
   - Tables turn into label/value cards.
   - Panels become bottom sheets.
   - The back arrow appears on detail pages.

## Step 3: fix the flicker at its root

Adwate reported that the screen flickers when you click options while booking a visit.

**Cause in the prototype:** every state change re-rendered the whole app. That replayed the panel and scrim enter animations and reset scroll and focus.

**What to check in the real console:** whether it remounts the overlay, layout or page tree on state changes. Look for:
- unstable keys;
- components defined inside render;
- conditional wrappers that swap element types;
- context providers that change identity on every render;
- route-level suspense or loading states that blank the page;
- CSS enter animations on elements that re-mount.

**Fix:**
- Keep the panel and scrim mounted with stable identity while the panel is open, and run enter animations only on first mount.
- Keep scroll position and focus across updates.
- Reset the panel's scroll only when a different record opens.

Add an e2e test that opens Book a visit, clicks through every step and option, and asserts three things: the panel element is the same node, no animation restarts, and the scroll position is unchanged. Apply the same fix to every overlay and to page-level data refreshes.

## Step 4: navigation and screens

**Sidebar groups:**
- Work: Today, Tasks, Dispatch, Messages.
- People: Clients, Technicians.
- Running the business:
  - Inventory, Requests, Money, Growth and Reports, each with a sub-menu.
  - Under each section, the page tabs at the top match the sub-menu.
- Admin: Settings, whose sub-menu is the 9 settings groups (Business, Scheduling, Visits, Prices, Growth, Care, Inventory, Team, System). Each group's pages are tabs at the top. There is no separate settings column. "Find a setting" sits at the right of the tabs and matches page names and individual setting labels.

Build each screen to match the prototype's content, copy and layout. Where the prototype and the current console differ, the parity table decides. The specific behaviours to get right:

1. **Today:** varies by role, with a headline sentence, KPIs, grouped "Needs you" and "On the road".
2. **Tasks:**
   - Chips for All, Mine, Unassigned and Overdue, with real counts.
   - Bulk actions and Assign.
   - The task panel shows contacts in its header.
   - Pagination stays.
3. **Dispatch:**
   - Day view 9 am to 8 pm, one lane per technician plus a "No technician" lane, a now line and a Day map button.
   - Visit-type filter chips with colour swatches: Service visit, Consultation, Consultation and first fit, First fit, Replacement.
   - The week view uses the same filter.
   - Visit panel:
     - The title links to the client.
     - The footer has Cancel visit (left), then Allow check-in and Move (primary).
     - It shows the drive time from the previous visit and a no-pin warning.
     - A consultation shows Payment as Free.
   - Move mode stays (B1).
4. **Messages:**
   - Three panes.
   - Filters: Waiting on us, Mine, Waiting on client, Closed, All.
   - The client name is a link.
   - A Reply / Note for the team toggle, and quick replies.
   - Close chat asks "What it was about".
5. **Clients:**
   - A "Recently opened" strip (the last 6 clients this user opened) above the table.
   - Every client name across the console links to the client page.
6. **Client page:**
   - Eight tabs, a journey bar and a side rail (visit address, alerts for technicians, notes).
   - **Hair systems tab:**
     - The pieces table, with Mark failed and Undo.
     - The current hair profile, showing "was X" differences from the previous version.
     - Every version, each of which opens read-only.
     - Add a profile or Correct it; either one saves a new version.
     - Stock that matches, custom orders and the package card.
7. **Book a visit:** three steps.
   - A first fit is blocked until a hair profile exists, and the block says so.
   - Earlier and Later days.
   - A technician picker that suggests the best available technician and the drive time.
   - A free visit shows "Nothing to pay".
8. **Technicians:**
   - The list has Last 30 days and Last 12 months.
   - Add and Edit include start date, area they cover, in training until, pay grade, home pincode and trained to fit, plus Switch off and Delete.
   - The header shows the start date.
9. **Inventory:**
   - Stock has the "Whose stock" picker (A8), reorder levels and kit shortfalls for the next 4 weeks.
   - The rest is as listed in the prototype and section B.
10. **Settings:**
    - Cities: a panel per city with each field editable on its own, and Delete under A11.
    - Areas: "Add pincodes" as the page action, and a pincode panel with Delete.
    - Packages: a state column, filters, Retire or Delete, retire a hair system, sell again.
    - Discount codes: a panel per code with its uses, Retire or Delete, download; plus the "Every use" view.
    - Every other settings page keeps all of today's fields; the parity table is the check.

## Step 5: copy rules (apply to every string)

- Plain words from the user's side, sentence case and active verbs.
- A button says exactly what it does, and the toast repeats it: "Retire code" → "FIRSTFIT300 retired."
- No filler, no explaining what the user already knows, no "please" or "successfully", and no em dashes.
- Helper text appears only when it warns of a side effect the user would not expect.
- Errors say what failed and how to fix it.
- Empty states say what to do next.
- Indian formats: "Rs. 1,00,000", "Sun 22 Nov", "9 am".
- Keep the prototype's wording unless the parity table shows that today's wording carries meaning the prototype lost.

## Step 6: deliver in reviewable pieces

Open one PR per area, in this order:
1. Design system and shell (with the flicker fix).
2. Work.
3. People.
4. Inventory.
5. Requests and Money.
6. Growth and Reports.
7. Settings.

Each PR includes:
- the parity rows it covers, all ticked;
- before and after screenshots at 1440px and 390px, in light and dark;
- e2e tests for every action on the screens it touches, including role restrictions and the loading, empty and error states.

If anything existing has no place in the new design, say so in the PR description under the heading **"Functionality affected: needs approval"**, and don't merge it until Adwate approves.

## Done means

1. Every row in `parity.md` is kept, or changed under an approved A item.
2. Every section B item works.
3. Every e2e test passes, including the flicker test.
4. No unit sits inside a text input.
5. Every overlay uses the one panel pattern.
6. Every client name is a link.
7. Every text-and-button row passes a baseline alignment check.
