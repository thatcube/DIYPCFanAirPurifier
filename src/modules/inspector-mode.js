// ─── Inspector mode (lazy-loaded) ────────────────────────────────────
// Owns everything the orbit/customize-the-purifier experience needs:
//   - OrbitControls (lazy-imported here so the eager bundle stays small)
//   - particles + wall-fade modules
//   - The customization aside HTML (injected into the DOM on first enter)
//   - All window._set* / window._toggle* purifier UI handlers
//   - Orbit-mode keyboard navigation (W/A/S/D + F-key fly mode)
//   - Per-frame tick: controls update, fly-mode translation, particles,
//     wall auto-fade
//
// First enter() lazy-loads dependencies and wires everything; subsequent
// enter()/exit() calls are essentially toggles. The chunk stays in memory
// after first load — its runtime cost when inactive is one boolean check.

import * as THREE from 'three';
import {
  initToggleSwitches, initSegButtons, initDecorativeIcons, initClickableDivs
} from './a11y.js';

// ── Inspector aside HTML ────────────────────────────────────────────
// Injected verbatim from the previous vite-index.html markup. Inline
// onclick/oninput handlers reference window._set*/_toggle* functions
// that we wire up below.

const PANEL_HTML = `
<button class="panel-fab" id="panelFab" aria-label="Open control panel"
  onclick="document.getElementById('panelL').style.display='flex';this.style.display='none'"><i
    class="ph ph-sliders-horizontal" aria-hidden="true"></i></button>
<aside class="panel panel-l" id="panelL" aria-label="Purifier controls">
  <div class="panel-header">
    <h3>Control Center</h3>
    <button class="panel-close" aria-label="Close control panel"
      onclick="this.closest('.panel').style.display='none';document.getElementById('panelFab').style.display='flex'"><i
        class="ph ph-x" aria-hidden="true"></i></button>
  </div>
  <div class="panel-scroll">

    <div class="section-group">
      <h4><i class="ph ph-cube"></i> Structure</h4>
      <div class="ctrl-row"><label><i class="ph ph-layout"></i> Fan layout</label>
        <div class="seg">
          <button class="on" id="btnLayoutFB" onclick="window._setLayout&&window._setLayout('fb')">Front+Back</button>
          <button id="btnLayoutFT" onclick="window._setLayout&&window._setLayout('ft')">Front+Top</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-hash"></i> Fans per panel</label>
        <div class="seg">
          <button id="btnFan3" onclick="window._setFanCount&&window._setFanCount(3)">3</button>
          <button class="on" id="btnFan4" onclick="window._setFanCount&&window._setFanCount(4)">4</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-polygon"></i> Edge profile</label>
        <div class="seg">
          <button class="on" id="btnEdgeFlat" onclick="window._setEdge&&window._setEdge('flat')">Flat</button>
          <button id="btnEdgeCurved" onclick="window._setEdge&&window._setEdge('curved')">Curved</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-drop"></i> Wood species</label>
        <div class="seg">
          <button class="on" id="btnStainAsh" onclick="window._setStain&&window._setStain('ash')">Ash</button>
          <button id="btnStainBirch" onclick="window._setStain&&window._setStain('birch')">Birch</button>
          <button id="btnStainWalnut" onclick="window._setStain&&window._setStain('walnut')">Walnut</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-arrows-out"></i> Exploded view</label>
        <div class="toggle-sw" id="togExplode" onclick="window._toggleExplode&&window._toggleExplode()"></div>
      </div>
    </div>

    <div class="section-group">
      <h4><i class="ph ph-paint-brush"></i> Finish & Feet</h4>
      <div class="ctrl-row"><label><i class="ph ph-funnel"></i> Show filters</label>
        <div class="toggle-sw on" id="togFilter" onclick="window._toggleFilter&&window._toggleFilter()"></div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-grid-four"></i> Fan grills</label>
        <div class="toggle-sw" id="togGrill" onclick="window._toggleGrills&&window._toggleGrills()"></div>
      </div>
      <div class="ctrl-row" id="grillColorSection" style="display:none"><label><i class="ph ph-palette"></i> Grill color</label>
        <div class="seg">
          <button class="on" id="btnGrillBlack" onclick="window._setGrillColor&&window._setGrillColor('black')">Black</button>
          <button id="btnGrillSilver" onclick="window._setGrillColor&&window._setGrillColor('silver')">Silver</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-sneaker-move"></i> Feet style</label>
        <div class="seg">
          <button id="btnFeetPeg" onclick="window._setFeet&&window._setFeet('peg')">Peg</button>
          <button class="on" id="btnFeetBun" onclick="window._setFeet&&window._setFeet('bun')">Bun</button>
          <button id="btnFeetRubber" onclick="window._setFeet&&window._setFeet('rubber')">Rubber</button>
          <button id="btnFeetNone" onclick="window._setFeet&&window._setFeet('none')">None</button>
        </div>
      </div>
      <div class="ctrl-row" id="footDiameterRow"><label><i class="ph ph-circle-dashed"></i> Diameter <span id="footDiaLabel">1.5″</span></label>
        <input type="range" class="slider" min="0" max="2" step="0.1" value="1.5" aria-label="Foot diameter"
          oninput="window._setFootDia&&window._setFootDia(this.value);document.getElementById('footDiaLabel').textContent=parseFloat(this.value).toFixed(1)+'\u2033'" />
      </div>
      <div class="ctrl-row" id="footHeightRow"><label><i class="ph ph-arrows-vertical"></i> Height <span id="footHtLabel">3.5″</span></label>
        <input type="range" class="slider" min="0" max="4" step="0.25" value="3.5" aria-label="Foot height"
          oninput="window._setFootHt&&window._setFootHt(this.value);document.getElementById('footHtLabel').textContent=parseFloat(this.value).toFixed(2)+'\u2033'" />
      </div>
      <div class="ctrl-row" id="footAngleRow"><label><i class="ph ph-arrows-out"></i> Angled outward</label>
        <div class="seg">
          <button class="on" id="btnFeetStraight" onclick="window._setFeetAngled&&window._setFeetAngled(false)">Straight</button>
          <button id="btnFeetAngled" onclick="window._setFeetAngled&&window._setFeetAngled(true)">Angled</button>
        </div>
      </div>
    </div>

    <div class="section-group">
      <h4><i class="ph ph-map-pin"></i> Placement</h4>
      <div class="ctrl-row"><label><i class="ph ph-map-trifold"></i> Position</label>
        <div class="seg">
          <button id="btnPlaceFloor" onclick="window._setPlacement&&window._setPlacement('floor')">Floor</button>
          <button class="on" id="btnPlaceTv" onclick="window._setPlacement&&window._setPlacement('tv')">Under TV</button>
          <button id="btnPlaceWall" onclick="window._setPlacement&&window._setPlacement('wall')">Wall</button>
        </div>
      </div>
      <div class="slider-row">
        <label>Turntable</label>
        <input type="range" min="0" max="360" value="90" id="turntableSlider" aria-label="Turntable angle"
          oninput="window._setTurntable&&window._setTurntable(this.value);document.getElementById('turntableLabel').textContent=this.value+'°'">
        <span id="turntableLabel">90°</span>
      </div>
    </div>

    <div class="section-group">
      <h4><i class="ph ph-fan"></i> Fans</h4>
      <div class="ctrl-row"><label><i class="ph ph-power"></i> Spin fans</label>
        <div class="toggle-sw on" id="togSpin" onclick="window._toggleSpin&&window._toggleSpin()"></div>
      </div>
      <div class="slider-row">
        <label>Speed</label>
        <input type="range" min="0" max="1800" value="900" id="fanSpeedSlider" aria-label="Fan speed"
          oninput="window._setFanSpeed&&window._setFanSpeed(this.value);document.getElementById('fanSpeedVal').textContent=this.value+'rpm'">
        <span id="fanSpeedVal">900rpm</span>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-paint-bucket"></i> Fan color</label>
        <div class="seg">
          <button class="on" id="btnFanWhite" onclick="window._setFanColor&&window._setFanColor('white')">White</button>
          <button id="btnFanBlack" onclick="window._setFanColor&&window._setFanColor('black')">Black</button>
        </div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-rainbow"></i> RGB Fans</label>
        <div class="toggle-sw on" id="togRGB" onclick="window._toggleRGB&&window._toggleRGB()"></div>
      </div>
    </div>

    <div class="section-group">
      <h4><i class="ph ph-sun"></i> Scene</h4>
      <div class="slider-row">
        <label>Time</label>
        <input type="range" min="0" max="1439" value="870" id="todSlider" aria-label="Time of day"
          oninput="window._setTOD&&window._setTOD(this.value)">
        <span id="todLabel">2:30 PM</span>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-eye"></i> Isolate purifier</label>
        <div class="toggle-sw" id="togIsolate" onclick="window._toggleIsolate&&window._toggleIsolate()"></div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-ruler"></i> Dimensions</label>
        <div class="toggle-sw" id="togDims" onclick="window._toggleDims&&window._toggleDims()"></div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-scan"></i> X-ray mode</label>
        <div class="toggle-sw" id="togXray" onclick="window._toggleXray&&window._toggleXray()"></div>
      </div>
      <div class="ctrl-row"><label><i class="ph ph-chart-bar"></i> Show FPS</label>
        <div class="toggle-sw" id="togFps" onclick="window._toggleFps&&window._toggleFps()"></div>
      </div>
      <div class="ctrl-row" id="rowQuickCoin" hidden><label><i class="ph ph-lightning"></i> Quick coin mode</label>
        <div class="toggle-sw" id="togQuickCoin" onclick="window._toggleQuickCoin&&window._toggleQuickCoin()"></div>
      </div>
    </div>

    <div class="section-group">
      <h4><i class="ph ph-game-controller"></i> Game</h4>
      <div class="ctrl-row"><label>Return to character select</label>
        <button class="glass-btn glass-btn--primary" onclick="window._exitInspector&&window._exitInspector()">
          <i class="ph ph-arrow-left"></i> Back to game
        </button>
      </div>
    </div>

  </div>
</aside>
`;

