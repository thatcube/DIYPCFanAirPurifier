// ─── Room construction ──────────────────────────────────────────────
// All room geometry: floor, ceiling, walls, bed, nightstand, closet,
// door, TV, mini-split, window, outdoor backdrop, curtains, ceiling light.
//
// Migrated from the monolith index.html (lines 6115-7260).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stdMat } from './materials.js';
import {
  LEFT_WALL_X, SIDE_WALL_X, OPP_WALL_Z, BACK_WALL_Z,
  WALL_HEIGHT, BED_X, BED_Z, BED_L, BED_W, BED_H,
  BED_CLEARANCE, BED_SLATS_FROM_FLOOR,
  TBL_X, TBL_Z, TBL_W, TBL_D, TBL_H,
  CEIL_LIGHT_X, CEIL_LIGHT_Z,
  WIN_W, WIN_H, WIN_CENTER_Z,
  getFloorY, getCeilingY, getWinCenterY
} from './spatial.js';
import { state } from './state.js';
import { getAudioCtx } from './coins.js';
import { sfxMuted } from './game-fp.js';

// ─── Shared door asset ──────────────────────────────────────────────
// 6-panel colonial-style leaf used for the bedroom door and the two
// hallway doors. Layout top→bottom: 2 square panels, 2 tall rectangles,
// lock rail (with doorknob), 2 short-medium rectangles. Origin is at the
// leaf center (width=X, height=Y, thickness=Z). `userData.doorLeaf.lockRailY`
// gives callers the door-local Y at which to mount the knob.
function buildDoorLeaf({ width, height, thickness,
  color = 0xf0ebe4, panelColor = 0xe8e3dc,
  shadowColor = 0xb8b0a4 }) {
  const group = new THREE.Group();
  const slabMat = new THREE.MeshStandardMaterial({ color: shadowColor, roughness: 0.75, metalness: 0.02 });
  const frameMat = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.04 });
  const panelMat = new THREE.MeshStandardMaterial({ color: panelColor, roughness: 0.45, metalness: 0.02 });

  // Real 80"×32" 6-panel door proportions, scaled to this leaf:
  //   topRail 5 / topRow 14 / r2Rail 5 / midRow 22 / lockRail 4 / botRow 22 / botRail 8
  const stileW = Math.max(2.5, width * 0.14);
  const railTopH = height * (5 / 80);
  const rowSqH = height * (14 / 80);
  const railR2H = height * (5 / 80);
  const rowTallH = height * (22 / 80);
  const railLockH = height * (4 / 80);
  const rowShortH = height * (22 / 80);
  const railBotH = height * (8 / 80);
  const frameD = Math.max(0.35, thickness * 0.30);
  const slabT = Math.max(0.1, thickness - frameD * 2);

  // Rail center Ys (door-local, origin at leaf center) — top→bottom.
  const topRailY = height / 2 - railTopH / 2;
  const r2Y = height / 2 - railTopH - rowSqH - railR2H / 2;
  const lockRailY = height / 2 - railTopH - rowSqH - railR2H - rowTallH - railLockH / 2;
  const botRailY = -height / 2 + railBotH / 2;

  // Row center Ys + panel heights.
  const rows = [
    { cy: (topRailY - railTopH / 2 + r2Y + railR2H / 2) / 2, ph: rowSqH },
    { cy: (r2Y - railR2H / 2 + lockRailY + railLockH / 2) / 2, ph: rowTallH },
    { cy: (lockRailY - railLockH / 2 + botRailY + railBotH / 2) / 2, ph: rowShortH },
  ];

  // Uniform border around every raised panel: `border` wide on all four
  // sides between the panel and the surrounding rail/stile/mullion. The
  // center mullion is its own strip with `border` of slab visible on each
  // side (so the inner edge of each panel has the same gap as the outer
  // edge against the stile).
  const innerW = width - stileW * 2;
  const border = Math.max(0.4, Math.min(stileW * 0.35, 1.2));
  const mullionW = border * 2;
  const colW = (innerW - mullionW - border * 4) / 2;
  const colCx = mullionW / 2 + border + colW / 2;
  const panelT = frameD * 0.7; // thinner than frame → sits recessed

  // Base slab — darker recess visible around the raised panels.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, height, slabT), slabMat);
  slab.castShadow = true; slab.receiveShadow = true;
  group.add(slab);

  for (const face of [-1, +1]) {
    const fz = face * (slabT / 2 + frameD / 2);

    // Stiles (L/R full height)
    for (const s of [-1, +1]) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(stileW, height, frameD), frameMat);
      stile.position.set(s * (width / 2 - stileW / 2), 0, fz);
      stile.receiveShadow = true;
      group.add(stile);
    }
    // Central mullion — thin vertical strip with `border` of slab on each
    // side so the panels' inner edges have the same gap as their outer.
    const mullion = new THREE.Mesh(
      new THREE.BoxGeometry(mullionW, height, frameD), frameMat);
    mullion.position.set(0, 0, fz);
    mullion.receiveShadow = true;
    group.add(mullion);

    // Four horizontal rails.
    const addRail = (y, h) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(innerW, h, frameD), frameMat);
      r.position.set(0, y, fz);
      r.receiveShadow = true;
      group.add(r);
    };
    addRail(topRailY, railTopH);
    addRail(r2Y, railR2H);
    addRail(lockRailY, railLockH);
    addRail(botRailY, railBotH);

    // Raised panels — 3 rows × 2 cols. Each panel is inset by `border` on
    // all four sides from the surrounding frame members.
    const panelZ = face * (slabT / 2 + panelT / 2);
    for (const row of rows) {
      const ph = row.ph - border * 2;
      if (ph < 1 || colW < 1) continue;
      for (const col of [-1, +1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(colW, ph, panelT), panelMat);
        p.position.set(col * colCx, row.cy, panelZ);
        p.receiveShadow = true;
        group.add(p);
      }
    }
  }
  group.userData.doorLeaf = { width, height, thickness, slab, lockRailY };
  return group;
}

// Door trim: two jambs + header around an opening of (width × height), with
// the frame centered at Z=0 and depth extending along Z.
function buildDoorFrame({ width, height, depth, frameW = 2.5, color = 0xf5f5f0 }) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
  const left = new THREE.Mesh(new THREE.BoxGeometry(frameW, height, depth), mat);
  left.position.set(-(width / 2 + frameW / 2 - 0.5), 0, 0);
  left.receiveShadow = true; group.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(frameW, height, depth), mat);
  right.position.set(+(width / 2 + frameW / 2 - 0.5), 0, 0);
  right.receiveShadow = true; group.add(right);
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(width + frameW * 2 - 1, frameW, depth), mat);
  header.position.set(0, height / 2 + frameW / 2 - 0.5, 0);
  header.receiveShadow = true; group.add(header);
  return group;
}

// Nicer doorknob (rose + neck + ball). Points along +Z; mirror with
// `rotation.y = Math.PI` for the opposite face. Rose plate is sized to fit
// within a ~3.4" lock rail (keep under ~1.4" radius).
function buildDoorKnob() {
  const group = new THREE.Group();
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xb0aca4, roughness: 0.22, metalness: 0.88 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xc0bcb4, roughness: 0.28, metalness: 0.78 });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 20), plateMat);
  plate.rotation.x = Math.PI / 2; plate.position.z = 0.15;
  group.add(plate);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.9, 14), knobMat);
  neck.rotation.x = Math.PI / 2; neck.position.z = 0.75;
  group.add(neck);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), knobMat);
  ball.position.z = 1.5;
  group.add(ball);
  return group;
}

// Bypass sliding closet panel. Flat shaker-style slab with recessed
// circular finger pull on each face. width/height in the door plane;
// thickness along the track axis (X for the office closet).
function buildBypassPanel({ width, height, thickness = 1.0,
  color = 0xe0d8cc, pullColor = 0xb0aca4,
  pullZOffset = 0 }) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.0 });
  // Main slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, width), mat);
  slab.castShadow = true; slab.receiveShadow = true;
  group.add(slab);
  // Shaker-style raised border on each face
  const bord = 2.0;              // border width
  const proud = 0.12;            // how far it sticks out
  const innerW = width - bord * 2 - 0.4;
  const innerH = height - bord * 2 - 0.4;
  const frameMat = new THREE.MeshStandardMaterial({ color: color + 0x060606, roughness: 0.65, metalness: 0.0 });
  for (const face of [-1, 1]) {
    const fz = face * (thickness / 2 + proud / 2);
    // top
    const t = new THREE.Mesh(new THREE.BoxGeometry(proud, bord, innerW + bord * 2), frameMat);
    t.position.set(fz, height / 2 - bord / 2, 0); t.receiveShadow = true; group.add(t);
    // bottom
    const b = new THREE.Mesh(new THREE.BoxGeometry(proud, bord, innerW + bord * 2), frameMat);
    b.position.set(fz, -height / 2 + bord / 2, 0); b.receiveShadow = true; group.add(b);
    // left
    const l = new THREE.Mesh(new THREE.BoxGeometry(proud, innerH, bord), frameMat);
    l.position.set(fz, 0, -width / 2 + bord / 2); l.receiveShadow = true; group.add(l);
    // right
    const r = new THREE.Mesh(new THREE.BoxGeometry(proud, innerH, bord), frameMat);
    r.position.set(fz, 0, width / 2 - bord / 2); r.receiveShadow = true; group.add(r);
  }
  // Recessed circular finger pull on each face (flush disc)
  const pullMat = new THREE.MeshStandardMaterial({ color: pullColor, roughness: 0.3, metalness: 0.6 });
  for (const face of [-1, 1]) {
    const pull = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.15, 16), pullMat);
    pull.rotation.z = Math.PI / 2;
    pull.position.set(face * (thickness / 2 + 0.08), 0, -pullZOffset);
    pull.receiveShadow = true;
    group.add(pull);
  }
  return group;
}

// ─── Shared window model ───────────────────────────────────────────
// Double-hung style: upper pane (fixed) + lower pane (slides up to open).
// Origin at the center of the opening. X = depth, Y = up, Z = width.
function buildWindowModel({ width, height, frameThickness = 1.2, frameDepth = 1.2 }) {
  // Double-hung window: two sash units at different depths.
  // The lower sash (closer to room interior) slides up in front of the upper sash.
  const group = new THREE.Group();
  const fT = frameThickness, fD = frameDepth;
  const sashRail = fT * 1.2;        // sash frame rail/stile thickness
  const sashDepth = fD * 0.5;       // each sash's depth (X)
  const sashGap = sashDepth + 0.15;  // full sash thickness + small air gap between planes
  const frameMat = stdMat({ color: 0xf5f5f0, shininess: 10 });
  const sashMat = stdMat({ color: 0xf0efe8, shininess: 8 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xd4e8f0, transparent: true, opacity: 0.15,
    roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide
  });

  // ── Outer frame (jambs, head, apron) — stationary ──
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(fD, fT, width + fT * 2), frameMat);
  frameTop.position.set(0, height / 2 + fT / 2, 0);
  frameTop.castShadow = true; frameTop.receiveShadow = true;
  group.add(frameTop);
  const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(fD, fT, width + fT * 2), frameMat);
  frameBottom.position.set(0, -height / 2 - 0.5 - fT / 2, 0);
  frameBottom.castShadow = true; frameBottom.receiveShadow = true;
  group.add(frameBottom);
  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(fD, height + 0.5, fT), frameMat);
  frameLeft.position.set(0, -0.25, -width / 2 - fT / 2);
  frameLeft.castShadow = true; frameLeft.receiveShadow = true;
  group.add(frameLeft);
  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(fD, height + 0.5, fT), frameMat);
  frameRight.position.set(0, -0.25, width / 2 + fT / 2);
  frameRight.castShadow = true; frameRight.receiveShadow = true;
  group.add(frameRight);

  // Helper: build a sash (sub-frame + glass as a single group)
  const sashH = height / 2;
  const glassH = sashH - sashRail * 2;
  const glassW = width - sashRail * 2;
  function buildSash() {
    const sash = new THREE.Group();
    // Top rail
    const top = new THREE.Mesh(new THREE.BoxGeometry(sashDepth, sashRail, width), sashMat);
    top.position.set(0, sashH / 2 - sashRail / 2, 0);
    top.castShadow = true; top.receiveShadow = true;
    sash.add(top);
    // Bottom rail
    const bot = new THREE.Mesh(new THREE.BoxGeometry(sashDepth, sashRail, width), sashMat);
    bot.position.set(0, -sashH / 2 + sashRail / 2, 0);
    bot.castShadow = true; bot.receiveShadow = true;
    sash.add(bot);
    // Left stile
    const left = new THREE.Mesh(new THREE.BoxGeometry(sashDepth, sashH - sashRail * 2, sashRail), sashMat);
    left.position.set(0, 0, -width / 2 + sashRail / 2);
    left.castShadow = true; left.receiveShadow = true;
    sash.add(left);
    // Right stile
    const right = new THREE.Mesh(new THREE.BoxGeometry(sashDepth, sashH - sashRail * 2, sashRail), sashMat);
    right.position.set(0, 0, width / 2 - sashRail / 2);
    right.castShadow = true; right.receiveShadow = true;
    sash.add(right);
    // Glass
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.12, glassH, glassW), glassMat);
    glass.renderOrder = 1;
    sash.add(glass);
    return sash;
  }

  // ── Upper sash (fixed, sits further from room interior) ──
  const upperSash = buildSash();
  upperSash.position.set(-sashGap / 2, height / 4, 0);
  group.add(upperSash);

  // ── Lower sash (slides, sits closer to room interior) ──
  const lowerSash = buildSash();
  lowerSash.position.set(sashGap / 2, -height / 4, 0);
  lowerSash._baseY = -height / 4;
  group.add(lowerSash);

  group.userData.windowModel = {
    lowerPane: lowerSash, upperPane: upperSash,
    // Keep refs for tagging — collect all meshes in each sash
    frameTop, frameBottom, frameLeft, frameRight,
    height, width, _slideTarget: undefined
  };
  return group;
}

function tagAll(obj, flags) {
  obj.traverse(o => { for (const k in flags) o[k] = flags[k]; });
}

