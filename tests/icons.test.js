import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ICONS } from '../shared/icons.js';

// Names the popup wires up — keep in sync with the icon mapping in the plan.
const REQUIRED = [
  'pause', 'play', 'trash-2', 'download', 'upload', 'file-text',
  'settings', 'globe', 'coffee', 'copy', 'check', 'x',
  'circle-help', 'external-link',
];

describe('ICONS', () => {
  test('exposes every icon the popup uses', () => {
    for (const name of REQUIRED) {
      assert.ok(name in ICONS, `missing icon: ${name}`);
    }
  });

  test('every icon is a complete, well-formed <svg> string', () => {
    for (const [name, markup] of Object.entries(ICONS)) {
      assert.equal(typeof markup, 'string', `${name} is not a string`);
      assert.match(markup, /^<svg[\s\S]*<\/svg>$/, `${name} is not a full <svg> element`);
    }
  });

  test('icons use currentColor so they inherit button color / dark mode', () => {
    for (const [name, markup] of Object.entries(ICONS)) {
      assert.match(markup, /stroke="currentColor"/, `${name} should stroke with currentColor`);
    }
  });

  test('icons are hidden from the accessibility tree (buttons carry the label)', () => {
    for (const [name, markup] of Object.entries(ICONS)) {
      assert.match(markup, /aria-hidden="true"/, `${name} should be aria-hidden`);
    }
  });
});
