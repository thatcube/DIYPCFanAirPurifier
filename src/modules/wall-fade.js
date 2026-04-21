// ─── Wall auto-fade ─────────────────────────────────────────────────
// Fades room walls/ceiling based on camera position so you can see
// through them when orbiting outside the room.

// ── State ───────────────────────────────────────────────────────────

const _fadingWalls = [];
const _fadeNear = 18;
const _fadeFar = 40;

// ── Init: collect all room meshes, tag wall sides ───────────────────

export function init(scene, roomRefs) {
  _fadingWalls.length = 0;

  // Collect all _isRoom meshes
  scene.traverse(obj => {
    if (!obj._isRoom || !obj.isMesh || !obj.material) return;
    if (obj._noFade) {
      obj.material.transparent = false;
      obj.material.opacity = 1;
      obj.material.depthWrite = true;
      return;
    }
    // Preserve intentionally translucent materials
    if (obj.material.transparent || obj.material.opacity < 0.999) {
      obj._fadeBaseOpacity = obj.material.opacity;
      obj._fadeBaseTransparent = obj.material.transparent;
      obj._fadeBaseDepthWrite = obj.material.depthWrite;
    } else {
      obj.material.transparent = false;
      obj.material.opacity = 1;
      obj.material.depthWrite = true;
    }
    _fadingWalls.push(obj);
  });

  // Tag exterior walls by side
  const { wallMeshL, oppWall, rightWall, floor } = roomRefs;

  // Collect walls by matching position — back wall (Z ≈ 49), front/TV (Z ≈ -78), etc.
  for (const m of _fadingWalls) {
    if (m === floor || m._isFloor) {
      m._isFloor = true;
      continue;
    }
    // Post-mirror positions: back wall at Z≈49, front at Z≈-78
    // Window wall at X≈81, closet wall at X≈-51
    const z = m.position.z;
    const x = m.position.x;

    // Match by reference if available
    if (wallMeshL && m === wallMeshL) { m._isWall = true; m._wallSide = 'back'; continue; }
    if (oppWall && m === oppWall) { m._isWall = true; m._wallSide = 'front'; continue; }
    if (rightWall && m === rightWall) { m._isWall = true; m._wallSide = 'right'; continue; }

    // Match baseboards and wall segments by position
    // Back wall / headboard wall: Z > 47
    if (z > 47 && Math.abs(x) < 60) {
      m._isWall = true; m._wallSide = 'back'; continue;
    }
    // Front / TV wall: Z < -76
    if (z < -76 && Math.abs(x) < 60) {
      m._isWall = true; m._wallSide = 'front'; continue;
    }
    // Right / closet wall: X < -49
    if (x < -49) {
      m._isWall = true; m._wallSide = 'right'; continue;
    }
    // Left / window wall: X > 79
    if (x > 79) {
      m._isWall = true; m._wallSide = 'left'; continue;
    }
  }
}

// ── Per-frame fade update ───────────────────────────────────────────

function _setFadeOpacity(mesh, alpha) {
  const mat = mesh.material;
  if (mesh._fadeBaseOpacity !== undefined) {
    mat.opacity = Math.min(mesh._fadeBaseOpacity, alpha);
    mat.transparent = mesh._fadeBaseTransparent;
    mat.depthWrite = mesh._fadeBaseDepthWrite;
    return;
  }
  const faded = alpha < 0.999;
  if (mat.transparent !== faded) {
    mat.transparent = faded;
    mat.needsUpdate = true;
  }
  mat.depthWrite = !faded;
  mat.opacity = alpha;
}

export function update(camera) {
  if (!_fadingWalls.length) return;

  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;

  // Determine if camera is outside each wall
  const outsideMargin = 4;
  const outsideBack = cz > 49 - outsideMargin;    // back wall Z ≈ 49
  const outsideFront = cz < -78 + outsideMargin;   // TV wall Z ≈ -78
  const outsideRight = cx < -51 + outsideMargin;    // closet wall X ≈ -51
  const outsideLeft = cx > 81 - outsideMargin;      // window wall X ≈ 81

  for (const m of _fadingWalls) {
    // Floor: fade when camera is below
    if (m._isFloor) {
      _setFadeOpacity(m, cy < m.position.y ? 0.08 : 1);
      continue;
    }

    // Exterior walls: fade when camera is outside that wall
    if (m._isWall) {
      const outside = (m._wallSide === 'back' && outsideBack)
        || (m._wallSide === 'front' && outsideFront)
        || (m._wallSide === 'right' && outsideRight)
        || (m._wallSide === 'left' && outsideLeft);
      _setFadeOpacity(m, outside ? 0.08 : 1);
      continue;
    }

    // Interior objects: distance-based proximity fade
    const ox = m.position.x, oz = m.position.z;
    const dx = cx - ox, dz = cz - oz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < _fadeFar) {
      const t = Math.max(0, (dist - _fadeNear) / (_fadeFar - _fadeNear));
      _setFadeOpacity(m, Math.max(0.03, t));
    } else {
      _setFadeOpacity(m, 1);
    }
  }
}

// ── Reset all to opaque (e.g. entering FP mode) ────────────────────

export function resetAll() {
  for (const m of _fadingWalls) {
    _setFadeOpacity(m, 1);
  }
}