export function createRoom(scene) {
  const floorY = getFloorY();
  // All standardized door knobs (corner door + hallway doors) — exposed via
  // roomRefs so game-fp.js can generate small landing pads on top of them.
  const doorKnobs = [];
  const { H, W, D, ply, ft, bunFootH } = state;
  const panelW = W + 2 * ft;
  const leftWallX = LEFT_WALL_X;
  const sideWallX = SIDE_WALL_X;
  const oppWallZ = OPP_WALL_Z;
  const wallHeight = WALL_HEIGHT;
  const wallDepth = 127;
  const bedL = BED_L, bedW = BED_W, bedH = BED_H;
  const bedClearance = BED_CLEARANCE, bedSlatsFromFloor = BED_SLATS_FROM_FLOOR;
  const bedX = BED_X, bedZ = BED_Z;
  const tblW = TBL_W, tblD = TBL_D, tblH = TBL_H;
  const tblX = TBL_X, tblZ = TBL_Z;
  const winW = WIN_W, winH = WIN_H;
  const winCenterZ = WIN_CENTER_Z;
  const winCenterY = getWinCenterY();
  const ceilLightX = CEIL_LIGHT_X, ceilLightZ = CEIL_LIGHT_Z;

  // Alias scene.add for _isRoom tagging
  function addRoom(mesh) { mesh._isRoom = true; scene.add(mesh); return mesh; }

  // Floor — fluffy beige carpet (procedural diffuse + normal map, seamlessly tiled)
  const floorGeo = new THREE.PlaneGeometry(200, 200);
  const CARPET_RES = 1024;
  const EDGE_PAD = 12; // strokes near edges get wrapped to tile seamlessly

  // Helper: draw a stroke at (x,y) and any wrapped copies needed so the tile
  // is seamless. Strokes reaching past an edge reappear on the opposite side.
  const drawWrappedStroke = (ctx, x, y, ang, len) => {
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const offsets = [[0, 0]];
    if (x < EDGE_PAD) offsets.push([CARPET_RES, 0]);
    if (x > CARPET_RES - EDGE_PAD) offsets.push([-CARPET_RES, 0]);
    if (y < EDGE_PAD) offsets.push([0, CARPET_RES]);
    if (y > CARPET_RES - EDGE_PAD) offsets.push([0, -CARPET_RES]);
    if (x < EDGE_PAD && y < EDGE_PAD) offsets.push([CARPET_RES, CARPET_RES]);
    if (x > CARPET_RES - EDGE_PAD && y < EDGE_PAD) offsets.push([-CARPET_RES, CARPET_RES]);
    if (x < EDGE_PAD && y > CARPET_RES - EDGE_PAD) offsets.push([CARPET_RES, -CARPET_RES]);
    if (x > CARPET_RES - EDGE_PAD && y > CARPET_RES - EDGE_PAD) offsets.push([-CARPET_RES, -CARPET_RES]);
    for (const [ox, oy] of offsets) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + dx, y + oy + dy);
      ctx.stroke();
    }
  };
  const drawWrappedBlob = (ctx, x, y, r, fill) => {
    const offsets = [[0, 0]];
    if (x < r) offsets.push([CARPET_RES, 0]);
    if (x > CARPET_RES - r) offsets.push([-CARPET_RES, 0]);
    if (y < r) offsets.push([0, CARPET_RES]);
    if (y > CARPET_RES - r) offsets.push([0, -CARPET_RES]);
    for (const [ox, oy] of offsets) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, fill[0]);
      g.addColorStop(1, fill[1]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  };

  // Height canvas drives the normal map so fiber tips that look bright in the
  // diffuse also cast shading bumps.
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = heightCanvas.height = CARPET_RES;
  const hctx = heightCanvas.getContext('2d');
  hctx.fillStyle = '#4a4a4a';
  hctx.fillRect(0, 0, CARPET_RES, CARPET_RES);
  // Low-frequency clumping for soft pile "bunches".
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    const r = 24 + Math.random() * 60;
    const bright = 70 + Math.random() * 35;
    drawWrappedBlob(hctx, x, y, r,
      [`rgba(${bright},${bright},${bright},0.55)`, 'rgba(0,0,0,0)']);
  }
  // Dense short fibers.
  hctx.lineCap = 'round';
  for (let i = 0; i < 150000; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    const ang = Math.random() * Math.PI * 2;
    const len = 2 + Math.random() * 4;
    const tip = 150 + Math.random() * 90;
    hctx.strokeStyle = `rgb(${tip},${tip},${tip})`;
    hctx.lineWidth = 0.7 + Math.random() * 0.9;
    drawWrappedStroke(hctx, x, y, ang, len);
  }

  // Diffuse: light beige with per-fiber hue variation and large-scale blotches
  // to break up the tile signature.
  const carpetCanvas = document.createElement('canvas');
  carpetCanvas.width = carpetCanvas.height = CARPET_RES;
  const cctx = carpetCanvas.getContext('2d');
  cctx.fillStyle = '#cabfa8';
  cctx.fillRect(0, 0, CARPET_RES, CARPET_RES);

  // Large low-frequency color drift — big soft blobs at the scale of the tile
  // itself so each tile reads as slightly different when tiled.
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    const r = 140 + Math.random() * 220;
    const warm = Math.random() < 0.5;
    drawWrappedBlob(cctx, x, y, r, warm
      ? ['rgba(210,195,160,0.22)', 'rgba(0,0,0,0)']
      : ['rgba(160,148,125,0.22)', 'rgba(0,0,0,0)']);
  }
  // Mid-scale tonal variation.
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    const r = 14 + Math.random() * 46;
    const dark = Math.random() < 0.45;
    drawWrappedBlob(cctx, x, y, r, dark
      ? ['rgba(150,138,115,0.26)', 'rgba(0,0,0,0)']
      : ['rgba(230,222,200,0.28)', 'rgba(0,0,0,0)']);
  }
  // Fiber strokes with per-strand hue variation.
  cctx.lineCap = 'round';
  for (let i = 0; i < 170000; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    const ang = Math.random() * Math.PI * 2;
    const len = 2 + Math.random() * 4;
    const base = 180 + Math.random() * 55;
    const warm = Math.random() * 16;
    const r = Math.min(255, base + warm);
    const gCh = Math.min(255, base + warm * 0.6);
    const b = Math.max(0, base - 14);
    cctx.strokeStyle = `rgb(${r | 0},${gCh | 0},${b | 0})`;
    cctx.lineWidth = 0.7 + Math.random() * 0.9;
    drawWrappedStroke(cctx, x, y, ang, len);
  }
  // Shadow specks.
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * CARPET_RES, y = Math.random() * CARPET_RES;
    cctx.fillStyle = 'rgba(110,98,78,0.22)';
    cctx.fillRect(x, y, 1, 1);
  }

  // Build a normal map from the height canvas (Sobel-ish gradient).
  const heightImg = hctx.getImageData(0, 0, CARPET_RES, CARPET_RES).data;
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = CARPET_RES;
  const nctx = normalCanvas.getContext('2d');
  const normalImg = nctx.createImageData(CARPET_RES, CARPET_RES);
  const nData = normalImg.data;
  const sampleH = (x, y) => {
    const xi = ((x % CARPET_RES) + CARPET_RES) % CARPET_RES;
    const yi = ((y % CARPET_RES) + CARPET_RES) % CARPET_RES;
    return heightImg[(yi * CARPET_RES + xi) * 4] / 255;
  };
  const strength = 3.0;
  for (let y = 0; y < CARPET_RES; y++) {
    for (let x = 0; x < CARPET_RES; x++) {
      const hL = sampleH(x - 1, y);
      const hR = sampleH(x + 1, y);
      const hU = sampleH(x, y - 1);
      const hD = sampleH(x, y + 1);
      const dx = (hR - hL) * strength;
      const dy = (hD - hU) * strength;
      const nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * CARPET_RES + x) * 4;
      nData[i] = ((nx / len) * 0.5 + 0.5) * 255;
      nData[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nData[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      nData[i + 3] = 255;
    }
  }
  nctx.putImageData(normalImg, 0, 0);

  const carpetTex = new THREE.CanvasTexture(carpetCanvas);
  carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
  carpetTex.repeat.set(6, 6);
  carpetTex.anisotropy = 16;
  // Rotate the UVs slightly so the tile grid doesn't line up with the room walls.
  carpetTex.center.set(0.5, 0.5);
  carpetTex.rotation = Math.PI / 7;
  if ('colorSpace' in carpetTex) carpetTex.colorSpace = THREE.SRGBColorSpace;

  const carpetNormalTex = new THREE.CanvasTexture(normalCanvas);
  carpetNormalTex.wrapS = carpetNormalTex.wrapT = THREE.RepeatWrapping;
  carpetNormalTex.repeat.set(6, 6);
  carpetNormalTex.anisotropy = 16;
  carpetNormalTex.center.set(0.5, 0.5);
  carpetNormalTex.rotation = Math.PI / 7;

  const floorMat = new THREE.MeshStandardMaterial({
    map: carpetTex,
    normalMap: carpetNormalTex,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 1.0,
    metalness: 0.0,
    color: 0xe8dfc8
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  floor._isRoom = true;
  floor._isFloor = true;
  addRoom(floor);

  // updatePowerCordGeometry — handled by purifier module

  // Ceiling — one continuous flat plane covering BOTH the bedroom and the
  // hallway extrusion. Same trick we use for the hardwood floor: a single
  // mesh with a single material so there's no seam where the two areas
  // meet. Spans X=-100..100 (bedroom X range, which fully contains the
  // hallway's -51..-11) and Z=-100..300 (past the far end of the hallway
  // at Z=289). Walls below terminate at Y=floorY+80; we sit the ceiling
  // 0.05" above that to avoid coplanar z-fighting with every wall top
  // (which was reading as a faint overlapping-textures line, most visibly
  // across the hallway doorway). This is the ceiling equivalent of the
  // hardwood-above-carpet trick.
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe0ddd6, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
  const ceilingGeo = new THREE.PlaneGeometry(200, 400);
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, floorY + 80 + 0.05, 100); // center Z=100 → spans Z=-100..300
  ceiling.castShadow = false; // NEVER let the ceiling cast directional-light shadows — it's a large plane that would shadow the upper portions of every wall and itself, making them permanently dark
  ceiling.receiveShadow = true;
  ceiling._isRoom = true;
  addRoom(ceiling);

  // Helper: simple box with shadow
  function roomBox(w, h, d, color, x, y, z, rx, ry, rz) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh._isRoom = true;
    addRoom(mesh);
    return mesh;
  }

  // Rounded box helper — uses ExtrudeGeometry with a rounded rect profile
  function roomRoundBox(w, h, d, radius, color, x, y, z, rx, ry, rz) {
    const r = Math.min(radius, w / 2, h / 2);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const extrudeSettings = { depth: d, bevelEnabled: false };
    const g = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    g.translate(0, 0, -d / 2); // center along Z
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh._isRoom = true;
    addRoom(mesh);
    return mesh;
  }

  // ─── Zinus Queen Piper Upholstered Platform Bed ───
  // 82.3"L × 60.3"W × 42"H, 6.5" ground clearance, slats at 14" from floor
  // (bedL, bedW, bedH, bedClearance, bedSlatsFromFloor, bedX, bedZ declared in header)

  // Nightstand — 27"H × 24"W × 14"D, black body, dark oak top, 3 drawers, curved front
  // (tblW, tblH, tblD, tblX, tblZ declared in header)
  const tblBlack = 0x1a1a1a;
  const tblOak = 0x5a3f2a;
  const drawers = []; // populated in nightstand block below; used by click/collision/coin systems
  {
    const bodyH = tblH - 1;
    const curveBulge = 1.5; // how far the front curves outward
    const segs = 12; // curve smoothness

    // Helper: create a curved-front box (top-down profile extruded along Y)
    function curvedFrontBox(w, h, d, bulge) {
      const shape = new THREE.Shape();
      // Start at back-left, go clockwise (in pre-flip coords)
      shape.moveTo(-w / 2, -d / 2); // back-left
      shape.lineTo(w / 2, -d / 2);  // back-right
      shape.lineTo(w / 2, d / 2);   // front-right
      // Curved front: bulges in +Z (which becomes the visible front after X flip)
      shape.quadraticCurveTo(0, d / 2 + bulge, -w / 2, d / 2);
      shape.lineTo(-w / 2, -d / 2);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      geo.translate(0, 0, -h / 2);
      geo.rotateX(-Math.PI / 2); // extrude along Y
      return geo;
    }

    // Main body — a solid rectangular block (tblW × bodyH × tblD) with three
    // rectangular holes cut through it, front-to-back, where each drawer slots
    // in. Built by extruding a front-facing silhouette-with-holes along Z.
    // (The dark-oak top cap below keeps the curved silhouette on top.)
    const bodyMat = new THREE.MeshStandardMaterial({ color: tblBlack, roughness: 0.4, metalness: 0.05 });
    const drawerGap = 0.8;
    const drawerH = (bodyH - drawerGap * 4) / 3;
    const drawerW = tblW - 1.5;
    const drawerFrontZ = tblZ - tblD / 2;   // drawer face sits flush with the body front
    const trayD = tblD - 0.5;              // tray runs nearly the full dresser depth
    {
      // Front silhouette: full body rectangle in XY.
      const faceShape = new THREE.Shape();
      faceShape.moveTo(-tblW / 2, -bodyH / 2);
      faceShape.lineTo(tblW / 2, -bodyH / 2);
      faceShape.lineTo(tblW / 2, bodyH / 2);
      faceShape.lineTo(-tblW / 2, bodyH / 2);
      faceShape.lineTo(-tblW / 2, -bodyH / 2);
      // Three rectangular drawer-sized holes, one per drawer row.
      const holeW = drawerW + 0.3;           // slightly wider than drawer face for clearance
      const holeH = drawerH - 0.3;           // slightly shorter so face rests against rails
      for (let d = 0; d < 3; d++) {
        const dyCenter = drawerGap * (d + 1) + drawerH * (d + 0.5) - bodyH / 2; // body-local Y
        const hole = new THREE.Path();
        hole.moveTo(-holeW / 2, dyCenter - holeH / 2);
        hole.lineTo(holeW / 2, dyCenter - holeH / 2);
        hole.lineTo(holeW / 2, dyCenter + holeH / 2);
        hole.lineTo(-holeW / 2, dyCenter + holeH / 2);
        hole.lineTo(-holeW / 2, dyCenter - holeH / 2);
        faceShape.holes.push(hole);
      }
      // Extrude along +Z through the full body depth. Final mesh origin at its
      // geometric center (bodyH/2, tblD/2 in-shape).
      const bodyGeo = new THREE.ExtrudeGeometry(faceShape, { depth: tblD, bevelEnabled: false });
      bodyGeo.translate(0, 0, -tblD / 2);   // center on Z
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(tblX, floorY + bodyH / 2, tblZ);
      body.castShadow = true; body.receiveShadow = true; body._isRoom = true;
      addRoom(body);
    }

    // Dark oak top — also curved front, with overhang
    const topOverhang = 1;
    const topW = tblW + topOverhang * 2;
    const topD = tblD + topOverhang;
    const topThick = 1;
    const topGeo = curvedFrontBox(topW, topThick, topD, curveBulge + 0.5);
    const topMat = new THREE.MeshStandardMaterial({ color: tblOak, roughness: 0.6, metalness: 0.05 });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.set(tblX, floorY + tblH - topThick / 2, tblZ - topOverhang / 2);
    topMesh.castShadow = true; topMesh._isRoom = true; addRoom(topMesh);

    // 3 drawers — curved front face + hollow tray (left/right/back walls + floor).
    // Each drawer is a THREE.Group positioned at (tblX, dy, drawerFrontZ). The
    // group slides along local Z (toward -Z = out) when opened. Marked _isRoom
    // so it mirrors with the rest of the room; children are in local coords.
    // (drawerGap, drawerH, drawerW, drawerFrontZ, trayD declared above for the
    // body-cavity math and reused here.)
    const drawerFaceMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const drawerTrayMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85, metalness: 0.02 });
    const trayWall = 0.5;              // thickness of tray walls
    const drawerSlideMax = 8;          // how far the drawer pulls out
    for (let d = 0; d < 3; d++) {
      const dy = floorY + drawerGap * (d + 1) + drawerH * (d + 0.5);
      const grp = new THREE.Group();
      grp.position.set(tblX, dy, drawerFrontZ);
      grp._drawerBaseZ = drawerFrontZ;
      grp._isRoom = true;
      grp._isDrawer = true;
      grp._drawerIdx = d;
      grp._drawerOpen = false;
      grp._drawerSlide = 0;              // current slide amount (0..slideMax)
      grp._drawerSlideMax = drawerSlideMax;
      grp._drawerW = drawerW;
      grp._drawerH = drawerH;
      grp._drawerTrayD = trayD;
      grp._drawerTrayWall = trayWall;
      // Curved front face — same as before, centered at group origin.
      const faceGeo = curvedFrontBox(drawerW, drawerH - 0.5, 0.8, curveBulge * 0.8);
      const face = new THREE.Mesh(faceGeo, drawerFaceMat);
      face._isDrawer = true; face._drawerIdx = d;
      grp.add(face);
      // Tray: open-top box extending behind the face in +Z (into the body).
      // Tray interior runs from z=0.4 (behind face) to z=trayD.
      const trayBottom = new THREE.Mesh(
        new THREE.BoxGeometry(drawerW - trayWall * 2, trayWall, trayD),
        drawerTrayMat
      );
      trayBottom.position.set(0, -drawerH / 2 + trayWall / 2, trayD / 2 + 0.4);
      trayBottom._isDrawer = true; trayBottom._drawerIdx = d;
      grp.add(trayBottom);
      const trayLeft = new THREE.Mesh(
        new THREE.BoxGeometry(trayWall, drawerH - 0.5, trayD),
        drawerTrayMat
      );
      trayLeft.position.set(-drawerW / 2 + trayWall / 2, 0, trayD / 2 + 0.4);
      trayLeft._isDrawer = true; trayLeft._drawerIdx = d;
      grp.add(trayLeft);
      const trayRight = trayLeft.clone();
      trayRight.position.x = drawerW / 2 - trayWall / 2;
      grp.add(trayRight);
      const trayBack = new THREE.Mesh(
        new THREE.BoxGeometry(drawerW - trayWall * 2, drawerH - 0.5, trayWall),
        drawerTrayMat
      );
      trayBack.position.set(0, 0, trayD + 0.4 - trayWall / 2);
      trayBack._isDrawer = true; trayBack._drawerIdx = d;
      grp.add(trayBack);
      // 2 round handles per drawer — live on the face, so they travel with it.
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.6 });
      for (let h of [-1, 1]) {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), handleMat);
        handle.position.set(h * 4, 0, -0.8);
        handle._isDrawer = true; handle._drawerIdx = d;
        grp.add(handle);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 6), handleMat);
        stem.rotation.x = Math.PI / 2;
        stem.position.set(h * 4, 0, -0.5);
        stem._isDrawer = true; stem._drawerIdx = d;
        grp.add(stem);
      }
      addRoom(grp);
      drawers.push(grp);
    }
  }

  // Coffee mug on nightstand — ceramic with handle
  {
    const mugX = tblX - 3, mugZ = tblZ - 5, mugY = floorY + tblH;
    const mugR = 1.4, mugH = 3.5, mugThick = 0.15;
    const mugMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.3, metalness: 0.05 });
    const mugGroup = new THREE.Group();
    // Outer cylinder
    const mugOuter = new THREE.Mesh(new THREE.CylinderGeometry(mugR, mugR * 0.95, mugH, 16), mugMat);
    mugOuter.position.set(0, mugH / 2, 0);
    mugGroup.add(mugOuter);
    // Inner dark cavity (coffee)
    const coffeeMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.8 });
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(mugR - mugThick, 16), coffeeMat);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(0, mugH - 0.1, 0);
    mugGroup.add(coffee);
    // Handle — torus arc attached to mug side
    const handleGeo = new THREE.TorusGeometry(0.65, 0.15, 8, 12, Math.PI);
    const handle = new THREE.Mesh(handleGeo, mugMat);
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = Math.PI / 2;
    handle.position.set(0, mugH * 0.5, mugR);
    mugGroup.add(handle);
    // Position and rotate the whole mug
    mugGroup.position.set(mugX, mugY, mugZ);
    mugGroup.rotation.y = 30 * Math.PI / 180; // angled so handle faces toward player
    // Only mark the GROUP as room — not the children. Marking children caused
    // applyRoomDelta to double-shift them (once for group, once per child) each
    // time the room was nudged, which is why the mug drifted outside the room.
    mugGroup._isRoom = true;
    addRoom(mugGroup);
  }

  // Qingping Air Quality Monitor — white wedge with tilted screen
  {
    const aqX = tblX - 8, aqZ = tblZ + 2, aqY = floorY + tblH;
    const aqW = 3.5, aqH = 4.0, aqD = 2.8; // taller to include chin
    const chinH = 0.8; // chin height below screen
    const tilt = 15 * Math.PI / 180;
    const wedgeMat = new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 0.35, metalness: 0.05 });

    // Screen panel — rounded edges like a tablet
    const panelR = 0.4; // corner radius
    const panelShape = new THREE.Shape();
    panelShape.moveTo(-aqW / 2 + panelR, -aqH / 2);
    panelShape.lineTo(aqW / 2 - panelR, -aqH / 2);
    panelShape.quadraticCurveTo(aqW / 2, -aqH / 2, aqW / 2, -aqH / 2 + panelR);
    panelShape.lineTo(aqW / 2, aqH / 2 - panelR);
    panelShape.quadraticCurveTo(aqW / 2, aqH / 2, aqW / 2 - panelR, aqH / 2);
    panelShape.lineTo(-aqW / 2 + panelR, aqH / 2);
    panelShape.quadraticCurveTo(-aqW / 2, aqH / 2, -aqW / 2, aqH / 2 - panelR);
    panelShape.lineTo(-aqW / 2, -aqH / 2 + panelR);
    panelShape.quadraticCurveTo(-aqW / 2, -aqH / 2, -aqW / 2 + panelR, -aqH / 2);
    const panelGeo = new THREE.ExtrudeGeometry(panelShape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3 });
    panelGeo.translate(0, 0, -0.15);
    const screenPanel = new THREE.Mesh(panelGeo, wedgeMat);
    screenPanel.rotation.x = tilt;
    screenPanel.position.set(aqX, aqY + aqH / 2 + 0.3, aqZ - 0.3);
    screenPanel._isRoom = true; addRoom(screenPanel);

    // Base/stand — thicker
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(aqW, 1.2, aqD * 0.8), wedgeMat);
    baseMesh.position.set(aqX, aqY + 0.6, aqZ + 0.3);
    baseMesh._isRoom = true; addRoom(baseMesh);

    // Chin slit — horizontal dark line in the chin area
    const slitMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
    const slit = new THREE.Mesh(new THREE.BoxGeometry(aqW * 0.7, 0.08, 0.05), slitMat);
    slit.rotation.x = tilt;
    // Position at bottom of panel face, in the chin area
    slit.position.set(aqX, aqY + chinH * 0.5 + 0.45, aqZ - 0.3 - 0.8);
    slit._isRoom = true; addRoom(slit);

    // Screen content — canvas texture with AQI data
    const screenH = aqH - chinH - 0.4; // screen area = panel minus chin minus bezel
    const aqiCvs = document.createElement('canvas');
    aqiCvs.width = 512; aqiCvs.height = 512;
    const actx = aqiCvs.getContext('2d');
    actx.fillStyle = '#0a0a0a';
    actx.fillRect(0, 0, 512, 512);

    // Header — centered
    actx.fillStyle = '#cccccc';
    actx.font = 'bold 52px -apple-system,sans-serif';
    actx.textAlign = 'center'; actx.textBaseline = 'middle';
    actx.fillText('AIR QUALITY', 256, 120);
    actx.fillText('MONITOR', 256, 180);

    // Divider line
    actx.strokeStyle = '#333333';
    actx.lineWidth = 1;
    actx.beginPath(); actx.moveTo(30, 250); actx.lineTo(482, 250); actx.stroke();

    // Bottom grid — 2×3 layout with larger text
    const gx = [128, 384];
    const gy = [295, 370, 445];
    const gridData = [
      ['36', 'Noise dB', '#00cc44'], ['187', 'PM 10 µg/m³', '#ffaa00'],
      ['631', 'CO₂ ppm', '#ffaa00'], ['27', 'eTVOC index', '#00cc44'],
      ['25.5', 'Temp °C', '#00cc44'], ['55.5', 'RH %', '#00cc44'],
    ];
    for (let i = 0; i < gridData.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const x = gx[col], y = gy[row];
      actx.fillStyle = gridData[i][2];
      actx.font = 'bold 42px -apple-system,sans-serif';
      actx.textAlign = 'center';
      actx.fillText(gridData[i][0], x, y - 6);
      actx.fillStyle = '#555555';
      actx.font = '18px -apple-system,sans-serif';
      actx.fillText(gridData[i][1], x, y + 22);
    }

    const aqiTex = new THREE.CanvasTexture(aqiCvs);
    const screenW2 = aqW * 0.85;
    const scrMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(screenW2, screenH),
      new THREE.MeshBasicMaterial({ map: aqiTex })
    );
    scrMesh.rotation.x = tilt;
    scrMesh.rotation.y = Math.PI;
    // Screen sits above the chin, centered in the upper portion of the panel
    scrMesh.position.set(aqX, aqY + chinH + screenH / 2 + 0.4, aqZ - 0.3 - 0.25);
    scrMesh._isRoom = true; addRoom(scrMesh);
  }

  // Lamp on nightstand — near the corner closest to the door extrusion
  let lampLight, lampShade, lampOn = true;
  let lampBulb = null;
  let ceilLightOn = true; // ceiling fixture togglable by clicking
  let ceilGlow = null;
  {
    const lampX = tblX + tblW / 2 - 6; // 6" from the extrusion-side edge
    const lampZ = tblZ + tblD / 2 - 6; // 6" from the back edge (avoid wall clip)
    const lampBaseY = floorY + tblH;
    // Base — dark metal disc (larger)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 0.8, 16), baseMat);
    base.position.set(lampX, lampBaseY + 0.4, lampZ);
    base._isRoom = true; base._isLamp = true; addRoom(base);
    // Stem — thin metal rod (taller)
    const stemH = 16;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, stemH, 8), baseMat);
    stem.position.set(lampX, lampBaseY + 0.8 + stemH / 2, lampZ);
    stem._isRoom = true; stem._isLamp = true; addRoom(stem);
    // Shade — fabric cylinder, slightly tapered (larger)
    const shadeR1 = 5, shadeR2 = 6.5, shadeH = 10;
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xd8d0c0, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85,
      emissive: 0xffeedd, emissiveIntensity: 0.75
    });
    lampShade = new THREE.Mesh(new THREE.CylinderGeometry(shadeR1, shadeR2, shadeH, 24, 1, true), shadeMat);
    lampShade.position.set(lampX, lampBaseY + 0.8 + stemH + shadeH / 2 - 1, lampZ);
    lampShade._isRoom = true; lampShade._isLamp = true; addRoom(lampShade);
    // Top ring with a center opening so the player can drop into the shade.
    const topCap = new THREE.Mesh(new THREE.RingGeometry(4.2, shadeR1, 24), shadeMat);
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.set(lampX, lampBaseY + 0.8 + stemH + shadeH - 1, lampZ);
    topCap._isRoom = true; topCap._isLamp = true; addRoom(topCap);
    // Warm glow light — strong enough to visibly illuminate surroundings
    lampLight = new THREE.PointLight(0xffddaa, 400, 110);
    lampLight.position.set(lampX, lampBaseY + 0.8 + stemH + shadeH / 2 - 1, lampZ);
    lampLight.castShadow = false;
    lampLight._isRoom = true; addRoom(lampLight);
    // Bulb visible inside shade
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffeedd, emissiveIntensity: 1.9, roughness: 0.3 });
    lampBulb = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), bulbMat);
    lampBulb.position.set(lampX, lampBaseY + 0.8 + stemH + 1, lampZ);
    lampBulb._isRoom = true; lampBulb._isLamp = true; addRoom(lampBulb);
  }

  // Wall section — back wall with door extrusion bumping INTO the room (-Z direction)
  const recessDepth = 20; // ~1.5 feet into room
  const extrusionW = 40; // door (32") + 4" each side
  const extRight = 51; // flush with right/side wall
  const extLeft = extRight - extrusionW; // 11
  const extCenterX = extLeft + extrusionW / 2; // 31
  const recessZ = 49 - recessDepth; // front face of extrusion at Z=19

  // Front face of extrusion — has the door opening. doorH=68 leaves a ~12"
  // header between the top of the door and the 80" ceiling (real standard
  // doors are 80" tall under a 96"+ ceiling; scaled to fit this 80" room).
  const doorW = 32, doorH = 68;
  const doorCenterX = extCenterX;
  const doorLeft = doorCenterX - doorW / 2;
  const doorRight = doorCenterX + doorW / 2;

  // Back-wall opening spans the full hallway width so you don't see a thin
  // sliver of back wall through the recess side gaps. The right edge of the
  // opening is extended 1" past the back wall's outer edge (X=51 pre-mirror)
  // to eliminate the degenerate extrude-side-face where the hole edge and
  // the shape edge coincide — that thin strip was visible through the guest
  // doorway in the right wall.
  const backOpenW = extrusionW;
  const backOpenLeft = extCenterX - backOpenW / 2;
  const backOpenRight = extCenterX + backOpenW / 2;

  // Back wall — full width with a doorway hole so the door opens into the
  // hallway beyond. Built as an ExtrudeGeometry (shape in X-Y plane, extruded
  // along +Z) mirroring the closet-wall-with-hole approach.
  // NOTE: room meshes are X-mirrored via position.x, but ExtrudeGeometry bakes
  // shape vertices into the geometry — position flipping doesn't flip them.
  // So we negate every shape X coord up front: the geometry is authored in
  // *post-mirror* world X, and we set position.x=0 so the mirror pass (which
  // just flips 0 → 0) leaves it where we want.
  const backWallFullW = 81 + 51;
  const wallMeshL = (() => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d4ce, roughness: 0.7, metalness: 0.05 });
    const shape = new THREE.Shape();
    // Post-mirror world X range. The hallway opening spans X=-51..-11
    // (the full right edge of the back wall to the hallway left wall).
    // Since there's zero solid wall between the outer edge and the hole
    // on that side, we simply start the shape at the hallway's inner
    // edge (-backOpenLeft = -11) — no hole needed. This eliminates the
    // degenerate extrude-side-face at X=-51 that was visible as a thin
    // strip through the guest doorway in the right wall.
    const xMin = -backOpenLeft, xMax = 81;
    const yMin = 0, yMax = 80;
    shape.moveTo(xMin, yMin);
    shape.lineTo(xMax, yMin);
    shape.lineTo(xMax, yMax);
    shape.lineTo(xMin, yMax);
    shape.lineTo(xMin, yMin);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, floorY, 48.75); // front face at Z=48.75, back at 49.25
    mesh.castShadow = true; mesh.receiveShadow = true; mesh._isRoom = true;
    addRoom(mesh);
    return mesh;
  })();

  // Extrusion side walls (going from back wall into room)
  const returnWallL = roomBox(0.5, 80, recessDepth, 0xd8d4ce, extLeft, floorY + 40, 49 - recessDepth / 2, 0, 0, 0);
  // Right side wall omitted — flush with side wall, would clip
  // (No "top of extrusion" box — the unified bedroom+hallway ceiling plane
  // already covers this span. A separate box here in wall-color would read
  // as a visible seam across the doorway ceiling.)

  // Recess front face — solid wall spanning the extrusion width (40"), with a
  // 32" × 68" door-shaped hole. Built as an ExtrudeGeometry like the back wall
  // so the hole geometry is real (header above door, 4" jamb on each side).
  (() => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d4ce, roughness: 0.7, metalness: 0.05 });
    const shape = new THREE.Shape();
    // Post-mirror world X: extrusion spans -extRight..-extLeft = -51..-11.
    const xMin = -extRight, xMax = -extLeft;
    const yMin = 0, yMax = 80;
    shape.moveTo(xMin, yMin);
    shape.lineTo(xMax, yMin);
    shape.lineTo(xMax, yMax);
    shape.lineTo(xMin, yMax);
    shape.lineTo(xMin, yMin);
    const hole = new THREE.Path();
    const hxMin = -doorRight, hxMax = -doorLeft;
    hole.moveTo(hxMin, yMin);
    hole.lineTo(hxMax, yMin);
    hole.lineTo(hxMax, doorH);
    hole.lineTo(hxMin, doorH);
    hole.lineTo(hxMin, yMin);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, mat);
    // Recess front face sits at Z=recessZ=19. 0.5" thick, centered on that.
    mesh.position.set(0, floorY, recessZ - 0.25);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh._isRoom = true;
    addRoom(mesh);
  })();

  // Back-reference variables kept so the fading array / collision code still
  // compiles (no separate partial-wall meshes to track anymore).
  const recessWallL = null;
  const recessWallR = null;

  // Baseboards on the recess front face — split around the door opening.
  const baseboardRecessL = roomBox(doorLeft - extLeft, 3, 0.6, 0xc0bbb4,
    (extLeft + doorLeft) / 2, floorY + 1.5, recessZ + 0.5, 0, 0, 0);
  const baseboardRecessR = roomBox(extRight - doorRight, 3, 0.6, 0xc0bbb4,
    (doorRight + extRight) / 2, floorY + 1.5, recessZ + 0.5, 0, 0, 0);

  // No header above the doorway — the back-wall hole now runs floor to
  // ceiling so the opening reads as one continuous space with the hallway.

  // Back-wall baseboards — split around the 40" back opening.
  // Only the left segment exists; the right segment has zero width because the
  // opening reaches the right wall edge, so we skip it to avoid a degenerate
  // box that would be visible through the guest doorway.
  const bbLeftW = (backOpenLeft) - (-15 - backWallFullW / 2);
  const baseboardMeshL = roomBox(bbLeftW, 3, 0.6, 0xc0bbb4,
    (-15 - backWallFullW / 2 + backOpenLeft) / 2, floorY + 1.5, 48.5, 0, 0, 0);
  const baseboardMeshR = null;
  const baseboardRetL = roomBox(0.6, 3, recessDepth, 0xc0bbb4, extLeft + 0.5, floorY + 1.5, 49 - recessDepth / 2, 0, 0, 0);

  // ─── Door ───
  const doorThick = 1.5, doorFrameW = 2.5, doorFrameD = recessDepth > 4 ? 4 : recessDepth;
  const doorColor = 0xf0ebe4; // warm off-white painted door
  const doorFrameColor = 0xf5f5f0;

  // Door panel — hinged so it can swing open from the handle click. Uses the
  // shared `buildDoorLeaf` asset so every door in the scene matches.
  // Hinge is on the pre-mirror +X edge of the doorway (post-mirror: the
  // closet-side edge, i.e. the side FURTHER from the nightstand). Panel
  // extends from the pivot in pre-mirror -X so after the _isRoom X-mirror
  // pass it extends in +X from the pivot toward the nightstand. With that
  // geometry, a positive rotation.y swings the free edge toward -Z → the
  // door opens INTO the room.
  const doorPanelZ = recessZ - doorThick / 2;
  const doorPanelW = doorW - 1;
  const doorPanelH = doorH - 0.5;
  const cornerDoorPivot = new THREE.Group();
  cornerDoorPivot.position.set(doorCenterX + doorPanelW / 2, floorY + doorH / 2, doorPanelZ);
  cornerDoorPivot._isRoom = true;
  addRoom(cornerDoorPivot);

  const doorPanel = buildDoorLeaf({
    width: doorPanelW, height: doorPanelH, thickness: doorThick,
    color: doorColor
  });
  doorPanel.position.set(-doorPanelW / 2, 0, 0);
  tagAll(doorPanel, { _isRoom: true, _isCornerDoor: true });
  // Slab is the canonical center mesh used by game-fp.js for OBB collision.
  doorPanel.userData.doorLeaf.slab.castShadow = true;
  doorPanel.userData.doorLeaf.slab.receiveShadow = true;
  cornerDoorPivot.add(doorPanel);

  // Knobs on both faces (front = into room at -Z, back = into hallway at +Z).
  // Knob Y sits on the door's lock rail (between the tall middle panels and
  // the short bottom panels).
  const knobY = doorPanel.userData.doorLeaf.lockRailY;
  // Knob sits near the free edge. Pre-mirror X is negative so the mirror
  // pass flips it to match the panel's post-mirror +X extension.
  const knobX = -(doorPanelW / 2 + doorW * 0.35);
  const knobFront = buildDoorKnob();
  knobFront.position.set(knobX, knobY, -doorThick / 2);
  tagAll(knobFront, { _isRoom: true, _isCornerDoorHandle: true });
  knobFront.rotation.y = Math.PI; // point -Z
  cornerDoorPivot.add(knobFront);
  const knobBack = buildDoorKnob();
  knobBack.position.set(knobX, knobY, doorThick / 2);
  tagAll(knobBack, { _isRoom: true, _isCornerDoorHandle: true });
  cornerDoorPivot.add(knobBack);
  // Track standardized knobs so game-fp can give them landing collision.
  doorKnobs.push(knobFront, knobBack);

  // Door frame (trim around opening — spans from recessed wall into room)
  const frameZ = recessZ - doorFrameD / 2;
  const doorFrame = buildDoorFrame({
    width: doorW, height: doorH, depth: doorFrameD,
    frameW: doorFrameW, color: doorFrameColor
  });
  doorFrame.position.set(doorCenterX, floorY + doorH / 2, frameZ);
  tagAll(doorFrame, { _isRoom: true });
  addRoom(doorFrame);

  // Corner-door physics:
  //   _cornerDoorAngle  — current rotation (rad), source of truth
  //   _cornerDoorOmega  — angular velocity (rad/frame), driven by player pushes
  //   _cornerDoorAnimTarget — non-null when click toggle is animating to a
  //                           fixed angle; physics push cancels it.
  // Push model is torque-based: the player's push-out force (from collision
  // resolution) is crossed with the lever arm from pivot to contact point.
  // This is direction-correct regardless of which face the player presses
  // and at any door angle — no swing-direction state needed.
  let _cornerDoorAngle = 0;
  let _cornerDoorOmega = 0;
  let _cornerDoorAnimTarget = null;
  let _cornerDoorAnim = 0;
  const _cornerDoorOpenAngle = 72 * Math.PI / 180;
  const _cornerDoorMaxAngle = _cornerDoorOpenAngle * 1.05;
  function _stepCornerDoor() {
    if (_cornerDoorAnimTarget !== null) {
      const t = _cornerDoorAnimTarget;
      _cornerDoorAngle += (t - _cornerDoorAngle) * 0.22;
      if (Math.abs(t - _cornerDoorAngle) < 0.001) {
        _cornerDoorAngle = t;
        _cornerDoorAnimTarget = null;
        _cornerDoorOmega = 0;
      }
    } else if (Math.abs(_cornerDoorOmega) > 1e-4) {
      _cornerDoorAngle += _cornerDoorOmega;
      _cornerDoorOmega *= 0.93;
    }
    if (_cornerDoorAngle > _cornerDoorMaxAngle) {
      _cornerDoorAngle = _cornerDoorMaxAngle;
      if (_cornerDoorOmega > 0) _cornerDoorOmega = 0;
    } else if (_cornerDoorAngle < -_cornerDoorMaxAngle) {
      _cornerDoorAngle = -_cornerDoorMaxAngle;
      if (_cornerDoorOmega < 0) _cornerDoorOmega = 0;
    }
    cornerDoorPivot.rotation.y = _cornerDoorAngle;
    const animating = (_cornerDoorAnimTarget !== null) || (Math.abs(_cornerDoorOmega) > 1e-4);
    if (animating) {
      _cornerDoorAnim = requestAnimationFrame(_stepCornerDoor);
    } else {
      _cornerDoorAnim = 0;
    }
  }
  function _kickCornerDoorAnim() {
    if (!_cornerDoorAnim) _cornerDoorAnim = requestAnimationFrame(_stepCornerDoor);
  }
  function toggleCornerDoor(forceOpen, swingSign) {
    const isOpen = Math.abs(_cornerDoorAngle) > 0.05;
    const open = (typeof forceOpen === 'boolean') ? forceOpen : !isOpen;
    if (open) {
      const sign = (swingSign === 1 || swingSign === -1)
        ? swingSign
        : (_cornerDoorAngle >= 0 ? 1 : -1);
      _cornerDoorAnimTarget = sign * _cornerDoorOpenAngle;
    } else {
      _cornerDoorAnimTarget = 0;
    }
    _kickCornerDoorAnim();
    return open;
  }
  // Torque-based push: caller supplies contact point (player world XZ) and
  // the push-out force vector applied to the player. Newton's third law
  // gives equal/opposite force on the door; cross with lever from pivot
  // gives the Y-axis torque that drives angular velocity.
  function applyPushCornerDoor(contactX, contactZ, pushOutX, pushOutZ) {
    const fmagSq = pushOutX * pushOutX + pushOutZ * pushOutZ;
    if (!(fmagSq > 1e-8)) return;
    _cornerDoorAnimTarget = null;
    cornerDoorPivot.updateWorldMatrix(true, false);
    const px = cornerDoorPivot.matrixWorld.elements[12];
    const pz = cornerDoorPivot.matrixWorld.elements[14];
    const leverX = contactX - px;
    const leverZ = contactZ - pz;
    // Force on door = -pushOut (collision pushed player +pushOut).
    const fx = -pushOutX, fz = -pushOutZ;
    // Torque about +Y: τ_y = lever_z * f_x - lever_x * f_z
    const torque = leverZ * fx - leverX * fz;
    const t = Math.max(-25, Math.min(25, torque));
    // Pure angular-impulse model — no instantaneous angle kick (was causing
    // visible snap on hard contacts). Clamp peak omega so successive
    // contact frames while overlapping can't accumulate into a spike.
    _cornerDoorOmega += t * 0.018;
    const MAX_OMEGA = 0.14; // rad/frame ≈ 8°/frame
    if (_cornerDoorOmega > MAX_OMEGA) _cornerDoorOmega = MAX_OMEGA;
    else if (_cornerDoorOmega < -MAX_OMEGA) _cornerDoorOmega = -MAX_OMEGA;
    _kickCornerDoorAnim();
  }

  // Collect all back wall + recess meshes for fading
  const backWallParts = [wallMeshL, returnWallL,
    baseboardMeshL, baseboardRetL].filter(Boolean);
  if (recessWallL) backWallParts.push(recessWallL);
  if (recessWallR) backWallParts.push(recessWallR);
  if (baseboardRecessL) backWallParts.push(baseboardRecessL);
  if (baseboardRecessR) backWallParts.push(baseboardRecessR);

  // ─── Hallway beyond the bedroom door ──────────────────────────────
  // 20 ft long hallway extruded out through the back wall, aligned to the
  // same X range as the door extrusion (extLeft..extRight) so the doorway
  // leads straight into it. Two closed decorative doors sit ~6 ft in on
  // opposite side walls.
  const _hallZStart = 49;
  const _hallLen = 240;                 // 20 ft
  const _hallZEnd = _hallZStart + _hallLen;  // 289
  const _hallCenterZ = (_hallZStart + _hallZEnd) / 2; // 169
  const _hallXLeft = extLeft;           // 11 (pre-mirror; -11 world)
  const _hallXRight = extRight;         // 51 (pre-mirror; -51 world)
  const _hallCenterX = extCenterX;      // 31
  const _hallWidth = extrusionW;        // 40
  const _hallHeight = 80;               // match wallHeight
  const _hallWallColor = 0xd8d4ce;
  const _hallCeilColor = 0xe0ddd6;
  const _hallDoorCenterZ = _hallZStart + 72; // 6 ft into the hallway
  const _hallDoorW = 32;
  const _hallDoorH = 68;
  const _hallBbColor = 0xc0bbb4;

  // ── Hardwood plank material factory — reused for hallway + guest room ──
  // Builds a single non-repeating canvas texture that covers hwW × hwL
  // inches of floor (no tiling, so plank grain never repeats across the
  // space). Returns a MeshStandardMaterial ready to apply to a plane.
  function _makeHardwoodMaterial(hwW, hwL) {
    const PLANK_W_IN = 5;
    const N_PLANKS = Math.max(1, Math.round(hwW / PLANK_W_IN));
    const PX_PER_IN = 10;
    const HW_RES_W = N_PLANKS * PLANK_W_IN * PX_PER_IN;
    const HW_RES_H = Math.max(1, Math.round(hwL * PX_PER_IN));
    const cvs = document.createElement('canvas');
    cvs.width = HW_RES_W; cvs.height = HW_RES_H;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(0, 0, HW_RES_W, HW_RES_H);
    const woodTone = (l, warm) => {
      const base = 150 + l * 70;
      const r = Math.max(0, Math.min(255, base + 28 + warm * 20));
      const g = Math.max(0, Math.min(255, base * 0.84 + 8 + warm * 10));
      const b = Math.max(0, Math.min(255, base * 0.58 - 4 - warm * 8));
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    };
    const plankPxW = HW_RES_W / N_PLANKS;
    for (let p = 0; p < N_PLANKS; p++) {
      const px0 = p * plankPxW;
      const joints = [0];
      let y = Math.random() * 40 * PX_PER_IN;
      while (y < HW_RES_H) {
        joints.push(y);
        const lenIn = (Math.random() < 0.35)
          ? (28 + Math.random() * 14)
          : (48 + Math.random() * 36);
        y += lenIn * PX_PER_IN;
      }
      joints.push(HW_RES_H);
      for (let j = 0; j < joints.length - 1; j++) {
        const y0 = joints[j], y1 = joints[j + 1];
        const plankH = y1 - y0;
        const lBias = 0.55 + Math.random() * 0.25;
        const warm = (Math.random() - 0.5) * 1.2;
        const grad = ctx.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, woodTone(lBias + (Math.random() - 0.5) * 0.06, warm));
        grad.addColorStop(0.5, woodTone(lBias + (Math.random() - 0.5) * 0.09, warm + (Math.random() - 0.5) * 0.3));
        grad.addColorStop(1, woodTone(lBias + (Math.random() - 0.5) * 0.06, warm));
        ctx.fillStyle = grad;
        ctx.fillRect(px0 + 0.8, y0 + 0.8, plankPxW - 1.6, plankH - 1.6);
        const streakCount = 28 + (plankH * 0.02 | 0);
        for (let i = 0; i < streakCount; i++) {
          const sx = px0 + 1 + Math.random() * (plankPxW - 2);
          const sy = y0 + Math.random() * plankH;
          const slen = plankH * (0.15 + Math.random() * 0.7);
          const shade = 90 + Math.random() * 70;
          const a = 0.05 + Math.random() * 0.18;
          ctx.strokeStyle = `rgba(${shade},${(shade * 0.7) | 0},${(shade * 0.45) | 0},${a})`;
          ctx.lineWidth = 0.4 + Math.random() * 1.3;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (Math.random() - 0.5) * 3, Math.min(y1 - 0.5, sy + slen));
          ctx.stroke();
        }
        if (Math.random() < 0.55) {
          const sx = px0 + 2 + Math.random() * (plankPxW - 4);
          const sy = y0 + Math.random() * plankH * 0.7;
          ctx.strokeStyle = `rgba(255,230,190,${0.05 + Math.random() * 0.08})`;
          ctx.lineWidth = 1 + Math.random() * 2;
          ctx.beginPath(); ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (Math.random() - 0.5) * 2, Math.min(y1 - 0.5, sy + plankH * (0.3 + Math.random() * 0.5)));
          ctx.stroke();
        }
        const knotChance = plankH / (PX_PER_IN * 120);
        if (Math.random() < knotChance) {
          const kx = px0 + 3 + Math.random() * (plankPxW - 6);
          const ky = y0 + 6 + Math.random() * (plankH - 12);
          const kr = 2.5 + Math.random() * 5;
          const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
          kg.addColorStop(0, 'rgba(40,20,8,0.85)');
          kg.addColorStop(0.6, 'rgba(70,40,18,0.55)');
          kg.addColorStop(1, 'rgba(80,45,20,0)');
          ctx.fillStyle = kg;
          ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    const noise = ctx.getImageData(0, 0, HW_RES_W, HW_RES_H);
    const nd = noise.data;
    for (let i = 0; i < nd.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      nd[i] = Math.max(0, Math.min(255, nd[i] + n));
      nd[i + 1] = Math.max(0, Math.min(255, nd[i + 1] + n * 0.7));
      nd[i + 2] = Math.max(0, Math.min(255, nd[i + 2] + n * 0.5));
    }
    ctx.putImageData(noise, 0, 0);
    const hwTex = new THREE.CanvasTexture(cvs);
    hwTex.wrapS = hwTex.wrapT = THREE.ClampToEdgeWrapping;
    hwTex.anisotropy = 16;
    if ('colorSpace' in hwTex) hwTex.colorSpace = THREE.SRGBColorSpace;
    hwTex.repeat.set(1, 1);
    return new THREE.MeshStandardMaterial({ map: hwTex, roughness: 0.55, metalness: 0.05 });
  }

  // Hardwood plank floor — 5" wide planks running along the hallway length
  // (+Z). Starts inside the bedroom doorway opening (at the door panel) so
  // the hardwood is visible the instant the door swings open, and continues
  // through the door recess and all the way to the end of the hallway. Sits
  // 1/4" above the main carpet floor — a realistic hardwood-over-carpet
  // step that reads as a proper threshold instead of a paper-thin decal.
  // The guest room floor below uses the same Y so the two planes line up
  // through the guest door opening.
  const _hwLiftY = 0.01;
  const _hwStartZ = recessZ + 0.25;
  {
    const hwW = 40;
    const hwL = 289 - _hwStartZ; // from door panel through end of hallway
    const hwMat = _makeHardwoodMaterial(hwW, hwL);
    const hwCx = 31; // extCenterX (pre-mirror X) — between the recess walls
    const hwCz = _hwStartZ + hwL / 2;
    const hw = new THREE.Mesh(new THREE.PlaneGeometry(hwW, hwL), hwMat);
    hw.rotation.x = -Math.PI / 2;
    hw.position.set(hwCx, floorY + _hwLiftY, hwCz);
    hw.receiveShadow = true;
    hw._isRoom = true; hw._isFloor = true; hw._isHallway = true;
    addRoom(hw);
  }

  // Wood threshold / saddle at the carpet↔hardwood transition — sits directly
  // under where the door panel closes so you see a warm stained strip framing
  // the opening. Width matches the door panel.
  {
    const thrW = doorW - 0.5;
    const thrD = 2.5;
    const thrH = 0.4;
    const thr = roomBox(thrW, thrH, thrD, 0x6b4226,
      doorCenterX, floorY + thrH / 2, _hwStartZ, 0, 0, 0);
    thr._isHallway = true;
  }

  // (Hallway ceiling is not a separate mesh — the bedroom's ceiling plane
  // extends all the way through Z=300 so bedroom + hallway share one
  // continuous surface with no seam. See `ceiling` above.)

  // Hallway side walls — the -X side is a continuous box with a decorative
  // (non-functional) door for visual symmetry. The +X side has a real 32" × 68"
  // doorway cut into it at Z=_guestDoorCenterZ so the player can walk into the
  // guest room (office) beyond.
  const hallWallMat = new THREE.MeshStandardMaterial({ color: _hallWallColor, roughness: 0.7, metalness: 0.05 });
  // -X side wall (pre-mirror X=_hallXLeft=11) — single continuous piece
  {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, _hallHeight, _hallLen), hallWallMat);
    seg.position.set(_hallXLeft - 0.25, floorY + _hallHeight / 2, _hallCenterZ);
    seg.castShadow = true; seg.receiveShadow = true;
    seg._isRoom = true; seg._isHallway = true;
    addRoom(seg);
  }
  // +X side wall used to be a separate `hallWallR` mesh, coplanar with the
  // bedroom's `rightWall` but offset by 0.5" (extruded in the opposite
  // direction), which produced a visible thickness step at the Z=49 seam.
  // It is now built as part of `rightWall` below as a single extrude that
  // spans Z=_sbXMin.._hallZEnd with the guest-door hole cut in one piece.
  const _guestDoorW = 32;
  const _guestDoorH = 68;
  const _guestDoorCenterZ = 50;
  const _guestDoorZmin = _guestDoorCenterZ - _guestDoorW / 2; // 34
  const _guestDoorZmax = _guestDoorCenterZ + _guestDoorW / 2; // 66
  // End wall (Z=_hallZEnd)
  const hallWallEnd = new THREE.Mesh(
    new THREE.BoxGeometry(_hallWidth + 1, _hallHeight, 0.5),
    hallWallMat
  );
  hallWallEnd.position.set(_hallCenterX, floorY + _hallHeight / 2, _hallZEnd + 0.25);
  hallWallEnd.castShadow = true; hallWallEnd.receiveShadow = true;
  hallWallEnd._isRoom = true; hallWallEnd._isHallway = true;
  addRoom(hallWallEnd);

  // Hallway baseboards — split the -X wall around its decorative door, and
  // split the +X (shared) wall around the guest-door opening that extends
  // past Z=49.
  {
    const bbColor = _hallBbColor;
    const lDoorMin = _hallDoorCenterZ - _hallDoorW / 2 - 2.5;
    const lDoorMax = _hallDoorCenterZ + _hallDoorW / 2 + 2.5;
    const rDoorMin = _guestDoorZmin - 2.5;
    const rDoorMax = _guestDoorZmax + 2.5;
    const addSeg = (x, zMin, zMax) => {
      const w = zMax - zMin; if (w < 0.5) return;
      roomBox(0.6, 3, w, bbColor, x, floorY + 1.5, (zMin + zMax) / 2, 0, 0, 0);
    };
    // -X wall — continuous (no door on this side)
    addSeg(_hallXLeft + 0.5, _hallZStart, _hallZEnd);
    // (+X wall baseboards are handled by the unified right-wall baseboard
    // loop below, which now spans the full Z=_sbXMin.._hallZEnd range.)
    // Baseboard along the end wall
    roomBox(_hallWidth, 3, 0.6, bbColor, _hallCenterX, floorY + 1.5, _hallZEnd - 0.5, 0, 0, 0);
  }

  // ─── Functional guest-room door (on hallway's +X wall at Z=_guestDoorCenterZ) ───
  // Frame + hinged leaf + knob, using the shared door asset so it matches
  // every other door in the scene. Hinge is on the +Z jamb of the opening;
  // negative rotation.y swings the free edge toward -X (into the hallway).
  let toggleGuestDoor = null;
  let _guestDoorOpenState = () => false;
  let _guestDoorPanelMesh = null;
  let applyPushGuestDoor = null;
  {
    const panelThick = 1.4;
    const panelH = _guestDoorH - 0.5;
    const panelW = _guestDoorW - 1;
    // Hinge on the +Z jamb. Trim jambs overhang by 0.5" so shift inward
    // by 0.5" from the wall-opening edge for flush alignment.
    const hingeZ = _guestDoorZmax - 0.5;
    const hingeX = sideWallX - 0.5;          // 50.5
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, floorY + _guestDoorH / 2, hingeZ);
    pivot._isRoom = true;
    addRoom(pivot);

    // Leaf extends in -Z from the hinge; negative rotation.y swings the
    // free edge from -Z toward -X (into the hallway). Leaf position.x =
    // -panelThick/2 offsets the panel's thickness axis so the closed panel
    // sits flush with the bedroom-side wall face.
    const leaf = buildDoorLeaf({
      width: panelW, height: panelH, thickness: panelThick,
    });
    leaf.rotation.y = Math.PI / 2;             // width axis → world -Z
    leaf.position.set(-panelThick / 2, 0, -panelW / 2);
    tagAll(leaf, { _isRoom: true, _isGuestDoor: true });
    leaf.userData.doorLeaf.slab.castShadow = true;
    pivot.add(leaf);
    _guestDoorPanelMesh = leaf.userData.doorLeaf.slab;

    // Knobs on both faces, on the lock rail, near the free (strike) edge.
    // Free edge is now at -Z side of the panel (handle on the right).
    const knobY = leaf.userData.doorLeaf.lockRailY;
    const knobZ = -(panelW - 4);
    // Bedroom-side knob (points -X, toward the bedroom interior).
    const knobBed = buildDoorKnob();
    knobBed.position.set(-panelThick, knobY, knobZ);
    knobBed.rotation.y = -Math.PI / 2;
    tagAll(knobBed, { _isRoom: true, _isGuestDoorHandle: true });
    pivot.add(knobBed);
    // Guest-room-side knob (points +X, toward the guest room beyond).
    const knobRoom = buildDoorKnob();
    knobRoom.position.set(0, knobY, knobZ);
    knobRoom.rotation.y = Math.PI / 2;
    tagAll(knobRoom, { _isRoom: true, _isGuestDoorHandle: true });
    pivot.add(knobRoom);
    doorKnobs.push(knobBed); doorKnobs.push(knobRoom);

    // Door trim around the opening — on the bedroom-facing (inner) side of
    // the wall. buildDoorFrame builds in the local XY plane with depth
    // along local Z; rotate -π/2 so depth becomes world -X (into the room).
    // Trim depth matches panel thickness so the jambs read flush with both
    // faces of the closed panel (no visible gap between slab and trim).
    const trimD = panelThick;                // 1.4 — matches door slab
    const frame = buildDoorFrame({
      width: _guestDoorW, height: _guestDoorH, depth: trimD,
    });
    // Trim sits flush with wall inner face (X=50.5) with a 0.04" pull-back
    // to avoid z-fighting where the jambs overlap the wall (Z=32..34 and
    // Z=66..68). After rotate, depth spans X = posX ± depth/2.
    frame.position.set(sideWallX - 0.5 - 0.04 - trimD / 2,
      floorY + _guestDoorH / 2,
      _guestDoorCenterZ);
    frame.rotation.y = -Math.PI / 2;
    tagAll(frame, { _isRoom: true });
    addRoom(frame);

    // Guest-door physics — same torque-based model as corner door.
    let _angle = 0;
    let _omega = 0;
    let _animTarget = null;
    let _anim = 0;
    const _openAngle = 82 * Math.PI / 180;
    const _maxAngle = _openAngle * 1.05;
    _guestDoorOpenState = () => Math.abs(_angle) > 0.05;
    const _step = () => {
      if (_animTarget !== null) {
        _angle += (_animTarget - _angle) * 0.22;
        if (Math.abs(_animTarget - _angle) < 0.001) {
          _angle = _animTarget;
          _animTarget = null;
          _omega = 0;
        }
      } else if (Math.abs(_omega) > 1e-4) {
        _angle += _omega;
        _omega *= 0.93;
      }
      if (_angle > _maxAngle) { _angle = _maxAngle; if (_omega > 0) _omega = 0; }
      else if (_angle < -_maxAngle) { _angle = -_maxAngle; if (_omega < 0) _omega = 0; }
      pivot.rotation.y = _angle;
      const animating = (_animTarget !== null) || (Math.abs(_omega) > 1e-4);
      if (animating) {
        _anim = requestAnimationFrame(_step);
      } else {
        _anim = 0;
      }
    };
    const _kick = () => { if (!_anim) _anim = requestAnimationFrame(_step); };
    toggleGuestDoor = (forceOpen, swingSign) => {
      const isOpen = Math.abs(_angle) > 0.05;
      const open = (typeof forceOpen === 'boolean') ? forceOpen : !isOpen;
      if (open) {
        const sign = (swingSign === 1 || swingSign === -1)
          ? swingSign
          : (_angle >= 0 ? 1 : -1);
        _animTarget = sign * _openAngle;
      } else {
        _animTarget = 0;
      }
      _kick();
      return open;
    };
    // Pivot world X (post-mirror): room.js applies an _isRoom X-mirror, so
    // the world pivot X is -hingeX. Player on hallway side (worldX >
    // pivotWorldX) → swingSign=+1 (door swings into office, away from
    // player). Office side → swingSign=-1.
    // Pivot world X (post-mirror): room.js applies an _isRoom X-mirror, so
    // the world pivot X is -hingeX. Player on hallway side (worldX >
    // pivotWorldX) — swingSign=+1 (door swings into office, away from
    // player). Office side — swingSign=-1.
    applyPushGuestDoor = (contactX, contactZ, pushOutX, pushOutZ) => {
      const fmagSq = pushOutX * pushOutX + pushOutZ * pushOutZ;
      if (!(fmagSq > 1e-8)) return;
      _animTarget = null;
      pivot.updateWorldMatrix(true, false);
      const px = pivot.matrixWorld.elements[12];
      const pz = pivot.matrixWorld.elements[14];
      const leverX = contactX - px;
      const leverZ = contactZ - pz;
      const fx = -pushOutX, fz = -pushOutZ;
      const torque = leverZ * fx - leverX * fz;
      const t = Math.max(-25, Math.min(25, torque));
      // Pure angular-impulse — no instant angle kick (snap), with peak
      // omega clamp so successive contact frames can't spike.
      _omega += t * 0.018;
      const MAX_OMEGA = 0.14;
      if (_omega > MAX_OMEGA) _omega = MAX_OMEGA;
      else if (_omega < -MAX_OMEGA) _omega = -MAX_OMEGA;
      _kick();
    };
  }

  // ─── Guest room (behind the hallway's +X door) ────────────────────
  // The office shares the bedroom's TV wall (oppWallZ=-78) as its -Z
  // boundary — no separate RIGHT wall. Shared -X wall is the existing
  // bedroom/hallway right wall (at pre-mirror X=51), which already has the
  // guest door hole cut into it, so we build two new walls (+X far, +Z),
  // extend the TV wall into the office footprint, and add floor + ceiling.
  let outdoorMat; // forward-declared; assigned later when outdoor textures are ready
  let _grOutdoorMesh; // guest-room outdoor backdrop — material swapped after outdoorMat init
  let _officeWindowModel = null;
  let _officeWindowOpen = false;
  let _standingDeskRef = null;
  const _grXmin = 51;              // BACK wall — shared wall w/ hallway (has the door)
  const _grXmax = 183;             // FRONT wall — where desk faces (132" deep)
  const _grZmin = oppWallZ;        // TV wall serves as the -Z boundary (no separate RIGHT wall)
  const _grZmax = 69;              // LEFT wall — 1" from door trim outer edge
  const _grCenterX = (_grXmin + _grXmax) / 2;
  const _grCenterZ = (_grZmin + _grZmax) / 2;
  const _grWidthX = _grXmax - _grXmin; // 132
  const _grWidthZ = _grZmax - _grZmin; // 160
  const _grHeight = 80;
  const _grWallColor = 0xd8d4ce;
  const _grBbColor = 0xc0bbb4;
  const _grCeilColor = 0xe0ddd6;

  // Hardwood floor — split into two rectangles so the bedroom closet
  // interior (X=[51,87], Z=[-78,-14]) shows the bedroom carpet instead
  // of hardwood.  The closet opens from the bedroom via bifold doors,
  // so its floor should match the bedroom.
  //
  // Rect 1: everything above the closet's +Z wall (Z >= -14)
  //   X=[51,183], Z=[-14, 69]  →  132 × 83
  // Rect 2: the strip to the right of the closet back wall (X >= 87)
  //   X=[87,183], Z=[-78,-14]  →  96 × 64
  //
  // The seams sit behind the closet +Z side wall and back wall, so
  // mismatched plank patterns are hidden by geometry.
  {
    // Bedroom closet interior: X=[51,87], Z=[-78,-14]
    // Pre-computed from closet constants declared later in the file:
    //   _closetZ=-46, _closetInteriorW=64, _closetDepth=36
    const _clZmax = -14;   // _closetZ + _closetInteriorW/2
    const _clZmin = -78;   // _closetZ + -_closetInteriorW/2  (= oppWallZ)
    const _clXmax = 87;    // sideWallX + _closetDepth

    // Rect 1 — upper portion (above closet +Z wall)
    const r1W = _grWidthX;                          // 132
    const r1Z = _grZmax - _clZmax;                   // 69 - (-14) = 83
    const r1Cx = _grCenterX;                         // 117
    const r1Cz = (_clZmax + _grZmax) / 2;            // (-14+69)/2 = 27.5
    const r1 = new THREE.Mesh(
      new THREE.PlaneGeometry(r1W, r1Z),
      _makeHardwoodMaterial(r1W, r1Z)
    );
    r1.rotation.x = -Math.PI / 2;
    r1.position.set(r1Cx, floorY + _hwLiftY, r1Cz);
    r1.receiveShadow = true;
    r1._isRoom = true; r1._isFloor = true; r1._isGuestRoom = true;
    addRoom(r1);

    // Rect 2 — lower-right strip (beside closet, X >= closet back wall)
    const r2W = _grXmax - _clXmax;                   // 183 - 87 = 96
    const r2Z = _clZmax - _clZmin;                    // -14 - (-78) = 64
    const r2Cx = (_clXmax + _grXmax) / 2;             // (87+183)/2 = 135
    const r2Cz = (_clZmin + _clZmax) / 2;             // (-78+-14)/2 = -46
    const r2 = new THREE.Mesh(
      new THREE.PlaneGeometry(r2W, r2Z),
      _makeHardwoodMaterial(r2W, r2Z)
    );
    r2.rotation.x = -Math.PI / 2;
    r2.position.set(r2Cx, floorY + _hwLiftY, r2Cz);
    r2.receiveShadow = true;
    r2._isRoom = true; r2._isFloor = true; r2._isGuestRoom = true;
    addRoom(r2);
  }

  // Ceiling — separate plane covering just the guest-room footprint, at the
  // same height (+0.05 lift) as the main bedroom/hallway ceiling plane.
  {
    const grCeilMat = new THREE.MeshStandardMaterial({
      color: _grCeilColor, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
    });
    const grCeil = new THREE.Mesh(
      new THREE.PlaneGeometry(_grWidthX, _grWidthZ),
      grCeilMat
    );
    grCeil.rotation.x = Math.PI / 2;
    grCeil.position.set(_grCenterX, floorY + _grHeight + 0.05, _grCenterZ);
    grCeil.castShadow = false;
    grCeil.receiveShadow = true;
    grCeil._isRoom = true; grCeil._isGuestRoom = true;
    addRoom(grCeil);
  }

  // New walls — two boxes (FRONT + LEFT). The -Z side uses the bedroom's
  // TV wall (oppWallZ), extended into the office footprint below.
  // Thickness 0.5" matches every other wall in the scene.
  const grWallMat = new THREE.MeshStandardMaterial({
    color: _grWallColor, roughness: 0.7, metalness: 0.05,
  });
  // FRONT wall (+X far wall, pre-mirror X = _grXmax..+0.5) with window opening.
  // Window uses the same dimensions as the bedroom window (winW × winH) and is
  // centered on the Z span of the office.
  const grWinCenterZ = _grCenterZ;
  const grWinCenterY = winCenterY;       // same sill height as bedroom
  const grWinBottom = grWinCenterY - winH / 2;
  const grWinTop = grWinCenterY + winH / 2;
  const grWinLeft = grWinCenterZ - winW / 2;   // toward -Z (TV wall side)
  const grWinRight = grWinCenterZ + winW / 2;   // toward +Z (left wall side)
  const grFrontWallX = _grXmax + 0.25;
  const grWallZmin = _grZmin - 0.5;           // full Z range of wall
  const grWallZmax = _grZmax + 0.5;
  {
    // Below window — extends well below the floor to act as the visible
    // foundation/skirt above the lowered yard.
    const skirt = 60;
    const bH = grWinBottom - floorY + skirt;
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, bH, _grWidthZ + 1), grWallMat);
    w.position.set(grFrontWallX, floorY - skirt + bH / 2, _grCenterZ);
    w.castShadow = true; w.receiveShadow = true;
    w._isRoom = true; w._isGuestRoom = true; addRoom(w);
    // Above window
    const aH = floorY + _grHeight - grWinTop;
    const wa = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, aH, _grWidthZ + 1), grWallMat);
    wa.position.set(grFrontWallX, grWinTop + aH / 2, _grCenterZ);
    wa.castShadow = true; wa.receiveShadow = true;
    wa._isRoom = true; wa._isGuestRoom = true; addRoom(wa);
    // Left of window (toward -Z / TV wall)
    const lW = grWinLeft - grWallZmin;
    const wl = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, winH, lW), grWallMat);
    wl.position.set(grFrontWallX, grWinCenterY, grWallZmin + lW / 2);
    wl.castShadow = true; wl.receiveShadow = true;
    wl._isRoom = true; wl._isGuestRoom = true; addRoom(wl);
    // Right of window (toward +Z / left wall)
    const rW = grWallZmax - grWinRight;
    const wr = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, winH, rW), grWallMat);
    wr.position.set(grFrontWallX, grWinCenterY, grWinRight + rW / 2);
    wr.castShadow = true; wr.receiveShadow = true;
    wr._isRoom = true; wr._isGuestRoom = true; addRoom(wr);
  }
  // Outer "front of house" wall — extends the office front wall in +Z all
  // the way to the end of the hallway, giving the property a continuous
  // exterior face when looking out the office window. Solid (no openings).
  // Extended below floor level to meet the lowered yard.
  {
    const extZmin = grWallZmax;             // 69.5 (where office front wall ends)
    const extZmax = _hallZEnd + 0.5;        // 289.5 (matches hallway end-cap)
    const extLen = extZmax - extZmin;
    const skirt = 60;
    const extH = _grHeight + skirt;
    const ext = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, extH, extLen), grWallMat);
    ext.position.set(grFrontWallX, floorY - skirt + extH / 2, (extZmin + extZmax) / 2);
    ext.castShadow = true; ext.receiveShadow = true;
    ext._isRoom = true; ext._isGuestRoom = true;
    addRoom(ext);
  }
  // LEFT wall (+Z, right next to the door trim when entering).
  {
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(_grWidthX, _grHeight, 0.5),
      grWallMat
    );
    w.position.set(_grCenterX, floorY + _grHeight / 2, _grZmax + 0.25);
    w.castShadow = true; w.receiveShadow = true;
    w._isRoom = true; w._isGuestRoom = true;
    addRoom(w);
  }
  // Gyarados painting — framed art hung on the LEFT wall (+Z), centered
  // horizontally on the wall and slightly above eye level. Source image
  // is 960×1472 (portrait, ~2:3). Matte and photo sit flat against the
  // wall; the wood frame is a raised lip around them.
  {
    const photoW = 14;
    const photoH = 21.47;           // matches source 960:1472 aspect ratio
    const matteMarginX = photoW * 0.20;
    const matteMarginY = photoH * 0.20;
    const matteW = photoW + matteMarginX * 2;
    const matteH = photoH + matteMarginY * 2;
    const frameBorder = 1.25;       // wood lip thickness on each side
    const lipDepth = 1.1;           // how far the lip protrudes off the wall
    const centerX = _grCenterX;
    const centerY = floorY + 50;    // natural hang height
    const wallFaceZ = _grZmax;      // interior face of the LEFT wall

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2b1d12, roughness: 0.55, metalness: 0.05,
    });
    // Four lip pieces forming a picture-frame border. Back face flush with
    // the wall; front face protrudes by lipDepth toward the room (-Z).
    const lipZ = wallFaceZ - lipDepth / 2;
    // Top lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(matteW + frameBorder * 2, frameBorder, lipDepth),
        frameMat);
      m.position.set(centerX, centerY + matteH / 2 + frameBorder / 2, lipZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isGuestRoom = true; addRoom(m);
    }
    // Bottom lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(matteW + frameBorder * 2, frameBorder, lipDepth),
        frameMat);
      m.position.set(centerX, centerY - matteH / 2 - frameBorder / 2, lipZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isGuestRoom = true; addRoom(m);
    }
    // -X lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(frameBorder, matteH, lipDepth),
        frameMat);
      m.position.set(centerX - matteW / 2 - frameBorder / 2, centerY, lipZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isGuestRoom = true; addRoom(m);
    }
    // +X lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(frameBorder, matteH, lipDepth),
        frameMat);
      m.position.set(centerX + matteW / 2 + frameBorder / 2, centerY, lipZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isGuestRoom = true; addRoom(m);
    }

    // White matte — sits ~0.05" off the wall, fills the inside of the lip.
    const matteMat = new THREE.MeshStandardMaterial({
      color: 0xf5f1e8, roughness: 0.95, metalness: 0.0,
    });
    const matte = new THREE.Mesh(
      new THREE.PlaneGeometry(matteW, matteH),
      matteMat
    );
    matte.rotation.y = Math.PI;
    matte.position.set(centerX, centerY, wallFaceZ - 0.05);
    matte.receiveShadow = true;
    matte._isRoom = true; matte._isGuestRoom = true;
    addRoom(matte);

    // Photo — smaller plane just in front of the matte; matte border
    // shows around all four sides as a uniform white margin.
    const photoMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.85, metalness: 0.0,
    });
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(photoW, photoH),
      photoMat
    );
    photo.rotation.y = Math.PI;
    photo.position.set(centerX, centerY, wallFaceZ - 0.07);
    photo.receiveShadow = true;
    photo._isRoom = true; photo._isGuestRoom = true;
    addRoom(photo);

    new THREE.TextureLoader().load(
      'img/gyarados painting.webp',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, (state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 4));
        photo.material.map = tex;
        photo.material.needsUpdate = true;
      },
      undefined,
      () => { /* fall back to blank photo if missing */ }
    );

    // Glass-like sheen — overlay the photo+matte with reflective highlights
    // without refracting the image (which caused noticeable blur at any
    // distance). MeshPhysicalMaterial w/ clearcoat=1 gives a sharp glossy
    // top layer; opacity is very low so the underlying photo stays crisp
    // and only environment reflections "shine" through.
    const sheenMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
    });
    const sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(matteW, matteH),
      sheenMat
    );
    sheen.rotation.y = Math.PI;
    sheen.position.set(centerX, centerY, wallFaceZ - 0.09);
    sheen._isRoom = true; sheen._isGuestRoom = true;
    addRoom(sheen);
  }

  // TV wall extension — continues the bedroom's oppWall (Z=oppWallZ) from
  // X=51 (shared wall) out to X=183 (front wall) so the office's -Z side
  // is one continuous surface with the bedroom TV wall.
  {
    const extW = _grWidthX;   // 132
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(extW, _grHeight, 0.5),
      grWallMat
    );
    w.position.set(_grCenterX, floorY + _grHeight / 2, oppWallZ - 0.25);
    w.castShadow = true; w.receiveShadow = true;
    w._isRoom = true; w._isGuestRoom = true;
    addRoom(w);
  }

  // Baseboards on the new interior wall faces (FRONT, LEFT, TV wall extension).
  {
    const bbH = 3, bbT = 0.6, bbY = floorY + _hwLiftY + bbH / 2;
    // FRONT wall (+X) baseboard — split into two segments around the window.
    // Left segment (toward -Z / TV wall)
    const grBbLeftW = grWinLeft - grWallZmin;
    roomBox(bbT, bbH, grBbLeftW, _grBbColor,
      _grXmax - bbT / 2, bbY, grWallZmin + grBbLeftW / 2, 0, 0, 0);
    // Right segment (toward +Z / left wall)
    const grBbRightW = grWallZmax - grWinRight;
    roomBox(bbT, bbH, grBbRightW, _grBbColor,
      _grXmax - bbT / 2, bbY, grWinRight + grBbRightW / 2, 0, 0, 0);
    // LEFT wall (+Z) baseboard.
    roomBox(_grWidthX, bbH, bbT, _grBbColor,
      _grCenterX, bbY, _grZmax - bbT / 2, 0, 0, 0);
    // TV wall extension (-Z / oppWallZ) baseboard — office side.
    roomBox(_grWidthX, bbH, bbT, _grBbColor,
      _grCenterX, bbY, oppWallZ + bbT / 2, 0, 0, 0);
  }

  // ─── Office front-wall window (frame, sill, outdoor backdrop) ───
  // Uses the same outdoor material as the bedroom window so clicking either
  // one toggles day/night for both.
  {
    // Window sill — deeper than the frame so it reads as a real ledge
    // sitting beneath the trim.
    roomBox(1.6, 0.5, winW + 2, 0xc8c4be,
      _grXmax - 0.8, grWinBottom - 0.25, grWinCenterZ, 0, 0, 0);
    // Window frame + glass — shared model (office window IS openable).
    const grFrameD = 1.2;
    const grWallInnerX = _grXmax;       // inner face of front wall
    const grTrimX = grWallInnerX - grFrameD / 2 - 0.04;  // proud toward room interior
    _officeWindowModel = buildWindowModel({ width: winW, height: winH });
    _officeWindowModel.position.set(grTrimX, grWinCenterY, grWinCenterZ);
    tagAll(_officeWindowModel, { _isRoom: true, _isGuestRoom: true });
    // Mark ALL meshes in the window as interactive for open/close
    _officeWindowModel.traverse(o => { if (o.isMesh) o._isWindowPane = true; });
    addRoom(_officeWindowModel);

    // Outdoor backdrop — shares the bedroom window's material (outdoorMat) so
    // clicking either window toggles the same texture/color.
    // outdoorMat is assigned later when textures are ready; use placeholder now.
    const grOutdoorGeo = new THREE.PlaneGeometry(600, 300);
    const _grOutdoorPlaceholder = new THREE.MeshBasicMaterial({ color: 0x88aacc });
    const grOutdoor = new THREE.Mesh(grOutdoorGeo, _grOutdoorPlaceholder);
    _grOutdoorMesh = grOutdoor; // store ref so we can swap material later
    grOutdoor.rotation.y = -Math.PI / 2;  // face inward (-X direction in pre-mirror)
    grOutdoor.position.set(_grXmax + 300, grWinCenterY + 80, grWinCenterZ);
    grOutdoor._isRoom = true; grOutdoor._isGuestRoom = true;
    grOutdoor._isWindow = true;  // clickable for day/night toggle
    addRoom(grOutdoor);
  }

  // ─── Outdoor terrain (beyond office front wall) ──────────────────
  // Accessible when the office window is open. Flat lawn at flatY
  // (~3 ft below the office window sill) wraps around the whole house;
  // a flat asphalt road runs along the far edge of the front yard with
  // dashed center lines for character. No slopes / no incline — the
  // box-collision system can't represent tilted ground cleanly, and
  // earlier rotated slabs left the player floating above the visible
  // grass. Keeping everything flat lets feet sit flush on the lawn.
  // Z extent spans the whole front-of-house run plus overrun.
  {
    const terrainZhalf = 300;
    const terrainZmin = grWinCenterZ - terrainZhalf;
    const terrainZmax = grWinCenterZ + terrainZhalf;
    const terrainZw = terrainZmax - terrainZmin;
    const terrainZcenter = grWinCenterZ;

    // Y reference: window sill = grWinBottom = floorY + 23. Yard sits
    // 3 ft below the sill so looking out the office window angles down
    // onto the lawn rather than straight across.
    const sillY = grWinBottom - 36;     // (floorY + 23) - 36
    const flatY = sillY - 18;
    const lawnStartX = _grXmax + 0.5;   // 183.5
    const roadStartX = 411;
    const roadEndX = 543;

    // Procedural grass texture — base green with stippled shades and short
    // blade strokes. Tiled per-slab so each terrain piece reads as grass
    // rather than a flat green block.
    const _grassCanvas = document.createElement('canvas');
    _grassCanvas.width = 256;
    _grassCanvas.height = 256;
    {
      const ctx = _grassCanvas.getContext('2d');
      ctx.fillStyle = '#4a8a3a';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const s = Math.floor(Math.random() * 50 - 25);
        ctx.fillStyle = `rgb(${74 + s},${138 + s},${58 + s})`;
        ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      for (let i = 0; i < 700; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const len = 3 + Math.random() * 5;
        const s = Math.floor(Math.random() * 60 - 20);
        ctx.strokeStyle = `rgb(${50 + s},${110 + s},${40 + s})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 2, y - len);
        ctx.stroke();
      }
    }
    const _grassBaseTex = new THREE.CanvasTexture(_grassCanvas);
    _grassBaseTex.wrapS = _grassBaseTex.wrapT = THREE.RepeatWrapping;
    _grassBaseTex.anisotropy = 4;
    function _makeGrassMat(uLen, vLen) {
      // ~24" per tile keeps blade scale consistent across slab sizes.
      const tex = _grassBaseTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, uLen / 24), Math.max(1, vLen / 24));
      return new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff, roughness: 0.95, metalness: 0,
      });
    }

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.85, metalness: 0 });

    // ── Front-yard grass between house and road (flat) ────────────
    {
      const w = roadStartX - lawnStartX;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 2, terrainZw), _makeGrassMat(w, terrainZw));
      slab.position.set((lawnStartX + roadStartX) / 2, flatY, terrainZcenter);
      slab.castShadow = true; slab.receiveShadow = true;
      slab._isRoom = true; slab._isGuestRoom = true;
      addRoom(slab);
    }

    // ── Road surface (flat, level with lawn) ──────────────────────
    // Nudged up 0.2 so the road top sits just above the surrounding grass
    // slab top (both are 2 tall, centered at flatY) and doesn't z-fight.
    {
      const w = roadEndX - roadStartX;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 2, terrainZw), roadMat);
      slab.position.set((roadStartX + roadEndX) / 2, flatY + 0.2, terrainZcenter);
      slab.castShadow = true; slab.receiveShadow = true;
      slab._isRoom = true; slab._isGuestRoom = true;
      addRoom(slab);
    }

    // ── Dashed center line on road ────────────────────────────────
    {
      const lineY = flatY + 1.25;       // just above road slab top (road raised by 0.2)
      const lineMat = new THREE.MeshStandardMaterial({ color: 0xdddd44, roughness: 0.6 });
      const roadMidX = (roadStartX + roadEndX) / 2;
      const dashLen = 12, gapLen = 8, dashW = 1.5;
      for (let z = terrainZmin + 5; z < terrainZmax - 5; z += dashLen + gapLen) {
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(dashW, 0.3, dashLen), lineMat);
        dash.position.set(roadMidX, lineY, z + dashLen / 2);
        dash._isRoom = true; dash._isGuestRoom = true;
        addRoom(dash);
      }
    }

    // ── Massive grass field surrounding the entire house ──────────
    // ~10× the original ±300 lawn, wrapping the house on all sides so the
    // player can roam freely. Sits at the same Y as the front-yard lawn
    // slab so the visible grass top is one consistent height (flatY + 1)
    // everywhere outdoors — that exact Y is what _sampleOutdoorGroundY
    // in game-fp.js returns, so the player's feet land flush on grass.
    {
      const fieldSize = 6000;
      const fieldCenterX = 51;     // pre-mirror house center X (≈ midpoint of -81..183)
      const fieldCenterZ = 105;    // pre-mirror house center Z (≈ midpoint of -78..289)
      const field = new THREE.Mesh(
        new THREE.BoxGeometry(fieldSize, 2, fieldSize),
        _makeGrassMat(fieldSize, fieldSize));
      field.position.set(fieldCenterX, flatY, fieldCenterZ);
      field.receiveShadow = true;
      field._isRoom = true; field._isGuestRoom = true;
      addRoom(field);
    }

    // ── House foundation skirt ────────────────────────────────────
    // Hides the gap between the lowered lawn (flatY) and the house floor
    // (floorY) on the bedroom/back/hallway sides where the visible walls
    // were originally built only down to floorY. One slab per house volume.
    {
      const skirtMat = new THREE.MeshStandardMaterial({
        color: 0xa8a298, roughness: 0.95, metalness: 0,
      });
      const skirtTopY = floorY - 1;
      const skirtBotY = flatY - 30;
      const skirtH = skirtTopY - skirtBotY;
      const skirtCenterY = (skirtTopY + skirtBotY) / 2;
      const skirts = [
        // Bedroom volume
        { xMin: -82, xMax: 51.5, zMin: -78.5, zMax: 49.5 },
        // Office/guest-room volume (extends farther +Z for guest-room nook)
        { xMin: 50.5, xMax: 184, zMin: -78.5, zMax: 69.5 },
        // Hallway volume
        { xMin: 10.5, xMax: 51.5, zMin: 49, zMax: 289.5 },
      ];
      for (const s of skirts) {
        const w = s.xMax - s.xMin;
        const d = s.zMax - s.zMin;
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(w, skirtH, d), skirtMat);
        slab.position.set((s.xMin + s.xMax) / 2, skirtCenterY, (s.zMin + s.zMax) / 2);
        slab.receiveShadow = true; slab.castShadow = true;
        slab._isRoom = true; slab._isGuestRoom = true;
        addRoom(slab);
      }
    }

    // ── Outdoor hemisphere light ──────────────────────────────────
    const outdoorHemi = new THREE.HemisphereLight(0x87ceeb, 0x4a8a3a, 0.6);
    outdoorHemi.position.set(_grXmax + 100, floorY + 80, grWinCenterZ);
    outdoorHemi._isRoom = true; outdoorHemi._isGuestRoom = true;
    addRoom(outdoorHemi);
  }

  // Simple ceiling fixture + warm point light at the guest-room midpoint so
  // the space isn't pitch black when you walk in.
  {
    const fixMat = new THREE.MeshStandardMaterial({
      color: 0xf4ead5, emissive: 0xf4ead5, emissiveIntensity: 0.45, roughness: 0.5,
    });
    const fix = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 1.2, 24), fixMat);
    fix.position.set(_grCenterX, floorY + _grHeight - 0.7, _grCenterZ);
    fix._isRoom = true; fix._isGuestRoom = true;
    addRoom(fix);
    const grLight = new THREE.PointLight(0xffe6bb, 320, 260);
    grLight.position.set(_grCenterX, floorY + _grHeight - 6, _grCenterZ);
    grLight.castShadow = false;
    grLight._isRoom = true; grLight._isGuestRoom = true;
    addRoom(grLight);
  }

  // Simple ceiling fixture + point light at the hallway midpoint so it's not
  // pitch black. Warm tone similar to the main room's ceiling light.
  {
    const fixMat = new THREE.MeshStandardMaterial({ color: 0xf4ead5, emissive: 0xf4ead5, emissiveIntensity: 0.45, roughness: 0.5 });
    const fixGeo = new THREE.CylinderGeometry(4, 4, 1.2, 24);
    const fix = new THREE.Mesh(fixGeo, fixMat);
    fix.position.set(_hallCenterX, floorY + _hallHeight - 0.7, _hallCenterZ);
    fix.castShadow = false; fix.receiveShadow = false;
    fix._isRoom = true; fix._isHallway = true;
    addRoom(fix);
    const hallLight = new THREE.PointLight(0xffe6bb, 260, 220);
    hallLight.position.set(_hallCenterX, floorY + _hallHeight - 6, _hallCenterZ);
    hallLight.castShadow = false;
    hallLight._isRoom = true; hallLight._isHallway = true;
    addRoom(hallLight);
  }

  // ── Debug wall labels (localhost only) ──────────────────────────────
  // Giant text on each office wall so devs can agree on "LEFT / RIGHT /
  // FRONT / BACK". Uses Sprites so they always face the camera and are
  // readable from any angle. Hidden by default; toggled from pause menu.
  const _debugWallLabels = [];
  {
    const _makeLabel = (text, scale, color) => {
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 256;
      const ctx = cvs.getContext('2d');
      // Semi-transparent dark background for readability
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const pad = 16;
      const rr = 24;
      ctx.beginPath();
      ctx.roundRect(pad, pad, 512 - pad * 2, 256 - pad * 2, rr);
      ctx.fill();
      ctx.fillStyle = color;
      let fontSize = 110;
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      while (ctx.measureText(text).width > 460 && fontSize > 20) {
        fontSize -= 4;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 108);
      // Smaller axis note below
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.font = '36px system-ui, sans-serif';
      const notes = {
        FRONT: '+X  (_grXmax)', BACK: '-X  (_grXmin, door)',
        LEFT: '+Z  (_grZmax)',
      };
      if (notes[text]) ctx.fillText(notes[text], 256, 178);
      ctx.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(cvs);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(scale, scale / 2, 1);
      sprite.visible = false;
      sprite._isRoom = true;
      sprite._isDebugLabel = true;
      addRoom(sprite);
      _debugWallLabels.push(sprite);
      return sprite;
    };
    const midY = floorY + _grHeight / 2;
    // Office walls (red labels) — no RIGHT label since that side is the TV wall
    _makeLabel('FRONT', 40, '#ff4444').position.set(_grXmax - 4, midY, _grCenterZ);
    _makeLabel('BACK', 40, '#ff4444').position.set(_grXmin + 4, midY, _grCenterZ);
    _makeLabel('LEFT', 40, '#ff4444').position.set(_grCenterX, midY, _grZmax - 4);
  }

  // Also label the bedroom, hallway, and closet walls for reference
  {
    const _makeLabel = (lines, scale, color = '#44aaff') => {
      if (typeof lines === 'string') lines = [{ text: lines, color }];
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 256;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(16, 16, 480, 224, 24);
      ctx.fill();
      ctx.textAlign = 'center';
      const n = lines.length;
      const lineH = 220 / n;
      for (let i = 0; i < n; i++) {
        const { text, color: c } = lines[i];
        ctx.fillStyle = c;
        let fs = Math.min(lineH - 4, 90);
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        while (ctx.measureText(text).width > 460 && fs > 20) {
          fs -= 4;
          ctx.font = `bold ${fs}px system-ui, sans-serif`;
        }
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 24 + lineH * i + lineH / 2);
      }
      const tex = new THREE.CanvasTexture(cvs);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(scale, scale / 2, 1);
      sprite.visible = false;
      sprite._isRoom = true;
      sprite._isDebugLabel = true;
      addRoom(sprite);
      _debugWallLabels.push(sprite);
      return sprite;
    };
    const midY = floorY + 40;

    // ── Bedroom walls (blue) ──
    _makeLabel('WINDOW', 50).position.set(leftWallX + 4, midY, -15);
    _makeLabel('TV WALL', 50).position.set(-15, midY, oppWallZ + 4);
    // Shared wall: bedroom side wall / office closet back
    _makeLabel([
      { text: 'SIDE WALL', color: '#44aaff' },
      { text: 'OFFICE CLOSET BACK', color: '#dd8844' },
    ], 50).position.set(sideWallX - 4, midY, -15);
    _makeLabel('DOOR WALL', 50).position.set(-15, midY, 48.5 - 4);

    // ── Hallway walls (green) ──
    const hallMidY = floorY + _hallHeight / 2;
    const hallMidZ = _hallCenterZ;
    _makeLabel('HALL LEFT', 28, '#44dd66').position.set(_hallXLeft + 4, hallMidY, hallMidZ);
    _makeLabel('HALL RIGHT', 28, '#44dd66').position.set(_hallXRight - 4, hallMidY, hallMidZ);
    _makeLabel('HALL END', 28, '#44dd66').position.set(_hallCenterX, hallMidY, _hallZEnd - 4);
  }



  // ── Office furniture ──────────────────────────────────────────────
  // Sit-stand desk against the -X far wall, Thorzone Nanoq R PC case, 3 OLED monitors.
  // ─── Office furniture — placed inside the guest room ─────────────
  // All positions in pre-mirror coords. roomBox auto-adds _isRoom + addRoom.
  // Guest room: X=51..183, Z=-13..130. Desk against far +X wall, facing -X.
  {
    const metalColor = 0x3a3a3a;    // dark metal frame
    const legColor = 0xf0f0f0;     // white desk legs
    const deskTopColor = 0xd4b070;  // natural bamboo desktop
    const monitorColor = 0x1a1a1a;

    // ─ Adjustable sit-stand desk — 84"W × 30"D × 30"H (standing: ~44"H) ─
    // Against the +X far wall, facing -X (toward the door). Flush with LEFT wall.
    // The desktop, monitors, arms, PC, keyboard, mouse, and cross-bar all
    // rise together when interacted with. Leg posts telescope (scale Y) so
    // their tops stay flush with the bottom of the desktop. Feet stay on
    // the floor. roomRefs exposes references for the click handler in
    // purifier.js and the dynamic collision in game-fp.js.
    const deskW = 84, deskD = 30, deskTopH = 1.5;
    const deskLegH = 28; // current height (sitting position)
    const deskRiseMax = 22; // standing position: 28 + 22 = 50" leg height
    const deskX = _grXmax - 4 - deskD / 2;               // 4" from far wall → 164
    const deskZ = _grZmax - deskW / 2;                    // flush against LEFT wall
    const deskTopY = floorY + deskLegH + deskTopH / 2;

    // Parts that rise with the desktop (top + everything mounted on it).
    // Each entry: { mesh, baseY }. Updated by the standing-desk lerp.
    const standingDeskRiseParts = [];
    const _trackRise = (mesh) => { standingDeskRiseParts.push({ mesh, baseY: mesh.position.y }); mesh._isStandingDesk = true; return mesh; };
    // Telescoping leg posts: scale Y so the top stays under the desktop
    // while the bottom remains anchored at the floor.
    const standingDeskLegPosts = []; // { mesh, baseH }

    // Desktop surface
    const deskTop = _trackRise(roomBox(deskD, deskTopH, deskW, deskTopColor,
      deskX, deskTopY, deskZ, 0, 0, 0));
    deskTop._isOffice = true;

    // Desk frame — two T-shaped legs (left and right)
    for (const side of [-1, 1]) {
      const legZ = deskZ + side * (deskW / 2 - 4);
      // Vertical post — telescopes (scale.y) so its top tracks the desktop.
      const post = roomBox(3, deskLegH, 3, legColor,
        deskX, floorY + deskLegH / 2, legZ, 0, 0, 0);
      post._isStandingDesk = true;
      standingDeskLegPosts.push({ mesh: post, baseH: deskLegH });
      // Foot (horizontal stabilizer along desk depth) — stays on floor
      roomBox(deskD - 4, 1.5, 3, legColor,
        deskX, floorY + 0.75, legZ, 0, 0, 0);
    }
    // Cross-bar between legs (under desktop) — rises with desktop
    _trackRise(roomBox(2, 2, deskW - 8, legColor,
      deskX, deskTopY - deskTopH / 2 - 1, deskZ, 0, 0, 0));

    // ─ 3 OLED Monitors — 27" each (24"W × 14"H × 0.5"D), on monitor arms ─
    const monW = 24, monH = 14, monD = 0.5;
    const monStandH = 6;  // arm height above desk
    const monY = deskTopY + deskTopH / 2 + monStandH + monH / 2;
    const monBaseX = deskX + deskD / 2 - 5; // near back of desk (wall side)

    // Center monitor (faces -X in pre-mirror → +X in world, toward chair)
    const monCenter = _trackRise(roomBox(monD, monH, monW, monitorColor,
      monBaseX, monY, deskZ, 0, 0, 0));
    monCenter._isOffice = true;
    monCenter.material.roughness = 0.2; monCenter.material.metalness = 0.5;

    // Left monitor (angled inward ~34°, pulled forward toward chair)
    const monSideX = monBaseX - 8;
    const monSideAngle = 0.6;
    const monSideOff = monW - 2; // Z offset from center
    const monLeft = _trackRise(roomBox(monD, monH, monW, monitorColor,
      monSideX, monY, deskZ - monSideOff, 0, monSideAngle, 0));
    monLeft._isOffice = true;
    monLeft.material.roughness = 0.2; monLeft.material.metalness = 0.5;

    // Right monitor (angled inward ~34°, pulled forward toward chair)
    const monRight = _trackRise(roomBox(monD, monH, monW, monitorColor,
      monSideX, monY, deskZ + monSideOff, 0, -monSideAngle, 0));
    monRight._isOffice = true;
    monRight.material.roughness = 0.2; monRight.material.metalness = 0.5;

    // Monitor arm — single center post with horizontal arms branching to outer monitors
    const armPostY = deskTopY + deskTopH / 2 + monStandH / 2;
    const armX = monBaseX + 1.5; // just behind center monitor
    // Center vertical post (single mount point)
    _trackRise(roomBox(2, monStandH, 2, metalColor,
      armX, armPostY, deskZ, 0, 0, 0));
    // Horizontal arm spanning left to right monitor
    const armSpan = monSideOff * 2; // distance between outer monitors
    _trackRise(roomBox(1.5, 1.5, armSpan, metalColor,
      armX, deskTopY + deskTopH / 2 + monStandH, deskZ, 0, 0, 0));
    // Short forward arms to outer monitors (reach from post to monSideX)
    const armReach = armX - monSideX; // from post to side monitors
    for (const side of [-1, 1]) {
      _trackRise(roomBox(armReach, 1.5, 1.5, metalColor,
        monSideX + armReach / 2, deskTopY + deskTopH / 2 + monStandH, deskZ + side * monSideOff, 0, 0, 0));
    }

    // Screen glow (3 emissive planes, offset from monitor face toward chair)
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x1a3a5a, emissive: 0x2a4a6a, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0.0,
    });
    const scrOff = monD / 2 + 0.1; // offset from monitor center to face
    // Center screen (faces -X toward chair)
    {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(monW - 1, monH - 1), screenMat);
      s.rotation.y = Math.PI / 2;
      s.position.set(monBaseX - scrOff, monY, deskZ);
      s._isRoom = true; s._isOffice = true; s._isStandingDesk = true;
      standingDeskRiseParts.push({ mesh: s, baseY: s.position.y });
      addRoom(s);
    }
    // Left screen (rotated, offset along rotated normal)
    {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(monW - 1, monH - 1), screenMat);
      s.rotation.y = Math.PI / 2 + monSideAngle;
      const nx = -Math.cos(monSideAngle), nz = Math.sin(monSideAngle);
      s.position.set(monSideX + nx * scrOff, monY, deskZ - monSideOff + nz * scrOff);
      s._isRoom = true; s._isOffice = true; s._isStandingDesk = true;
      standingDeskRiseParts.push({ mesh: s, baseY: s.position.y });
      addRoom(s);
    }
    // Right screen (rotated, offset along rotated normal)
    {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(monW - 1, monH - 1), screenMat);
      s.rotation.y = Math.PI / 2 - monSideAngle;
      const nx = -Math.cos(monSideAngle), nz = -Math.sin(monSideAngle);
      s.position.set(monSideX + nx * scrOff, monY, deskZ + monSideOff + nz * scrOff);
      s._isRoom = true; s._isOffice = true; s._isStandingDesk = true;
      standingDeskRiseParts.push({ mesh: s, baseY: s.position.y });
      addRoom(s);
    }

    // Keyboard + mouse on desk (toward chair side, -X)
    _trackRise(roomBox(6, 0.4, 16, 0x2a2a2a,
      deskX - 4, deskTopY + deskTopH / 2 + 0.2, deskZ, 0, 0, 0));
    _trackRise(roomBox(3, 0.4, 2.5, 0x2a2a2a,
      deskX - 4, deskTopY + deskTopH / 2 + 0.2, deskZ + 12, 0, 0, 0));

    // ─ Thorzone Nanoq R — SFF PC case on left side of desk ─
    // ~13.4"L × 6.7"W × 9.8"H — long side is depth (X), short side is width (Z)
    const pcD = 13.4, pcW = 6.7, pcH = 9.8;
    const pcSilver = 0xd4d6d9;   // light silver aluminum
    const pcDark = 0x333333;   // dark vent insets
    const pcWood = 0x6b4226;   // walnut wood slats
    const pcX = deskX + deskD / 2 - pcD / 2 - 1;  // pushed near wall edge of desk
    const pcZ = deskZ + monW + 6;
    const pcBaseY = deskTopY + deskTopH / 2;
    const pcCenterY = pcBaseY + pcH / 2;

    // Main body — light silver aluminum shell
    const pcBody = _trackRise(roomBox(pcD, pcH, pcW, pcSilver,
      pcX, pcCenterY, pcZ, 0, 0, 0));
    pcBody._isOffice = true;
    pcBody.material.roughness = 0.28;
    pcBody.material.metalness = 0.75;

    // Top panel — dark perforation inset
    _trackRise(roomBox(pcD - 1, 0.12, pcW - 0.6, pcDark,
      pcX, pcBaseY + pcH - 0.08, pcZ, 0, 0, 0));

    // Long side panels — dark vent insets (±Z faces)
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(pcD - 2, pcH - 2),
        new THREE.MeshStandardMaterial({
          color: pcDark, roughness: 0.7, metalness: 0.15,
        })
      );
      panel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      panel.position.set(pcX, pcCenterY, pcZ + side * (pcW / 2 - 0.05));
      panel._isRoom = true; panel._isOffice = true; panel._isStandingDesk = true;
      standingDeskRiseParts.push({ mesh: panel, baseY: panel.position.y });
      addRoom(panel);
    }

    // Front face — walnut wood vertical slats (faces -X toward chair)
    {
      const slatCount = 4;
      const slatW = 0.5, slatGap = (pcW - 0.8) / slatCount;
      const frontX = pcX - pcD / 2 + 0.05;
      for (let i = 0; i < slatCount; i++) {
        const sz = pcZ - (pcW - 0.8) / 2 + slatGap * (i + 0.5);
        _trackRise(roomBox(0.25, pcH - 2, slatW, pcWood,
          frontX, pcCenterY, sz, 0, 0, 0));
      }
      // Center accent strip
      _trackRise(roomBox(0.12, pcH - 2.5, 0.35, 0xf0f0f0,
        frontX - 0.08, pcCenterY, pcZ, 0, 0, 0));
    }

    // Back face — dark vent panel (exhaust, faces +X)
    {
      const backPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(pcW - 0.8, pcH - 1.5),
        new THREE.MeshStandardMaterial({
          color: pcDark, roughness: 0.7, metalness: 0.15,
        })
      );
      backPanel.position.set(pcX + pcD / 2 - 0.05, pcCenterY, pcZ);
      backPanel._isRoom = true; backPanel._isOffice = true; backPanel._isStandingDesk = true;
      standingDeskRiseParts.push({ mesh: backPanel, baseY: backPanel.position.y });
      addRoom(backPanel);
    }

    // Small feet
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _trackRise(roomBox(1.2, 0.35, 1, 0x999999,
          pcX + sx * (pcD / 2 - 1.2), pcBaseY + 0.18, pcZ + sz * (pcW / 2 - 0.8),
          0, 0, 0));
      }
    }

    // Expose standing-desk handle for click + lerp + collision.
    // World-space (post-mirror) coords: deskX → -deskX, deskZ stays.
    _standingDeskRef = {
      riseParts: standingDeskRiseParts,
      legPosts: standingDeskLegPosts,
      raised: false,
      rise: 0,
      target: 0,
      max: deskRiseMax,
      // Pre-mirror coords (for collision math, which works in pre-mirror).
      deskX, deskZ, deskW, deskD, deskLegH, deskTopH,
      // World-space (post-mirror) desktop top surface; coin uses this.
      getDeskTopWorldY() { return deskTopY + deskTopH / 2 + this.rise; },
    };

    // ── Herman Miller Aeron chair (Size B, Graphite) ──────────────
    // Graphite finish: ENTIRE frame (base, yokes, arms, tilt housing)
    // is matte black plastic — only the gas-lift cylinder shows metal.
    // Pre-mirror, chair sits in front of the desk facing +X. The
    // backrest curves around the user (concave toward +X) using 3
    // angled mesh segments; the iconic Y-frame yoke sits behind it.
    {
      const chairX = deskX - deskD / 2 - 22;        // 22" between desk front and seat center
      const chairZ = deskZ;                          // centered on desk
      const frameBlack   = 0x16181c;                 // graphite frame/base/arms
      const meshGraphite = 0x2c2e32;                 // pellicle mesh
      const aluminum     = 0xb4b7bb;                 // gas-lift cylinder only
      const casterRubber = 0x111114;

      // Aeron Size B-ish proportions — narrower than v1.
      const seatTopY  = floorY + 19;
      const seatThick = 1.6;
      const seatDepth = 17;                          // X axis (front-back)
      const seatWidth = 19;                          // Z axis (side-to-side)
      const backH     = 22;                          // backrest height above seat

      // ─ 5-star black plastic base + casters ─
      const starArmLen = 11;
      const starInnerR = 2.4;
      const baseBottomY = floorY + 2.4;              // top of casters
      const baseTopY = baseBottomY + 1.4;
      const baseMat = new THREE.MeshStandardMaterial({ color: frameBlack, roughness: 0.55, metalness: 0.18 });
      // Hub
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(starInnerR, starInnerR + 0.6, 2.4, 18), baseMat);
      hub.position.set(chairX, baseBottomY + 1.2, chairZ);
      hub.castShadow = true; hub.receiveShadow = true;
      hub._isRoom = true; hub._isOffice = true;
      addRoom(hub);
      // 5 tapered arms at 72° intervals (offset so no arm points along ±X)
      for (let i = 0; i < 5; i++) {
        const ang = i * (Math.PI * 2 / 5) + Math.PI / 5;
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(starArmLen, 1.4, 2.0),
          baseMat.clone()
        );
        arm.position.set(
          chairX + Math.cos(ang) * (starInnerR + starArmLen / 2 - 0.6),
          baseBottomY + 0.7,
          chairZ + Math.sin(ang) * (starInnerR + starArmLen / 2 - 0.6)
        );
        arm.rotation.y = -ang;
        arm.castShadow = true; arm.receiveShadow = true;
        arm._isRoom = true; arm._isOffice = true;
        addRoom(arm);
        // Caster (rubber tire on its side)
        const tipX = chairX + Math.cos(ang) * (starInnerR + starArmLen - 0.4);
        const tipZ = chairZ + Math.sin(ang) * (starInnerR + starArmLen - 0.4);
        const caster = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1, 1.1, 1.4, 12),
          new THREE.MeshStandardMaterial({ color: casterRubber, roughness: 0.6, metalness: 0.2 })
        );
        caster.rotation.x = Math.PI / 2;
        caster.rotation.z = -ang;
        caster.position.set(tipX, floorY + 1.1, tipZ);
        caster.castShadow = true; caster.receiveShadow = true;
        caster._isRoom = true; caster._isOffice = true;
        addRoom(caster);
      }

      // ─ Pneumatic gas-lift cylinder (only visible metal) ─
      const liftBotY = baseTopY;
      const liftTopY = seatTopY - seatThick - 3.2;
      const lift = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 1.0, liftTopY - liftBotY, 14),
        new THREE.MeshStandardMaterial({ color: aluminum, roughness: 0.28, metalness: 0.88 })
      );
      lift.position.set(chairX, (liftBotY + liftTopY) / 2, chairZ);
      lift.castShadow = true; lift.receiveShadow = true;
      lift._isRoom = true; lift._isOffice = true;
      addRoom(lift);

      // ─ Tilt mechanism / control housing — black plastic ─
      const tiltH = 3.2;
      const tiltY = seatTopY - seatThick - tiltH / 2;
      roomBox(seatDepth - 4, tiltH, seatWidth - 6, frameBlack,
        chairX, tiltY, chairZ, 0, 0, 0)._isOffice = true;
      // Forward control levers (small black bumps under the seat front)
      for (const sideL of [-1, 1]) {
        roomBox(2.6, 0.9, 0.9, frameBlack,
          chairX + 4.5, tiltY - 0.4, chairZ + sideL * 4.5, 0, 0, 0)._isOffice = true;
      }

      // ─ Seat pan — curved waterfall via 3 forward-tilting mesh segments ─
      // Black perimeter trim wraps the mesh.
      const seatSegCount = 3;
      const segDX = seatDepth / seatSegCount;
      for (let i = 0; i < seatSegCount; i++) {
        const t = i / (seatSegCount - 1);             // 0=back, 1=front
        const downTilt = t * 0.18;                    // forward droop
        const segCX = chairX - seatDepth / 2 + segDX / 2 + i * segDX;
        const segCY = seatTopY - seatThick / 2 - t * 0.45;
        const seg = roomBox(segDX, seatThick, seatWidth - 0.6, meshGraphite,
          segCX, segCY, chairZ, 0, 0, downTilt);
        seg._isOffice = true;
        seg.material.roughness = 0.92;
      }
      // Seat perimeter — black trim
      const trimT = 0.5;
      // back lip
      roomBox(trimT, seatThick + 0.4, seatWidth + 0.2, frameBlack,
        chairX - seatDepth / 2 + trimT / 2, seatTopY - seatThick / 2, chairZ, 0, 0, 0)._isOffice = true;
      // front lip (drooped, matches waterfall)
      roomBox(trimT * 1.4, seatThick + 0.5, seatWidth + 0.2, frameBlack,
        chairX + seatDepth / 2 - trimT / 2, seatTopY - seatThick / 2 - 0.45, chairZ, 0, 0, 0.18)._isOffice = true;
      // side rails
      for (const sideS of [-1, 1]) {
        roomBox(seatDepth, seatThick + 0.4, trimT, frameBlack,
          chairX, seatTopY - seatThick / 2 - 0.2,
          chairZ + sideS * (seatWidth / 2 + trimT / 2 - 0.3), 0, 0, 0)._isOffice = true;
      }

      // ─ Curved backrest — 3 angled mesh segments (concave toward +X) ─
      const backX = chairX - seatDepth / 2 + 1;
      const backThick = 1.0;
      const backW = seatWidth - 0.6;
      const backCY = seatTopY + backH / 2 + 1;
      const backSegCount = 3;
      const backSegW = backW / backSegCount;
      for (let i = 0; i < backSegCount; i++) {
        const tZ = i - 1;                              // -1, 0, 1
        const segZ = chairZ + tZ * backSegW;
        // Outer segments yaw inward; pushed back so the curve isn't flat.
        const yaw = tZ * 0.18;
        const xOffset = Math.abs(tZ) * 0.7;
        const seg = roomBox(backThick, backH, backSegW + 0.15, meshGraphite,
          backX - xOffset, backCY, segZ, 0, yaw, 0);
        seg._isOffice = true;
        seg.material.roughness = 0.94;
      }

      // ─ Iconic Y-frame yoke (visible from rear) — all black plastic ─
      // Two side rails come up from the bottom yoke and splay outward at
      // the top, joined by a top yoke. A center vertical spine bisects
      // the back, forming the recognizable "Y" silhouette.
      const yokeFront = backThick + 1.0;              // protrudes back from mesh
      const yokeX = backX - backThick / 2 - yokeFront / 2 + 0.2;
      // Bottom yoke
      roomBox(yokeFront, 1.3, backW + 1.6, frameBlack,
        yokeX, seatTopY + 0.7, chairZ, 0, 0, 0)._isOffice = true;
      // Top yoke — slightly wider for the splay
      roomBox(yokeFront, 1.4, backW + 3.2, frameBlack,
        yokeX, seatTopY + backH + 0.8, chairZ, 0, 0, 0)._isOffice = true;
      // Side rails — lower (vertical) + upper (splayed outward)
      for (const sideR of [-1, 1]) {
        const lowerH = backH * 0.5;
        roomBox(yokeFront * 0.8, lowerH, 1.3, frameBlack,
          yokeX + 0.2, seatTopY + 1.4 + lowerH / 2,
          chairZ + sideR * (backW / 2 - 0.6), 0, 0, 0)._isOffice = true;
        const upperH = backH * 0.5;
        const upperZ = chairZ + sideR * (backW / 2 + 1.0);
        roomBox(yokeFront * 0.8, upperH, 1.3, frameBlack,
          yokeX + 0.2, seatTopY + 1.4 + lowerH + upperH / 2 - 1.2,
          upperZ, 0, 0, sideR * -0.06)._isOffice = true;
      }
      // Center vertical spine — the Y-stem
      roomBox(yokeFront * 0.7, backH * 0.55, 1.6, frameBlack,
        yokeX + 0.3, seatTopY + 1.4 + backH * 0.275, chairZ, 0, 0, 0)._isOffice = true;

      // ─ Armrests ─
      // Vertical post + L-bend + horizontal pad. All black.
      const armPostBottomY = seatTopY - seatThick - tiltH;
      const armPadY = seatTopY + 7.5;
      for (const sideA of [-1, 1]) {
        const armZ = chairZ + sideA * (seatWidth / 2 + 1.4);
        // Vertical post — pulled toward back of seat
        roomBox(1.6, armPadY - armPostBottomY, 1.4, frameBlack,
          chairX - 3, (armPostBottomY + armPadY) / 2, armZ, 0, 0, 0)._isOffice = true;
        // L-bend connector
        roomBox(2.4, 1.3, 1.4, frameBlack,
          chairX - 1.8, armPadY - 0.65, armZ, 0, 0, 0)._isOffice = true;
        // Pad
        roomBox(8, 1.0, 2.4, frameBlack,
          chairX, armPadY + 0.5, armZ, 0, 0, 0)._isOffice = true;
      }
    }
  }

  // Book stack — between mug and lamp
  roomBox(5, 1.2, 7, 0x8b4513, tblX - 1, floorY + tblH + 0.6, tblZ + 2, 0, 0.1, 0);
  roomBox(4.5, 0.8, 6.5, 0x2d5a27, tblX - 1, floorY + tblH + 1.6, tblZ + 2, 0, -0.05, 0);

  // ─── Opposite wall + 65" OLED TV ───
  // oppWallZ declared in header
  const oppWall = roomBox(132, 80, 0.5, 0xd8d4ce, -15, floorY + 40, oppWallZ, 0, 0, 0);
  const oppBaseboard = roomBox(132, 3, 0.6, 0xc0bbb4, -15, floorY + 1.5, oppWallZ + 0.5, 0, 0, 0);

  // 65" OLED: diagonal=65", 16:9 → ~56.7"W × 31.9"H, bezel ~0.3", depth ~1"
  const tvW = 56.7, tvH = 31.9, tvD = 1.0, bezel = 0.3;
  const tvCenterX = bedX; // centered on the bed
  const tvCenterY = floorY + 46; // center of screen ~46" from floor
  const tvZ = oppWallZ + 0.5 + tvD / 2 + 1.1; // 1" away from wall

  // Thin black bezel frame
  const tvFrame = roomRoundBox(tvW + bezel * 2, tvH + bezel * 2, tvD, 0.4, 0x111111,
    tvCenterX, tvCenterY, tvZ, 0, 0, 0);
  tvFrame.material.roughness = 0.3;
  tvFrame.material.metalness = 0.6;
  tvFrame._isTV = true;

  // Screen — dark glossy panel, optionally displays an image (pokopia.jpg if present).
  const screenGeo = new THREE.PlaneGeometry(tvW, tvH);
  // No envMap reflection on the screen. The PMREM RoomEnvironment has
  // bright rectangular light-panel planes baked in, and any non-zero
  // envMapIntensity reflected them onto the screen as a phantom "window"
  // shape visible even with all scene lights off. Real TV screens are
  // anti-glare enough that killing IBL reflection entirely is fine here.
  const screenMat = stdMat({ color: 0x0a0a0a, roughness: 0.5, metalness: 0.0, envMapIntensity: 0 });
  screenMat.polygonOffset = true;
  screenMat.polygonOffsetFactor = -2;
  screenMat.polygonOffsetUnits = -2;
  screenMat.depthWrite = false;
  state.tvScreenMat = screenMat;
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(tvCenterX, tvCenterY, tvZ + tvD / 2 + 0.08);
  screen._isRoom = true;
  screen._isTV = true;
  addRoom(screen);
  // Load TV screen image — falls back silently to dark glass if file is missing.
  new THREE.TextureLoader().load(
    'img/pokopia.jpg',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, (state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 4));
      screen.material.map = tex;
      screen.material.emissiveMap = tex;
      screen.material.emissive = new THREE.Color(0xffffff);
      screen.material.emissiveIntensity = 0.85;
      // Remember the "TV on" emissive level so lighting.js can fade the
      // screen out when the room goes dark (TV screens don't emit light
      // unless they're actually on).
      screen.material.userData._tvOnEmissive = 0.85;
      screen.material.color = new THREE.Color(0x000000);
      screen.material.roughness = 0.4;
      screen.material.needsUpdate = true;
    },
    undefined,
    () => { /* no-op if missing */ }
  );

  // Small bottom-center power nub (trapezoid pod + tiny center button).
  // TV ambient glow — washes the bed and floor in front of the TV.
  // Positioned well in front of the screen so it reaches the bed area.
  const tvGlow = new THREE.PointLight(0x6688cc, 50, 80, 0.9);
  tvGlow.position.set(tvCenterX, tvCenterY, tvZ + tvD / 2 + 12);
  tvGlow.castShadow = false;
  tvGlow._isRoom = true;
  state.tvGlow = tvGlow;
  addRoom(tvGlow);
  {
    const nubGroup = new THREE.Group();
    nubGroup.position.set(tvCenterX, tvCenterY - (tvH + bezel * 2) / 2 - 0.24, tvZ + tvD / 2 - 0.06);
    nubGroup._isRoom = true;

    const nubWTop = 2.25;
    const nubWBot = 1.55;
    const nubH = 0.4;
    const nubD = 0.12;
    const nubShape = new THREE.Shape();
    nubShape.moveTo(-nubWTop / 2, nubH / 2);
    nubShape.lineTo(nubWTop / 2, nubH / 2);
    nubShape.lineTo(nubWBot / 2, -nubH / 2);
    nubShape.lineTo(-nubWBot / 2, -nubH / 2);
    nubShape.lineTo(-nubWTop / 2, nubH / 2);
    const nubGeo = new THREE.ExtrudeGeometry(nubShape, { depth: nubD, bevelEnabled: false });
    nubGeo.translate(0, 0, -nubD / 2);
    const nubMat = stdMat({ color: 0xaeb4bd, roughness: 0.28, metalness: 0.55 });
    const nubMesh = new THREE.Mesh(nubGeo, nubMat);
    nubMesh.castShadow = false;
    nubMesh.receiveShadow = true;
    nubGroup.add(nubMesh);

    const btnMat = stdMat({ color: 0x8c929b, roughness: 0.3, metalness: 0.4 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.045, 18), btnMat);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, -0.02, nubD / 2 + 0.01);
    nubGroup.add(btn);

    const btnDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 16),
      new THREE.MeshBasicMaterial({ color: 0xdadada, transparent: true, opacity: 0.85 })
    );
    btnDot.position.set(0, -0.02, nubD / 2 + 0.028);
    nubGroup.add(btnDot);

    addRoom(nubGroup);
  }

  // ─── Mini split indoor unit (on TV wall, near closet wall, 1ft from ceiling) ───
  const msW = 32, msH = 11, msD = 8; // typical wall-mount unit dimensions
  const msX = 51 - 18 - msW / 2; // 1.5 feet gap from closet wall to edge of unit (before flip)
  const msY = floorY + 80 - 12 - msH / 2; // 1 foot from ceiling
  const msZ = oppWallZ + 0.5 + msD / 2; // flush against TV wall
  // Mini-split state — toggled via the click handler in purifier.js.
  // The unit starts OFF; turning it on spawns a cheap horizontal air
  // stream (Points cloud) and unlocks the secret coin out front. The
  // run-reset path (purifier.resetWorld) calls resetMiniSplit() to
  // bring it back to the off state for the next run.
  let _miniSplitOn = false;
  let _miniSplitLedMat = null;
  // World-space (post-mirror) anchors for the air-stream emitter.
  // Computed once below so the particle tick doesn't redo this each frame.
  const _msVentWorldX = -msX;                      // X-mirror flips msX
  const _msVentWorldY = msY - msH / 2 + 1.7;       // mid of louver stack
  const _msVentWorldZ = msZ + msD / 2 + 0.16;      // just in front of vent face
  const _msVentWidth  = msW - 8;                   // emit across vent width
  let _miniSplitAirPoints = null;
  let _miniSplitAirData = null;
  let _msAirSpriteTex = null;
  // Tight proximity-based fan loop. Built lazily on first turn-on so
  // an unused unit costs no audio. Gain is driven per-frame from the
  // camera→vent distance in updateMiniSplit() — falls off fast so you
  // barely hear it across the room and not at all in the hallway.
  let _msFanSrc = null;
  let _msFanGain = null;
  let _msFanFilter = null;
  let _msFanNoiseBuf = null;
  const _tmpCamPos = new THREE.Vector3();
  {
    const msMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.05 });
    // Main body — rounded rectangle
    const msBody = roomRoundBox(msW, msH, msD, 2, 0xf0f0f0, msX, msY, msZ, 0, 0, 0);
    msBody.material.roughness = 0.3;
    msBody.material.metalness = 0.05;
    msBody._isMiniSplit = true;
    // Bottom air vent — darker slit
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
    const vent = new THREE.Mesh(new THREE.BoxGeometry(msW - 4, 1.5, 0.3), ventMat);
    vent.position.set(msX, msY - msH / 2 + 2, msZ + msD / 2 + 0.16);
    vent._isRoom = true; vent._isMiniSplit = true; addRoom(vent);
    // Horizontal louver lines on the vent
    for (let i = 0; i < 3; i++) {
      const louver = new THREE.Mesh(new THREE.BoxGeometry(msW - 6, 0.15, 0.4), msMat);
      louver.position.set(msX, msY - msH / 2 + 1.2 + i * 0.5, msZ + msD / 2 + 0.2);
      louver._isRoom = true; louver._isMiniSplit = true; addRoom(louver);
    }
    // Small LED indicator dot — starts dim/red-ish; setMiniSplitOn() recolors it.
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x551111, emissive: 0x330000, emissiveIntensity: 0.25,
      roughness: 0.4, metalness: 0.1
    });
    _miniSplitLedMat = ledMat;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), ledMat);
    led.position.set(msX + msW / 2 - 3, msY - msH / 2 + 3, msZ + msD / 2 + 0.16);
    led._isRoom = true; led._isMiniSplit = true; addRoom(led);
    // Brand logo area (subtle lighter rectangle)
    const logoArea = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.2 }));
    logoArea.position.set(msX, msY + msH / 2 - 3, msZ + msD / 2 + 0.06);
    logoArea._isRoom = true; logoArea._isMiniSplit = true; addRoom(logoArea);
  }

  // ── Mini-split air stream (cheap horizontal Points cloud) ──────────
  // Built lazily on first turn-on so an unused unit costs nothing. The
  // Points object is added directly to the scene (not _isRoom) so its
  // positions are in post-mirror world coords and the X-mirror pass
  // doesn't double-flip them.
  function _ensureMiniSplitAir() {
    if (_miniSplitAirPoints) return;
    // More, smaller, softer dots reads as drifting air rather than
    // tracer pellets. Square sprites look digital — a tiny radial
    // alpha texture rounds them off and gives a gentle haze.
    const N = 80;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) positions[i] = 1e6; // park offscreen until first tick
    const data = new Array(N);
    for (let i = 0; i < N; i++) {
      // age >= life forces a respawn on the first updateMiniSplit() tick.
      data[i] = { age: 1, life: 0, vx: 0, vy: 0, vz: 0 };
    }
    if (!_msAirSpriteTex) {
      const s = 64;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const cx = c.getContext('2d');
      const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      g.addColorStop(1.0, 'rgba(255,255,255,0)');
      cx.fillStyle = g;
      cx.fillRect(0, 0, s, s);
      _msAirSpriteTex = new THREE.CanvasTexture(c);
      _msAirSpriteTex.colorSpace = THREE.SRGBColorSpace;
      _msAirSpriteTex.needsUpdate = true;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.7,
      map: _msAirSpriteTex,
      color: 0xeaf2ff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    _miniSplitAirPoints = pts;
    _miniSplitAirData = data;
  }

  // ── Fan loop SFX (proximity-driven) ────────────────────────────────
  // Looping low-passed noise → "low fan hum". Volume is driven each
  // frame from camera→vent distance, so it's noticeable up close,
  // barely audible at the far side of the room, and inaudible outside.
  function _startMsFanLoop() {
    const ac = getAudioCtx();
    if (!ac || _msFanSrc) return;
    if (!_msFanNoiseBuf) {
      // ~2s of white noise looped is plenty — at heavy lowpass nobody
      // can hear the seam.
      const len = Math.floor(ac.sampleRate * 2);
      _msFanNoiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = _msFanNoiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = _msFanNoiseBuf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;   // muffled, "behind a vent" character
    lp.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.value = 0.0001;       // ramped up by updateMiniSplit()
    src.connect(lp).connect(g).connect(ac.destination);
    src.start();
    _msFanSrc = src;
    _msFanFilter = lp;
    _msFanGain = g;
  }

  function _stopMsFanLoop() {
    const ac = getAudioCtx();
    if (!ac || !_msFanSrc) return;
    const now = ac.currentTime;
    try {
      _msFanGain.gain.cancelScheduledValues(now);
      _msFanGain.gain.setValueAtTime(_msFanGain.gain.value, now);
      _msFanGain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
    } catch (e) { }
    const src = _msFanSrc;
    setTimeout(() => { try { src.stop(); src.disconnect(); } catch (e) { } }, 320);
    _msFanSrc = null;
    _msFanFilter = null;
    _msFanGain = null;
  }

  // Turn unit on/off. Returns the new state.
  function setMiniSplitOn(on) {
    _miniSplitOn = !!on;
    if (_miniSplitLedMat) {
      if (_miniSplitOn) {
        _miniSplitLedMat.color.setHex(0x33ff66);
        _miniSplitLedMat.emissive.setHex(0x33ff66);
        _miniSplitLedMat.emissiveIntensity = 1.6;
      } else {
        _miniSplitLedMat.color.setHex(0x551111);
        _miniSplitLedMat.emissive.setHex(0x330000);
        _miniSplitLedMat.emissiveIntensity = 0.25;
      }
    }
    if (_miniSplitOn) {
      _ensureMiniSplitAir();
      if (_miniSplitAirPoints) _miniSplitAirPoints.visible = true;
      _startMsFanLoop();
    } else if (_miniSplitAirPoints) {
      _miniSplitAirPoints.visible = false;
      _stopMsFanLoop();
    } else {
      _stopMsFanLoop();
    }
    return _miniSplitOn;
  }

  function isMiniSplitOn() { return _miniSplitOn; }

  // Per-frame particle tick. No-op when off or never-built.
  function updateMiniSplit(dt, camera) {
    // Drive fan-loop volume from camera→vent distance, even after
    // setMiniSplitOn(false) ramped down (so a cleanup tick can finish
    // the fade if it's still alive).
    if (_msFanGain && camera) {
      const ac = getAudioCtx();
      if (ac) {
        // Distance from camera to vent face in inches (room units).
        const dx = camera.position.x - _msVentWorldX;
        const dy = camera.position.y - _msVentWorldY;
        const dz = camera.position.z - _msVentWorldZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // Sharp falloff but still audible across the room: full at
        // ~24" from the vent, ~half at 60", quiet but present down at
        // floor level (~70" away when standing under it), inaudible
        // past ~220" (out of the room).
        const NEAR = 24;
        const FAR = 220;
        let vol = 0;
        if (_miniSplitOn && !sfxMuted && dist < FAR) {
          const k = NEAR / Math.max(NEAR, dist);
          // Linear-ish (k instead of k*k) keeps it from collapsing to
          // nothing once you're more than a couple feet away.
          vol = 0.10 * k * (1 - dist / FAR);
          if (vol < 0) vol = 0;
        }
        const now = ac.currentTime;
        const cur = _msFanGain.gain.value;
        // Tiny per-frame ramp so motion doesn't zipper the gain.
        try {
          _msFanGain.gain.cancelScheduledValues(now);
          _msFanGain.gain.setValueAtTime(Math.max(0.0001, cur), now);
          _msFanGain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), now + 0.08);
        } catch (e) { }
      }
    }

    if (!_miniSplitOn || !_miniSplitAirPoints || !_miniSplitAirData) return;
    const arr = _miniSplitAirPoints.geometry.attributes.position.array;
    const data = _miniSplitAirData;
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      p.age += dt;
      const k = i * 3;
      if (p.age >= p.life) {
        // Respawn at the vent face, jittered across width + tiny depth/height.
        arr[k    ] = _msVentWorldX + (Math.random() - 0.5) * _msVentWidth;
        arr[k + 1] = _msVentWorldY + (Math.random() - 0.5) * 1.4;
        arr[k + 2] = _msVentWorldZ + (Math.random() - 0.5) * 0.4;
        // Forward (+Z) push, slight downward droop, tiny side spread.
        p.vx = (Math.random() - 0.5) * 1.5;
        p.vy = -1.0 - Math.random() * 1.4;
        p.vz = 14 + Math.random() * 7;
        p.age = 0;
        p.life = 1.6 + Math.random() * 1.0;
        continue;
      }
      arr[k    ] += p.vx * dt;
      arr[k + 1] += p.vy * dt;
      arr[k + 2] += p.vz * dt;
    }
    _miniSplitAirPoints.geometry.attributes.position.needsUpdate = true;
  }

  function resetMiniSplit() { if (_miniSplitOn) setMiniSplitOn(false); }

  // ─── Cat food feeder on black shoe box (TV wall / closet corner) ────
  let _foodGroup = null;
  let _foodBowlMesh = null;
  {
    // Placement: between TV wall and closet opening, ~1.5ft from closet wall.
    // Pre-mirror coords: sideWallX=51, oppWallZ=-78, closet edge at Z=-70.
    const boxCenterX = 28;    // box center
    const feederZ = -74;      // Z position for everything

    // ── Black shoe box (platform) ──
    const boxW = 24, boxH = 5, boxD = 16;
    const boxY = floorY + boxH / 2;
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.02 });
    const shoeBox = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), boxMat);
    shoeBox.position.set(boxCenterX, boxY, feederZ);
    shoeBox.castShadow = true; shoeBox.receiveShadow = true;
    addRoom(shoeBox);

    // ── WOpet-style automatic cat feeder (offset toward closet = "left" in world) ──
    const topOfBox = floorY + boxH;
    const feederX = boxCenterX + 6; // shifted toward closet side

    // Main body — white rounded cylinder with an actual cutout for the
    // food chute. Built as three stacked pieces so the middle section can
    // have an arc-gap (thetaLength < 2π) carved out of it:
    //
    //   top ring   — full 360°, above the chute
    //   mid ring   — 360° minus chuteArc, centered on the front (+Z)
    //   bottom ring — full 360°, below the chute
    //
    // The gap geometry is wrapped by a dark interior so you see *into*
    // the opening rather than at the transparent back of the cylinder.
    const bodyR = 4.2;       // top radius
    const bodyBotR = bodyR + 0.3; // bottom radius (taper)
    const bodyH = 8;
    const bodyY = topOfBox + bodyH / 2;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.35, metalness: 0.05 });

    // Chute geometry — defined here because the body sections depend on it
    const chuteW = 3.2;
    const chuteH = 1.8;
    const midR = (bodyR + bodyBotR) / 2;
    const chuteArc = chuteW / midR; // radians
    const trayTopY = topOfBox + 1.6;
    const chuteY = trayTopY + 0.15 + chuteH / 2;
    const chuteBotY = chuteY - chuteH / 2;
    const chuteTopY = chuteY + chuteH / 2;
    const bodyRAt = y => {
      const t = (y - topOfBox) / bodyH; // 0=bottom, 1=top
      return bodyBotR + (bodyR - bodyBotR) * t;
    };
    const rAtChuteTop = bodyRAt(chuteTopY);
    const rAtChuteBot = bodyRAt(chuteBotY);

    // ── Bowl cutout geometry — the food bowl (radius ibR ≈ 3.1, centered
    // ~5.7 in front of feeder center) clips into the front of the lower
    // body. Carve an arc-gap on the +Z face of the lower body so the bowl
    // nests into a real recess instead of intersecting solid plastic.
    //
    // Match the chute's split pattern: short full-360° sliver below the
    // bowl, then an arc-gap section from bowl bottom up to chute bottom.
    const bowlHoleR = 3.15;               // slight margin around bowl rim (ibR=3.1)
    const bowlBottomLocalY = topOfBox + 0.4; // below bowl's lowest point
    // Gap arc width — chord of (bowlHoleR) inscribed in the cylinder at
    // the narrowest (top) point of the gap section.
    const bowlArc = 2 * Math.asin(Math.min(0.99, bowlHoleR / rAtChuteBot));
    const rAtBowlBot = bodyRAt(bowlBottomLocalY);

    // ── Body piece 1a: sliver below the bowl (full 360°) ──
    const lower1H = bowlBottomLocalY - topOfBox;
    if (lower1H > 0.01) {
      const l1Geo = new THREE.CylinderGeometry(rAtBowlBot, bodyBotR, lower1H, 32);
      const l1 = new THREE.Mesh(l1Geo, bodyMat);
      l1.position.set(feederX, topOfBox + lower1H / 2, feederZ);
      l1.castShadow = true; l1.receiveShadow = true;
      l1._isFoodBowl = true;
      addRoom(l1);
    }

    // ── Body piece 1b: bowl-cutout ring (arc with gap at +Z front) ──
    // three.js CylinderGeometry: theta=0 points at +Z (x=r·sinθ, z=r·cosθ).
    // So the +Z front is at theta=0, and we center the gap there.
    const lower2H = chuteBotY - bowlBottomLocalY;
    const lower2Geo = new THREE.CylinderGeometry(
      rAtChuteBot, rAtBowlBot, lower2H, 32, 1, false,
      bowlArc / 2, 2 * Math.PI - bowlArc
    );
    const lower2Body = new THREE.Mesh(lower2Geo, bodyMat);
    lower2Body.position.set(feederX, bowlBottomLocalY + lower2H / 2, feederZ);
    lower2Body.castShadow = true; lower2Body.receiveShadow = true;
    lower2Body._isFoodBowl = true;
    addRoom(lower2Body);

    // ── Body piece 2: the chute ring (arc with gap at +Z front) ──
    // three.js CylinderGeometry: theta=0 points at +Z (x=r·sinθ, z=r·cosθ).
    // We want a gap centered on +Z (theta=0) spanning chuteArc. So the
    // remaining arc starts at chuteArc/2 and spans 2π - chuteArc.
    const midH = chuteTopY - chuteBotY; // = chuteH
    const midGeo = new THREE.CylinderGeometry(
      rAtChuteTop, rAtChuteBot, midH, 32, 1, false,
      chuteArc / 2, 2 * Math.PI - chuteArc
    );
    const midBody = new THREE.Mesh(midGeo, bodyMat);
    midBody.position.set(feederX, chuteBotY + midH / 2, feederZ);
    midBody.castShadow = true; midBody.receiveShadow = true;
    midBody._isFoodBowl = true;
    addRoom(midBody);

    // ── Body piece 3: above the chute (full 360°) ──
    const upperH = (topOfBox + bodyH) - chuteTopY;
    const upperGeo = new THREE.CylinderGeometry(bodyR, rAtChuteTop, upperH, 32);
    const upperBody = new THREE.Mesh(upperGeo, bodyMat);
    upperBody.position.set(feederX, chuteTopY + upperH / 2, feederZ);
    upperBody.castShadow = true; upperBody.receiveShadow = true;
    upperBody._isFoodBowl = true;
    addRoom(upperBody);

    // ── Chute interior — a dark curved backing wall *inside* the gap so
    // looking at the opening you see recessed darkness, not empty space. ──
    const chuteDarkMat = new THREE.MeshStandardMaterial({
      color: 0x080808, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide
    });
    // Smaller-radius arc that mirrors the gap, sitting behind the opening
    const interiorR = rAtChuteBot - 0.6;
    const interiorGeo = new THREE.CylinderGeometry(
      interiorR, interiorR, chuteH + 0.1, 24, 1, true,
      -chuteArc / 2, chuteArc
    );
    const chuteInterior = new THREE.Mesh(interiorGeo, chuteDarkMat);
    chuteInterior.position.set(feederX, chuteY, feederZ);
    chuteInterior._isFoodBowl = true;
    addRoom(chuteInterior);
    // Dark top cap of the opening — the overhang the food drops from
    // RingGeometry: x=r·cosθ, y=r·sinθ. This mesh is rotated by rotation.x=+π/2
    // which maps local y → world z, so world +Z corresponds to θ=+π/2. Center
    // the ring arc at +π/2 to sit over the +Z front gap.
    const overhangGeo = new THREE.RingGeometry(interiorR - 0.05, rAtChuteTop, 24, 1,
      Math.PI / 2 - chuteArc / 2, chuteArc);
    const chuteOverhang = new THREE.Mesh(overhangGeo, chuteDarkMat);
    chuteOverhang.rotation.x = Math.PI / 2;
    chuteOverhang.position.set(feederX, chuteTopY - 0.01, feederZ);
    chuteOverhang._isFoodBowl = true;
    addRoom(chuteOverhang);
    // Dark bottom cap of the opening
    // This mesh is rotated by rotation.x=-π/2 which maps local y → world -z,
    // so world +Z corresponds to θ=-π/2. Center the arc at -π/2.
    const floorGeo = new THREE.RingGeometry(interiorR - 0.05, rAtChuteBot, 24, 1,
      -Math.PI / 2 - chuteArc / 2, chuteArc);
    const chuteFloor = new THREE.Mesh(floorGeo, chuteDarkMat);
    chuteFloor.rotation.x = -Math.PI / 2;
    chuteFloor.position.set(feederX, chuteBotY + 0.01, feederZ);
    chuteFloor._isFoodBowl = true;
    addRoom(chuteFloor);

    // Hopper — smoked translucent cylinder. Color is dark gray (not brown);
    // the kibble inside tints the overall look warm.
    // Bottom radius matches body top radius (bodyR) so the joint is flush
    // with no white body-cap poking through the translucent wall. Overlaps
    // the body by a small amount to hide any seam at the meeting line.
    const hopperR = bodyR;           // 4.2, matches body top
    const hopperTopR = bodyR - 0.25; // tapers slightly inward
    const hopperH = 6;
    const hopperOverlap = 0.2;
    const hopperY = topOfBox + bodyH + hopperH / 2 - hopperOverlap;
    const hopperMat = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.1, metalness: 0.0,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      depthWrite: false
    });
    const hopper = new THREE.Mesh(
      new THREE.CylinderGeometry(hopperTopR, hopperR, hopperH, 32, 1, true),
      hopperMat
    );
    hopper.position.set(feederX, hopperY, feederZ);
    hopper.renderOrder = 1; // draw after opaque body/kibble
    hopper._isFoodBowl = true;
    addRoom(hopper);

    // Hopper lid — dark gray, matches hopper color, sits flush on top
    const lidH = 0.6;
    const lidMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a, roughness: 0.25, metalness: 0.02,
      transparent: true, opacity: 0.75
    });
    const lidBotR = hopperTopR;       // flush with hopper top rim
    const lidTopR = hopperTopR - 0.1;
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(lidTopR, lidBotR, lidH, 32),
      lidMat
    );
    lid.position.set(feederX, hopperY + hopperH / 2 + lidH / 2 - 0.05, feederZ);
    lid._isFoodBowl = true;
    addRoom(lid);
    // Lid knob
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.3 }));
    knob.position.set(feederX, hopperY + hopperH / 2 + lidH + 0.3, feederZ);
    knob._isFoodBowl = true;
    addRoom(knob);

    // Kibble pile — solid base (filled cone) + surface spheres on top for
    // texture. The base ensures the food reads as a dense mass, not
    // floating individual pellets.
    const kibbleMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9, metalness: 0.0 });
    const hopperBottomY = topOfBox + bodyH - hopperOverlap;
    const pileH = hopperH * 0.55; // fill ~55% of the hopper
    const pileBaseR = hopperR - 0.25; // fills almost to the glass wall
    const pileTopR = pileBaseR * 0.45; // cone taper at the top

    // Solid pile base — one opaque cone/cylinder of kibble material. This
    // is what makes the food look like a solid mass instead of floating
    // spheres with gaps.
    const pileGeo = new THREE.CylinderGeometry(pileTopR, pileBaseR, pileH, 24);
    const pileMesh = new THREE.Mesh(pileGeo, kibbleMat);
    pileMesh.position.set(feederX, hopperBottomY + pileH / 2 + 0.05, feederZ);
    pileMesh._isFoodBowl = true;
    addRoom(pileMesh);

    // Surface-layer spheres — only sit on/near the pile's outer surface
    // to give the illusion of individual kibble shapes without wasting
    // geometry on hidden interior pellets.
    const surfaceKibble = 160;
    for (let i = 0; i < surfaceKibble; i++) {
      // t biases slightly upward so the top of the pile is well-covered
      const t = Math.pow(Math.random(), 0.85); // 0=bottom, 1=top
      const ky = hopperBottomY + 0.08 + t * pileH;
      // Cone surface radius at this height, plus small jitter outward
      const surfR = pileBaseR + (pileTopR - pileBaseR) * t;
      const rad = surfR + (Math.random() * 0.3 - 0.05);
      const ang = Math.random() * Math.PI * 2;
      const kx = feederX + Math.cos(ang) * rad;
      const kz = feederZ + Math.sin(ang) * rad;
      const kSize = 0.22 + Math.random() * 0.13;
      const kibble = new THREE.Mesh(new THREE.SphereGeometry(kSize, 6, 4), kibbleMat);
      kibble.position.set(kx, ky, kz);
      kibble._isFoodBowl = true;
      addRoom(kibble);
    }
    // Extra cluster right at the top of the pile (cone tip) so it looks
    // like the mound peaks rather than flat-tops abruptly.
    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * (pileTopR + 0.1);
      const kx = feederX + Math.cos(ang) * rad;
      const kz = feederZ + Math.sin(ang) * rad;
      const ky = hopperBottomY + pileH + 0.05 + Math.random() * 0.25;
      const kSize = 0.22 + Math.random() * 0.13;
      const kibble = new THREE.Mesh(new THREE.SphereGeometry(kSize, 6, 4), kibbleMat);
      kibble.position.set(kx, ky, kz);
      kibble._isFoodBowl = true;
      addRoom(kibble);
    }

    // Front panel — black display area (faces +Z in pre-mirror → faces -Z in world)
    const panelW = 3.5, panelH = 3, panelD = 0.15;
    const panelY = bodyY + bodyH / 2 - panelH / 2 - 1.5;
    const panelZ = feederZ + bodyR + 0.1;
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.1 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, panelH, panelD), panelMat);
    panel.position.set(feederX, panelY, panelZ);
    panel._isFoodBowl = true;
    addRoom(panel);

    // Blue LED status bar on the panel
    const ledBarMat = new THREE.MeshStandardMaterial({ color: 0x2288ff, emissive: 0x2288ff, emissiveIntensity: 0.6, roughness: 0.2 });
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 0.05), ledBarMat);
    ledBar.position.set(feederX, panelY + 0.5, panelZ + panelD / 2 + 0.03);
    ledBar._isFoodBowl = true;
    addRoom(ledBar);

    // Two round buttons — placed ON the display panel (bottom edge), like a
    // real WOpet feeder. Previously placed below the panel where they
    // landed directly on top of the food chute and read as "two white
    // dots on a black rectangle".
    const btnMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.3, metalness: 0.05 });
    for (let bi = -1; bi <= 1; bi += 2) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), btnMat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(feederX + bi * 0.7, panelY - panelH / 2 + 0.5, panelZ + panelD / 2 + 0.04);
      btn._isFoodBowl = true;
      addRoom(btn);
    }

    // "wopet" brand text area — small lighter rectangle on hopper front
    const brandArea = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xff6633, emissive: 0xff6633, emissiveIntensity: 0.15, roughness: 0.3 }));
    brandArea.position.set(feederX, hopperY - 0.5, feederZ + hopperR + 0.05);
    brandArea._isFoodBowl = true;
    addRoom(brandArea);

    // (Chute cutout is built up-front with the body — the body is three
    // stacked pieces with an arc-gap in the middle section, backed by a
    // dark interior. No separate overlay needed here.)

    // Food tray — rounded rectangle with very rounded edges, bowl in the middle,
    // embedded into the feeder body (~2.5" overlap)
    const trayW = 8, trayD = 7, trayH = 1.6, trayCornerR = 2.5;
    const embedDepth = 2.5; // how far back the tray tucks into the body
    const trayZ = feederZ + bodyR + trayD / 2 + 0.5 - embedDepth;
    const trayMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4, metalness: 0.05 });

    // Inner bowl dimensions (used for both the hole and the bowl mesh).
    // Bowl is sized to nearly fill the tray (trayD=7 → radius 3.1 leaves
    // ~0.4 of tray lip front/back) and centered on the tray rather than
    // pushed forward, so it visually fits the cutout instead of hanging
    // off the front edge.
    const ibR = 3.1, ibDepth = 1.1, ibWall = 0.2;
    const bowlOffsetZ = 0;

    // Rounded rectangle shape for the base tray — with circular hole for bowl
    const trayShape = new THREE.Shape();
    const tw2 = trayW / 2, td2 = trayD / 2, cr = Math.min(trayCornerR, tw2, td2);
    trayShape.moveTo(-tw2 + cr, -td2);
    trayShape.lineTo(tw2 - cr, -td2);
    trayShape.quadraticCurveTo(tw2, -td2, tw2, -td2 + cr);
    trayShape.lineTo(tw2, td2 - cr);
    trayShape.quadraticCurveTo(tw2, td2, tw2 - cr, td2);
    trayShape.lineTo(-tw2 + cr, td2);
    trayShape.quadraticCurveTo(-tw2, td2, -tw2, td2 - cr);
    trayShape.lineTo(-tw2, -td2 + cr);
    trayShape.quadraticCurveTo(-tw2, -td2, -tw2 + cr, -td2);

    // Punch a circular hole where the bowl sits.
    // Shape is in local XY; the tray is extruded along +Z then rotated
    // -90° around X, which maps shape-Y → world -Z. So to put the hole at
    // world (trayZ + bowlOffsetZ) we must use shape-Y = -bowlOffsetZ.
    const holePath = new THREE.Path();
    const holeSegs = 32;
    for (let i = 0; i <= holeSegs; i++) {
      const a = (i / holeSegs) * Math.PI * 2;
      const hx = Math.cos(a) * (ibR + 0.05);
      const hy = -bowlOffsetZ + Math.sin(a) * (ibR + 0.05);
      if (i === 0) holePath.moveTo(hx, hy);
      else holePath.lineTo(hx, hy);
    }
    trayShape.holes.push(holePath);

    const trayGeo = new THREE.ExtrudeGeometry(trayShape, {
      depth: trayH, bevelEnabled: true, bevelThickness: 0.15,
      bevelSize: 0.15, bevelSegments: 4
    });
    trayGeo.rotateX(-Math.PI / 2); // lay flat
    const trayMesh = new THREE.Mesh(trayGeo, trayMat);
    trayMesh.position.set(feederX, topOfBox, trayZ);
    trayMesh.castShadow = true; trayMesh.receiveShadow = true;
    addRoom(trayMesh);

    // Inner bowl (hollow, sits in the hole we punched in the tray)
    const ibMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.35, metalness: 0.08, side: THREE.DoubleSide });
    const ibPts = [
      new THREE.Vector2(0.01, -ibDepth),
      new THREE.Vector2(ibR * 0.3, -ibDepth),
      new THREE.Vector2(ibR * 0.7, -ibDepth + 0.15),
      new THREE.Vector2(ibR, 0),
      new THREE.Vector2(ibR + 0.1, 0.05),
      new THREE.Vector2(ibR + 0.1, 0.12),
      new THREE.Vector2(ibR - ibWall, 0.12),
      new THREE.Vector2(ibR - ibWall, 0),
      new THREE.Vector2((ibR - ibWall) * 0.7, -ibDepth + ibWall + 0.15),
      new THREE.Vector2((ibR - ibWall) * 0.3, -(ibDepth - ibWall)),
      new THREE.Vector2(0.01, -(ibDepth - ibWall)),
    ];
    const ibGeo = new THREE.LatheGeometry(ibPts, 32);
    const innerBowl = new THREE.Mesh(ibGeo, ibMat);
    innerBowl.position.set(feederX, topOfBox + trayH + 0.01, trayZ + bowlOffsetZ);
    innerBowl.castShadow = true; innerBowl.receiveShadow = true;
    addRoom(innerBowl);

    // Invisible hitboxes — tight-fitting to the feeder silhouette so the
    // hover pointer matches the visible shape (not a giant invisible cube).
    // Uses transparent opacity:0 instead of material.visible=false — this is
    // the canonical Three.js pattern for raycast-only meshes. (`visible:false`
    // on the material can cause some pipelines to skip the mesh entirely; an
    // opacity-0 mesh always raycasts while rendering nothing.)
    const hbMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
    });

    // 1) (Shoe box base is intentionally not clickable — only the feeder is.)

    // 2) Feeder tower — cylinder covering body + hopper + lid + knob
    const towerH = bodyH + hopperH + 1.6; // body + hopper + lid+knob headroom
    const towerR = Math.max(bodyR, hopperR) + 0.3;
    const hbTower = new THREE.Mesh(
      new THREE.CylinderGeometry(towerR, towerR + 0.2, towerH, 16),
      hbMat
    );
    hbTower.position.set(feederX, topOfBox + towerH / 2, feederZ);
    hbTower._isFoodBowl = true;
    addRoom(hbTower);

    // 3) (Front tray + bowl is intentionally not clickable — only the feeder is.)

    // Food kibble — hidden by default, toggled on click.
    // Each kibble is a regular _isRoom mesh so it goes through the mirror pass
    // and matrix freeze like everything else. No coordinate juggling needed.
    // bowlCenterZ shifts kibble to center of the visible bowl
    const bowlCenterZ = trayZ + bowlOffsetZ;
    const _foodKibbles = [];
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * (ibR - 0.5);
      const kx = feederX + Math.cos(ang) * rad;
      const kz = bowlCenterZ + Math.sin(ang) * rad;
      // Place kibble inside the bowl depression
      const ky = topOfBox + trayH + 0.01 + (-ibDepth + ibWall + 0.2 + Math.random() * 0.6);
      const kSize = 0.22 + Math.random() * 0.15;
      const k = new THREE.Mesh(new THREE.SphereGeometry(kSize, 5, 4), kibbleMat);
      k.position.set(kx, ky, kz);
      k.visible = false;
      addRoom(k);
      _foodKibbles.push(k);
    }
    _foodGroup = _foodKibbles; // store array reference

    // ── Stainless steel water bowl (right / window side of box) ──
    const bowlX = boxCenterX - 6; // toward window ("right" in world)
    const bowlR = 3.2, bowlH = 1.2, bowlWall = 0.2, bowlLipW = 0.4, bowlLipH = 0.2;
    // Mirror-polished stainless: max metalness, near-zero roughness, and a
    // clearcoat layer on top of the env-mapped metal base for that "wet
    // chrome" sheen. MeshPhysicalMaterial extends MeshStandardMaterial so
    // envMap/envMapIntensity still apply via the stdMat pipeline.
    const bowlEnv = state.envMap || window._roomEnvMap;
    const bowlMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.05,
      envMap: bowlEnv || null,
      envMapIntensity: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
    });
    // Cylindrical bowl with 90° edges — straight walls, flat bottom, lip on top
    const bowlPts = [
      new THREE.Vector2(0.01, -bowlH),              // center bottom (outer)
      new THREE.Vector2(bowlR, -bowlH),              // bottom outer edge
      new THREE.Vector2(bowlR, 0),                    // wall top (sharp 90°)
      new THREE.Vector2(bowlR + bowlLipW, 0),         // lip extends outward
      new THREE.Vector2(bowlR + bowlLipW, bowlLipH),  // lip top outer
      new THREE.Vector2(bowlR - bowlWall, bowlLipH),  // lip top inner
      new THREE.Vector2(bowlR - bowlWall, 0.01),      // inner wall top
      new THREE.Vector2(bowlR - bowlWall, -(bowlH - bowlWall)), // inner wall bottom
      new THREE.Vector2(0.01, -(bowlH - bowlWall)),   // inner floor center
    ];
    const bowlGeo = new THREE.LatheGeometry(bowlPts, 32);
    const bowlMesh = new THREE.Mesh(bowlGeo, bowlMat);
    bowlMesh.position.set(bowlX, topOfBox + bowlH, feederZ);
    bowlMesh.castShadow = true; bowlMesh.receiveShadow = true;
    addRoom(bowlMesh);
    // Anchor the secret blue coin to the stainless water bowl (sits next to
    // the food tray) — the food bowl already has visible kibble in it, so the
    // empty silver bowl reads as the surprise spot.
    _foodBowlMesh = bowlMesh;
    // Expose the bowl material so lighting.js can dim its env reflections
    // at night (otherwise the mirror stays lit up by the PMREM env even
    // when the room is pitch black).
    state.bowlMat = bowlMat;
  }

  // ─── Right side wall (with a cut-out for the bifold closet) ───
  // sideWallX declared in header
  // wallDepth declared in header
  // wallHeight declared in header
  // Closet opening geometry — must match the bifold block below exactly.
  // Opening width (closetW) is the doorway. Interior width is wider so the
  // walk-in feels like a real walk-in. Because the interior can extend past
  // the rightWall's Z span, we add extra wall panels on the main wall plane
  // (x=sideWallX) to close off the gap.
  // _closetH is the door *opening* height (and matches the bifold door height).
  // The walk-in interior still uses the full room wallHeight for its ceiling,
  // so _closetInteriorH is kept separate.
  const _closetW = 48, _closetH = 66, _closetInteriorH = wallHeight, _closetDepth = 36, _closetInteriorW = 64;
  const _closetZ = oppWallZ + _closetW / 2 + 8; // = -46 (5.5" trim-to-TV-wall gap)

  // ─── Bypass sliding closet door constants ───
  // The gap between the bedroom closet's +Z side wall (Z=-14) and the guest
  // door frame trim (-Z edge ≈ Z=33). Doors sit on the closet back-wall plane
  // at X = sideWallX + _closetDepth = 87.
  const _bypassZmin = _closetZ + _closetInteriorW / 2;           // -14 (closet +Z side wall)
  const _bypassZmax = 32;                                         // 1" gap from guest door trim
  const _bypassOpenW = _bypassZmax - _bypassZmin;                 // 46
  const _bypassCenterZ = (_bypassZmin + _bypassZmax) / 2;         // 9
  const _bypassH = _closetH;                                      // 66 (matches bifold door height)
  const _bypassBackX = sideWallX + _closetDepth;                   // 87 (closet back wall plane)
  const _bypassPanelW = Math.round(_bypassOpenW * 0.55);          // 25 (~4" overlap when closed)
  const _bypassPanelH = _bypassH - 0.5;                           // 65.5 (floor clearance)
  const _bypassPanelThick = 1.0;
  const _bypassTrackGap = 0.6;                                    // offset between parallel tracks

  const rightWall = (() => {
    // Unified right-side wall: spans the full Z range from the TV wall
    // (Z=_sbXMin) all the way through the hallway to its end cap
    // (Z=_hallZEnd). Replaces what used to be two coplanar meshes —
    // the bedroom `rightWall` (Z=-78.5..48.5) and a separate `hallWallR`
    // (Z=49..289) — which were offset by 0.5" in X (the wall thickness)
    // because one extruded +X and the other extruded -X. Building them as
    // one extrude guarantees the inner face stays exactly coplanar across
    // the entire run, so there's no visible step at the bedroom/hallway
    // junction.
    //
    // Shape lives in Y-Z (the wall's face plane); extrudes along +X, then
    // positioned so the inward face sits at sideWallX.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8d4ce, roughness: 0.7, metalness: 0.05 });
    const zCenter = -15;
    const wallShape = new THREE.Shape();
    const zMin = zCenter - wallDepth / 2;          // -78.5 (TV wall)
    const zMax = _hallZEnd;                    // 289   (hallway end cap)
    const yMin = 0, yMax = wallHeight;
    wallShape.moveTo(zMin, yMin);
    wallShape.lineTo(zMax, yMin);
    wallShape.lineTo(zMax, yMax);
    wallShape.lineTo(zMin, yMax);
    wallShape.lineTo(zMin, yMin);
    // Rectangular hole for the closet opening. Bottom aligns with the wall
    // bottom; the threshold z-fighting is addressed by lifting the wall mesh a
    // hair above the floor and giving the wall material polygonOffset.
    const hZMin = _closetZ - _closetW / 2, hZMax = _closetZ + _closetW / 2;
    const hYMin = 0, hYMax = _closetH;
    const hole = new THREE.Path();
    hole.moveTo(hZMin, hYMin);
    hole.lineTo(hZMax, hYMin);
    hole.lineTo(hZMax, hYMax);
    hole.lineTo(hZMin, hYMax);
    hole.lineTo(hZMin, hYMin);
    wallShape.holes.push(hole);
    // Guest-room doorway hole — now cut in one piece since this single wall
    // covers the full Z span (previously split across rightWall + hallWallR).
    {
      const gHole = new THREE.Path();
      gHole.moveTo(_guestDoorZmin, 0);
      gHole.lineTo(_guestDoorZmax, 0);
      gHole.lineTo(_guestDoorZmax, _guestDoorH);
      gHole.lineTo(_guestDoorZmin, _guestDoorH);
      gHole.lineTo(_guestDoorZmin, 0);
      wallShape.holes.push(gHole);
    }
    const wallGeo = new THREE.ExtrudeGeometry(wallShape, { depth: 0.5, bevelEnabled: false });
    // After extrude: shape axes are (Z,Y) in the local XY plane. Rotate so
    // shape's X-coord → world Z, shape's Y-coord → world Y, extrude → world +X.
    // ExtrudeGeometry extrudes along +Z of its own frame; rotate the whole geo
    // to map (localX→worldZ, localY→worldY, localZ→worldX).
    wallGeo.rotateY(-Math.PI / 2);
    const rightWall = new THREE.Mesh(wallGeo, wallMat);
    rightWall.position.set(sideWallX, floorY - 0.5, 0);
    rightWall.castShadow = true; rightWall.receiveShadow = true; rightWall._isRoom = true;
    addRoom(rightWall);
    // Extension panels on the main wall plane where the closet interior extends
    // past rightWall's Z span. These cover the "gaps" flanking the opening so
    // the closet doesn't look open to the void.
    const rwZMin = -15 - wallDepth / 2, rwZMax = -15 + wallDepth / 2;
    const intZMin = _closetZ - _closetInteriorW / 2, intZMax = _closetZ + _closetInteriorW / 2;
    if (intZMin < rwZMin) {
      const w = rwZMin - intZMin;
      const ext = roomBox(0.5, wallHeight, w, 0xd8d4ce, sideWallX, floorY + wallHeight / 2, (intZMin + rwZMin) / 2, 0, 0, 0);
      ext._wallExtMinZ = true;
    }
    if (intZMax > rwZMax) {
      const w = intZMax - rwZMax;
      const ext = roomBox(0.5, wallHeight, w, 0xd8d4ce, sideWallX, floorY + wallHeight / 2, (rwZMax + intZMax) / 2, 0, 0, 0);
      ext._wallExtMaxZ = true;
    }
    return rightWall;
  })();

  // ─── Bedroom mirror — hung on side wall just past the closet (+Z side) ───
  // 1.5ft × 4ft (18" × 48") mirror with a 2"-wide raised wooden lip around
  // it. Mirror sits flat against the wall; the wood is built as four thin
  // border strips (top/bottom/left/right) that protrude as a lip.
  {
    const mirrorW = 18;            // mirror surface width  (1.5 ft, along Z)
    const mirrorH = 48;            // mirror surface height (4 ft)
    const borderT = 2;             // wood lip thickness on each side
    const lipDepth = 0.6;          // how far the lip protrudes off the wall
    const frameW = mirrorW + borderT * 2;   // 22
    const frameH = mirrorH + borderT * 2;   // 52
    const centerY = floorY + 8 + frameH / 2; // 8" off the floor → top at floorY+60
    // 6" gap from the closet's +Z edge (Z=_bypassZmin=-14).
    const centerZ = _bypassZmin + 6 + frameW / 2; // = -14 + 6 + 11 = 3
    const wallFaceX = sideWallX;   // interior face of the right wall

    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2a, roughness: 0.55, metalness: 0.05,
    });
    // Four lip pieces forming a picture-frame border. Center X for all of
    // them is wallFaceX - lipDepth/2 so the back face sits flush with the
    // wall and the front face protrudes by lipDepth.
    const lipX = wallFaceX - lipDepth / 2;
    // Top lip (above the mirror)
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, borderT, frameW), borderMat);
      m.position.set(lipX, centerY + mirrorH / 2 + borderT / 2, centerZ);
      m.castShadow = true; m.receiveShadow = true; m._isRoom = true; addRoom(m);
    }
    // Bottom lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, borderT, frameW), borderMat);
      m.position.set(lipX, centerY - mirrorH / 2 - borderT / 2, centerZ);
      m.castShadow = true; m.receiveShadow = true; m._isRoom = true; addRoom(m);
    }
    // -Z lip (toward closet)
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, mirrorH, borderT), borderMat);
      m.position.set(lipX, centerY, centerZ - mirrorW / 2 - borderT / 2);
      m.castShadow = true; m.receiveShadow = true; m._isRoom = true; addRoom(m);
    }
    // +Z lip (toward guest doorway)
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, mirrorH, borderT), borderMat);
      m.position.set(lipX, centerY, centerZ + mirrorW / 2 + borderT / 2);
      m.castShadow = true; m.receiveShadow = true; m._isRoom = true; addRoom(m);
    }

    // Mirror surface — silver-toned, sits ~0.05" off the wall (well behind
    // the lip's front face, which protrudes lipDepth=0.6").
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde3, roughness: 0.15, metalness: 0.9,
      emissive: 0x9aa3ad, emissiveIntensity: 0.35,
      envMapIntensity: 1.6,
    });
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(mirrorW, mirrorH),
      mirrorMat
    );
    mirror.rotation.y = -Math.PI / 2; // normal points -X (into the bedroom)
    mirror.position.set(wallFaceX - 0.05, centerY, centerZ);
    mirror.receiveShadow = true;
    mirror._isRoom = true;
    addRoom(mirror);
  }

  // (No corner fill needed — the unified right wall extends past Z=49 in
  // one piece, so there's no 0.5" gap between it and the back wall.)

  // Baseboard — break into pieces so it doesn't cross the closet opening
  // OR the guest-room doorway. Inset by trimW (2.5") to not stick past
  // door trim in either case. Spans the full unified-wall Z range
  // (_sbXMin .. _hallZEnd), covering the old hallway +X baseboard too.
  const bbTrimInset = 2.5;
  const _sbXMin = -15 - wallDepth / 2;
  const _sbXMax = _hallZEnd;
  const _closetBbMin = _closetZ - _closetW / 2 - bbTrimInset;
  const _closetBbMax = _closetZ + _closetW / 2 + bbTrimInset;
  const _guestBbMin = _guestDoorZmin - bbTrimInset;
  const _guestBbMax = _guestDoorZmax + bbTrimInset;
  const _sideBbSegs = [
    { zMin: _sbXMin, zMax: _closetBbMin },
    { zMin: _closetBbMax, zMax: _guestBbMin },
    { zMin: _guestBbMax, zMax: _sbXMax },
  ];
  for (const s of _sideBbSegs) {
    const w = s.zMax - s.zMin; if (w < 0.5) continue;
    roomBox(0.6, 3, w, 0xc0bbb4, sideWallX - 0.5, floorY + 1.5, (s.zMin + s.zMax) / 2, 0, 0, 0);
  }

  // ─── Bifold closet doors on right wall (becomes -X after flip) ───
  {
    const closetW = _closetW, closetH = _closetH; // share with the wall cut-out
    const closetX = sideWallX - 0.5; // flush against wall
    const closetZ = _closetZ; // match the wall opening exactly
    const bifoldColor = 0xe0d8cc;
    const bifoldMat = new THREE.MeshStandardMaterial({ color: bifoldColor, roughness: 0.72, metalness: 0.0 });
    const panelW2 = closetW / 4; // 4 panels (2 per side)
    const panelThick = 1.2;
    // Two bifold leaves. Each leaf's pivot sits at its outer jamb (the hinge to
    // the wall). Inside the leaf, an outer panel is fixed and an inner panel is
    // attached via a second hinge group (the mid-leaf joint). Clicking a panel
    // toggles the whole leaf open/closed — we animate leafPivot.rotation.y = θ
    // and innerGroup.rotation.y = -2θ so the two panels fold into a V whose
    // endpoint stays along the wall track.
    const bifoldLeaves = [];
    window._bifoldLeavesRef = bifoldLeaves; // exposed for first-person collision
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.15 });
    for (let leafIdx = 0; leafIdx < 2; leafIdx++) {
      const leafSide = leafIdx === 0 ? -1 : 1; // -1 → -Z jamb leaf, +1 → +Z jamb leaf
      const leafPivot = new THREE.Group();
      leafPivot.position.set(closetX - panelThick / 2, floorY + closetH / 2, closetZ + leafSide * closetW / 2);
      leafPivot._isRoom = true;
      leafPivot._isBifoldLeaf = true;
      leafPivot._leafOpen = false;
      leafPivot._leafAngle = 0;       // current θ (rad)
      leafPivot._leafTarget = 0;      // target θ (rad)
      leafPivot._leafSide = leafSide;
      addRoom(leafPivot);
      bifoldLeaves.push(leafPivot);
      // Outer panel — centered panelW2/2 along -leafSide*Z from pivot.
      function addRaisedDetails(parent, zCenter) {
        const rpH1 = closetH * 0.35, rpH2 = closetH * 0.45;
        const rpW = panelW2 * 0.7;
        // Thin boxes proud of the door. Key fix: receiveShadow must match the
        // door (both true) or the panels look brighter under any shadow.
        const rp1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, rpH1, rpW), bifoldMat);
        rp1.position.set(panelThick / 2 + 0.16, -closetH * 0.26, zCenter);
        rp1.castShadow = true; rp1.receiveShadow = true;
        rp1._isBifoldLeaf = true; parent.add(rp1);
        const rp2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, rpH2, rpW), bifoldMat);
        rp2.position.set(panelThick / 2 + 0.16, closetH * 0.18, zCenter);
        rp2.castShadow = true; rp2.receiveShadow = true;
        rp2._isBifoldLeaf = true; parent.add(rp2);
      }
      const outerPanel = new THREE.Mesh(
        new THREE.BoxGeometry(panelThick, closetH - 1, panelW2 - 0.3),
        bifoldMat
      );
      outerPanel.position.set(0, 0, -leafSide * panelW2 / 2);
      outerPanel.castShadow = true; outerPanel.receiveShadow = true;
      outerPanel._isBifoldLeaf = true;
      leafPivot.add(outerPanel);
      addRaisedDetails(leafPivot, -leafSide * panelW2 / 2);
      // Inner-panel hinge group — pivoted at the middle joint (panelW2 along
      // -leafSide*Z from leaf pivot).
      const innerGroup = new THREE.Group();
      innerGroup.position.set(0, 0, -leafSide * panelW2);
      leafPivot.add(innerGroup);
      leafPivot._innerGroup = innerGroup;
      const innerPanel = new THREE.Mesh(
        new THREE.BoxGeometry(panelThick, closetH - 1, panelW2 - 0.3),
        bifoldMat
      );
      innerPanel.position.set(0, 0, -leafSide * panelW2 / 2);
      innerPanel.castShadow = true; innerPanel.receiveShadow = true;
      innerPanel._isBifoldLeaf = true;
      innerGroup.add(innerPanel);
      addRaisedDetails(innerGroup, -leafSide * panelW2 / 2);
      // White round handle on the inner panel, near the mid-leaf joint side so
      // it reads as the "pull" side of the bifold. Sits proud of the room-facing
      // face by ~0.6".
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), handleMat);
      handle.position.set(panelThick / 2 + 0.6, 0, -leafSide * (panelW2 * 0.22));
      handle._isBifoldLeaf = true;
      const handleStem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 10), handleMat);
      handleStem.rotation.z = Math.PI / 2;
      handleStem.position.set(panelThick / 2 + 0.25, 0, -leafSide * (panelW2 * 0.22));
      handleStem._isBifoldLeaf = true;
      innerGroup.add(handle);
      innerGroup.add(handleStem);
    }
    // Moulding / trim around the opening
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xe4ddd1, roughness: 0.7, metalness: 0.0 });
    const trimW = 2.5, trimD = 1;
    const headerH = 4; // taller top casing for a proper door-header look
    // Top header
    const trimTop = new THREE.Mesh(new THREE.BoxGeometry(trimD, headerH, closetW + trimW * 2), trimMat);
    trimTop.position.set(closetX - trimD / 2, floorY + closetH + headerH / 2, closetZ);
    trimTop.castShadow = true; trimTop.receiveShadow = true; trimTop._isRoom = true; addRoom(trimTop);
    // Left jamb
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(trimD, closetH, trimW), trimMat);
    trimL.position.set(closetX - trimD / 2, floorY + closetH / 2, closetZ - closetW / 2 - trimW / 2);
    trimL.castShadow = true; trimL.receiveShadow = true; trimL._isRoom = true; addRoom(trimL);
    // Right jamb
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(trimD, closetH, trimW), trimMat);
    trimR.position.set(closetX - trimD / 2, floorY + closetH / 2, closetZ + closetW / 2 + trimW / 2);
    trimR.castShadow = true; trimR.receiveShadow = true; trimR._isRoom = true; addRoom(trimR);

    // ─── Walk-in closet interior box (behind the wall opening) ───
    // The wall sits at x=sideWallX with a hole cut out and thickness 0.5 (so
    // its back face sits at sideWallX+0.5). Interior side walls and ceiling
    // start at sideWallX+0.5 to butt cleanly against the wall's back face
    // (avoiding z-fighting where they cross the solid part of the wall).
    const closetDepth = _closetDepth;
    const interiorW = _closetInteriorW;
    const interiorH = _closetInteriorH; // full room-height interior, independent of door opening
    const wallBack = 0.5; // rightWall thickness
    // Side walls start at the inner face of the main wall (sideWallX+wallBack)
    // and extend past the back wall center to eliminate corner gaps.
    const innerDepth = closetDepth;
    const innerCx = sideWallX + wallBack + innerDepth / 2;
    const insideMat = new THREE.MeshStandardMaterial({ color: 0xe4dcce, roughness: 0.85, metalness: 0.0 });
    // Back wall
    const closetBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, interiorH, interiorW), insideMat);
    closetBack.position.set(sideWallX + closetDepth, floorY + interiorH / 2, closetZ);
    closetBack.castShadow = false; closetBack.receiveShadow = true; closetBack._isRoom = true; addRoom(closetBack);
    // +Z side wall
    const closetSideP = new THREE.Mesh(new THREE.BoxGeometry(innerDepth, interiorH, 0.5), insideMat);
    closetSideP.position.set(innerCx, floorY + interiorH / 2, closetZ + interiorW / 2);
    closetSideP.receiveShadow = true; closetSideP._isRoom = true; addRoom(closetSideP);
    // -Z side: the TV/mini-split wall (oppWallZ) extends into the closet depth
    // to act as the closet's -Z boundary. This eliminates the gap that caused
    // light bleed. The wall extends from sideWallX into the full closet depth.
    const oppWallExt = new THREE.Mesh(
      new THREE.BoxGeometry(closetDepth + 1, interiorH, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd0ccc6, roughness: 0.7, metalness: 0.05 })
    );
    oppWallExt.position.set(sideWallX + closetDepth / 2, floorY + interiorH / 2, oppWallZ);
    oppWallExt.receiveShadow = true; oppWallExt._isRoom = true; addRoom(oppWallExt);
    // Ceiling
    const closetCeil = new THREE.Mesh(new THREE.BoxGeometry(innerDepth, 0.5, interiorW), insideMat);
    closetCeil.position.set(innerCx, floorY + interiorH, closetZ);
    closetCeil.receiveShadow = true; closetCeil._isRoom = true; addRoom(closetCeil);
    // Clothes rod across the closet, ~30" below the ceiling
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.6 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, interiorW - 2, 14), rodMat);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(innerCx, floorY + interiorH - 30, closetZ);
    rod.castShadow = true; rod._isRoom = true; addRoom(rod);
    // Shelf above the rod. Position constants are shared with the shelf
    // collision AABB and the shelf coin further below. Shelf is shallower
    // along X than the closet and pushed flush against the back wall.
    const shelfDrop = 24;         // inches below the ceiling
    const shelfXDepth = 14;       // shelf depth along X (room-to-back axis)
    const shelfBackGap = 0.1;     // gap between shelf and back wall (flush)
    // Back wall inner face is at sideWallX+closetDepth-0.5. Center the shelf
    // against it with shelfBackGap of clearance.
    const shelfCenterX = sideWallX + closetDepth - 0.5 - shelfBackGap - shelfXDepth / 2;
    const shelfY = floorY + interiorH - shelfDrop;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xdcd2c0, roughness: 0.75, metalness: 0.0 });
    const shelfLen = interiorW - 1;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(shelfXDepth, 0.8, shelfLen), shelfMat);
    shelf.position.set(shelfCenterX, shelfY, closetZ);
    shelf.castShadow = true; shelf.receiveShadow = true; shelf._isRoom = true; addRoom(shelf);
    // Three vertical dividers split the shelf into 4 equal sections. Each
    // divider runs from just above the shelf top up to the closet ceiling.
    const divThick = 0.6;
    const divTopY = floorY + interiorH - 0.5; // just below ceiling panel
    const divBotY = shelfY + 0.4;           // top face of shelf
    const divH = divTopY - divBotY;
    const divCenterY = (divTopY + divBotY) / 2;
    const shelfZMin = closetZ - shelfLen / 2;
    for (let i = 1; i <= 3; i++) {
      const zC = shelfZMin + (shelfLen * i / 4);
      const div = new THREE.Mesh(new THREE.BoxGeometry(shelfXDepth, divH, divThick), shelfMat);
      div.position.set(shelfCenterX, divCenterY, zC);
      div.castShadow = true; div.receiveShadow = true; div._isRoom = true;
      addRoom(div);
    }
    // Z-center of the 1st section (between the -Z shelf end and divider #1).
    const section1Z = shelfZMin + (shelfLen / 4) / 2; // = shelfZMin + shelfLen/8
    window._closetShelf1Z = section1Z;
  }

  // ── Closet debug wall labels — must come after closet vars ──
  {
    const _makeLabel = (lines, scale, color) => {
      // lines: array of {text, color} or a single string
      if (typeof lines === 'string') lines = [{ text: lines, color }];
      const cvs = document.createElement('canvas');
      cvs.width = 512; cvs.height = 256;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(16, 16, 480, 224, 24);
      ctx.fill();
      ctx.textAlign = 'center';
      const n = lines.length;
      const lineH = 220 / n;
      for (let i = 0; i < n; i++) {
        const { text, color: c } = lines[i];
        ctx.fillStyle = c;
        let fs = Math.min(lineH - 4, 90);
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        while (ctx.measureText(text).width > 460 && fs > 20) {
          fs -= 4;
          ctx.font = `bold ${fs}px system-ui, sans-serif`;
        }
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 24 + lineH * i + lineH / 2);
      }
      const tex = new THREE.CanvasTexture(cvs);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(scale, scale / 2, 1);
      sprite.visible = false;
      sprite._isRoom = true;
      sprite._isDebugLabel = true;
      addRoom(sprite);
      _debugWallLabels.push(sprite);
      return sprite;
    };
    const closetCX = sideWallX + 0.5 + _closetDepth / 2;
    const closetMidY = floorY + _closetInteriorH / 2;
    // Shared back wall (X=87) — bedroom closet back / office closet front
    _makeLabel([
      { text: 'BEDROOM CLOSET BACK', color: '#ddcc44' },
      { text: 'OFFICE CLOSET FRONT', color: '#dd8844' },
    ], 22).position.set(sideWallX + _closetDepth - 4, closetMidY, _closetZ);
    // Shared divider wall (Z=-14) — bedroom closet +Z / office closet -Z
    _makeLabel([
      { text: 'BEDROOM CLOSET +Z', color: '#ddcc44' },
      { text: 'OFFICE CLOSET -Z', color: '#dd8844' },
    ], 22).position.set(closetCX, closetMidY, _closetZ + _closetInteriorW / 2 - 4);
    // Bedroom-only -Z wall (against TV wall)
    _makeLabel('BEDROOM CLOSET -Z', 22, '#ddcc44').position.set(closetCX, closetMidY, _closetZ - _closetInteriorW / 2 + 4);
  }

  // ─── Bypass sliding closet doors (office side, on closet back-wall plane) ──
  // Two panels slide along Z on parallel tracks at X = _bypassBackX (87).
  // The closet interior behind these doors spans X=51..87, Z=-14..32.
  {
    const insideMat = new THREE.MeshStandardMaterial({ color: 0xe4dcce, roughness: 0.85, metalness: 0.0 });
    const trimColor = 0xe4ddd1;
    const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.35, metalness: 0.05 });
    const headerH = wallHeight - _bypassH; // 14" (wall above door opening)
    const innerDepth = _closetDepth;        // 36"
    const innerCx = sideWallX + 0.5 + innerDepth / 2;

    // ── Back wall extension: header above the bypass opening ──
    const extHeader = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, headerH, _bypassOpenW),
      insideMat
    );
    extHeader.position.set(_bypassBackX, floorY + _bypassH + headerH / 2, _bypassCenterZ);
    extHeader.receiveShadow = true; extHeader._isRoom = true; addRoom(extHeader);

    // ── New closet interior walls ──
    // +Z side wall at Z=_bypassZmax (32): separates closet from guest door area
    const sideWallPZ = new THREE.Mesh(
      new THREE.BoxGeometry(innerDepth, wallHeight, 0.5),
      insideMat
    );
    sideWallPZ.position.set(innerCx, floorY + wallHeight / 2, _bypassZmax + 0.25);
    sideWallPZ.receiveShadow = true; sideWallPZ._isRoom = true; addRoom(sideWallPZ);

    // -Z side: reuse the existing closet +Z side wall (closetSideP at Z=-14).
    // No new wall needed there — just extend the back wall downward.
    // Back wall extension below header (fills from floor to door-top height)
    // is NOT built — that's where the door opening is. The panels close it.

    // Ceiling of the new closet section
    const bpCeil = new THREE.Mesh(
      new THREE.BoxGeometry(innerDepth, 0.5, _bypassOpenW),
      insideMat
    );
    bpCeil.position.set(innerCx, floorY + wallHeight, _bypassCenterZ);
    bpCeil.receiveShadow = true; bpCeil._isRoom = true; addRoom(bpCeil);

    // Clothes rod across the new closet, ~30" below ceiling
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.6 });
    const bpRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, _bypassOpenW - 2, 14),
      rodMat
    );
    bpRod.rotation.x = Math.PI / 2;
    bpRod.position.set(innerCx, floorY + wallHeight - 30, _bypassCenterZ);
    bpRod.castShadow = true; bpRod._isRoom = true; addRoom(bpRod);

    // Shelf above the rod (matching bedroom closet pattern)
    const bpShelfDrop = 24;
    const bpShelfDepth = 14;
    const bpShelfCX = sideWallX + 0.5 + 0.1 + bpShelfDepth / 2;
    const bpShelfY = floorY + wallHeight - bpShelfDrop;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xdcd2c0, roughness: 0.75, metalness: 0.0 });
    const bpShelfLen = _bypassOpenW - 1;
    const bpShelf = new THREE.Mesh(
      new THREE.BoxGeometry(bpShelfDepth, 0.8, bpShelfLen),
      shelfMat
    );
    bpShelf.position.set(bpShelfCX, bpShelfY, _bypassCenterZ);
    bpShelf.castShadow = true; bpShelf.receiveShadow = true; bpShelf._isRoom = true; addRoom(bpShelf);

    // Shelf dividers (3 dividers → 4 sections)
    const divThick = 0.6;
    const divTopY = floorY + wallHeight - 0.5;
    const divBotY = bpShelfY + 0.4;
    const divH = divTopY - divBotY;
    const divCY = (divTopY + divBotY) / 2;
    const bpShelfZmin = _bypassCenterZ - bpShelfLen / 2;
    for (let i = 1; i <= 3; i++) {
      const zC = bpShelfZmin + (bpShelfLen * i / 4);
      const div = new THREE.Mesh(
        new THREE.BoxGeometry(bpShelfDepth, divH, divThick),
        shelfMat
      );
      div.position.set(bpShelfCX, divCY, zC);
      div.castShadow = true; div.receiveShadow = true; div._isRoom = true;
      addRoom(div);
    }

    // ── Door frame / trim (on the office-facing side, X < 87) ──
    const frameW = 2.5;
    // Left jamb (at Z = _bypassZmin)
    const jambL = new THREE.Mesh(new THREE.BoxGeometry(frameW, _bypassH, frameW), trimMat);
    jambL.position.set(_bypassBackX - frameW / 2, floorY + _bypassH / 2, _bypassZmin - frameW / 2 + 0.5);
    jambL.receiveShadow = true; jambL._isRoom = true; addRoom(jambL);
    // Right jamb (at Z = _bypassZmax) — flush against +Z wall
    const jambR = new THREE.Mesh(new THREE.BoxGeometry(frameW, _bypassH, frameW), trimMat);
    jambR.position.set(_bypassBackX - frameW / 2, floorY + _bypassH / 2, _bypassZmax - frameW / 2 + 0.25);
    jambR.receiveShadow = true; jambR._isRoom = true; addRoom(jambR);
    // Header — spans from left jamb to +Z wall
    const headerSpanZ = _bypassZmax - (_bypassZmin - frameW / 2 + 0.5) + 0.25;
    const headerCenterZ = (_bypassZmin - frameW / 2 + 0.5 + _bypassZmax + 0.25) / 2;
    const headerTrim = new THREE.Mesh(
      new THREE.BoxGeometry(frameW, frameW, headerSpanZ),
      trimMat
    );
    headerTrim.position.set(_bypassBackX - frameW / 2, floorY + _bypassH + frameW / 2 - 0.5, headerCenterZ);
    headerTrim.receiveShadow = true; headerTrim._isRoom = true; addRoom(headerTrim);

    // ── Top track (aluminum rail) ──
    const trackMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.3, metalness: 0.5 });
    const topTrack = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.5, _bypassOpenW - 2),
      trackMat
    );
    topTrack.position.set(_bypassBackX, floorY + _bypassH - 0.25, _bypassCenterZ);
    topTrack.receiveShadow = true; topTrack._isRoom = true; addRoom(topTrack);

    // ── Floor guide (thin rail) ──
    const floorGuide = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.3, _bypassOpenW),
      trackMat
    );
    floorGuide.position.set(_bypassBackX, floorY + 0.15, _bypassCenterZ);
    floorGuide.receiveShadow = true; floorGuide._isRoom = true; addRoom(floorGuide);

    // ── Two bypass sliding panels ──
    const bypassPanels = [];
    window._bypassDoorsRef = bypassPanels;

    for (let i = 0; i < 2; i++) {
      // Panel 0 = front track (office side, -X) covers -Z half
      // Panel 1 = back track (closet side, +X) covers +Z half
      // Real bypass: each panel slides TOWARD the other to stack behind it,
      // exposing its own side of the opening. Only one side open at a time.
      const trackOffset = (i === 0 ? -1 : 1) * (_bypassTrackGap / 2);
      const zOffset = (i === 0 ? -1 : 1) * (_bypassOpenW - _bypassPanelW) / 2;
      const panelZ = _bypassCenterZ + zOffset;
      // Pull offset toward the outside edge (center of the opening)
      const pullZ = (i === 0 ? 1 : -1) * (_bypassPanelW / 2 - 3);
      const panel = buildBypassPanel({
        width: _bypassPanelW,
        height: _bypassPanelH,
        thickness: _bypassPanelThick,
        pullZOffset: pullZ,
      });
      const panelGroup = new THREE.Group();
      panelGroup.add(panel);
      panelGroup.position.set(
        _bypassBackX + trackOffset,
        floorY + _bypassPanelH / 2 + 0.25,
        panelZ
      );
      panelGroup._isBypassPanel = true;
      panelGroup._isRoom = true;
      panelGroup._panelIndex = i;
      panelGroup._slideOpen = false;
      panelGroup._slideTarget = panelZ;
      panelGroup._baseZ = panelZ;
      // Slide distance: move toward the other panel's position (stack behind it)
      // Panel 0 (-Z side) slides +Z, panel 1 (+Z side) slides -Z
      panelGroup._slideDir = (i === 0 ? 1 : -1);
      panelGroup._slideMax = _bypassOpenW - _bypassPanelW; // distance between panel centers
      addRoom(panelGroup);
      bypassPanels.push(panelGroup);

      // Tag all children for raycasting
      tagAll(panel, { _isBypassPanel: true, _isRoom: true });
    }

    // ── Debug wall labels for the office closet (orange) ──
    {
      const _makeLabel2 = (text, scale, color) => {
        const cvs = document.createElement('canvas');
        cvs.width = 512; cvs.height = 256;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.roundRect(16, 16, 480, 224, 24);
        ctx.fill();
        ctx.fillStyle = color;
        let fontSize = 78;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        while (ctx.measureText(text).width > 460 && fontSize > 20) {
          fontSize -= 4;
          ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 128);
        const tex = new THREE.CanvasTexture(cvs);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(scale, scale / 2, 1);
        sprite.visible = false;
        sprite._isRoom = true;
        sprite._isDebugLabel = true;
        addRoom(sprite);
        _debugWallLabels.push(sprite);
        return sprite;
      };
      const ocMidY = floorY + wallHeight / 2;
      // +Z side wall (Z=32, separates from guest door area) — unique to office closet
      _makeLabel2('OFFICE CLOSET +Z', 18, '#dd8844').position.set(innerCx, ocMidY, _bypassZmax - 4);
    }
  }

  // ─── Left side wall with window (near the bed) ───
  // leftWallX declared in header
  // winW, winH declared in header
  // winCenterY declared in header
  // winCenterZ declared in header
  const winBottom = winCenterY - winH / 2;
  const winTop = winCenterY + winH / 2;
  const winFront = winCenterZ - winW / 2;
  const winBack = winCenterZ + winW / 2;

  // Keep daylight aligned with the mirrored window opening to avoid overhead leakage.
  const mirroredWindowX = -leftWallX;
  // key light repositioning moved to lighting module — needs window coords
  // key.position.set(mirroredWindowX+14, winCenterY+3, winCenterZ);
  // key.target.position.set(0, winCenterY+1, winCenterZ);

  // Wall sections around the window (4 pieces: below, above, front, back)
  // Below window
  const belowH = winBottom - floorY;
  const leftWallBelow = roomBox(0.5, belowH, wallDepth, 0xd8d4ce, leftWallX, floorY + belowH / 2, -15, 0, 0, 0);
  // Above window
  const aboveH = floorY + wallHeight - winTop;
  const leftWallAbove = roomBox(0.5, aboveH, wallDepth, 0xd8d4ce, leftWallX, winTop + aboveH / 2, -15, 0, 0, 0);
  // Front of window (toward TV wall)
  const frontZmin = oppWallZ;
  const frontW = winFront - frontZmin;
  const leftWallFront = roomBox(0.5, winH, frontW, 0xd8d4ce, leftWallX, winCenterY, frontZmin + frontW / 2, 0, 0, 0);
  // Back of window (toward Z=+50)
  const backZmax = 49;
  const backW = backZmax - winBack;
  const leftWallBack = roomBox(0.5, winH, backW, 0xd8d4ce, leftWallX, winCenterY, winBack + backW / 2, 0, 0, 0);

  // Baseboard on left wall
  const leftBaseboard = roomBox(0.6, 3, wallDepth, 0xc0bbb4, leftWallX + 0.5, floorY + 1.5, -15, 0, 0, 0);

  // Corner fill — patch gap between left wall (z=48.5) and back wall (z=49)
  roomBox(0.5, wallHeight, 0.5, 0xd8d4ce, leftWallX, floorY + wallHeight / 2, 48.75, 0, 0, 0);

  // Window sill — deeper than the frame so it reads as a real ledge
  // sitting beneath the trim.
  roomBox(1.6, 0.5, winW + 2, 0xc8c4be, leftWallX + 0.8, winBottom - 0.25, winCenterZ, 0, 0, 0);

  // Window frame + glass — shared model (bedroom window is NOT openable).
  const frameD = 1.2;
  const wallInnerX = leftWallX + 0.25;
  const trimX = wallInnerX + frameD / 2 + 0.04; // back face ~0.04" proud of wall
  const bedroomWindow = buildWindowModel({ width: winW, height: winH });
  bedroomWindow.position.set(trimX, winCenterY, winCenterZ);
  tagAll(bedroomWindow, { _isRoom: true });
  // Mark ALL bedroom window meshes as click-passthrough so raycasts reach the
  // outdoor backdrop behind them for day/night toggle.
  bedroomWindow.traverse(o => {
    if (o.isMesh) o.userData.clickPassthrough = true;
  });
  addRoom(bedroomWindow);

  // Outdoor scene visible through window — same composition for day + night.
  const _clouds = [[80, 90, 60, 25], [200, 70, 80, 30], [350, 100, 55, 20], [430, 60, 70, 28]];
  function drawOutdoorScene(ctx, night) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 300);
    if (night) {
      skyGrad.addColorStop(0, '#0d1425');
      skyGrad.addColorStop(0.35, '#1a2740');
      skyGrad.addColorStop(0.55, '#232f45');
      skyGrad.addColorStop(0.7, '#2b3242');
    } else {
      skyGrad.addColorStop(0, '#6a99c4');
      skyGrad.addColorStop(0.35, '#a8c8da');
      skyGrad.addColorStop(0.55, '#ddd8c8');
      skyGrad.addColorStop(0.7, '#f0e8d8');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 512, 300);

    // Distant hazy hills (same profile)
    ctx.fillStyle = night ? '#34404a' : '#8aab8a';
    ctx.beginPath(); ctx.moveTo(0, 300);
    for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, 280 - Math.sin(x * 0.012) * 18 - Math.sin(x * 0.031) * 8);
    ctx.lineTo(512, 300); ctx.fill();

    // Closer tree line (same profile)
    ctx.fillStyle = night ? '#263427' : '#4a7a4a';
    ctx.beginPath(); ctx.moveTo(0, 310);
    for (let x = 0; x <= 512; x += 4) {
      const base = 295 - Math.sin(x * 0.02) * 10;
      const tree = Math.sin(x * 0.08) * 12 + Math.sin(x * 0.15) * 6 + Math.cos(x * 0.05) * 8;
      ctx.lineTo(x, base - Math.max(tree, 0));
    }
    ctx.lineTo(512, 310); ctx.fill();

    // Ground / grass (same geometry)
    const grassGrad = ctx.createLinearGradient(0, 310, 0, 512);
    if (night) {
      grassGrad.addColorStop(0, '#2b3f27');
      grassGrad.addColorStop(0.4, '#223521');
      grassGrad.addColorStop(1, '#182817');
    } else {
      grassGrad.addColorStop(0, '#5a8a45');
      grassGrad.addColorStop(0.4, '#4a7a3a');
      grassGrad.addColorStop(1, '#3a6a2a');
    }
    ctx.fillStyle = grassGrad; ctx.fillRect(0, 305, 512, 207);

    // Same cloud placements; dimmer at night.
    ctx.globalAlpha = night ? 0.14 : 0.3;
    ctx.fillStyle = night ? '#9db2cf' : '#ffffff';
    _clouds.forEach(([cx, cy, rx, ry]) => {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1.0;
  }

  const outdoorCvs = document.createElement('canvas');
  outdoorCvs.width = 512; outdoorCvs.height = 512;
  const oCtx = outdoorCvs.getContext('2d');
  drawOutdoorScene(oCtx, false);
  const outdoorTex = new THREE.CanvasTexture(outdoorCvs);
  outdoorTex.generateMipmaps = false;
  outdoorTex.minFilter = THREE.LinearFilter;

  const nightOutdoorCvs = document.createElement('canvas');
  nightOutdoorCvs.width = 512; nightOutdoorCvs.height = 512;
  const nCtx = nightOutdoorCvs.getContext('2d');
  drawOutdoorScene(nCtx, true);
  const nightOutdoorTex = new THREE.CanvasTexture(nightOutdoorCvs);
  nightOutdoorTex.generateMipmaps = false;
  nightOutdoorTex.minFilter = THREE.LinearFilter;

  // Auto-detect night based on local clock (before 6 AM or after 8 PM)
  const _curHour = new Date().getHours();
  let _windowIsNight = _curHour >= 20 || _curHour < 6;
  const _outdoorDayTex = outdoorTex;
  const _outdoorNightTex = nightOutdoorTex;

  outdoorMat = new THREE.MeshBasicMaterial({ map: _windowIsNight ? nightOutdoorTex : outdoorTex, color: _windowIsNight ? 0x445566 : 0xfff0d4 });
  outdoorMat.toneMapped = false;
  // Swap placeholder on guest-room outdoor backdrop now that outdoorMat exists
  if (_grOutdoorMesh) { _grOutdoorMesh.material.dispose(); _grOutdoorMesh.material = outdoorMat; }
  const outdoorGeo = new THREE.PlaneGeometry(winW * 2.5, winH * 2);
  const outdoor = new THREE.Mesh(outdoorGeo, outdoorMat);
  outdoor.rotation.y = Math.PI / 2;
  outdoor.position.set(leftWallX - 4, winCenterY + 5, winCenterZ);
  outdoor._isRoom = true; outdoor._isWindow = true; addRoom(outdoor);

  // Moonlight glow through the window — subtle blue-white light that's
  // controlled by time-of-day (bright at night, off during day).
  const moonGlow = new THREE.PointLight(0x8899bb, 0, 60, 1.0);
  moonGlow.position.set(leftWallX + 3, winCenterY, winCenterZ);
  moonGlow.castShadow = false;
  moonGlow._isRoom = true;
  addRoom(moonGlow);

  // Avatar painting — framed art hung on the WINDOW wall (-X), in the
  // bed-clear stretch between the window and the TV wall. Source image
  // is 930×1280 (portrait, ~0.726:1). Matte and photo sit flat against
  // the wall; the wood frame is a raised lip around them. Mirrors the
  // Gyarados painting in the office, but oriented to face +X.
  let _avatarPosterCenter = null;  // pre-mirror local pos; mirrored when read
  {
    const photoW = 12;
    const photoH = 12 * (1280 / 930);   // matches source aspect ratio (~16.52)
    const matteMarginX = photoW * 0.20;
    const matteMarginY = photoH * 0.20;
    const matteW = photoW + matteMarginX * 2;
    const matteH = photoH + matteMarginY * 2;
    const frameBorder = 1.25;       // wood lip thickness on each side
    const lipDepth = 1.1;           // how far the lip protrudes off the wall
    // Hung between the TV wall and the foot of the bed, nudged 6"
    // closer to the window than the wall midpoint.
    const centerZ = (oppWallZ + (BED_Z - BED_L / 2)) / 2 + 6;  // ≈ -49.9
    const centerY = floorY + 52;    // natural hang height (slightly above eye)
    const wallFaceX = leftWallX + 0.25;   // interior face of the window wall

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2b1d12, roughness: 0.55, metalness: 0.05,
    });
    // Four lip pieces forming a picture-frame border. Back face flush with
    // the wall; front face protrudes by lipDepth toward the room (+X).
    const lipX = wallFaceX + lipDepth / 2;
    // Top lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, frameBorder, matteW + frameBorder * 2),
        frameMat);
      m.position.set(lipX, centerY + matteH / 2 + frameBorder / 2, centerZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isAvatarPoster = true; addRoom(m);
    }
    // Bottom lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, frameBorder, matteW + frameBorder * 2),
        frameMat);
      m.position.set(lipX, centerY - matteH / 2 - frameBorder / 2, centerZ);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isAvatarPoster = true; addRoom(m);
    }
    // -Z lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, matteH, frameBorder),
        frameMat);
      m.position.set(lipX, centerY, centerZ - matteW / 2 - frameBorder / 2);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isAvatarPoster = true; addRoom(m);
    }
    // +Z lip
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(lipDepth, matteH, frameBorder),
        frameMat);
      m.position.set(lipX, centerY, centerZ + matteW / 2 + frameBorder / 2);
      m.castShadow = true; m.receiveShadow = true;
      m._isRoom = true; m._isAvatarPoster = true; addRoom(m);
    }

    // White matte — sits ~0.05" off the wall, fills the inside of the lip.
    const matteMat = new THREE.MeshStandardMaterial({
      color: 0xf5f1e8, roughness: 0.95, metalness: 0.0,
    });
    const matte = new THREE.Mesh(
      new THREE.PlaneGeometry(matteW, matteH),
      matteMat
    );
    matte.rotation.y = Math.PI / 2;   // face +X (room interior)
    matte.position.set(wallFaceX + 0.05, centerY, centerZ);
    matte.receiveShadow = true;
    matte._isRoom = true; matte._isAvatarPoster = true;
    addRoom(matte);

    // Photo — smaller plane just in front of the matte; matte border
    // shows around all four sides as a uniform white margin.
    const photoMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.85, metalness: 0.0,
    });
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(photoW, photoH),
      photoMat
    );
    photo.rotation.y = Math.PI / 2;   // face +X (room interior)
    photo.position.set(wallFaceX + 0.07, centerY, centerZ);
    photo.receiveShadow = true;
    photo._isRoom = true; photo._isAvatarPoster = true;
    addRoom(photo);

    new THREE.TextureLoader().load(
      'img/avatar_painting.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, (state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 4));
        photo.material.map = tex;
        photo.material.needsUpdate = true;
      },
      undefined,
      () => { /* fall back to blank photo if missing */ }
    );

    // Glass-like sheen — overlay the photo+matte with reflective highlights
    // without refracting the image. Matches the Gyarados painting's sheen.
    const sheenMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
    });
    const sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(matteW, matteH),
      sheenMat
    );
    sheen.rotation.y = Math.PI / 2;   // face +X (room interior)
    sheen.position.set(wallFaceX + 0.09, centerY, centerZ);
    sheen._isRoom = true; sheen._isAvatarPoster = true;
    addRoom(sheen);

    // Capture poster position so external systems (poster-fireball drop
    // animation, label tooltip) know where the painting hangs without
    // re-deriving the math. Stored in WORLD (post-mirror) coords because
    // the room's _isRoom X-flip happens later in this function and
    // readers expect world positions.
    _avatarPosterCenter = {
      // World (post-mirror) center of the framed photo. The painting
      // faces -X (interior) once mirrored, so spawn things slightly in
      // front of `x` along -X.
      x: -(wallFaceX + 0.5),                  // ≈ +80.25
      y: centerY,
      z: centerZ,
      // Front face X (just outside the wood lip) for spawn anchoring.
      faceX: -(wallFaceX + lipDepth + 0.05),  // ≈ +79.6
      // Painting bounding box (world Y/Z) for sizing the click hitbox.
      halfH: matteH / 2 + frameBorder,
      halfZ: matteW / 2 + frameBorder
    };
  }

  // Ceiling light fixture — flush-mount dome with warm SpotLight
  const ceilY = floorY + 79.5; // just below ceiling
  // ceilLightX, ceilLightZ declared in header
  // Fixture base (flush mount disc)
  const fixBase = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 0.4, 24),
    new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4, metalness: 0.1 })
  );
  fixBase.position.set(ceilLightX, ceilY, ceilLightZ);
  fixBase._isRoom = true; fixBase._isCeilLight = true; addRoom(fixBase);
  // Frosted glass dome
  const domeMat = stdMat({ color: 0xfff8ee, emissive: 0xfff0d0, emissiveIntensity: 0.55, transparent: true, opacity: 0.85, shininess: 60 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.rotation.x = Math.PI; // flip dome to hang down
  dome.position.set(ceilLightX, ceilY - 0.2, ceilLightZ);
  dome._isRoom = true; dome._isCeilLight = true; addRoom(dome);
  // Downward spot lights the floor (main pool). Ceiling + upper walls need
  // their own source since a spot only throws inside its cone, and the room
  // has no global ambient bounce. We split those two jobs on purpose.
  const ceilSpot = new THREE.SpotLight(0xfff0dd, 60, 0, Math.PI * 0.42, 0.6, 0.9);
  ceilSpot.position.set(ceilLightX, ceilY - 1, ceilLightZ);
  ceilSpot.target.position.set(ceilLightX, floorY, ceilLightZ);
  addRoom(ceilSpot); addRoom(ceilSpot.target);
  ceilSpot.castShadow = false;
  ceilSpot.shadow.mapSize.set(512, 512);
  ceilSpot.shadow.bias = -0.0005;
  ceilSpot.shadow.radius = 5; ceilSpot.shadow.blurSamples = 12;
  ceilSpot.shadow.camera.near = 10;
  ceilSpot.shadow.camera.far = 95;
  // ── IMPORTANT: ceiling light fixture vs. light source positioning ──────────
  // The fixture MESH (fixBase, dome) is at (ceilLightX=0, ceilY, ceilLightZ=-15)
  // but the actual LIGHT SOURCE (ceilGlow) is at (-45, ceilY-8, 51). These are
  // NOT at the same coordinates and never were. An hour of troubleshooting
  // The light SOURCE should be co-located with the fixture mesh and tagged
  // _isRoom so it moves with the room when placement changes. Previously
  // it was at a hardcoded world position that only matched in Under TV mode.
  ceilGlow = new THREE.PointLight(0xfff3df, 25, 0, 0.8);
  ceilGlow.position.set(ceilLightX, ceilY - 8, ceilLightZ);
  ceilGlow.castShadow = false;
  ceilGlow._isRoom = true;
  addRoom(ceilGlow);

  // Curtains — draped fabric panels with ripple folds
  const curtainH = winH + 12, curtainW = 14, curtainD = 2;
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0xc5bfb5, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  function makeCurtainGeo(w, h, d) {
    const geo = new THREE.BoxGeometry(d, h, w, 1, 8, 16);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Sinusoidal ripple folds along Z (width direction)
      const nz = z / (w / 2);
      const ripple = Math.sin(nz * Math.PI * 4.5) * 0.6 + Math.sin(nz * Math.PI * 2.1) * 0.3;
      x += ripple;
      // Slight gathering at the top — narrower at top, wider at bottom
      const ny = (y + h / 2) / h; // 0 at bottom, 1 at top
      z *= 1 - ny * 0.15;
      // Subtle vertical wave
      x += Math.sin(y * 0.3 + z * 0.5) * 0.15;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }
  // Front curtain (toward Z=-50 side of window)
  const cLGeo = makeCurtainGeo(curtainW, curtainH, curtainD);
  const cL = new THREE.Mesh(cLGeo, curtainMat);
  cL.position.set(leftWallX + 1.2, winCenterY, winFront - curtainW / 2 - 1);
  cL.castShadow = true; cL.receiveShadow = true; cL._isRoom = true; addRoom(cL);
  // Back curtain (toward Z=+50 side of window)
  const cRGeo = makeCurtainGeo(curtainW, curtainH, curtainD);
  const cR = new THREE.Mesh(cRGeo, curtainMat);
  cR.position.set(leftWallX + 1.2, winCenterY, winBack + curtainW / 2 + 1);
  cR.castShadow = true; cR.receiveShadow = true; cR._isRoom = true; addRoom(cR);
  // Curtain rod
  const rodGeo = new THREE.CylinderGeometry(0.25, 0.25, winW + curtainW * 2 + 8, 8);
  rodGeo.rotateX(Math.PI / 2);
  const rodMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.7 });
  const rod = new THREE.Mesh(rodGeo, rodMat);
  rod.position.set(leftWallX + 1.5, winTop + 4, winCenterZ);
  rod.castShadow = false; rod._isRoom = true; addRoom(rod);

  // Mark only wall meshes that actually fade as transparent (keeps other room objects in fast opaque pass)
  // Bed parts get tagged with userData.bedPart so the FP-mode click
  // raycast can treat them as passthrough only when the player is
  // actually under the bed (feet below slat level). Otherwise it's hard
  // to click the pokémon binder under the bed: in third-person the
  // camera floats above/behind the cat and clips through the mattress,
  // and even in first-person the side rails or footboard can sit
  // between the camera and the binder. We can't use the global
  // clickPassthrough flag here because fireball and kamehameha damage
  // rays also honor it — that would let attacks pass through the bed.
  // Headboard is intentionally left untagged since the binder sits in
  // front of it; preserves the "can't click through the back wall"
  // expectation. Rendering and physics are unchanged.
  const _bedPass = (m) => { if (m) m.userData.bedPart = true; return m; };
  // Upholstered headboard (full height, at back of bed)
  const hbThick = 3, hbH = bedH - bedClearance, hbW = bedW;
  const headboard = roomRoundBox(hbW, hbH, hbThick, 2, 0x4a4a55,
    bedX, floorY + bedClearance + hbH / 2, bedZ + bedL / 2 - hbThick / 2, 0, 0, 0);
  // Give headboard a fabric look
  headboard.material.roughness = 0.95;

  // Side rails — upholstered panels running the length
  const railH = bedSlatsFromFloor - bedClearance; // height from clearance to slat level = 7.5"
  const railThick = 1.5;
  const railY = floorY + bedClearance + railH / 2;
  // Left rail
  const lRail = _bedPass(roomRoundBox(railThick, railH, bedL, 1, 0x4a4a55,
    bedX - bedW / 2 + railThick / 2, railY, bedZ, 0, 0, 0));
  lRail.material.roughness = 0.95;
  // Right rail
  const rRail = _bedPass(roomRoundBox(railThick, railH, bedL, 1, 0x4a4a55,
    bedX + bedW / 2 - railThick / 2, railY, bedZ, 0, 0, 0));
  rRail.material.roughness = 0.95;

  // Footboard — lower profile
  const fbH = railH, fbThick = 2;
  const footboard = _bedPass(roomRoundBox(bedW, fbH, fbThick, 1.5, 0x4a4a55,
    bedX, railY, bedZ - bedL / 2 + fbThick / 2, 0, 0, 0));
  footboard.material.roughness = 0.95;

  // Slat platform (at 14" from floor)

  const slatY = floorY + bedSlatsFromFloor;
  _bedPass(roomBox(bedW - 2 * railThick, 1.0, bedL - hbThick - fbThick, 0x3a3a44,
    bedX, slatY, bedZ + (hbThick - fbThick) / 2, 0, 0, 0));

  // Legs — cylinders at corners reaching from floor to slat platform
  const legBedH = bedSlatsFromFloor, legBedR = 1.2;
  const legPositions = [
    [bedX - bedW / 2 + 3, bedZ - bedL / 2 + 3],
    [bedX + bedW / 2 - 3, bedZ - bedL / 2 + 3],
    [bedX - bedW / 2 + 3, bedZ + bedL / 2 - 3],
    [bedX + bedW / 2 - 3, bedZ + bedL / 2 - 3],
  ];
  for (const [lx, lz] of legPositions) {
    const lg = new THREE.CylinderGeometry(legBedR, legBedR, legBedH, 12);
    const lm = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const lmesh = new THREE.Mesh(lg, lm);
    lmesh.position.set(lx, floorY + legBedH / 2, lz);
    lmesh.castShadow = false; lmesh.receiveShadow = true; lmesh._isRoom = true;
    _bedPass(lmesh);
    addRoom(lmesh);
  }

  // Under-bed frame — center rail + cross supports (visible when cat walks under)
  const bedFrameY = floorY + bedSlatsFromFloor - 0.5; // just below slat platform
  // Center rail running length of bed
  const centerRailW = 2, centerRailH = 1.5;
  const innerL = bedL - hbThick - fbThick;
  _bedPass(roomBox(centerRailW, centerRailH, innerL, 0x2a2a2a,
    bedX, bedFrameY - centerRailH / 2, bedZ + (hbThick - fbThick) / 2, 0, 0, 0));
  // Cross supports (4 evenly spaced)
  const innerW = bedW - 2 * railThick - 2;
  const crossH = 1.2, crossD = 2;
  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    const cz = bedZ - innerL / 2 + innerL * t + (hbThick - fbThick) / 2;
    _bedPass(roomBox(innerW, crossH, crossD, 0x2a2a2a,
      bedX, bedFrameY - crossH / 2, cz, 0, 0, 0));
  }

  // Mattress (approx 60"×80"×10")
  const mattW = 58, mattL = 78, mattH = 10;
  const mattY = slatY + 1 + mattH / 2;
  const mattCenterZ = bedZ + (hbThick - fbThick) / 2;
  const mattress = _bedPass(roomRoundBox(mattW, mattH, mattL, 3, 0xd4cdc0,
    bedX, mattY, mattCenterZ, 0, 0, 0));
  mattress.material.roughness = 0.92;
  mattress.material.color.set(0xd4cdc0);

  // Pillow pair — puffy rectangular shapes via vertex-displaced box
  const pillowW = 22, pillowH = 4, pillowD = 14;
  const pillowY = mattY + mattH / 2 - 0.8; // sits snug on mattress surface
  const pillowBaseZ = bedZ + bedL / 2 - hbThick - pillowD / 2 - 2;
  const pillows = [];
  for (const px of [-13, 13]) {
    const pGeo = new THREE.BoxGeometry(pillowW, pillowH, pillowD, 16, 8, 12);
    const pp = pGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      // Normalized coords (-1 to 1)
      const nx = x / (pillowW / 2), ny = y / (pillowH / 2), nz = z / (pillowD / 2);
      // Round the edges: pull corners inward using a soft rounding
      const edgeRound = 2.5;
      const ex = Math.max(0, Math.abs(x) - pillowW / 2 + edgeRound);
      const ey = Math.max(0, Math.abs(y) - pillowH / 2 + edgeRound);
      const ez = Math.max(0, Math.abs(z) - pillowD / 2 + edgeRound);
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (dist > edgeRound) {
        const scale = edgeRound / dist;
        if (ex > 0) x = Math.sign(x) * (pillowW / 2 - edgeRound + ex * scale);
        if (ey > 0) y = Math.sign(y) * (pillowH / 2 - edgeRound + ey * scale);
        if (ez > 0) z = Math.sign(z) * (pillowD / 2 - edgeRound + ez * scale);
      }
      // Puffiness: inflate top center upward
      const cx = nx * nx, cz = nz * nz;
      const puff = (1 - cx) * (1 - cz);
      if (y > 0) y += puff * 1.5;
      // Flatten bottom slightly
      if (y < 0) y *= 0.6;
      pp.setX(i, x); pp.setY(i, y); pp.setZ(i, z);
    }
    pGeo.computeVertexNormals();
    const pMat = stdMat({ color: 0xeae6de, roughness: 0.92 });
    const pillow = new THREE.Mesh(pGeo, pMat);
    pillow.position.set(bedX + px, pillowY + pillowH / 2, pillowBaseZ);
    pillow.rotation.set(0, px > 0 ? 0.05 : -0.05, px > 0 ? -0.03 : 0.03);
    pillow.castShadow = true; pillow.receiveShadow = true; pillow._isRoom = true;
    _bedPass(pillow);
    addRoom(pillow);
    pillows.push(pillow);
  }

  // Duvet / comforter — thin blanket that drapes over mattress edges
  const duvetH = 1.5;
  const duvetL = mattL - pillowD - 4;
  const duvetZ = mattCenterZ - (mattL / 2 - duvetL / 2) - 1.5; // shifted toward foot of bed
  // Generate a wrinkle normal map
  const duvetCanvas = document.createElement('canvas');
  duvetCanvas.width = 256; duvetCanvas.height = 256;
  const dctx = duvetCanvas.getContext('2d');
  dctx.fillStyle = '#6b6b72';
  dctx.fillRect(0, 0, 256, 256);
  // Dense velvet fiber texture — short fuzzy strokes for fabric feel
  for (let i = 0; i < 3000; i++) {
    const fx = Math.random() * 256, fy = Math.random() * 256;
    const bright = 90 + Math.random() * 40;
    dctx.strokeStyle = `rgba(${bright},${bright - 2},${bright + 4},${0.15 + Math.random() * 0.2})`;
    dctx.lineWidth = 0.5 + Math.random() * 1.5;
    dctx.beginPath();
    dctx.moveTo(fx, fy);
    dctx.lineTo(fx + Math.random() * 4 - 2, fy + 2 + Math.random() * 4);
    dctx.stroke();
  }
  // Subtle wrinkle folds on top
  for (let i = 0; i < 25; i++) {
    const y = Math.random() * 256;
    dctx.strokeStyle = `rgba(${85 + Math.random() * 25},${83 + Math.random() * 22},${90 + Math.random() * 22},${0.08 + Math.random() * 0.12})`;
    dctx.lineWidth = 3 + Math.random() * 5;
    dctx.beginPath();
    dctx.moveTo(0, y + Math.random() * 10);
    for (let x = 0; x < 256; x += 20) {
      dctx.lineTo(x, y + Math.sin(x * 0.05) * 8 + Math.random() * 6);
    }
    dctx.stroke();
  }
  const duvetTex = new THREE.CanvasTexture(duvetCanvas);
  duvetTex.wrapS = duvetTex.wrapT = THREE.RepeatWrapping;
  duvetTex.repeat.set(3, 4);
  // Generate a bump map for extra fabric relief
  const _bumpCanvas = document.createElement('canvas');
  _bumpCanvas.width = 256; _bumpCanvas.height = 256;
  const _bctx = _bumpCanvas.getContext('2d');
  _bctx.fillStyle = '#808080';
  _bctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const bx = Math.random() * 256, by = Math.random() * 256;
    const v = Math.random() > 0.5 ? 140 + Math.random() * 50 : 60 + Math.random() * 50;
    _bctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
    _bctx.fillRect(bx, by, 1 + Math.random() * 2, 1 + Math.random() * 3);
  }
  const duvetBump = new THREE.CanvasTexture(_bumpCanvas);
  duvetBump.wrapS = duvetBump.wrapT = THREE.RepeatWrapping;
  duvetBump.repeat.set(4, 6);
  // Continuous blanket — single mesh with vertex-displaced draped edges (no seams)
  const _bSideHang = 2.5, _bFootHang = 3, _bMaxDrape = 10;
  const _bTotW = mattW + _bSideHang * 2, _bTotL = duvetL + _bFootHang;
  const blanketGeo = new THREE.BoxGeometry(_bTotW, duvetH, _bTotL, 28, 1, 36);
  const _bp = blanketGeo.attributes.position;
  for (let i = 0; i < _bp.count; i++) {
    let x = _bp.getX(i), y = _bp.getY(i), z = _bp.getZ(i);
    z -= _bFootHang / 2; // shift so extra length extends past foot (-Z)
    // Side drape: vertices past mattress edge drop nearly straight down
    const sx = Math.max(0, Math.abs(x) - mattW / 2);
    const sideDrop = sx > 0 ? _bMaxDrape * (sx / _bSideHang) : 0;
    if (sx > 0) x = Math.sign(x) * (mattW / 2 + sx * 0.25);
    // Foot drape: vertices past foot edge drop nearly straight down
    const fz = Math.max(0, -duvetL / 2 - z);
    const footDrop = fz > 0 ? _bMaxDrape * (fz / _bFootHang) : 0;
    if (fz > 0) z = -duvetL / 2 - fz * 0.25;
    // Use the larger of the two drops at corners (not the sum) so corner
    // vertices don't stretch to an unnatural point below the edge drape.
    const drop = Math.max(sideDrop, footDrop);
    _bp.setX(i, x); _bp.setY(i, y - drop); _bp.setZ(i, z);
  }
  blanketGeo.computeVertexNormals();
  const duvet = new THREE.Mesh(blanketGeo, stdMat({ color: 0x6e6e78, roughness: 1.0, metalness: 0.0, map: duvetTex, bumpMap: duvetBump, bumpScale: 0.1 }));
  duvet.position.set(bedX, mattY + mattH / 2 + duvetH / 2, duvetZ);
  duvet.castShadow = true; duvet.receiveShadow = true; duvet._isRoom = true;
  _bedPass(duvet);
  addRoom(duvet);

  // ── Items under the bed ────────────────────────────────────────────
  {
    const underBedY = floorY;

    // Pokémon card binder — childhood binder with cover/spine art.
    // Click anywhere on it to open; first open spawns the secret blue coin.
    {
      // Body dimensions match the cover image aspect ratio (788:895 → W:D)
      // so the cover art on top isn't stretched.
      const W = 12;        // body width along local X
      const D = 13.62;     // body depth along local Z (W * 895/788)
      const baseH = 0.25;  // bottom cover thickness
      const pagesH = 1.0;  // page-stack height
      const totalH = 1.7;  // closed binder total height (top of spine)
      const topH = 0.22;   // top cover thickness
      const spineThick = 0.55; // spine bulges this far past the body in -X

      // Tucked into the headboard/door-wall side under the bed, near the
      // window-side rail.
      const binderX = bedX - 11;       // pre-mirror; nudged toward window wall
      const binderZ = bedZ + 22;       // nudged back toward door/headboard wall
      const binderRoot = new THREE.Group();
      binderRoot.position.set(binderX, underBedY, binderZ);
      binderRoot.rotation.y = 130 * Math.PI / 180; // -50° + 180° (mirror flips sign)
      binderRoot._isRoom = true;       // X-mirror flips its position only
      binderRoot._isPokemonBinder = true; // makes any descendant clickable
      // NOTE: children below are NOT _isRoom — they ride along in local frame
      // so only binderRoot's X gets mirrored (not double-mirrored children).
      scene.add(binderRoot);

      const texLoader = new THREE.TextureLoader();
      const coverTex = texLoader.load('img/childhood_pokemon_binder_cover.jpg', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (state.renderer) t.anisotropy = Math.min(8, state.renderer.capabilities.getMaxAnisotropy());
      });
      const spineTex = texLoader.load('img/childhood_pokemon_binder_spine.jpg', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (state.renderer) t.anisotropy = Math.min(8, state.renderer.capabilities.getMaxAnisotropy());
        // Image is 141w × 895h (tall). The spine's -X face is wide×short
        // (Z=D, Y=totalH). Rotate the texture 90° so the image's long axis
        // aligns with the long Z axis of the face — preserves aspect ratio.
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 2;
      });

      const redMat = new THREE.MeshStandardMaterial({ color: 0x6b1313, roughness: 0.72, metalness: 0.04 });
      const pagesMat = new THREE.MeshStandardMaterial({ color: 0xece2c8, roughness: 0.88 });

      // Bottom cover
      const bottomCover = new THREE.Mesh(new THREE.BoxGeometry(W, baseH, D), redMat);
      bottomCover.position.set(0, baseH / 2, 0);
      bottomCover.receiveShadow = true; bottomCover.castShadow = true;
      binderRoot.add(bottomCover);

      // Page stack — slightly inset from the spine edge (binder-ring gap)
      const pagesW = W - 1.2;
      const pagesD = D - 0.5;
      const pagesXOffset = 0.55; // shift toward open edge
      const pages = new THREE.Mesh(new THREE.BoxGeometry(pagesW, pagesH, pagesD), pagesMat);
      pages.position.set(pagesXOffset, baseH + pagesH / 2, 0);
      pages.receiveShadow = true;
      binderRoot.add(pages);

      // Spine — full-height vertical strip on the -X edge with the spine
      // art on its outer (-X) face.
      const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.62 });
      const spineMats = [
        redMat,           // +X — inner, never seen
        spineMat,         // -X — outer, shows spine art
        redMat, redMat,   // +Y / -Y caps
        redMat, redMat    // +Z / -Z ends
      ];
      const spineMesh = new THREE.Mesh(new THREE.BoxGeometry(spineThick, totalH, D), spineMats);
      spineMesh.position.set(-W / 2 - spineThick / 2, totalH / 2, 0);
      spineMesh.castShadow = true; spineMesh.receiveShadow = true;
      binderRoot.add(spineMesh);

      // Top-cover hinge group at the spine's top edge
      const hinge = new THREE.Group();
      hinge.position.set(-W / 2, totalH, 0);
      binderRoot.add(hinge);

      // Top cover with binder-cover art on its top (+Y) face
      const coverFaceMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.55 });
      const topMats = [
        redMat, redMat,
        coverFaceMat,   // +Y — cover art
        redMat,         // -Y — inner side
        redMat, redMat
      ];
      const topCover = new THREE.Mesh(new THREE.BoxGeometry(W, topH, D), topMats);
      // Cover extends in +X from the hinge, sitting just below local Y=0 so
      // the hinge axis runs along the spine's top edge.
      topCover.position.set(W / 2, -topH / 2, 0);
      topCover.castShadow = true; topCover.receiveShadow = true;
      hinge.add(topCover);

      // Closed slant: cover dips toward the open edge because the page stack
      // is shorter than the spine is tall. atan2(drop, run).
      const dropAtOpenEdge = totalH - (baseH + pagesH);
      const closedSlant = -Math.atan2(dropAtOpenEdge, W);
      hinge.rotation.z = closedSlant;

      // 3×3 grid of yellow rounded "Pokémon cards" sitting on the page stack.
      // Hidden when the cover is closed.
      const cardsGroup = new THREE.Group();
      cardsGroup.visible = false;
      binderRoot.add(cardsGroup);

      const cardW = 2.6, cardD = 3.6, cardThick = 0.06;
      const cardMat = new THREE.MeshStandardMaterial({ color: 0xf2c83a, roughness: 0.55, metalness: 0.06 });
      const cardGeo = (() => {
        const r = 0.32, hw = cardW / 2, hd = cardD / 2;
        const sh = new THREE.Shape();
        sh.moveTo(-hw + r, -hd);
        sh.lineTo(hw - r, -hd);
        sh.quadraticCurveTo(hw, -hd, hw, -hd + r);
        sh.lineTo(hw, hd - r);
        sh.quadraticCurveTo(hw, hd, hw - r, hd);
        sh.lineTo(-hw + r, hd);
        sh.quadraticCurveTo(-hw, hd, -hw, hd - r);
        sh.lineTo(-hw, -hd + r);
        sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
        const g = new THREE.ExtrudeGeometry(sh, { depth: cardThick, bevelEnabled: false });
        g.rotateX(-Math.PI / 2); // extrude along +Y
        g.translate(0, cardThick, 0); // bottom flush at local y=0
        return g;
      })();
      const colStep = (pagesW - 0.6) / 3;
      const rowStep = (pagesD - 0.6) / 3;
      const cardY = baseH + pagesH + 0.005;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const card = new THREE.Mesh(cardGeo, cardMat);
          const cx = (col - 1) * colStep + pagesXOffset;
          const cz = (row - 1) * rowStep;
          card.position.set(cx, cardY, cz);
          card.receiveShadow = true;
          cardsGroup.add(card);
        }
      }

      // ── State + animation ─────────────────────────────────────
      // Open angle: rotate hinge.z so the cover swings up and over the spine,
      // settling roughly face-down on the floor on the other side.
      const openAngle = Math.PI * 1.02;
      const binderState = { open: false, progress: 0, animTimer: 0, coinSpawned: false };
      binderRoot._pokemonBinderState = binderState;

      function _applyHinge() {
        hinge.rotation.z = closedSlant + (openAngle - closedSlant) * binderState.progress;
        cardsGroup.visible = binderState.progress > 0.45;
      }

      function _step() {
        const target = binderState.open ? 1 : 0;
        binderState.progress += (target - binderState.progress) * 0.16;
        if (Math.abs(target - binderState.progress) < 0.002) {
          binderState.progress = target;
          _applyHinge();
          binderState.animTimer = 0;
          return;
        }
        _applyHinge();
        binderState.animTimer = requestAnimationFrame(_step);
      }

      function togglePokemonBinder() {
        binderState.open = !binderState.open;
        let coinPos = null;
        if (binderState.open && !binderState.coinSpawned) {
          binderState.coinSpawned = true;
          // World-space spawn point above the open binder.
          binderRoot.updateMatrixWorld(true);
          coinPos = new THREE.Vector3(0, totalH + 2.2, 0).applyMatrix4(binderRoot.matrixWorld);
        }
        if (!binderState.animTimer) binderState.animTimer = requestAnimationFrame(_step);
        return { opened: binderState.open, coinPos };
      }
      window._togglePokemonBinder = togglePokemonBinder;

      // Run reset hook: snap closed and clear coin-spawn flag so the
      // secret can re-spawn on the next open.
      window._resetPokemonBinder = function () {
        binderState.open = false;
        binderState.progress = 0;
        binderState.coinSpawned = false;
        if (binderState.animTimer) {
          cancelAnimationFrame(binderState.animTimer);
          binderState.animTimer = 0;
        }
        _applyHinge();
      };
    }
  }

  // Enable shadows on key furniture (not walls/baseboards/trim — those don't need it)
  [headboard, lRail, rRail, footboard, mattress, duvet].forEach(m => { m.castShadow = true; });

  // XYZ axis helper — press 'X' to toggle (positioned beside purifier)
  const axesGroup = new THREE.Group();
  const axesOrig = new THREE.Vector3(panelW / 2 + 4, -H / 2 - ply, D / 2 + ply + 4); // front-right of purifier, at foot level
  axesGroup.position.copy(axesOrig);
  // Build thick arrow axes that render on top of everything
  {
    const axLen = 22, shaftR = 0.35, coneR = 1.2, coneH = 3.5;
    const axes = [
      { dir: [1, 0, 0], color: 0xff4444, label: 'X' },
      { dir: [0, 1, 0], color: 0x44ff44, label: 'Y' },
      { dir: [0, 0, 1], color: 0x4488ff, label: 'Z' },
    ];
    axes.forEach(a => {
      const mat = new THREE.MeshBasicMaterial({ color: a.color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
      // Shaft (cylinder along Y, then rotated)
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, axLen, 8), mat);
      shaft.renderOrder = 999;
      // Arrowhead cone
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 12), mat);
      cone.renderOrder = 999;
      // Position along the correct axis
      const dx = a.dir[0], dy = a.dir[1], dz = a.dir[2];
      if (dx) { // X axis
        shaft.rotation.z = -Math.PI / 2;
        shaft.position.set(axLen / 2, 0, 0);
        cone.rotation.z = -Math.PI / 2;
        cone.position.set(axLen + coneH / 2, 0, 0);
      } else if (dy) { // Y axis
        shaft.position.set(0, axLen / 2, 0);
        cone.position.set(0, axLen + coneH / 2, 0);
      } else { // Z axis
        shaft.rotation.x = Math.PI / 2;
        shaft.position.set(0, 0, axLen / 2);
        cone.rotation.x = Math.PI / 2;
        cone.position.set(0, 0, axLen + coneH / 2);
      }
      axesGroup.add(shaft);
      axesGroup.add(cone);
      // Label (makeTextSprite not available in module — skip for now)
      // const hexStr='#'+a.color.toString(16).padStart(6,'0');
      // const lbl=makeTextSprite(a.label,hexStr);
      // lbl.position.set(dx*(axLen+coneH+3), dy*(axLen+coneH+3), dz*(axLen+coneH+3));
      // lbl.scale.multiplyScalar(2.0);
      // lbl.renderOrder=999;
      // lbl.material.depthTest=false;
      // axesGroup.add(lbl);
    });
  }
  // ── X-mirror pass ─────────────────────────────────────────────────
  // The monolith constructs the room in pre-mirror coordinates then
  // flips all _isRoom objects along X. This matches the spatial.js
  // coordinate system documentation.
  scene.traverse(obj => {
    if (obj._isRoom) {
      obj.position.x = -obj.position.x;
      obj.rotation.y = -obj.rotation.y;
    }
  });

  // Freeze world matrices on all static room objects (skip bifold — they animate)
  scene.traverse(obj => {
    if (obj.isMesh && !obj.isPoints && obj._isRoom && !obj._isBifoldLeaf && !obj._isStandingDesk) {
      obj.updateMatrixWorld(true);
      obj.matrixAutoUpdate = false;
    }
  });

  // Collect wall + baseboard meshes for time-of-day recoloring
  const wallMeshes = [];
  const baseMeshes = [];
  scene.traverse(obj => {
    if (obj.isMesh && obj._isRoom && obj.material) {
      const c = obj.material.color;
      if (!c) return;
      const hex = c.getHex();
      // Wall color 0xd8d4ce or close
      if (hex === 0xd8d4ce || hex === 0xd5d0ca || hex === 0xd0ccc6) wallMeshes.push(obj);
      // Baseboard color 0xc0bbb4
      if (hex === 0xc0bbb4) baseMeshes.push(obj);
    }
  });

  // Return refs for other modules
  // ── MacBook on the bed ───────────────────────────────────────────
  // Load assets/macbook.glb, place on the duvet, tag as _isMacbook
  let _macbookScreen = null;
  let _macbookRoot = null;
  let _macbookOn = false;
  let _macbookAudio = null;
  let _macbookBaseVol = 0.28;
  let _macbookProxVol = 1;
  const MUSIC_MUTE_KEY = 'diy_air_purifier_music_muted_v2';
  let _macbookMuted = false;
  try { _macbookMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) { }
  const _mbPlaylist = [
    { name: 'Octodad Theme', src: 'assets/songs/Octodad (Nobody Suspects a Thing).mp3', volume: 0.22 },
    { name: 'Escape from the City', src: 'assets/songs/Escape From The City ... for City Escape.mp3', volume: 0.22 },
    { name: 'Warthog Run', src: 'assets/songs/H3 Warthog Run OST - Copyright Free.mp3', volume: 0.22 },
    { name: 'Gerudo Valley', src: 'assets/songs/Gerudo Valley - The Legend of Zelda_ Ocarina Of Time Copyright free.mp3', volume: 0.22 },
  ];
  let _mbLastSongIdx = -1;
  // Cache one HTMLAudioElement per song so the browser streams it
  // progressively on first play and replays are instant from memory.
  const _mbAudioCache = new Map();
  function _getCachedAudio(song) {
    let a = _mbAudioCache.get(song.src);
    if (!a) {
      a = new Audio();
      a.preload = 'auto';          // start buffering ASAP
      a.crossOrigin = 'anonymous';
      a.src = song.src;
      try { a.load(); } catch (e) { }
      _mbAudioCache.set(song.src, a);
    }
    return a;
  }
  function _prefetchMacbookSongs() {
    for (const song of _mbPlaylist) _getCachedAudio(song);
  }

  function _pickMacbookSongIdx() {
    const n = _mbPlaylist.length;
    if (n <= 1) return 0;
    // Avoid repeating the same song twice in a row
    let idx = Math.floor(Math.random() * n);
    if (idx === _mbLastSongIdx) idx = (idx + 1) % n;
    return idx;
  }

  function _playMacbookTrack() {
    if (!_macbookOn) return;
    const idx = _pickMacbookSongIdx();
    _mbLastSongIdx = idx;
    const song = _mbPlaylist[idx];
    const audio = _getCachedAudio(song);
    // Rewind in case it was played previously
    try { audio.currentTime = 0; } catch (e) { }
    _macbookBaseVol = song.volume;
    audio.volume = _macbookBaseVol * _macbookProxVol;
    audio.muted = _macbookMuted;
    audio.loop = false;
    // Remove any stale listeners before attaching new ones
    if (audio._mbEndHandler) audio.removeEventListener('ended', audio._mbEndHandler);
    const onEnded = () => {
      if (_macbookAudio !== audio) return;
      _macbookAudio = null;
      if (_macbookOn) _playMacbookTrack();
    };
    audio._mbEndHandler = onEnded;
    audio.addEventListener('ended', onEnded);
    _macbookAudio = audio;
    // HTMLAudio streams progressively — .play() starts as soon as enough
    // data is buffered (typically a few hundred KB), not after full download.
    audio.play().catch(() => {
      if (_macbookAudio === audio) _macbookAudio = null;
    });
    // Warm up the other song(s) in the background for instant switching.
    _prefetchMacbookSongs();
  }

  // Load screen texture
  const _macbookLogoTex = new THREE.TextureLoader().load('assets/scummit-logo.webp');
  try { _macbookLogoTex.colorSpace = THREE.SRGBColorSpace; } catch (e) { /* ignore */ }

  {
    const mbLoader = new GLTFLoader();
    const slatY = floorY + bedSlatsFromFloor;
    const mattH = 10, mattY2 = slatY + 1 + mattH / 2;
    const duvetH = 1.5;
    const bedTopY = mattY2 + mattH / 2 + duvetH;
    const mattW = 58;
    // Suppress GLTFLoader UV set warnings (macbook.glb uses custom UV sets unsupported by r128)
    const _origWarn = console.warn;
    console.warn = (...args) => {
      if (typeof args[0] === 'string' && args[0].includes('Custom UV set')) return;
      _origWarn.apply(console, args);
    };
    // Defer loading the 8.5MB macbook.glb to idle time so it doesn't compete
    // with the character-select cat GLBs and main scene textures on first
    // paint. The macbook appears on the bed a moment later, which is fine.
    const _kickMacbookLoad = () => mbLoader.load('assets/macbook.glb', (gltf) => {
      console.warn = _origWarn; // restore
      const root = gltf.scene;
      // Scale to ~14" wide
      const bb = new THREE.Box3().setFromObject(root);
      const sz = bb.getSize(new THREE.Vector3());
      const longest = Math.max(sz.x, sz.z);
      if (longest > 0) root.scale.setScalar(14 / longest);
      root.updateMatrixWorld(true);
      const localBB = new THREE.Box3().setFromObject(root);
      const localSize = localBB.getSize(new THREE.Vector3());
      // Place on duvet (post-mirror coords — async load skips mirror pass)
      // position.x = -rawX = worldX directly. More negative rawX = higher worldX = closer to window.
      // +24 to rawX moves 2ft AWAY from window.
      const rawX = bedX - mattW / 2 + 12 + 24;
      root.position.set(-rawX, bedTopY - localBB.min.y, bedZ + 6);
      root.rotation.y = Math.PI + 25 * Math.PI / 180; // rotated ~25° for natural look
      root._isRoom = true;
      root.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o._isMacbook = true; }
      });
      _macbookRoot = root;

      // Screen overlay plane — matches monolith's exact positioning knobs
      const screenW = localSize.x * 0.96;
      const screenH = screenW * 0.68;
      const cornerR = screenH * 0.04;

      // Rounded-rect shape for screen border radius
      const rrShape = new THREE.Shape();
      const w = screenW, h = screenH, r = Math.min(cornerR, w / 2, h / 2);
      const sx = -w / 2, sy = -h / 2;
      rrShape.moveTo(sx + r, sy);
      rrShape.lineTo(sx + w - r, sy);
      rrShape.quadraticCurveTo(sx + w, sy, sx + w, sy + r);
      rrShape.lineTo(sx + w, sy + h - r);
      rrShape.quadraticCurveTo(sx + w, sy + h, sx + w - r, sy + h);
      rrShape.lineTo(sx + r, sy + h);
      rrShape.quadraticCurveTo(sx, sy + h, sx, sy + h - r);
      rrShape.lineTo(sx, sy + r);
      rrShape.quadraticCurveTo(sx, sy, sx + r, sy);

      const scrGeo = new THREE.ShapeGeometry(rrShape, 12);
      // Remap UVs to [0,1] so texture fills correctly
      {
        const pos = scrGeo.attributes.position;
        const uv = scrGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          uv.setXY(i, (pos.getX(i) + screenW / 2) / screenW, (pos.getY(i) + screenH / 2) / screenH);
        }
        uv.needsUpdate = true;
      }

      const scrMat = new THREE.MeshBasicMaterial({
        map: _macbookLogoTex, color: 0xffffff,
        toneMapped: false, side: THREE.DoubleSide
      });
      _macbookScreen = new THREE.Mesh(scrGeo, scrMat);
      _macbookScreen._isMacbook = true;

      // The plane inherits root.scale, so pre-divide to get world inches
      const invScale = 1 / (root.scale.x || 1);
      _macbookScreen.scale.setScalar(invScale);

      // Position using monolith's screen knobs (fractions of local bbox)
      const screenX_frac = 0.5;
      const screenY_frac = 0.525;
      const screenZ_off = -0.19;
      const cx = THREE.MathUtils.lerp(localBB.min.x, localBB.max.x, screenX_frac) * invScale;
      const lidY = (localBB.min.y + localSize.y * screenY_frac) * invScale;
      const frontZ = (localBB.min.z - screenZ_off) * invScale;
      _macbookScreen.position.set(cx, lidY, frontZ);
      _macbookScreen.rotation.y = Math.PI; // face toward player
      _macbookScreen.visible = false;
      root.add(_macbookScreen);

      scene.add(root);
    });
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(_kickMacbookLoad, { timeout: 2500 });
    } else {
      setTimeout(_kickMacbookLoad, 600);
    }
    // Begin buffering songs in the background during idle time so the
    // first click on the macbook starts playback nearly instantly.
    const _kickSongPrefetch = () => _prefetchMacbookSongs();
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(_kickSongPrefetch, { timeout: 8000 });
    } else {
      setTimeout(_kickSongPrefetch, 3000);
    }
  }

  // TV toggle function (called from purifier click handler via roomRefs)
  let _tvOn = true;
  function toggleTV() {
    _tvOn = !_tvOn;
    if (screen) {
      screen.material.emissiveIntensity = _tvOn ? 0.85 : 0;
      if (_tvOn) {
        screen.material.color.setHex(0x000000);
        screen.material.roughness = 0.4;
      } else {
        screen.material.color.setHex(0x050505);
        screen.material.roughness = 0.05;
      }
      screen.material.needsUpdate = true;
    }
    if (tvGlow) tvGlow.intensity = _tvOn ? 50 : 0;
  }

  // MacBook toggle function (called from purifier click handler via roomRefs)
  function toggleMacbook() {
    _macbookOn = !_macbookOn;
    if (_macbookScreen) _macbookScreen.visible = _macbookOn;
    if (_macbookOn) {
      // Start music
      if (!_macbookAudio) _playMacbookTrack();
    } else {
      // Stop music
      if (_macbookAudio) {
        _macbookAudio.pause();
        _macbookAudio.currentTime = 0;
        _macbookAudio = null;
      }
    }
  }

  function setMacbookMuted(muted) {
    _macbookMuted = !!muted;
    try { localStorage.setItem(MUSIC_MUTE_KEY, _macbookMuted ? '1' : '0'); } catch (e) { }
    if (_macbookAudio) _macbookAudio.muted = _macbookMuted;
  }

  // Proximity volume: full at ≤24" (~2 ft), steep inverse-square dropoff after that,
  // but never below a minimum floor so far-away players still hear it faintly.
  const _mbTmpVec = new THREE.Vector3();
  function updateMacbookProximity(playerPos) {
    if (!_macbookAudio || !_macbookRoot || !playerPos) return;
    _macbookRoot.getWorldPosition(_mbTmpVec);
    const dx = _mbTmpVec.x - playerPos.x;
    const dy = _mbTmpVec.y - playerPos.y;
    const dz = _mbTmpVec.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const near = 24;      // 2 ft — full volume inside this radius
    const floorVol = 0.18; // minimum proximity multiplier at extreme distance
    let prox = 1;
    if (dist > near) {
      const k = near / dist; // inverse distance
      prox = floorVol + (1 - floorVol) * (k * k); // square for steep dropoff
    }
    // Smooth toward target to avoid zipper noise
    _macbookProxVol += (prox - _macbookProxVol) * 0.2;
    try { _macbookAudio.volume = Math.max(0, Math.min(1, _macbookBaseVol * _macbookProxVol)); } catch (e) { }
  }

  function resetMacbookProximity() {
    _macbookProxVol = 1;
    if (_macbookAudio) {
      try { _macbookAudio.volume = _macbookBaseVol; } catch (e) { }
    }
  }

  return {
    floorY, floorMat, ceilingMat, floor, ceiling,
    wallMeshL: typeof wallMeshL !== 'undefined' ? wallMeshL : null,
    oppWall: typeof oppWall !== 'undefined' ? oppWall : null,
    rightWall: typeof rightWall !== 'undefined' ? rightWall : null,
    outdoor: typeof outdoor !== 'undefined' ? outdoor : null,
    bedX, bedZ, bedL, bedW, bedH, bedClearance,
    tblX, tblZ, tblW, tblD, tblH,
    winCenterY, winCenterZ, winW, winH,
    // Lighting refs
    ceilLightOn, ceilLightX, ceilLightZ, ceilY,
    domeMat, mirroredWindowX: -leftWallX,
    winTop, winBottom, winFront, winBack,
    wallMeshes, baseMeshes,
    tvCenterX, tvCenterY, tvZ, tvD,
    lampLight, lampOn,
    lampShade: typeof lampShade !== 'undefined' ? lampShade : null,
    ceilSpot: typeof ceilSpot !== 'undefined' ? ceilSpot : null,
    ceilGlow: typeof ceilGlow !== 'undefined' ? ceilGlow : null,
    moonGlow: typeof moonGlow !== 'undefined' ? moonGlow : null,
    outdoorDayTex: _outdoorDayTex,
    outdoorNightTex: _outdoorNightTex,
    windowIsNight: _windowIsNight,
    leftWallX,
    toggleCornerDoor,
    applyPushCornerDoor,
    isCornerDoorOpen: () => Math.abs(_cornerDoorAngle) > 0.05,
    getCornerDoorPanelMesh: () => doorPanel,
    getCornerDoorAngle: () => _cornerDoorAngle,
    toggleGuestDoor: toggleGuestDoor || (() => false),
    applyPushGuestDoor: applyPushGuestDoor || (() => {}),
    isGuestDoorOpen: _guestDoorOpenState,
    getGuestDoorPanelMesh: () => _guestDoorPanelMesh,
    doorKnobs,
    toggleTV,
    toggleMacbook,
    setMacbookMuted,
    updateMacbookProximity,
    resetMacbookProximity,
    getMacbookScreenMesh: () => _macbookScreen,
    drawers,
    toggleFoodBowl: () => {
      if (!_foodGroup || !_foodGroup.length) return false;
      const show = !_foodGroup[0].visible;
      for (const k of _foodGroup) { k.visible = show; k.matrixAutoUpdate = true; k.updateMatrixWorld(true); k.matrixAutoUpdate = false; }
      return show;
    },
    isFoodVisible: () => _foodGroup && _foodGroup.length ? _foodGroup[0].visible : false,
    getFoodBowlMesh: () => _foodBowlMesh,
    // Mini-split (clickable A/C unit on the TV wall)
    setMiniSplitOn,
    isMiniSplitOn,
    updateMiniSplit,
    resetMiniSplit,
    toggleDebugWallLabels: (show) => {
      const vis = typeof show === 'boolean' ? show : !_debugWallLabels[0]?.visible;
      for (const l of _debugWallLabels) l.visible = vis;
      return vis;
    },
    areDebugWallLabelsVisible: () => _debugWallLabels[0]?.visible ?? false,
    // Office window open/close state
    getOfficeWindowModel: () => _officeWindowModel,
    isOfficeWindowOpen: () => _officeWindowOpen,
    setOfficeWindowOpen: (v) => { _officeWindowOpen = v; },
    // Office window opening coords (pre-mirror, for collision)
    grWinCenterZ: typeof grWinCenterZ !== 'undefined' ? grWinCenterZ : 0,
    grWinBottom: typeof grWinBottom !== 'undefined' ? grWinBottom : 0,
    grWinTop: typeof grWinTop !== 'undefined' ? grWinTop : 0,
    grWinLeft: typeof grWinLeft !== 'undefined' ? grWinLeft : 0,
    grWinRight: typeof grWinRight !== 'undefined' ? grWinRight : 0,
    standingDesk: _standingDeskRef,
    // Avatar painting (window-wall) — poster-fireball reads this to know
    // where to spawn its drop animation. Pre-mirror Y/Z; X is mirrored
    // by main.js / readers (the room's parent group flips X).
    avatarPoster: _avatarPosterCenter
  };
}
