// ─── Main entry point ───────────────────────────────────────────────
// Wires all modules together, initializes the scene, and starts the
// render loop.

import * as THREE from 'three';
import '@fontsource-variable/nunito-sans';
// main.css is loaded via <link rel="stylesheet"> in the HTML head so the
// full splash UI (which doubles as the loading screen) paints styled on
// the very first frame, instead of waiting for this JS module to import
// and inject it.

// ── Module imports ──────────────────────────────────────────────────

import { state } from './modules/state.js';
import { createRenderer, createScene } from './modules/renderer.js';
import { stdMat } from './modules/materials.js';
import * as lighting from './modules/lighting.js';
import * as music from './modules/music.js';
import * as catAppearance from './modules/cat-appearance.js';
import * as catAnimation from './modules/cat-animation.js';
import * as coins from './modules/coins.js';
import * as leaderboard from './modules/leaderboard.js';
import * as collision from './modules/game-collision.js';
import * as spatial from './modules/spatial.js';
import * as gameFp from './modules/game-fp.js';
import * as fireball from './modules/fireball.js';
import * as kamehameha from './modules/kamehameha.js';
import { createRoom } from './modules/room.js';
import * as purifier from './modules/purifier.js';
import { createPurifier } from './modules/purifier.js';
import { initInteractions, coinBump, secretCoinBump } from './modules/ui-interactions.js';
import { initGlassShine } from './modules/glass-shine.js';
let _catPreviewMod = null;
let _catPreviewPromise = null;
function _loadCatPreview() {
  if (_catPreviewMod) return Promise.resolve(_catPreviewMod);
  if (!_catPreviewPromise) {
    _catPreviewPromise = import('./modules/cat-preview.js').then(m => {
      _catPreviewMod = m;
      return m;
    });
  }
  return _catPreviewPromise;
}
const initPreviews = (...args) => _loadCatPreview().then(m => m.initPreviews(...args));
const flushPreviewsOnOpen = (...args) => _loadCatPreview().then(m => m.flushPreviewsOnOpen(...args));
import { initToggleSwitches, initSegButtons, initDecorativeIcons, initClickableDivs, trapFocus, saveFocus } from './modules/a11y.js';
import {
  SHADOW_UPDATE_INTERVAL_MS, IDLE_FRAME_MS,
  QUALITY_DPR_TIERS_MOBILE, QUALITY_DPR_TIERS_DESKTOP
} from './modules/constants.js';

// ── Utilities (must be defined before wiring) ───────────────────────

// Toast notifications
const _toast = document.createElement('div');
_toast.className = 'toast';
const _TOAST_TRANSITION = [
  'opacity 0.28s cubic-bezier(0.16,1,0.3,1)',
  'transform 0.44s cubic-bezier(0.34,1.56,0.64,1)',
  'filter 0.44s cubic-bezier(0.16,1,0.3,1)'
].join(',');
_toast.style.cssText = `position:fixed;left:50%;top:34px;transform:translate(-50%, -18%) scale(0.5);transform-origin:50% 50%;opacity:0;filter:blur(8px);pointer-events:none;z-index:10001;background:rgba(8,12,18,0.88);color:#d9f3ff;border:1px solid rgba(145,222,255,0.35);border-radius:14px;padding:9px 16px;font-family:var(--font-ui);font-size:12px;font-weight:700;letter-spacing:0.4px;text-align:center;max-width:min(84vw,560px);backdrop-filter:blur(16px);box-shadow:0 12px 32px rgba(0,0,0,0.35);will-change:transform,opacity,filter;transition:${_TOAST_TRANSITION}`;
document.body.appendChild(_toast);
let _toastTimer = null;
let _toastRaf = 0;

function _getToastPose() {
  const hudContainer = document.querySelector('#fpHud .run-hud-center');
  const timerHud = document.getElementById('runTimerHud');
  const anchorEl = (hudContainer && hudContainer.getClientRects().length > 0)
    ? hudContainer
    : ((timerHud && timerHud.getClientRects().length > 0) ? timerHud : null);
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const gapPx = Math.max(8, Math.round(rect.height * 0.18));
    const emergeTravelPx = Math.max(16, Math.round(rect.height * 0.62));
    return {
      left: rect.left + (rect.width * 0.5),
      top: rect.bottom + gapPx,
      origin: '50% 0%',
      seed: `translate(-50%, ${-emergeTravelPx}px) scale(0.24)`,
      enter: 'translate(-50%, 0px) scale(1)',
      exit: 'translate(-50%, 14px) scale(0.9)'
    };
  }
  return {
    left: window.innerWidth * 0.5,
    top: 34,
    origin: '50% 50%',
    seed: 'translate(-50%, -18%) scale(0.5)',
    enter: 'translate(-50%, -50%) scale(1)',
    exit: 'translate(-50%, -76%) scale(0.92)'
  };
}

function showToast(text) {
  const pose = _getToastPose();
  _toast.textContent = text || '';
  _toast.style.left = `${pose.left}px`;
  _toast.style.top = `${pose.top}px`;
  _toast.style.transformOrigin = pose.origin;

  // Restart animation from a compressed, blurred state so the toast
  // appears to bloom out of the timer instead of popping over it.
  _toast.style.transition = 'none';
  _toast.style.opacity = '0';
  _toast.style.filter = 'blur(8px)';
  _toast.style.transform = pose.seed;
  void _toast.offsetWidth;
  _toast.style.transition = _TOAST_TRANSITION;

  if (_toastRaf) cancelAnimationFrame(_toastRaf);
  _toastRaf = requestAnimationFrame(() => {
    _toast.style.opacity = '1';
    _toast.style.filter = 'blur(0px)';
    _toast.style.transform = pose.enter;
  });

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toast.style.opacity = '0';
    _toast.style.filter = 'blur(5px)';
    _toast.style.transform = pose.exit;
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

// Renderer (must exist before createScene so PMREM env map can be built)
const canvas = document.getElementById('c');
if (!canvas) throw new Error('Canvas element #c not found');
const renderer = createRenderer(canvas);

// Scene + camera
const { scene, camera } = createScene();

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
    // Shadows stay enabled. Shadow throttle is DISABLED in FP mode
    // (see animate loop) — throttling at 8 Hz while rendering at 200+
    // FPS causes visible shadow jitter on moving casters. Updating
    // every frame is the only way to avoid the stepping artifact.
    markShadowsDirty();
    onResize();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, _getQualityDprCap()));
  renderer.shadowMap.enabled = _fpPerfState.preShadowEnabled;
  if (lighting.key) lighting.key.castShadow = _fpPerfState.preKeyCastShadow;
  markShadowsDirty();
  onResize();
}

// OrbitControls + customization aside live in the lazy `inspector-mode.js`
// chunk. We dynamic-import on first pause-menu Inspect click. The
// promise is cached so subsequent enter()s reuse the loaded module.
let _inspectorMod = null;
let _inspectorPromise = null;
function _loadInspector() {
  if (_inspectorMod) return Promise.resolve(_inspectorMod);
  if (!_inspectorPromise) {
    _inspectorPromise = import('./modules/inspector-mode.js').then(m => {
      _inspectorMod = m;
      return m;
    });
  }
  return _inspectorPromise;
}

// Lights
lighting.createLights(state.isMobile);

// /play is now the immersive game route — the home menu (with the big
// Play button) lives at / instead. #titleSplash on this page is only
// the boot LOADING screen now: dark scrim while three.js mounts, then
// dismissed once the first frame paints. The user explicitly navigated
// to /play, so as soon as we're ready we open the character picker
// directly; there's no menu step in between.
//
// Exception: when we're mounted as the home page's bgFrame (?bg=1 +
// inside an iframe), DON'T auto-open the picker on boot. The home
// page's Play CTA "promotes" this iframe out of background mode via
// a postMessage; at that point we drop is-bg AND open the picker as
// one motion. Auto-opening here would mean the picker is technically
// "open" the whole time the user is browsing /home, /about, /leader-
// board — it'd just be invisible (chrome hidden by html.is-bg CSS).
// Cleaner to wait until promotion.
const _isEmbedded = document.documentElement.classList.contains('is-embedded');
const splashEl = document.getElementById('titleSplash');
function _markSplashReady() {
  window._appReady = true;
  if (!splashEl) return;
  if (splashEl.dataset.state === 'ready') return;
  splashEl.dataset.state = 'ready';
  // Hide the loading scrim and jump straight into character select. We
  // defer one frame so the state-flip CSS has a chance to start before
  // the picker animates in over it.
  requestAnimationFrame(() => {
    splashEl.classList.remove('open');
    // Skip the picker auto-open when we're embedded as the home bg —
    // the parent's enter-play message will trigger it at the right
    // moment.
    if (_isEmbedded && document.documentElement.classList.contains('is-bg')) return;
    window._openCharSelect?.();
  });
}
ensureGlassBlurCompat();

// ── Build scene ─────────────────────────────────────────────────────

const roomRefs = createRoom(scene);
window._roomRefs = roomRefs;  // expose for purifier.js window-open click handler
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

