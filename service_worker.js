// MV3 service worker. Listeners are registered at top level so they survive worker restarts.

const STORE_KEY = 'captures';
const MAX_CAPTURES = 200;
const NETWORK_KEY = 'network';
const MAX_NETWORK = 500;

// Only track request types that are meaningful for an SSO flow.
const TRACKED_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest'];

// Track the floating app window so we focus it instead of opening a second one.
// This is a best-effort in-memory reference; a worker restart will open a fresh window.
let appWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (appWindowId != null) {
    try {
      await chrome.windows.update(appWindowId, { focused: true });
      return;
    } catch (_) {
      appWindowId = null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup/popup.html'),
    type: 'popup',
    width: 960,
    height: 700,
  });
  appWindowId = win.id;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === appWindowId) appWindowId = null;
});

const SAML_URL_PARAM = /(?:^|[?&])SAML(?:Request|Response)=/;

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const entry = inspectRequest(details);
      if (entry) saveCapture(entry);
    } catch (e) {
      console.error('[awesome-saml-tracer] capture error', e);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    try {
      saveNetworkEntry({
        id: `net-${details.timeStamp}-${details.requestId}`,
        requestId: details.requestId,
        timestamp: details.timeStamp,
        method: details.method,
        url: details.url,
        type: details.type,
        tabId: details.tabId,
        statusCode: details.statusCode,
        statusLine: details.statusLine,
      });
    } catch (e) {
      console.error('[awesome-saml-tracer] network capture error', e);
    }
  },
  { urls: ['<all_urls>'], types: TRACKED_TYPES }
);

// Reset the badge for a tab when its top-level URL changes, so the count reflects the current flow.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'list-captures':
      chrome.storage.local.get(STORE_KEY).then(data => {
        sendResponse({ captures: data[STORE_KEY] || [] });
      });
      return true;
    case 'list-network':
      chrome.storage.local.get(NETWORK_KEY).then(data => {
        sendResponse({ network: data[NETWORK_KEY] || [] });
      });
      return true;
    case 'clear-captures':
      chrome.storage.local.set({ [STORE_KEY]: [], [NETWORK_KEY]: [] }).then(() => {
        // Clear badges for all tabs we know about.
        chrome.tabs.query({}).then(tabs => {
          for (const t of tabs) chrome.action.setBadgeText({ text: '', tabId: t.id }).catch(() => {});
        });
        sendResponse({ ok: true });
      });
      return true;
    default:
      return;
  }
});

function inspectRequest(details) {
  const { url, method, requestBody } = details;

  // Redirect binding — payload is in the URL.
  if (SAML_URL_PARAM.test(url)) {
    const u = safeUrl(url);
    return makeEntry(details, {
      source: 'url',
      samlRequest: u?.searchParams.get('SAMLRequest') || null,
      samlResponse: u?.searchParams.get('SAMLResponse') || null,
      relayState: u?.searchParams.get('RelayState') || null
    });
  }

  // POST binding — payload is in form data.
  if (method === 'POST' && requestBody) {
    const fd = requestBody.formData;
    if (fd && (fd.SAMLRequest || fd.SAMLResponse)) {
      return makeEntry(details, {
        source: 'form',
        samlRequest: fd.SAMLRequest?.[0] || null,
        samlResponse: fd.SAMLResponse?.[0] || null,
        relayState: fd.RelayState?.[0] || null
      });
    }
    // Some IdPs send raw bodies; sniff for SAML param in raw bytes.
    if (requestBody.raw && Array.isArray(requestBody.raw)) {
      const text = decodeRawBody(requestBody.raw);
      if (text && SAML_URL_PARAM.test(text)) {
        const params = new URLSearchParams(text);
        return makeEntry(details, {
          source: 'raw',
          samlRequest: params.get('SAMLRequest'),
          samlResponse: params.get('SAMLResponse'),
          relayState: params.get('RelayState')
        });
      }
    }
  }
  return null;
}

function makeEntry(details, extra) {
  return {
    id: `${details.timeStamp}-${details.requestId}`,
    requestId: details.requestId,
    timestamp: details.timeStamp,
    method: details.method,
    url: details.url,
    type: details.type,
    tabId: details.tabId,
    ...extra
  };
}

async function saveCapture(entry) {
  const data = await chrome.storage.local.get(STORE_KEY);
  const list = data[STORE_KEY] || [];
  list.push(entry);
  while (list.length > MAX_CAPTURES) list.shift();
  await chrome.storage.local.set({ [STORE_KEY]: list });

  if (entry.tabId >= 0) {
    const tabCount = list.filter(e => e.tabId === entry.tabId).length;
    chrome.action.setBadgeText({ text: String(tabCount), tabId: entry.tabId }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#3367d6' }).catch(() => {});
  }

  // Best-effort broadcast to any open panels.
  chrome.runtime.sendMessage({ type: 'capture-added', entry }).catch(() => {});
}

async function saveNetworkEntry(entry) {
  const data = await chrome.storage.local.get(NETWORK_KEY);
  const list = data[NETWORK_KEY] || [];
  list.push(entry);
  while (list.length > MAX_NETWORK) list.shift();
  await chrome.storage.local.set({ [NETWORK_KEY]: list });
  chrome.runtime.sendMessage({ type: 'network-added', entry }).catch(() => {});
}

function safeUrl(s) {
  try { return new URL(s); } catch { return null; }
}

function decodeRawBody(raw) {
  try {
    const chunks = raw.map(r => r.bytes ? new Uint8Array(r.bytes) : new Uint8Array());
    let total = 0;
    for (const c of chunks) total += c.byteLength;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  } catch {
    return null;
  }
}
