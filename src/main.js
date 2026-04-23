// ─── Main entry point ───────────────────────────────────────────────
// Wires all modules together, initializes the scene, and starts the
// render loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import '@fontsource-variable/nunito-sans';
import './styles/main.css';

// ── Module imports ──────────────────────────────────────────────────

import { state } from './modules/state.js';
import { createRenderer, createScene } from './modules/renderer.js';
import { stdMat } from './modules/materials.js';
import * as lighting from './modules/lighting.js';
import * as music from './modules/music.js';
import * as particles from './modules/particles.js';
import * as catAppearance from './modules/cat-appearance.js';
import * as catAnimation from './modules/cat-animation.js';
import * as coins from './modules/coins.js';
import * as leaderboard from './modules/leaderboard.js';
import * as collision from './modules/game-collision.js';
import * as spatial from './modules/spatial.js';
import * as gameFp from './modules/game-fp.js';
import * as wallFade from './modules/wall-fade.js';
import { createRoom } from './modules/room.js';
import { createPurifier } from './modules/purifier.js';
import { initInteractions, coinBump } from './modules/ui-interactions.js';
import { initGlassShine } from './modules/glass-shine.js';
import { initPreviews, recolorClassicPreview } from './modules/cat-preview.js';
import { initToggleSwitches, initSegButtons, initDecorativeIcons, initClickableDivs, trapFocus, saveFocus } from './modules/a11y.js';
import {
  SHADOW_UPDATE_INTERVAL_MS, IDLE_FRAME_MS,
  QUALITY_DPR_TIERS_MOBILE, QUALITY_DPR_TIERS_DESKTOP
} from './modules/constants.js';

// ── Utilities (must be defined before wiring) ───────────────────────

// Toast notifications
const _toast = document.createElement('div');
_toast.className = 'toast';
_toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-12px);opacity:0;pointer-events:none;z-index:10001;background:rgba(8,12,18,0.88);color:#d9f3ff;border:1px solid rgba(145,222,255,0.35);border-radius:14px;padding:9px 16px;font-family:var(--font-ui);font-size:12px;font-weight:700;letter-spacing:0.4px;backdrop-filter:blur(16px);box-shadow:0 12px 32px rgba(0,0,0,0.35);transition:opacity 0.3s cubic-bezier(0.16,1,0.3,1),transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
document.body.appendChild(_toast);
let _toastTimer = null;

function showToast(text) {
  _toast.textContent = text || '';
  _toast.style.opacity = '1';
  _toast.style.transform = 'translateX(-50%) translateY(0)';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toast.style.opacity = '0';
    _toast.style.transform = 'translateX(-50%) translateY(-8px)';
  }, 1800);
}

function ensureGlassBlurCompat() {
  const blur = getComputedStyle(document.documentElement)
    .getPropertyValue('--glass-blur')
    .trim() || 'blur(24px)';
  // Keep key control surfaces blurred even if production CSS processing
  // collapses vendor-prefixed declarations differently.
  const els = document.querySelectorAll('.panel, .panel-fab, #fpControlsPanel');
  els.forEach((el) => {
    el.style.setProperty('backdrop-filter', blur);
    el.style.setProperty('-webkit-backdrop-filter', blur);
  });
}

// Shadow state
let _shadowDirtyOneShot = true;
let _lastShadowUpdateTs = 0;

function markShadowsDirty() {
  _shadowDirtyOneShot = true;
}

// ── Initialize ──────────────────────────────────────────────────────

console.log('[main] DIY Air Purifier — modular build');

// Scene + camera
const { scene, camera } = createScene();

// Renderer
const canvas = document.getElementById('c');
if (!canvas) throw new Error('Canvas element #c not found');
const renderer = createRenderer(canvas);

const _fpPerfState = {
  applied: false,
  prePixelRatio: renderer.getPixelRatio(),
  preShadowEnabled: renderer.shadowMap.enabled,
  preKeyCastShadow: false
};

function _getQualityDprCap() {
  const tiers = state.isMobile ? QUALITY_DPR_TIERS_MOBILE : QUALITY_DPR_TIERS_DESKTOP;
  return tiers[state.qualityTier] || tiers[0] || 1;
}

