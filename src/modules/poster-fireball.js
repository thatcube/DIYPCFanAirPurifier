// ─── Poster-fireball: drop-from-poster fireball pickup ───────────────
// Clicking the avatar painting on the bedroom window wall pops a
// literal fireball out of the canvas, arcs it onto the floor in front
// of the bed/TV, and leaves it there as a pickup. Walking up and
// clicking the pickup grants the player the fireball ability — the
// only way to unlock fireballs now that the all-fans-off path was
// repurposed into a secret coin (see coins.spawnSecretFansOffCoin).
//
// Performance: meshes, materials, glow lights, and sparkle sprites are
// built once during prewarm() and toggled visible/invisible on demand.
// No allocations during the drop animation or while the pickup idles.
//
// Persistence: drop + pickup state mirror localStorage so refreshing
// mid-run doesn't make the fireball disappear or re-spawn.

import * as THREE from 'three';
import * as fireball from './fireball.js';

// ── Tunables ────────────────────────────────────────────────────────

// Where the fireball ends up resting on the floor. World-space, post-
// mirror. In front of the bed (BED_X≈+48.85), in front of the TV wall
// (Z=-78), and a few inches off the ground so it reads as floating.
const PICKUP_X = 30;
const PICKUP_Z = -50;
const PICKUP_Y_OFFSET = 4.0;     // inches above the floor

// Drop animation
const DROP_DURATION = 1.05;      // seconds, poster → floor
const DROP_PEAK_LIFT = 5;        // peak above straight-line midpoint (inches)

// Idle bob
const IDLE_BOB_AMP = 0.7;
const IDLE_BOB_SPEED = 1.6;
const IDLE_SPIN_SPEED = 0.6;

// Hitbox — generous so picking up the dropped fireball is forgiving.
// Matches the spirit of the user's "kinda large hitbox" request.
const PICKUP_HITBOX_SIZE = 12;   // cube edge, inches

// Persistence keys
const POSTER_DROP_KEY = 'poster_fireball_dropped_v1';
const POSTER_INTERACT_COUNT_KEY = 'poster_fireball_interact_count_v1';
const PICKUP_COLLECTED_KEY = 'poster_fireball_collected_v1';

// Quirky messages cycled through subsequent poster interactions (after
// the fireball has already been delivered). The first interaction uses
// the dedicated Avatar quote below.
const FIRST_INTERACTION_TOAST =
  '🔥 Then everything changed when the Fire Nation attacked.';
const SUBSEQUENT_INTERACTION_TOASTS = [
  '💨 The Air Nomads are extinct. There is no more bending to give.',
  '💧 The Northern Water Tribe says no.',
  '🪨 The Earth King is in Ba Sing Se. Try there.',
  '🌑 Even the Avatar State has limits.',
  '✋ You already took the fire. Move along, twinkle toes.'
];

// ── State ───────────────────────────────────────────────────────────

let _scene = null;
let _camera = null;
let _showToast = (msg) => { console.log('[poster-fireball]', msg); };
let _initBuilt = false;

// World position the drop animation starts from (poster center).
const _posterStart = new THREE.Vector3();
// World position the fireball lands at.
const _pickupTarget = new THREE.Vector3();

// Pickup group: contains the fireball mesh, glow light, sparkle sprites,
// and an invisible large hitbox. Tagged `_isPickupFireball` so click
// detection walks up to it via _findInteractiveAncestor.
let _pickupGroup = null;
let _coreMesh = null;
let _hazeMesh = null;
let _glowLight = null;
let _sparkles = [];
let _hitbox = null;

// Drop animation state.
let _dropping = false;
let _dropAge = 0;
const _dropFrom = new THREE.Vector3();
const _dropTo = new THREE.Vector3();

// Pickup lifecycle state. Once `_collected` becomes true the pickup
// stays hidden permanently (the unlock persists in fireball module).
let _hasDropped = false;
let _collected = false;
let _interactCount = 0;

try { _hasDropped = localStorage.getItem(POSTER_DROP_KEY) === '1'; } catch (e) { }
try { _collected = localStorage.getItem(PICKUP_COLLECTED_KEY) === '1'; } catch (e) { }
try { _interactCount = parseInt(localStorage.getItem(POSTER_INTERACT_COUNT_KEY) || '0', 10) || 0; } catch (e) { }

