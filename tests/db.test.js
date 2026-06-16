import 'fake-indexeddb/auto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  openDb, put, get, getAll, getAllByIndex, del, clear, _resetForTests, SCHEMA,
} from '../shared/db.js';

// Fresh database per test: new factory + drop the module's cached connection.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

describe('openDb', () => {
  test('creates all three stores', async () => {
    const db = await openDb();
    for (const name of Object.keys(SCHEMA)) {
      assert.ok(db.objectStoreNames.contains(name), `missing store: ${name}`);
    }
  });
});

describe('metadata store (keyed by entityID)', () => {
  test('put then get round-trips', async () => {
    await put('metadata', { entityID: 'https://idp.example.com', role: 'idp', rawXml: '<x/>' });
    const got = await get('metadata', 'https://idp.example.com');
    assert.equal(got.role, 'idp');
    assert.equal(got.rawXml, '<x/>');
  });

  test('put with the same key overwrites', async () => {
    await put('metadata', { entityID: 'e', rawXml: 'a' });
    await put('metadata', { entityID: 'e', rawXml: 'b' });
    const all = await getAll('metadata');
    assert.equal(all.length, 1);
    assert.equal(all[0].rawXml, 'b');
  });

  test('get returns undefined for a missing key', async () => {
    assert.equal(await get('metadata', 'nope'), undefined);
  });

  test('del removes a record', async () => {
    await put('metadata', { entityID: 'e', rawXml: 'a' });
    await del('metadata', 'e');
    assert.equal(await get('metadata', 'e'), undefined);
  });
});

describe('baselines store (auto-keyed, indexed by entityId)', () => {
  test('auto-assigns keys and lists all', async () => {
    await put('baselines', { entityId: 'idp-1', label: 'A' });
    await put('baselines', { entityId: 'idp-1', label: 'B' });
    await put('baselines', { entityId: 'idp-2', label: 'C' });
    const all = await getAll('baselines');
    assert.equal(all.length, 3);
    assert.ok(all.every(b => typeof b.id === 'number'));
  });

  test('getAllByIndex returns only matching entityId (many baselines per SSO)', async () => {
    await put('baselines', { entityId: 'idp-1', label: 'A' });
    await put('baselines', { entityId: 'idp-1', label: 'B' });
    await put('baselines', { entityId: 'idp-2', label: 'C' });
    const forIdp1 = await getAllByIndex('baselines', 'entityId', 'idp-1');
    assert.equal(forIdp1.length, 2);
    assert.deepEqual(forIdp1.map(b => b.label).sort(), ['A', 'B']);
  });
});

describe('clear', () => {
  test('empties a store', async () => {
    await put('keystore', { id: 'k1', name: 'key.pem' });
    await clear('keystore');
    assert.deepEqual(await getAll('keystore'), []);
  });
});