// ── State ───────────────────────────────────────────────────────────

let _ctx = null;
let _initialized = false;
let _isActive = false;
let _OrbitControls = null;
let _particles = null;
let _wallFade = null;
let _controls = null;

let _flyMode = false;
const _orbitSaved = {};
const _camKeys = {
  w: false, a: false, s: false, d: false,
  space: false, shift: false, ctrl: false,
};

// Scratch vectors for fly-mode translation (avoid per-frame allocs)
const _flyFwd = new THREE.Vector3();
const _flyRight = new THREE.Vector3();
const _flyMove = new THREE.Vector3();

// Tracks foot-height offset between feet style changes
let _initialBunFootH = 0;
let _footYOffset = 0;
let _prevPlacement = 'tv';

// ── First-time init: lazy-import deps, inject HTML, wire handlers ────

async function _ensureInit(ctx) {
  if (_initialized) return;
  _ctx = ctx;

  // Lazy-import every dep that the inspector exclusively needs.
  const [ocMod, particlesMod, wallFadeMod] = await Promise.all([
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('./particles.js'),
    import('./wall-fade.js'),
  ]);
  _OrbitControls = ocMod.OrbitControls;
  _particles = particlesMod;
  _wallFade = wallFadeMod;

  // Construct OrbitControls now that the user wants to inspect.
  _controls = new _OrbitControls(ctx.camera, ctx.canvas);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.minDistance = 8;
  _controls.maxDistance = 3000;
  _controls.maxPolarAngle = Math.PI * 0.48;
  _orbitSaved.maxPolarAngle = _controls.maxPolarAngle;
  _orbitSaved.minDistance = _controls.minDistance;
  _orbitSaved.maxDistance = _controls.maxDistance;

  _particles.init();
  _wallFade.init(ctx.scene, ctx.roomRefs);

  // Tell game-fp about the controls so its FP enter/exit can manage them.
  if (ctx.gameFp && typeof ctx.gameFp.setControls === 'function') {
    ctx.gameFp.setControls(_controls);
  }

  _initialBunFootH = ctx.state ? ctx.state.bunFootH : 0;
  _footYOffset = 0;

  _injectPanelHtml();
  _wireWindowHandlers();
  _wireKeyboard();
  _initPanelScrollFade();

  _initialized = true;
}

