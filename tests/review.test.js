import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowReviewNudge, REVIEW_NUDGE_THRESHOLD } from '../shared/review.js';

describe('shouldShowReviewNudge', () => {
  const T = REVIEW_NUDGE_THRESHOLD;

  test('hidden below the capture threshold', () => {
    assert.equal(shouldShowReviewNudge(null, T - 1), false);
  });

  test('shown at or above the threshold (fresh state)', () => {
    assert.equal(shouldShowReviewNudge(null, T), true);
    assert.equal(shouldShowReviewNudge(undefined, T + 10), true);
  });

  test('never shown once dismissed', () => {
    assert.equal(shouldShowReviewNudge({ dismissed: true }, T + 100), false);
  });

  test('never shown once rated', () => {
    assert.equal(shouldShowReviewNudge({ rated: true }, T + 100), false);
  });

  test('an empty state object still respects the threshold', () => {
    assert.equal(shouldShowReviewNudge({}, T - 1), false);
    assert.equal(shouldShowReviewNudge({}, T), true);
  });
});
