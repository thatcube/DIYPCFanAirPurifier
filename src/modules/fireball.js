// ─── Fireball ability ────────────────────────────────────────────────
// Unlocks when all fans are turned off. Shoots big spammable fireballs
// from the camera (or cat head in FP mode) forward along the look dir.
//
// Performance notes:
//   - All fireballs are pooled. Geometries, materials, meshes, sparks
//     are built once and reused; spam never allocates or disposes.
//   - A single shared PointLight follows the newest active fireball
//     (multi-light scenes force three.js shader recompiles, which is
//     where the stutter came from). Intensity scales with active count.

import * as THREE from 'three';
import * as coins from './coins.js';
import { sfxMuted } from './game-fp.js';

// ── Config ──────────────────────────────────────────────────────────

const SPEED = 220;   // inches/sec
const LIFETIME = 2.4;   // seconds
const MAX_ACTIVE = 16;    // pool size; older shots recycle
const CORE_RADIUS = 3.6;
const HAZE_RADIUS = 6.5;
const TRAIL_PARTICLES = 8;    // sparks per fireball (was 14)
const GRAVITY = -8;    // slight droop (inches/sec^2)

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _catGroup = null;
let _isFpMode = () => false;

let _unlocked = false;
let _initBuilt = false;

// Pool: every entry is a complete pre-built fireball + its sparks. The
// `active` flag tells update() whether to animate it.
const _pool = [];

// Single shared point light that hops to the newest live fireball.
let _sharedLight = null;

// Scratch vectors so update() doesn't allocate per frame.
const _tmpDir = new THREE.Vector3();
const _tmpOrigin = new THREE.Vector3();

// Persisted unlock — once you've earned it, you keep it.
const _UNLOCK_KEY = 'fireballUnlocked';
try { _unlocked = localStorage.getItem(_UNLOCK_KEY) === '1'; } catch (e) { }

// ── Public API ──────────────────────────────────────────────────────

export function init(refs) {
  _scene = refs.scene;
  _camera = refs.camera;
  _catGroup = refs.catGroup || null;
  _isFpMode = refs.isFpMode || (() => false);
}

export function isUnlocked() { return _unlocked; }

export function setUnlocked(v) {
  const next = !!v;
  if (next === _unlocked) return;
  _unlocked = next;
  try { localStorage.setItem(_UNLOCK_KEY, _unlocked ? '1' : '0'); } catch (e) { }
}

export function shoot() {
  if (!_unlocked || !_scene || !_camera) return false;
  _ensurePool();

  // Pick a slot: prefer an inactive one, otherwise recycle the oldest.
  let slot = null;
  for (let i = 0; i < _pool.length; i++) {
    if (!_pool[i].active) { slot = _pool[i]; break; }
  }
  if (!slot) {
    let oldestAge = -Infinity;
    for (let i = 0; i < _pool.length; i++) {
      if (_pool[i].age > oldestAge) { oldestAge = _pool[i].age; slot = _pool[i]; }
    }
  }

  _arm(slot);
  _playWhoosh();
  return true;
}

export function update(dtSec) {
  if (!_initBuilt) return;

  let liveCount = 0;
  let newest = null;
  let newestAge = Infinity;

  for (let i = 0; i < _pool.length; i++) {
    const fb = _pool[i];
    if (!fb.active) continue;
    liveCount++;

    fb.age += dtSec;
    fb.vel.y += GRAVITY * dtSec;
    fb.group.position.addScaledVector(fb.vel, dtSec);

    const pulse = 1 + Math.sin(fb.age * 28) * 0.08;
    fb.core.scale.setScalar(pulse);
    fb.haze.scale.setScalar(1 + Math.sin(fb.age * 18 + 1.3) * 0.12);
    fb.inner.rotation.y += dtSec * 4;
    fb.haze.rotation.z += dtSec * 1.5;

    const lifeT = fb.age / LIFETIME;
    let alpha = 1.0;
    if (lifeT > 0.7) alpha = Math.max(0, 1 - (lifeT - 0.7) / 0.3);
    fb.coreMat.opacity = alpha;
    fb.innerMat.opacity = 0.9 * alpha;
    fb.hazeMat.opacity = 0.55 * alpha;

    // Sparks
    const sparks = fb.sparks;
    for (let j = 0; j < sparks.length; j++) {
      const sp = sparks[j];
      sp.age += dtSec;
      if (sp.age < 0) continue;
      sp.vel.y += GRAVITY * 1.5 * dtSec;
      sp.mesh.position.addScaledVector(sp.vel, dtSec);
      const sLifeT = sp.age / sp.life;
      sp.mat.opacity = sLifeT < 0.15
        ? sLifeT / 0.15
        : Math.max(0, 1 - (sLifeT - 0.15) / 0.85);
      sp.mesh.scale.setScalar(1 - 0.5 * sLifeT);
    }

    if (fb.age < newestAge) { newestAge = fb.age; newest = fb; }

    if (fb.age >= LIFETIME) _retire(fb);
  }

  // Shared light follows the newest fireball, intensity scales with
  // total live count so spam still feels bright. When nothing's live we
  // park it off-screen at zero intensity (still cheap; same shader).
  if (_sharedLight) {
    if (newest && liveCount > 0) {
      _sharedLight.position.copy(newest.group.position);
      const flicker = 0.9 + Math.sin(performance.now() * 0.04) * 0.1;
      _sharedLight.intensity = Math.min(8, 3.2 + liveCount * 0.6) * flicker;
    } else {
      _sharedLight.intensity = 0;
    }
  }
}

