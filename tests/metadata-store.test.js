import 'fake-indexeddb/auto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { _resetForTests } from '../shared/db.js';
import {
  saveMetadata, listMetadata, deleteMetadata, clearMetadata, loadMetadataForCompare,
} from '../shared/metadata-store.js';

const { window } = new JSDOM('');
globalThis.DOMParser = window.DOMParser;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

const IDP = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com"><md:IDPSSODescriptor/></md:EntityDescriptor>`;
const SP = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://sp.example.com"><md:SPSSODescriptor/></md:EntityDescriptor>`;

describe('metadata-store', () => {
  test('saveMetadata persists one record per entity', async () => {
    await saveMetadata(IDP);
    const all = await listMetadata();
    assert.equal(all.length, 1);
    assert.equal(all[0].entityID, 'https://idp.example.com');
    assert.equal(all[0].role, 'idp');
  });

  test('separately-uploaded IdP and SP files accumulate', async () => {
    await saveMetadata(IDP);
    await saveMetadata(SP);
    const all = await listMetadata();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map(r => r.role).sort(), ['idp', 'sp']);
  });

  test('re-uploading the same entityID overwrites, not duplicates', async () => {
    await saveMetadata(IDP);
    await saveMetadata(IDP);
    assert.equal((await listMetadata()).length, 1);
  });

  test('loadMetadataForCompare returns the {entities} shape metaCompare expects', async () => {
    await saveMetadata(IDP);
    await saveMetadata(SP);
    const meta = await loadMetadataForCompare();
    assert.ok(Array.isArray(meta.entities));
    assert.ok(meta.entities.some(e => e.idp));
    assert.ok(meta.entities.some(e => e.sp));
  });

  test('deleteMetadata removes one entity', async () => {
    await saveMetadata(IDP);
    await saveMetadata(SP);
    await deleteMetadata('https://idp.example.com');
    const all = await listMetadata();
    assert.equal(all.length, 1);
    assert.equal(all[0].entityID, 'https://sp.example.com');
  });

  test('clearMetadata empties the store', async () => {
    await saveMetadata(IDP);
    await clearMetadata();
    assert.deepEqual(await listMetadata(), []);
  });

  test('garbage metadata is not stored and returns a parse error', async () => {
    const r = await saveMetadata('not xml <<<');
    assert.ok(r.error);
    assert.deepEqual(await listMetadata(), []);
  });
});
