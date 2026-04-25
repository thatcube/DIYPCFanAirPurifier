// ─── UI Micro-interactions ──────────────────────────────────────────
// Spring-physics-inspired bounce/pop/shake effects.
// Call these from event handlers to add fluid motion to any element.

/**
 * Trigger a bounce animation on an element.
 * @param {HTMLElement} el
 * @param {number} [scale=1.12] - peak scale
 */
export function bounce(el, scale = 1.12) {
  if (!el) return;
  el.style.transition = 'none';
  el.style.transform = `scale(${scale})`;
  requestAnimationFrame(() => {
    el.style.transition = 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = 'scale(1)';
  });
}

/**
 * Pop an element in with scale + opacity.
 */
export function popIn(el) {
  if (!el) return;
  el.classList.remove('pop-in');
  void el.offsetWidth; // force reflow
  el.classList.add('pop-in');
}

/**
 * Shake an element (error feedback).
 */
export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/**
 * Apply a temporary CSS class then remove it after the animation.
 */
export function animateClass(el, cls, durationMs = 450) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), durationMs);
}

/**
 * Toggle a segmented button group — sets .on on the clicked button,
 * removes from siblings, with a bounce effect.
 * @param {string} groupSelector - CSS selector for the .seg container
 * @param {HTMLElement|string} activeBtn - the button to activate (or its ID)
 */
export function segSelect(groupSelector, activeBtn) {
  const group = typeof groupSelector === 'string'
    ? document.querySelector(groupSelector)
    : groupSelector;
  if (!group) return;
  const btn = typeof activeBtn === 'string'
    ? document.getElementById(activeBtn)
    : activeBtn;
  if (!btn) return;

  group.querySelectorAll('button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  bounce(btn, 1.08);
}

/**
 * Toggle a switch element with bounce feedback.
 * @param {HTMLElement|string} el - the .toggle-sw element or its ID
 * @returns {boolean} new state (true = on)
 */
export function toggleSwitch(el) {
  const sw = typeof el === 'string' ? document.getElementById(el) : el;
  if (!sw) return false;
  const isOn = sw.classList.toggle('on');
  bounce(sw, 1.06);
  return isOn;
}

/**
 * Coin bump — triggers the bounce animation on the coin HUD.
 */
export function coinBump() {
  const hud = document.getElementById('coinHud');
  if (hud) animateClass(hud, 'bump', 400);
}

/**
 * Secret coin bump — spawns a body-level particle burst anchored to the
 * secret-coin chip. The chip is nested two containers deep inside the
 * combo run pill, so animating its parents was scaling unrelated layout
 * and clipping the glow. This effect lives on a fixed-position overlay
 * appended to <body> so it can sparkle freely outside that hierarchy.
 */
export function secretCoinBump() {
  const chip = document.getElementById('secretCoinHud');
  if (!chip) return;

  // Tiny chip pop so the number itself reacts.
  animateClass(chip, 'pop', 500);

  // Locate chip in viewport coords; bail if it's hidden / off-screen.
  const r = chip.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // Respect reduced-motion users — give them a single soft flash, no spray.
  const reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const burst = document.createElement('div');
  burst.className = 'secret-burst';
  burst.style.left = cx + 'px';
  burst.style.top  = cy + 'px';

  // Radial flash disc behind the sparks.
  const flash = document.createElement('div');
  flash.className = 'secret-burst__flash';
  burst.appendChild(flash);

  // Expanding ring.
  const ring = document.createElement('div');
  ring.className = 'secret-burst__ring';
  burst.appendChild(ring);

  // Floating "+1" rising upward.
  const plus = document.createElement('div');
  plus.className = 'secret-burst__plus';
  plus.textContent = '+1';
  burst.appendChild(plus);

  // Sparks fly out radially with random distance / size / hue.
  if (!reduced) {
    const SPARK_COUNT = 14;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const s = document.createElement('div');
      s.className = 'secret-burst__spark';
      // Even angular distribution + small jitter so it doesn't look gridded.
      const angle = (i / SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist  = 38 + Math.random() * 38;       // 38–76px travel
      const size  = 4 + Math.random() * 4;         // 4–8px
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      // Cyan family with occasional white-hot spark.
      const hue = 195 + Math.random() * 25;
      const light = 60 + Math.random() * 25;
      const color = Math.random() < 0.18
        ? '#ffffff'
        : `hsl(${hue}, 100%, ${light}%)`;
      s.style.setProperty('--dx', dx + 'px');
      s.style.setProperty('--dy', dy + 'px');
      s.style.setProperty('--sz', size + 'px');
      s.style.setProperty('--c',  color);
      s.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      s.style.animationDelay = (Math.random() * 60) + 'ms';
      burst.appendChild(s);
    }
  }

  document.body.appendChild(burst);

  // Cleanup after the longest animation completes.
  setTimeout(() => { burst.remove(); }, 1200);
}

/**
 * Wire all interactive elements with passive bounce effects.
 * Call once after DOM is ready.
 */
export function initInteractions() {
  // All seg buttons get a subtle press effect
  document.querySelectorAll('.seg button').forEach(btn => {
    btn.addEventListener('pointerdown', () => {
      btn.style.transform = 'scale(0.92)';
    });
    btn.addEventListener('pointerup', () => {
      btn.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
      btn.style.transform = '';
      setTimeout(() => { btn.style.transition = ''; }, 350);
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.transform = '';
    });
  });

  // Toggle switches get press squish
  document.querySelectorAll('.toggle-sw').forEach(sw => {
    sw.addEventListener('pointerdown', () => {
      sw.style.transform = 'scale(0.9)';
    });
    sw.addEventListener('pointerup', () => {
      sw.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.25s';
      sw.style.transform = '';
      setTimeout(() => { sw.style.transition = ''; }, 400);
    });
  });

  // Play button press
  const playBtn = document.getElementById('playDockBtn');
  if (playBtn) {
    playBtn.addEventListener('pointerdown', () => {
      playBtn.style.transform = 'translateX(-50%) scale(0.94)';
    });
    playBtn.addEventListener('pointerup', () => {
      playBtn.style.transform = '';
    });
  }
}
