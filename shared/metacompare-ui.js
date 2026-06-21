// MetaCompare UI mount — shared by the popup and the devtools panel.
//
// mountMetaCompare(container, summary) renders the MetaCompare section into
// `container` for the given assertion summary: gated by the Pro license, it
// compares the assertion against any stored metadata and lets the user add or
// clear metadata (parsed/persisted per entityID). All the pure logic
// (parse/compare/render) is tested elsewhere; this is the browser glue.

import { isPro } from './license.js';
import { metaCompare } from './metacompare.js';
import { renderMetaCompare, escape } from './render.js';
import { saveMetadata, loadMetadataForCompare, clearMetadata } from './metadata-store.js';

/**
 * @param {HTMLElement} container - a fresh element owned by the current selection
 * @param {object} summary - summarizeSaml output for the selected capture
 */
export async function mountMetaCompare(container, summary) {
  // Pro-gated: free users see nothing here.
  if (!(await isPro())) { container.innerHTML = ''; return; }

  let error = '';

  async function refresh() {
    const meta = await loadMetadataForCompare();
    const hasMeta = meta.entities.length > 0;
    const body = hasMeta
      ? renderMetaCompare(metaCompare(summary, meta))
      : '<p class="empty">Add the IdP and/or SP metadata for this SSO to see why it does or doesn\'t match.</p>';

    container.innerHTML = `
      <div class="mc-section">
        <div class="mc-bar">
          <h3>MetaCompare</h3>
          <span class="mc-bar-actions">
            <button type="button" class="ghost mc-add">Add metadata…</button>
            ${hasMeta ? '<button type="button" class="ghost mc-clear">Clear</button>' : ''}
          </span>
          <input type="file" class="mc-file" accept=".xml,application/xml,text/xml" hidden>
        </div>
        ${error ? `<p class="error">${escape(error)}</p>` : ''}
        ${body}
      </div>`;

    const fileInput = container.querySelector('.mc-file');
    container.querySelector('.mc-add').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const result = await saveMetadata(await file.text());
        error = result.error ? `Could not parse "${file.name}": ${result.error}` : '';
      } catch (e) {
        error = `Could not read "${file.name}": ${e.message}`;
      }
      await refresh();
    });
    container.querySelector('.mc-clear')?.addEventListener('click', async () => {
      await clearMetadata();
      error = '';
      await refresh();
    });
  }

  await refresh();
}
