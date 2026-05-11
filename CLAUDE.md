# Awesome SAML Tracer

Chrome extension (Manifest V3) for tracing SAML SSO flows, with a built-in JWT decoder and drag-and-drop import for SAML-tracer JSON exports.

Built as an improvement over the existing SAML-tracer extension. The three differentiating features:
1. Drag-and-drop import of `.json` SAML-tracer exports.
2. Cleanly formatted SAML attribute display (3-column table: friendly name, full URN, value(s)).
3. Native JWT decoder.

## How to load it

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this folder (`awesome-saml-tracer/`).
3. Pin from the puzzle-piece menu to see the badge count.
4. Open DevTools on any page → look for the **SAML** panel.

After editing files: hit the reload icon for the extension on `chrome://extensions`. Service-worker code changes need a reload; HTML/JS in the panel/viewer/popup pages just need their page reopened.

## File layout

```
manifest.json              MV3 manifest
service_worker.js          Background worker — webRequest capture, storage, badge, message router
shared/
  saml.js                  decodeSamlMessage / summarizeSaml / prettyPrintXml
  jwt.js                   decodeJwt + claim humanizer
  styles.css               Single stylesheet for all surfaces; light + dark via prefers-color-scheme
devtools/
  devtools.html / .js      Registers the "SAML" panel
  panel.html / .js         Live capture list + decoded detail (filtered to inspected tab)
viewer/
  viewer.html / .js        Full-page drag-and-drop importer for saml-tracer JSON
jwt/
  jwt.html / .js           Paste-a-JWT decoder
popup/
  popup.html / .js         Toolbar dropdown — quick links + clear
```

No bundler, no build step. Plain ES modules (`<script type="module">`) and `import` paths relative to the file. The service worker uses `"type": "module"` in the manifest so the same imports work there too.

## Architecture

### Capture path
`service_worker.js` registers `chrome.webRequest.onBeforeRequest` at the top level (so it survives worker restarts). For each request it inspects:
- URL query string for `SAMLRequest`/`SAMLResponse` (Redirect binding)
- `requestBody.formData` for the same params (POST binding)
- `requestBody.raw` decoded as UTF-8 as a fallback

Matches are persisted to `chrome.storage.local` under the `captures` key, capped at `MAX_CAPTURES = 200` (FIFO). Each save broadcasts `{type: 'capture-added', entry}` so any open panel/popup refreshes; this is best-effort (`.catch(() => {})`) since no listeners is fine.

### Message protocol
Three message types between contexts:
- `list-captures` → returns `{captures: [...]}`
- `clear-captures` → empties storage and clears all badges
- `capture-added` → broadcast from worker; panels filter by `tabId`

### DevTools panel
`chrome.devtools.inspectedWindow.tabId` filters the list to the tab being inspected. The panel is its own page context — uses `chrome.runtime.sendMessage` to talk to the worker, and `chrome.tabs.create` to open viewer/JWT pages in new tabs.

### SAML decoding (`shared/saml.js`)
`decodeSamlMessage(encoded)`:
1. URL-decode if percent-encoded.
2. Base64 (or base64url) decode to bytes.
3. Try interpreting bytes as UTF-8 XML directly (POST binding).
4. If that doesn't look like XML, try `DecompressionStream('deflate-raw')` (Redirect binding).
5. Returns `{xml, encoding}` where `encoding` is `'base64' | 'base64+deflate' | 'unknown'`.

`summarizeSaml(xml)` parses with `DOMParser` (browser-only) and pulls out kind, issuer, destination, subject, status, conditions, and an `attributes` array. Each attribute has `{name, friendlyName, nameFormat, values[]}`.

### JWT decoding (`shared/jwt.js`)
Standard split-on-`.`, base64url-decode, JSON-parse. `extractClaims` humanizes `iat`/`nbf`/`exp` to ISO timestamps, computes `expiresIn` as a relative duration, and flags `expired`.

## Conventions

- **No external runtime dependencies.** Everything ships in the unpacked folder. We use `DecompressionStream` for inflate (Chrome 103+) instead of bundling pako.
- **Pure ES modules** — same code runs in service worker, devtools panel, and full pages.
- **Defensive messaging** — every `sendMessage` is wrapped in `.catch(() => {})` because the receiver may not be loaded.
- **Top-level event listeners** in the service worker — required for MV3 worker lifecycle.
- **HTML escaping** — every dynamic insertion goes through a local `escape()` helper; no `innerHTML` from raw user/SAML data without it.
- **`minimum_chrome_version: "111"`** — DecompressionStream's `'deflate-raw'` format needs Chrome 103+; 111 gives margin and matches a stable baseline.

## Permissions

| Permission         | Why |
|--------------------|-----|
| `webRequest`       | Observe outgoing SAML messages (non-blocking) |
| `storage`          | Persist captures across worker restarts |
| `tabs`             | `chrome.tabs.create` for viewer/JWT, `tabs.onUpdated` to clear badge on navigation |
| `<all_urls>` host  | SAML can hit any IdP/SP domain |

We do **not** use `declarativeNetRequest` (no traffic modification) or `webNavigation` (avoided to keep permissions minimal).

## Testing

No automated tests yet. Manual smoke:
- JWT: paste any token from jwt.io.
- SAML POST binding: trigger a real SSO login (Okta, Azure AD, Google) and watch the panel.
- SAML Redirect binding: same, but for IdP-initiated AuthnRequests.
- Importer: drop a SAML-tracer JSON export onto the viewer page.

A standalone Node script can exercise the pure-JS decoders (no DOM needed for `decodeSamlMessage` / `decodeJwt`):

```js
import { decodeSamlMessage } from './shared/saml.js';
import { decodeJwt } from './shared/jwt.js';
```

`summarizeSaml` requires DOMParser, so test it in the browser.

## Known gaps / next steps

- No icons (Chrome shows a default puzzle piece). Add `icons/` and `action.default_icon` when ready.
- Capture list has no search/filter/export.
- No JWT signature verification (would need IdP JWKS lookup).
- No OIDC live capture — only SAML on the wire; JWTs are paste-only.
- No options page (capture cap, domain allow-list, redaction rules are all hardcoded).
- Dark mode follows system; no manual override.

## When extending

- New capture sources go in `inspectRequest()` in `service_worker.js`.
- New decoder helpers belong in `shared/`. Keep them browser-API-only (no Node-isms) so they work in the worker.
- New UI surfaces: add a folder, register HTML in `manifest.json` only if it needs to be navigable from web pages (currently none do — extension pages are reachable via `chrome.runtime.getURL`).
- For anything that mutates traffic (modifying SAML requests, etc.), MV3 requires `declarativeNetRequest` rules — webRequest in MV3 is observation-only.