function _injectPanelHtml() {
  if (document.getElementById('panelL')) return; // already injected
  const host = document.querySelector('main') || document.body;
  const wrapper = document.createElement('div');
  wrapper.id = 'inspectorPanelHost';
  wrapper.innerHTML = PANEL_HTML;
  // Append children individually so we don't leave a wrapper div inside <main>
  while (wrapper.firstChild) host.appendChild(wrapper.firstChild);

  // Re-run a11y wiring so the freshly-injected toggle switches and seg
  // buttons get keyboard support and ARIA semantics.
  initToggleSwitches();
  initSegButtons();
  initDecorativeIcons();
  initClickableDivs();

  // Reflect persisted state on the freshly-injected toggles.
  if (_ctx.syncFpsToggle) _ctx.syncFpsToggle();
  if (_ctx.syncQuickCoinToggle) _ctx.syncQuickCoinToggle();
  if (_ctx.gateQuickCoinRow) _ctx.gateQuickCoinRow();
}

function _initPanelScrollFade() {
  const ps = document.querySelector('.panel-scroll');
  if (!ps) return;
  const checkFade = () => {
    const canScroll = ps.scrollHeight > ps.clientHeight + 1;
    const atBottom = ps.scrollTop + ps.clientHeight >= ps.scrollHeight - 2;
    ps.classList.toggle('scroll-fade', canScroll && !atBottom);
  };
  ps.addEventListener('scroll', checkFade, { passive: true });
  window.addEventListener('resize', checkFade);
  new MutationObserver(checkFade).observe(ps, { childList: true, subtree: true, attributes: true });
  checkFade();
}

