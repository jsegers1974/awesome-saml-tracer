// Gentle, one-time "rate the extension" nudge.
//
// Policy-safe: shown only after the user has gotten value (captured a few SAML
// messages), dismissible, and never shown again once dismissed or acted on. No
// incentive, no nagging. The decision is a pure function (testable); the
// chrome.storage reads/writes are thin wrappers.

export const REVIEW_NUDGE_THRESHOLD = 5; // SAML captures before we ask
export const REVIEW_STORAGE_KEY = 'reviewNudge';
export const REVIEW_URL =
  'https://chromewebstore.google.com/detail/pilkjgooejhajccieiebbihilnclbpej/reviews';

/**
 * Should the nudge be shown? Pure.
 * @param {{dismissed?: boolean, rated?: boolean}|null|undefined} state
 * @param {number} captureCount - SAML captures the user has accumulated
 */
export function shouldShowReviewNudge(state, captureCount) {
  if (state && (state.dismissed || state.rated)) return false;
  return captureCount >= REVIEW_NUDGE_THRESHOLD;
}

async function getState() {
  try {
    const data = await chrome.storage.local.get(REVIEW_STORAGE_KEY);
    return data?.[REVIEW_STORAGE_KEY] ?? null;
  } catch {
    return null;
  }
}

async function patchState(patch) {
  try {
    const current = (await getState()) ?? {};
    await chrome.storage.local.set({ [REVIEW_STORAGE_KEY]: { ...current, ...patch } });
  } catch { /* ignore */ }
}

/** Async convenience: read state and decide. */
export async function shouldShowReviewNudgeNow(captureCount) {
  return shouldShowReviewNudge(await getState(), captureCount);
}

/** User clicked "Rate" — never ask again. */
export const markReviewRated = () => patchState({ rated: true });

/** User dismissed the nudge — never ask again. */
export const markReviewDismissed = () => patchState({ dismissed: true });
