# Privacy Policy — Awesome SAML Tracer

_Last updated: May 2026_

## Summary

Awesome SAML Tracer does not collect, store, or transmit any of your data to any external server. Everything the extension sees stays on your device.

---

## What the Extension Sees

Awesome SAML Tracer monitors network requests made by your browser in order to detect and decode SAML SSO messages (SAMLRequest and SAMLResponse). This includes:

- URLs of requests your browser makes
- HTTP request and response headers
- Form data and query parameters that contain SAML payloads

This information is only ever used to display it to you inside the extension. It is never sent anywhere.

## Where Data Is Stored

Captured traffic is stored **locally on your device** using Chrome's built-in `chrome.storage.local` API. This storage:

- Is private to the extension on your device
- Is not synced to your Google account or any cloud service
- Is automatically cleared when you click the ⊘ Clear button or uninstall the extension
- Holds a maximum of 200 captures at a time (oldest are dropped automatically)

Settings you configure (highlight domains, important headers, etc.) are stored using `chrome.storage.sync`, which Chrome may sync across your own signed-in devices. No one else can access this data.

## What the Extension Does Not Do

- **Does not transmit any data** to any server, including the developer's
- **Does not track** your browsing history or behavior
- **Does not store** any data beyond your current session's captures
- **Does not access** any page content beyond the network requests described above
- **Does not use** analytics, crash reporting, or any third-party services

## Exported Files

When you use the Export (⬆) or Report (📄) features, a file is saved to your local Downloads folder. That file stays on your device. The developer has no access to it and no knowledge that you created it.

## Permissions Explained

| Permission | Why it's needed |
|------------|----------------|
| `webRequest` | Observe outgoing network requests to detect SAML messages |
| `storage` | Save captures and settings locally on your device |
| `tabs` | Open the extension window and clear the badge when you navigate |
| `downloads` | Save the HTML report to your Downloads folder |
| `<all_urls>` | SAML SSO can occur on any domain — the extension must be able to observe requests to any URL |

## Contact

If you have questions about this privacy policy, open an issue on the project's GitHub repository or reach out via [Ko-fi](https://ko-fi.com/samldev).
