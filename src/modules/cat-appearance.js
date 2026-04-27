// ─── Cat appearance module ──────────────────────────────────────────
// Color presets, fur shader, texture recoloring, and the function
// that applies a color/hair preset to a loaded cat model.

import * as THREE from 'three';
import { state } from './state.js';
import { CAT_COLOR_PRESETS, CAT_HAIR_PRESETS, CAT_MODEL_PRESETS } from './constants.js';

// ── State ───────────────────────────────────────────────────────────

export let catModelKey = 'classic';
export let catColorKey = 'charcoal';
export let catHairKey = 'short';

// ── Totodile unlock ─────────────────────────────────────────────────
// Totodile is locked until the player beats the game (collects all the
// regular coins) in under 2 minutes. Unlock state persists in
// localStorage so it survives reloads.
export const TOTODILE_UNLOCK_TIME_MS = 120000; // 2:00.000
const TOTODILE_UNLOCK_KEY = 'diy_totodile_unlocked';

export function isTotodileUnlocked() {
  try { return localStorage.getItem(TOTODILE_UNLOCK_KEY) === '1'; }
  catch (e) { return false; }
}
export function setTotodileUnlocked(v) {
  try {
    if (v) localStorage.setItem(TOTODILE_UNLOCK_KEY, '1');
    else localStorage.removeItem(TOTODILE_UNLOCK_KEY);
  } catch (e) { /* private mode etc. */ }
}
/**
 * Call when a run finishes. Returns true if this finish newly unlocked
 * Totodile (so callers can fire a celebration toast).
 */
export function tryUnlockTotodile(timeMs) {
  const t = Number(timeMs);
  if (!Number.isFinite(t) || t <= 0 || t >= TOTODILE_UNLOCK_TIME_MS) return false;
  if (isTotodileUnlocked()) return false;
  setTotodileUnlocked(true);
  return true;
}

// ── Bababooey unlock ────────────────────────────────────────────────
// Bababooey is locked until the player goes Super Saiyan in first-person
// mode. How that happens is not explained in-game. Unlock state persists
// in localStorage.
const BABABOOEY_UNLOCK_KEY = 'diy_bababooey_unlocked';

export function isBababooeyUnlocked() {
  try { return localStorage.getItem(BABABOOEY_UNLOCK_KEY) === '1'; }
  catch (e) { return false; }
}
export function setBababooeyUnlocked(v) {
  try {
    if (v) localStorage.setItem(BABABOOEY_UNLOCK_KEY, '1');
    else localStorage.removeItem(BABABOOEY_UNLOCK_KEY);
  } catch (e) { /* private mode etc. */ }
}
/**
 * Call when Super Saiyan activates. Returns true if this call newly
 * unlocked Bababooey (so callers can fire a celebration toast).
 */
export function tryUnlockBababooey() {
  if (isBababooeyUnlocked()) return false;
  setBababooeyUnlocked(true);
  return true;
}

export function setCatModelKeyRaw(k) { catModelKey = k; }
export function setCatColorKeyRaw(k) { catColorKey = k; }
export function setCatHairKeyRaw(k) { catHairKey = k; }

// ── Sanitizers ──────────────────────────────────────────────────────

export function sanitizeColorKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return CAT_COLOR_PRESETS[k] ? k : 'charcoal';
}
export function sanitizeModelKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return CAT_MODEL_PRESETS[k] ? k : 'classic';
}
export function sanitizeHairKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return CAT_HAIR_PRESETS[k] ? k : 'short';
}

export function getModelPreset(key) {
  return CAT_MODEL_PRESETS[sanitizeModelKey(key)] || CAT_MODEL_PRESETS.classic;
}
export function getSelectedModelPreset() {
  return getModelPreset(catModelKey);
}
export function isColorable(key) {
  return !!getModelPreset(key || catModelKey).colorable;
}
export function isToonSource(src) {
  return /toon/i.test(String(src || ''));
}
export function getModelSource(model) {
  return (model && model.userData && model.userData.modelSource) || '';
}

// ── Source list ──────────────────────────────────────────────────────

export function getSourcesForModelKey(key) {
  const preset = getModelPreset(key || catModelKey);
  const out = (preset.sources || []).slice();
  if (!out.includes('assets/cat.glb')) out.push('assets/cat.glb');
  return out;
}

// ── Material caches (WeakMaps) ──────────────────────────────────────

const _baseColorMap = new WeakMap();
const _baseRoughnessMap = new WeakMap();
const _baseBumpScaleMap = new WeakMap();
const _baseEmissiveMap = new WeakMap();
const _baseEmissiveIMap = new WeakMap();
const _boneBaseScaleMap = new WeakMap();

