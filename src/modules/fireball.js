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
const CORE_RADIUS = 5.4;
const HAZE_RADIUS = 10.5;
const TRAIL_PARTICLES = 36;   // sparks per fireball (continuously recycled into a trail)
const TRAIL_LIFE = 0.45;       // seconds each spark stays alive
const TRAIL_EMIT_RATE = 110;   // sparks emitted per second per fireball
const GRAVITY = -8;    // slight droop (inches/sec^2)
const EXPLODE_DUR = 0.35;      // seconds the impact flash lasts
const EXPLODE_MAX_SCALE = 4.5; // haze grows this much during the burst
const HIT_BACKOFF = 0.6;       // pull impact point back along travel dir (inches)
const SCORCH_RADIUS = 6.0;     // burn mark size on hit surface (inches)
const SCORCH_LIFE = 6.0;       // seconds the scorch stays before fading
const SCORCH_FADE = 1.5;       // seconds of fade-out at end of life
const SCORCH_MAX = 240;        // cap so we don't accumulate forever

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
const _prevPos = new THREE.Vector3();
const _segDir = new THREE.Vector3();

// Single shared raycaster for impact detection. Reused across all
// fireballs each frame so we don't allocate.
const _raycaster = new THREE.Raycaster();
const _rcResults = [];
let _catMarked = false;

// Scorch decals (ring buffer). Each is a small dark circle parented
// to the hit point on the world, kept short-lived and capped.
const _scorches = [];
let _scorchIdx = 0;
let _scorchGeo = null;
let _scorchTexPool = null;
let _laserScorchTexPool = null;
const SCORCH_TEX_VARIANTS = 6;
const _tmpNormal = new THREE.Vector3();
const _tmpUp = new THREE.Vector3(0, 1, 0);

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

// Allow other ability modules (e.g. kamehameha) to drop scorch marks
// using the same texture pool & ring buffer the fireballs use, so a
// single shared cap covers everything.
export function spawnScorch(hit, travelDir, sizeMul = 1) {
  _spawnScorch(hit, travelDir, sizeMul);
}