// ── Public API ──────────────────────────────────────────────────────

export function init(refs) {
  _scene = refs.scene;
  _camera = refs.camera || null;
  if (refs.showToast) _showToast = refs.showToast;

  // The poster's world position comes from roomRefs, which is built
  // before this module's init runs.
  const poster = refs.roomRefs && refs.roomRefs.avatarPoster;
  if (poster) {
    _posterStart.set(poster.faceX, poster.y, poster.z);
  } else {
    // Sensible fallback if room layout changed: window wall, eye level,
    // poster-area Z. Keeps the drop functional even if the ref vanishes.
    _posterStart.set(80, 60, -50);
  }
  const fy = (typeof refs.floorY === 'number') ? refs.floorY : -23.69;
  _pickupTarget.set(PICKUP_X, fy + PICKUP_Y_OFFSET, PICKUP_Z);
}

// Build pickup meshes/materials/sparkles up front and compile their
// shaders so the first drop or pickup-glow doesn't stutter. Safe to
// call before init() — guarded internally.
export function prewarm(renderer) {
  if (!_scene) return;
  _ensureBuilt();
  if (renderer && renderer.compile && _camera) {
    try { renderer.compile(_scene, _camera); } catch (e) { /* ignore */ }
  }
  // If the player already collected on a previous session, make sure
  // the fireball ability is restored even if storage paths diverged.
  if (_collected && !fireball.isUnlocked()) fireball.setUnlocked(true);
  // Restore pickup mesh visibility based on persisted state.
  _syncPickupVisibility();
}

// Click handler entry point. Called by purifier.js handleClickObject
// when the player aims-and-clicks the avatar painting.
export function handlePosterClick() {
  _ensureBuilt();
  _interactCount++;
  try { localStorage.setItem(POSTER_INTERACT_COUNT_KEY, String(_interactCount)); } catch (e) { }

  if (!_hasDropped && !_collected) {
    // First-time interaction: drop the fireball and show the iconic line.
    _startDrop();
    _hasDropped = true;
    try { localStorage.setItem(POSTER_DROP_KEY, '1'); } catch (e) { }
    _showToast(FIRST_INTERACTION_TOAST);
    return;
  }
  // Subsequent interactions: random themed deflection.
  const idx = (_interactCount - 2) % SUBSEQUENT_INTERACTION_TOASTS.length;
  const msg = SUBSEQUENT_INTERACTION_TOASTS[Math.max(0, idx)];
  _showToast(msg);
}

// Click handler for the dropped pickup mesh. Called by purifier.js
// handleClickObject when the player aims at the floor fireball.
export function handlePickupClick() {
  if (_collected) return;
  _collected = true;
  try { localStorage.setItem(PICKUP_COLLECTED_KEY, '1'); } catch (e) { }
  fireball.setUnlocked(true);
  _syncPickupVisibility();
  _playPickupChime();
  _showToast('🔥 Fireball obtained! Press F to throw fireballs.');
  _updateFireballHudHint();
}

// Per-frame tick — animates the drop arc and idles the pickup.
export function update(dtSec) {
  if (!_initBuilt) return;
  if (_dropping) _tickDrop(dtSec);
  if (!_dropping && _pickupGroup && _pickupGroup.visible && !_collected) {
    _tickIdle(dtSec);
  }
}

// Reset for the secret-reset dev hook (purifier.js _resetSecrets).
// Returns the pickup to its hidden, undropped state and re-locks the
// fireball ability so the player has to find it again.
export function reset() {
  _hasDropped = false;
  _collected = false;
  _interactCount = 0;
  try {
    localStorage.removeItem(POSTER_DROP_KEY);
    localStorage.removeItem(PICKUP_COLLECTED_KEY);
    localStorage.removeItem(POSTER_INTERACT_COUNT_KEY);
  } catch (e) { }
  fireball.setUnlocked(false);
  _dropping = false;
  _syncPickupVisibility();
}

export function isPickupCollected() { return _collected; }
export function hasDropped() { return _hasDropped; }

// ── Internals ───────────────────────────────────────────────────────