function _applyFpPerformanceProfile(fpActive) {
  if (fpActive === _fpPerfState.applied) return;
  _fpPerfState.applied = fpActive;

  if (fpActive) {
    _fpPerfState.prePixelRatio = renderer.getPixelRatio();
    _fpPerfState.preShadowEnabled = renderer.shadowMap.enabled;
    _fpPerfState.preKeyCastShadow = !!lighting.key?.castShadow;

    // Aggressive play-mode profile for very high FPS targets.
    const fpDprCap = state.isMobile ? 0.42 : 0.5;
    renderer.setPixelRatio(Math.min(_fpPerfState.prePixelRatio, fpDprCap));
    renderer.shadowMap.enabled = false;
    if (lighting.key) lighting.key.castShadow = false;
    _shadowDirtyOneShot = false;
    onResize();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, _getQualityDprCap()));
  renderer.shadowMap.enabled = _fpPerfState.preShadowEnabled;
  if (lighting.key) lighting.key.castShadow = _fpPerfState.preKeyCastShadow;
  markShadowsDirty();
  onResize();
}

// OrbitControls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI * 0.48;

// Lights
lighting.createLights(state.isMobile);

// Hide loading overlay
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.style.display = 'none';
ensureGlassBlurCompat();

// ── Build scene ─────────────────────────────────────────────────────

const roomRefs = createRoom(scene);
console.log('[main] Room created');

const purifierRefs = createPurifier(scene);
console.log('[main] Purifier created');

// Group all purifier meshes and set default "Under TV" placement
const purifierGroup = new THREE.Group();
{
  const toMove = [];
  scene.children.forEach(c => {
    // Skip lights, cameras, room objects, coins, cat, particles, and light targets
    if (c.isLight || c.isCamera || c._isRoom || c._isCoins || c === catAnimation.catGroup || c.isPoints) return;
    if (c === lighting.key.target || c === lighting.windowSun.target) return;
    if (c === lighting.ceilSpot?.target) return;
    toMove.push(c);
  });
  toMove.forEach(c => purifierGroup.add(c));
  scene.add(purifierGroup);
}
// Default placement: Under TV
const placementOffset = new THREE.Vector3(45, 0, -68);
purifierGroup.position.copy(placementOffset);
purifierGroup.rotation.y = 90 * Math.PI / 180;

// Show console props for Under TV mode (Xbox, Switch, game stack)
purifierRefs.showConsoleProps(true);
purifierRefs.showWallBracket(false);

// Position camera — orbit around the purifier (Under TV position)
camera.position.set(placementOffset.x + 25, 20, placementOffset.z + 35);
controls.target.set(placementOffset.x, 8, placementOffset.z);
controls.update();

// ── Wire time-of-day lighting ───────────────────────────────────────

const todRefs = {
  ceilLightOn: roomRefs.ceilLightOn,  // mutable — purifier.js updates via todRefs ref
  domeMat: roomRefs.domeMat,
  outdoor: roomRefs.outdoor,
  mirroredWindowX: roomRefs.mirroredWindowX,
  winCenterY: roomRefs.winCenterY,
  winCenterZ: roomRefs.winCenterZ,
  winW: roomRefs.winW,
  winTop: roomRefs.winTop,
  winBottom: roomRefs.winBottom,
  winFront: roomRefs.winFront,
  winBack: roomRefs.winBack,
  wallMeshes: roomRefs.wallMeshes,
  baseMeshes: roomRefs.baseMeshes,
  floorMat: roomRefs.floorMat,
  moonGlow: roomRefs.moonGlow,
  ceilSpot: roomRefs.ceilSpot,
  ceilGlow: roomRefs.ceilGlow,
  lampLight: roomRefs.lampLight,
  _markShadowsDirty: markShadowsDirty
};

// Apply initial time-of-day — default to 2:30 PM (matches monolith default)
lighting.applyTimeOfDay(870, todRefs);