// Variant of spawnScorch that uses a tighter, much darker, "laser
// burn" texture instead of the soft-edged soot splat. Same ring buffer
// + cap, but pulls from a dedicated texture pool so the look stays
// clean (no spatter, no streaks).
export function spawnLaserScorch(hit, travelDir, sizeMul = 1) {
  _spawnScorch(hit, travelDir, sizeMul, /*laser*/ true);
}

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

    // ── Exploding branch: frozen in place, growing & fading. ─────────
    if (fb.exploding) {
      fb.explodeAge += dtSec;
      const eT = Math.min(1, fb.explodeAge / EXPLODE_DUR);
      // Ease-out grow + fade.
      const eo = 1 - (1 - eT) * (1 - eT);
      const s = 1 + (EXPLODE_MAX_SCALE - 1) * eo;
      fb.core.scale.setScalar(s * 0.7);
      fb.inner.scale.setScalar(s * 1.0);
      fb.haze.scale.setScalar(s * 1.4);
      const a = 1 - eo;
      fb.coreMat.opacity = a;
      fb.innerMat.opacity = a;
      fb.hazeMat.opacity = 0.85 * a;
      // Sparks keep animating (handled below).
      _animateSparks(fb, dtSec, /*emit*/ false);
      if (fb.age < newestAge) { newestAge = fb.age; newest = fb; }
      if (fb.explodeAge >= EXPLODE_DUR) _retire(fb);
      continue;
    }

    // ── Flight branch: integrate motion, then test the swept segment
    // against the scene. We capture the previous position so the ray
    // covers the full step (no tunneling at high speed).
    _prevPos.copy(fb.group.position);
    fb.vel.y += GRAVITY * dtSec;
    fb.group.position.addScaledVector(fb.vel, dtSec);

    const hit = _segmentHit(_prevPos, fb.group.position);
    if (hit) {
      // Park at impact, pulled back slightly so the burst doesn't sit
      // inside the geometry.
      _segDir.copy(fb.group.position).sub(_prevPos);
      const segLen = _segDir.length() || 1;
      _segDir.divideScalar(segLen);
      fb.group.position.copy(hit.point).addScaledVector(_segDir, -HIT_BACKOFF);
      _spawnScorch(hit, _segDir, fb.sizeMul || 1);
      _triggerExplosion(fb);
      if (fb.age < newestAge) { newestAge = fb.age; newest = fb; }
      continue;
    }

    const pulse = 1 + Math.sin(fb.age * 28) * 0.08;
    fb.core.scale.setScalar(pulse);
    fb.haze.scale.setScalar(1 + Math.sin(fb.age * 18 + 1.3) * 0.12);
    fb.inner.rotation.y += dtSec * 4;
    fb.haze.rotation.z += dtSec * 1.5;

    const lifeT = fb.age / LIFETIME;
    let alpha = 1.0;
    if (lifeT > 0.7) alpha = Math.max(0, 1 - (lifeT - 0.7) / 0.3);
    fb.coreMat.opacity = alpha;
    fb.innerMat.opacity = 1.0 * alpha;
    fb.hazeMat.opacity = 0.78 * alpha;

    _animateSparks(fb, dtSec, /*emit*/ true);

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
      _sharedLight.intensity = Math.min(11, 4.6 + liveCount * 0.7) * flicker;
    } else {
      _sharedLight.intensity = 0;
    }
  }

  _updateScorches(dtSec);
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
    group.userData._fireballSkip = true;

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff4c2, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.userData._fireballSkip = true;
    group.add(core);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff9a18, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const inner = new THREE.Mesh(coreGeo, innerMat);
    inner.scale.setScalar(1.45);
    inner.userData._fireballSkip = true;
    group.add(inner);

    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0xff4410, transparent: true, opacity: 0.78,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.userData._fireballSkip = true;
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
      mesh.userData._fireballSkip = true;
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
      emitAccum: 0,
      exploding: false, explodeAge: 0,
      group, core, inner, haze,
      coreMat, innerMat, hazeMat,
      vel: new THREE.Vector3(),
      sparks
    });
  }

  // One shared light for the whole system. Single light = stable shader
  // program = no recompile stutter on rapid fire.
  _sharedLight = new THREE.PointLight(0xff7a2a, 0, 120, 1.6);
  _sharedLight.castShadow = false;
  _sharedLight.userData._fireballSkip = true;
  _scene.add(_sharedLight);
}

function _arm(fb) {
  _getMuzzlePosition(_tmpOrigin);
  _getAimDirection(_tmpDir);

  // Mark the cat group once so fireballs don't blow up on the caster.
  if (!_catMarked && _catGroup) {
    _catGroup.traverse(o => { if (o && o.userData) o.userData._fireballSkip = true; });
    _catMarked = true;
  }

  fb.active = true;
  fb.age = 0;
  fb.exploding = false;
  fb.explodeAge = 0;
  fb.group.position.copy(_tmpOrigin);
  fb.group.visible = true;
  fb.vel.copy(_tmpDir).multiplyScalar(SPEED);

  // Per-shot size variation: skewed small. Most shots are ~0.4x-0.85x,
  // occasional ones go up to ~1.15x. Applied to the whole group so the
  // visual, the trail spawn radius, and downstream scorch size all
  // scale together.
  const r = Math.random();
  // Pow > 1 biases toward 0; range 0.35..1.15.
  fb.sizeMul = 0.35 + Math.pow(r, 1.6) * 0.8;
  fb.group.scale.setScalar(fb.sizeMul);

  fb.coreMat.opacity = 1;
  fb.innerMat.opacity = 1.0;
  fb.hazeMat.opacity = 0.78;
  fb.core.scale.setScalar(1);
  fb.inner.scale.setScalar(1.45);
  fb.haze.scale.setScalar(1);

  // Mark all sparks "dead" so the trail emitter (in update) is the
  // sole source of trail particles. This avoids a forward-shooting
  // burst of sparks at spawn that races ahead of the head.
  for (let j = 0; j < fb.sparks.length; j++) {
    const sp = fb.sparks[j];
    sp.age = 999;
    sp.life = 0;
    sp.mesh.visible = false;
    sp.mat.opacity = 0;
  }
  fb.emitAccum = 0;
}