// Position camera — orbit around the purifier (Under TV position).
// No OrbitControls yet (lazy-loaded on first Inspect click); use a one-
// shot lookAt so the initial framing is correct even before controls
// take over.
// Splash/post-game preview camera: hand-tuned in fly mode to frame
// the room from a high corner. Absolute coords (not purifier-relative)
// because this framing is about the room, not the purifier — the
// inspector retarget below handles purifier focus.
const SPLASH_CAM_POS = new THREE.Vector3(-47, 53, -61);
const SPLASH_CAM_LOOK = new THREE.Vector3(-11, 34, -43);
camera.position.copy(SPLASH_CAM_POS);
camera.lookAt(SPLASH_CAM_LOOK);

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
  moonGlow: roomRefs.moonGlow,
  ceilSpot: roomRefs.ceilSpot,
  ceilGlow: roomRefs.ceilGlow,
  lampLight: roomRefs.lampLight,
  _markShadowsDirty: markShadowsDirty
};

// Apply initial time-of-day from the real local clock so startup lighting
// matches what the player expects (instead of forcing bright mid-day).
const _now = new Date();
const _initMinute = _now.getHours() * 60 + _now.getMinutes();
const _initWindowIsNight = _initMinute < 360 || _initMinute >= 1140;
if (roomRefs.outdoor?.material && roomRefs.outdoorDayTex && roomRefs.outdoorNightTex) {
  roomRefs.outdoor.material.map = _initWindowIsNight ? roomRefs.outdoorNightTex : roomRefs.outdoorDayTex;
  roomRefs.outdoor.material.color.setHex(_initWindowIsNight ? 0x445566 : 0xfff0d4);
}
lighting.applyTimeOfDay(_initMinute, todRefs);
{
  const todSlider = document.getElementById('todSlider');
  if (todSlider) todSlider.value = _initMinute;
  const todLabel = document.getElementById('todLabel');
  if (todLabel) todLabel.textContent = lighting.formatTime(_initMinute);
}

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

  // CameraHelper for key light shadow frustum
  let _keyShadowHelper = null;
  {
    _keyShadowHelper = new THREE.CameraHelper(lighting.key.shadow.camera);
    _keyShadowHelper.visible = false;
    scene.add(_keyShadowHelper);
  }

  window._debugLights = function (show) {
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
    if (_keyShadowHelper) {
      _keyShadowHelper.visible = !!show;
      if (show) _keyShadowHelper.update();
    }
    if (show) console.log('[DEBUG] Light helpers ON — colored orbs visible at light positions');
    else console.log('[DEBUG] Light helpers OFF');
  };
  console.log('[main] Light debug helpers ready — call _debugLights(true) in console to show');
}

// Force shadow update after TOD repositions lights
_shadowDirtyOneShot = true;

// Pre-upload the day/night outdoor textures so the first day↔night toggle
// doesn't stall rendering while the GPU uploads a 512×512 canvas texture.
// Without this the first click on the window causes a visible stutter.
if (renderer.initTexture) {
  if (roomRefs.outdoorDayTex) renderer.initTexture(roomRefs.outdoorDayTex);
  if (roomRefs.outdoorNightTex) renderer.initTexture(roomRefs.outdoorNightTex);
}

// Wire room refs into purifier for click interactions (lamp, ceiling light, window)
purifierRefs.setRoomRefs({
  lampLight: roomRefs.lampLight,
  lampShade: roomRefs.lampShade,
  ceilSpot: roomRefs.ceilSpot,
  domeMat: roomRefs.domeMat,
  ceilGlow: roomRefs.ceilGlow,
  outdoor: roomRefs.outdoor,
  outdoorDayTex: roomRefs.outdoorDayTex,
  outdoorNightTex: roomRefs.outdoorNightTex,
  windowIsNight: _initWindowIsNight,
  todRefs,  // so purifier can sync ceilLightOn state
  markShadowsDirty,
  applyTimeOfDay: (minutes) => {
    lighting.applyTimeOfDay(minutes, todRefs);
    const todLabel = document.getElementById('todLabel');
    if (todLabel) todLabel.textContent = lighting.formatTime(minutes);
    markShadowsDirty();
  },
  toggleMacbook: roomRefs.toggleMacbook,
  toggleTV: roomRefs.toggleTV,
  toggleCornerDoor: roomRefs.toggleCornerDoor,
  toggleGuestDoor: roomRefs.toggleGuestDoor,
  toggleFoodBowl: roomRefs.toggleFoodBowl,
  getFoodBowlMesh: roomRefs.getFoodBowlMesh,
  setMiniSplitOn: roomRefs.setMiniSplitOn,
  isMiniSplitOn: roomRefs.isMiniSplitOn,
  resetMiniSplit: roomRefs.resetMiniSplit
});

// ── Wire module cross-references ────────────────────────────────────

music.setToastFn(showToast);
coins.setToastFn(showToast);
purifier.setToastFn(showToast);

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

// Quick coin mode is a dev-only toggle — only show the row on localhost so
// non-dev visitors can't accidentally flip it (their runs would then be
// flagged as test runs and hidden from the public leaderboard).
function _gateQuickCoinRowToLocalhost() {
  const row = document.getElementById('rowQuickCoin');
  if (!row) return;
  const host = String(window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  if (isLocal) row.hidden = false;
  else {
    // Force-disable any stale flag from previous visits so non-dev users
    // who toggled it before stop submitting test runs.
    if (coins.isQuickCoinMode()) coins.setQuickCoinMode(false);
  }
}
_gateQuickCoinRowToLocalhost();

_syncQuickCoinToggleState();

// ── Cat ─────────────────────────────────────────────────────────────

scene.add(catAnimation.catGroup);
catAnimation.catGroup.visible = true;

catAnimation.loadGameplayCat({
  applyCatColorToModel: catAnimation.applyColorToAll,
  onModelReady: () => {
    // Cat materials just arrived. Pre-build their shader programs now so
    // first render in game mode doesn't stutter compiling them mid-frame.
    try { renderer.compile(scene, camera); } catch (e) { }
  }
});

// ── Particles & wall-fade live in the lazy inspector chunk ─────────
// They're inspector-only effects (game mode skips both). No init here.

// ── Fireball ability ─────────────────────────────────────────────────

fireball.init({
  scene,
  camera,
  catGroup: catAnimation.catGroup,
  isFpMode: () => gameFp.fpMode
});
kamehameha.init({
  scene,
  camera,
  catGroup: catAnimation.catGroup,
  isFpMode: () => gameFp.fpMode,
  onOvercharge: () => _handleOvercharge()
});
// Surface persisted unlock immediately so the HUD/button reflect it
// on a fresh page load, without waiting for fans to be turned off.
setTimeout(() => { _updateFireballBtnVisibility(); }, 0);

// ── Wall auto-fade lives in the lazy inspector chunk ───────────────

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
  controls: null, // late-bound: inspector-mode calls gameFp.setControls() on first enter
  catGroup: catAnimation.catGroup,
  scene,
  placementOffset,
  purifierGroup,
  purifierRefs,
  markShadowsDirty,
  showToast,
  roomRefs,
  // Show the title splash any time we leave a run — covers G-key exits,
  // pause-menu exit, and the mobile X button. Skip if another flow has
  // already claimed the post-FP screen (inspector, char-select reset,
  // finish dialog) by setting the one-shot suppress flag.
  onExitFp: () => {
    if (gameFp.fpMode) return;
    if (_suppressSplashOnce) { _suppressSplashOnce = false; return; }
    if (leaderboard.isFinishDialogOpen && leaderboard.isFinishDialogOpen()) return;
    const cs = document.getElementById('charSelect');
    if (cs && cs.classList.contains('open')) return;
    window._openSplash?.();
  }
});

// Pre-warm Super Saiyan effect chain (aura mesh, halo, sparkle materials,
// env PointLight) at startup so first activation in a game run doesn't
// trigger a shader-recompile stutter. The env light is created visible=true
// with intensity=0 and stays that way — toggling .visible is what changes
// the active-light count and forces every PBR material to recompile.
gameFp.prewarmSuperSaiyan();

// Pre-build shader programs for everything currently in the scene (room,
// purifier, SS effects). Cat materials are compiled separately when the
// async cat model finishes loading (see loadGameplayCat onModelReady).
try { renderer.compile(scene, camera); } catch (e) { console.warn('renderer.compile failed', e); }

// Apply persisted mute settings to all active audio sources.
coins.setSfxMuted(gameFp.sfxMuted);
music.setMuted(gameFp.musicMuted);
if (roomRefs && typeof roomRefs.setMacbookMuted === 'function') {
  roomRefs.setMacbookMuted(gameFp.musicMuted);
}

// Expose bridge functions for HTML onclick handlers

// Character select screen
let _selectedModel = 'classic';
let _selectedMode = gameFp.isSpeedMode() ? 'speed' : (gameFp.isSkateMode() ? 'skate' : 'normal');

