// ─── Particle / airflow system ───────────────────────────────────────
// Handles the air particle visualization: directional flow when fans
// are spinning, ambient drift when fans are off.

import * as THREE from 'three';
import { state } from './state.js';

// ── Constants ───────────────────────────────────────────────────────

const PARTICLE_COUNT = 350;

// Parametric breakpoints along t=0→1
const T0 = 0, T1 = 0.40, T2 = 0.48, T3 = 0.62, T4 = 0.75, T5 = 1.0;

// ── State ───────────────────────────────────────────────────────────

let spinning = true;
let spinSpeed = 0;
let spinTarget = 0;
const SPIN_MAX = 0.25;
let fanSpeedPct = 50;
let fanSpeedRPM = 900;
let airflowOn = false;
let activeParticleCount = PARTICLE_COUNT;

spinTarget = SPIN_MAX * (fanSpeedPct / 100);

// ── Buffers ─────────────────────────────────────────────────────────

const positions    = new Float32Array(PARTICLE_COUNT * 3);
const colors       = new Float32Array(PARTICLE_COUNT * 3);
const paramT       = new Float32Array(PARTICLE_COUNT);
const tSpeed       = new Float32Array(PARTICLE_COUNT);
const y0           = new Float32Array(PARTICLE_COUNT);
const z0           = new Float32Array(PARTICLE_COUNT);
const side         = new Int8Array(PARTICLE_COUNT);
const exitDir      = new Int8Array(PARTICLE_COUNT);
const wobble       = new Float32Array(PARTICLE_COUNT);
const exhX         = new Float32Array(PARTICLE_COUNT);
const stagnantBase = new Float32Array(PARTICLE_COUNT * 3);
const stagnantWobbleRate = new Float32Array(PARTICLE_COUNT);

for (let i = 0; i < PARTICLE_COUNT; i++) {
  stagnantWobbleRate[i] = 0.006 + 0.003 * Math.sin(i * 0.37);
}

// ── Geometry + mesh ─────────────────────────────────────────────────

const geo = new THREE.BufferGeometry();
const mat = new THREE.PointsMaterial({
  size: 0.32, transparent: true, opacity: 0.85,
  vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false
});
let mesh = null; // set in init()

// ── Path functions ──────────────────────────────────────────────────

function pathX(t, s, exhaust) {
  const { W, ft } = state;
  const panelW = W + 2 * ft;
  const outerX = W / 2 + ft + 40;
  const filterOuter = W / 2 + ft;
  const filterInner = W / 2;
  const insideX = W / 4;
  const dir = s;
  if (t <= T1) {
    const f = t / T1;
    const ease = f * f;
    return dir * (outerX + (filterOuter - outerX) * ease);
  }
  if (t <= T2) {
    const f = (t - T1) / (T2 - T1);
    return dir * (filterOuter + (filterInner - filterOuter) * f);
  }
  if (t <= T3) {
    const f = (t - T2) / (T3 - T2);
    return dir * (filterInner + (insideX - filterInner) * f);
  }
  if (t <= T4) {
    const f = (t - T3) / (T4 - T3);
    return dir * insideX * (1 - f) + exhaust * f;
  }
  const f = (t - T4) / (T5 - T4);
  return exhaust + exhaust * 0.1 * f;
}

function pathZ(t, startZ, eDir) {
  const { D, ply } = state;
  const zRange = D + 2 * ply;
  if (t <= T3) return startZ;
  if (t <= T4) {
    const f = (t - T3) / (T4 - T3);
    const fanZ = eDir * (zRange / 2 + 1);
    return startZ + (fanZ - startZ) * f;
  }
  const f = (t - T4) / (T5 - T4);
  const fanZ = eDir * (zRange / 2 + 1);
  const exhaust = eDir * (zRange / 2 + 30);
  return fanZ + (exhaust - fanZ) * f;
}

