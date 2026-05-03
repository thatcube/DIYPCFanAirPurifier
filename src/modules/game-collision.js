// ─── Game collision module ──────────────────────────────────────────
// First-person collision AABBs, bounds, and box pool.
// Separated from the main game module because collision data is
// large and referenced by both physics and debug display.

import {
  PLAYER_BODY_R, PLAYER_EYE_H, PLAYER_HEAD_EXTRA
} from './spatial.js';

// ── Box pool (reused each frame) ────────────────────────────────────

const _boxPool = [];
let _boxPoolIdx = 0;

export function acquireBox() {
  if (_boxPoolIdx < _boxPool.length) return _boxPool[_boxPoolIdx++];
  const b = { xMin: 0, xMax: 0, zMin: 0, zMax: 0, yTop: 0, yBottom: undefined, room: false };
  _boxPool.push(b);
  _boxPoolIdx++;
  return b;
}

export function resetBoxPool() {
  _boxPoolIdx = 0;
}

// ── Bounds ──────────────────────────────────────────────────────────

export const boundsBase = {
  // Massive outdoor lawn surrounds the entire house; bounds extend far in
  // every direction. Wall AABBs (bedroom window-wall, office front wall,
  // back wall, hallway walls, etc.) keep the player from clipping into
  // the house structure.
  xMin: -6000,
  xMax: 6000,
  zMin: -6000,
  zMax: 6000
};

export function getBounds(placementOffset) {
  const ox = placementOffset.x, oz = placementOffset.z;
  return {
    xMin: boundsBase.xMin - ox,
    xMax: boundsBase.xMax - ox,
    zMin: boundsBase.zMin - oz,
    zMax: boundsBase.zMax - oz
  };
}

// ── Physics constants (re-exported for convenience) ─────────────────

export const BODY_R = PLAYER_BODY_R;
export const EYE_H = PLAYER_EYE_H;
export const HEAD_EXTRA = PLAYER_HEAD_EXTRA;

// ── Ease helper ─────────────────────────────────────────────────────

/**
 * Convert a per-second exponential rate to a per-frame alpha.
 * easeAlpha(rate, dt) = 1 - e^(-rate * dt)
 */
export function easeAlpha(rate, dtSec) {
  return 1 - Math.exp(-rate * dtSec);
}
