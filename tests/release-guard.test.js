import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_UNLOCK_PRO } from '../shared/license.js';
import { REVIEW_NUDGE_THRESHOLD } from '../shared/review.js';

// Guards ship-state invariants that are easy to leave flipped after local
// testing. If either fails, `npm test` fails — the build must not go out.
// See docs/RELEASE-CHECKLIST.md.
describe('release guard', () => {
  test('DEV_UNLOCK_PRO is false (Pro must not be unlocked for everyone)', () => {
    assert.equal(DEV_UNLOCK_PRO, false);
  });

  test('REVIEW_NUDGE_THRESHOLD is the shipping value (5), not a test value', () => {
    assert.equal(REVIEW_NUDGE_THRESHOLD, 5);
  });
});
