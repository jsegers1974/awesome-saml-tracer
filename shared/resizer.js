export function initResizer(resizerEl, leftEl, storageKey = 'pane-width') {
  const saved = localStorage.getItem(storageKey);
  if (saved) leftEl.style.width = saved;

  let startX, startW;

  resizerEl.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = leftEl.offsetWidth;
    resizerEl.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  function onMove(e) {
    const w = Math.max(160, Math.min(startW + e.clientX - startX, window.innerWidth - 240));
    leftEl.style.width = w + 'px';
  }

  function onUp() {
    resizerEl.classList.remove('dragging');
    localStorage.setItem(storageKey, leftEl.style.width);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}
