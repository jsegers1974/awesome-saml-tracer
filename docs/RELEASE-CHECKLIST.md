# Release checklist (Chrome Web Store)

Run through this before building and uploading a new version.

## Ship-state flags (auto-enforced)

These are easy to leave in a testing state. `tests/release-guard.test.js` fails
the suite if either is wrong, so **`npm test` must be green** before release:

- [ ] `DEV_UNLOCK_PRO === false` in `shared/license.js` — otherwise Pro is unlocked for everyone.
- [ ] `REVIEW_NUDGE_THRESHOLD === 5` in `shared/review.js` — not lowered for testing.

## Steps

1. [ ] `npm test` is green (includes the guard above).
2. [ ] Bump `"version"` in `manifest.json` (must be higher than the published version).
3. [ ] If the popup/panel UI changed, refresh the website screenshots
       (`ast-help-*.png`) and the Chrome Web Store listing images.
4. [ ] Build the zip with `manifest.json` at the archive root and dev files excluded:
       ```
       cd awesome-saml-tracer
       zip -r ../awesome-saml-tracer-<version>.zip \
         manifest.json service_worker.js shared devtools popup viewer jwt icons \
         -x "*/.DS_Store" ".DS_Store"
       ```
       (Explicit includes => `node_modules`, `tests`, `docs`, `test-fixtures` are
       automatically left out.)
5. [ ] Sanity-check the archive: `unzip -l` shows `manifest.json` at the root, the
       correct version, and no `node_modules`/`tests`.
6. [ ] Upload in the developer dashboard → Package → submit for review.

## Notes

- The beta access code (`BETA_CODES` in `shared/license.js`) ships in the build on
  purpose — testers use it to unlock Pro. Rotate it if it leaks.
- Real, backend-validated license keys replace the dev/beta unlock at monetization
  launch (see the Pro features plan).
