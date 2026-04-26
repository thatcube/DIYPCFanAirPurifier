// ─── Game collision module ──────────────────────────────────────────
// First-person collision AABBs, bounds, and box pool.
// Separated from the main game module because collision data is
// large and referenced by both physics and debug display.

import {
  LEFT_WALL_X, OPP_WALL_Z,
  CLOSET_INTERIOR_W,
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
  // Outdoor terrain extends to pre-mirror X=543 → world X=-543
  xMin: -544 + 0.25,
  xMax: -(LEFT_WALL_X) - 0.25,                   // window wall
  zMin: OPP_WALL_Z - CLOSET_INTERIOR_W / 2,
  // Back wall is at Z=49. Hallway extension runs Z=49..289. Use the hallway
  // end as zMax; static collision boxes on the back-wall flanks and hallway
  // side walls keep the player inside the bedroom X range outside the
  // doorway opening, and inside the hallway X range past Z=49.
  zMax: 289 - 0.25
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

export const BODY_R    = PLAYER_BODY_R;
export const EYE_H     = PLAYER_EYE_H;
export const HEAD_EXTRA = PLAYER_HEAD_EXTRA;

// ── Ease helper ─────────────────────────────────────────────────────

/**
 * Convert a per-second exponential rate to a per-frame alpha.
 * easeAlpha(rate, dt) = 1 - e^(-rate * dt)
 */
export function easeAlpha(rate, dtSec) {
  return 1 - Math.exp(-rate * dtSec);
}
