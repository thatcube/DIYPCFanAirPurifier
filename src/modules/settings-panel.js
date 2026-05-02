// settings-panel.js
// Single Settings UI used by the pause overlay and (later) the home page.
// Schema-driven: every control is one row in TABS[]. The panel renders
// the markup but reuses the existing element IDs so that all the
// existing _syncPause*/_apply* code in main.js + game-fp.js keeps
// working unchanged. This file only owns layout, tab routing, and search.

// ────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────
//
// Each control is rendered into one or more tabs. Set `tabs: [...]` to
// mirror a control across multiple tabs (e.g. FOV in both Controls and
// Display). Mirrored rows get a unique ID per occurrence; on input
// from any occurrence we forward to the canonical setter and then
// sync sibling rows so they don't drift.
//
// Search filters rows by `label + keywords`. Keep keywords short.
//
// Row types:
//   - toggle  → on/off switch (uses existing .toggle-sw markup)
//   - slider  → range input
//   - inline  → an inline button on the right side (e.g. Camera switch)
//   - link    → footer-style link button (e.g. Inspect air purifier)
//
// To add a new setting later: add one entry here. Done.

const TABS = [
  { id: 'display',     label: 'Display',     icon: 'ph ph-monitor' },
  { id: 'audio',       label: 'Audio',       icon: 'ph ph-speaker-high' },
  { id: 'controls',    label: 'Controls',    icon: 'ph ph-mouse' },
  { id: 'performance', label: 'Performance', icon: 'ph ph-lightning' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'ph ph-bug' },
];

