# 0037. Shared packages: the brand first

- Status: accepted. Amended by ADR 0077: the scales hold each value once, a role names the scale's token, and weights, leading and motion are tokens. Amended by ADR 0076: `packages/ui` is the apps' component layer, and `packages/web-kit` holds the typed API client, India's dates, rupees and WhatsApp's links, which every front end takes from there.
- Date: 2026-09-22

## Context

Phase 2 adds three front ends to the public site: the client app, the ops console and the technician app. The front-end prompt asks for one package holding the tokens, fonts, icons and brand files for all four. It also says Phase 2 extends the tokens file and never forks it (`docs/prompts/phase2-frontend.md`). Until now these lived inside the site:

- `site/src/styles/tokens.css` and `fonts.css`;
- `site/src/lib/icons.ts`;
- the ₹ font file;
- the brand drawings, written into `Sprite.astro`.

The Phase 1 site is finished and waiting for its production release, so moving these files must not change a byte of what it serves.

## Decision

**npm workspaces.** The root `package.json` declares `packages/*`. `packages/brand` is `@maneman/brand` and exports:

- `tokens.css`: the Phase 1 tokens, moved unchanged;
- `tokens-phase2.css`: the colours Phase 2 adds;
- `fonts.css` and `fonts/`: the self-hosted fonts and the one-glyph ₹ file, which `npm run fonts` now writes here;
- `icons`: `ICONS`, `ICONS_P2` and `HEAD_OUTLINE`;
- `marks`: the mark and both cuts of the wordmark.

The package owns its `@fontsource` dependencies. `fonts.css` finds them in the repository's `node_modules`, where npm installs a workspace's dependencies.

**The package holds sources, not builds.** Each front end's bundler (Astro's Vite for the site, Vite for the apps) compiles the TypeScript and CSS it imports. There is no build step and nothing is published.

**`ICONS` is frozen.** The nine Phase 2 glyphs go into `ICONS_P2`, taken path for path from the Client App's icons board. Keeping them apart means the site's island bundles stay as they are. A test pins `ICONS` by hash.

**The Phase 2 colour layer holds three colours, not the seven the plan listed.** The plan took every new hex value in `design/phase2`. Checked against where each is drawn:

- **Product UI (kept):**
  - `#DED7C8` (`--paper-shade`): loading blocks, a full window, leave and replacement cells;
  - `#7A5B24` (`--brass-text`): brass for small text on paper, such as "Prepaid" and the busiest day;
  - `#4A453C` (`--text-quiet`): a window's hours on the referral landing. The boards' captions and notes use it too.
- **Board canvas (dropped):** `#CFCABE` is the page behind the frames.
- **Prototype only (dropped):** `#D8D2C4`, `#EFE7D6` and `#C4BFB2`. The spec boards overrule the Prototype.
- **Not ours:** the WhatsApp greens and greys belong to the chat previews, which draw WhatsApp's interface. **Amended 25 September 2026:** where a board draws a message as WhatsApp will show it — the client app's invite preview (F4) and the ops console's launch message (C3) — the colours are WhatsApp's, so they are kept as their own group, `--wa-*` in `tokens-phase2.css`, and used nowhere else. The console's two had been named as inks of ours (`--ink-message`).

The layer only adds names; the site uses none of them. **Amended 27 September 2026:** it holds seven colours now, four of them WhatsApp's own, and the Phase 2 sizes (`packages/brand/README.md`). **Amended 26 September 2026:** it holds the Phase 2 surfaces' sizes too, the apps' targets and the ops console's frame and density among them, each still a value a spec board draws (ADR 0071).

**The brand kit's SVG files stay in `design/brand/`**, which is the owner's export, as the Phase 2 design README says. The package's `marks` hold the same path data, and a test checks it against every colour variant of the kit.

**`packages/web-kit`** (the security headers builder, the API client, and the IST and rupee formatting) arrives with the first app, in P2-M1, under the same rules. **Amended 27 September 2026:** the API client arrived only with ADR 0076, which also adds `packages/ui`, the apps' components.

## Consequences

- **The site is byte-identical.** `scripts/dist-hash.ts` builds local, staging and production and hashes every file. Before and after the move, all 416 files across the three builds match.
- **The fidelity pairs are unchanged**, since the site's output is. `docs/fidelity-method.md` now describes the method, including how Phase 2 boards are paired: frame by frame, at the frame's own width.
- **Tests:**
  - `test/node/brand-package.test.ts`:
    - `ICONS_P2` against the design's icons board;
    - `ICONS` by hash;
    - `marks` against `design/brand`;
    - the Phase 2 layer adds names without redefining any, repeats no core value, and each value appears in a spec board.
  - `test/node/site-tokens.test.ts` now reads `packages/brand/tokens.css`.