// Scratch objects
const _tmpA = new THREE.Color();
const _tmpB = new THREE.Color();
const _tmpC = new THREE.Color();
const _tmpHSL = { h: 0, s: 0, l: 0 };
const _tmpHSLB = { h: 0, s: 0, l: 0 };
const _furTint = new THREE.Color();

// ── Texture recoloring cache ────────────────────────────────────────

const _recoloredTexCache = new Map();

export function recolorFurTexture(srcTex, coatHex) {
  if (!srcTex || !srcTex.image) return srcTex;
  const key = (srcTex.uuid || '') + '_' + coatHex;
  if (_recoloredTexCache.has(key)) return _recoloredTexCache.get(key);

  const img = srcTex.image;
  const w = img.width || img.naturalWidth || 256;
  const h = img.height || img.naturalHeight || 256;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  const tc = new THREE.Color(coatHex);
  const tHSL = { h: 0, s: 0, l: 0 };
  tc.getHSL(tHSL);
  const tmpCol = new THREE.Color();
  const tmpH = { h: 0, s: 0, l: 0 };

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    tmpCol.setRGB(r, g, b);
    tmpCol.getHSL(tmpH);
    if (tmpH.l > 0.05 && tmpH.l < 0.97) {
      tmpCol.setHSL(tHSL.h, tHSL.s, tmpH.l);
      d[i] = Math.round(tmpCol.r * 255);
      d[i + 1] = Math.round(tmpCol.g * 255);
      d[i + 2] = Math.round(tmpCol.b * 255);
    }
  }

  ctx.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = srcTex.flipY;
  tex.wrapS = srcTex.wrapS; tex.wrapT = srcTex.wrapT;
  tex.magFilter = srcTex.magFilter; tex.minFilter = srcTex.minFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  _recoloredTexCache.set(key, tex);
  return tex;
}

// ── Fur noise texture ───────────────────────────────────────────────

let _furNoiseTexture = null;

export function getFurNoiseTexture() {
  if (_furNoiseTexture) return _furNoiseTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 255) | 0;
    img.data[i] = n; img.data[i + 1] = n; img.data[i + 2] = n; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.needsUpdate = true;
  _furNoiseTexture = tex;
  return tex;
}

// ── Fur shader ──────────────────────────────────────────────────────

export function ensureFurShader(mat) {
  if (!mat) return;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCatFurAmount = { value: Number(mat.userData._catFurAmount) || 0 };
    shader.uniforms.uCatFurTint = { value: new THREE.Color(Number(mat.userData._catFurTintHex) || 0xffffff) };
    shader.uniforms.uCatCoatTint = { value: new THREE.Color(Number(mat.userData._catCoatTintHex) || 0xffffff) };
    shader.uniforms.uCatCoatAmount = { value: Number(mat.userData._catCoatAmount) || 0 };
    shader.uniforms.uCatCowAmount = { value: Number(mat.userData._catCowAmount) || 0 };
    shader.uniforms.uCatCowColor1 = { value: new THREE.Color(Number(mat.userData._catCowColor1) || 0x333333) };
    shader.uniforms.uCatCowColor2 = { value: new THREE.Color(Number(mat.userData._catCowColor2) || 0xeeeeee) };

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uCatFurAmount;',
        'uniform vec3 uCatFurTint;',
        'uniform vec3 uCatCoatTint;',
        'uniform float uCatCoatAmount;',
        'uniform float uCatCowAmount;',
        'uniform vec3 uCatCowColor1;',
        'uniform vec3 uCatCowColor2;',
        'float cowHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
        'float cowNoise(vec2 p){',
        '  vec2 i=floor(p), f=fract(p);',
        '  f=f*f*(3.0-2.0*f);',
        '  float a=cowHash(i), b=cowHash(i+vec2(1,0)),',
        '        c=cowHash(i+vec2(0,1)), d=cowHash(i+vec2(1,1));',
        '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);',
        '}',
        'float cowPattern(vec2 uv){',
        '  float n=cowNoise(uv*3.0)*0.5 + cowNoise(uv*6.0+vec2(5.3,2.7))*0.3 + cowNoise(uv*12.0+vec2(9.1,4.3))*0.2;',
        '  return step(0.48, n + (1.0-uv.y)*0.15);',
        '}'
      ].join('\n'))
      .replace('#include <output_fragment>', [
        'float catViewDot = saturate( abs( dot( normal, normalize( vViewPosition ) ) ) );',
        'float catRim = pow( 1.0 - catViewDot, 2.0 );',
        'float catNoise = fract( sin( dot( vViewPosition.xy * 31.0 + normal.xy * 22.0, vec2(12.9898,78.233) ) ) * 43758.5453 );',
        'float catFurRim = catRim * mix(0.62,1.45,catNoise);',
        'float catTexLuma = dot( diffuseColor.rgb, vec3(0.2126,0.7152,0.0722) );',
        'float catTexMax = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );',
        'float catTexMin = min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );',
        'float catTexSat = (catTexMax - catTexMin) / max(0.0001, catTexMax);',
        'float catFurMask = smoothstep(0.12,0.62,catTexLuma) * (1.0 - smoothstep(0.9,1.0,catTexLuma));',
        'catFurMask *= mix(0.42,1.0,smoothstep(0.08,0.34,catTexSat));',
        'float catLightLuma = dot( outgoingLight, vec3(0.2126,0.7152,0.0722) );',
        'vec3 catTinted = uCatCoatTint * max(0.15, catLightLuma * 1.6);',
        'vec3 catColorized = mix( outgoingLight, catTinted, uCatCoatAmount * (0.38 + (0.62 * catFurMask)) );',
        'float catFuzz = mix(1.0, mix(0.76,1.28,catNoise), min(1.0, uCatFurAmount * 0.95) * catFurMask);',
        'vec3 catFurGlow = uCatFurTint * (catFurRim * uCatFurAmount * catFurMask);',
        'vec3 catFinal = (catColorized * catFuzz) + catFurGlow;',
        'gl_FragColor = vec4( catFinal, diffuseColor.a );'
      ].join('\n'));
    mat.userData._catFurShader = shader;
  };
  mat.customProgramCacheKey = () => 'catFurShaderV8_cow' + (mat.userData._catCowAmount > 0 ? '1' : '0');
  mat.needsUpdate = true;
}

