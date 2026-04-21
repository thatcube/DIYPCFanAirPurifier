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
  // Un-collect all coins so they reappear on the next run
  for (const c of coins) {
    c.collected = false;
    c.mesh.visible = true;
    c.mesh.position.copy(c.basePos);
  }
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

// ── Coin group ──────────────────────────────────────────────────────

let _coinGroup = null;

export function getCoinGroup() { return _coinGroup; }

export function createCoinGroup(scene) {
  _coinGroup = new THREE.Group();
  _coinGroup.visible = false;
  _coinGroup._isCoins = true; // prevent being scooped into purifierGroup
  scene.add(_coinGroup);
  return _coinGroup;
}

export function setCoinsVisible(vis) {
  if (_coinGroup) _coinGroup.visible = vis;
  for (const c of coins) {
    if (!c.collected) c.mesh.visible = vis;
  }
}

// ── Spawn coins in room (exact monolith placements) ─────────────────

// Import spatial constants for coin placement
import {
  BED_X, BED_Z, BED_W, BED_L, BED_CLEARANCE, BED_SLATS_FROM_FLOOR,
  TBL_X, TBL_Z, TBL_W, TBL_D, TBL_H,
  SIDE_WALL_X, LEFT_WALL_X, OPP_WALL_Z, CLOSET_DEPTH, CLOSET_INTERIOR_W, CLOSET_Z,
  getFloorY, getWinCenterY, WIN_W, WIN_H, WIN_CENTER_Z
} from './spatial.js';

export function spawnRoomCoins(roomRefs) {
  if (!_coinGroup) return;
  const fy = getFloorY();
  const bedClearance = BED_CLEARANCE;
  const slatY = fy + BED_SLATS_FROM_FLOOR;
  const mattH = 10, mattY = slatY + 1 + mattH / 2;
  const duvetH = 1.5;
  const hbThick = 3, hbH = 42 - bedClearance; // bedH - bedClearance
  const mattCenterZ = BED_Z - 2;
  // TV vars
  const tvCenterX = BED_X, tvCenterY = fy + 48;
  const tvW = 56.7, tvH = 31.9, tvD = 1.0, bezel = 0.3;
  const tvZ = OPP_WALL_Z + 0.5 + tvD / 2 + 0.1;
  // Mini split vars
  const msX = BED_X + BED_W / 2 + 12, msY = fy + 65, msH = 8, msD = 8, msZ = OPP_WALL_Z + 1;
  // Closet shelf vars
  const shelfCx = SIDE_WALL_X + CLOSET_DEPTH - 0.5 - 0.1 - 7;
  const secZ = CLOSET_Z - (CLOSET_INTERIOR_W - 1) / 2 + (CLOSET_INTERIOR_W - 1) * 0.125;

  // 1. Under the bed
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, fy + bedClearance - 1.8, BED_Z + 4), {});
  // 2. Above nightstand (jump to grab)
  addCoin(_coinGroup, new THREE.Vector3(-TBL_X, fy + TBL_H + 5, TBL_Z), {});
  // 3. Middle of room
  addCoin(_coinGroup, new THREE.Vector3(0, fy + 5, 10), {});
  // 4. Near TV wall
  addCoin(_coinGroup, new THREE.Vector3(25, fy + 6, -40), {});
  // 5. High near mini split (jump!)
  addCoin(_coinGroup, new THREE.Vector3(-20, fy + 28, -60), {});
  // 6. On top of bed
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, mattY + mattH / 2 + duvetH + 3, mattCenterZ), {});
  // 7. On top of headboard
  addCoin(_coinGroup, new THREE.Vector3(-BED_X, fy + bedClearance + hbH + 2.5, BED_Z + BED_L / 2 - hbThick / 2), {});
  // 8. Near closet
  addCoin(_coinGroup, new THREE.Vector3(35, fy + 3, 20), {});
  // 9. On closet shelf
  addCoin(_coinGroup, new THREE.Vector3(-(shelfCx), fy + 80 - 24 + 0.4 + 2.5, secZ), {});
  // 10. On top of mini split
  addCoin(_coinGroup, new THREE.Vector3(-msX, msY + msH / 2 + 2.2, msZ - msD / 2 + 1.5), {});
  // 11. On top of TV
  addCoin(_coinGroup, new THREE.Vector3(-tvCenterX, tvCenterY + tvH / 2 + bezel + 2.2, tvZ - tvD / 2 + 1.2), {});
  // 12. Closet corner (floor)
  addCoin(_coinGroup, new THREE.Vector3(-(SIDE_WALL_X + 2.0), fy + 2.5, CLOSET_Z + CLOSET_INTERIOR_W / 2 - 1.2), {});
  // 13. On top of lamp shade
  addCoin(_coinGroup, new THREE.Vector3(-(TBL_X + TBL_W / 2 - 6), fy + TBL_H + 28.5, TBL_Z + TBL_D / 2 - 6), {});
  // 14. Inside the purifier
  addCoin(_coinGroup, new THREE.Vector3(0, fy + 3, -68), { insidePurifier: true });
}

