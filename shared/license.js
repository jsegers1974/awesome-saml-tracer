// Pro entitlement gate.
//
// Real license validation (against a self-hosted endpoint, e.g. a Cloudflare
// Worker) lands at launch. For now this caches a validated license in
// chrome.storage.local with a 24-hour TTL and exposes a dev override so the Pro
// features can be built and tested before billing exists.
//
// The TTL logic is a pure function (isLicenseValid) so it can be unit-tested;
// the chrome.storage read (isPro) is browser-only and smoke-tested.

export const LICENSE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LICENSE_STORAGE_KEY = 'license';

// Dev override — unlock Pro features locally while building them.
// MUST remain false in shipped builds.
export const DEV_UNLOCK_PRO = false;

/**
 * Is a cached license state currently valid? Pure.
 * @param {{valid: boolean, checkedAt: number}|null|undefined} state
 * @param {number} now epoch ms
 */
export function isLicenseValid(state, now = Date.now()) {
  if (!state || state.valid !== true || typeof state.checkedAt !== 'number') return false;
  return now - state.checkedAt < LICENSE_TTL_MS;
}

/** Is the user entitled to Pro right now? Reads the cached license. */
export async function isPro() {
  if (DEV_UNLOCK_PRO) return true;
  try {
    const data = await chrome.storage.local.get(LICENSE_STORAGE_KEY);
    return isLicenseValid(data?.[LICENSE_STORAGE_KEY] ?? null);
  } catch {
    return false;
  }
}
