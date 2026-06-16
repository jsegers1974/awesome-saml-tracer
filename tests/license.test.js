import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLicenseValid, LICENSE_TTL_MS } from '../shared/license.js';

const NOW = 1_700_000_000_000;

describe('isLicenseValid', () => {
  test('false for null/undefined state', () => {
    assert.equal(isLicenseValid(null, NOW), false);
    assert.equal(isLicenseValid(undefined, NOW), false);
  });

  test('false when not valid', () => {
    assert.equal(isLicenseValid({ valid: false, checkedAt: NOW }, NOW), false);
  });

  test('false when checkedAt is missing or not a number', () => {
    assert.equal(isLicenseValid({ valid: true }, NOW), false);
    assert.equal(isLicenseValid({ valid: true, checkedAt: 'x' }, NOW), false);
  });

  test('true when valid and freshly checked', () => {
    assert.equal(isLicenseValid({ valid: true, checkedAt: NOW }, NOW), true);
  });

  test('true within the 24h TTL', () => {
    assert.equal(isLicenseValid({ valid: true, checkedAt: NOW - (LICENSE_TTL_MS - 1000) }, NOW), true);
  });

  test('false once the TTL has elapsed', () => {
    assert.equal(isLicenseValid({ valid: true, checkedAt: NOW - (LICENSE_TTL_MS + 1000) }, NOW), false);
  });
});