function _ensureBuilt() {
  if (_initBuilt || !_scene) return;
  _initBuilt = true;

  // ── Pickup group ──────────────────────────────────────────────────
  _pickupGroup = new THREE.Group();
  _pickupGroup._isPickupFireball = true;
  _pickupGroup.visible = false;
  _scene.add(_pickupGroup);

  // ── Core fireball mesh: layered emissive spheres (additive) ───────
  // Same visual idea as the projectile fireballs in fireball.js, but
  // smaller, no trail, no per-frame raycast — just an idling glow.
  const coreGeo = new THREE.SphereGeometry(2.6, 16, 12);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff4c2, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  _coreMesh = new THREE.Mesh(coreGeo, coreMat);
  _pickupGroup.add(_coreMesh);

  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xff9a18, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const inner = new THREE.Mesh(coreGeo, innerMat);
  inner.scale.setScalar(1.5);
  _pickupGroup.add(inner);

  const hazeGeo = new THREE.SphereGeometry(5.4, 12, 8);
  const hazeMat = new THREE.MeshBasicMaterial({
    color: 0xff4410, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  _hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
  _pickupGroup.add(_hazeMesh);

  // ── Soft point light so the pickup actually lights the floor ──────
  // Parented to the SCENE (not _pickupGroup) and kept always-visible
  // with intensity=0 until the fireball actually drops. Toggling a
  // light's effective visibility (via parent .visible) changes the
  // active-light count, which forces three.js to recompile every PBR
  // material in the room — a multi-frame hitch the user sees as the
  // drop "lagging". Same trick fireball.js uses for its shared light.
  _glowLight = new THREE.PointLight(0xff6a20, 0, 30, 1.8);
  _glowLight.castShadow = false;
  _glowLight.position.copy(_pickupTarget);
  _scene.add(_glowLight);

  // ── Orbiting sparkle sprites (purely visual) ──────────────────────
  const sparkleMat = new THREE.SpriteMaterial({
    color: 0xffd070,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(sparkleMat);
    s.scale.setScalar(0.6 + Math.random() * 0.4);
    s._phase = (i / 6) * Math.PI * 2;
    s._radius = 3.2 + Math.random() * 1.2;
    s._yOff = (Math.random() - 0.5) * 1.6;
    s._speed = 0.9 + Math.random() * 0.6;
    _pickupGroup.add(s);
    _sparkles.push(s);
  }

  // ── Invisible larger hitbox so clicking is forgiving ──────────────
  // PICKUP_HITBOX_SIZE cubed, fully transparent; raycaster still hits
  // it because the material is `transparent` not `visible=false`. The
  // hitbox is also tagged `_isPickupFireball` so the ancestor walk in
  // game-fp.js / purifier.js resolves it directly.
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  _hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(PICKUP_HITBOX_SIZE, PICKUP_HITBOX_SIZE, PICKUP_HITBOX_SIZE),
    hitMat
  );
  _hitbox._isPickupFireball = true;
  // Don't let the hitbox occlude anything else. _isOccluder() in
  // game-fp.js already rejects materials with opacity<0.05, so other
  // ray queries pass through cleanly.
  _hitbox.userData.clickPassthrough = true;
  _pickupGroup.add(_hitbox);

  // Park at the eventual landing target so prewarm-time lighting bake
  // doesn't try to light a position outside the room.
  _pickupGroup.position.copy(_pickupTarget);
}

function _startDrop() {
  _ensureBuilt();
  _dropping = true;
  _dropAge = 0;
  _dropFrom.copy(_posterStart);
  _dropTo.copy(_pickupTarget);
  _pickupGroup.position.copy(_dropFrom);
  _pickupGroup.visible = true;
  // Light is scene-parented; sync its position and turn it on.
  if (_glowLight) {
    _glowLight.position.copy(_dropFrom);
    _glowLight.intensity = 90;
  }
  // Smaller during flight, scales up as it lands so the impact feels
  // like the fireball "settles" once it touches the floor.
  _pickupGroup.scale.setScalar(0.7);
  // Hitbox stays disabled mid-flight — you can't grab a moving fireball.
  if (_hitbox) _hitbox.visible = false;
}

function _tickDrop(dtSec) {
  _dropAge += dtSec;
  const t = Math.min(1, _dropAge / DROP_DURATION);
  // Ease-out for the X/Z lateral travel, gravity-like Y arc.
  const eo = 1 - (1 - t) * (1 - t);
  const x = _dropFrom.x + (_dropTo.x - _dropFrom.x) * eo;
  const z = _dropFrom.z + (_dropTo.z - _dropFrom.z) * eo;
  // Y: linear blend toward the target with an overshoot bump in the
  // middle that approximates an arcing toss before falling.
  const linY = _dropFrom.y + (_dropTo.y - _dropFrom.y) * t;
  const arc = Math.sin(t * Math.PI) * DROP_PEAK_LIFT;
  _pickupGroup.position.set(x, linY + arc, z);
  // Track the light to the group during flight.
  if (_glowLight) _glowLight.position.copy(_pickupGroup.position);
  // Grow during flight, hit full size at landing.
  const s = 0.7 + (1 - 0.7) * t;
  _pickupGroup.scale.setScalar(s);
  if (t >= 1) {
    _dropping = false;
    _pickupGroup.position.copy(_dropTo);
    if (_glowLight) _glowLight.position.copy(_dropTo);
    _pickupGroup.scale.setScalar(1);
    if (_hitbox) _hitbox.visible = true;
    _playLandingChime();
  }
}

function _tickIdle(dtSec) {
  const tNow = performance.now() * 0.001;
  // Bob + slow yaw on the whole group.
  _pickupGroup.position.y = _pickupTarget.y +
    Math.sin(tNow * IDLE_BOB_SPEED) * IDLE_BOB_AMP;
  _pickupGroup.rotation.y += dtSec * IDLE_SPIN_SPEED;
  // Track the scene-parented light to the bobbing group.
  if (_glowLight) _glowLight.position.copy(_pickupGroup.position);
  // Sparkle orbit.
  for (const s of _sparkles) {
    s._phase += dtSec * s._speed;
    s.position.x = Math.cos(s._phase) * s._radius;
    s.position.z = Math.sin(s._phase) * s._radius;
    s.position.y = s._yOff + Math.sin(tNow * 2 + s._phase) * 0.4;
  }
  // Subtle flicker on the glow light.
  if (_glowLight) {
    _glowLight.intensity = 75 + Math.sin(tNow * 6.0) * 10;
  }
}

function _syncPickupVisibility() {
  if (!_pickupGroup) return;
  if (_collected) {
    _pickupGroup.visible = false;
    if (_glowLight) _glowLight.intensity = 0;
  } else if (_hasDropped) {
    _pickupGroup.visible = true;
    _pickupGroup.position.copy(_pickupTarget);
    _pickupGroup.scale.setScalar(1);
    if (_hitbox) _hitbox.visible = true;
    if (_glowLight) {
      _glowLight.position.copy(_pickupTarget);
      _glowLight.intensity = 90;
    }
  } else {
    _pickupGroup.visible = false;
    if (_glowLight) _glowLight.intensity = 0;
  }
}

// Reach into the existing fireball-unlock HUD chip the same way the
// old fans-off path did, so the on-screen "F to throw" hint shows up
// immediately after pickup without waiting for the next poll.
function _updateFireballHudHint() {
  try {
    const hint = document.getElementById('fireballUnlockHint');
    if (hint) hint.classList.add('visible');
  } catch (e) { /* ignore */ }
}

// ── SFX ─────────────────────────────────────────────────────────────
// Tiny WebAudio cues that don't depend on the music module's loader so
// the pickup feels responsive even before any other audio buffers are
// ready. Both gracefully no-op if the audio context can't be opened.

let _audioCtx = null;
function _ensureAudio() {
  if (_audioCtx) return _audioCtx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) _audioCtx = new Ctor();
  } catch (e) { /* ignore */ }
  return _audioCtx;
}

function _playLandingChime() {
  const ac = _ensureAudio();
  if (!ac) return;
  try {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.18);
    g.gain.setValueAtTime(0.18, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.24);
  } catch (e) { /* ignore */ }
}

function _playPickupChime() {
  const ac = _ensureAudio();
  if (!ac) return;
  try {
    const notes = [392, 587, 784, 1175];
    notes.forEach((freq, idx) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.connect(g).connect(ac.destination);
      const t = ac.currentTime + idx * 0.06;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t);
      o.stop(t + 0.24);
    });
  } catch (e) { /* ignore */ }
}
