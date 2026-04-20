// ─── Main entry point ───────────────────────────────────────────────
// Wires all modules together, initializes the scene, and starts the
// render loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
import {
  SHADOW_UPDATE_INTERVAL_MS, IDLE_FRAME_MS
} from './modules/constants.js';

// ── Utilities (must be defined before wiring) ───────────────────────

// Toast notifications
const _toast = document.createElement('div');
_toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-8px);opacity:0;pointer-events:none;z-index:10001;background:rgba(8,12,18,0.86);color:#d9f3ff;border:1px solid rgba(145,222,255,0.48);border-radius:12px;padding:7px 12px;font-family:system-ui;font-size:12px;font-weight:700;letter-spacing:0.6px;backdrop-filter:blur(10px);box-shadow:0 8px 20px rgba(0,0,0,0.35);transition:opacity 0.2s,transform 0.2s';
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

// Position camera
camera.position.set(45, 35, 65);
controls.target.set(0, 5, 0);
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
  placementOffset: new THREE.Vector3(),
  markShadowsDirty,
  showToast,
  roomRefs
});

// Expose bridge functions for HTML onclick handlers
window._toggleFP = () => gameFp.toggleFirstPerson();
window._resumeFP = () => gameFp.setPaused(false);
window._resetFP = () => {
  gameFp.toggleFirstPerson(); // exit
  setTimeout(() => gameFp.toggleFirstPerson(), 100); // re-enter
};
window._exitFP = () => { if (gameFp.fpMode) gameFp.toggleFirstPerson(); };

// ── Render loop ─────────────────────────────────────────────────────

let _lastFrameTs = 0;
let _fpsFrames = 0;
let _fpsLast = performance.now();

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
    coins.updateCoins(ts, gameFp.fpPos);
  }

  // Cat animation mixer
  if (catAnimation.catMixer) {
    catAnimation.catMixer.update(dtSec);
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

  // FP HUD elements visibility
  const fpControlsEl = document.getElementById('fpControls');
  const fpChargeBar = document.getElementById('fpChargeBar');
  if (fpControlsEl) fpControlsEl.style.display = gameFp.fpMode ? 'block' : 'none';
  if (fpChargeBar) fpChargeBar.style.display = gameFp.fpMode ? 'block' : 'none';

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

console.log('[main] Render loop started');