const CONTROLS = [
  // ── Display ──────────────────────────────────────────────────────
  // Atmosphere / viewing rows that affect the look of the scene.
  // Pure perf knobs (resolution scaler, runtime profile, content sim
  // toggles) live on the Performance tab. Debug-only rows (FPS,
  // input HUD, wall labels) live on the Diagnostics tab.
  {
    id: 'fpPauseShowMphRow', tabs: ['display'], type: 'toggle',
    label: 'Show MPH', icon: 'ph ph-speedometer',
    keywords: 'speed skate skateboard hud',
    rowId: 'fpPauseShowMphRow', // game-fp.js shows/hides this row
    rowHidden: true,
    swId: 'fpPauseShowMph', stateId: 'fpPauseShowMphState',
    onclick: '_toggleMph',
    initialOn: true,
  },
  {
    id: 'fpPausePerfWindowSun', tabs: ['display'], type: 'toggle',
    label: 'Outside window sunlight', icon: 'ph ph-sun',
    keywords: 'lighting sun window',
    swId: 'fpPausePerfWindowSun', stateId: 'fpPausePerfWindowSunState',
    onclick: '_togglePerfWindowSun',
    initialOn: true,
  },
  {
    id: 'fpPausePerfShadows', tabs: ['display'], type: 'toggle',
    label: 'Shadows', icon: 'ph ph-sun-dim',
    keywords: 'lighting shadow casting quality',
    swId: 'fpPausePerfShadows', stateId: 'fpPausePerfShadowsState',
    onclick: '_togglePerfShadows',
    initialOn: true,
  },
  {
    id: 'fpPausePerfFog', tabs: ['display'], type: 'toggle',
    label: 'Fog', icon: 'ph ph-cloud',
    keywords: 'atmosphere depth haze',
    swId: 'fpPausePerfFog', stateId: 'fpPausePerfFogState',
    onclick: '_togglePerfFog',
    initialOn: true,
  },
  // FOV mirror — canonical row is in Controls. Hidden from search
  // results so the same setting doesn't appear twice when filtering.
  {
    id: 'fpPauseFovDisplayMirror', tabs: ['display'], type: 'slider',
    label: 'Field of view', icon: 'ph ph-binoculars',
    keywords: 'fov field view zoom camera',
    rangeId: 'fpPauseFovMirror', valId: 'fpPauseFovMirrorVal',
    min: 55, max: 130, step: 1, value: 85,
    aria: 'Field of view',
    oninput: '_setFov',
    mirrorOf: 'fpPauseFov',
    hideInSearch: true,
    initialLabel: '85°',
  },

  // ── Performance ─────────────────────────────────────────────────
  {
    id: 'fpPausePerfResolution', tabs: ['performance'], type: 'toggle',
    label: 'Resolution scaler', icon: 'ph ph-arrows-out',
    hint: 'Independent resolution scaler for first-person gameplay.',
    keywords: 'render resolution dpr pixel ratio sharpness blur performance',
    swId: 'fpPausePerfResolution', stateId: 'fpPausePerfResolutionState',
    onclick: '_toggleFpPerfResolution',
    initialOn: true,
  },
  {
    id: 'fpPausePerfResolutionScale', tabs: ['performance'], type: 'slider',
    label: 'Render scale', icon: 'ph ph-crop',
    keywords: 'resolution dpr quality sharpness percent performance',
    rangeId: 'fpPausePerfResolutionScale', valId: 'fpPausePerfResolutionScaleVal',
    min: 0.35, max: 1.2, step: 0.01, value: 0.68,
    aria: 'Render scale',
    oninput: '_setFpPerfResolutionScale',
    initialLabel: '68%',
  },
  {
    id: 'fpPausePerfFpProfile', tabs: ['performance'], type: 'toggle',
    label: 'Runtime perf knobs', icon: 'ph ph-rocket-launch',
    hint: 'Non-resolution runtime knobs for first-person mode.',
    keywords: 'performance budget shadow cadence quality',
    swId: 'fpPausePerfFpProfile', stateId: 'fpPausePerfFpProfileState',
    onclick: '_toggleFpPerfProfile',
    initialOn: true,
  },
  {
    id: 'fpPausePerfShadowCadence', tabs: ['performance'], type: 'slider',
    label: 'Shadow cadence', icon: 'ph ph-clock-countdown',
    keywords: 'shadow update interval frames performance fp',
    rangeId: 'fpPausePerfShadowCadence', valId: 'fpPausePerfShadowCadenceVal',
    min: 0, max: 120, step: 1, value: 0,
    aria: 'Shadow cadence',
    oninput: '_setFpPerfShadowCadence',
    initialLabel: 'Every frame',
  },
  {
    id: 'fpPausePerfFpsCap', tabs: ['performance'], type: 'slider',
    label: 'FPS cap', icon: 'ph ph-gauge',
    hint: 'Throttle frame rate to save power. 0 = unlimited.',
    keywords: 'fps frame rate cap limit throttle performance battery power',
    rangeId: 'fpPausePerfFpsCap', valId: 'fpPausePerfFpsCapVal',
    min: 0, max: 240, step: 15, value: 0,
    aria: 'FPS cap',
    oninput: '_setFpsCap',
    initialLabel: 'Unlimited',
  },
  {
    id: 'fpPausePerfCatAnim', tabs: ['performance'], type: 'toggle',
    label: 'Cat animation stack', icon: 'ph ph-cat',
    keywords: 'animation procedural cat character performance',
    swId: 'fpPausePerfCatAnim', stateId: 'fpPausePerfCatAnimState',
    onclick: '_togglePerfCatAnim',
    initialOn: true,
  },
  {
    id: 'fpPausePerfCoins', tabs: ['performance'], type: 'toggle',
    label: 'Coin simulation', icon: 'ph ph-coins',
    keywords: 'coin physics collectible performance',
    swId: 'fpPausePerfCoins', stateId: 'fpPausePerfCoinsState',
    onclick: '_togglePerfCoins',
    initialOn: true,
  },
  {
    id: 'fpPausePerfPurifier', tabs: ['performance'], type: 'toggle',
    label: 'Purifier animation', icon: 'ph ph-fan',
    keywords: 'fan air purifier animation performance',
    swId: 'fpPausePerfPurifier', stateId: 'fpPausePerfPurifierState',
    onclick: '_togglePerfPurifier',
    initialOn: true,
  },
  {
    id: 'fpPausePerfAbilities', tabs: ['performance'], type: 'toggle',
    label: 'Ability effects', icon: 'ph ph-sparkle',
    keywords: 'fireball kamehameha particles vfx performance',
    swId: 'fpPausePerfAbilities', stateId: 'fpPausePerfAbilitiesState',
    onclick: '_togglePerfAbilities',
    initialOn: true,
  },
  {
    id: 'fpPausePerfRaycast', tabs: ['performance'], type: 'toggle',
    label: 'Interaction raycast', icon: 'ph ph-crosshair',
    keywords: 'pick interact raycast performance',
    swId: 'fpPausePerfRaycast', stateId: 'fpPausePerfRaycastState',
    onclick: '_togglePerfRaycast',
    initialOn: true,
  },

  // ── Diagnostics ─────────────────────────────────────────────────
  {
    id: 'fpPauseShowFps', tabs: ['diagnostics'], type: 'toggle',
    label: 'Show FPS', icon: 'ph ph-gauge',
    keywords: 'frames per second performance counter overlay diagnostic',
    swId: 'fpPauseShowFps', stateId: 'fpPauseShowFpsState',
    onclick: '_toggleFps',
    initialOn: false,
  },
  {
    id: 'fpPauseShowInputDiag', tabs: ['diagnostics'], type: 'toggle',
    label: 'Input diagnostic HUD', icon: 'ph ph-cursor-click',
    hint: 'Tiny debug strip showing pointer-lock, camera, and input mode.',
    keywords: 'debug diagnostic input pointer lock camera mode hud overlay',
    swId: 'fpPauseShowInputDiag', stateId: 'fpPauseShowInputDiagState',
    onclick: '_toggleInputDiag',
    initialOn: false,
  },
  // Localhost-only debug. CSS hides .pause-toggle-row--localhost
  // unless the panel host has the .settings-panel--localhost class.
  {
    id: 'fpPauseDebugWallsRow', tabs: ['diagnostics'], type: 'toggle',
    label: 'Wall labels', icon: 'ph ph-walls',
    keywords: 'debug wall label diagnostic',
    swId: 'fpPauseDebugWalls', stateId: 'fpPauseDebugWallsState',
    onclick: '_toggleDebugWallLabels',
    initialOn: false,
    localhostOnly: true,
  },

  // ── Audio ────────────────────────────────────────────────────────
  {
    id: 'fpPauseMuteSfx', tabs: ['audio'], type: 'toggle',
    label: 'SFX', icon: 'ph-fill ph-speaker-high',
    keywords: 'sound effects audio mute volume',
    swId: 'fpPauseMuteSfx', stateId: 'fpPauseMuteSfxState',
    // SFX/Music toggles use a custom inline handler that mirrors the
    // visual switch state into the JS toggle. Preserve original behavior.
    onclickRaw: "this.classList.toggle('on');window._toggleMuteSfx&&window._toggleMuteSfx(!this.classList.contains('on'))",
    initialOn: true,
  },
  {
    id: 'fpPauseMuteMusic', tabs: ['audio'], type: 'toggle',
    label: 'Music', icon: 'ph-fill ph-music-notes',
    keywords: 'music audio mute volume',
    swId: 'fpPauseMuteMusic', stateId: 'fpPauseMuteMusicState',
    onclickRaw: "this.classList.toggle('on');window._toggleMuteMusic&&window._toggleMuteMusic(!this.classList.contains('on'))",
    initialOn: true,
  },

  // ── Controls ─────────────────────────────────────────────────────
  {
    id: 'fpPauseCam', tabs: ['controls'], type: 'inline',
    label: 'Camera', icon: 'ph ph-camera-rotate',
    keywords: 'camera view first third person',
    btnLabelId: 'fpPauseCamLabel', btnLabel: 'Third person', kbd: 'V',
    onclick: '_switchCamFP',
  },
  {
    id: 'fpPauseMouseSens', tabs: ['controls'], type: 'slider',
    label: 'Mouse sensitivity', icon: 'ph ph-arrows-out-cardinal',
    keywords: 'mouse sensitivity look speed',
    rangeId: 'fpPauseMouseSens', valId: 'fpPauseMouseSensVal',
    min: 0.25, max: 2.5, step: 0.05, value: 1,
    aria: 'Mouse sensitivity',
    oninput: '_setMouseSens',
    initialLabel: '1.00×',
  },
  {
    id: 'fpPauseFov', tabs: ['controls'], type: 'slider',
    label: 'Field of view', icon: 'ph ph-binoculars',
    keywords: 'fov field view zoom camera',
    rangeId: 'fpPauseFov', valId: 'fpPauseFovVal',
    min: 55, max: 130, step: 1, value: 85,
    aria: 'Field of view',
    oninput: '_setFov',
    canonicalForMirror: 'fpPauseFovMirror',
    initialLabel: '85°',
  },
];