function _retire(fb) {
  fb.active = false;
  fb.exploding = false;
  fb.group.visible = false;
  for (let j = 0; j < fb.sparks.length; j++) {
    fb.sparks[j].mesh.visible = false;
  }
}

// Shared spark animation. When `emit` is true new trail sparks spawn
// behind the head; the explode branch passes false so the existing
// outward burst keeps animating without new trail emission.
function _animateSparks(fb, dtSec, emit) {
  let toEmit = 0;
  if (emit) {
    fb.emitAccum += dtSec * TRAIL_EMIT_RATE;
    toEmit = fb.emitAccum | 0;
    if (toEmit > 0) fb.emitAccum -= toEmit;
  }
  const sparks = fb.sparks;
  for (let j = 0; j < sparks.length; j++) {
    const sp = sparks[j];

    if (toEmit > 0 && sp.age >= sp.life) {
      sp.age = 0;
      sp.life = TRAIL_LIFE * (0.75 + Math.random() * 0.5);
      const speedMag = fb.vel.length() || 1;
      const backOff = HAZE_RADIUS * (1.1 + Math.random() * 0.6);
      sp.mesh.position.copy(fb.group.position);
      sp.mesh.position.x -= (fb.vel.x / speedMag) * backOff;
      sp.mesh.position.y -= (fb.vel.y / speedMag) * backOff;
      sp.mesh.position.z -= (fb.vel.z / speedMag) * backOff;
      sp.mesh.visible = true;
      const back = 0.18 + Math.random() * 0.15;
      sp.vel.copy(fb.vel).multiplyScalar(back);
      sp.vel.x += (Math.random() - 0.5) * 7;
      sp.vel.y += (Math.random() - 0.5) * 6;
      sp.vel.z += (Math.random() - 0.5) * 7;
      toEmit--;
    }

    if (sp.age >= sp.life) { sp.mesh.visible = false; continue; }
    sp.age += dtSec;
    sp.vel.y += GRAVITY * 0.5 * dtSec;
    sp.mesh.position.addScaledVector(sp.vel, dtSec);
    const sLifeT = sp.age / sp.life;
    sp.mat.opacity = sLifeT < 0.08
      ? sLifeT / 0.08
      : Math.max(0, 1 - (sLifeT - 0.08) / 0.92);
    const s = 2.2 - 1.7 * sLifeT;
    sp.mesh.scale.setScalar(Math.max(0.05, s));
  }
}

// Raycast the swept segment from `from` to `to` against the scene.
// Returns the first non-self hit, or null. Skips any object whose
// userData._fireballSkip is true (anywhere up its parent chain).
function _segmentHit(from, to) {
  _segDir.copy(to).sub(from);
  const dist = _segDir.length();
  if (dist < 1e-4) return null;
  _segDir.divideScalar(dist);
  _raycaster.set(from, _segDir);
  _raycaster.near = 0;
  _raycaster.far = dist + CORE_RADIUS;
  // Sprites in the scene require Raycaster.camera; without it three.js
  // throws when it tries to read camera.matrixWorld during sprite tests.
  _raycaster.camera = _camera;
  _rcResults.length = 0;
  _raycaster.intersectObject(_scene, true, _rcResults);
  for (let i = 0; i < _rcResults.length; i++) {
    const hit = _rcResults[i];
    if (_isOwnObject(hit.object)) continue;
    return hit;
  }
  return null;
}