function pathY(t, startY) {
  const { H } = state;
  const filterY = startY;
  const fanClampY = Math.max(-H / 2 + 1, Math.min(H / 2 - 1, startY));
  if (t <= T2) return filterY;
  if (t <= T3) {
    const f = (t - T2) / (T3 - T2);
    return filterY + (fanClampY - filterY) * f;
  }
  return fanClampY;
}

// ── Init helpers ────────────────────────────────────────────────────

function initParticle(i, stagger) {
  const { H } = state;
  const panelW = state.panelW;
  side[i] = Math.random() > 0.5 ? 1 : -1;
  exitDir[i] = Math.random() > 0.5 ? 1 : -1;
  exhX[i] = (Math.random() - 0.5) * panelW * 0.85;
  y0[i] = -H / 2 - 10 + Math.random() * (H + 20);
  z0[i] = (Math.random() - 0.5) * 50;
  wobble[i] = Math.random() * Math.PI * 2;
  tSpeed[i] = 0.0015 + Math.random() * 0.002;
  paramT[i] = stagger ? Math.random() : 0;
  const t = paramT[i];
  positions[i * 3]     = pathX(t, side[i], exhX[i]);
  positions[i * 3 + 1] = y0[i];
  positions[i * 3 + 2] = pathZ(t, z0[i], exitDir[i]);
  colors[i * 3] = 0.33; colors[i * 3 + 1] = 0.73; colors[i * 3 + 2] = 1.0;
}

function initStagnant(i) {
  const { H } = state;
  stagnantBase[i * 3]     = (Math.random() - 0.5) * 70;
  stagnantBase[i * 3 + 1] = -H / 2 - 5 + Math.random() * (H + 20);
  stagnantBase[i * 3 + 2] = (Math.random() - 0.5) * 60;
  wobble[i] = Math.random() * Math.PI * 2;
  positions[i * 3]     = stagnantBase[i * 3];
  positions[i * 3 + 1] = stagnantBase[i * 3 + 1];
  positions[i * 3 + 2] = stagnantBase[i * 3 + 2];
  colors[i * 3] = 0.2; colors[i * 3 + 1] = 0.5; colors[i * 3 + 2] = 0.8;
}

// ── Public API ──────────────────────────────────────────────────────

export function init() {
  for (let i = 0; i < PARTICLE_COUNT; i++) initStagnant(i);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, activeParticleCount);
  mesh = new THREE.Points(geo, mat);
  mesh.visible = false;
  state.scene.add(mesh);
  return mesh;
}

export function isSpinning() { return spinning; }
export function isAirflowOn() { return airflowOn; }
export function getSpinSpeed() { return spinSpeed; }
export function getSpinTarget() { return spinTarget; }
export function getFanSpeedRPM() { return fanSpeedRPM; }
export function getMesh() { return mesh; }

export function setFanSpeed(rpm) {
  fanSpeedRPM = parseInt(rpm);
  fanSpeedPct = Math.round(fanSpeedRPM / 1800 * 100);
  if (fanSpeedRPM === 0 && spinning) toggleSpin();
  else if (fanSpeedRPM > 0 && !spinning) toggleSpin();
  if (spinning) spinTarget = SPIN_MAX * (fanSpeedPct / 100);
}

export function setActiveCount(count) {
  const clamped = Math.max(64, Math.min(PARTICLE_COUNT, count | 0));
  if (clamped === activeParticleCount) return;
  activeParticleCount = clamped;
  geo.setDrawRange(0, activeParticleCount);
  if (airflowOn) {
    if (spinning) { for (let i = 0; i < activeParticleCount; i++) initParticle(i, true); }
    else { for (let i = 0; i < activeParticleCount; i++) initStagnant(i); }
    geo.attributes.color.needsUpdate = true;
  }
}

/**
 * Toggle fan spin state.
 * @param {object} opts - { allRotors, collapseView, updateUI }
 */
