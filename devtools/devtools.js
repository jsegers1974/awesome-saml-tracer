// Registers the SAML panel inside Chrome DevTools.
chrome.devtools.panels.create(
  'SAML',
  null,
  'devtools/panel.html',
  () => { /* panel created */ }
);
