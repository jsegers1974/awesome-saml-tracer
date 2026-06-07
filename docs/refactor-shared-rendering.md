## Problem Statement

The extension renders the SAML detail view on three separate surfaces — the DevTools panel (`devtools/panel.js`), the popup app window (`popup/popup.js`), and the drag-and-drop viewer (`viewer/viewer.js`). Each surface carries its own private copy of the same rendering logic: `escape`, `row`, `shortName`, `truncate`, `renderAttributes`, the conditions block, and the outer detail wrapper.

This duplication has already caused a shipped bug. When encrypted-assertion detection was added, `renderAttributes` was updated in panel and viewer but missed in popup, because popup held a diverged copy with a different signature (`renderAttributes(attrs)` instead of `renderAttributes(s)`). The popup silently showed "No SAML attributes" for encrypted SAML responses until a user reported it. The fix had to be applied a second time, by hand, to the surface that was missed.

Any future change to the SAML detail view — a new field, a new badge, a new notice — has to be made in three places and is one copy-paste-omission away from the same class of bug.

## Solution

Extract the shared rendering logic into a single new module, `shared/render.js`, and have all three surfaces import from it. After the refactor there is exactly one implementation of each rendering concern, so a change to the SAML detail view is made once and is correct on every surface.

The outer wrappers (`renderDetail`, `renderSamlDetail`, `renderCard`) are unified into one parameterized `renderSamlDetail(s, xml, encoding, opts)`. Surface-specific pieces — the leading Time row, the source-label heading, the parameters table, and the request/response header tables — are driven by `opts` so each surface keeps its exact current content while sharing one code path.

This is a behavior-preserving refactor. The only intended visual changes are two spacing normalizations on the viewer page (see Decision Document).

## Commits

Each commit leaves the extension fully working — load-unpacked still renders all three surfaces — and the test suite green. Commits are grouped; within a group each bullet is one commit.

**Group A — stand up the module with the pure helpers**

1. Add `shared/render.js` exporting `escape`, `row`, `shortName`, and `truncate`, copied verbatim from the existing implementations (use the no-extra-whitespace variant of `escape`). Nothing imports it yet; no behavior change.
2. Add `tests/render.test.js` with characterization tests for `escape` (escapes `& < > " '`), `shortName` (strips URN/URL/`:` prefix, passes through plain names), `row` (returns empty string for null/empty, emits `<dt>/<dd>` otherwise), and `truncate` (under/over length). Tests pass.

**Group B — adopt the helpers, one surface per commit**

3. In `panel.js`, import `escape/row/shortName/truncate` from `shared/render.js` and delete the four local definitions. Manual smoke + tests.
4. In `popup.js`, import the same four and delete the local definitions (the local `escape` had cosmetic extra spaces; output is identical).
5. In `viewer.js`, import `escape/row/shortName` and delete the local definitions (viewer has no `truncate`).

**Group C — share `renderAttributes`**

6. Add `renderAttributes(s)` to `shared/render.js`, using the panel/popup form including `style="margin-top:16px;"` on the `<h3>`. Add tests covering all four branches: encrypted assertion notice, encrypted-attribute notice, empty ("No SAML attributes"), and a normal attribute table (rows, friendly-name fallback, multi-value, no-values, trailing encrypted-attribute note).
7. In `panel.js`, import `renderAttributes` and delete the local copy.
8. In `popup.js`, import `renderAttributes` and delete the local copy.
9. In `viewer.js`, import `renderAttributes` and delete the local copy. This is where the viewer's Attributes heading picks up the standardized `margin-top:16px`.

**Group D — share the conditions block**

10. Add `renderConditions(s)` to `shared/render.js` producing the `<h3>Conditions</h3>` + definition-list markup with `margin-bottom:16px`. Add a test for present-conditions and a null-returns-empty case.
11. In `panel.js`, replace the inline conditions markup with `renderConditions(s)`.
12. In `popup.js`, replace the inline conditions markup with `renderConditions(s)`.
13. In `viewer.js`, replace the inline conditions markup with `renderConditions(s)`. This standardizes the viewer's conditions spacing from `12px` to `16px`.

**Group E — share the params and header tables**

14. Add `renderHeaderTable(label, headers)` and `renderSamlParams(capture)` to `shared/render.js`, copied from popup. Add tests: header table returns empty for no headers and a row per header otherwise; params table renders RelayState plus a truncated SAML blob and picks the binding label from `source`.
15. In `popup.js`, import both and delete the local copies. Update both call sites in the network detail view (Request/Response header tables) and the SAML detail view.

**Group F — unify the outer wrapper**

