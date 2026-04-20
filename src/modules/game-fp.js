// ─── First-person game mode (bridge) ────────────────────────────────
// FP physics, camera, input, collision, and mode transitions.
// Currently a stub with the state + interface that main.js needs.

import * as THREE from 'three';
import { state } from './state.js';
import {
  PLAYER_EYE_H, PLAYER_BODY_R, PLAYER_HEAD_EXTRA,
  PLAYER_SPAWN_X, PLAYER_SPAWN_Z,
  getPlayerFloorY
} from './spatial.js';

// ── State ───────────────────────────────────────────────────────────

export let fpMode = false;
export const fpPos = new THREE.Vector3(PLAYER_SPAWN_X, getPlayerFloorY(), PLAYER_SPAWN_Z);
export let fpYaw = 0;
export let fpPitch = 0;
export let fpVy = 0;
export let fpPaused = false;

export const fpKeys = { w: false, a: false, s: false, d: false, space: false, shift: false };
export let fpLookDX = 0;
export let fpLookDY = 0;

export let lastCatFacingYaw = Math.PI;

// ── SFX mute state ─────────────────────────────────────────────────

export let sfxMuted = false;
export let musicMuted = false;

const SFX_MUTE_KEY = 'diy_air_purifier_muted_v1';
const MUSIC_MUTE_KEY = 'diy_air_purifier_music_muted_v1';

try { sfxMuted = localStorage.getItem(SFX_MUTE_KEY) === '1'; } catch (e) {}
try { musicMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) {}

export function setSfxMuted(muted) {
  sfxMuted = !!muted;
  try { localStorage.setItem(SFX_MUTE_KEY, sfxMuted ? '1' : '0'); } catch (e) {}
}

export function setMusicMuted(muted) {
  musicMuted = !!muted;
  try { localStorage.setItem(MUSIC_MUTE_KEY, musicMuted ? '1' : '0'); } catch (e) {}
}

// ── Mode transitions ────────────────────────────────────────────────

/**
 * Toggle first-person mode. Stub — will contain the full transition.
 */
export function toggleFirstPerson() {
  fpMode = !fpMode;
  console.log('[game-fp] toggleFirstPerson stub, fpMode=', fpMode);
}

/**
 * Physics tick. Stub — will contain the full FP physics loop.
 */
export function updatePhysics(ts, dtSec) {
  if (!fpMode) return;
  // Stub — will be filled with collision, movement, camera update
}
