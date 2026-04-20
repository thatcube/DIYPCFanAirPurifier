// ─── Coins module ───────────────────────────────────────────────────
// Coin creation, pickup detection, score tracking, and SFX.

import * as THREE from 'three';
import { state } from './state.js';
import { TOTAL_SECRETS } from './constants.js';

// ── State ───────────────────────────────────────────────────────────

export const coins = [];
export let coinScore = 0;
export let coinSecretScore = 0;
export let coinTotal = 0;
export const PICK_RADIUS = 4.6;

// Shared geometry + materials (lazy init)
let _geo = null;
let _mat = null;
let _secretMat = null;

// Audio context — shared with music module
export let audioCtx = null;
export function setAudioCtx(ac) { audioCtx = ac; }
export function getAudioCtx() { return audioCtx; }

// Bonk SFX buffer
let _bonkBuffer = null;

// Toast callback
let _showToast = () => {};
export function setToastFn(fn) { _showToast = fn; }

// ── Coin factory ────────────────────────────────────────────────────

export function makeCoin(opts) {
  if (!_geo) {
    _geo = new THREE.CylinderGeometry(1.2, 1.2, 0.28, 12);
    _geo.rotateX(Math.PI / 2);
  }
  if (!_mat) {
    _mat = new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      emissive: 0xffb300,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.85
    });
  }
  if (opts && opts.secret && !_secretMat) {
    _secretMat = new THREE.MeshStandardMaterial({
      color: 0x4ab8ff,
      emissive: 0x1e88e5,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.85
    });
  }
  const mat = (opts && opts.secret) ? _secretMat : _mat;
  const m = new THREE.Mesh(_geo, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/**
 * Add a coin to the scene.
 */
export function addCoin(parent, localPos, opts) {
  const coin = makeCoin(opts);
  const secret = !!(opts && opts.secret);
  const coinId = (opts && opts.id) || (secret
    ? `secret_${coins.filter(c => c.secret).length + 1}`
    : `coin_${coinTotal + 1}`);
  coin.position.copy(localPos);
  coin.visible = false;
  parent.add(coin);
  coins.push({
    id: coinId,
    mesh: coin,
    basePos: localPos.clone(),
    bobPhase: Math.random() * Math.PI * 2,
    spinSpeed: 0.04 + Math.random() * 0.02,
    parent,
    collected: false,
    insidePurifier: !!(opts && opts.insidePurifier),
    inDrawer: !!(opts && opts.inDrawer),
    consoleProp: !!(opts && opts.consoleProp),
    secret,
    isDynamic: !!(opts && opts.isDynamic)
  });
  if (!secret) coinTotal++;
}

/**
 * Reset scores + remove dynamic coins for a new run.
 */
export function resetScores() {
  coinScore = 0;
  coinSecretScore = 0;
}

/**
 * Play the coin chime SFX.
 * @param {boolean} isSecret - play the fancier arpeggio for secret coins
 */
export function playChime(isSecret) {
  try {
    const ac = _ensureAC();
    if (!ac) return;
    if (isSecret) {
      const notes = [1047, 1319, 1568, 2093];
      notes.forEach((freq, idx) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.value = 0.15;
        o.connect(g).connect(ac.destination);
        const t = ac.currentTime + idx * 0.08;
        o.start(t);
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.stop(t + 0.32);
      });
    } else {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = 880;
      g.gain.value = 0.12;
      o.connect(g).connect(ac.destination);
      o.start();
      o.frequency.exponentialRampToValueAtTime(1760, ac.currentTime + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
      o.stop(ac.currentTime + 0.26);
    }
  } catch (e) { /* ignore */ }
}

// ── Bonk SFX ────────────────────────────────────────────────────────

export function ensureBonkBuffer(ac) {
  if (_bonkBuffer || !ac) return;
  try {
    const sr = ac.sampleRate;
    const len = Math.ceil(sr * 0.12);
    const buf = ac.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const f0 = 220, f1 = 110;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 28);
      const freq = f0 + (f1 - f0) * (t / 0.12);
      d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.35;
    }
    _bonkBuffer = buf;
  } catch (e) { /* ignore */ }
}

export function playBonk(intensity) {
  try {
    const ac = _ensureAC();
    if (!ac || !_bonkBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = _bonkBuffer;
    const g = ac.createGain();
    g.gain.value = Math.min(0.6, 0.15 + intensity * 0.3);
    src.connect(g).connect(ac.destination);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    src.start();
  } catch (e) { /* ignore */ }
}

// ── Internal ────────────────────────────────────────────────────────

function _ensureAC() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
  return audioCtx;
}