// ── window._set* / window._toggle* handlers ─────────────────────────
// These were previously eagerly defined in main.js. Now they only
// exist after the inspector has been activated at least once. The
// inline onclick attributes in PANEL_HTML guard with `&&` so the
// panel can't be interacted with before the handlers are wired
// (the panel doesn't exist yet either, so this is moot in practice).

function _wireWindowHandlers() {
  const {
    purifierRefs, purifierGroup, placementOffset, scene, renderer,
    gameFp, lighting, todRefs, markShadowsDirty, spatial, camera,
  } = _ctx;

  window._toggleExplode = () => purifierRefs.toggleExplode();
  window._toggleFilter = () => { purifierRefs.toggleFilter(); gameFp.invalidatePurifierCollision(); };
  window._toggleGrills = () => purifierRefs.toggleGrills();
  window._setGrillColor = (c) => purifierRefs.setGrillColor(c);
  window._toggleDims = () => purifierRefs.toggleDimensions();

  window._setStain = (mode) => { purifierRefs.setStain(mode); };

  window._setLayout = (mode) => {
    purifierRefs.setLayout(mode);
    document.querySelectorAll('#btnLayoutFB,#btnLayoutFT').forEach(b => b.classList.remove('on'));
    const btn = document.getElementById(mode === 'fb' ? 'btnLayoutFB' : 'btnLayoutFT');
    if (btn) btn.classList.add('on');
  };

  window._setFanCount = (n) => {
    purifierRefs.setFanCount(n);
    document.querySelectorAll('#btnFan3,#btnFan4').forEach(b => b.classList.remove('on'));
    const btn = document.getElementById(n === 4 ? 'btnFan4' : 'btnFan3');
    if (btn) btn.classList.add('on');
  };

  window._setEdge = (mode) => {
    purifierRefs.setEdgeProfile(mode);
    document.querySelectorAll('#btnEdgeFlat,#btnEdgeCurved').forEach(b => b.classList.remove('on'));
    const btn = document.getElementById(mode === 'flat' ? 'btnEdgeFlat' : 'btnEdgeCurved');
    if (btn) btn.classList.add('on');
  };

  window._setFeet = (style) => {
    purifierRefs.setFeetStyle(style);
    document.querySelectorAll('#btnFeetPeg,#btnFeetBun,#btnFeetRubber,#btnFeetNone').forEach(b => b.classList.remove('on'));
    const id = style === 'peg' ? 'btnFeetPeg' : style === 'bun' ? 'btnFeetBun' : style === 'rubber' ? 'btnFeetRubber' : 'btnFeetNone';
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('on');
    markShadowsDirty();
    gameFp.invalidatePurifierCollision();
  };

  window._setFootDia = (val) => {
    purifierRefs.setFootDiameter(parseFloat(val));
    markShadowsDirty();
    gameFp.invalidatePurifierCollision();
  };

  window._setFootHt = (val) => {
    const newH = parseFloat(val);
    purifierRefs.setFootHeight(newH);
    const newOffset = newH - _initialBunFootH;
    const delta = newOffset - _footYOffset;
    _footYOffset = newOffset;
    purifierGroup.position.y += delta;
    placementOffset.y += delta;
    markShadowsDirty();
  };

  window._setFeetAngled = (angled) => {
    purifierRefs.setFeetAngled(angled);
    document.querySelectorAll('#btnFeetStraight,#btnFeetAngled').forEach(b => b.classList.remove('on'));
    document.getElementById(angled ? 'btnFeetAngled' : 'btnFeetStraight')?.classList.add('on');
    markShadowsDirty();
  };

  window._setFanColor = (mode) => {
    purifierRefs.setFanColor(mode);
    document.querySelectorAll('#btnFanWhite,#btnFanBlack').forEach(b => b.classList.remove('on'));
    const btn = document.getElementById(mode === 'white' ? 'btnFanWhite' : 'btnFanBlack');
    if (btn) btn.classList.add('on');
  };

  window._toggleRGB = () => {
    purifierRefs.toggleFanRGB();
    const tog = document.getElementById('togRGB');
    if (tog) tog.classList.toggle('on');
  };

  window._toggleXray = () => {
    if (!purifierRefs.toggleXray) return;
    const isOn = purifierRefs.toggleXray();
    const tog = document.getElementById('togXray');
    if (tog) tog.classList.toggle('on', isOn);
    markShadowsDirty();
  };

  window._toggleIsolate = () => {
    const tog = document.getElementById('togIsolate');
    const isOn = tog ? tog.classList.toggle('on') : false;
    scene.traverse(obj => { if (obj._isRoom) obj.visible = !isOn; });
    if (isOn) {
      scene.fog.density = 0;
      renderer.setClearColor(0x0a0e14, 1);
    } else {
      lighting.applyTimeOfDay(parseInt(document.getElementById('todSlider')?.value || '870', 10), todRefs);
    }
    markShadowsDirty();
  };

  window._setPlacement = (mode) => {
    const offsets = spatial.PLACEMENT_OFFSETS[mode] || spatial.PLACEMENT_OFFSETS.floor;
    placementOffset.set(offsets.x, offsets.y, offsets.z);
    purifierGroup.position.copy(placementOffset);

    if (mode === 'tv' || mode === 'wall') {
      purifierGroup.rotation.y = Math.PI / 2;
      purifierRefs.showConsoleProps(mode === 'tv');
      purifierRefs.showWallBracket(mode === 'wall');
    } else {
      purifierGroup.rotation.y = 0;
      purifierRefs.showConsoleProps(false);
      purifierRefs.showWallBracket(false);
    }

    if (mode === 'wall') {
      purifierRefs.setFeetStyle('none');
    } else if (_prevPlacement === 'wall') {
      purifierRefs.setFeetStyle('bun');
    }
    _prevPlacement = mode;

    const ts = document.getElementById('turntableSlider');
    const tl = document.getElementById('turntableLabel');
    const deg = Math.round(purifierGroup.rotation.y * 180 / Math.PI);
    if (ts) ts.value = deg;
    if (tl) tl.textContent = deg + '°';
    document.querySelectorAll('#btnPlaceFloor,#btnPlaceTv,#btnPlaceWall').forEach(b => b.classList.remove('on'));
    const btnId = mode === 'tv' ? 'btnPlaceTv' : mode === 'wall' ? 'btnPlaceWall' : 'btnPlaceFloor';
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('on');

    if (_controls) {
      _controls.target.set(placementOffset.x, placementOffset.y + 8, placementOffset.z);
      camera.position.set(placementOffset.x + 25, placementOffset.y + 20, placementOffset.z + 35);
      _controls.update();
    }
    markShadowsDirty();
    gameFp.invalidatePurifierCollision();
  };

  window._setTurntable = (val) => {
    purifierGroup.rotation.y = parseFloat(val) * Math.PI / 180;
  };

  window._setFanSpeed = (val) => {
    purifierRefs.setFanSpeed(parseInt(val, 10) / 1800 * 100);
  };

  window._toggleSpin = () => {
    const tog = document.getElementById('togSpin');
    const isOn = tog && tog.classList.toggle('on');
    purifierRefs.setSpinning(!!isOn);
  };

  window._setTOD = (val) => {
    const m = parseInt(val, 10);
    lighting.applyTimeOfDay(m, todRefs);
    const todLabel = document.getElementById('todLabel');
    if (todLabel) todLabel.textContent = lighting.formatTime(m);
    markShadowsDirty();
  };
}