// ── Hair bone scaling ───────────────────────────────────────────────

export function applyHairToBones(model, hairCfg) {
  if (!model) return;
  const isToon = isToonSource(getModelSource(model));
  model.traverse(o => {
    if (!o.isBone) return;
    if (!_boneBaseScaleMap.has(o)) _boneBaseScaleMap.set(o, o.scale.clone());
    const base = _boneBaseScaleMap.get(o);
    o.scale.copy(base);
  });
}

// ── Apply appearance to a single model ──────────────────────────────

export function applyAppearanceToModel(model, baseScale) {
  if (!model) return;
  const colorCfg = CAT_COLOR_PRESETS[sanitizeColorKey(catColorKey)] || CAT_COLOR_PRESETS.charcoal;
  const hairCfg = CAT_HAIR_PRESETS[sanitizeHairKey(catHairKey)] || CAT_HAIR_PRESETS.short;
  const isToon = isToonSource(getModelSource(model));
  const colorable = isColorable(catModelKey);

  model.scale.set(baseScale.x * hairCfg.sx, baseScale.y * hairCfg.sy, baseScale.z * hairCfg.sz);
  applyHairToBones(model, hairCfg);

  model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    o.castShadow = false;
    const meshName = String(o.name || '').toLowerCase();
    const mats = Array.isArray(o.material) ? o.material : [o.material];

    for (const m of mats) {
      if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || !m.color) continue;
      const matName = String(m.name || '').toLowerCase();

      // Cache original values
      if (!_baseColorMap.has(m)) _baseColorMap.set(m, m.color.clone());
      if (!_baseRoughnessMap.has(m)) _baseRoughnessMap.set(m, Number(m.roughness) || 0.9);
      if (!_baseBumpScaleMap.has(m)) _baseBumpScaleMap.set(m, Number(m.bumpScale) || 0);
      if (!_baseEmissiveMap.has(m)) _baseEmissiveMap.set(m, (m.emissive && m.emissive.isColor) ? m.emissive.clone() : new THREE.Color(0));
      if (!_baseEmissiveIMap.has(m)) _baseEmissiveIMap.set(m, Number(m.emissiveIntensity) || 0);

      const baseCol = _baseColorMap.get(m);
      const baseRough = _baseRoughnessMap.get(m);
      const baseBump = _baseBumpScaleMap.get(m);
      const baseEmi = _baseEmissiveMap.get(m);
      const baseEmiI = _baseEmissiveIMap.get(m);

      const isDetail = /(eye|pupil|nose|mouth|tongue|tooth|teeth|whisker|inner|ear)/.test(meshName + ' ' + matName);

      if (isDetail) {
        m.color.copy(baseCol);
        if (m.userData._catOrigMap && !m.map) m.map = m.userData._catOrigMap;
        m.roughness = baseRough;
        m.bumpScale = baseBump;
        if (m.emissive && m.emissive.isColor) { m.emissive.copy(baseEmi); m.emissiveIntensity = baseEmiI; }
        m.userData._catFurAmount = 0;
        m.userData._catCoatAmount = 0;
        m.userData._catCowAmount = 0;
        if (m.userData._catFurShader) {
          m.userData._catFurShader.uniforms.uCatFurAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCoatAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCowAmount.value = 0;
        }
        m.needsUpdate = true;
        continue;
      }

      if (!colorable) {
        m.color.copy(baseCol);
        if (m.userData._catOrigMap && !m.map) m.map = m.userData._catOrigMap;
        m.roughness = baseRough;
        m.bumpScale = baseBump;
        if (m.emissive && m.emissive.isColor) { m.emissive.copy(baseEmi); m.emissiveIntensity = baseEmiI; }
        if (m.userData._catFurShader) {
          m.userData._catFurShader.uniforms.uCatFurAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCoatAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCowAmount.value = 0;
        }
        m.needsUpdate = true;
        continue;
      }

      if (isToon) {
        _tmpB.setHex(colorCfg.coat);
        m.color.copy(baseCol).lerp(_tmpB, 0.82);
        const toonLong = hairCfg.boneMode === 'long';
        m.roughness = Math.min(1, Math.max(0.45, baseRough * (toonLong ? 1.08 : 0.96)));
        m.bumpMap = null; m.bumpScale = 0; m.normalMap = null;
        if (m.emissive && m.emissive.isColor) {
          m.emissive.copy(baseEmi).lerp(_tmpB, 0.18);
          m.emissiveIntensity = Math.max(baseEmiI, toonLong ? 0.14 : 0.08);
        }
        m.userData._catFurAmount = 0;
        m.userData._catCoatAmount = 0;
        m.userData._catCowAmount = 0;
        if (m.userData._catFurShader) {
          m.userData._catFurShader.uniforms.uCatFurAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCoatAmount.value = 0;
          m.userData._catFurShader.uniforms.uCatCowAmount.value = 0;
        }
        m.needsUpdate = true;
        continue;
      }

      // Classic cat — recolor texture pixels
      _tmpA.copy(baseCol);
      _tmpB.setHex(colorCfg.coat);
      if (!m.userData._catOrigMap && m.map) m.userData._catOrigMap = m.map;
      const origMap = m.userData._catOrigMap;
      if (origMap && origMap.image) {
        m.map = recolorFurTexture(origMap, colorCfg.coat);
      }
      m.color.setRGB(1, 1, 1);
      if (m.emissive && m.emissive.isColor) { m.emissive.copy(baseEmi); m.emissiveIntensity = baseEmiI; }

      m.roughness = Math.min(1, Math.max(0.55, baseRough * hairCfg.rough));
      m.bumpMap = getFurNoiseTexture();
      m.bumpScale = Math.max(0.001, (Math.abs(baseBump) * 0.35) + hairCfg.bump);
      _furTint.setHex(colorCfg.coat).offsetHSL(0, 0, 0.14);

      m.userData._catFurAmount = hairCfg.furRim;
      m.userData._catFurTintHex = _furTint.getHex();
      m.userData._catCoatTintHex = colorCfg.coat;
      m.userData._catCoatAmount = 0;
      m.userData._catCowAmount = 0;

      m.needsUpdate = true;
      ensureFurShader(m);

      if (m.userData._catFurShader) {
        m.userData._catFurShader.uniforms.uCatFurAmount.value = hairCfg.furRim;
        m.userData._catFurShader.uniforms.uCatFurTint.value.copy(_furTint);
        m.userData._catFurShader.uniforms.uCatCoatTint.value.setHex(colorCfg.coat);
        m.userData._catFurShader.uniforms.uCatCoatAmount.value = 0;
        m.userData._catFurShader.uniforms.uCatCowAmount.value = 0;
      }
    }
  });
  model.updateMatrixWorld(true);
}

// ── Leaderboard helpers ─────────────────────────────────────────────

export const CAT_COLOR_EMOJI = { charcoal: '⚫', cream: '🟡', midnight: '🔵', snow: '⚪' };
export const CAT_MODEL_EMOJI = { classic: '🐱', toon: '🐾', bababooey: '😺', totodile: '🐊', korra: '🐈' };
export const CAT_MODEL_LABELS_SHORT = { classic: 'Classic', toon: 'Toon', bababooey: 'Bababooey', totodile: 'Totodile', korra: 'Cursed Korra' };
