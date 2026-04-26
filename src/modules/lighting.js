// ─── Lighting module ────────────────────────────────────────────────
// All light creation, time-of-day curves, and the applyTimeOfDay
// function that updates every light + surface color each frame.

import * as THREE from 'three';
import { state } from './state.js';
import {
  DAY_CLEAR, NIGHT_CLEAR
} from './constants.js';

// ── Internal helpers ────────────────────────────────────────────────
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _cmix = new THREE.Color();

export function lerpHex(a, b, t) {
  _c1.setHex(a);
  _c2.setHex(b);
  _cmix.copy(_c1).lerp(_c2, t);
  return _cmix;
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// ── Sun / warmth / beam curves ──────────────────────────────────────

export function sunCurve(minuteOfDay) {
  const h = minuteOfDay / 60;
  if (h <= 5.5) return 0;
  if (h <= 7.5) return (h - 5.5) / 2;
  if (h <= 12) return 0.7 + 0.3 * ((h - 7.5) / 4.5);
  if (h <= 14) return 1.0;
  if (h <= 17) return 1.0 - 0.15 * ((h - 14) / 3);
  if (h <= 19.5) return 0.85 * (1 - (h - 17) / 2.5);
  return 0;
}

export function warmthCurve(minuteOfDay) {
  const h = minuteOfDay / 60;
  if (h >= 6 && h <= 8) return 1 - Math.abs(h - 7);
  if (h >= 17 && h <= 19) return 1 - Math.abs(h - 18);
  return 0;
}

export function windowBeamCurve(minuteOfDay) {
  const h = minuteOfDay / 60;
  if (h <= 5.5) return 0;
  if (h < 7.0) return (h - 5.5) / 1.5;
  if (h < 17.0) return 1;
  return 0;
}

// ── Color constants ─────────────────────────────────────────────────

const GOLDEN_KEY  = 0xffddaa;

// ── Lights ──────────────────────────────────────────────────────────
// Exported so other modules can reference them (e.g., game mode
// toggles ceiling light on/off).

export let hemiLight;
export let key;          // directional shadow-caster (sun through window)
export let windowSun;    // spot (sweeping sun beam, no shadow)
export let ceilSpot;     // downward spot from ceiling fixture
export let ceilGlow;     // point glow near ceiling fixture
export let lampLight;    // desk lamp point light
export let tvGlow;       // TV screen glow
export let moonGlow;     // moonlight through window at night

// Stubs for removed fill/rim/bounce (kept for compat)
export const fill   = { intensity: 0, position: { set() {} }, visible: false };
export const rim    = { intensity: 0, position: { set() {} }, visible: false };
export const bounce = { intensity: 0, position: { set() {} }, visible: false };

export const ROOM_LIGHT_BASE = {
  fill:   { x: -10, y: 12, z: -12 },
  rim:    { x: -6,  y: 15, z: -18 },
  bounce: { x: 0,   y: -10, z: 8 }
};

export let isNightMode = false;

/**
 * Create all scene lights. Call once after scene is ready.
 * @param {boolean} isMobile
 */
export function createLights(isMobile) {
  const { scene } = state;

  // Hemisphere
  hemiLight = new THREE.HemisphereLight(0x8899bb, 0xffeedd, 0.18);
  scene.add(hemiLight);

  // Key directional (sun through window)
  // Shadow radius kept low (3) so the window-wall sections cast a clearly
  // visible window-shaped shadow on the floor and opposite wall.
  key = new THREE.DirectionalLight(0xffe0a0, 1.4);
  key.position.set(95, 38, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = isMobile ? 5 : 8;
  key.shadow.blurSamples = isMobile ? 8 : 16;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 350;
  key.shadow.camera.left = -120;
  key.shadow.camera.right = 120;
  key.shadow.camera.top = 130;
  key.shadow.camera.bottom = -95;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

  // Window sun spot (sweeping beam, no shadow)
  windowSun = new THREE.SpotLight(0xffe0a0, 0, 260, Math.PI * 0.60, 0.72, 1.0);
  windowSun.position.set(95, 38, 0);
  windowSun.castShadow = false;
  windowSun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  windowSun.shadow.bias = -0.0002;
  windowSun.shadow.normalBias = 0.012;
  windowSun.shadow.radius = isMobile ? 5 : 10;
  windowSun.shadow.camera.near = 1;
  windowSun.shadow.camera.far = 260;
  scene.add(windowSun);
  scene.add(windowSun.target);
  windowSun.visible = false;
}

/**
 * Create the ceiling fixture lights. Called after the fixture mesh is built.
 * @param {number} ceilLightX
 * @param {number} ceilY
 * @param {number} ceilLightZ
 * @param {number} floorY
 */
export function createCeilingLights(ceilLightX, ceilY, ceilLightZ, floorY) {
  const { scene } = state;

  ceilSpot = new THREE.SpotLight(0xfff0dd, 1.1, 0, Math.PI * 0.42, 0.6, 0.9);
  ceilSpot.position.set(ceilLightX, ceilY - 1, ceilLightZ);
  ceilSpot.target.position.set(ceilLightX, floorY, ceilLightZ);
  scene.add(ceilSpot);
  scene.add(ceilSpot.target);
  ceilSpot.castShadow = false;
  ceilSpot.shadow.mapSize.set(512, 512);
  ceilSpot.shadow.bias = -0.0005;
  ceilSpot.shadow.radius = 5;
  ceilSpot.shadow.blurSamples = 12;
  ceilSpot.shadow.camera.near = 10;
  ceilSpot.shadow.camera.far = 95;

  // ceilGlow is co-located with the fixture mesh and tagged _isRoom so
  // it moves with the room when placement changes. Offset -8 in Y for
  // a better lighting angle on the ceiling plane.
  ceilGlow = new THREE.PointLight(0xfff3df, 0.35, 0, 0.8);
  ceilGlow.position.set(ceilLightX, ceilY - 8, ceilLightZ);
  ceilGlow.castShadow = false;
  ceilGlow._isRoom = true;
  scene.add(ceilGlow);
}

/**
 * Create the desk lamp light.
 */
export function createLampLight(x, y, z) {
  lampLight = new THREE.PointLight(0xffddaa, 1.2, 80);
  lampLight.position.set(x, y, z);
  lampLight.castShadow = false;
  lampLight._isRoom = true;
  state.scene.add(lampLight);
}

/**
 * Create the TV glow light.
 */
export function createTvGlow(tvCenterX, tvCenterY, tvZ, tvD) {
  tvGlow = new THREE.PointLight(0x6688cc, 0.6, 80, 0.9);
  tvGlow.position.set(tvCenterX, tvCenterY, tvZ + tvD / 2 + 12);
  tvGlow.castShadow = false;
  tvGlow._isRoom = true;
  state.scene.add(tvGlow);
}

/**
 * Create the moonlight glow through the window.
 */
export function createMoonGlow(leftWallX, winCenterY, winCenterZ) {
  moonGlow = new THREE.PointLight(0x8899bb, 0, 60, 1.0);
  moonGlow.position.set(leftWallX + 3, winCenterY, winCenterZ);
  moonGlow.castShadow = false;
  moonGlow._isRoom = true;
  state.scene.add(moonGlow);
}

/**
 * Apply time-of-day lighting. Called every frame or on slider change.
 *
 * @param {number} minuteOfDay - 0..1439
 * @param {object} refs - references to room meshes and state:
 *   { ceilLightOn, domeMat, outdoor,
 *     mirroredWindowX, winCenterY, winCenterZ, winW,
 *     winTop, winBottom, winFront, winBack,
 *     wallMeshes, baseMeshes, floorMat,
 *     moonGlow,
 *     _markShadowsDirty }
 */
export function applyTimeOfDay(minuteOfDay, refs) {
  const sun  = sunCurve(minuteOfDay);
  const warm = warmthCurve(minuteOfDay);
  const beam = windowBeamCurve(minuteOfDay);
  const h    = minuteOfDay / 60;
  const dayTravel = Math.max(0, Math.min(1, (h - 6.0) / (17.0 - 6.0)));

  isNightMode = sun < 0.3;
  document.body.classList.toggle('night-mode', isNightMode);

  const { renderer, scene } = state;

  // Clear color + fog
  const clearCol = lerpHex(NIGHT_CLEAR, DAY_CLEAR, sun);
  renderer.setClearColor(clearCol.clone(), 1);
  scene.fog.color.copy(clearCol);
  scene.fog.density = mix(0.003, 0.0015, sun);
  // Exposure curve — lower at night so surfaces darken naturally via lighting
  // instead of forcing dark material colors. Daytime peak dialed down ~20%
  // so clicking the window to switch to day isn't blinding.
  renderer.toneMappingExposure = mix(1.0, 1.47, sun);

  // Key / window sun
  const keyColor = warm > 0.1
    ? lerpHex(0xffe0a0, GOLDEN_KEY, warm)
    : lerpHex(0x6688cc, 0xffe0a0, sun);
  key.color.copy(keyColor);
  windowSun.color.copy(keyColor);
  const baseKeyIntensity = mix(0.34, 1.85, sun) + warm * 0.18;
  key.intensity = beam > 0 ? Math.max(0.4, baseKeyIntensity * 0.75) * beam : 0;
  windowSun.visible = beam > 0;
  // SpotLight intensity is in candela (physically correct) — scale up from the
  // legacy baseKeyIntensity so the beam is actually visible on surfaces.
  windowSun.intensity = beam > 0 ? Math.max(50, baseKeyIntensity * 140) * beam : 0;

  // Window sun sweep positions
  const beamSrcY = Math.max(refs.winBottom + 4, Math.min(refs.winTop - 4, mix(refs.winTop + 11, refs.winTop + 1, dayTravel)));
  const beamSrcZ = Math.max(refs.winFront + 2, Math.min(refs.winBack - 2, refs.winCenterZ + mix(-refs.winW * 0.30, refs.winW * 0.30, dayTravel)));
  const beamTgtY = mix(refs.winCenterY + 6, refs.winCenterY - 2, dayTravel);
  const beamTgtZ = refs.winCenterZ + mix(-28, 28, dayTravel);

  windowSun.position.set(refs.mirroredWindowX + 13, beamSrcY, beamSrcZ);
  windowSun.target.position.set(mix(-22, 14, dayTravel), beamTgtY, beamTgtZ);
  windowSun.target.updateMatrixWorld();

  key.position.set(refs.mirroredWindowX + 14, refs.winCenterY + 22, refs.winCenterZ);
  key.target.position.set(0, refs.winCenterY - 12, refs.winCenterZ);
  key.target.updateMatrixWorld();
  key.updateMatrixWorld();
  key.shadow.camera.updateProjectionMatrix();

  // Hemisphere — at night the base is low so surfaces darken naturally;
  // ceiling-light-on adds a bigger boost to compensate.
  hemiLight.intensity = mix(0.12, 0.62, sun) + (refs.ceilLightOn ? mix(0.38, 0.1, sun) : 0);
  {
    const sky = lerpHex(0x334466, 0x8899bb, sun);
    if (refs.ceilLightOn) {
      const warmMix = (1 - sun) * 0.5;
      sky.lerp(new THREE.Color(0xfff0d0), warmMix);
    }
    hemiLight.color.copy(sky);
  }
  hemiLight.groundColor.copy(lerpHex(0x221100, 0xffeedd, sun));

  // Ceiling lights — dimmer at night (like a real dimmer switch), brighter midday.
  const _cs = refs.ceilSpot || ceilSpot;
  const _cg = refs.ceilGlow || ceilGlow;
  if (_cs) _cs.intensity = refs.ceilLightOn ? mix(80, 60, sun) : 0;
  if (refs.domeMat) refs.domeMat.emissiveIntensity = refs.ceilLightOn ? mix(0.7, 0.65, sun) : 0;
  if (_cg) _cg.intensity = refs.ceilLightOn ? mix(28, 25, sun) : 0;

  // Outdoor backdrop — dim significantly at night
  if (refs.outdoor) {
    refs.outdoor.material.color.setScalar(mix(0.12, 1.2, sun) + warm * 0.2);
  }

  // Moonlight
  const moonLight = refs.moonGlow || moonGlow;
  if (moonLight) moonLight.intensity = mix(60, 0, sun);

  // Mirror-finish bowl: PMREM env reflections are independent of scene
  // lighting, so at night the stainless bowl stays as bright as at noon.
  // Scale envMapIntensity with ambient brightness — daylight keeps a crisp
  // reflection, night with lights off dims it to ~0.1 so it reads as dark
  // metal instead of a lit-up mirror. Ceiling lights restore some sheen.
  if (state.bowlMat) {
    const lit = refs.ceilLightOn ? 1 : 0;
    const base = mix(0.1, 1.5, sun);      // night-dark → daylight-bright
    const lampBoost = lit ? mix(0.6, 0.15, sun) : 0;
    state.bowlMat.envMapIntensity = base + lampBoost;
  }

  // TV screen: the screen material has envMapIntensity:0 so we don't
  // modulate reflection here (PMREM RoomEnvironment has bright rectangle
  // light panels baked in that would otherwise show as phantom glow).
  // We only dim the emissive image so the TV acts like it's actually off.
  if (state.tvScreenMat) {
    const tvOnEmissive = state.tvScreenMat.userData?._tvOnEmissive ?? 0;
    if (tvOnEmissive > 0) {
      const tvOn = refs.ceilLightOn ? 1 : Math.max(0, (sun - 0.4) / 0.3);
      state.tvScreenMat.emissiveIntensity = tvOnEmissive * Math.min(1, tvOn);
    }
  }

  // TV ambient glow PointLight — only on when the TV itself is "on".
  if (state.tvGlow) {
    const tvOn = refs.ceilLightOn ? 1 : Math.max(0, (sun - 0.4) / 0.3);
    state.tvGlow.intensity = 50 * Math.min(1, tvOn);
  }

  // Room surfaces — keep materials at their natural (paint/fabric) color.
  // The reduced hemisphere + exposure at night darkens everything naturally
  // via PBR lighting, so we don't override material colors per time-of-day.

  // Shadow refresh
  if (refs._markShadowsDirty) refs._markShadowsDirty();
}

// ── Time formatting ─────────────────────────────────────────────────

export function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const mn  = Math.floor(minutes % 60);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12  = h24 % 12 || 12;
  return h12 + ':' + (mn < 10 ? '0' : '') + mn + ' ' + ampm;
}