// ── Orbit-mode keyboard ─────────────────────────────────────────────
// W/A/S/D rotate around target (orbit) or translate freely (fly).
// F toggles fly mode; Space/Shift = world up/down; Ctrl = sprint.
// P dumps the current camera pose to console + clipboard.

function _dumpCameraPose() {
  if (!_ctx?.camera) return;
  const cam = _ctx.camera;
  // Use the orbit target as the look-at point when available; in fly
  // mode the user has been driving freely so the target may not match
  // exactly, fall back to a point one unit forward of the camera.
  let tx, ty, tz;
  if (_controls && !_flyMode) {
    tx = _controls.target.x; ty = _controls.target.y; tz = _controls.target.z;
  } else {
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    // Project onto the controls target distance (or 25 units) so the
    // dumped target sits in front of the camera at a useful range.
    const dist = _controls
      ? cam.position.distanceTo(_controls.target)
      : 25;
    tx = cam.position.x + fwd.x * dist;
    ty = cam.position.y + fwd.y * dist;
    tz = cam.position.z + fwd.z * dist;
  }
  const r = (n) => Math.round(n);
  const snippet =
    `camera.position.set(${r(cam.position.x)}, ${r(cam.position.y)}, ${r(cam.position.z)});\n` +
    `camera.lookAt(${r(tx)}, ${r(ty)}, ${r(tz)});`;
  // eslint-disable-next-line no-console
  console.log('[camera pose]\n' + snippet);
  try {
    navigator.clipboard?.writeText(snippet);
  } catch (e) { /* ignore */ }
  _ctx.showToast?.(`Pose copied: pos(${r(cam.position.x)}, ${r(cam.position.y)}, ${r(cam.position.z)}) → look(${r(tx)}, ${r(ty)}, ${r(tz)})`);
}

