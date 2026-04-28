// ─── Fireball ability ────────────────────────────────────────────────
// Unlocks when all fans are turned off. Shoots big spammable fireballs
// from the camera (or cat head in FP mode) forward along the look dir.
// Each fireball is a glowing core sphere + outer haze + point light +
// trailing sparks. They self-destruct after a short lifetime.

import * as THREE from 'three';

// ── Config ──────────────────────────────────────────────────────────

const SPEED = 220;   // inches/sec
const LIFETIME = 2.4;   // seconds
const MAX_ACTIVE = 24;    // safety cap so spam doesn't kill perf
const CORE_RADIUS = 3.6;
const HAZE_RADIUS = 6.5;
const TRAIL_PARTICLES = 14;   // sparks per fireball
const GRAVITY = -8;    // slight droop (inches/sec^2)

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _catGroup = null;
let _isFpMode = () => false;

let _unlocked = false;
const _active = []; // { group, vel, age, light, sparks: [{mesh, vel, age, life}] }

// Shared geometries / materials (built lazily on first shoot to keep
// startup cheap)
let _coreGeo = null;
let _hazeGeo = null;
let _sparkGeo = null;

// ── Public API ──────────────────────────────────────────────────────

export function init(refs) {
  _scene = refs.scene;
  _camera = refs.camera;
  _catGroup = refs.catGroup || null;
  _isFpMode = refs.isFpMode || (() => false);
}

export function isUnlocked() { return _unlocked; }

export function setUnlocked(v) {
  _unlocked = !!v;
}

export function shoot() {
  if (!_unlocked || !_scene || !_camera) return false;
  if (_active.length >= MAX_ACTIVE) {
    // Recycle the oldest to keep spam working without unbounded growth.
    _despawn(_active[0]);
  }
  _ensureAssets();

  const origin = _getMuzzlePosition();
  const dir = _getAimDirection();

  const group = new THREE.Group();
  group.position.copy(origin);

  // Core: bright additive sphere, no shadows.
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const core = new THREE.Mesh(_coreGeo, coreMat);
  group.add(core);

  // Inner orange shell.
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xff8a2a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const inner = new THREE.Mesh(_coreGeo, innerMat);
  inner.scale.setScalar(1.35);
  group.add(inner);

  // Outer red haze.
  const hazeMat = new THREE.MeshBasicMaterial({
    color: 0xff3a16,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const haze = new THREE.Mesh(_hazeGeo, hazeMat);
  group.add(haze);

  // Dynamic point light so it actually lights up the room.
  const light = new THREE.PointLight(0xff7a2a, 4.0, 80, 1.6);
  light.castShadow = false;
  group.add(light);

  _scene.add(group);

  const vel = dir.clone().multiplyScalar(SPEED);

  // Sparks: small additive points trailing behind. Each has its own
  // little velocity for a dispersing trail.
  const sparks = [];
  for (let i = 0; i < TRAIL_PARTICLES; i++) {
    const sm = new THREE.MeshBasicMaterial({
      color: i % 2 ? 0xffd070 : 0xff5022,
      transparent: true,
      opacity: 0.0, // fade in as fireball travels
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const s = new THREE.Mesh(_sparkGeo, sm);
    s.position.copy(origin);
    _scene.add(s);
    sparks.push({
      mesh: s,
      vel: dir.clone().multiplyScalar(SPEED * (0.35 + Math.random() * 0.25))
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 18
        )),
      age: -i * 0.018, // staggered birth
      life: 0.55 + Math.random() * 0.35
    });
  }

  _active.push({
    group, core, inner, haze, light,
    vel,
    age: 0,
    sparks
  });
  return true;
}

export function update(dtSec) {
  if (_active.length === 0) return;
  for (let i = _active.length - 1; i >= 0; i--) {
    const fb = _active[i];
    fb.age += dtSec;

    // Move fireball + slight gravity arc.
    fb.vel.y += GRAVITY * dtSec;
    fb.group.position.addScaledVector(fb.vel, dtSec);

    // Pulse the core / haze for a "burning" feel.
    const pulse = 1 + Math.sin(fb.age * 28) * 0.08;
    fb.core.scale.setScalar(pulse);
    fb.haze.scale.setScalar(1 + Math.sin(fb.age * 18 + 1.3) * 0.12);
    fb.inner.rotation.y += dtSec * 4;
    fb.haze.rotation.z += dtSec * 1.5;

    // Light flicker.
    fb.light.intensity = 4.0 + Math.sin(fb.age * 40) * 0.9;

    // Fade in early, fade out late.
    const lifeT = fb.age / LIFETIME;
    let alpha = 1.0;
    if (lifeT > 0.7) alpha = Math.max(0, 1 - (lifeT - 0.7) / 0.3);
    fb.core.material.opacity = alpha;
    fb.inner.material.opacity = 0.9 * alpha;
    fb.haze.material.opacity = 0.55 * alpha;
    fb.light.intensity *= alpha;

    // Sparks update.
    for (let j = 0; j < fb.sparks.length; j++) {
      const sp = fb.sparks[j];
      sp.age += dtSec;
      if (sp.age < 0) continue;
      sp.vel.y += GRAVITY * 1.5 * dtSec;
      sp.mesh.position.addScaledVector(sp.vel, dtSec);
      const sLifeT = sp.age / sp.life;
      sp.mesh.material.opacity = sLifeT < 0.15
        ? sLifeT / 0.15
        : Math.max(0, 1 - (sLifeT - 0.15) / 0.85);
      sp.mesh.scale.setScalar(1 - 0.5 * sLifeT);
    }

    if (fb.age >= LIFETIME) {
      _despawn(fb);
      _active.splice(i, 1);
    }
  }
}

// ── Internals ───────────────────────────────────────────────────────

function _ensureAssets() {
  if (_coreGeo) return;
  _coreGeo = new THREE.SphereGeometry(CORE_RADIUS, 20, 14);
  _hazeGeo = new THREE.SphereGeometry(HAZE_RADIUS, 16, 10);
  _sparkGeo = new THREE.SphereGeometry(0.85, 8, 6);
}

function _getMuzzlePosition() {
  // FP mode: shoot from the cat's head if we can find it; otherwise
  // from just below+ahead of the camera so it visibly leaves the player.
  const out = new THREE.Vector3();
  if (_isFpMode() && _catGroup) {
    _catGroup.getWorldPosition(out);
    out.y += 9; // approx head height above cat origin
  } else {
    out.copy(_camera.position);
  }
  // Push slightly forward along aim so it doesn't clip the camera.
  const fwd = _getAimDirection();
  out.addScaledVector(fwd, 6);
  return out;
}

function _getAimDirection() {
  const v = new THREE.Vector3();
  _camera.getWorldDirection(v);
  v.normalize();
  return v;
}

function _despawn(fb) {
  if (!fb) return;
  if (fb.group && fb.group.parent) fb.group.parent.remove(fb.group);
  fb.core.material.dispose();
  fb.inner.material.dispose();
  fb.haze.material.dispose();
  for (const sp of fb.sparks) {
    if (sp.mesh.parent) sp.mesh.parent.remove(sp.mesh);
    sp.mesh.material.dispose();
  }
}
