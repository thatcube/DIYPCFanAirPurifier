// ─── Main entry point ───────────────────────────────────────────────
// Wires all modules together, initializes the scene, and starts the
// render loop.
//
// This file is the orchestrator — it imports from every module and
// connects them via refs/callbacks. No game logic lives here.

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
import {
  SHADOW_UPDATE_INTERVAL_MS, IDLE_FRAME_MS
} from './modules/constants.js';

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

// Add catGroup to scene
scene.add(catAnimation.catGroup);

// Wire module cross-references
music.setToastFn(showToast);
secrets.setRefs({
  addCoin: coins.addCoin,
  coinGroup: null,  // will be set after coin group is created
  purifierGroup: null, // will be set after purifier is built
  coins: coins.coins,
  setCoinsVisible: null, // will be set after game mode init
  showToast
});

// ── Toast system ────────────────────────────────────────────────────

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

// ── Shadow state ────────────────────────────────────────────────────

let _shadowDirtyOneShot = true;
let _lastShadowUpdateTs = 0;

function markShadowsDirty() {
  _shadowDirtyOneShot = true;
}

// ── Render loop ─────────────────────────────────────────────────────

let _lastFrameTs = 0;
let _fpsFrames = 0;
let _fpsLast = performance.now();

function animate(ts) {
  requestAnimationFrame(animate);

  // Frame timing
  const rawDt = ts - (_lastFrameTs || ts);
  _lastFrameTs = ts;
  const dtSec = Math.min(rawDt / 1000, 0.1); // cap at 100ms
  const animFrameScale = dtSec * 60; // normalize to 60fps baseline

  // Controls
  controls.update();

  // Particles
  particles.updateSpinSpeed(animFrameScale);
  particles.update(animFrameScale);

  // Shadow throttle
  if (_shadowDirtyOneShot) {
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

// Initial time-of-day (auto-detect local time)
const now = new Date();
const minutesNow = now.getHours() * 60 + now.getMinutes();
// lighting.applyTimeOfDay will be called once room refs are available

// Load the cat
catAnimation.loadGameplayCat({
  applyCatColorToModel: catAnimation.applyColorToAll
});

// Start render loop
animate(performance.now());

console.log('[main] Render loop started');

// ── Expose globals for HTML onclick handlers (bridge) ───────────────
// During migration, HTML buttons still call global functions. These
// will be removed once the HTML is also modularized.

window.showToast = showToast;
window.setCatModelPreset = (key) => {
  catAppearance.setCatModelKeyRaw(catAppearance.sanitizeModelKey(key));
  catAnimation.loadGameplayCat({ applyCatColorToModel: catAnimation.applyColorToAll });
};
window.setCatColorPreset = (key) => {
  if (!catAppearance.isColorable()) return;
  catAppearance.setCatColorKeyRaw(catAppearance.sanitizeColorKey(key));
  catAnimation.applyColorToAll();
};
window.setCatHairPreset = (key) => {
  if (!catAppearance.isColorable()) return;
  catAppearance.setCatHairKeyRaw(catAppearance.sanitizeHairKey(key));
  catAnimation.applyColorToAll();
};