// Keyboard reference (read-only) — sits at the bottom of the Controls tab.
// Split into general and skate-specific sections so the skate group mirrors
// the in-game skate onboarding dialog (Get on/off, Kickflip, Manual, Spin).
const KEYBOARD_REF = [
  { keys: ['W','A','S','D'], desc: 'Move' },
  { keys: ['Space'], desc: 'Jump (hold)' },
  { keys: ['Shift'], desc: 'Sprint' },
  { keys: ['V'], desc: 'Camera' },
  { keys: ['R'], desc: 'Reset run' },
  { keys: ['Esc'], desc: 'Resume' },
];

const KEYBOARD_REF_SKATE = [
  { keys: ['K'], desc: 'Get on / off the board' },
  { keys: ['Q'], desc: 'Kickflip' },
  { keys: ['E'], desc: 'Manual / wheelie' },
  { keys: ['F'], desc: 'Board spin' },
];

// Controller reference. Auto-detected on connect; default mapping is
// Xbox-style (PS layout maps the same physical buttons by position).
const CONTROLLER_REF = [
  { keys: ['L Stick'],   desc: 'Move' },
  { keys: ['R Stick'],   desc: 'Look' },
  { keys: ['A'],         desc: 'Jump (hold)' },
  { keys: ['L3'],        desc: 'Sprint' },
  { keys: ['Y'],         desc: 'Camera' },
  { keys: ['B'],         desc: 'Help' },
  { keys: ['X'],         desc: 'Fireball / charge' },
  { keys: ['Select'],    desc: 'Reset run' },
  { keys: ['Start'],     desc: 'Pause' },
];

const CONTROLLER_REF_SKATE = [
  { keys: ['R3'], desc: 'Get on / off the board' },
  { keys: ['LB'], desc: 'Kickflip' },
  { keys: ['RB'], desc: 'Manual / wheelie' },
  { keys: ['LT'], desc: 'Board spin' },
];

// ────────────────────────────────────────────────────────────────────
// Renderers
// ────────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

function _searchAttrs(c) {
  const blob = `${c.label} ${c.keywords || ''}`.toLowerCase();
  return `data-search="${_esc(blob)}" data-row="${_esc(c.id)}"`;
}

function _renderToggleRow(c) {
  const onAttr = c.initialOn ? ' on' : '';
  const stateText = c.initialOn ? 'On' : 'Off';
  const stateOff = c.initialOn ? '' : ' off';
  const labelTitle = c.hint ? ` title="${_esc(c.hint)}"` : '';
  const onclick = c.onclickRaw
    ? c.onclickRaw
    : `window.${c.onclick}&&window.${c.onclick}()`;
  const rowIdAttr = c.rowId ? ` id="${_esc(c.rowId)}"` : '';
  const rowStyle = c.rowHidden ? ' style="display:none"' : '';
  // Optional gating classes. CSS rules in main.css hide rows when
  // the panel host is missing the matching enabling class.
  const extraClasses = [
    c.localhostOnly ? 'pause-toggle-row--localhost' : '',
  ].filter(Boolean).join(' ');
  const classAttr = extraClasses ? ` ${extraClasses}` : '';
  return `
    <div class="pause-toggle-row${classAttr}"${rowIdAttr}${rowStyle} ${_searchAttrs(c)}>
      <span class="pause-toggle-label"${labelTitle}><i class="${_esc(c.icon)}"></i> ${_esc(c.label)}</span>
      <div class="toggle-sw${onAttr}" id="${_esc(c.swId)}" role="switch" aria-checked="${c.initialOn ? 'true' : 'false'}"
        onclick="${onclick}"></div>
      <span class="pause-toggle-state${stateOff}" id="${_esc(c.stateId)}">${stateText}</span>
    </div>`;
}

