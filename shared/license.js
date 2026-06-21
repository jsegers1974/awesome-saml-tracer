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

export const BETA_STORAGE_KEY = 'beta';

// Beta access codes — shareable with real-world testers so they can unlock Pro
// without buying it, on a single public build. The code is in the client and
// therefore discoverable; this is intentional for a closed pre-launch beta
// (rotate by shipping a new code). Replaced by backend-validated keys at launch.
export const BETA_CODES = ['AST-BETA-2026'];

const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

/** Does this string match a beta access code? Pure. */
export function isBetaCodeValid(code) {
  const c = normalizeCode(code);
  return !!c && BETA_CODES.map(normalizeCode).includes(c);
}

/**
 * Is a cached license state currently valid? Pure.
 * @param {{valid: boolean, checkedAt: number}|null|undefined} state
 * @param {number} now epoch ms
 */
export function isLicenseValid(state, now = Date.now()) {
  if (!state || state.valid !== true || typeof state.checkedAt !== 'number') return false;
  return now - state.checkedAt < LICENSE_TTL_MS;
}

/** Is the user entitled to Pro right now? Dev override, beta unlock, or license. */
export async function isPro() {
  if (DEV_UNLOCK_PRO) return true;
  try {
    const data = await chrome.storage.local.get([LICENSE_STORAGE_KEY, BETA_STORAGE_KEY]);
    if (data?.[BETA_STORAGE_KEY] === true) return true;
    return isLicenseValid(data?.[LICENSE_STORAGE_KEY] ?? null);
  } catch {
    return false;
  }
}

/** Has a beta code been activated on this machine? */
export async function isBetaActive() {
  try {
    const data = await chrome.storage.local.get(BETA_STORAGE_KEY);
    return data?.[BETA_STORAGE_KEY] === true;
  } catch {
    return false;
  }
}

/** Validate and activate a beta code (no expiry). Returns whether it worked. */
export async function redeemBetaCode(code) {
  if (!isBetaCodeValid(code)) return false;
  try {
    await chrome.storage.local.set({ [BETA_STORAGE_KEY]: true });
    return true;
  } catch {
    return false;
  }
}

/** Turn off a beta unlock on this machine. */
export async function deactivateBeta() {
  try {
    await chrome.storage.local.remove(BETA_STORAGE_KEY);
  } catch { /* ignore */ }
}
