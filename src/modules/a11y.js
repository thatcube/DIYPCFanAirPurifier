// ═══════════════════════════════════════════════════════════════════
//  a11y.js — Shared accessibility utilities
//  Toggle-switch keyboard support, seg-button aria-pressed,
//  focus trapping for dialogs, focus restoration.
// ═══════════════════════════════════════════════════════════════════

// ─── Decorative icons ───────────────────────────────────────────
// Mark all Phosphor <i> icons as aria-hidden so screen readers skip them.
// They're always decorative — adjacent text provides the label.

export function initDecorativeIcons() {
  document.querySelectorAll('i[class*="ph"]').forEach(i => {
    i.setAttribute('aria-hidden', 'true');
  });
}

// ─── Toggle switches ────────────────────────────────────────────
// Make all .toggle-sw divs behave as proper ARIA switches:
//  role="switch", tabindex="0", aria-checked, Enter/Space activation.

export function initToggleSwitches() {
  document.querySelectorAll('.toggle-sw').forEach(sw => {
    sw.setAttribute('role', 'switch');
    sw.setAttribute('tabindex', '0');
    _syncToggleChecked(sw);

    sw.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sw.click(); // reuse existing onclick
      }
    });

    // Watch for class changes to keep aria-checked in sync.
    // The existing code toggles .on via classList — observe that.
    const obs = new MutationObserver(() => _syncToggleChecked(sw));
    obs.observe(sw, { attributes: true, attributeFilter: ['class'] });
  });
}

function _syncToggleChecked(sw) {
  sw.setAttribute('aria-checked', sw.classList.contains('on') ? 'true' : 'false');
}

// ─── Segmented buttons ──────────────────────────────────────────
// Mark .seg containers as toolbars and sync aria-pressed on children.

export function initSegButtons() {
  document.querySelectorAll('.seg').forEach(seg => {
    seg.setAttribute('role', 'toolbar');
    const buttons = seg.querySelectorAll('button');
    buttons.forEach(btn => {
      _syncPressed(btn);

      // Observe class toggles (the app sets .on via classList).
      const obs = new MutationObserver(() => _syncPressed(btn));
      obs.observe(btn, { attributes: true, attributeFilter: ['class'] });
    });
  });
}

function _syncPressed(btn) {
  btn.setAttribute('aria-pressed', btn.classList.contains('on') ? 'true' : 'false');
}

// ─── Focus trapping ─────────────────────────────────────────────
// trapFocus(container) — returns a release() function.
// Traps Tab / Shift+Tab within focusable elements inside container.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container) {
  function _handler(e) {
    if (e.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(FOCUSABLE)].filter(
      el => el.offsetParent !== null // visible
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  container.addEventListener('keydown', _handler);
  return { release: () => container.removeEventListener('keydown', _handler) };
}

// ─── Focus restoration ──────────────────────────────────────────
// saveFocus() → returns a restore() that re-focuses the saved element.

export function saveFocus() {
  const el = document.activeElement;
  return {
    restore() {
      if (el && typeof el.focus === 'function' && document.body.contains(el)) {
        el.focus();
      }
    }
  };
}

// ─── Clickable divs (role="button") ─────────────────────────────
// Add Enter/Space keyboard activation to any element with role="button".

export function initClickableDivs() {
  document.querySelectorAll('[role="button"][tabindex]').forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

// ─── Reduced motion query ───────────────────────────────────────
// Expose for JS animations (Three.js fan spin, coin bounce, etc.)

let _prefersReducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  _prefersReducedMotion = mq.matches;
  mq.addEventListener('change', e => { _prefersReducedMotion = e.matches; });
}

export function prefersReducedMotion() { return _prefersReducedMotion; }