function _renderSliderRow(c) {
  return `
    <div class="pause-toggle-row pause-toggle-row--slider" ${_searchAttrs(c)}>
      <span class="pause-toggle-label"><i class="${_esc(c.icon)}"></i> ${_esc(c.label)}</span>
      <input type="range" id="${_esc(c.rangeId)}" class="pause-range"
        min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"
        aria-label="${_esc(c.aria || c.label)}"
        oninput="window.${c.oninput}&&window.${c.oninput}(this.value)">
      <span class="pause-toggle-state" id="${_esc(c.valId)}">${_esc(c.initialLabel || '')}</span>
    </div>`;
}

function _renderInlineRow(c) {
  return `
    <div class="pause-toggle-row" ${_searchAttrs(c)}>
      <span class="pause-toggle-label"><i class="${_esc(c.icon)}"></i> ${_esc(c.label)}</span>
      <button type="button" class="pause-inline-btn"
        onclick="window.${c.onclick}&&window.${c.onclick}()">
        <span id="${_esc(c.btnLabelId)}">${_esc(c.btnLabel)}</span>
        ${c.kbd ? `<kbd>${_esc(c.kbd)}</kbd>` : ''}
      </button>
    </div>`;
}

function _renderRow(c) {
  if (c.type === 'toggle') return _renderToggleRow(c);
  if (c.type === 'slider') return _renderSliderRow(c);
  if (c.type === 'inline') return _renderInlineRow(c);
  return '';
}

function _renderKbdGroup(entries) {
  return entries.map(({ keys, desc }) => {
    const kbds = keys.map(k => `<kbd>${_esc(k)}</kbd>`).join('');
    return `<div>${kbds} ${_esc(desc)}</div>`;
  }).join('');
}

function _renderKeyboardRef() {
  const generalRows = _renderKbdGroup(KEYBOARD_REF);
  const skateRows = _renderKbdGroup(KEYBOARD_REF_SKATE);
  const padRows = _renderKbdGroup(CONTROLLER_REF);
  const padSkateRows = _renderKbdGroup(CONTROLLER_REF_SKATE);
  // Single data-search blob covers the whole keyboard reference (both groups).
  const allEntries = KEYBOARD_REF.concat(KEYBOARD_REF_SKATE)
    .concat(CONTROLLER_REF).concat(CONTROLLER_REF_SKATE);
  const searchBlob = allEntries.map(r => `${r.keys.join(' ')} ${r.desc}`).join(' ').toLowerCase();
  return `
    <div class="settings-keyboard-ref" data-search="${_esc('keyboard shortcuts skate skateboard controller gamepad xbox playstation ' + searchBlob)}" data-row="keyboard-ref">
      <h3 class="pause-section-title"><i class="ph ph-keyboard"></i> Keyboard</h3>
      <div class="pause-controls">${generalRows}</div>
      <h3 class="pause-section-title pause-section-title--sub"><span class="pause-section-emoji" aria-hidden="true">🛹</span> Skateboard</h3>
      <div class="pause-controls">${skateRows}</div>
      <h3 class="pause-section-title"><i class="ph ph-game-controller"></i> Controller</h3>
      <div class="pause-controls">${padRows}</div>
      <h3 class="pause-section-title pause-section-title--sub"><span class="pause-section-emoji" aria-hidden="true">🛹</span> Skateboard</h3>
      <div class="pause-controls">${padSkateRows}</div>
      <button class="pause-link pause-link--footer" type="button"
        onclick="window._enterInspector&&window._enterInspector()">
        <i class="ph ph-magnifying-glass"></i> Inspect air purifier
      </button>
    </div>`;
}

function _renderTabPage(tab) {
  const rows = CONTROLS
    .filter(c => c.tabs.includes(tab.id))
    .map(_renderRow)
    .join('');
  const extra = tab.id === 'controls' ? _renderKeyboardRef() : '';
  return `
    <div class="settings-page" role="tabpanel" data-tab="${_esc(tab.id)}" data-state="active">
      <div class="pause-toggles">${rows}</div>
      ${extra}
    </div>`;
}

function _renderRail() {
  const tabs = TABS.map((t, i) => {
    // Render both regular + fill icon variants and let CSS pick the
    // matching one for active state — same pattern as site-tab on
    // home/about/leaderboard so the fill glyph's optical alignment
    // doesn't shift the label on tab change.
    const iconBase = String(t.icon).replace(/^ph(-fill)?\s+/, '');
    return `
    <button class="settings-tab${i === 0 ? ' is-active' : ''}" role="tab"
      aria-selected="${i === 0 ? 'true' : 'false'}" data-tab="${_esc(t.id)}">
      <i class="settings-tab__icon settings-tab__icon--regular ph ${_esc(iconBase)}" aria-hidden="true"></i>
      <i class="settings-tab__icon settings-tab__icon--fill ph-fill ${_esc(iconBase)}" aria-hidden="true"></i>
      <span>${_esc(t.label)}</span>
    </button>`;
  }).join('');
  return `
    <nav class="settings-rail" role="tablist" aria-orientation="vertical">
      <div class="settings-tab-indicator" aria-hidden="true"></div>
      ${tabs}
    </nav>`;
}

function _renderShell() {
  const pages = TABS.map((t, i) => {
    const html = _renderTabPage(t);
    // Only the first tab is visible at mount.
    return html.replace('data-state="active"', i === 0 ? 'data-state="active"' : 'data-state="inactive" hidden');
  }).join('');
  return `
    <div class="app-search app-search--sticky settings-search-wrap">
      <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
      <input type="search" class="app-search__input settings-search-input" placeholder="Search settings…" aria-label="Search settings" />
    </div>
    <div class="settings-body">
      ${_renderRail()}
      <div class="settings-pages">
        ${pages}
        <div class="settings-search-results" hidden></div>
      </div>
    </div>`;
}