// ── Secret coin system ──────────────────────────────────────────────

const _secretTriggered = {};

function _spawnSecretIfUntriggered(id, parent, pos, opts) {
  if (_secretTriggered[id]) return;
  _secretTriggered[id] = true;
  addCoin(parent, pos, { ...opts, secret: true, isDynamic: true, id: 'secret_' + id });
  // Make the just-spawned coin visible immediately (we're already in game mode)
  const justAdded = coins[coins.length - 1];
  if (justAdded) justAdded.mesh.visible = true;
  _showToast('🔵 Secret coin!');
}

export function spawnSecretFanCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('xbox', _coinGroup, new THREE.Vector3(45, fy + 15, -68), {});
}

export function spawnSecretLampCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('lamp', _coinGroup,
    new THREE.Vector3(-(TBL_X + TBL_W / 2 - 6), fy + TBL_H + 22.4, TBL_Z + TBL_D / 2 - 6), {});
}

export function spawnSecretCeilingLightCoins() {
  const fy = getFloorY();
  const pbX = -(SIDE_WALL_X + 2.5);
  const pbZBase = CLOSET_Z - CLOSET_INTERIOR_W / 2 + 4;
  const pbStep = 3.2;
  if (_secretTriggered['powerbi']) return;
  _secretTriggered['powerbi'] = true;
  addCoin(_coinGroup, new THREE.Vector3(pbX, fy + 6, pbZBase), { secret: true, isDynamic: true, id: 'secret_pb1' });
  addCoin(_coinGroup, new THREE.Vector3(pbX, fy + 14, pbZBase + pbStep), { secret: true, isDynamic: true, id: 'secret_pb2' });
  addCoin(_coinGroup, new THREE.Vector3(pbX, fy + 22, pbZBase + pbStep * 2), { secret: true, isDynamic: true, id: 'secret_pb3' });
  // Make all 3 visible immediately
  for (let i = coins.length - 3; i < coins.length; i++) {
    if (coins[i]) coins[i].mesh.visible = true;
  }
  _showToast('🔵 Secret coins!');
}

export function spawnSecretWindowCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('window', _coinGroup,
    new THREE.Vector3(-LEFT_WALL_X - 2, getWinCenterY() - WIN_H / 2 + 3, WIN_CENTER_Z), {});
}

export function spawnSecretDrawerCoin() {
  const fy = getFloorY();
  _spawnSecretIfUntriggered('drawer', _coinGroup,
    new THREE.Vector3(-BED_X, fy + BED_CLEARANCE - 1.8, BED_Z + BED_L / 2 - 8), {});
}

export function spawnSecretMacbookCoin() {
  const fy = getFloorY();
  // Float above the macbook on the bed
  const mattH = 10, slatY = fy + BED_SLATS_FROM_FLOOR;
  const mattY = slatY + 1 + mattH / 2;
  const bedTopY = mattY + mattH / 2 + 1.5;
  const rawX = BED_X - 58 / 2 + 12;
  _spawnSecretIfUntriggered('macbook', _coinGroup,
    new THREE.Vector3(-rawX, bedTopY + 9, BED_Z + 6), {});
}

// ── Full reset for new run ──────────────────────────────────────────

export function fullReset() {
  coinScore = 0;
  coinSecretScore = 0;

  // Remove dynamic (secret) coins
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.isDynamic) {
      if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
      coins.splice(i, 1);
    }
  }

  // Clear secret triggers so they can re-spawn
  for (const k of Object.keys(_secretTriggered)) delete _secretTriggered[k];

  // Un-collect all remaining coins
  for (const c of coins) {
    c.collected = false;
    c.mesh.visible = true;
    c.mesh.position.copy(c.basePos);
  }

  // Recalculate coinTotal (secrets were removed)
  coinTotal = coins.filter(c => !c.secret).length;
}

// ── Per-frame update ────────────────────────────────────────────────

export function updateCoins(ts, playerPos) {
  if (!_coinGroup || !_coinGroup.visible) return;

  const t = ts * 0.001;

  for (const c of coins) {
    if (c.collected) continue;

    // Spin + bob
    c.mesh.rotation.y = t * c.spinSpeed * 60;
    c.mesh.position.y = c.basePos.y + Math.sin(t * 2 + c.bobPhase) * 0.8;

    // Pickup check
    if (playerPos) {
      const dx = c.mesh.position.x - playerPos.x;
      const dy = (c.mesh.position.y) - (playerPos.y - 2); // mid-body
      const dz = c.mesh.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < PICK_RADIUS) {
        c.collected = true;
        c.mesh.visible = false;
        if (c.secret) {
          coinSecretScore++;
          playChime(true);
          _showToast('Secret coin found!');
        } else {
          coinScore++;
          playChime(false);
        }
      }
    }
  }
}
