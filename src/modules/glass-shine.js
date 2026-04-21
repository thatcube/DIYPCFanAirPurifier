// ═══════════════════════════════════════════════════════════════════
//  glass-shine.js — Cursor-tracking shine + click ripple for glass
//  buttons. Uses CSS custom properties instead of overlay divs to
//  avoid backdrop-filter compositing issues.
// ═══════════════════════════════════════════════════════════════════

const SELECTOR = '.glass-btn, .pause-pill';

function _onMouseMove(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  el.style.setProperty('--mx', x + '%');
  el.style.setProperty('--my', y + '%');
}

function _onMouseLeave(e) {
  // Reset to center so the gradient fades gracefully
  e.currentTarget.style.removeProperty('--mx');
  e.currentTarget.style.removeProperty('--my');
}

function _onPointerDown(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Flash effect via a brief brightness bump
  el.style.filter = 'brightness(1.3)';
  setTimeout(() => { el.style.filter = ''; }, 120);
}

export function initGlassShine() {
  _attachAll();
  const obs = new MutationObserver(() => _attachAll());
  obs.observe(document.body, { childList: true, subtree: true });
}

function _attachAll() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    if (el._glassAttached) return;
    el._glassAttached = true;
    el.addEventListener('mousemove', _onMouseMove);
    el.addEventListener('mouseleave', _onMouseLeave);
    el.addEventListener('pointerdown', _onPointerDown);
  });
}