// ────────────────────────────────────────────────────────────────────
// Mount + behavior
// ────────────────────────────────────────────────────────────────────

// Track WHICH host we're currently mounted into, so SPA navigation
// can detach the old host and re-mount on a fresh one. Storing the
// host (not just a boolean) also makes a same-host call idempotent.
let _mountedHost = null;

// ────────────────────────────────────────────────────────────────────
// Parent-mode bridge
// ────────────────────────────────────────────────────────────────────
// The settings panel is mounted in two contexts:
//
//  1. Inside the play runtime (vite-index.html): src/main.js loads in
//     this same window, so all the window._toggleX / window._setX
//     handlers and sync helpers exist locally and just work.
//
//  2. As a host page (settings.html / home / about / leaderboard):
//     these pages embed the play runtime in a same-origin background
//     iframe (#bgFrame src="/play?bg=1"). The handler globals live in
//     the IFRAME's window, so the panel's inline `window._toggleX()`
//     calls hit undefined in the parent and silently no-op.
//
// To make case (2) work we install thin proxy globals on the parent
// window that forward to the iframe's handler. Because the handler
// persists state to localStorage (shared across same-origin frames)
// and applies it to the live scene, the only thing left for the
// parent to do is refresh ITS OWN panel UI from localStorage so the
// toggle/slider/value reflects the new state.
//
// We don't try to be fancy: read each storage key, write each
// rendered control. Same set of keys main.js / game-fp.js use.

const _STORAGE_KEYS = {
  fps:          'diy_air_purifier_show_fps_v1',
  windowSun:    'diy_air_purifier_perf_window_sun_v1',
  shadows:      'diy_air_purifier_perf_shadows_v1',
  fog:          'diy_air_purifier_perf_fog_v1',
  fpProfile:    'diy_air_purifier_perf_profile_v1',
  fpResolution: 'diy_air_purifier_perf_resolution_v1',
  fpResolutionScale: 'diy_air_purifier_perf_resolution_scale_v1',
  fpShadowInterval:  'diy_air_purifier_perf_fp_shadow_interval_v1',
  fpsCap:       'diy_air_purifier_perf_fps_cap_v1',
  catAnim:      'diy_air_purifier_perf_cat_anim_v1',
  coins:        'diy_air_purifier_perf_coins_v1',
  purifier:     'diy_air_purifier_perf_purifier_v1',
  abilities:    'diy_air_purifier_perf_abilities_v1',
  raycast:      'diy_air_purifier_perf_raycast_v1',
  fov:          'diy_air_purifier_fov_v1',
  mouseSens:    'diy_air_purifier_mouse_sens_v1',
  muteSfx:      'diy_air_purifier_muted_v2',
  muteMusic:    'diy_air_purifier_music_muted_v2',
  inputDiag:    'diy_air_purifier_input_diag_visible_v1',
};

// Map of (storage key, default-on, swId, stateId) tuples we'll read on
// refresh. Default-on means "missing/unset → On" to match main.js's
// `getItem(...) !== '0'` recipe.
const _BOOL_ROWS = [
  // FPS defaults to OFF (matches schema's initialOn:false).
  { key: 'fps',          defOn: false, swId: 'fpPauseShowFps',         stateId: 'fpPauseShowFpsState' },
  { key: 'windowSun',    defOn: true,  swId: 'fpPausePerfWindowSun',   stateId: 'fpPausePerfWindowSunState' },
  { key: 'shadows',      defOn: true,  swId: 'fpPausePerfShadows',     stateId: 'fpPausePerfShadowsState' },
  { key: 'fog',          defOn: true,  swId: 'fpPausePerfFog',         stateId: 'fpPausePerfFogState' },
  { key: 'fpResolution', defOn: true,  swId: 'fpPausePerfResolution',  stateId: 'fpPausePerfResolutionState' },
  { key: 'fpProfile',    defOn: true,  swId: 'fpPausePerfFpProfile',   stateId: 'fpPausePerfFpProfileState' },
  { key: 'catAnim',      defOn: true,  swId: 'fpPausePerfCatAnim',     stateId: 'fpPausePerfCatAnimState' },
  { key: 'coins',        defOn: true,  swId: 'fpPausePerfCoins',       stateId: 'fpPausePerfCoinsState' },
  { key: 'purifier',     defOn: true,  swId: 'fpPausePerfPurifier',    stateId: 'fpPausePerfPurifierState' },
  { key: 'abilities',    defOn: true,  swId: 'fpPausePerfAbilities',   stateId: 'fpPausePerfAbilitiesState' },
  { key: 'raycast',      defOn: true,  swId: 'fpPausePerfRaycast',     stateId: 'fpPausePerfRaycastState' },
  { key: 'inputDiag',    defOn: false, swId: 'fpPauseShowInputDiag',   stateId: 'fpPauseShowInputDiagState' },
  // Audio toggles use mute storage ('1'=muted, else audible). The
  // visual switch is "on=audible" so we read with mutedReader.
  { key: 'muteSfx',      defOn: true,  swId: 'fpPauseMuteSfx',         stateId: 'fpPauseMuteSfxState', mutedReader: true },
  { key: 'muteMusic',    defOn: true,  swId: 'fpPauseMuteMusic',       stateId: 'fpPauseMuteMusicState', mutedReader: true },
];

function _readBool(key, defOn) {
  try {
    const v = localStorage.getItem(_STORAGE_KEYS[key]);
    if (v === null) return defOn;
    return v !== '0';
  } catch { return defOn; }
}