function _isOwnObject(o) {
  while (o) {
    if (o.userData && o.userData._fireballSkip) return true;
    o = o.parent;
  }
  return false;
}

// Stop motion, mark the fireball as exploding, and burst its remaining
// sparks outward in random directions. Animation is handled by the
// explode branch in update().
function _triggerExplosion(fb) {
  fb.exploding = true;
  fb.explodeAge = 0;
  fb.vel.set(0, 0, 0);

  const sparks = fb.sparks;
  for (let j = 0; j < sparks.length; j++) {
    const sp = sparks[j];
    sp.age = 0;
    sp.life = TRAIL_LIFE * (0.9 + Math.random() * 0.5);
    sp.mesh.position.copy(fb.group.position);
    sp.mesh.visible = true;
    // Outward in a random direction, faster than trail sparks.
    const phi = Math.random() * Math.PI * 2;
    const cosTh = Math.random() * 2 - 1;
    const sinTh = Math.sqrt(Math.max(0, 1 - cosTh * cosTh));
    const speed = 55 + Math.random() * 55;
    sp.vel.set(
      Math.cos(phi) * sinTh * speed,
      cosTh * speed,
      Math.sin(phi) * sinTh * speed
    );
  }
}

// Place a dark circular scorch on the hit surface. Uses the hit's face
// normal (transformed into world space) so it lies flat against walls,
// floors, ceilings — anything we hit. Reused via a ring buffer.
function _spawnScorch(hit, travelDir, fireballSize = 1, laser = false) {
  if (!_scene) return;

  // Compute world-space normal. Falls back to the reverse of travel
  // direction if the geometry didn't supply a face normal.
  let nx, ny, nz;
  if (hit.face && hit.object && hit.object.matrixWorld) {
    _tmpNormal.copy(hit.face.normal)
      .transformDirection(hit.object.matrixWorld)
      .normalize();
    nx = _tmpNormal.x; ny = _tmpNormal.y; nz = _tmpNormal.z;
  } else {
    nx = -travelDir.x; ny = -travelDir.y; nz = -travelDir.z;
    const m = Math.hypot(nx, ny, nz) || 1;
    nx /= m; ny /= m; nz /= m;
  }

  // Lazily build geometry + texture shared by all scorches. The texture
  // is a procedural splatter: dark soot falloff in the middle plus a
  // scatter of ink-spatter dots, so it doesn't read as a clean circle.
  if (!_scorchGeo) {
    _scorchGeo = new THREE.PlaneGeometry(SCORCH_RADIUS * 2, SCORCH_RADIUS * 2);
  }
  if (!_scorchTexPool) {
    _scorchTexPool = [];
    for (let i = 0; i < SCORCH_TEX_VARIANTS; i++) {
      _scorchTexPool.push(_buildScorchTexture());
    }
  }
  if (laser && !_laserScorchTexPool) {
    _laserScorchTexPool = [];
    for (let i = 0; i < SCORCH_TEX_VARIANTS; i++) {
      _laserScorchTexPool.push(_buildLaserScorchTexture());
    }
  }
  const activePool = laser ? _laserScorchTexPool : _scorchTexPool;
  const pickedTex = activePool[(Math.random() * activePool.length) | 0];

  let entry = _scorches[_scorchIdx];
  if (!entry) {
    const mat = new THREE.MeshBasicMaterial({
      map: pickedTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(_scorchGeo, mat);
    mesh.userData._fireballSkip = true;
    _scene.add(mesh);
    entry = { mesh, mat, age: 0, alive: false };
    _scorches[_scorchIdx] = entry;
  } else {
    entry.mat.map = pickedTex;
    entry.mat.needsUpdate = true;
  }
  _scorchIdx = (_scorchIdx + 1) % SCORCH_MAX;

  // Position just off the surface so it doesn't z-fight even without
  // polygon offset support, and orient to face along the normal.
  entry.mesh.position.set(
    hit.point.x + nx * 0.15,
    hit.point.y + ny * 0.15,
    hit.point.z + nz * 0.15
  );
  _tmpNormal.set(nx, ny, nz);
  // lookAt orients the mesh's +Z toward the target. Circle geometry's
  // face is in the XY plane (normal +Z), so aiming +Z along the
  // surface normal makes the disc lie flat against the surface.
  entry.mesh.lookAt(
    entry.mesh.position.x + nx,
    entry.mesh.position.y + ny,
    entry.mesh.position.z + nz
  );
  // Slight random roll for variety.
  entry.mesh.rotateZ(Math.random() * Math.PI * 2);

  // Scorch size is tied to the fireball that made it. Center is dense
  // and dark; edges fall off and stay sparse even on big splats.
  const SCORCH_TO_FIREBALL = laser ? 0.35 : 0.75;
  const sizeJitter = (0.85 + Math.random() * 0.3) * fireballSize * SCORCH_TO_FIREBALL;
  // Laser scorches stay nearly round; fireball ones get more stretch.
  const stretchRange = laser ? 0.15 : 0.5;
  const stretchBase = laser ? 0.92 : 0.8;
  const stretchX = stretchBase + Math.random() * stretchRange;
  const stretchY = stretchBase + Math.random() * stretchRange;
  entry.mesh.scale.set(
    sizeJitter * stretchX,
    sizeJitter * stretchY,
    1
  );
  entry.mat.opacity = laser ? (0.92 + Math.random() * 0.08) : (0.7 + Math.random() * 0.3);
  entry.mat.userData._baseOp = entry.mat.opacity;
  entry.mesh.visible = true;
  entry.age = 0;
  entry.alive = true;
}

function _updateScorches(dtSec) {
  for (let i = 0; i < _scorches.length; i++) {
    const e = _scorches[i];
    if (!e || !e.alive) continue;
    e.age += dtSec;
    if (e.age >= SCORCH_LIFE) {
      e.alive = false;
      e.mesh.visible = false;
      continue;
    }
    const fadeStart = SCORCH_LIFE - SCORCH_FADE;
    if (e.age > fadeStart) {
      const t = (e.age - fadeStart) / SCORCH_FADE;
      const baseOp = e.mat.userData?._baseOp ?? e.mat.opacity;
      e.mat.opacity = baseOp * (1 - t);
    }
  }
}

// Build a procedural splatter texture once. Uses a 2D canvas to draw
// a dark soft-edged center plus a swarm of small randomly-sized dots
// so the result reads as ink/soot spatter rather than a flat disc.
function _buildScorchTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Per-variant randomization: shift the splat center a bit, vary core
  // softness, dot count, and spatter spread so each baked texture
  // looks distinct rather than a uniform circle.
  const cx = size / 2 + (Math.random() - 0.5) * size * 0.08;
  const cy = size / 2 + (Math.random() - 0.5) * size * 0.08;
  const coreR = size * (0.18 + Math.random() * 0.10);
  const coreAlpha = 0.95 + Math.random() * 0.05;

  // Soft soot core: dense, almost opaque in the very middle, falling
  // off quickly so the dark mass is concentrated dead-center.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  grad.addColorStop(0.0, `rgba(2,1,1,${coreAlpha.toFixed(3)})`);
  grad.addColorStop(0.35, `rgba(6,4,3,${(coreAlpha * 0.85).toFixed(3)})`);
  grad.addColorStop(0.7, `rgba(12,8,5,${(coreAlpha * 0.35).toFixed(3)})`);
  grad.addColorStop(1.0, 'rgba(20,12,8,0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  // Inner dense cluster: lots of small dots packed near the center to
  // reinforce the dark mass — heavy bias toward r=0.
  ctx.fillStyle = 'rgba(4,2,1,0.85)';
  const innerCount = 90 + ((Math.random() * 80) | 0);
  const innerMaxR = size * 0.18;
  for (let i = 0; i < innerCount; i++) {
    const r = innerMaxR * Math.pow(Math.random(), 2.2); // strong center bias
    const a = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const dotR = 0.5 + Math.pow(Math.random(), 2) * 4;
    ctx.globalAlpha = 0.55 + Math.random() * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Outer sparse spatter: fewer dots, faint, reaching toward the edge.
  // Strong edge-bias so they sit out in the wispy ring rather than
  // crowding the center.
  const dotCount = 50 + ((Math.random() * 90) | 0);
  const maxR = size * (0.38 + Math.random() * 0.10);
  ctx.fillStyle = 'rgba(8,5,3,0.45)';
  for (let i = 0; i < dotCount; i++) {
    // Bias > 1 pushes samples toward the outer ring.
    const r = innerMaxR + (maxR - innerMaxR) * Math.pow(Math.random(), 0.6);
    const a = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const dotR = Math.pow(Math.random(), 2.6) * (4 + Math.random() * 5) + 0.3;
    // Fade hard with distance so outer specks read as wispy.
    const edgeFade = 1 - (r - innerMaxR) / (maxR - innerMaxR + 0.0001);
    const alpha = 0.25 * edgeFade + 0.05 + Math.random() * 0.1;
    ctx.globalAlpha = Math.min(0.6, alpha);
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Streaky elongated marks — count varies a lot per variant.
  const streakCount = 6 + ((Math.random() * 22) | 0);
  ctx.fillStyle = 'rgba(8,5,3,0.32)';
  for (let i = 0; i < streakCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = maxR * (0.2 + Math.random() * 0.65);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const w = 1 + Math.random() * 3;
    const h = 4 + Math.random() * 18;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (Math.random() - 0.5) * 0.6);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Tight, near-black "laser burn" decal: deep pure-black core, narrow
// charred ring, no spatter or streaks. Reads as a clean cauterized
// pinpoint instead of an ink splat.
function _buildLaserScorchTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  // Outer falloff: very faint smoke-ring far from center, fades to 0.
  const halo = ctx.createRadialGradient(cx, cy, size * 0.18, cx, cy, size * 0.46);
  halo.addColorStop(0.0, 'rgba(0,0,0,0.55)');
  halo.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  halo.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.fill();

  // Charred ring: thin warm-black border just outside the burn hole.
  const ring = ctx.createRadialGradient(cx, cy, size * 0.10, cx, cy, size * 0.20);
  ring.addColorStop(0.0, 'rgba(8,3,1,0.0)');
  ring.addColorStop(0.55, 'rgba(8,3,1,0.85)');
  ring.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.20, 0, Math.PI * 2);
  ctx.fill();

  // Hot dark core: pure black through the middle.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.13);
  core.addColorStop(0.0, 'rgba(0,0,0,1.0)');
  core.addColorStop(0.6, 'rgba(0,0,0,0.98)');
  core.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
  ctx.fill();

  // Tiny per-variant breakup so repeated marks don't read identical.
  const breakCount = 6 + ((Math.random() * 6) | 0);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < breakCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * (0.13 + Math.random() * 0.06);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + Math.random() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function _getMuzzlePosition(out) {
  // Always emit from in front of the cat (not the camera), low to the
  // ground so the fireball clearly comes from the cat's mouth/paws
  // rather than appearing mid-air at eye level.
  if (_catGroup) {
    _catGroup.getWorldPosition(out);
    out.y += 3; // a bit above the cat's base — roughly mouth height
  } else {
    out.copy(_camera.position);
  }
  const fwd = _tmpDir;
  _getAimDirection(fwd);
  // Push the spawn point further forward so it's clearly in front of
  // the cat, not inside it.
  out.addScaledVector(fwd, 14);
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