// ── DEBUG: Light position helpers ──
// Visible colored orbs at each light source. Toggle via console:
//   window._debugLights(true/false)
{
  const _debugHelpers = [];
  function makeHelper(color, radius, lightOrPos, label) {
    const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), mat);
    mesh.renderOrder = 9999;
    mesh.visible = false;
    scene.add(mesh);
    _debugHelpers.push({ mesh, lightOrPos, label });
    return mesh;
  }
  // Ceiling spot (yellow)
  if (roomRefs.ceilSpot) makeHelper(0xffff00, 3, roomRefs.ceilSpot, 'ceilSpot');
  // Ceiling spot target (dark yellow)
  if (roomRefs.ceilSpot) makeHelper(0x888800, 2, roomRefs.ceilSpot.target, 'ceilSpot.target');
  // Ceiling glow (orange)
  if (roomRefs.ceilGlow) makeHelper(0xff8800, 2.5, roomRefs.ceilGlow, 'ceilGlow');
  // Lamp light (warm white)
  if (roomRefs.lampLight) makeHelper(0xffddaa, 2, roomRefs.lampLight, 'lampLight');
  // Moon glow (blue)
  if (roomRefs.moonGlow) makeHelper(0x4488ff, 2, roomRefs.moonGlow, 'moonGlow');
  // Key light (magenta)
  makeHelper(0xff00ff, 4, lighting.key, 'key (sun)');
  // Key target (cyan)
  makeHelper(0x00ffff, 3, lighting.key.target, 'key.target');

  // SpotLightHelper for ceiling
  let _ceilSpotHelper = null;
  if (roomRefs.ceilSpot) {
    _ceilSpotHelper = new THREE.SpotLightHelper(roomRefs.ceilSpot, 0xffff00);
    _ceilSpotHelper.visible = false;
    scene.add(_ceilSpotHelper);
  }

  window._debugLights = function(show) {
    _debugHelpers.forEach(h => {
      h.mesh.visible = !!show;
      if (show) {
        // Sync position from the light/object
        const p = h.lightOrPos.position || h.lightOrPos;
        h.mesh.position.copy(p);
        console.log(`[DEBUG] ${h.label} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
        if (h.lightOrPos.intensity !== undefined) {
          console.log(`  intensity: ${h.lightOrPos.intensity.toFixed(1)}`);
        }
      }
    });
    if (_ceilSpotHelper) {
      _ceilSpotHelper.visible = !!show;
      if (show) _ceilSpotHelper.update();
    }
    if (show) console.log('[DEBUG] Light helpers ON — colored orbs visible at light positions');
    else console.log('[DEBUG] Light helpers OFF');
  };
  console.log('[main] Light debug helpers ready — call _debugLights(true) in console to show');
}

// Force shadow update after TOD repositions lights
_shadowDirtyOneShot = true;

// Wire room refs into purifier for click interactions (lamp, ceiling light, window)
purifierRefs.setRoomRefs({
  lampLight: roomRefs.lampLight,
  lampShade: roomRefs.lampShade,
  ceilSpot: roomRefs.ceilSpot,
  domeMat: roomRefs.domeMat,
  ceilGlow: roomRefs.ceilGlow,
  outdoor: roomRefs.outdoor,
  todRefs,  // so purifier can sync ceilLightOn state
  markShadowsDirty,
  applyTimeOfDay: (minutes) => {
    lighting.applyTimeOfDay(minutes, todRefs);
    const todLabel = document.getElementById('todLabel');
    if (todLabel) todLabel.textContent = lighting.formatTime(minutes);
    markShadowsDirty();
  },
  toggleMacbook: roomRefs.toggleMacbook,
  toggleCornerDoor: roomRefs.toggleCornerDoor
});

// ── Wire module cross-references ────────────────────────────────────

music.setToastFn(showToast);
coins.setToastFn(showToast);

// Create coin group + spawn room coins
const coinGroup = coins.createCoinGroup(scene);
coins.spawnRoomCoins(roomRefs);

function _syncQuickCoinToggleState() {
  const tog = document.getElementById('togQuickCoin');
  if (!tog) return;
  const isOn = coins.isQuickCoinMode();
  tog.classList.toggle('on', isOn);
  tog.setAttribute('aria-checked', isOn ? 'true' : 'false');
}

_syncQuickCoinToggleState();

// ── Cat ─────────────────────────────────────────────────────────────

scene.add(catAnimation.catGroup);
catAnimation.catGroup.visible = true;

catAnimation.loadGameplayCat({
  applyCatColorToModel: catAnimation.applyColorToAll
});

// ── Particles ───────────────────────────────────────────────────────

particles.init();

// ── Wall auto-fade ──────────────────────────────────────────────────

wallFade.init(scene, roomRefs);

// ── Leaderboard + finish dialog ──────────────────────────────────────

leaderboard.init();
leaderboard.setCallbacks({
  onPlayAgain: () => window._playAgain(),
  onExitGame: () => window._exitFP()
});

// ── Game mode ───────────────────────────────────────────────────────

gameFp.init({
  camera,
  canvas,
  controls,
  catGroup: catAnimation.catGroup,
  scene,
  placementOffset,
  purifierGroup,
  purifierRefs,
  markShadowsDirty,
  showToast,
  roomRefs
});

// Apply persisted mute settings to all active audio sources.
coins.setSfxMuted(gameFp.sfxMuted);
music.setMuted(gameFp.musicMuted);
if (roomRefs && typeof roomRefs.setMacbookMuted === 'function') {
  roomRefs.setMacbookMuted(gameFp.musicMuted);
}

// Expose bridge functions for HTML onclick handlers

// Character select screen
let _selectedModel = 'classic';
let _selectedColor = 'charcoal';
const _PLAY_PATH_AUTO_OPEN = /^\/play\/?$/.test(window.location.pathname);

let _previewsInited = false;
let _charSelectFocusTrap = null;
let _charSelectSavedFocus = null;
window._openCharSelect = () => {
  // Release pointer lock if held
  if (document.pointerLockElement) document.exitPointerLock();
  const cs = document.getElementById('charSelect');
  if (cs) {
    cs.classList.add('open');
    // Focus management
    _charSelectSavedFocus = saveFocus();
    _charSelectFocusTrap = trapFocus(cs);
    // Focus the start button after layout
    requestAnimationFrame(() => {
      const startBtn = cs.querySelector('.char-start');
      if (startBtn) startBtn.focus();
    });
  }
  // Init 3D previews on first open — defer to next frame so canvases have layout
  if (!_previewsInited) {
    _previewsInited = true;
    requestAnimationFrame(() => initPreviews());
  }
  // Highlight the previously selected model (or classic on first open)
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
  const activeCard = document.querySelector(`.char-card[data-model="${_selectedModel}"]`);
  if (activeCard) activeCard.classList.add('selected');
  // Show/hide color dots based on current selection
  const colorSection = document.getElementById('classicColors');
  if (colorSection) colorSection.style.visibility = _selectedModel === 'classic' ? 'visible' : 'hidden';
};

window._closeCharSelect = () => {
  const cs = document.getElementById('charSelect');
  if (cs) cs.classList.remove('open');
  if (_charSelectFocusTrap) { _charSelectFocusTrap.release(); _charSelectFocusTrap = null; }
  if (_charSelectSavedFocus) { _charSelectSavedFocus.restore(); _charSelectSavedFocus = null; }
};

// Escape key closes char select
document.getElementById('charSelect')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    window._closeCharSelect();
  }
});

if (_PLAY_PATH_AUTO_OPEN) {
  setTimeout(() => {
    if (!gameFp.fpMode) window._openCharSelect();
  }, 120);
}

window._selectCat = (model, el) => {
  _selectedModel = model;
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // Show/hide color dots (only for colorable models) — use visibility to preserve layout
  const colorSection = document.getElementById('classicColors');
  if (colorSection) colorSection.style.visibility = model === 'classic' ? 'visible' : 'hidden';
};

window._selectColor = (color, el) => {
  _selectedColor = color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('on'));
  if (el) el.classList.add('on');
  // Update the 3D preview color
  const colorMap = { charcoal: 0x0a0a12, cream: 0xB08030, midnight: 0x040818, snow: 0xd8d8d8 };
  recolorClassicPreview(colorMap[color] || 0x0a0a12);
};

window._startGame = () => {
  const cs = document.getElementById('charSelect');
  if (cs) cs.classList.remove('open');
  // Release focus trap
  if (_charSelectFocusTrap) { _charSelectFocusTrap.release(); _charSelectFocusTrap = null; }
  if (_charSelectSavedFocus) { _charSelectSavedFocus.restore(); _charSelectSavedFocus = null; }
  // Apply cat selection
  catAppearance.setCatModelKeyRaw(_selectedModel);
  if (catAppearance.isColorable(_selectedModel)) {
    catAppearance.setCatColorKeyRaw(_selectedColor);
  }
  // Reload cat model with new selection
  catAnimation.loadGameplayCat({
    applyCatColorToModel: catAnimation.applyColorToAll
  });
  // Enter game mode
  gameFp.toggleFirstPerson();
  wallFade.resetAll();
};

// G key opens character select instead of directly entering game
window._toggleFP = () => {
  if (gameFp.fpMode) {
    gameFp.toggleFirstPerson(); // exit
  } else {
    window._openCharSelect(); // open character select
  }
};
window._pauseFP = () => gameFp.setPaused(true);
window._resumeFP = () => gameFp.setPaused(false);
window._resetFP = () => {
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  gameFp.releasePauseFocusTrap();
  gameFp.clearPauseState();
  leaderboard.resetTimer();
  coins.fullReset();
  void leaderboard.startSharedRun();
  gameFp.toggleFirstPerson();
  setTimeout(() => window._openCharSelect(), 100);
};
window._exitFP = () => {
  // Close any overlays first
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  const pause = document.getElementById('fpPauseOverlay');
  if (pause) pause.style.display = 'none';
  // Release pointer lock
  if (document.pointerLockElement) document.exitPointerLock();
  // Release focus trap from pause overlay
  gameFp.releasePauseFocusTrap();
  // Clear pause without triggering re-lock (setPaused(false) would re-lock pointer)
  gameFp.clearPauseState();
  if (gameFp.fpMode) gameFp.toggleFirstPerson();
};
window._toggleMuteSfx = (checked) => {
  gameFp.setSfxMuted(checked);
  coins.setSfxMuted(checked);
};
window._toggleMuteMusic = (checked) => {
  gameFp.setMusicMuted(checked);
  // Mute all music sources wired in this app.
  music.setMuted(checked);
  if (roomRefs && typeof roomRefs.setMacbookMuted === 'function') {
    roomRefs.setMacbookMuted(checked);
  }
};
window._syncAudioUi = () => gameFp.syncAudioToggleUi();
window._switchCamFP = () => gameFp.setCamMode();
window._playAgain = () => {
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  gameFp.releasePauseFocusTrap();
  gameFp.clearPauseState();
  gameFp.toggleFirstPerson();
  setTimeout(() => window._openCharSelect(), 100);
};

// ── Panel control bridges ───────────────────────────────────────────

// Time-of-day slider
window._setTOD = (val) => {
  const m = parseInt(val, 10);
  lighting.applyTimeOfDay(m, todRefs);
  const todLabel = document.getElementById('todLabel');
  if (todLabel) todLabel.textContent = lighting.formatTime(m);
  markShadowsDirty();
};

// Turntable
window._setTurntable = (val) => {
  purifierGroup.rotation.y = parseFloat(val) * Math.PI / 180;
};

// Fan speed
window._setFanSpeed = (val) => {
  purifierRefs.setFanSpeed(parseInt(val, 10) / 1800 * 100);
};

// Spin toggle
window._toggleSpin = () => {
  const tog = document.getElementById('togSpin');
  const isOn = tog && tog.classList.toggle('on');
  purifierRefs.setSpinning(!!isOn);
};

// Placement
let _prevPlacement = 'tv';
window._setPlacement = (mode) => {
  const offsets = spatial.PLACEMENT_OFFSETS[mode] || spatial.PLACEMENT_OFFSETS.floor;
  placementOffset.set(offsets.x, offsets.y, offsets.z);
  purifierGroup.position.copy(placementOffset);

  // Rotation + visibility: TV and Wall both rotate 90°
  if (mode === 'tv' || mode === 'wall') {
    purifierGroup.rotation.y = Math.PI / 2;
    purifierRefs.showConsoleProps(mode === 'tv');
    purifierRefs.showWallBracket(mode === 'wall');
  } else {
    purifierGroup.rotation.y = 0;
    purifierRefs.showConsoleProps(false);
    purifierRefs.showWallBracket(false);
  }

  // Auto-toggle feet for wall mount (no feet on wall)
  if (mode === 'wall') {
    purifierRefs.setFeetStyle('none');
  } else if (_prevPlacement === 'wall') {
    purifierRefs.setFeetStyle('bun'); // restore default
  }
  _prevPlacement = mode;

  // Update UI
  const ts = document.getElementById('turntableSlider');
  const tl = document.getElementById('turntableLabel');
  const deg = Math.round(purifierGroup.rotation.y * 180 / Math.PI);
  if (ts) ts.value = deg;
  if (tl) tl.textContent = deg + '°';
  document.querySelectorAll('#btnPlaceFloor,#btnPlaceTv,#btnPlaceWall').forEach(b => b.classList.remove('on'));
  const btnId = mode === 'tv' ? 'btnPlaceTv' : mode === 'wall' ? 'btnPlaceWall' : 'btnPlaceFloor';
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add('on');

  // Re-aim camera at the purifier
  controls.target.set(placementOffset.x, placementOffset.y + 8, placementOffset.z);
  camera.position.set(placementOffset.x + 25, placementOffset.y + 20, placementOffset.z + 35);
  controls.update();
  markShadowsDirty();
};

// FPS toggle
window._toggleFps = () => {
  const fpsEl = document.getElementById('fps');
  const tog = document.getElementById('togFps');
  if (fpsEl) fpsEl.style.display = fpsEl.style.display === 'none' ? '' : 'none';
  if (tog) tog.classList.toggle('on');
};

window._toggleQuickCoin = () => {
  const next = !coins.isQuickCoinMode();
  coins.setQuickCoinMode(next);
  coins.fullReset();

  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  if (gameFp.fpMode) leaderboard.startTimer();
  else leaderboard.resetTimer();
  void leaderboard.startSharedRun();

  const coinHudCount = document.getElementById('coinCount');
  if (coinHudCount) coinHudCount.textContent = `${coins.coinScore}/${coins.coinTotal}`;
  const secretHudCount = document.getElementById('secretCoinCount');
  if (secretHudCount) secretHudCount.textContent = String(coins.coinSecretScore || 0);

  _syncQuickCoinToggleState();
  showToast(next ? 'Quick coin mode on' : 'Quick coin mode off');
};

// Mobile jump
window._mobileJump = (down) => {
  gameFp.fpKeys.space = !!down;
};

// ── Purifier control bridges ────────────────────────────────────────

window._toggleExplode = () => purifierRefs.toggleExplode();
window._toggleFilter = () => purifierRefs.toggleFilter();
window._toggleGrills = () => purifierRefs.toggleGrills();
window._setGrillColor = (c) => purifierRefs.setGrillColor(c);
window._toggleDims = () => purifierRefs.toggleDimensions();

window._setStain = (mode) => {
  purifierRefs.setStain(mode);
};

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
};

window._setFootDia = (val) => {
  purifierRefs.setFootDiameter(parseFloat(val));
  markShadowsDirty();
};

const _initialBunFootH = state.bunFootH;
let _footYOffset = 0; // tracks Y shift from foot height changes

window._setFootHt = (val) => {
  const newH = parseFloat(val);
  purifierRefs.setFootHeight(newH);
  // Move the purifier group so the bottom stays on the floor
  const newOffset = newH - _initialBunFootH;
  const delta = newOffset - _footYOffset;
  _footYOffset = newOffset;
  purifierGroup.position.y += delta;
  placementOffset.y += delta;
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
  // Toggle room visibility
  scene.traverse(obj => {
    if (obj._isRoom) obj.visible = !isOn;
  });
  // Adjust fog/background
  if (isOn) {
    scene.fog.density = 0;
    renderer.setClearColor(0x0a0e14, 1);
  } else {
    lighting.applyTimeOfDay(parseInt(document.getElementById('todSlider')?.value || '870', 10), todRefs);
  }
  markShadowsDirty();
};

// ── Orbit mode keyboard camera ──────────────────────────────────────
// W/S = tilt up/down, A/D = rotate left/right around the target.

const _camKeys = { w: false, a: false, s: false, d: false };
document.addEventListener('keydown', e => {
  if (gameFp.fpMode) return;
  if (leaderboard.isNameDialogOpen()) return;
  const cs = document.getElementById('charSelect');
  if (cs && cs.classList.contains('open')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
    _camKeys[k] = true;
    e.preventDefault();
  }
});
document.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') _camKeys[k] = false;
});

// ── Render loop ─────────────────────────────────────────────────────

let _lastFrameTs = 0;
let _fpsFrames = 0;
let _fpsLast = performance.now();
let _lastCatX = null, _lastCatZ = null;

// Cached DOM refs for per-frame updates
const _elRunTimer = document.getElementById('runTimerText');
const _elFps = document.getElementById('fps');
const _elPauseOv = document.getElementById('fpPauseOverlay');

function animate(ts) {
  requestAnimationFrame(animate);

  _applyFpPerformanceProfile(gameFp.fpMode);

  // Frame timing
  const rawDt = ts - (_lastFrameTs || ts);
  _lastFrameTs = ts;
  const dtSec = Math.min(rawDt / 1000, 0.1);
  const animFrameScale = dtSec * 60;

  // Controls (only in orbit mode)
  if (!gameFp.fpMode) {
    controls.update();
    // WASD orbit: A/D rotate around target, W/S tilt up/down
    if (_camKeys.w || _camKeys.a || _camKeys.s || _camKeys.d) {
      const rotSpd = 0.025; // radians per frame
      if (_camKeys.a) controls.rotateLeft(rotSpd);
      if (_camKeys.d) controls.rotateLeft(-rotSpd);
      if (_camKeys.w) controls.rotateUp(rotSpd);
      if (_camKeys.s) controls.rotateUp(-rotSpd);
    }
  }

  // Game mode physics
  gameFp.updatePhysics(ts, dtSec, animFrameScale);

  // Coins (spin/bob/pickup) — only active in game mode
  if (gameFp.fpMode) {
    const prevScore = coins.coinScore;
    coins.updateCoins(ts, gameFp.fpPos);
    if (coins.coinScore > prevScore) coinBump();
    // Timer tick
    leaderboard.tickTimer(ts);
    if (_elRunTimer) _elRunTimer.textContent = leaderboard.formatRunTime(leaderboard.getElapsed());
    // Check for run completion (all regular coins collected)
    if (coins.coinScore >= coins.coinTotal && coins.coinTotal > 0 && !leaderboard.isFinished()) {
      leaderboard.stopTimer();
      const finalTime = leaderboard.getElapsed();
      gameFp.setPaused(true);
      // Hide the regular pause overlay (finish takes precedence)
      if (_elPauseOv) _elPauseOv.style.display = 'none';
      // Open finish screen immediately and let player edit name inline
      // before saving this run.
      leaderboard.openFinishDialogForRun(finalTime, coins.coinTotal, coins.coinSecretScore);
    }
  }

  // Cat animation mixer + walk/idle blend
  if (catAnimation.catMixer) {
    const preset = catAppearance.getSelectedModelPreset();
    const catAnimSpeed = Math.max(0.12, Number(preset.animSpeed) || 1);
    const isBababooey = catAppearance.catModelKey === 'bababooey';
    const hasWalkClip = !!catAnimation.catWalkAction;
    const hasIdleClip = !!catAnimation.catIdleAction;

    // Keep speed derived from actual travel distance, with blend smoothing and
    // hysteresis so cat clips don't flicker between idle/walk around thresholds.
    const prevX = Number.isFinite(_lastCatX) ? _lastCatX : gameFp.fpPos.x;
    const prevZ = Number.isFinite(_lastCatZ) ? _lastCatZ : gameFp.fpPos.z;
    const vel = gameFp.fpMode
      ? Math.hypot(gameFp.fpPos.x - prevX, gameFp.fpPos.z - prevZ)
      : 0;
    const animDt = dtSec * catAnimSpeed;
    const st = catAnimation.catMixer.userData || (catAnimation.catMixer.userData = {});
    if (!Number.isFinite(st._moveBlend)) st._moveBlend = vel > 0.03 ? 1 : 0;
    let targetMove = st._moveBlend;
    if (vel > 0.04) targetMove = 1;
    else if (vel < 0.02) targetMove = 0;
    const moveEase = 1 - Math.exp(-animDt * 9.5);
    st._moveBlend += (targetMove - st._moveBlend) * moveEase;
    const moveBlend = Math.max(0, Math.min(1, st._moveBlend));

    if (!Number.isFinite(st._idleProceduralBlend)) st._idleProceduralBlend = 0;
    const idleTarget = Math.max(0, Math.min(1, 1 - moveBlend));
    const idleEase = 1 - Math.exp(-animDt * 7.0);
    st._idleProceduralBlend += (idleTarget - st._idleProceduralBlend) * idleEase;
    const idleBlend = Math.max(0, Math.min(1, st._idleProceduralBlend));

    const sprintMult = Math.max(1, Number(preset.sprintAnimMult) || 1);
    const sprinting = gameFp.fpMode && gameFp.fpKeys.shift && vel > 0.1;
    const sprintBoost = sprinting ? sprintMult : 1;

    if (hasWalkClip) {
      catAnimation.catWalkAction.paused = false;
      if (isBababooey) {
        // Bababooey has a single bouncy clip: run it subtly at idle, then ramp up.
        const idleTs = 0.18;
        const runTs = (0.85 + vel * 40) * sprintBoost;
        catAnimation.catWalkAction.timeScale = idleTs + (runTs - idleTs) * moveBlend;
      } else {
        const walkBaseTs = catAppearance.catModelKey === 'toon'
          ? (0.9 + vel * 2.2)
          : (0.8 + vel * 2.0);
        const walkTargetTs = walkBaseTs * sprintBoost;
        const walkTs = Number(catAnimation.catWalkAction.timeScale) || walkTargetTs;
        catAnimation.catWalkAction.timeScale += (walkTargetTs - walkTs) * Math.min(1, dtSec * 6);
      }
    }

    if (hasWalkClip && hasIdleClip) {
      const walkW = Math.min(1, vel / 0.25) * moveBlend;
      catAnimation.catWalkAction.weight = walkW;
      catAnimation.catIdleAction.weight = (1 - walkW) * moveBlend;
      catAnimation.catIdleAction.paused = false;
    } else if (hasWalkClip && !isBababooey) {
      // If there's no dedicated idle clip, freeze the walk loop when stationary.
      catAnimation.catWalkAction.weight = 1;
      catAnimation.catWalkAction.paused = moveBlend < 0.03;
    }

    if (isBababooey) {
      if (!Number.isFinite(st._bababooeyRunBlend)) st._bababooeyRunBlend = 0;
      const runTarget = Math.min(1, vel / 0.25) * moveBlend;
      const runEase = 1 - Math.exp(-dtSec * 5.0);
      st._bababooeyRunBlend += (runTarget - st._bababooeyRunBlend) * runEase;
      const runBlend = Math.max(0, Math.min(1, st._bababooeyRunBlend));
      if (hasWalkClip) catAnimation.catWalkAction.weight *= (1 - runBlend);
      if (hasIdleClip) catAnimation.catIdleAction.weight *= (1 - runBlend);
      st._bababooeyRunBlendSmoothed = runBlend;
    }

    const loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
    const loopAction = catAnimation.catIdleAction || catAnimation.catWalkAction;
    if (loopPause > 0 && loopAction) {
      catAnimation.applyLoopPause(loopAction, ts, loopPause, idleBlend > 0.35 && vel < 0.03);
    }

    // Bababooey keeps subtle bounce motion at idle; other cats pause clip
    // playback and rely on procedural idle when not moving.
    let mixerDt = animDt;
    if (!isBababooey) mixerDt *= moveBlend;
    catAnimation.catMixer.update(Math.max(0, mixerDt));

    if (idleBlend < 0.2) catAnimation.refreshGameplayIdleBasePose();
    if (idleBlend > 0.001) catAnimation.applyGameplayProceduralIdle(ts, idleBlend);

    if (isBababooey && moveBlend > 0.001) {
      const runBlend = Number(st._bababooeyRunBlendSmoothed) || 0;
      if (runBlend > 0.001) catAnimation.applyBababooeyProceduralRun(ts, vel, runBlend);
    }

    // Bababooey idle squish — gentle breathing when standing still
    if (isBababooey && idleBlend > 0.001) {
      catAnimation.applyBababooeyIdleSquish(ts, idleBlend);
    }

    // Reset position/rotation to base and pin all cats to the ground
    // each frame (box-based). Must happen AFTER procedural animations
    // but BEFORE jump deform.
    if (gameFp.fpMode) {
      catAnimation.resetAndPinGameplayCat();
      catAnimation.applyGameplayJumpDeform({
        dtSec,
        vy: gameFp.fpVy,
        holdFrames: gameFp.getJumpHoldFrames(),
        modelKey: catAppearance.catModelKey
      });
    }

    if (gameFp.fpMode) {
      _lastCatX = gameFp.fpPos.x;
      _lastCatZ = gameFp.fpPos.z;
    }
  }

  // Purifier animations (fan spin, explode lerp, filter/drawer/bifold)
  purifierRefs.update(dtSec, animFrameScale);

  // Particles
  particles.updateSpinSpeed(animFrameScale);
  particles.update(animFrameScale);

  // Wall auto-fade (only in orbit mode — FP resets to opaque)
  if (!gameFp.fpMode) {
    wallFade.update(camera, controls.target);
  }

  // Shadow throttle — update on dirty flag OR periodically
  const shadowIntervalMs = gameFp.fpMode ? Math.max(SHADOW_UPDATE_INTERVAL_MS, 1000 / 8) : SHADOW_UPDATE_INTERVAL_MS;
  if (renderer.shadowMap.enabled && (_shadowDirtyOneShot || (ts - _lastShadowUpdateTs) >= shadowIntervalMs)) {
    renderer.shadowMap.needsUpdate = true;
    _shadowDirtyOneShot = false;
    _lastShadowUpdateTs = ts;
  }

  // Render
  renderer.render(scene, camera);

  // FPS counter
  _fpsFrames++;
  const fpsNow = performance.now();
  if (fpsNow - _fpsLast >= 1000) {
    const ms = (fpsNow - _fpsLast) / _fpsFrames;
    const ri = renderer.info.render;
    if (_elFps) _elFps.textContent = _fpsFrames + 'fps ' + ms.toFixed(1) + 'ms | ' + ri.calls + 'dc ' + ri.triangles + 'tri';
    _fpsFrames = 0;
    _fpsLast = fpsNow;
  }
}

// ── Window resize ───────────────────────────────────────────────────

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// ── Start ───────────────────────────────────────────────────────────

animate(performance.now());

// Init UI micro-interactions (bouncy buttons, press effects)
initInteractions();

// Glass shine: cursor-tracking highlight + click ripple on glass buttons
initGlassShine();

// Accessibility: toggle-switch keyboard support + seg-button aria-pressed
initToggleSwitches();
initSegButtons();
initDecorativeIcons();
initClickableDivs();
_syncQuickCoinToggleState();

// Wire share button click
const _shareBtn = document.getElementById('fpShareBtn');
if (_shareBtn) _shareBtn.addEventListener('click', () => leaderboard.copyLastResult());

// Scroll fade on panel-scroll — fade bottom edge when more content below
{
  const ps = document.querySelector('.panel-scroll');
  if (ps) {
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
}

console.log('[main] Render loop started');
