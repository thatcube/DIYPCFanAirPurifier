// loading-tips.js
// Rotating loading messages for the home splash and settings overlay.
// splash and the settings overlay while the bg /play iframe scene is
// still booting. Mirrors the way Discord rotates fun copy under its
// loader so the wait reads as friendly rather than blank.
//
// Usage:
//   <script src="/loading-tips.js" defer></script>
//   ...
//   window.attachLoadingTips(document.getElementById('myTipEl'));
//
// The element's textContent is rotated through TIPS at INTERVAL ms,
// using a brief opacity+blur crossfade per swap (per Emil Kowalski's
// "blur as a transition material" tip — see CLAUDE.md). Idempotent:
// calling attachLoadingTips twice on the same element no-ops.
//
// detach() returned from attachLoadingTips clears the timer; useful
// when SPA-navigating away mid-rotation. Otherwise the rotator just
// keeps running quietly behind a hidden parent — cheap.
(function () {
    const TIPS = [
        // Avatar / Korra
        'Bending elements…',
        'Consulting Korra…',
        'Asking Uncle Iroh…',
        // Dragon Ball Z
        'Going Super Saiyan…',
        "It's over 9000…",
        'Powering up…',
        // Fireballs
        'Loading fireballs…',
        // Coins
        'Counting the coins…',
        'Hiding the coins…',
        // Speedrunning
        'Optimizing routes…',
        'Skipping cutscenes…',
        'Any% speedrun…',
        // Pokémon
        'Catching Pikachu…',
        'Wild encounter…',
        // Guitar Hero
        'Star power ready…',
    ];

    const INTERVAL = 2400; // ms between swaps
    const FADE_MS = 260;   // half-cycle: out OR in (total swap = 2x)
    const LIFT_PX = 10;    // vertical travel for slot-machine roll

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function attachLoadingTips(el, opts) {
        if (!el || el.dataset.tipsAttached === '1') return () => { };
        el.dataset.tipsAttached = '1';

        // Slot-machine roll between tips: outgoing slides UP and blurs
        // out, incoming rises from BELOW into focus. Both phases use the
        // same easing (Linear-ish ease-out) so the swap reads as one
        // continuous lift rather than two separate motions. Per Emil
        // Kowalski's "blur as transition material" + the project's
        // motion language in main.css. Honors prefers-reduced-motion.
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const easing = 'cubic-bezier(.32,.72,0,1)';
        if (reduceMotion) {
            el.style.transition = `opacity ${FADE_MS}ms ease`;
        } else {
            el.style.transition =
                `opacity ${FADE_MS}ms ${easing}, ` +
                `transform ${FADE_MS}ms ${easing}, ` +
                `filter ${FADE_MS}ms ${easing}`;
        }
        el.style.willChange = 'transform, filter, opacity';

        // Pre-shuffled queue so visits don't always start with the same
        // tip. We refill from a fresh shuffle when the queue empties.
        let queue = shuffle(TIPS);
        let idx = 0;

        function next() {
            if (idx >= queue.length) {
                queue = shuffle(TIPS);
                idx = 0;
            }
            return queue[idx++];
        }

        // Seed: first tip paints immediately, no entrance animation —
        // the parent loading container handles its own entrance.
        el.textContent = next();

        let timer = 0;
        function step() {
            if (reduceMotion) {
                // Skip the slot-machine roll for users who opted out of
                // motion — just swap the text with a quick opacity fade.
                el.style.opacity = '0';
                setTimeout(() => {
                    el.textContent = next();
                    el.style.opacity = '1';
                }, FADE_MS);
                return;
            }
            // Phase 1: lift the outgoing tip up + blur it out.
            el.style.opacity = '0';
            el.style.filter = 'blur(6px)';
            el.style.transform = `translateY(-${LIFT_PX}px)`;
            setTimeout(() => {
                // Mid-swap: snap to the start of the incoming tip's roll —
                // BELOW the baseline, blurred, transparent — without any
                // transition (we briefly suppress it), then on the next
                // frame we re-enable transitions and roll into place.
                const prev = el.style.transition;
                el.style.transition = 'none';
                el.textContent = next();
                el.style.transform = `translateY(${LIFT_PX}px)`;
                // Force a reflow so the no-transition jump is committed
                // before we re-enable transitions for the rise.
                // eslint-disable-next-line no-unused-expressions
                el.offsetHeight;
                el.style.transition = prev;
                // Phase 2: rise into focus.
                el.style.opacity = '1';
                el.style.filter = 'blur(0)';
                el.style.transform = 'translateY(0)';
            }, FADE_MS);
        }

        timer = setInterval(step, INTERVAL);

        function detach() {
            if (!timer) return;
            clearInterval(timer);
            timer = 0;
            el.dataset.tipsAttached = '0';
        }

        // Pause when the tab is hidden so we're not running a background
        // timer for content the user can't see.
        function onVis() {
            if (document.hidden) {
                if (timer) { clearInterval(timer); timer = 0; }
            } else if (!timer) {
                timer = setInterval(step, INTERVAL);
            }
        }
        document.addEventListener('visibilitychange', onVis);

        // Auto-detach when the element leaves the DOM.
        if (typeof MutationObserver !== 'undefined') {
            const mo = new MutationObserver(() => {
                if (!el.isConnected) {
                    detach();
                    document.removeEventListener('visibilitychange', onVis);
                    mo.disconnect();
                }
            });
            mo.observe(document.body, { childList: true, subtree: true });
        }

        return detach;
    }

    window.attachLoadingTips = attachLoadingTips;
})();
