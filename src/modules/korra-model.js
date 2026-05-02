// ─── Procedural Korra Cat Model ─────────────────────────────────────
// Builds a grey-and-white bicolor cat from vertex-sculpted geometry
// with a bone skeleton for animation.
//
// Technique: high-segment BoxGeometry with per-vertex displacement
// (same approach as the pillow on the bed) to create organic shapes.
//
// Korra is a blue-grey and white domestic shorthair:
//   - Grey: entire back, top of head, ears, tail
//   - White: belly, lower sides, chest, all legs, lower face/chin
//   - Sharp color boundary, no gradients
//   - Pink nose, green-yellow eyes

import * as THREE from 'three';

// ── Colors ─────────────────────────────────────────────────────────

const GREY = new THREE.Color(0x6b7b8d);
const WHITE = new THREE.Color(0xf0ede8);
const PINK = 0xd4b0ab;
const EYE_GREEN = 0x8fad5a;
const PUPIL = 0x111111;
const EYE_WHITE = 0xf5f5f0;

// ── Material helpers ───────────────────────────────────────────────

// Procedural fur bump texture — fine directional noise
function _furBumpMap() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  // Base mid-grey
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  // Fine streaks to simulate short fur grain
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 2 + Math.random() * 5;
    const bright = 100 + Math.floor(Math.random() * 56);
    ctx.strokeStyle = `rgb(${bright},${bright},${bright})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Mostly vertical streaks (fur direction) with slight random angle
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

const _furBump = _furBumpMap();

function _mat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex, roughness: opts.rough ?? 0.85, metalness: 0,
    bumpMap: opts.fur !== false ? _furBump : null,
    bumpScale: opts.fur !== false ? 0.012 : 0,
    ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 0.15 } : {})
  });
}

const greyMat = _mat(0x6b7b8d);
const whiteMat = _mat(0xf0ede8);
const pinkMat = _mat(PINK, { fur: false });
const eyeGreenMat = _mat(EYE_GREEN, { rough: 0.3, emissive: EYE_GREEN, ei: 0.08, fur: false });
const pupilMat = _mat(PUPIL, { rough: 0.5, fur: false });
const eyeWhiteMat = _mat(EYE_WHITE, { rough: 0.4, fur: false });

const vcMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.85, metalness: 0,
  bumpMap: _furBump, bumpScale: 0.012
});

// Quick geo helpers for small detail parts
const _sphere = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const _cylinder = (rt, rb, ht, seg = 8) => new THREE.CylinderGeometry(rt, rb, ht, seg);
const _cone = (r, ht, seg = 6) => new THREE.ConeGeometry(r, ht, seg);

// Merge two BufferGeometries into one (position + normal + index only)
function _mergeBufferGeometries(a, b) {
  const ap = a.attributes.position, bp = b.attributes.position;
  const an = a.attributes.normal, bn = b.attributes.normal;
  const verts = new Float32Array(ap.count * 3 + bp.count * 3);
  const norms = new Float32Array(an.count * 3 + bn.count * 3);
  verts.set(ap.array); verts.set(bp.array, ap.count * 3);
  norms.set(an.array); norms.set(bn.array, an.count * 3);
  const ai = a.index ? Array.from(a.index.array) : [...Array(ap.count).keys()];
  const bi = b.index ? Array.from(b.index.array) : [...Array(bp.count).keys()];
  const idxs = ai.concat(bi.map(i => i + ap.count));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
  geo.setIndex(idxs);
  return geo;
}

// Build a smooth tube whose radius varies along its length.
// `radiusFn(t)` returns the radius at position t (0 = start, 1 = tip).
function _taperedTube(curve, tubSegs, radiusFn, radSegs) {
  const verts = [], idxs = [];

  for (let i = 0; i <= tubSegs; i++) {
    const t = i / tubSegs;
    const p = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    // Stable basis — curve is in YZ plane, so X=(1,0,0) is always perpendicular
    const N = new THREE.Vector3().crossVectors(T, new THREE.Vector3(1, 0, 0)).normalize();
    if (N.lengthSq() < 0.001) N.crossVectors(T, new THREE.Vector3(0, 1, 0)).normalize();
    const B = new THREE.Vector3().crossVectors(T, N).normalize();

    const r = radiusFn(t);
    for (let j = 0; j <= radSegs; j++) {
      const a = (j / radSegs) * Math.PI * 2;
      const sn = Math.sin(a), cs = Math.cos(a);
      verts.push(
        p.x + r * (cs * N.x + sn * B.x),
        p.y + r * (cs * N.y + sn * B.y),
        p.z + r * (cs * N.z + sn * B.z)
      );
    }
  }
  for (let i = 0; i < tubSegs; i++) {
    for (let j = 0; j < radSegs; j++) {
      const a = i * (radSegs + 1) + j;
      const b = a + radSegs + 1;
      idxs.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  return geo;
}

// ── Vertex-sculpted body ───────────────────────────────────────────
// Cat body: ~0.44 long (Z), ~0.20 wide (X), ~0.18 tall (Y)
// Rounded back arch, tucked belly, tapered at both ends (ribcage→hips).

function _sculptBody() {
  const W = 0.20, H = 0.18, L = 0.44;
  const geo = new THREE.BoxGeometry(W, H, L, 14, 10, 18);
  const pp = geo.attributes.position;

  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);

    // Normalized coords: -1 to 1
    const nx = x / (W / 2);
    const ny = y / (H / 2);
    const nz = z / (L / 2);

    // Taper width: narrower at front (chest) and back (hips)
    const zAbs = Math.abs(nz);
    const widthTaper = 1.0 - 0.2 * zAbs * zAbs; // subtle hourglass
    x *= widthTaper;

    // Taper height: slightly shorter at hips
    const heightTaper = 1.0 - 0.1 * Math.max(0, nz) * Math.abs(nz);
    y *= heightTaper;

    // Round the whole shape — pull corners inward spherically
    const edgeR = 0.04;
    const ex = Math.max(0, Math.abs(x) - W / 2 * widthTaper + edgeR);
    const ey = Math.max(0, Math.abs(y) - H / 2 * heightTaper + edgeR);
    const ez = Math.max(0, Math.abs(z) - L / 2 + edgeR);
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist > edgeR) {
      const s = edgeR / dist;
      if (ex > 0) x = Math.sign(x) * (W / 2 * widthTaper - edgeR + ex * s);
      if (ey > 0) y = Math.sign(y) * (H / 2 * heightTaper - edgeR + ey * s);
      if (ez > 0) z = Math.sign(z) * (L / 2 - edgeR + ez * s);
    }

    // Back arch: push top center upward in a gentle arc
    if (y > 0) {
      const archProfile = (1 - nx * nx); // stronger in center
      const archAlong = 1 - 0.3 * nz * nz; // flatter at ends
      y += archProfile * archAlong * 0.025;
    }

    // Belly tuck: pull bottom center upward slightly
    if (y < 0) {
      const tuckProfile = (1 - nx * nx);
      y *= 1.0 - tuckProfile * 0.15;
    }

    // Chest puff: push front-bottom slightly forward and down
    if (nz < -0.3) {
      const chestPush = Math.max(0, -nz - 0.3) * (1 - ny) * 0.5;
      z -= chestPush * 0.02;
    }

    pp.setX(i, x); pp.setY(i, y); pp.setZ(i, z);
  }

  // Paint vertex colors: grey on top, white on belly, hard cutoff
  _paintVCBody(geo);
  geo.computeVertexNormals();
  return geo;
}

function _paintVCBody(geo) {
  const pp = geo.attributes.position;
  const colors = new Float32Array(pp.count * 3);
  const W = 0.20, H = 0.18, L = 0.44;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const nx = x / (W / 2);   // -1..1 left-right
    const ny = y / (H / 2);   // -1..1 bottom-top
    const nz = z / (L / 2);   // -1..1 (-Z = chest/front, +Z = hips/back)

    // Saddle / cape pattern shaped by position along the torso:
    // - Mid-body: grey extends down the sides
    // - Front (chest, +Z): all white, wraps fully around including top
    // - Back (hips, -Z): grey on top, white on sides
    const absNz = Math.abs(nz);
    // How much grey is allowed to extend down — peaks in the middle of torso
    const midBody = 1 - absNz * absNz;            // 1 at center, 0 at ends
    const sideWhiten = nx * nx * (0.3 + 0.4 * (1 - midBody)); // sides whiten more at ends
    const frontWhiten = Math.pow(Math.max(0, nz), 1.2) * 3.0;  // very strong whiten at chest end
    const backWhiten = Math.max(0, -nz) * 0.15;  // mild whiten toward hips
    const threshold = sideWhiten + frontWhiten + backWhiten - 0.55;

    const isGrey = ny > threshold;
    const c = isGrey ? GREY : WHITE;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ── Vertex-sculpted head ───────────────────────────────────────────
// Cat head: wider than tall, slight wedge shape, prominent cheekbones,
// flatter on top (not a perfect sphere).

function _sculptHead() {
  const W = 0.24, H = 0.19, D = 0.20;
  const geo = new THREE.BoxGeometry(W, H, D, 14, 12, 12);
  const pp = geo.attributes.position;

  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const nx = x / (W / 2), ny = y / (H / 2), nz = z / (D / 2);

    // Round into an overall sphere-ish shape
    const edgeR = 0.065;
    const ex = Math.max(0, Math.abs(x) - W / 2 + edgeR);
    const ey = Math.max(0, Math.abs(y) - H / 2 + edgeR);
    const ez = Math.max(0, Math.abs(z) - D / 2 + edgeR);
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist > edgeR) {
      const s = edgeR / dist;
      if (ex > 0) x = Math.sign(x) * (W / 2 - edgeR + ex * s);
      if (ey > 0) y = Math.sign(y) * (H / 2 - edgeR + ey * s);
      if (ez > 0) z = Math.sign(z) * (D / 2 - edgeR + ez * s);
    }

    // Flatten the top slightly — cats don't have round domes
    if (y > H * 0.3) {
      y -= (y - H * 0.3) * 0.2;
    }

    // Cheekbone widening: push sides outward at mid-low height
    const cheekZone = Math.max(0, 1 - (ny + 0.1) * (ny + 0.1) * 4);
    const cheekFwd = Math.max(0, 1 - nz * nz);
    x += Math.sign(x) * cheekZone * cheekFwd * 0.012;

    // Taper back of head narrower
    if (z < 0) {
      const backTaper = 1.0 - Math.abs(nz) * 0.15;
      x *= backTaper;
    }

    // Slight wedge: narrower at the bottom jaw
    if (y < -H * 0.15) {
      const jawTaper = 1.0 - Math.abs(ny + 0.15) * 0.2;
      x *= Math.max(0.7, jawTaper);
    }

    // Muzzle: push the lower front forward
    if (z > 0 && y < 0) {
      const muzzlePush = Math.max(0, nz) * Math.max(0, -ny) * 0.6;
      z += muzzlePush * 0.025;
      // Widen the muzzle area slightly
      if (Math.abs(nx) < 0.5) {
        const muzzlePuff = (1 - nx * nx * 4) * Math.max(0, -ny - 0.1) * Math.max(0, nz);
        y -= muzzlePuff * 0.008;
      }
    }

    pp.setX(i, x); pp.setY(i, y); pp.setZ(i, z);
  }

  _paintVCHead(geo);
  geo.computeVertexNormals();
  return geo;
}

function _paintVCHead(geo) {
  const pp = geo.attributes.position;
  const colors = new Float32Array(pp.count * 3);
  const W = 0.24, H = 0.19, D = 0.20;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const nx = Math.abs(x) / (W / 2); // 0 center, 1 edge
    const nz = z / (D / 2);

    // White forms an inverted V on the front face:
    // - Wide at the bottom (connects to white chin/chest)
    // - Tapers to a narrow point between the eyes
    const onFront = Math.max(0, nz);
    // V shape: white boundary depends on how far from center.
    // At center (nx=0) white reaches highest; at sides it stays low.
    // The boundary is a linear V slope from center outward.
    const vHeight = Math.max(0, 0.05 - nx * 0.08) * onFront;
    const threshold = -0.02 + vHeight;

    // Small white patch on top of head between the ears
    const topDist = nx * nx / (0.2 * 0.2) + Math.pow((nz + 0.15) / 0.35, 2);
    const topPatch = y > H * 0.38 && topDist < 1.0;

    const isWhite = (y < threshold && z > -0.02) || topPatch;
    const c = isWhite ? WHITE : GREY;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ── Vertex-sculpted ear ────────────────────────────────────────────
// Tall, slightly concave, organic triangle shape — not a simple cone.

function _sculptEar() {
  const W = 0.08, H = 0.14, D = 0.05;
  const geo = new THREE.BoxGeometry(W, H, D, 6, 10, 4);
  const pp = geo.attributes.position;

  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const ny = y / (H / 2); // -1 base, +1 tip

    // Taper to point at top
    const taper = 1.0 - Math.max(0, ny) * 0.85;
    x *= taper;
    z *= taper;

    // Round the edges
    const edgeR = 0.012;
    const ex = Math.max(0, Math.abs(x) - W / 2 * taper + edgeR);
    const ey = Math.max(0, Math.abs(y) - H / 2 + edgeR);
    const ez = Math.max(0, Math.abs(z) - D / 2 * taper + edgeR);
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist > edgeR) {
      const s = edgeR / dist;
      if (ex > 0) x = Math.sign(x) * (W / 2 * taper - edgeR + ex * s);
      if (ey > 0) y = Math.sign(y) * (H / 2 - edgeR + ey * s);
      if (ez > 0) z = Math.sign(z) * (D / 2 * taper - edgeR + ez * s);
    }

    // Slight concave scoop on the front face
    if (z > 0 && ny > -0.5) {
      z -= (1 - x * x / (W * W * 0.3)) * Math.max(0, ny + 0.5) * 0.01;
    }

    pp.setX(i, x); pp.setY(i, y); pp.setZ(i, z);
  }

  // Paint: grey outer, pink inner (front face)
  const colors = new Float32Array(pp.count * 3);
  const pink = new THREE.Color(PINK);
  for (let i = 0; i < pp.count; i++) {
    const z = pp.getZ(i);
    const y = pp.getY(i);
    const ny = y / (H / 2);
    // Inner pink if facing forward, not at the very base, and not near edges
    const nx = pp.getX(i) / (W / 2);
    const isPink = z > 0.012 && ny > -0.3 && Math.abs(nx) < 0.55;
    const c = isPink ? pink : GREY;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Continuous tapered leg ─────────────────────────────────────────
//
// Upper leg — tapered cylinder. Bottom radius equals _kneeR so the
// upper leg, knee sphere, and lower leg all share the same radius
// at the joint and read as one continuous limb instead of stacked
// segments.

// Shared knee radius — bottom of upper leg = top of lower leg = knee
// sphere R. Front legs are slightly thinner than back.
const _kneeR  = (isBack) => isBack ? 0.025 : 0.024;
const _hipR   = (isBack) => isBack ? 0.036 : 0.033;
const _ankleR = (isBack) => isBack ? 0.023 : 0.022;
const LEG_H   = 0.10;   // upper leg length (was 0.20 → 0.13 → 0.10)
const LOWER_H = 0.08;   // lower leg length (was 0.12 → 0.10 → 0.08)

function _sculptLeg(isBack) {
  const topR = _hipR(isBack);
  const botR = _kneeR(isBack);
  const geo = new THREE.CylinderGeometry(topR, botR, LEG_H, 10, 5, false);
  const pp = geo.attributes.position;

  // Subtle thigh bulge — push verts radially out near the upper third
  // so the leg isn't a perfect cone.
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r <= 0) continue;
    const t = (y + LEG_H / 2) / LEG_H; // 0=bot, 1=top
    const bulge = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 0.003;
    const s = (r + bulge) / r;
    pp.setX(i, x * s);
    pp.setZ(i, z * s);
  }

  // Paint: all white — Korra's legs are fully white
  const colors = new Float32Array(pp.count * 3);
  for (let i = 0; i < pp.count; i++) {
    colors[i * 3] = WHITE.r; colors[i * 3 + 1] = WHITE.g; colors[i * 3 + 2] = WHITE.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Vertex-sculpted paw ────────────────────────────────────────────

function _sculptPaw() {
  const W = 0.06, H = 0.03, D = 0.065;
  const geo = new THREE.BoxGeometry(W, H, D, 6, 4, 6);
  const pp = geo.attributes.position;

  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);

    // Round all edges
    const edgeR = 0.01;
    const ex = Math.max(0, Math.abs(x) - W / 2 + edgeR);
    const ey = Math.max(0, Math.abs(y) - H / 2 + edgeR);
    const ez = Math.max(0, Math.abs(z) - D / 2 + edgeR);
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist > edgeR) {
      const s = edgeR / dist;
      if (ex > 0) x = Math.sign(x) * (W / 2 - edgeR + ex * s);
      if (ey > 0) y = Math.sign(y) * (H / 2 - edgeR + ey * s);
      if (ez > 0) z = Math.sign(z) * (D / 2 - edgeR + ez * s);
    }

    // Slightly puff the top
    if (y > 0) {
      const cx = (x / (W / 2)); cx * cx;
      y += (1 - cx * cx) * 0.004;
    }

    pp.setX(i, x); pp.setY(i, y); pp.setZ(i, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ── Build the cat ──────────────────────────────────────────────────

export function buildKorraModel() {
  const root = new THREE.Group();
  root.name = 'KorraRoot';

  const bones = _buildSkeleton();
  root.add(bones.root);

  // ── Body ──
  const bodyMesh = new THREE.Mesh(_sculptBody(), vcMat);
  bodyMesh.position.set(0, 0.01, 0);
  bones.spine.add(bodyMesh);

  // ── Head ──
  const headMesh = new THREE.Mesh(_sculptHead(), vcMat);
  headMesh.position.set(0, 0.01, 0);
  bones.head.add(headMesh);

  // Muzzle — small sculpted bump
  const muzzle = new THREE.Mesh(
    _sphere(0.04, 10, 7).apply(g => g.scale(1.1, 0.6, 0.65)),
    whiteMat
  );
  muzzle.position.set(0, -0.035, 0.09);
  bones.head.add(muzzle);

  // Chin
  const chin = new THREE.Mesh(
    _sphere(0.03, 7, 5).apply(g => g.scale(0.8, 0.4, 0.5)),
    whiteMat
  );
  chin.position.set(0, -0.065, 0.05);
  bones.head.add(chin);

  // ── Ears — sculpted, tall and expressive ──
  const earMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  for (const side of [-1, 1]) {
    const earMesh = new THREE.Mesh(_sculptEar(), earMat);
    earMesh.position.set(side * 0.085, 0.10, -0.01);
    earMesh.rotation.set(-0.1, 0, side * -0.25);
    bones.head.add(earMesh);
  }

  // ── Eyes — larger, expressive ──
  bones.head.add(_makeEye(0.05, 0.015, 0.095));    // left
  bones.head.add(_makeEye(-0.05, 0.015, 0.095));   // right

  // Nose (pink)
  const nose = new THREE.Mesh(
    _sphere(0.018, 7, 5).apply(g => g.scale(1.1, 0.6, 0.6)),
    pinkMat
  );
  nose.position.set(0, -0.015, 0.105);
  bones.head.add(nose);

  // Whiskers
  _addWhiskers(bones.head);

  // ── Legs — continuous taper from hip → knee → ankle ──
  for (const [bone, foot, back] of [
    [bones.lfLeg, bones.lfFoot, false],
    [bones.rfLeg, bones.rfFoot, false],
    [bones.lbLeg, bones.lbFoot, true],
    [bones.rbLeg, bones.rbFoot, true],
  ]) {
    // Upper leg — tapered cylinder, hip→knee
    const legMesh = new THREE.Mesh(_sculptLeg(back), vcMat);
    legMesh.position.set(0, -LEG_H / 2, 0);
    bone.add(legMesh);

    // Knee sphere — same radius as the matched knee point so it sits
    // flush against both cylinders rather than bulging outside them.
    const knee = new THREE.Mesh(_sphere(_kneeR(back), 8, 6), whiteMat);
    knee.position.set(0, 0, 0); // foot bone origin = the knee
    foot.add(knee);

    // Lower leg — tapered cylinder, knee→ankle (top R matches knee R)
    const lower = new THREE.Mesh(
      _cylinder(_kneeR(back), _ankleR(back), LOWER_H, 10),
      whiteMat
    );
    lower.position.set(0, -LOWER_H / 2, 0);
    foot.add(lower);

    // Paw
    const pawMesh = new THREE.Mesh(_sculptPaw(), whiteMat);
    pawMesh.position.set(0, -LOWER_H, 0.008);
    foot.add(pawMesh);
  }

  // ── Tail — single smooth curved tube ──
  // One continuous tapered tube on tail1; the whole tail sways as one piece.
  // Starts inside the body (positive Z) so it visually connects to the torso.
  const tailR = 0.026;
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.04, 0.12),   // deep inside body
    new THREE.Vector3(0, -0.02, 0.06),   // still inside body
    new THREE.Vector3(0, 0.00, 0.00),   // tail base at bone origin
    new THREE.Vector3(0, 0.03, -0.07),
    new THREE.Vector3(0, 0.06, -0.14),
    new THREE.Vector3(0, 0.08, -0.20),
    new THREE.Vector3(0, 0.09, -0.24),
    new THREE.Vector3(0, 0.10, -0.26),
  ], false, 'catmullrom', 0.5);
  const tailMat = greyMat.clone();
  tailMat.side = THREE.DoubleSide;
  const tailGeo = _taperedTube(tailCurve, 28, () => tailR, 7);
  // Cap the end with a sphere
  const tailTip = tailCurve.getPointAt(1);
  const capGeo = _sphere(tailR, 7, 5);
  capGeo.translate(tailTip.x, tailTip.y, tailTip.z);
  const merged = _mergeBufferGeometries(tailGeo, capGeo);
  const tailMesh = new THREE.Mesh(merged, tailMat);
  bones.tail1.add(tailMesh);

  // Tag all meshes
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });

  return { scene: root, animations: [] };
}

// ── Skeleton builder ───────────────────────────────────────────────

function _buildSkeleton() {
  const b = (name) => { const bone = new THREE.Bone(); bone.name = name; return bone; };

  const root = b('Root');
  const hips = b('Hips');
  const spine = b('Spine');
  const chest = b('Chest');
  const neck = b('Neck');
  const head = b('Head');
  const tail1 = b('Tail1');
  const tail2 = b('Tail2');
  const tail3 = b('Tail3');
  const lfLeg = b('LFrontLeg');
  const rfLeg = b('RFrontLeg');
  const lbLeg = b('LBackLeg');
  const rbLeg = b('RBackLeg');
  const lfFoot = b('LFrontFoot');
  const rfFoot = b('RFrontFoot');
  const lbFoot = b('LBackFoot');
  const rbFoot = b('RBackFoot');

  root.add(hips);
  hips.add(spine);
  spine.add(chest);
  chest.add(neck);
  neck.add(head);
  hips.add(tail1);
  tail1.add(tail2);
  tail2.add(tail3);
  chest.add(lfLeg);
  chest.add(rfLeg);
  hips.add(lbLeg);
  hips.add(rbLeg);
  lfLeg.add(lfFoot);
  rfLeg.add(rfFoot);
  lbLeg.add(lbFoot);
  rbLeg.add(rbFoot);

  root.position.set(0, 0, 0);
  hips.position.set(0, 0.50, -0.05);
  spine.position.set(0, 0.04, 0.14);
  chest.position.set(0, 0.04, 0.14);
  neck.position.set(0, 0.05, 0.10);
  head.position.set(0, 0.06, 0.06);
  tail1.position.set(0, 0.14, -0.14);
  tail2.position.set(0, 0.04, -0.10);
  tail3.position.set(0, 0.04, -0.08);

  // Front legs attach via chest (hips→spine→chest adds +0.08 Y),
  // so front leg bones sit lower to compensate. All foot bones equal.
  // X offsets pulled inward (was 0.08 / 0.07) so the legs read as
  // tucked under the body instead of splayed at the hips.
  // Back legs sit a touch behind hip-center so they read as anchored
  // under the haunches, not mid-belly.
  lfLeg.position.set(0.06, -0.10, 0.02);
  rfLeg.position.set(-0.06, -0.10, 0.02);
  lbLeg.position.set(0.05, -0.02, -0.04);
  rbLeg.position.set(-0.05, -0.02, -0.04);
  // Foot bones = knee joints, at bottom of upper leg (H=LEG_H=0.13)
  lfFoot.position.set(0, -LEG_H, 0);
  rfFoot.position.set(0, -LEG_H, 0);
  lbFoot.position.set(0, -LEG_H, 0);
  rbFoot.position.set(0, -LEG_H, 0);

  // Invisible paw-ground markers — _centerAndGround matches /paw/i
  // and uses the lowest such bone for grounding. These sit at the
  // actual ground contact point (lower-leg LOWER_H + paw halfH 0.015).
  const pawDrop = -(LOWER_H + 0.015);
  for (const fb of [lfFoot, rfFoot, lbFoot, rbFoot]) {
    const marker = b(fb.name.replace('Foot', 'Paw'));
    marker.position.set(0, pawDrop, 0);
    fb.add(marker);
  }

  return {
    root, hips, spine, chest, neck, head,
    tail1, tail2, tail3,
    lfLeg, rfLeg, lbLeg, rbLeg,
    lfFoot, rfFoot, lbFoot, rbFoot
  };
}

// ── Detail part builders ───────────────────────────────────────────

function _makeEye(x, y, z) {
  const g = new THREE.Group();
  g.name = 'Eye';
  const ball = new THREE.Mesh(
    _sphere(0.030, 10, 7).apply(geo => geo.scale(1.1, 0.9, 0.55)),
    eyeWhiteMat
  );
  g.add(ball);
  const iris = new THREE.Mesh(
    _sphere(0.020, 8, 6).apply(geo => geo.scale(1.0, 0.95, 0.5)),
    eyeGreenMat
  );
  iris.position.z = 0.009;
  g.add(iris);
  const pupil = new THREE.Mesh(
    _sphere(0.010, 6, 5).apply(geo => geo.scale(0.4, 1.1, 0.4)),
    pupilMat
  );
  pupil.position.z = 0.014;
  g.add(pupil);
  g.position.set(x, y, z);
  return g;
}

function _addWhiskers(headBone) {
  const wMat = whiteMat.clone();
  wMat.transparent = true;
  wMat.opacity = 0.7;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const wGeo = _cylinder(0.003, 0.0015, 0.14, 3);
      const w = new THREE.Mesh(wGeo, wMat);
      const angle = (i - 1) * 0.25;
      w.position.set(side * 0.045, -0.025 + (i - 1) * 0.01, 0.08);
      w.rotation.set(angle * 0.2, 0, side * (0.65 + angle));
      headBone.add(w);
    }
  }
}

// ── Monkey-patch for chained .apply on BufferGeometry ──────────────

if (!THREE.BufferGeometry.prototype.apply) {
  THREE.BufferGeometry.prototype.apply = function (fn) { fn(this); return this; };
}
