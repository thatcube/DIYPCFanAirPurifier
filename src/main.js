// ─── Main entry point ───────────────────────────────────────────────
// Wires all modules together, initializes the scene, and starts the
// render loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './styles/main.css';

// ── Module imports ──────────────────────────────────────────────────

import { state } from './modules/state.js';
import { createRenderer, createScene } from './modules/renderer.js';
import { stdMat } from './modules/materials.js';
import * as lighting from './modules/lighting.js';
import * as music from './modules/music.js';
import * as particles from './modules/particles.js';
import * as secrets from './modules/secrets.js';
import * as catAppearance from './modules/cat-appearance.js';
import * as catAnimation from './modules/cat-animation.js';
import * as coins from './modules/coins.js';
import * as leaderboard from './modules/leaderboard.js';
import * as collision from './modules/game-collision.js';
import * as spatial from './modules/spatial.js';
import * as gameFp from './modules/game-fp.js';
import { createRoom } from './modules/room.js';
import { createPurifier } from './modules/purifier.js';
import { initInteractions, coinBump } from './modules/ui-interactions.js';
import { initPreviews, recolorClassicPreview } from './modules/cat-preview.js';
import {
  SHADOW_UPDATE_INTERVAL_MS, IDLE_FRAME_MS
} from './modules/constants.js';

// ── Utilities (must be defined before wiring) ───────────────────────

// Toast notifications
const _toast = document.createElement('div');
_toast.className = 'toast';
_toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-12px);opacity:0;pointer-events:none;z-index:10001;background:rgba(8,12,18,0.88);color:#d9f3ff;border:1px solid rgba(145,222,255,0.35);border-radius:14px;padding:9px 16px;font-family:system-ui;font-size:12px;font-weight:700;letter-spacing:0.4px;backdrop-filter:blur(16px);box-shadow:0 12px 32px rgba(0,0,0,0.35);transition:opacity 0.3s cubic-bezier(0.16,1,0.3,1),transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
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
    if (c.isLight || c.isCamera || c._isRoom || c._isCoins || c === catAnimation.catGroup || c.isPoints) return;
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
  ceilLightOn: roomRefs.ceilLightOn,
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
  _markShadowsDirty: markShadowsDirty
};

// Apply initial time-of-day — default to 2:30 PM (matches monolith default)
lighting.applyTimeOfDay(870, todRefs);

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
  applyTimeOfDay: (minutes) => {
    lighting.applyTimeOfDay(minutes, todRefs);
    const todLabel = document.getElementById('todLabel');
    if (todLabel) todLabel.textContent = lighting.formatTime(minutes);
    markShadowsDirty();
  },
  toggleMacbook: roomRefs.toggleMacbook
});

// ── Wire module cross-references ────────────────────────────────────

music.setToastFn(showToast);
coins.setToastFn(showToast);

// Create coin group + spawn room coins
const coinGroup = coins.createCoinGroup(scene);
coins.spawnRoomCoins(roomRefs);

secrets.setRefs({
  addCoin: coins.addCoin,
  coinGroup,
  purifierGroup: null,
  coins: coins.coins,
  setCoinsVisible: coins.setCoinsVisible,
  showToast
});

// ── Cat ─────────────────────────────────────────────────────────────

scene.add(catAnimation.catGroup);
catAnimation.catGroup.visible = true;

catAnimation.loadGameplayCat({
  applyCatColorToModel: catAnimation.applyColorToAll
});

// ── Particles ───────────────────────────────────────────────────────

particles.init();

// ── Game mode ───────────────────────────────────────────────────────

gameFp.init({
  camera,
  canvas,
  controls,
  catGroup: catAnimation.catGroup,
  scene,
  placementOffset,
  purifierGroup,
  markShadowsDirty,
  showToast,
  roomRefs
});

// Expose bridge functions for HTML onclick handlers

// Character select screen
let _selectedModel = 'classic';
let _selectedColor = 'charcoal';

