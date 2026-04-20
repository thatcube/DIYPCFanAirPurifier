// ─── Game collision module ──────────────────────────────────────────
// First-person collision AABBs, bounds, and box pool.
// Separated from the main game module because collision data is
// large and referenced by both physics and debug display.

import {
  BED_X, BED_W, BED_L, BED_Z, BED_CLEARANCE, BED_H,
  TBL_X, TBL_W, TBL_H, TBL_Z, TBL_D,
  SIDE_WALL_X, LEFT_WALL_X, OPP_WALL_Z, BACK_WALL_Z,
  CLOSET_W, CLOSET_H, CLOSET_DEPTH, CLOSET_INTERIOR_W, CLOSET_Z,
  WALL_HEIGHT, WIN_W, WIN_H, WIN_CENTER_Z,
  PLAYER_BODY_R, PLAYER_EYE_H, PLAYER_HEAD_EXTRA,
  getFloorY, getWinCenterY, roomAABB
} from './spatial.js';
import { state } from './state.js';

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
  xMin: -(SIDE_WALL_X + CLOSET_DEPTH) + 2,
  xMax: -(LEFT_WALL_X) - 2,
  zMin: OPP_WALL_Z - CLOSET_INTERIOR_W / 2,
  zMax: 49 - 0.25
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