function _setFlyMode(on) {
  if (!_controls) return;
  _flyMode = !!on;
  if (_flyMode) {
    _controls.maxPolarAngle = Math.PI;
    _controls.minDistance = 0.01;
    _controls.maxDistance = 100000;
    _ctx.showToast?.('Fly mode ON — WASD + Space/Shift, Ctrl to sprint, F to exit');
  } else {
    _controls.maxPolarAngle = _orbitSaved.maxPolarAngle;
    _controls.minDistance = _orbitSaved.minDistance;
    _controls.maxDistance = _orbitSaved.maxDistance;
    _ctx.showToast?.('Fly mode OFF');
  }
  _camKeys.w = _camKeys.a = _camKeys.s = _camKeys.d = false;
  _camKeys.space = _camKeys.shift = _camKeys.ctrl = false;
}

function _wireKeyboard() {
  document.addEventListener('keydown', e => {
    if (!_isActive) return;
    if (_ctx.gameFp.fpMode) return;
    if (_ctx.leaderboard?.isNameDialogOpen?.()) return;
    const cs = document.getElementById('charSelect');
    if (cs && cs.classList.contains('open')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const code = e.code;
    const k = e.key.toLowerCase();
    if (k === 'f' && !e.repeat && !e.metaKey && !e.altKey) {
      _setFlyMode(!_flyMode);
      e.preventDefault();
      return;
    }
    // P: dump current camera pose (position + look target) to console
    // and clipboard so you can frame a shot in fly mode and tell me
    // the exact values to bake in. Toast confirms it landed.
    if (k === 'p' && !e.repeat && !e.metaKey && !e.altKey && !e.ctrlKey) {
      _dumpCameraPose();
      e.preventDefault();
      return;
    }
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
      _camKeys[k] = true;
      e.preventDefault();
      return;
    }
    if (_flyMode) {
      if (code === 'Space') { _camKeys.space = true; e.preventDefault(); }
      else if (code === 'ShiftLeft' || code === 'ShiftRight') { _camKeys.shift = true; }
      else if (code === 'ControlLeft' || code === 'ControlRight') { _camKeys.ctrl = true; }
    }
  });
  document.addEventListener('keyup', e => {
    const code = e.code;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') _camKeys[k] = false;
    if (code === 'Space') _camKeys.space = false;
    if (code === 'ShiftLeft' || code === 'ShiftRight') _camKeys.shift = false;
    if (code === 'ControlLeft' || code === 'ControlRight') _camKeys.ctrl = false;
  });
  window.addEventListener('blur', () => {
    _camKeys.w = _camKeys.a = _camKeys.s = _camKeys.d = false;
    _camKeys.space = _camKeys.shift = _camKeys.ctrl = false;
  });
}

