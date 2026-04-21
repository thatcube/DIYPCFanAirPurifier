// ─── Spatial reference & coordinate system ──────────────────────────
//
// AUTHORITATIVE coordinate system for the room.
//
// Post-mirror world space (what the player sees):
//   +X → toward window wall (X ≈ +81)
//   -X → toward closet/side wall (X ≈ -51)
//   +Y → up (ceiling ≈ +67.4)
//   -Y → down (floor ≈ -12.6)
//   +Z → toward back wall / headboard (Z = 49)
//   -Z → toward TV / opposite wall (Z = -78)
//
// X-MIRROR: all _isRoom objects get X-negated after construction.
// Collision AABBs for room objects must pre-negate X.
// Purifier is NOT _isRoom — its coords are used as-is.

import { state } from './state.js';

// ── Room boundaries (pre-mirror construction values) ────────────────

export const LEFT_WALL_X  = -81;   // window wall
export const SIDE_WALL_X  =  51;   // closet/right wall
export const OPP_WALL_Z   = -78;   // TV / opposite wall
export const BACK_WALL_Z  =  49;   // headboard / door wall (interior face ~48.75)
export const WALL_HEIGHT  =  80;
export const WALL_DEPTH   = 127;   // total Z span of main walls

// Post-mirror equivalents (what the player actually experiences)
export const WINDOW_WALL_X =  81;  // = -LEFT_WALL_X
export const CLOSET_WALL_X = -51;  // = -SIDE_WALL_X

// ── Derived positions ───────────────────────────────────────────────

/** Floor Y in world space */
export function getFloorY() {
  return -(state.H / 2 + state.ply + state.bunFootH);
}

/** Ceiling Y in world space */
export function getCeilingY() {
  return getFloorY() + WALL_HEIGHT;
}

// ── Bed ─────────────────────────────────────────────────────────────
export const BED_L = 82.3;    // length along Z
export const BED_W = 60.3;    // width along X
export const BED_H = 42;      // total height
export const BED_CLEARANCE = 6.5;  // floor clearance (walkable under)
export const BED_SLATS_FROM_FLOOR = 10;

// Pre-mirror construction coords
export const BED_X = LEFT_WALL_X + 2 + BED_W / 2;  // = -48.85
export const BED_Z = BACK_WALL_Z - 0.5 - BED_L / 2; // ≈ 7.35

// ── Nightstand ──────────────────────────────────────────────────────
export const TBL_W = 24;
export const TBL_D = 14;
export const TBL_H = 27;
export const TBL_X = BED_X + BED_W / 2 + TBL_W / 2 + 3; // ≈ -3.7
export const TBL_Z = BACK_WALL_Z - 0.5 - TBL_D / 2 - 2;  // ≈ 39.5

// ── Window ──────────────────────────────────────────────────────────
export const WIN_W = 36;   // opening width in Z
export const WIN_H = 50;   // opening height in Y
export function getWinCenterY() { return getFloorY() + 48; }
export const WIN_CENTER_Z = BED_Z;  // centered on bed along Z

// ── Ceiling light ───────────────────────────────────────────────────
// The fixture mesh and ceilGlow light are both at (ceilLightX, ceilY, ceilLightZ)
// and both tagged _isRoom so they move together with the room.
// ceilGlow is offset -8 in Y to create a better lighting angle on the ceiling.
export const CEIL_LIGHT_X = 0;
export const CEIL_LIGHT_Z = -15;

// ── Closet ──────────────────────────────────────────────────────────
export const CLOSET_W = 48;
export const CLOSET_H = 66;
export const CLOSET_DEPTH = 36;
export const CLOSET_INTERIOR_W = 78;
export const CLOSET_Z = OPP_WALL_Z + CLOSET_W / 2 + 4; // = -50

// ── Placement offsets ───────────────────────────────────────────────
export const PLACEMENT_OFFSETS = {
  floor: { x: 0, y: 0, z: 0 },
  table: { x: 3.7, y: TBL_H, z: 39.5 },   // on nightstand
  wall:  { x: -17, y: 28, z: -69.625 },    // under mini-split
  tv:    { x: 45, y: 0, z: -68 }            // under TV
};

// ── Player ──────────────────────────────────────────────────────────
export const PLAYER_EYE_H = 4;       // camera height above _fpPos.y
export const PLAYER_HEAD_EXTRA = -2;  // head collision below camera
export const PLAYER_BODY_R = 1.8;    // collision radius
export const PLAYER_SPAWN_X = 4;
export const PLAYER_SPAWN_Z = 22;

/**
 * Get the player's floor Y (eye height).
 * fpFloorY = floorY + PLAYER_EYE_H
 */
export function getPlayerFloorY() {
  return getFloorY() + PLAYER_EYE_H;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a pre-mirror room X coordinate to post-mirror world X.
 * Use this when you know the construction X and need the world position.
 */
export function mirrorX(x) {
  return -x;
}

/**
 * Negate X for a room-object collision AABB.
 * Room collision boxes store pre-negated X so they match post-mirror world.
 */
export function roomAABB(xMin, xMax, zMin, zMax, yTop, yBottom, extra = {}) {
  return {
    xMin: -xMax,  // negate + swap min/max
    xMax: -xMin,
    zMin,
    zMax,
    yTop,
    yBottom,
    room: true,
    ...extra
  };
}