function _readNum(key, def) {
  try {
    const v = localStorage.getItem(_STORAGE_KEYS[key]);
    if (v === null) return def;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
  } catch { return def; }
}

// Applies a boolean to a toggle row in the parent panel.
function _applyBoolRow(host, swId, stateId, on) {
  const sw = host.querySelector(`#${CSS.escape(swId)}`);
  const st = host.querySelector(`#${CSS.escape(stateId)}`);
  if (sw) {
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  }
  if (st) {
    st.textContent = on ? 'On' : 'Off';
    st.classList.toggle('off', !on);
  }
}

function _refreshPanelFromStorage(host) {
  if (!host || !host.isConnected) return;
  // Boolean toggles.
  for (const row of _BOOL_ROWS) {
    let on;
    if (row.mutedReader) {
      // Storage: '1'=muted, else audible. Switch shows audible state.
      let muted = false;
      try { muted = localStorage.getItem(_STORAGE_KEYS[row.key]) === '1'; } catch {}
      on = !muted;
    } else {
      on = _readBool(row.key, row.defOn);
    }
    _applyBoolRow(host, row.swId, row.stateId, on);
  }
  // FOV slider (canonical + mirror).
  const fov = Math.round(_readNum('fov', 85));
  for (const id of ['fpPauseFov', 'fpPauseFovMirror']) {
    const r = host.querySelector(`#${id}`);
    if (r) r.value = String(fov);
  }
  for (const id of ['fpPauseFovVal', 'fpPauseFovMirrorVal']) {
    const v = host.querySelector(`#${id}`);
    if (v) v.textContent = `${fov}\u00B0`;
  }
  // Mouse sensitivity slider.
  const ms = _readNum('mouseSens', 1);
  const msR = host.querySelector('#fpPauseMouseSens');
  const msV = host.querySelector('#fpPauseMouseSensVal');
  if (msR) msR.value = String(ms);
  if (msV) msV.textContent = `${ms.toFixed(2)}\u00D7`;
  // Resolution scale slider — only meaningful when fpResolution is on.
  const resOn = _readBool('fpResolution', true);
  const rs = _readNum('fpResolutionScale', 1);
  const rsR = host.querySelector('#fpPausePerfResolutionScale');
  const rsV = host.querySelector('#fpPausePerfResolutionScaleVal');
  if (rsR) { rsR.value = String(rs); rsR.disabled = !resOn; }
  if (rsV) {
    rsV.textContent = resOn ? `${Math.round(rs * 100)}%` : 'Bypassed';
    rsV.classList.toggle('off', !resOn);
  }
  // FP shadow cadence — only meaningful when fpProfile is on.
  const profOn = _readBool('fpProfile', true);
  const sh = _readNum('fpShadowInterval', 0);
  const shR = host.querySelector('#fpPausePerfShadowCadence');
  const shV = host.querySelector('#fpPausePerfShadowCadenceVal');
  if (shR) { shR.value = String(sh); shR.disabled = !profOn; }
  if (shV) {
    shV.textContent = profOn
      ? (sh <= 0 ? 'Every frame' : `${Math.round(sh)} ms`)
      : 'Bypassed';
    shV.classList.toggle('off', !profOn);
  }
  // FPS cap — independent of fpProfile (always honored).
  const cap = Math.max(0, Math.round(_readNum('fpsCap', 0)));
  const capR = host.querySelector('#fpPausePerfFpsCap');
  const capV = host.querySelector('#fpPausePerfFpsCapVal');
  if (capR) capR.value = String(cap);
  if (capV) {
    capV.textContent = cap <= 0 ? 'Unlimited' : `${cap} fps`;
    capV.classList.toggle('off', cap <= 0);
  }
}

// List of handler globals the panel calls. We proxy each one to the
// iframe's window if it exists locally only as undefined.
const _PROXY_FNS = [
  '_toggleFps', '_toggleMph', '_toggleInputDiag',
  '_togglePerfWindowSun', '_togglePerfShadows', '_togglePerfFog',
  '_toggleFpPerfResolution', '_setFpPerfResolutionScale',
  '_toggleFpPerfProfile', '_setFpPerfShadowCadence',
  '_setFpsCap',
  '_togglePerfCatAnim', '_togglePerfCoins', '_togglePerfPurifier',
  '_togglePerfAbilities', '_togglePerfRaycast',
  '_toggleDebugWallLabels',
  '_toggleMuteSfx', '_toggleMuteMusic',
  '_switchCamFP', '_setMouseSens', '_setFov',
  '_enterInspector',
];

// Returns the live #bgFrame contentWindow if same-origin and reachable.
function _getBgWindow() {
  try {
    const fr = document.getElementById('bgFrame');
    if (!fr) return null;
    const w = fr.contentWindow;
    if (!w) return null;
    // Same-origin check: accessing .location.origin throws if cross-origin.
    void w.location.origin;
    return w;
  } catch { return null; }
}

let _bridgeInstalled = false;
function _installParentBridge(host) {
  // Only install in PARENT mode: panel mounted in a doc that hosts
  // /play in a child iframe. If main.js already loaded in this window
  // (i.e. we ARE /play) the handler globals exist locally, so skip.
  if (_bridgeInstalled) return;
  if (typeof window._toggleFps === 'function') return; // /play context
  const bg = _getBgWindow();
  if (!bg) return; // no game iframe → nothing to forward to
  _bridgeInstalled = true;

  // Install proxies. After each call, refresh our panel UI from the
  // storage the iframe just wrote.
  for (const name of _PROXY_FNS) {
    if (typeof window[name] === 'function') continue;
    window[name] = function (...args) {
      try {
        const fn = bg[name];
        if (typeof fn === 'function') fn.apply(bg, args);
      } catch { /* iframe gone or cross-origin */ }
      // Storage writes from the iframe are synchronous, so reading
      // them back next tick reflects the new state.
      setTimeout(() => _refreshPanelFromStorage(host), 0);
    };
  }

  // Also refresh whenever localStorage changes from another tab
  // OR when the iframe writes (storage event doesn't fire same-frame,
  // but it does cover external changes; the post-call refresh above
  // covers in-frame writes).
  window.addEventListener('storage', () => _refreshPanelFromStorage(host));
}

