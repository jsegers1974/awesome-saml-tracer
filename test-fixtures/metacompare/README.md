# MetaCompare offline test kit

Deterministic, no-server test data for the Pro **MetaCompare** feature. Lets you
exercise the full UI (import a capture → upload metadata → see matches and
deliberately-broken mismatches) without standing up an IdP/SP.

> These files are test fixtures — they are **not** shipped in the Web Store zip.
> The certs are throwaway self-signed certs (private keys are discarded during
> generation); nothing secret is stored here.

## Files

| File | What it is |
|------|------------|
| `capture.json` | A saml-tracer-format export with one signed `SAMLResponse` (base64). Import it into the extension to get a real capture. |
| `idp-metadata.xml` | IdP metadata that **matches** the capture (entityID, signing cert, NameID format). |
| `sp-metadata.xml` | SP metadata that **matches** (entityID = Audience, ACS = Recipient, required attribute `email` which the assertion has). |
| `idp-metadata-BROKEN-rotated-cert.xml` | Same IdP, but a **different signing cert** → signing-cert mismatch (simulates cert rotation). |
| `sp-metadata-BROKEN-acs-and-required-attr.xml` | Wrong ACS URL **and** a required attribute the assertion lacks → ACS + required-attribute mismatches. |
| `generate.sh` | Regenerates everything (needs `openssl` + `base64`). |

The assertion uses IdP `https://idp.local/metadata`, SP `https://sp.local/metadata`,
ACS `https://sp.local/acs`, NameID format emailAddress, and releases `email` + `givenName`.

## How to test (≈2 minutes)

1. **Unlock Pro locally** (MetaCompare is gated): in `shared/license.js` set
   `DEV_UNLOCK_PRO = true` — *or* run this in an extension page's DevTools console:
   ```js
   chrome.storage.local.set({ license: { valid: true, checkedAt: Date.now() } })
   ```
2. Reload the extension at `chrome://extensions`, then open the **popup** (toolbar icon).
3. **Import the capture:** click **Import** (or drag `capture.json` onto the window).
   The capture appears in **All Traffic** / **SAML**.
4. Select the `SAMLResponse` entry — the **MetaCompare** section shows under the
   decoded detail with an *"Add the IdP and/or SP metadata…"* prompt.
5. Click **Add metadata…** and pick `idp-metadata.xml`, then **Add metadata…**
   again and pick `sp-metadata.xml`.
   → All six checks should be **green** (issuer, audience, ACS/recipient,
   signing certificate, NameID format, required attributes).
6. **See it catch a problem:** click **Clear**, then add a `*-BROKEN-*.xml` file:
   - `idp-metadata-BROKEN-rotated-cert.xml` → **signing certificate** mismatch.
   - `sp-metadata-BROKEN-acs-and-required-attr.xml` → **ACS / Recipient** and
     **Required attributes** mismatches (with hints).

(The same works in the DevTools **SAML** panel for live captures.)

⚠️ Set `DEV_UNLOCK_PRO` back to `false` before building a release zip.

## Regenerate

```bash
./generate.sh
```