// Refresh the speed-mode pill's locked/unlocked state + progress label every
// time the character select opens. The unlock progresses across runs.
function _refreshSpeedPillLockState() {
  const speedPill = document.querySelector('.mode-pill[data-mode="speed"]');
  if (!speedPill) return;
  const unlocked = coins.hasFoundAllSecrets();
  const found = coins.getSecretFoundCount();
  const total = coins.getSecretTotal();
  speedPill.classList.toggle('locked', !unlocked);
  speedPill.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  // Swap the icon: lightning when unlocked, padlock when locked.
  const icon = speedPill.querySelector('i');
  if (icon) icon.className = unlocked ? 'ph ph-lightning' : 'ph ph-lock-simple';
  const sub = speedPill.querySelector('.mode-pill__sub');
  if (sub) {
    sub.textContent = unlocked
      ? '3× top speed · +12 coins'
      : `Find all secret coins to unlock (${found}/${total})`;
  }
  speedPill.title = unlocked
    ? 'Speed Mode: 3× top speed, 12 extra floating coins'
    : `Find all ${total} secret coins to unlock Speed Mode (${found}/${total} found)`;
  // If currently selected but no longer allowed, snap back to Normal.
  if (!unlocked && _selectedMode === 'speed') {
    _selectedMode = 'normal';
  }
}

// Refresh the skate-mode pill's locked/unlocked state. Unlocks once the
// player has picked up the hidden skateboard.
function _refreshSkatePillLockState() {
  const skatePill = document.querySelector('.mode-pill[data-mode="skate"]');
  if (!skatePill) return;
  const unlocked = gameFp.isSkateboardFound();
  skatePill.classList.toggle('locked', !unlocked);
  skatePill.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  const icon = skatePill.querySelector('i');
  if (icon) icon.className = unlocked ? 'ph ph-sneaker-move' : 'ph ph-lock-simple';
  const sub = skatePill.querySelector('.mode-pill__sub');
  if (sub) {
    sub.textContent = unlocked
      ? 'Ride on a skateboard'
      : 'Find the hidden skateboard to unlock';
  }
  skatePill.title = unlocked
    ? 'Skate Mode: ride the skateboard'
    : 'Find the hidden skateboard to unlock Skate Mode';
  if (!unlocked && _selectedMode === 'skate') {
    _selectedMode = 'normal';
  }
}

// Refresh the Totodile char-card's locked state + hint label. Mirrors the
// speed-pill flow: padlock when locked, plain card when unlocked. If the
// player currently has Totodile selected and somehow it's locked, snap
// the selection back to Classic so they can't start a run as a locked cat.
function _refreshTotodileCardLockState() {
  const card = document.querySelector('.char-card[data-model="totodile"]');
  if (!card) return;
  const unlocked = catAppearance.isTotodileUnlocked();
  card.classList.toggle('locked', !unlocked);
  card.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  // Replace the name with a hint when locked. Cache the original name on
  // first run so we can restore it cleanly.
  const nameEl = card.querySelector('.char-name');
  if (nameEl) {
    if (!nameEl.dataset.origName) nameEl.dataset.origName = nameEl.textContent || 'Totodile';
    nameEl.textContent = unlocked
      ? nameEl.dataset.origName
      : 'Find a hidden item';
  }
  // Lock badge — gold padlock chip in the corner. Created lazily.
  let badge = card.querySelector('.char-card__lock');
  if (!unlocked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'char-card__lock';
      badge.innerHTML = '<i class="ph ph-lock-simple"></i>';
      card.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
  card.title = unlocked
    ? 'Totodile'
    : 'Locked — find a hidden item to unlock';
  if (!unlocked && _selectedModel === 'totodile') {
    _selectedModel = 'classic';
  }
}

// Refresh the Cursed Korra char-card's locked state. Unlocks when the
// player beats the game in under 2:00.
function _refreshKorraCardLockState() {
  const card = document.querySelector('.char-card[data-model="korra"]');
  if (!card) return;
  const unlocked = catAppearance.isKorraUnlocked();
  card.classList.toggle('locked', !unlocked);
  card.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  const nameEl = card.querySelector('.char-name');
  if (nameEl) {
    if (!nameEl.dataset.origName) nameEl.dataset.origName = nameEl.textContent || 'Cursed Korra';
    nameEl.textContent = unlocked
      ? nameEl.dataset.origName
      : 'Beat the game in under 2:00';
  }
  let badge = card.querySelector('.char-card__lock');
  if (!unlocked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'char-card__lock';
      badge.innerHTML = '<i class="ph ph-lock-simple"></i>';
      card.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
  card.title = unlocked
    ? 'Cursed Korra'
    : 'Locked — beat the game in under 2:00 to unlock';
  if (!unlocked && _selectedModel === 'korra') {
    _selectedModel = 'classic';
  }
}

// Refresh the Bababooey char-card's locked state. Unlocks when the
// player goes Super Saiyan in FP mode. Intentionally vague hint text —
// we don't want to tell them how to trigger it.
function _refreshBababooeyCardLockState() {
  const card = document.querySelector('.char-card[data-model="bababooey"]');
  if (!card) return;
  const unlocked = catAppearance.isBababooeyUnlocked();
  card.classList.toggle('locked', !unlocked);
  card.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  const nameEl = card.querySelector('.char-name');
  if (nameEl) {
    if (!nameEl.dataset.origName) nameEl.dataset.origName = nameEl.textContent || 'Bababooey';
    nameEl.textContent = unlocked
      ? nameEl.dataset.origName
      : 'Go Super Saiyan to unlock';
  }
  let badge = card.querySelector('.char-card__lock');
  if (!unlocked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'char-card__lock';
      badge.innerHTML = '<i class="ph ph-lock-simple"></i>';
      card.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
  card.title = unlocked
    ? 'Bababooey'
    : 'Locked — go Super Saiyan to unlock';
  if (!unlocked && _selectedModel === 'bababooey') {
    _selectedModel = 'classic';
  }
}

let _previewsInited = false;
let _charSelectFocusTrap = null;
let _charSelectSavedFocus = null;
window._openCharSelect = () => {
  // Release pointer lock if held
  if (document.pointerLockElement) document.exitPointerLock();
  // Hide the splash if it's open — the picker takes over from here.
  const sp = document.getElementById('titleSplash');
  if (sp) sp.classList.remove('open');
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
  } else {
    // Already loaded — render a frame immediately so the cats appear the
    // moment the modal opens, without waiting for the next rAF tick.
    requestAnimationFrame(() => flushPreviewsOnOpen());
  }
  // Match character-select mode chips to the current gameplay mode flags.
  _selectedMode = gameFp.isSpeedMode() ? 'speed' : (gameFp.isSkateMode() ? 'skate' : 'normal');
  // Refresh lock states FIRST — they may downgrade _selectedModel /
  // _selectedMode (e.g. snap totodile→classic, speed→normal) before we
  // apply the selection highlights below.
  _refreshSpeedPillLockState();
  _refreshSkatePillLockState();
  _refreshTotodileCardLockState();
  _refreshBababooeyCardLockState();
  _refreshKorraCardLockState();
  // Highlight the previously selected model (or classic on first open)
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
  const activeCard = document.querySelector(`.char-card[data-model="${_selectedModel}"]`);
  if (activeCard) activeCard.classList.add('selected');
  document.querySelectorAll('.mode-pill').forEach(p => p.classList.toggle('on', p.dataset.mode === _selectedMode));
};

window._closeCharSelect = () => {
  const cs = document.getElementById('charSelect');
  if (cs) cs.classList.remove('open');
  if (_charSelectFocusTrap) { _charSelectFocusTrap.release(); _charSelectFocusTrap = null; }
  if (_charSelectSavedFocus) { _charSelectSavedFocus.restore(); _charSelectSavedFocus = null; }
  // Closing the picker without starting a run drops the user back on the
  // title splash so they never land on a chrome-less, blank canvas.
  if (!gameFp.fpMode) window._openSplash?.();
};

// Escape key closes char select
document.getElementById('charSelect')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    window._closeCharSelect();
  }
});

// ── Exit-to-menu handler ────────────────────────────────────────────
// /play is the immersive game route; the menu (title card + Play
// button + tabs) lives at /. Anywhere we used to "reopen the splash"
// after a run, we now navigate the user back to /home so the iframe
// architecture stays consistent: the home page brings up the same live
// scene through its persistent <iframe>, and the player gets the full
// tab nav back.
//
// Two paths:
//   1. STANDALONE (window.parent === window) — direct entry to /play
//      in its own tab. Fade out, then top-level navigate to /. The
//      home page boots fresh and remounts its bg-iframe.
//   2. EMBEDDED (this document is mounted inside home's #bgFrame) —
//      no navigation. Fade through black, snap the camera to splash
//      framing, re-apply is-bg (chrome hides), then postMessage the
//      parent to swap its URL back to / and re-show its chrome. The
//      three.js scene never reboots; the eye reads it as one cut.
//
// We keep the legacy global names (_openSplash / _closeSplash /
// _startFromSplash) so the call sites in this file and in pause/quit
// flows don't have to change. They all funnel through one helper.