export function mountSettings(host) {
  if (!host) return;
  // Same host → no-op (calling mountSettings twice is safe).
  if (_mountedHost === host) return;
  // Old host got removed from the DOM (SPA route swap, overlay tear-
  // down, etc.). Forget it so we can mount fresh on the new host.
  if (_mountedHost && !_mountedHost.isConnected) {
    _mountedHost = null;
  }
  // Another host is still live in the document. The schema panel uses
  // hard-coded element IDs that must stay unique, so we refuse to
  // mount a second copy. In practice this only triggers if a caller
  // double-mounts within the same document.
  if (_mountedHost) return;
  _mountedHost = host;
  host.classList.add('settings-panel');
  // Tag for localhost-gated rows (e.g. wall labels). CSS rule hides
  // .pause-toggle-row--localhost unless this class is present.
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      host.classList.add('settings-panel--localhost');
    }
  } catch { /* no window.location in some hosts */ }
  host.innerHTML = _renderShell();

  const rail = host.querySelector('.settings-rail');
  const indicator = host.querySelector('.settings-tab-indicator');
  const tabs = Array.from(host.querySelectorAll('.settings-tab'));
  const pages = Array.from(host.querySelectorAll('.settings-page'));
  const searchInput = host.querySelector('.settings-search-input');
  const searchResults = host.querySelector('.settings-search-results');
  const pagesWrap = host.querySelector('.settings-pages');

  let activeIndex = 0;

  // Position the indicator pill on the active tab. Re-runs on resize
  // and tab changes so the pill always matches the tab geometry.
  function _positionIndicator(animate = true) {
    const t = tabs[activeIndex];
    if (!t || !indicator) return;
    const r = t.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const top = r.top - railRect.top;
    indicator.style.transition = animate
      ? 'transform 220ms cubic-bezier(.2,.8,.2,1), height 220ms cubic-bezier(.2,.8,.2,1)'
      : 'none';
    indicator.style.transform = `translateY(${top}px)`;
    indicator.style.height = `${r.height}px`;
  }

  // Direction-aware page swap. New page enters from below if moving
  // down the rail, from above if moving up. Small offset + brief blur
  // — same recipe as the rest of the UI.
  function _switchTab(nextIndex) {
    if (nextIndex === activeIndex) return;
    const dir = nextIndex > activeIndex ? 1 : -1; // 1=down, -1=up
    const outgoing = pages[activeIndex];
    const incoming = pages[nextIndex];
    if (!outgoing || !incoming) return;

    // Aria + active class.
    tabs.forEach((t, i) => {
      const on = i === nextIndex;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // Outgoing exit.
    outgoing.dataset.state = dir === 1 ? 'exit-up' : 'exit-down';
    // Prepare incoming offscreen on the opposite side.
    incoming.hidden = false;
    incoming.dataset.state = dir === 1 ? 'enter-from-below' : 'enter-from-above';
    // Force a reflow so the enter-from-* state paints before we flip
    // to active. Without this the transition collapses to a snap.
    void incoming.offsetWidth;
    incoming.dataset.state = 'active';

    // After the transition, hide the outgoing page so it doesn't
    // catch focus or pointer events.
    const finalize = () => {
      outgoing.dataset.state = 'inactive';
      outgoing.hidden = true;
      outgoing.removeEventListener('transitionend', finalize);
    };
    outgoing.addEventListener('transitionend', finalize, { once: true });

    activeIndex = nextIndex;
    _positionIndicator(true);
  }

  // Tab clicks + keyboard nav (↑/↓ on the rail).
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => _switchTab(i));
  });
  rail.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const next = (activeIndex + delta + tabs.length) % tabs.length;
    tabs[next].focus();
    _switchTab(next);
  });

  // Position indicator on mount + when fonts/icons load + on resize.
  _positionIndicator(false);
  // Run again next frame in case layout shifts as icons load.
  requestAnimationFrame(() => _positionIndicator(false));
  setTimeout(() => _positionIndicator(false), 120);
  window.addEventListener('resize', () => _positionIndicator(false));

  // ── Search ──────────────────────────────────────────────────────
  // Always-on input. Empty query → tabbed view. Non-empty → flat
  // filtered list grouped by tab. Rows are MOVED (not re-rendered)
  // into the results pane to preserve their preserved IDs and any
  // attached listeners. They get restored to their original tab
  // page before each new search render and on clear.
  const _origParents = new WeakMap();
  function _captureOrigParents() {
    pages.forEach(page => {
      page.querySelectorAll('[data-row]').forEach(row => {
        if (!_origParents.has(row)) {
          _origParents.set(row, { parent: row.parentNode, next: row.nextSibling });
        }
      });
    });
  }
  function _restoreOrigParents() {
    // Move every row currently inside searchResults back to its
    // captured original parent. Walks the live DOM each time so
    // multiple search transitions stay consistent.
    const inResults = Array.from(searchResults.querySelectorAll('[data-row]'));
    inResults.forEach(row => {
      const orig = _origParents.get(row);
      if (orig && orig.parent && orig.parent.isConnected) {
        orig.parent.insertBefore(row, orig.next || null);
      }
    });
  }

  function _runSearch(query) {
    const q = query.trim().toLowerCase();
    // Always restore rows back to their tab pages BEFORE we touch
    // searchResults.innerHTML — otherwise a query change orphans
    // the rows that were previously moved into results.
    _restoreOrigParents();

    if (!q) {
      // Restore tab view.
      pagesWrap.classList.remove('is-searching');
      pages.forEach((p, i) => {
        p.hidden = i !== activeIndex;
        p.dataset.state = i === activeIndex ? 'active' : 'inactive';
      });
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      return;
    }
    pagesWrap.classList.add('is-searching');
    pages.forEach((p) => { p.hidden = true; p.dataset.state = 'inactive'; });
    searchResults.hidden = false;

    // Walk the schema, keep matches, group by tab.
    const groups = new Map(TABS.map(t => [t.id, []]));
    CONTROLS.forEach(c => {
      if (c.hideInSearch) return;
      const blob = `${c.label} ${c.keywords || ''}`.toLowerCase();
      if (!blob.includes(q)) return;
      const tabId = c.tabs[0];
      if (!groups.has(tabId)) return;
      groups.get(tabId).push(c);
    });

    const html = TABS
      .filter(t => groups.get(t.id).length > 0)
      .map(t => {
        const rows = groups.get(t.id).map(c => {
          return `<div class="settings-search-slot" data-row="${_esc(c.id)}"></div>`;
        }).join('');
        return `
          <div class="settings-search-group">
            <h3 class="pause-section-title"><i class="${_esc(t.icon)}"></i> ${_esc(t.label)}</h3>
            <div class="pause-toggles">${rows}</div>
          </div>`;
      }).join('');
    searchResults.innerHTML = html || '<div class="settings-search-empty">No matches.</div>';

    // Move actual row nodes (with their preserved IDs) into the slots.
    searchResults.querySelectorAll('.settings-search-slot').forEach(slot => {
      const id = slot.dataset.row;
      const orig = pagesWrap.querySelector(`.settings-page [data-row="${CSS.escape(id)}"]`);
      if (orig) {
        // Capture original parent the first time we move a row.
        if (!_origParents.has(orig)) {
          _origParents.set(orig, { parent: orig.parentNode, next: orig.nextSibling });
        }
        slot.replaceWith(orig);
      } else {
        slot.remove();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      _runSearch(searchInput.value);
    });
    // Esc inside search clears it instead of closing the overlay.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value !== '') {
        e.stopPropagation();
        searchInput.value = '';
        _runSearch('');
      }
    });
  }

  // ── FOV mirror sync ──────────────────────────────────────────────
  // Canonical row is fpPauseFov; mirror is fpPauseFovMirror in Display.
  // game-fp.js's _syncFovUi only updates the canonical row, so we
  // observe canonical changes and forward to the mirror.
  const fovCanonical = document.getElementById('fpPauseFov');
  const fovCanonicalVal = document.getElementById('fpPauseFovVal');
  const fovMirror = document.getElementById('fpPauseFovMirror');
  const fovMirrorVal = document.getElementById('fpPauseFovMirrorVal');
  if (fovCanonical && fovMirror) {
    function _syncFovMirror(from) {
      // `from` lets us mirror in either direction without echoing.
      if (from === 'mirror') {
        fovCanonical.value = fovMirror.value;
        if (fovCanonicalVal) fovCanonicalVal.textContent = `${Math.round(parseFloat(fovMirror.value))}°`;
      } else {
        fovMirror.value = fovCanonical.value;
        if (fovMirrorVal) fovMirrorVal.textContent = `${Math.round(parseFloat(fovCanonical.value))}°`;
      }
    }
    // On user input on either, forward to the canonical setter and
    // sync the other row's display. The inline oninput already calls
    // window._setFov; we only need to sync the OTHER row's UI here.
    fovCanonical.addEventListener('input', () => _syncFovMirror('canonical'));
    fovMirror.addEventListener('input', () => _syncFovMirror('mirror'));
    // Initial sync — match mirror to whatever game-fp populated.
    _syncFovMirror('canonical');
    // Also re-sync after micro-tasks (game-fp may run _syncFovUi later).
    setTimeout(() => _syncFovMirror('canonical'), 0);
    setTimeout(() => _syncFovMirror('canonical'), 200);
  }

  // Notify the rest of the app that the panel is now in the DOM, so
  // any sync functions that update toggle/slider state from live
  // values can run against freshly-rendered controls. Modules that
  // care (main.js, game-fp.js) listen for this once and (re)apply.
  document.dispatchEvent(new CustomEvent('settings-panel:mounted', {
    detail: { host }
  }));

  // Parent-mode bridge: if we're mounted in a host page (settings.html /
  // home / about / leaderboard) the actual handler globals live in
  // the #bgFrame iframe. Install proxies so the inline `window._fooX()`
  // calls forward to the iframe and refresh our panel UI from the
  // storage the iframe writes. No-op when running inside /play itself.
  _installParentBridge(host);
  // Initial sync of our panel UI to whatever's currently in storage.
  // Schedule a few times in case the iframe boots and writes defaults
  // shortly after mount.
  _refreshPanelFromStorage(host);
  setTimeout(() => _refreshPanelFromStorage(host), 60);
  setTimeout(() => _refreshPanelFromStorage(host), 400);
}

export function focusSettingsSearch(host) {
  const input = host?.querySelector?.('.settings-search-input');
  if (input) input.focus();
}