// ── Public API ──────────────────────────────────────────────────────

export async function enter(ctx) {
  await _ensureInit(ctx);
  _isActive = true;

  // Make sure the panel is visible and the FAB is hidden (CSS default
  // state for first open).
  const panel = document.getElementById('panelL');
  const fab = document.getElementById('panelFab');
  if (panel) panel.style.display = '';
  if (fab) fab.style.display = '';

  // Re-aim the camera at the purifier so the player gets a sensible
  // starting view of their build.
  if (_controls) {
    const p = ctx.placementOffset;
    _controls.target.set(p.x, p.y + 8, p.z);
    ctx.camera.position.set(p.x + 25, p.y + 20, p.z + 35);
    _controls.enabled = true;
    _controls.update();
  }
  ctx.markShadowsDirty?.();
}

export function exit() {
  _isActive = false;
  if (_controls) _controls.enabled = false;

  // Clear any held movement keys.
  _camKeys.w = _camKeys.a = _camKeys.s = _camKeys.d = false;
  _camKeys.space = _camKeys.shift = _camKeys.ctrl = false;

  const panel = document.getElementById('panelL');
  const fab = document.getElementById('panelFab');
  if (panel) panel.style.display = 'none';
  if (fab) fab.style.display = 'none';
}

export function isActive() { return _isActive; }

export function retargetControls(placement) {
  if (_controls) {
    _controls.target.set(placement.x, placement.y + 8, placement.z);
    _controls.update();
  }
}

export function resetWallFade() {
  if (_wallFade) _wallFade.resetAll();
}

export function tick(ts, dtSec, frameScale) {
  if (!_isActive || !_controls) return;
  _controls.update();

  if (_flyMode) {
    const baseSpd = 60;
    const sprint = _camKeys.ctrl ? 3.0 : 1.0;
    const spd = baseSpd * sprint * dtSec;
    if (_camKeys.w || _camKeys.s || _camKeys.a || _camKeys.d ||
      _camKeys.space || _camKeys.shift) {
      const cam = _ctx.camera;
      const fwd = _flyFwd.subVectors(_controls.target, cam.position);
      const fwdLen = fwd.length();
      if (fwdLen > 1e-4) fwd.multiplyScalar(1 / fwdLen);
      else fwd.set(0, 0, -1);
      const right = _flyRight.crossVectors(fwd, cam.up).normalize();
      _flyMove.set(0, 0, 0);
      if (_camKeys.w) _flyMove.addScaledVector(fwd, spd);
      if (_camKeys.s) _flyMove.addScaledVector(fwd, -spd);
      if (_camKeys.d) _flyMove.addScaledVector(right, spd);
      if (_camKeys.a) _flyMove.addScaledVector(right, -spd);
      if (_camKeys.space) _flyMove.y += spd;
      if (_camKeys.shift) _flyMove.y -= spd;
      cam.position.add(_flyMove);
      _controls.target.add(_flyMove);
    }
  } else if (_camKeys.w || _camKeys.a || _camKeys.s || _camKeys.d) {
    const rotSpd = 0.025;
    if (_camKeys.a) _controls.rotateLeft(rotSpd);
    if (_camKeys.d) _controls.rotateLeft(-rotSpd);
    if (_camKeys.w) _controls.rotateUp(rotSpd);
    if (_camKeys.s) _controls.rotateUp(-rotSpd);
  }

  if (_particles) {
    _particles.updateSpinSpeed(frameScale);
    _particles.update(frameScale);
  }
  if (_wallFade) {
    _wallFade.update(_ctx.camera, _controls.target, _flyMode);
  }
}
