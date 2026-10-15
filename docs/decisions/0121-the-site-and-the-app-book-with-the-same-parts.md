# 0121. The site and the app book with the same parts

- Status: accepted
- Date: 2026-10-11
- Topic: Platform
- Amends [0076](0076-one-ui-layer-and-one-api-client.md): the public site uses `@maneman/ui` for the booking's parts

## Context

The site's /book and invite pages and the client app's booking sheet ask for the same things: a day, a window on it, an address. Each drew them in its own code, the site in Preact and the app in React, so a change to how a window reads or a full day looks was made twice, and sometimes only once (audit finding DS-03). The owner chose on 11 October 2026 to draw them from one set of parts, as long as the site keeps its speed budgets.

## Decision

1. **The site compiles with Preact's compatibility layer** (`preact({ compat: true })` in `site/astro.config.ts`), so a component written for React in `@maneman/ui` runs in a site island. The layer costs nothing in a page whose islands import nothing from `react`, and adds about 6 KB (2 KB compressed) to one that does.
2. **The booking's parts live in `@maneman/ui`**, each taking its words from the surface that draws it, as `AddressSearch` does. `WindowChoice` was the first; the day strip and the address's fields followed. Each now ships one look, a full day the board's shaded block and a full window "Full" in place of its hours, and a surface sets only its spacing and width (amended 15 October 2026). The before-and-after compare is one part too, `Compare`, which the site's teaser and the app's Compare screen both draw.
3. **The shared parts use nothing Preact lacks**: plain elements, `className`, the hooks Preact has. Every `onChange` the site sets on an element is on a radio, a checkbox, a select or a file input, where the layer still listens for the change event; text fields listen with `onInput`.

## Consequences

- The site's Lighthouse budgets (`scripts/ci/lighthouse.ts`) stay the test: a part that pushes /book past them is split or left out of the site.
- `packages/ui/README.md` lists which parts the site uses.