// Scene-fade overlay — full-viewport black div used to mask the camera
// snap during embedded exit. See vite-index.html for the markup.
const _sceneFadeEl = document.getElementById('sceneFade');
function _sceneFadeTo(opacity, ms) {
  if (!_sceneFadeEl) return Promise.resolve();
  return new Promise(resolve => {
    _sceneFadeEl.style.transition = `opacity ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    if (opacity > 0) _sceneFadeEl.classList.add('is-active');
    // Force a layout read so the new transition is committed before
    // we change opacity (otherwise the browser folds from/to into one
    // paint and the fade is skipped).
    void _sceneFadeEl.offsetWidth;
    _sceneFadeEl.style.opacity = String(opacity);
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      if (opacity === 0) _sceneFadeEl.classList.remove('is-active');
      resolve();
    };
    _sceneFadeEl.addEventListener('transitionend', finish, { once: true });
    // Belt-and-suspenders fallback in case the transitionend never
    // fires (e.g. tab backgrounded mid-fade).
    setTimeout(finish, ms + 80);
  });
}

// Snap the camera back to the splash framing. Used during embedded
// exit while the screen is masked by the black scene fade.
function _resetSceneToHomeFraming() {
  camera.position.copy(SPLASH_CAM_POS);
  camera.lookAt(SPLASH_CAM_LOOK);
  markShadowsDirty();
}

function _exitToHome() {
  if (gameFp.fpMode) return;
  if (document.pointerLockElement) document.exitPointerLock();
  // Release focus trap up front (it would error on navigation if it
  // tried to restore focus to a stale element). We deliberately leave
  // the .open class on #charSelect so the body.is-leaving fade rule
  // in main.css matches and the picker visibly fades out — removing
  // .open here would break that selector.
  const cs = document.getElementById('charSelect');
  if (cs && cs.classList.contains('open')) {
    if (_charSelectFocusTrap) { _charSelectFocusTrap.release(); _charSelectFocusTrap = null; }
    if (_charSelectSavedFocus) { _charSelectSavedFocus.restore(); _charSelectSavedFocus = null; }
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only fade through black when the camera has actually drifted from
  // the splash pose — i.e. we're exiting a run. Coming back from
  // char-select the camera never moved, so the black flash is just
  // pointless noise. 1 unit² ≈ visually identical.
  const cameraDrifted = camera.position.distanceToSquared(SPLASH_CAM_POS) > 1;

  // Embedded path — no navigation, postMessage the parent and let it
  // animate its chrome back in over the same live scene.
  if (_isEmbedded) {
    if (reduced) {
      // Reduced motion: skip animations, just snap state and notify.
      if (cs) cs.classList.remove('open');
      _resetSceneToHomeFraming();
      document.documentElement.classList.add('is-bg');
      document.body.classList.remove('is-leaving', 'page-fade');
      try { window.parent.postMessage({ type: 'play-exited' }, location.origin); } catch (e) {}
      return;
    }
    // Tell char-select to fade out via the existing body.is-leaving
    // CSS rule. We DON'T set page-fade — that one's for full-document
    // navs and we're not doing one.
    document.body.classList.add('is-leaving');

    if (!cameraDrifted) {
      // Camera is already at splash pose — skip the black fade entirely
      // and just animate the picker out, THEN tell the parent to bring
      // its chrome back. The picker close is 500ms (see
      // body.is-leaving #charSelect.open .char-select-inner > * — opacity
      // and transform are both 0.5s). If we post play-exited too early,
      // the parent removes is-playing (iframe drops to z:0) and removes
      // is-leaving (home main.page starts fading IN over 700ms) while
      // the picker is still mid-fade, so the home title-splash card
      // appears on top of a still-visible picker. Wait the full 500ms
      // + a small buffer so the picker is gone before the menu chrome
      // comes back.
      setTimeout(() => {
        if (cs) cs.classList.remove('open');
        document.documentElement.classList.add('is-bg');
        document.body.classList.remove('is-leaving');
        try { window.parent.postMessage({ type: 'play-exited' }, location.origin); } catch (e) {}
      }, 540);
      return;
    }

    // Camera moved (exiting a run) — fade through black to mask the
    // snap back to splash framing.
    _sceneFadeTo(1, 320).then(() => {
      // Black overlay is fully opaque now. Reset the scene under it.
      if (cs) cs.classList.remove('open');
      _resetSceneToHomeFraming();
      document.documentElement.classList.add('is-bg');
      document.body.classList.remove('is-leaving');
      // Tell the parent to bring its chrome back. The parent will
      // pushState back to '/' and remove its own is-leaving class —
      // that animates the home menu back in BEHIND our still-opaque
      // black overlay (the iframe is z-index 0, the home chrome
      // paints over it, but the iframe's overlay covers everything
      // INSIDE the iframe).
      try { window.parent.postMessage({ type: 'play-exited' }, location.origin); } catch (e) {}
      // Hold black another 80ms to give the parent a chance to start
      // its chrome entrance, then fade out. Total exit = ~720ms.
      setTimeout(() => _sceneFadeTo(0, 320), 80);
    });
    return;
  }

  // Standalone path — top-level nav to /. body.is-leaving fades out
  // the char-select picker; the 320ms wait fits the picker's 280ms
  // opacity transition with a small buffer for the navigation kick.
  if (reduced) { location.href = '/'; return; }
  document.body.classList.add('page-fade', 'is-leaving');
  // Only fade through black if the camera moved — keeps the
  // char-select-back path light while still masking run exits.
  if (cameraDrifted) _sceneFadeTo(1, 280);
  setTimeout(() => { location.href = '/'; }, 320);
}
window._openSplash = _exitToHome;
window._closeSplash = () => { /* legacy no-op — splash markup is gone */ };
window._startFromSplash = () => {
  // Legacy entry point. Now just opens char select directly — the
  // landing-page "Play" button on / is what brings the user here, so
  // by the time this fires they've already committed to playing.
  if (!window._appReady) { window._pendingStart = true; return; }
  window._openCharSelect?.();
};

// On first boot, _markSplashReady (called after the first scene frame
// paints) hides the loading scrim and auto-opens char select.

// Eagerly warm the character-select previews in the background so the 3D cats
// are already fetched, parsed, and rendered by the time the user opens the
// select screen. The preview canvases exist in the DOM (the modal is just
// hidden via CSS), so GLTF loading + scene setup is safe without layout; the
// first render happens the moment each model finishes loading.
const _warmPreviews = () => {
  if (_previewsInited) return;
  _previewsInited = true;
  initPreviews();
};
if ('requestIdleCallback' in window) {
  // Wait until the main scene has breathing room, but cap the delay so slow
  // tabs still get the cats early.
  window.requestIdleCallback(_warmPreviews, { timeout: 1500 });
} else {
  setTimeout(_warmPreviews, 300);
}

window._selectCat = (model, el) => {
  // Block selection of locked Totodile — same shake+toast pattern as
  // the locked Speed Mode pill.
  if (model === 'totodile' && !catAppearance.isTotodileUnlocked()) {
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }
    showToast('Totodile locked — find a hidden item to unlock');
    return;
  }
  if (model === 'korra' && !catAppearance.isKorraUnlocked()) {
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }
    showToast('Cursed Korra locked — beat the game in under 2:00 to unlock');
    return;
  }
  if (model === 'bababooey' && !catAppearance.isBababooeyUnlocked()) {
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }
    showToast('Bababooey locked — go Super Saiyan to unlock');
    return;
  }
  _selectedModel = model;
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
};

window._selectMode = (mode, el) => {
  const nextMode = mode === 'speed' ? 'speed' : (mode === 'skate' ? 'skate' : 'normal');
  const wantSpeed = nextMode === 'speed';
  const wantSkate = nextMode === 'skate';
  if (wantSpeed && !coins.hasFoundAllSecrets()) {
    // Locked — give a quick shake + toast and bail.
    if (el) {
      el.classList.remove('shake');
      // Force reflow so the animation restarts.
      void el.offsetWidth;
      el.classList.add('shake');
    }
    const found = coins.getSecretFoundCount();
    const total = coins.getSecretTotal();
    showToast(`Speed Mode locked — find all secret coins to unlock (${found}/${total})`);
    return;
  }
  if (wantSkate && !gameFp.isSkateboardFound()) {
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }
    showToast('Skate Mode locked — find the hidden skateboard to unlock');
    return;
  }
  _selectedMode = nextMode;
  document.querySelectorAll('.mode-pill').forEach(p => p.classList.toggle('on', p.dataset.mode === _selectedMode));
};

window._startGame = () => {
  const cs = document.getElementById('charSelect');
  // Fast-close the picker when actually starting a run — the normal
  // .open removal triggers a 500ms close fade (so the X-button close
  // visually mirrors the open). On game-start that's just dead time
  // before the player sees the room and the HUD slides in, so we
  // collapse the fade to ~140ms via the .is-starting override in
  // main.css. Cleared after 220ms once visibility:hidden has snapped.
  if (cs) {
    cs.classList.add('is-starting');
    cs.classList.remove('open');
    setTimeout(() => cs.classList.remove('is-starting'), 140);
  }
  // Release focus trap
  if (_charSelectFocusTrap) { _charSelectFocusTrap.release(); _charSelectFocusTrap = null; }
  if (_charSelectSavedFocus) { _charSelectSavedFocus.restore(); _charSelectSavedFocus = null; }
  // Apply cat selection
  catAppearance.setCatModelKeyRaw(_selectedModel);
  // Apply movement / coin mode
  const speed = _selectedMode === 'speed';
  const skate = _selectedMode === 'skate';
  gameFp.setSpeedMode(speed);
  coins.setSpeedMode(speed);
  gameFp.setSkateMode(skate, { silent: true });
  // Reload cat model with new selection
  catAnimation.loadGameplayCat({
    applyCatColorToModel: catAnimation.applyColorToAll,
    onModelReady: () => {
      try { renderer.compile(scene, camera); } catch (e) { }
    }
  });
  // Enter game mode
  gameFp.toggleFirstPerson();
  // Reset wall auto-fade if the inspector module ever loaded it.
  if (_inspectorMod && typeof _inspectorMod !== 'undefined') {
    // wall-fade lives inside the inspector chunk; reach in via the
    // module's re-export if present, otherwise no-op (game mode never
    // fades walls anyway).
    try { _inspectorMod.resetWallFade?.(); } catch (e) { }
  }
};

// G key: in-game it exits cleanly back to the title splash;
// out of game it opens the character select.
window._toggleFP = () => {
  if (gameFp.fpMode) {
    window._exitFP(); // exit through the splash so we never land blank
  } else {
    window._openCharSelect(); // open character select
  }
};
window._pauseFP = () => gameFp.setPaused(true);
window._resumeFP = () => gameFp.setPaused(false);
window._resetFP = () => {
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  // If not in FP yet, fall back to the character-select entry path.
  if (!gameFp.fpMode) {
    leaderboard.resetTimer();
    coins.fullReset();
    window._openCharSelect();
    return;
  }
  // In-place reset: stay in FP, restart timer, respawn, reset coins.
  gameFp.releasePauseFocusTrap();
  gameFp.setPaused(false);
  gameFp.resetRun();
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
  // Reset macbook music to full volume when leaving game mode
  if (roomRefs && typeof roomRefs.resetMacbookProximity === 'function') {
    roomRefs.resetMacbookProximity();
  }
  // Drop the player back on the title splash so they always have a clear
  // entry point instead of staring at a chrome-less room canvas.
  window._openSplash?.();
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
window._setMouseSens = (v) => gameFp.setMouseSens(v);
window._setFov = (v) => gameFp.setFov(v);
window._toggleSkateMode = () => gameFp.setSkateMode(!gameFp.isSkateMode());

// ── Overcharge death flow ───────────────────────────────────────────
// Triggered by kamehameha when the player holds past DEATH_THRESHOLD.
// Dismounts skateboard, locks all input, tips the cat onto its side,
// and shows the "even further beyond" overlay. The overlay's two
// buttons call _reviveDeath (stand back up, regain control) or
// _resetFromDeath (full run reset).
//
// Sequence:
//   1. Lock movement, dismount skate, trigger knockover (cat falls).
//   2. Hold for ~5s so the player sees the cat tip over and lie there
//      — camera/look stays live so they can pan around in shock.
//   3. Release pointer lock + show the death overlay.
const _DEATH_OVERLAY_DELAY_MS = 5000;
let _deathOverlayTimer = null;
function _handleOvercharge() {
  if (!gameFp.fpMode) return;
  if (gameFp.isDeathLocked && gameFp.isDeathLocked()) return; // already dead
  // Eject from the skateboard so the cat falls clean off, not perched
  // on a deck. Silent so it doesn't play the dismount toast.
  if (typeof gameFp.isSkateMode === 'function' && gameFp.isSkateMode()) {
    gameFp.setSkateMode(false, { silent: true });
  }
  gameFp.setDeathLock(true);
  catAnimation.endCastCharge();
  catAnimation.triggerKnockover();
  // Delay the overlay so the death animation reads. Movement is already
  // locked; the camera stays free during this beat for dramatic effect.
  if (_deathOverlayTimer) clearTimeout(_deathOverlayTimer);
  _deathOverlayTimer = setTimeout(() => {
    _deathOverlayTimer = null;
    // Bail if the player was already revived/reset during the delay.
    if (!gameFp.isDeathLocked || !gameFp.isDeathLocked()) return;
    // Release pointer lock now so the cursor can reach the overlay buttons.
    if (document.pointerLockElement) document.exitPointerLock();
    const overlay = document.getElementById('fpDeathOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      // Focus the revive button so keyboard users can hit Enter to come back.
      setTimeout(() => {
        const btn = document.getElementById('fpDeathRevive');
        if (btn) btn.focus();
      }, 50);
    }
  }, _DEATH_OVERLAY_DELAY_MS);
}

window._reviveDeath = () => {
  if (_deathOverlayTimer) { clearTimeout(_deathOverlayTimer); _deathOverlayTimer = null; }
  const overlay = document.getElementById('fpDeathOverlay');
  if (overlay) overlay.style.display = 'none';
  catAnimation.triggerRevive();
  // setDeathLock(false) re-acquires pointer lock on desktop.
  gameFp.setDeathLock(false);
};

window._resetFromDeath = () => {
  if (_deathOverlayTimer) { clearTimeout(_deathOverlayTimer); _deathOverlayTimer = null; }
  const overlay = document.getElementById('fpDeathOverlay');
  if (overlay) overlay.style.display = 'none';
  catAnimation.clearKnockover();
  // _resetRun internally drops the death lock and fully respawns.
  window._resetFP();
};

// Suppresses the post-FP title splash for one transition. Set true
// just before any flow that exits FP and then immediately takes over
// the screen with another overlay (inspector, char-select reset, etc).
let _suppressSplashOnce = false;

window._playAgain = () => {
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  gameFp.releasePauseFocusTrap();
  gameFp.clearPauseState();
  _suppressSplashOnce = true;
  gameFp.toggleFirstPerson();
  setTimeout(() => window._openCharSelect(), 100);
};

// ── Inspector mode (lazy) ───────────────────────────────────────────
// Pause-menu Inspect button: exits FP, opens the customization panel.
// First click dynamically loads the inspector chunk (OrbitControls,
// particles, wall-fade, all panel handlers + UI). After that it's a
// fast toggle.

window._enterInspector = async () => {
  // Close any pause/finish overlays and exit FP cleanly.
  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  const pause = document.getElementById('fpPauseOverlay');
  if (pause) pause.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  gameFp.releasePauseFocusTrap();
  gameFp.clearPauseState();
  _suppressSplashOnce = true;
  if (gameFp.fpMode) gameFp.toggleFirstPerson();
  if (roomRefs && typeof roomRefs.resetMacbookProximity === 'function') {
    roomRefs.resetMacbookProximity();
  }
  // Lazy-load + activate the inspector.
  const mod = await _loadInspector();
  await mod.enter({
    camera, canvas, renderer, scene,
    purifierRefs, roomRefs, purifierGroup, placementOffset,
    gameFp, lighting, todRefs, spatial, state,
    coins, leaderboard,
    markShadowsDirty, showToast,
    syncFpsToggle: _applyFpsVisibility,
    syncQuickCoinToggle: _syncQuickCoinToggleState,
    gateQuickCoinRow: _gateQuickCoinRowToLocalhost,
  });
  _inspectorTick = mod.tick;
};

window._exitInspector = () => {
  if (_inspectorMod) _inspectorMod.exit();
  // Drop the per-frame tick reference (keeps the module loaded but
  // skips its work in animate()).
  _inspectorTick = null;
  // Return to the game-first entry point.
  window._openCharSelect();
};

// Per-frame hook the animate loop calls when set.
let _inspectorTick = null;


// ── Fireball unlock ─────────────────────────────────────────────────
// Unlocks ONLY when every visible fan rotor has been individually
// toggled off (click each fan in the 3D scene). The global spin
// toggle / speed slider are deliberately ignored.
function _checkFanOffUnlock() {
  if (fireball.isUnlocked()) {
    _updateFireballBtnVisibility();
    return;
  }
  if (purifierRefs.areAllFansIndividuallyOff && purifierRefs.areAllFansIndividuallyOff()) {
    fireball.setUnlocked(true);
    showToast('🔥 Fireball unlocked! Press F (or tap the button) in game mode.');
    _updateFireballBtnVisibility();
  }
}

// Poll for unlock — fans are toggled by clicking individual rotors in
// the 3D scene, which doesn't go through any of our window wrappers.
setInterval(_checkFanOffUnlock, 500);

// Expose for debugging from the console.
window._checkFanOffUnlock = _checkFanOffUnlock;
window._fireball = fireball;

function _updateFireballBtnVisibility() {
  const hint = document.getElementById('fireballUnlockHint');
  if (hint && fireball.isUnlocked()) {
    hint.classList.add('visible');
  }
}

// F-key behavior depends on Super Saiyan state:
//   - Normal: tap/hold spawns spammable fireballs (legacy behavior).
//   - Super Saiyan: hold to charge kamehameha, release to fire beam.
// The dispatch happens here so the keyboard handler in game-fp.js
// stays a thin pass-through and so a charge that was started in SS
// can still be released cleanly if SS expires mid-hold.
window._fireballKeyDown = (isRepeat) => {
  if (gameFp.isSuperSaiyanActive()) {
    if (isRepeat) return; // autorepeat shouldn't restart charges
    if (kamehameha.startCharge()) catAnimation.triggerCastCharge();
  } else {
    fireball.shoot();
    catAnimation.triggerCast();
  }
};
window._fireballKeyUp = () => {
  // Always end any held cast pose and any in-progress charge, even if
  // SS dropped between keydown and keyup.
  catAnimation.endCastCharge();
  if (kamehameha.isCharging()) kamehameha.releaseCharge();
};

window._shootFireball = () => {
  fireball.shoot();
  catAnimation.triggerCast();
};

// Placement (inspector-only). Bridge stays here so it works even before
// the inspector chunk loads — but it's only invoked from inspector UI.
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
    purifierRefs.setFeetStyle('bun');
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

  // Re-aim camera/controls — controls only exist once the inspector
  // chunk has loaded; before then just reposition the camera. This
  // path runs when the user repositions the purifier in inspector
  // mode, so we focus on the purifier (not the splash room overview).
  camera.position.set(placementOffset.x + 25, placementOffset.y + 20, placementOffset.z + 35);
  if (_inspectorMod && _inspectorMod.retargetControls) {
    _inspectorMod.retargetControls(placementOffset);
  } else {
    camera.lookAt(placementOffset.x, placementOffset.y + 8, placementOffset.z);
  }
  markShadowsDirty();
  gameFp.invalidatePurifierCollision();
};

// FPS toggle — persisted, default off. Keeps Control Center and Pause menu
// toggles (plus the inline HUD readout) in sync.
const FPS_VIS_KEY = 'diy_air_purifier_show_fps_v1';
let _fpsVisible = false;
try { _fpsVisible = localStorage.getItem(FPS_VIS_KEY) === '1'; } catch (e) { }

function _applyFpsVisibility() {
  const fpsEl = document.getElementById('fpsInline');
  const togCc = document.getElementById('togFps');
  const togPause = document.getElementById('fpPauseShowFps');
  const stPause = document.getElementById('fpPauseShowFpsState');
  if (fpsEl) fpsEl.hidden = !_fpsVisible;
  if (togCc) togCc.classList.toggle('on', _fpsVisible);
  if (togPause) {
    togPause.classList.toggle('on', _fpsVisible);
    togPause.setAttribute('aria-checked', String(_fpsVisible));
  }
  if (stPause) {
    stPause.textContent = _fpsVisible ? 'On' : 'Off';
    stPause.classList.toggle('off', !_fpsVisible);
  }
}

window._toggleFps = () => {
  _fpsVisible = !_fpsVisible;
  try { localStorage.setItem(FPS_VIS_KEY, _fpsVisible ? '1' : '0'); } catch (e) { }
  _applyFpsVisibility();
};
_applyFpsVisibility();

// MPH HUD toggle
window._toggleMph = () => {
  gameFp.setMphVisible(!gameFp.mphVisible);
};

// Debug wall labels (localhost only)
window._toggleDebugWallLabels = () => {
  if (!roomRefs || typeof roomRefs.toggleDebugWallLabels !== 'function') return;
  const vis = roomRefs.toggleDebugWallLabels();
  const sw = document.getElementById('fpPauseDebugWalls');
  const st = document.getElementById('fpPauseDebugWallsState');
  if (sw) { sw.classList.toggle('on', vis); sw.setAttribute('aria-checked', String(vis)); }
  if (st) { st.textContent = vis ? 'On' : 'Off'; st.classList.toggle('off', !vis); }
};

window._toggleQuickCoin = () => {
  const next = !coins.isQuickCoinMode();
  coins.setQuickCoinMode(next);
  coins.fullReset();

  leaderboard.closeFinishDialog();
  leaderboard.hideShareButton();
  if (gameFp.fpMode) leaderboard.startTimer();
  else leaderboard.resetTimer();
  void leaderboard.startSharedRun(gameFp.isSpeedMode() ? 'speed' : 'normal');

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

// Inspector-only purifier UI handlers (window._setStain, _setLayout,
// _setFanCount, _setEdge, _setFeet, _setFootDia, _setFootHt,
// _setFeetAngled, _setFanColor, _toggleRGB, _toggleXray, _toggleIsolate,
// _toggleExplode, _toggleFilter, _toggleGrills, _setGrillColor,
// _toggleDims, _setTurntable, _setFanSpeed, _toggleSpin, _setTOD) all
// live in the lazy `inspector-mode.js` chunk and are wired on first
// Inspect click.

// Orbit-mode keyboard, fly mode, and OrbitControls limits live in the
// lazy `inspector-mode.js` chunk. Nothing to wire here.

// ── Render loop ─────────────────────────────────────────────────────

let _lastFrameTs = 0;
let _fpsFrames = 0;
let _fpsLast = performance.now();
let _lastCoinDomUpdate = 0;

// Cached DOM refs for per-frame updates
const _elRunTimer = document.getElementById('runTimerText');
const _elMphValue = document.getElementById('mphValue');
let _lastMphText = '';
const _elFps = document.getElementById('fpsInline');
const _elPauseOv = document.getElementById('fpPauseOverlay');

function animate(ts) {
  requestAnimationFrame(animate);

  _applyFpPerformanceProfile(gameFp.fpMode);

  // Frame timing
  const rawDt = ts - (_lastFrameTs || ts);
  _lastFrameTs = ts;
  const dtSec = Math.min(rawDt / 1000, 0.1);
  const animFrameScale = dtSec * 60;

  // Inspector tick (only when inspector is loaded + active)
  if (!gameFp.fpMode && _inspectorTick) {
    _inspectorTick(ts, dtSec, animFrameScale);
  }

  // Game mode physics
  gameFp.updatePhysics(ts, dtSec, animFrameScale);

  // Coins (spin/bob/pickup) — only active in game mode
  if (gameFp.fpMode) {
    const prevScore = coins.coinScore;
    const prevSecret = coins.coinSecretScore;
    coins.updateCoins(ts, gameFp.fpPos);
    if (coins.coinScore > prevScore) coinBump();
    if (coins.coinSecretScore > prevSecret) secretCoinBump();
    // MacBook music proximity volume (full within ~2 ft, steep falloff beyond)
    if (roomRefs && typeof roomRefs.updateMacbookProximity === 'function') {
      roomRefs.updateMacbookProximity(gameFp.fpPos);
    }
    // Timer tick
    leaderboard.tickTimer(ts);
    if (_elRunTimer) _elRunTimer.textContent = leaderboard.formatRunTime(leaderboard.getElapsed());
    // MPH speedometer — update every frame (cheap: one hypot + DOM write)
    if (_elMphValue && gameFp.mphVisible && gameFp.skateboardFound) {
      // getHorizSpeed() returns inches/second; scale so base skate sprint ≈ 25 MPH
      const rawSpd = gameFp.getHorizSpeed();
      const mph = Math.round(rawSpd * 0.44);
      const txt = String(mph);
      if (txt !== _lastMphText) {
        _elMphValue.textContent = txt;
        _lastMphText = txt;
        // Heat glow tiers
        const heat = mph >= 120 ? '3' : mph >= 60 ? '2' : mph >= 30 ? '1' : '';
        if (_elMphValue.dataset.heat !== heat) _elMphValue.dataset.heat = heat;
      }
    }
    // Check for run completion (all regular coins collected).
    //
    // ⚠ Coin count INVARIANT: the leaderboard's stored coin count and
    // the live coin HUD must always agree. We rely on two things:
    //   1. A run only finishes when coinScore >= coinTotal — so at the
    //      moment we hand the row to the leaderboard, the player's
    //      score is exactly coinTotal. That's why we pass coinTotal
    //      below (not coinScore); they're equal here by construction.
    //   2. coins.coinTotal is set at coin spawn time and not mutated
    //      mid-run, so the HUD denominator and this saved value come
    //      from the same source of truth.
    // If we ever allow finishing with partial completion (timer end,
    // forfeit, etc.), switch this to pass coins.coinScore so the saved
    // value reflects what the player actually collected.
    if (coins.coinScore >= coins.coinTotal && coins.coinTotal > 0 && !leaderboard.isFinished()) {
      leaderboard.stopTimer();
      const finalTime = leaderboard.getElapsed();
      gameFp.setPaused(true);
      // Hide the regular pause overlay (finish takes precedence)
      if (_elPauseOv) _elPauseOv.style.display = 'none';
      // Persist the Totodile unlock if this run was under 2:00 — fire a
      // celebration toast the very first time it triggers so the player
      // knows there's a new cat waiting in the character select.
      if (catAppearance.tryUnlockKorra(finalTime)) {
        showToast('🐈 Cursed Korra unlocked! Pick her from Select a character.');
      }
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
    const isTotodile = catAppearance.catModelKey === 'totodile';
    const isKorra = catAppearance.catModelKey === 'korra';
    const hasWalkClip = !!catAnimation.catWalkAction;
    const hasIdleClip = !!catAnimation.catIdleAction;

    // Reset catModel to base position BEFORE the mixer runs, so the
    // mixer's bone world matrix computations see the correct catModel
    // transform. In Three.js 0.184, mixer.update() reads bone.matrixWorld
    // which propagates from catModel; resetting AFTER the mixer causes a
    // one-frame lag between where the bones think they are and where the
    // mesh actually renders.
    if (gameFp.fpMode) {
      catAnimation.resetAndPinGameplayCat();
    }

    // Use the physics system's velocity directly — it's deterministic and
    // doesn't depend on frame timing, so it's perfectly stable at any FPS.
    // gameFp.getHorizSpeed() returns inches/sec from the internal _velX/_velZ.
    const svel = gameFp.fpMode ? gameFp.getHorizSpeed() : 0;
    const skateIdleOnly = gameFp.fpMode && gameFp.isSkateMode();
    const animDt = dtSec * catAnimSpeed;
    const st = catAnimation.catMixer.userData || (catAnimation.catMixer.userData = {});

    let moveBlend = 0;
    let idleBlend = 1;
    if (skateIdleOnly) {
      st._moveBlend = 0;
      st._idleProceduralBlend = 1;
    } else {
      if (!Number.isFinite(st._moveBlend)) st._moveBlend = svel > 2 ? 1 : 0;
      let targetMove = st._moveBlend;
      if (svel > 2.5) targetMove = 1;
      else if (svel < 1.0) targetMove = 0;
      const moveEase = 1 - Math.exp(-animDt * 9.5);
      st._moveBlend += (targetMove - st._moveBlend) * moveEase;
      moveBlend = Math.max(0, Math.min(1, st._moveBlend));

      if (!Number.isFinite(st._idleProceduralBlend)) st._idleProceduralBlend = 0;
      const idleTarget = Math.max(0, Math.min(1, 1 - moveBlend));
      const idleEase = 1 - Math.exp(-animDt * 7.0);
      st._idleProceduralBlend += (idleTarget - st._idleProceduralBlend) * idleEase;
      idleBlend = Math.max(0, Math.min(1, st._idleProceduralBlend));
    }

    const sprintMult = Math.max(1, Number(preset.sprintAnimMult) || 1);
    const sprinting = gameFp.fpMode && gameFp.fpKeys.shift && svel > 6;
    const sprintBoost = sprinting ? sprintMult : 1;

    if (hasWalkClip) {
      catAnimation.catWalkAction.paused = false;
      if (isBababooey) {
        // Bababooey has a single bouncy clip: run it subtly at idle, then ramp up.
        const idleTs = 0.18;
        const runTs = (0.85 + svel * 0.65) * sprintBoost;
        catAnimation.catWalkAction.timeScale = idleTs + (runTs - idleTs) * moveBlend;
      } else {
        const walkBaseTs = catAppearance.catModelKey === 'toon'
          ? (0.9 + svel * 0.036)
          : (0.8 + svel * 0.033);
        const walkTargetTs = walkBaseTs * sprintBoost;
        const walkTs = Number(catAnimation.catWalkAction.timeScale) || walkTargetTs;
        catAnimation.catWalkAction.timeScale += (walkTargetTs - walkTs) * Math.min(1, dtSec * 6);
      }
    }

    if (hasWalkClip && hasIdleClip) {
      if (skateIdleOnly) {
        catAnimation.catWalkAction.weight = 0;
        catAnimation.catWalkAction.paused = true;
        catAnimation.catIdleAction.weight = 1;
        catAnimation.catIdleAction.paused = false;
      } else {
        const walkW = Math.min(1, svel / 15) * moveBlend;
        catAnimation.catWalkAction.weight = walkW;
        catAnimation.catIdleAction.weight = (1 - walkW) * moveBlend;
        catAnimation.catIdleAction.paused = false;
      }
    } else if (hasWalkClip && !isBababooey) {
      // If there's no dedicated idle clip, freeze the walk loop when
      // stationary. For toon in skate mode, also freeze the walk clip so it
      // does not look like running-in-place on the board.
      const isToon = catAppearance.catModelKey === 'toon';
      catAnimation.catWalkAction.weight = isToon ? moveBlend : 1;
      const freezeWalkInSkate = skateIdleOnly && isToon;
      if (skateIdleOnly && !freezeWalkInSkate) {
        catAnimation.catWalkAction.paused = false;
        const idleTs = 0.2;
        const curTs = Number(catAnimation.catWalkAction.timeScale) || idleTs;
        catAnimation.catWalkAction.timeScale += (idleTs - curTs) * Math.min(1, dtSec * 8);
      } else {
        const shouldFreezeWalk = freezeWalkInSkate || moveBlend < 0.03;
        if (isToon && shouldFreezeWalk) {
          // Keep toon idle deterministic so it doesn't get stuck in a
          // staggered stride frame when movement stops.
          catAnimation.catWalkAction.time = 0;
        }
        catAnimation.catWalkAction.paused = shouldFreezeWalk;
      }
    }

    if (isBababooey) {
      if (!Number.isFinite(st._bababooeyRunBlend)) st._bababooeyRunBlend = 0;
      // Bababooey's "ball roll" is sprint-only and should be stable.
      // Keep target deterministic to avoid speed-driven jitter.
      const runTarget = skateIdleOnly ? 0 : (sprinting ? 1 : 0) * moveBlend;
      const runEaseUp = 1 - Math.exp(-dtSec * 8.6);
      const runEaseDown = 1 - Math.exp(-dtSec * 9.0);
      const runEase = runTarget > st._bababooeyRunBlend ? runEaseUp : runEaseDown;
      st._bababooeyRunBlend += (runTarget - st._bababooeyRunBlend) * runEase;
      const runBlend = Math.max(0, Math.min(1, st._bababooeyRunBlend));
      if (hasWalkClip) catAnimation.catWalkAction.weight *= (1 - runBlend);
      if (hasIdleClip) catAnimation.catIdleAction.weight *= (1 - runBlend);
      st._bababooeyRunBlendSmoothed = runBlend;
    }

    const loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
    const loopAction = catAnimation.catIdleAction || catAnimation.catWalkAction;
    if (loopPause > 0 && loopAction) {
      catAnimation.applyLoopPause(loopAction, ts, loopPause, idleBlend > 0.35 && svel < 2);
    }

    // Bababooey keeps subtle bounce motion at idle; other cats pause clip
    // playback and rely on procedural idle when not moving.
    let mixerDt = animDt;
    if (!isBababooey && !skateIdleOnly) mixerDt *= moveBlend;
    catAnimation.catMixer.update(Math.max(0, mixerDt));

    if (idleBlend < 0.2) catAnimation.refreshGameplayIdleBasePose();
    if (idleBlend > 0.001 && !isTotodile) catAnimation.applyGameplayProceduralIdle(ts, idleBlend);

    if (isBababooey) {
      const runBlend = Number(st._bababooeyRunBlendSmoothed) || 0;
      catAnimation.applyBababooeyProceduralRun(ts, svel, runBlend);
    }

    // Bababooey idle squish
    if (isBababooey && idleBlend > 0.001) {
      catAnimation.applyBababooeyIdleSquish(ts, idleBlend);
    }

    // Totodile has no baked clips — drive everything procedurally.
    // Idle bone sway + body squish are layered with the run cycle so
    // standing still still has subtle motion and running rides on top
    // of the breathing baseline.
    if (isTotodile) {
      if (!Number.isFinite(st._totodileRunBlend)) st._totodileRunBlend = 0;
      let totoRunBlend = 0;
      if (!skateIdleOnly) {
        const totoRunTarget = Math.min(1, svel / 15) * moveBlend;
        const totoRunEaseUp = 1 - Math.exp(-dtSec * 3.6);
        const totoRunEaseDown = 1 - Math.exp(-dtSec * 8.0);
        const totoRunEase = totoRunTarget > st._totodileRunBlend ? totoRunEaseUp : totoRunEaseDown;
        st._totodileRunBlend += (totoRunTarget - st._totodileRunBlend) * totoRunEase;
        totoRunBlend = Math.max(0, Math.min(1, st._totodileRunBlend));
      } else {
        st._totodileRunBlend = 0;
      }

      if (idleBlend > 0.001) {
        catAnimation.applyTotodileProceduralIdle(ts, idleBlend);
        catAnimation.applyTotodileIdleSquish(ts, idleBlend);
      }
      catAnimation.applyTotodileProceduralRun(ts, svel, totoRunBlend);
    }

    // Korra — procedural quadruped. Generic idle handles tail/head/spine;
    // Korra-specific functions add leg weight shift and quadruped walk.
    if (isKorra) {
      if (!Number.isFinite(st._korraRunBlend)) st._korraRunBlend = 0;
      let korraRunBlend = 0;
      if (!skateIdleOnly) {
        const korraRunTarget = Math.min(1, svel / 15) * moveBlend;
        const korraRunEaseUp = 1 - Math.exp(-dtSec * 4.0);
        const korraRunEaseDown = 1 - Math.exp(-dtSec * 8.0);
        const korraRunEase = korraRunTarget > st._korraRunBlend ? korraRunEaseUp : korraRunEaseDown;
        st._korraRunBlend += (korraRunTarget - st._korraRunBlend) * korraRunEase;
        korraRunBlend = Math.max(0, Math.min(1, st._korraRunBlend));
      } else {
        st._korraRunBlend = 0;
      }

      if (idleBlend > 0.001) {
        catAnimation.applyKorraProceduralIdle(ts, idleBlend);
        catAnimation.applyKorraIdleSquish(ts, idleBlend);
      }
      catAnimation.applyKorraProceduralRun(ts, svel, korraRunBlend);
    }

    // Reset position/rotation to base each frame
    if (gameFp.fpMode) {
      // Apply skate lift late so any procedural pass that touches model
      // position (e.g., bababooey run reset path) can't wipe it out.
      if (gameFp.isSkateMode() && catAnimation.catModel) {
        catAnimation.catModel.position.y += gameFp.getSkateModelLift();
      }
      catAnimation.applyGameplayJumpDeform({
        dtSec,
        vy: gameFp.fpVy,
        holdFrames: gameFp.getJumpHoldFrames(),
        modelKey: catAppearance.catModelKey
      });
      // Click-interaction nod — exaggerated bend-in-half bow when the
      // player clicks on something interactive. Layered on top of the
      // jump deform so it works mid-air too.
      catAnimation.applyClickNod(ts, catAppearance.catModelKey);
      const skateActive = gameFp.isSkateMode();
      const skateYawStrength = skateActive ? Math.max(0.45, Math.min(1, svel / 10)) : 0;
      const skateTurnSignal = skateActive
        ? ((gameFp.fpKeys.d ? 1 : 0) - (gameFp.fpKeys.a ? 1 : 0))
        : 0;
      const skateMoveSignal = skateActive
        ? Math.max(0, Math.min(1, (svel - 1.0) / 16.0))
        : 0;
      catAnimation.applyGameplaySkateUpperBodyForwardYaw(
        catAppearance.catModelKey,
        skateYawStrength,
        ts,
        skateTurnSignal,
        skateMoveSignal
      );
      // Cast runs LAST so it wins over idle/skate arm poses.
      catAnimation.applyCastAnimation(ts, catAppearance.catModelKey);
      // Knockover runs AFTER cast so the death tip-over rolls on top
      // of every other procedural pose. No-op when not knocked over.
      catAnimation.applyKnockoverDeath(ts);
    }
  }

  // Purifier animations (fan spin, explode lerp, filter/drawer/bifold)
  purifierRefs.update(dtSec, animFrameScale, gameFp.fpMode);

  // Mini-split air-stream particles (no-op when unit is off)
  if (roomRefs && typeof roomRefs.updateMiniSplit === 'function') {
    roomRefs.updateMiniSplit(dtSec, camera);
  }

  // Particles + wall auto-fade are inspector-only; the inspector chunk
  // ticks them via _inspectorTick above when active.

  // Fireballs
  fireball.update(dtSec);
  kamehameha.update(dtSec);

  // Shadow throttle — update on dirty flag OR periodically.
  // In FP (game) mode: update EVERY frame. Throttling at 8 Hz while
  // rendering at 200+ FPS creates visible stepping/jitter on any
  // moving shadow caster (fan blades, window beam vs. static geometry,
  // etc.) — the shadow map shows a version of the scene up to 125 ms
  // old, so the shadows on walls/floor appear to snap and trail.
  if (renderer.shadowMap.enabled) {
    if (gameFp.fpMode) {
      renderer.shadowMap.needsUpdate = true;
      _shadowDirtyOneShot = false;
      _lastShadowUpdateTs = ts;
    } else if (_shadowDirtyOneShot || (ts - _lastShadowUpdateTs) >= SHADOW_UPDATE_INTERVAL_MS) {
      renderer.shadowMap.needsUpdate = true;
      _shadowDirtyOneShot = false;
      _lastShadowUpdateTs = ts;
    }
  }

  // Render
  renderer.render(scene, camera);

  // FPS counter
  _fpsFrames++;
  const fpsNow = performance.now();
  if (fpsNow - _fpsLast >= 1000) {
    const ms = (fpsNow - _fpsLast) / _fpsFrames;
    if (_elFps) _elFps.textContent = _fpsFrames + ' fps · ' + ms.toFixed(1) + ' ms';
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

// Defer flipping the splash to its `ready` state until the browser has
// actually painted the first scene frame. Two rAFs: the first lets
// `animate()` schedule + render, the second fires after the browser has
// composited that frame to screen. This way the splash stays in its
// loading-state appearance through every heavy build step (createRoom,
// createPurifier, renderer.compile, first render) instead of revealing the
// liquid-glass treatment over a still-empty canvas.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    _markSplashReady();
    // When this page is mounted as a background iframe (?bg=1) on the
    // home / about / leaderboard pages, signal the parent that the
    // first scene frame has actually composited. The parent gates the
    // iframe fade-in on this so the glass cards don't briefly blur an
    // empty canvas (which looks like no blur at all because the body
    // bg is a flat color).
    try {
      if (window.parent !== window && document.documentElement.classList.contains('is-bg')) {
        window.parent.postMessage({ type: 'bg-scene-ready' }, location.origin);
      }
    } catch (e) {}

    // Pre-warm character-select previews during idle time. Without
    // this, the first time the user clicks Play we pay for 5 WebGL
    // context creations + 5 GLB loads on the same frame the picker's
    // bounce-in transition starts — which jacks up the main thread
    // and causes a visible stutter at the worst possible moment.
    // By kicking it off here (after the room's first frame is up,
    // during idle time), the picker's open path takes the warm
    // flushPreviewsOnOpen branch and the entrance plays cleanly.
    const _warmPreviews = () => {
      if (_previewsInited) return;
      _previewsInited = true;
      initPreviews();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(_warmPreviews, { timeout: 2000 });
    } else {
      setTimeout(_warmPreviews, 800);
    }
  });
});

// ── Embedded play promotion / demotion ──────────────────────────────
// When this document is mounted inside the home page's #bgFrame, the
// home Play CTA "promotes" the iframe out of background mode (drops
// is-bg, opens char-select) via a postMessage instead of doing a
// top-level navigation to /play. This skips the costly three.js
// scene rebuild that a real navigation would cause — the same warm
// scene flows seamlessly into the picker, into a run, and back out.
//
// Protocol:
//   parent → iframe : { type: 'enter-play' }   take focus, drop is-bg, open char-select
//   parent → iframe : { type: 'exit-play' }    same as user-triggered exit (defensive — popstate, etc.)
//   iframe → parent : { type: 'play-exited' }  fired from _exitToHome after camera reset
if (_isEmbedded) {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'enter-play') {
      // Drop bg mode, focus the document so keyboard input lands here,
      // open the picker. The fade-from-black overlay belongs to the
      // PARENT in this direction (its chrome animates out), so we
      // don't drive _sceneFadeEl from this side.
      document.documentElement.classList.remove('is-bg');
      // Make sure body.is-leaving (left over from a prior exit) is
      // cleared so char-select isn't immediately faded out by the
      // body.is-leaving #charSelect.open rule.
      document.body.classList.remove('is-leaving');
      try { window.focus(); } catch (err) {}
      // Split style recalc across two frames: removing is-bg drops
      // `display: none` on .panel / .panel-fab / #titleSplash / etc.,
      // forcing a style+layout pass on its own. Adding `charSelect.open`
      // in the same microtask piles a second style+layout on top —
      // visible as a single 25-35ms long frame right when the picker's
      // entrance is supposed to be smooth. Deferring _openCharSelect
      // by one frame lets the is-bg recalc settle first; the user
      // never notices the extra ~16ms because the parent's chrome-out
      // animation is still running.
      requestAnimationFrame(() => window._openCharSelect?.());
    } else if (data.type === 'exit-play') {
      // Defensive — used by parent's popstate handler. Same code path
      // as a user-driven exit so all the cleanup (pointer lock, focus
      // trap, FP mode, etc.) runs.
      _exitToHome();
    }
  });
}

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

// Panel scroll-fade observer lives inside the inspector chunk (set up
// when the panel HTML is injected on first Inspect click).

console.log('[main] Render loop started');