16. Add `renderSamlDetail(s, xml, encoding, opts)` to `shared/render.js`. `opts` carries `{ url, time, sourceLabel, kindFallback, params, networkEntry }`. It renders: heading (`s.kind || kindFallback || 'Unknown'` plus an optional source-label span); a definition list with a leading Time row only when `time` is provided, then URL/Issuer/Destination/Subject/Status/Issued/Encoding and the Assertion row when `s.assertionEncrypted`; then `renderAttributes(s)`, `renderConditions(s)`, the params table when `params` is provided, the header tables when `networkEntry` is provided, and the Raw XML `<details>` block. Add tests for the opts permutations (minimal panel-style, popup-style with params+headers, viewer-style with time+sourceLabel).
17. In `panel.js`, replace `renderDetail` with a call to `renderSamlDetail(summary, xml, encoding, { url: c.url })`.
18. In `popup.js`, replace `renderSamlDetail` with a call to the shared one passing `{ url: c.url, params: c, networkEntry }`.
19. In `viewer.js`, replace `renderCard` with a call passing `{ url, time, sourceLabel: payload.source, kindFallback: payload.kind }`.

**Group G — cleanup**

20. Remove any now-unused local helpers/imports across the three files, confirm no surface still defines a private copy of a shared function (grep), run the full test suite, and do a final manual smoke of all three surfaces against one encrypted and one normal SAML response.

## Decision Document

- A new module `shared/render.js` holds every shared rendering concern. It is browser-API-only (string templating plus `prettyPrintXml` from `shared/saml.js`); it does not touch `DOMParser`, so it stays usable anywhere the other shared modules are.
- The three outer wrappers collapse into one `renderSamlDetail(s, xml, encoding, opts)`. Surface-specific content is expressed through `opts` rather than separate functions:
  - `url` — the URL string to display (capture URL or network-entry URL).
  - `time` — when present, a leading Time row is rendered (viewer only).
  - `sourceLabel` — when present, a muted source span is appended to the heading (viewer only).
  - `kindFallback` — heading fallback when `s.kind` is absent (viewer passes `payload.kind`).
  - `params` — when present (a capture object), the Parameters table is rendered (popup only).
  - `networkEntry` — when present, the Request/Response header tables are rendered (popup only).
- The row order is fixed: Time (optional) → URL → Issuer → Destination → Subject → Status → Issued → Encoding → Assertion (only when `s.assertionEncrypted`). Panel and popup pass no `time`, preserving their current order.
- `renderHeaderTable` moves to the shared module even though only popup uses it, because popup calls it from both the network detail view and the SAML detail view; it is a shared concern within that surface.
- Two intentional visual normalizations on the viewer page, both following the "standardize spacing" decision: the Attributes `<h3>` gains `margin-top:16px`, and the Conditions block changes from `margin-bottom:12px` to `16px`. Every other surface is visually unchanged.
- `escape` is consolidated to the compact (no-extra-spaces) variant; output is byte-identical to all prior variants.
- No build step is introduced. The module is a plain ES module imported with relative paths, consistent with `shared/saml.js` and `shared/jwt.js`.

## Testing Decisions

- A good test here pins **external behavior** — the HTML string a renderer returns for a given summary/options — not internal structure. Tests assert on substrings and presence/absence of the right markup and notices, not on private helpers.
- New tests live in `tests/render.test.js`, run by the existing `node --test` script. The shared renderers are pure string functions and do **not** require the jsdom `DOMParser` polyfill, unlike the `summarizeSaml` tests.
- Modules covered: `escape`, `shortName`, `row`, `truncate`, `renderAttributes` (all four branches, including the encrypted/encrypted-attribute paths that currently have **zero** coverage), `renderConditions`, `renderHeaderTable`, `renderSamlParams`, and `renderSamlDetail` (opts permutations).
- Prior art: `tests/saml.test.js` is the model for structure (`node:test` `describe`/`test`, `before` setup, substring assertions) and `tests/jwt.test.js` for pure-function testing.
- The characterization tests are written against the **current** rendered output before each move, so the move commits are verified to preserve behavior.

## Out of Scope

- The capture pipeline (`service_worker.js`), message protocol, storage, and badge logic — untouched.
- SAML/JWT decoding logic in `shared/saml.js` and `shared/jwt.js` — untouched (only imported).
- The JWT view, settings panel, info bar, search, pause, export, and HTML-report code in `popup.js` — untouched. The HTML report builds its own standalone markup and is intentionally left as-is.
- The network-list and error-list rendering — only `renderHeaderTable` (shared by the network detail view) moves; list rendering stays put.
- Any visual redesign. The only deliberate visual changes are the two viewer spacing normalizations above.
- CSS in `shared/styles.css` — no changes.

## Further Notes

- This refactor is the prerequisite groundwork flagged before the planned Pro features (Assertion Diff, SSO Flow Visualization), both of which will add new fields and sections to the SAML detail view. Doing this first means those features are implemented once instead of three times.
- Recommended review checkpoint after Group B: confirm the four pure helpers are sourced only from `shared/render.js` (a grep for their `function` definitions in the three UI files should return nothing) before proceeding to the higher-risk wrapper unification.
