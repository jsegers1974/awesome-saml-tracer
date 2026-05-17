# Awesome SAML Tracer

☕ If this extension saves you time, [buy me a coffee on Ko-fi](https://ko-fi.com/samldev) — it's appreciated!

> **Privacy:** This extension captures SAML traffic locally on your device only. No data is ever transmitted or stored externally. See [PRIVACY.md](PRIVACY.md) for full details.

A Chrome extension for capturing, inspecting, and sharing SAML SSO traffic. Built as a modern, full-featured replacement for the original SAML-tracer extension — with cleaner attribute display, a built-in JWT decoder, one-click sharing, and import/export compatibility with SAML-tracer exports.

---

## Installation

### Chrome Web Store
Search for **Awesome SAML Tracer** in the Chrome Web Store and click **Add to Chrome**.

### Manual (Developer Mode)
1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `awesome-saml-tracer/` folder.
4. Pin the extension from the puzzle-piece menu so it's always visible.

---

## Opening the Extension

Click the extension icon in the toolbar to open the main window. You can also access it from the **SAML** panel inside Chrome DevTools (open DevTools on any page → click the **SAML** tab).

---

## The Interface

The window is split into two panes:

- **Left pane** — the capture list. Shows all SAML messages or network requests depending on which view is active.
- **Right pane** — the detail view. Shows the full decoded content of whichever entry you select.

Drag the divider bar between the two panes left or right to resize them.

A **search bar** at the top of the left pane lets you filter the list by URL, HTTP method, or status code in real time.

---

## Views

Use the view toggle buttons at the top-left to switch between:

| Button | What it shows |
|--------|--------------|
| **SAML** | Only requests that contain a SAMLRequest or SAMLResponse |
| **All Traffic** | Every HTTP request captured on the page |
| **Errors** | Network requests that returned a 4xx or 5xx status code (button is disabled when no errors exist) |
| **JWT** | A standalone JWT decoder — paste any token to inspect it |

---

## SAML View

This is the default view. Whenever a page performs a SAML SSO exchange, the request appears in the list automatically — no page reload required.

Each entry in the list shows:
- **HTTP method** (POST, GET, …) in color
- **Message type** — SAMLRequest or SAMLResponse
- **Timestamp**
- **URL** of the endpoint

### Selecting an Entry

Click any entry to decode it. The right pane shows:

- **Kind** — e.g. `Response`, `AuthnRequest`
- **URL, Issuer, Destination, Subject, Status, Encoding, Timestamp**
- **Conditions** — NotBefore, NotOnOrAfter, Audience (when present)
- **Attributes table** — three columns: Friendly Name, Full URN, Value(s)
- **Parameters** — RelayState and the raw encoded SAMLRequest/SAMLResponse (truncated), with the binding type (POST or Redirect)
- **Request Headers** and **Response Headers**
- **Raw XML** — collapsed by default, click to expand

Click the **Copy** button at the top-right of the detail pane to copy all of this information as plain text — useful for pasting into a support ticket or Slack message.

---

## All Traffic View

Shows every HTTP request the browser made, not just SAML ones. Requests that contain SAML are highlighted with a blue left border.

Selecting a SAML-tagged entry shows the full SAML detail (same as the SAML view). Selecting a plain network entry shows the method, status, URL, and request/response headers.

---

## Errors View

Filters the network list to show only requests that returned a 4xx or 5xx HTTP status. The button is grayed out when there are no errors — it activates automatically as soon as an error response is captured.

---

## JWT View

Click **JWT** in the view toggle to open the JWT decoder.

- Paste a token directly into the text area, or click **Paste from clipboard**.
- The extension splits the token into **Header**, **Payload**, and **Signature** sections.
- A **Highlights** panel surfaces key claims in plain language: issuer, subject, audience, expiry time, and whether the token is already expired.

---

## Toolbar Buttons

| Icon | Tooltip | Action |
|------|---------|--------|
| ⏸ / ▶ | Pause / Resume | Stop or restart capturing new traffic |
| ⊘ | Clear | Remove all captured data from the current session |
| ⬆ | Export | Save all captured data as a `.json` file (compatible with SAML-tracer exports) |
| 📂 | Import | Load a previously exported `.json` file |
| 📄 | Report | Generate and save a self-contained HTML report to your Downloads folder |
| ⚙ | Settings | Open the settings panel |

---

## Sharing Captures

### HTML Report (📄)

Click the **Report** button to generate a self-contained `.html` file saved to your **Downloads** folder. The file requires no internet connection and can be opened in any browser.

The report includes:
- All SAML captures with decoded attributes, conditions, parameters, request/response headers, and raw XML
- A full network traffic table with per-request header details
- Printable to PDF from the browser

A green banner appears after saving with the filename and a **Show in Folder** button that opens Finder (macOS) or Explorer (Windows) directly to the file — ready to attach to an email or ticket.

### Copy (in Detail Pane)

Select any entry on the left, then click the **Copy** button in the top-right of the detail pane. This copies the decoded content of that specific entry as formatted plain text — ideal for pasting into chat, email, or a bug report.

### Export / Import (⬆ / 📂)

Export saves all captures as a structured JSON file in the [SAML-tracer](https://github.com/UNINETT/SAML-tracer) format, so it can be shared with a developer and re-opened in either Awesome SAML Tracer or the original SAML-tracer extension.

Import (or drag-and-drop a `.json` file anywhere onto the window) loads an exported file for offline review — no active SSO flow needed.

---

## Settings (⚙)

Settings are saved automatically and persist across browser sessions.

### Highlight Domains

Enter URL patterns (one per line, wildcards supported) to visually flag requests from specific domains with a gold star (★) and border.

```
*mycompany.com
*okta.com
```

Any request whose URL matches a pattern gets highlighted in the list, making it easy to spot your IdP or SP traffic at a glance.

### Important Headers / Parameters

Enter header names or SAML parameter names to pin in the **info bar** — a strip that appears below the toolbar whenever you select an entry.

```
X-Transaction-Id
RelayState
SAMLResponse
```

Pinned values appear as chips you can copy with a single click. If the header or parameter is absent from the selected request, the chip shows a dash.

### Show Query Params For

Enter URL patterns. When a selected request matches, **all** of its query string parameters are shown in the info bar automatically — useful for endpoints that encode important context in the URL.

```
*myapp*
*mycompany.com/api*
```

### Extract from URL Path

Enter rules in `Label | *pattern*` format. When a selected URL matches the pattern, the extension extracts the last path segment and shows it in the info bar with your label.

```
Config ID | *myapp*
Tenant | *tenants/*/config*
```

For example, if a URL is `https://myapp.com/tenants/acme-corp/config`, the rule `Tenant | *tenants/*/config*` would display **Tenant: acme-corp** in the info bar.

---

## DevTools Panel

Open Chrome DevTools on any page (`F12` or `Cmd+Option+I`) and click the **SAML** tab. The panel works identically to the popup but is automatically filtered to show only traffic from the tab you're inspecting — useful when you have multiple tabs open.

---

## Tips

- **SAML traffic not showing?** Make sure the extension is loaded and the tab performing the SSO flow is active when you trigger the login. The extension captures traffic in real time — it cannot see requests that happened before it was installed.
- **Redirect binding vs POST binding** — Both are supported. Redirect binding (GET requests with `SAMLRequest`/`SAMLResponse` in the URL) are deflate-decompressed automatically. POST binding form data is decoded from base64.
- **Importing someone else's export** — Drag and drop a `.json` file onto the window, or use the 📂 Import button. The session switches to read-only imported mode; click ⊘ Clear to return to live capture.
- **Printing the HTML report** — Open the report in Chrome and use **File → Print** (or `Cmd+P` / `Ctrl+P`). Choose "Save as PDF" to create a shareable PDF with all sections fully expanded.
