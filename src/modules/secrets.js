// ─── Secrets module ─────────────────────────────────────────────────
// Interaction-triggered secret coins. Each is hidden until the player
// performs a specific action (click lamp, click fan, open drawer, etc.).
// They don't count toward the main coin total but DO track on the
// leaderboard as secretCoins.

import * as THREE from 'three';
import {
  LEFT_WALL_X, SIDE_WALL_X, OPP_WALL_Z,
  BED_X, BED_Z, BED_L, BED_CLEARANCE,
  TBL_X, TBL_W, TBL_H, TBL_Z, TBL_D,
  WIN_W, WIN_H, WIN_CENTER_Z,
  CLOSET_Z, CLOSET_INTERIOR_W,
  getFloorY, getWinCenterY
} from './spatial.js';
import { state } from './state.js';
import { TOTAL_SECRETS } from './constants.js';

// ── State ───────────────────────────────────────────────────────────

const _triggered = Object.create(null);

// These are set via setRefs() — avoids circular imports
let _addCoin = null;
let _coinGroup = null;
let _purifierGroup = null;
let _coins = null;
let _setCoinsVisible = null;
let _showToast = null;

/**
 * Wire external references needed by spawners.
 */
export function setRefs(refs) {
  _addCoin = refs.addCoin;
  _coinGroup = refs.coinGroup;
  _purifierGroup = refs.purifierGroup;
  _coins = refs.coins;
  _setCoinsVisible = refs.setCoinsVisible;
  _showToast = refs.showToast || (() => {});
}

// ── Core spawner ────────────────────────────────────────────────────

function _spawnIfUntriggered(triggerId, spawnFn) {
  if (_triggered[triggerId]) return;
  _triggered[triggerId] = true;
  const before = _coins.length;
  try { spawnFn(); } catch (e) { console.warn('[secret] spawn failed', triggerId, e); }
  for (let i = before; i < _coins.length; i++) _coins[i].isDynamic = true;
  if (_setCoinsVisible) _setCoinsVisible(_coinGroup.visible);
}

/** Clear triggers so secrets can re-spawn on run reset. */
export function resetTriggers() {
  for (const k of Object.keys(_triggered)) delete _triggered[k];
}

// ── Individual secret spawners ──────────────────────────────────────

/** 1) FAN CLICK → coin on top of purifier */
export function spawnFanCoin() {
  _spawnIfUntriggered('xbox', () => {
    _addCoin(
      _purifierGroup,
      new THREE.Vector3(0, (state.H / 2 + state.ply) + 3, 0),
      { insidePurifier: true, secret: true }
    );
  });
}

/** 2) LAMP CLICK → coin inside lamp shade */
export function spawnLampCoin() {
  const floorY = getFloorY();
  _spawnIfUntriggered('lamp', () => {
    _addCoin(
      _coinGroup,
      new THREE.Vector3(-(TBL_X + TBL_W / 2 - 6), floorY + TBL_H + 22.4, TBL_Z + TBL_D / 2 - 6),
      { secret: true }
    );
  });
}

/** 3) CEILING LIGHT CLICK → 3 Power BI coins in closet */
export function spawnPowerBICoins() {
  const floorY = getFloorY();
  _spawnIfUntriggered('powerbi', () => {
    const pbX = -(SIDE_WALL_X + 2.5);
    const pbZBase = CLOSET_Z - CLOSET_INTERIOR_W / 2 + 3.5;
    const pbStep = 3.2;
    _addCoin(_coinGroup, new THREE.Vector3(pbX, floorY + 6,  pbZBase),            { secret: true });
    _addCoin(_coinGroup, new THREE.Vector3(pbX, floorY + 14, pbZBase + pbStep),   { secret: true });
    _addCoin(_coinGroup, new THREE.Vector3(pbX, floorY + 22, pbZBase + pbStep * 2), { secret: true });
  });
}

/** 4) WINDOW CLICK → moon coin on window sill */
export function spawnWindowCoin() {
  _spawnIfUntriggered('window', () => {
    _addCoin(
      _coinGroup,
      new THREE.Vector3(-LEFT_WALL_X - 2, getWinCenterY() - WIN_H / 2 + 3, WIN_CENTER_Z),
      { secret: true }
    );
  });
}

/** 5) DRAWER OPEN → coin under the bed headboard end */
export function spawnHeadboardCoin() {
  const floorY = getFloorY();
  _spawnIfUntriggered('headboardUnderBed', () => {
    _addCoin(
      _coinGroup,
      new THREE.Vector3(-BED_X, floorY + BED_CLEARANCE - 1.8, BED_Z + BED_L / 2 - 8),
      { secret: true }
    );
  });
}

// 6) MACBOOK CLICK → handled inline in the macbook click handler
//    (spawns a coin above the laptop). Not extracted here because
//    it needs the macbook root's world position at spawn time.

/**
 * Check if all secrets have been collected.
 * @param {number} secretScore - current secret coin score
 */
export function checkAllFound(secretScore) {
  if (secretScore >= TOTAL_SECRETS) {
    setTimeout(() => _showToast('✨ ALL SECRETS FOUND! ✨'), 400);
  }
}