let _previewsInited = false;
window._openCharSelect = () => {
  // Release pointer lock if held
  if (document.pointerLockElement) document.exitPointerLock();
  const cs = document.getElementById('charSelect');
  if (cs) cs.classList.add('open');
  // Init 3D previews on first open — defer to next frame so canvases have layout
  if (!_previewsInited) {
    _previewsInited = true;
    requestAnimationFrame(() => initPreviews());
  }
  // Pre-select classic
  document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
  const classicCard = document.querySelector('.char-card[data-model="classic"]');
  if (classicCard) classicCard.classList.add('selected');
};

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
};

// G key opens character select instead of directly entering game
window._toggleFP = () => {
  if (gameFp.fpMode) {
    gameFp.toggleFirstPerson(); // exit
  } else {
    window._openCharSelect(); // open character select
  }
};
window._resumeFP = () => gameFp.setPaused(false);
window._resetFP = () => {
  gameFp.setPaused(false);
  gameFp.toggleFirstPerson();
  setTimeout(() => gameFp.toggleFirstPerson(), 100);
};
window._exitFP = () => {
  // Close any overlays first
  const fin = document.getElementById('fpFinishOverlay');
  if (fin) fin.classList.remove('open');
  const pause = document.getElementById('fpPauseOverlay');
  if (pause) pause.style.display = 'none';
  // Release pointer lock
  if (document.pointerLockElement) document.exitPointerLock();
  gameFp.fpPaused = false;
  if (gameFp.fpMode) gameFp.toggleFirstPerson();
};
window._toggleMuteSfx = (checked) => gameFp.setSfxMuted(checked);
window._toggleMuteMusic = (checked) => gameFp.setMusicMuted(checked);
window._switchCamFP = () => gameFp.setCamMode();
window._playAgain = () => {
  const fin = document.getElementById('fpFinishOverlay');
  if (fin) fin.classList.remove('open');
  gameFp.setPaused(false);
  // Reset and restart
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

// Airflow toggle
window._toggleAirflow = () => {
  const tog = document.getElementById('togAirflow');
  if (tog) tog.classList.toggle('on');
  particles.toggleAirflow();
};

// FPS toggle
window._toggleFps = () => {
  const fpsEl = document.getElementById('fps');
  const tog = document.getElementById('togFps');
  if (fpsEl) fpsEl.style.display = fpsEl.style.display === 'none' ? '' : 'none';
  if (tog) tog.classList.toggle('on');
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
  document.querySelectorAll('#btnStainRaw,#btnStainOil,#btnStainWalnut').forEach(b => b.classList.remove('on'));
  const id = mode === 'raw' ? 'btnStainRaw' : mode === 'oil' ? 'btnStainOil' : 'btnStainWalnut';
  const btn = document.getElementById(id);
  if (btn) btn.classList.add('on');
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

// ── Render loop ─────────────────────────────────────────────────────

let _lastFrameTs = 0;
let _fpsFrames = 0;
let _fpsLast = performance.now();
let _lastCatX = 0, _lastCatZ = 0;

function animate(ts) {
  requestAnimationFrame(animate);

  // Frame timing
  const rawDt = ts - (_lastFrameTs || ts);
  _lastFrameTs = ts;
  const dtSec = Math.min(rawDt / 1000, 0.1);
  const animFrameScale = dtSec * 60;

  // Controls (only in orbit mode)
  if (!gameFp.fpMode) controls.update();

  // Game mode physics
  gameFp.updatePhysics(ts, dtSec, animFrameScale);

  // Coins (spin/bob/pickup) — only active in game mode
  if (gameFp.fpMode) {
    const prevScore = coins.coinScore;
    coins.updateCoins(ts, gameFp.fpPos);
    if (coins.coinScore > prevScore) coinBump();
    // Timer tick
    leaderboard.tickTimer(ts);
    const timerEl = document.getElementById('runTimerText');
    if (timerEl) timerEl.textContent = leaderboard.formatRunTime(leaderboard.getElapsed());
    // Check for run completion (all regular coins collected)
    if (coins.coinScore >= coins.coinTotal && coins.coinTotal > 0 && !leaderboard.isFinished()) {
      leaderboard.stopTimer();
      const finalTime = leaderboard.getElapsed();
      const finEl = document.getElementById('finishTime');
      const finCoins = document.getElementById('finishCoins');
      const finOverlay = document.getElementById('fpFinishOverlay');
      if (finEl) finEl.textContent = leaderboard.formatRunTime(finalTime);
      if (finCoins) finCoins.textContent = coins.coinScore + '/' + coins.coinTotal + ' coins';
      if (finOverlay) finOverlay.classList.add('open');
      gameFp.setPaused(true);
      // Hide the regular pause overlay (finish takes precedence)
      const pauseOv = document.getElementById('fpPauseOverlay');
      if (pauseOv) pauseOv.style.display = 'none';
    }
  }

  // Cat animation mixer + walk/idle blend
  if (catAnimation.catMixer) {
    const preset = catAppearance.getSelectedModelPreset();
    const catAnimSpeed = Math.max(0.12, Number(preset.animSpeed) || 1);
    catAnimation.catMixer.update(dtSec * catAnimSpeed);
    // Blend walk/idle based on movement speed in game mode
    if (gameFp.fpMode && catAnimation.catWalkAction && catAnimation.catIdleAction) {
      const vel = Math.hypot(gameFp.fpPos.x - (_lastCatX || gameFp.fpPos.x), gameFp.fpPos.z - (_lastCatZ || gameFp.fpPos.z));
      const moveBlend = Math.min(1, vel * 8);
      const sprintMult = Math.max(1, Number(preset.sprintAnimMult) || 1);
      const isSprinting = gameFp.fpKeys.shift && vel > 0.01;

      if (catAppearance.catModelKey === 'bababooey') {
        // Bababooey: single bouncy clip — slow idle, ramped for run
        const idleTs = 0.18;
        const runTs = (0.85 + vel * 40) * (isSprinting ? sprintMult : 1);
        catAnimation.catWalkAction.timeScale = idleTs + (runTs - idleTs) * moveBlend;
      } else {
        // Normal walk/idle blending
        catAnimation.catWalkAction.weight += (moveBlend - catAnimation.catWalkAction.weight) * Math.min(1, dtSec * 8);
        catAnimation.catIdleAction.weight += ((1 - moveBlend) - catAnimation.catIdleAction.weight) * Math.min(1, dtSec * 8);
        const animSpeed = isSprinting ? 1.0 + Math.min(vel * 30, 1.8) * sprintMult : 1.0;
        catAnimation.catWalkAction.timeScale += (animSpeed - catAnimation.catWalkAction.timeScale) * Math.min(1, dtSec * 6);
      }
      _lastCatX = gameFp.fpPos.x;
      _lastCatZ = gameFp.fpPos.z;

      // Apply idle loop pause (bababooey pauses 2.2s between bounces when standing still)
      const loopPause = Math.max(0, Number(preset.idleLoopPause) || 0);
      const idleAction = catAnimation.catIdleAction || catAnimation.catWalkAction;
      if (loopPause > 0 && idleAction) {
        catAnimation.applyLoopPause(idleAction, ts, loopPause, moveBlend < 0.1);
      }
    }
  }

  // Purifier animations (fan spin, explode lerp, filter/drawer/bifold)
  purifierRefs.update(dtSec, animFrameScale);

  // Particles
  particles.updateSpinSpeed(animFrameScale);
  particles.update(animFrameScale);

  // Shadow throttle — update on dirty flag OR periodically
  if (_shadowDirtyOneShot || (ts - _lastShadowUpdateTs) >= SHADOW_UPDATE_INTERVAL_MS) {
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
    const fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.textContent = _fpsFrames + 'fps ' + ms.toFixed(1) + 'ms | ' + ri.calls + 'dc ' + ri.triangles + 'tri';
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

console.log('[main] Render loop started');