// ── Internals ───────────────────────────────────────────────────────

function _ensurePool() {
  if (_initBuilt) return;
  _initBuilt = true;

  const coreGeo = new THREE.SphereGeometry(CORE_RADIUS, 16, 10);
  const hazeGeo = new THREE.SphereGeometry(HAZE_RADIUS, 12, 8);
  const sparkGeo = new THREE.SphereGeometry(0.85, 6, 4);

  for (let i = 0; i < MAX_ACTIVE; i++) {
    const group = new THREE.Group();
    group.visible = false;

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff8a2a, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const inner = new THREE.Mesh(coreGeo, innerMat);
    inner.scale.setScalar(1.35);
    group.add(inner);

    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0xff3a16, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    group.add(haze);

    _scene.add(group);

    const sparks = [];
    for (let j = 0; j < TRAIL_PARTICLES; j++) {
      const mat = new THREE.MeshBasicMaterial({
        color: j % 2 ? 0xffd070 : 0xff5022,
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      _scene.add(mesh);
      sparks.push({
        mesh, mat,
        vel: new THREE.Vector3(),
        age: 0,
        life: 0.6
      });
    }

    _pool.push({
      active: false, age: 0,
      group, core, inner, haze,
      coreMat, innerMat, hazeMat,
      vel: new THREE.Vector3(),
      sparks
    });
  }

  // One shared light for the whole system. Single light = stable shader
  // program = no recompile stutter on rapid fire.
  _sharedLight = new THREE.PointLight(0xff7a2a, 0, 90, 1.6);
  _sharedLight.castShadow = false;
  _scene.add(_sharedLight);
}

function _arm(fb) {
  _getMuzzlePosition(_tmpOrigin);
  _getAimDirection(_tmpDir);

  fb.active = true;
  fb.age = 0;
  fb.group.position.copy(_tmpOrigin);
  fb.group.visible = true;
  fb.vel.copy(_tmpDir).multiplyScalar(SPEED);

  fb.coreMat.opacity = 1;
  fb.innerMat.opacity = 0.9;
  fb.hazeMat.opacity = 0.55;
  fb.core.scale.setScalar(1);
  fb.haze.scale.setScalar(1);

  for (let j = 0; j < fb.sparks.length; j++) {
    const sp = fb.sparks[j];
    sp.age = -j * 0.018;
    sp.life = 0.55 + Math.random() * 0.35;
    sp.mesh.position.copy(_tmpOrigin);
    sp.mesh.scale.setScalar(1);
    sp.mesh.visible = true;
    sp.mat.opacity = 0;
    sp.vel.copy(_tmpDir).multiplyScalar(SPEED * (0.35 + Math.random() * 0.25));
    sp.vel.x += (Math.random() - 0.5) * 18;
    sp.vel.y += (Math.random() - 0.5) * 18;
    sp.vel.z += (Math.random() - 0.5) * 18;
  }
}

function _retire(fb) {
  fb.active = false;
  fb.group.visible = false;
  for (let j = 0; j < fb.sparks.length; j++) {
    fb.sparks[j].mesh.visible = false;
  }
}

function _getMuzzlePosition(out) {
  if (_isFpMode() && _catGroup) {
    _catGroup.getWorldPosition(out);
    out.y += 9;
  } else {
    out.copy(_camera.position);
  }
  const fwd = _tmpDir;
  _getAimDirection(fwd);
  out.addScaledVector(fwd, 6);
  return out;
}

function _getAimDirection(out) {
  _camera.getWorldDirection(out);
  out.normalize();
  return out;
}

// ── SFX ────────────────────────────────────────────────────────────
// Subtle whoosh + soft low thump. Built from the shared coins audio
// context (created on first user interaction elsewhere). Throttled so
// holding F doesn't pile a wall of overlapping bursts.

let _noiseBuf = null;
let _lastSfxAt = 0;

function _playWhoosh() {
  if (sfxMuted) return;
  const ac = coins.getAudioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  if (now - _lastSfxAt < 0.05) return; // throttle ~20 Hz max
  _lastSfxAt = now;

  // Lazily build a longer noise buffer once for the flame body.
  if (!_noiseBuf) {
    const len = Math.floor(ac.sampleRate * 0.7);
    _noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Layer 1: warm low-pass body — the "fwoosh" of flame.
  // Slow attack avoids the snappy gunshot transient. The cutoff
  // sweeps DOWN as the sound trails off, like flame fading.
  const body = ac.createBufferSource();
  body.buffer = _noiseBuf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(2200, now);
  lp.frequency.exponentialRampToValueAtTime(380, now + 0.5);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, now);
  bg.gain.linearRampToValueAtTime(0.06, now + 0.05);
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  body.connect(lp).connect(bg).connect(ac.destination);
  body.start(now);
  body.stop(now + 0.65);

  // Layer 2: airy high-pass crackle for the burning feel.
  const crackle = ac.createBufferSource();
  crackle.buffer = _noiseBuf;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2400;
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0.0001, now);
  cg.gain.linearRampToValueAtTime(0.018, now + 0.04);
  cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  crackle.connect(hp).connect(cg).connect(ac.destination);
  crackle.start(now);
  crackle.stop(now + 0.45);
}