export function toggleSpin(opts = {}) {
  spinning = !spinning;
  if (spinning && fanSpeedRPM === 0) {
    fanSpeedPct = 50;
    fanSpeedRPM = 900;
  }
  spinTarget = spinning ? SPIN_MAX * (fanSpeedPct / 100) : 0;
  if (opts.allRotors) {
    for (const rotor of opts.allRotors) rotor.userData.spinning = spinning;
  }
  if (opts.collapseView && spinning) opts.collapseView();
  if (mesh && mesh.visible) {
    if (spinning) { for (let i = 0; i < activeParticleCount; i++) initParticle(i, true); }
    else { for (let i = 0; i < activeParticleCount; i++) initStagnant(i); }
    geo.attributes.color.needsUpdate = true;
  }
  if (opts.updateUI) opts.updateUI(spinning);
}

/**
 * Toggle airflow visualization.
 * @param {object} opts - { collapseView, updateUI }
 */
export function toggleAirflow(opts = {}) {
  airflowOn = !airflowOn;
  if (mesh) mesh.visible = airflowOn;
  if (opts.collapseView && airflowOn) opts.collapseView();
  if (airflowOn) {
    if (spinning) { for (let i = 0; i < activeParticleCount; i++) initParticle(i, true); }
    else { for (let i = 0; i < activeParticleCount; i++) initStagnant(i); }
    geo.attributes.color.needsUpdate = true;
  }
  if (opts.updateUI) opts.updateUI(airflowOn);
}

/**
 * Update particles for one frame. Call from the render loop.
 * @param {number} animFrameScale - frame time multiplier for consistent speed
 */
export function update(animFrameScale) {
  if (!mesh || !mesh.visible) return;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;

  if (spinning) {
    for (let i = 0; i < activeParticleCount; i++) {
      paramT[i] += tSpeed[i] * (spinSpeed / SPIN_MAX) * animFrameScale;
      wobble[i] += 0.02 * animFrameScale;
      if (paramT[i] >= 1) {
        initParticle(i, false);
        paramT[i] = 0;
      }
      const t = paramT[i];
      let x = pathX(t, side[i], exhX[i]);
      let y = pathY(t, y0[i]);
      let z = pathZ(t, z0[i], exitDir[i]);
      x += Math.sin(wobble[i] * 1.3) * 0.4;
      y += Math.sin(wobble[i] * 0.9) * 0.3;
      z += Math.cos(wobble[i] * 1.1) * 0.35;
      pos.setXYZ(i, x, y, z);
      // Color: outside=blue, inside=cyan, exhaust=white
      if (t < T2) { col.setXYZ(i, 0.33, 0.73, 1.0); }
      else if (t < T4) { col.setXYZ(i, 0.15, 0.9, 0.95); }
      else { const f = (t - T4) / (T5 - T4); col.setXYZ(i, 0.15 + 0.85 * f, 0.9 + 0.1 * f, 0.95 + 0.05 * f); }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  } else {
    // Stagnant mode: gentle ambient wobble
    for (let i = 0; i < activeParticleCount; i++) {
      wobble[i] += stagnantWobbleRate[i] * animFrameScale;
      const p = wobble[i];
      const bx = stagnantBase[i * 3]     + Math.sin(p * 0.71) * 0.8 + Math.sin(p * 1.37) * 0.3;
      const by = stagnantBase[i * 3 + 1] + Math.sin(p * 1.13) * 0.5 + Math.cos(p * 0.83) * 0.2;
      const bz = stagnantBase[i * 3 + 2] + Math.cos(p * 0.93) * 0.6 + Math.sin(p * 1.51) * 0.25;
      pos.setXYZ(i, bx, by, bz);
    }
    pos.needsUpdate = true;
    if (spinning) col.needsUpdate = true;
  }
}

/**
 * Update spin speed lerp. Call from render loop before update().
 * @param {number} animFrameScale
 */
export function updateSpinSpeed(animFrameScale) {
  spinSpeed += (spinTarget - spinSpeed) * 0.05 * animFrameScale;
}

export { PARTICLE_COUNT, activeParticleCount, spinning as spinningState };
