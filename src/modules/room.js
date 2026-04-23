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

export function createRoom(scene) {
  const floorY = getFloorY();
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
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI*2); ctx.fill();
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
    cctx.strokeStyle = `rgb(${r|0},${gCh|0},${b|0})`;
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
      nData[i]   = ((nx / len) * 0.5 + 0.5) * 255;
      nData[i+1] = ((ny / len) * 0.5 + 0.5) * 255;
      nData[i+2] = ((nz / len) * 0.5 + 0.5) * 255;
      nData[i+3] = 255;
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
  floor.rotation.x = -Math.PI/2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  floor._isRoom = true;
  floor._isFloor = true;
  addRoom(floor);
  
  // updatePowerCordGeometry — handled by purifier module
  
  // Ceiling — flat plane at top of walls
  const ceilingGeo = new THREE.PlaneGeometry(200, 200);
  const ceilingMat = new THREE.MeshStandardMaterial({color:0xe0ddd6, roughness:0.9, metalness:0.0, side:THREE.DoubleSide});
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.rotation.x = Math.PI/2;
  ceiling.position.y = floorY+80;
  ceiling.castShadow = false; // NEVER let the ceiling cast directional-light shadows — it's a 200×200 plane that shadows the upper portions of every wall and itself, making them permanently dark
  ceiling.receiveShadow = true;
  ceiling._isRoom = true;
  addRoom(ceiling);
  
  // Helper: simple box with shadow
  function roomBox(w,h,d,color,x,y,z,rx,ry,rz){
    const g=new THREE.BoxGeometry(w,h,d);
    const m=new THREE.MeshStandardMaterial({color,roughness:0.7,metalness:0.05});
    const mesh=new THREE.Mesh(g,m);
    mesh.position.set(x,y,z);
    if(rx) mesh.rotation.x=rx;
    if(ry) mesh.rotation.y=ry;
    if(rz) mesh.rotation.z=rz;
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    mesh._isRoom=true;
    addRoom(mesh);
    return mesh;
  }
  
  // Rounded box helper — uses ExtrudeGeometry with a rounded rect profile
  function roomRoundBox(w,h,d,radius,color,x,y,z,rx,ry,rz){
    const r=Math.min(radius,w/2,h/2);
    const shape=new THREE.Shape();
    shape.moveTo(-w/2+r,-h/2);
    shape.lineTo(w/2-r,-h/2);
    shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
    shape.lineTo(w/2,h/2-r);
    shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);
    shape.lineTo(-w/2+r,h/2);
    shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);
    shape.lineTo(-w/2,-h/2+r);
    shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
    const extrudeSettings={depth:d,bevelEnabled:false};
    const g=new THREE.ExtrudeGeometry(shape,extrudeSettings);
    g.translate(0,0,-d/2); // center along Z
    const m=new THREE.MeshStandardMaterial({color,roughness:0.7,metalness:0.05});
    const mesh=new THREE.Mesh(g,m);
    mesh.position.set(x,y,z);
    if(rx) mesh.rotation.x=rx;
    if(ry) mesh.rotation.y=ry;
    if(rz) mesh.rotation.z=rz;
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    mesh._isRoom=true;
    addRoom(mesh);
    return mesh;
  }
  
  // ─── Zinus Queen Piper Upholstered Platform Bed ───
  // 82.3"L × 60.3"W × 42"H, 6.5" ground clearance, slats at 14" from floor
  // (bedL, bedW, bedH, bedClearance, bedSlatsFromFloor, bedX, bedZ declared in header)
  
  // Nightstand — 27"H × 24"W × 14"D, black body, dark oak top, 3 drawers, curved front
  // (tblW, tblH, tblD, tblX, tblZ declared in header)
  const tblBlack=0x1a1a1a;
  const tblOak=0x5a3f2a;
  const drawers=[]; // populated in nightstand block below; used by click/collision/coin systems
  {
    const bodyH=tblH-1;
    const curveBulge=1.5; // how far the front curves outward
    const segs=12; // curve smoothness
  
    // Helper: create a curved-front box (top-down profile extruded along Y)
    function curvedFrontBox(w, h, d, bulge){
      const shape=new THREE.Shape();
      // Start at back-left, go clockwise (in pre-flip coords)
      shape.moveTo(-w/2, -d/2); // back-left
      shape.lineTo(w/2, -d/2);  // back-right
      shape.lineTo(w/2, d/2);   // front-right
      // Curved front: bulges in +Z (which becomes the visible front after X flip)
      shape.quadraticCurveTo(0, d/2+bulge, -w/2, d/2);
      shape.lineTo(-w/2, -d/2);
      const geo=new THREE.ExtrudeGeometry(shape, {depth:h, bevelEnabled:false});
      geo.translate(0,0,-h/2);
      geo.rotateX(-Math.PI/2); // extrude along Y
      return geo;
    }
  
    // Main body — a solid rectangular block (tblW × bodyH × tblD) with three
    // rectangular holes cut through it, front-to-back, where each drawer slots
    // in. Built by extruding a front-facing silhouette-with-holes along Z.
    // (The dark-oak top cap below keeps the curved silhouette on top.)
    const bodyMat=new THREE.MeshStandardMaterial({color:tblBlack,roughness:0.4,metalness:0.05});
    const drawerGap=0.8;
    const drawerH=(bodyH-drawerGap*4)/3;
    const drawerW=tblW-1.5;
    const drawerFrontZ=tblZ-tblD/2;   // drawer face sits flush with the body front
    const trayD=tblD-0.5;              // tray runs nearly the full dresser depth
    {
      // Front silhouette: full body rectangle in XY.
      const faceShape=new THREE.Shape();
      faceShape.moveTo(-tblW/2, -bodyH/2);
      faceShape.lineTo( tblW/2, -bodyH/2);
      faceShape.lineTo( tblW/2,  bodyH/2);
      faceShape.lineTo(-tblW/2,  bodyH/2);
      faceShape.lineTo(-tblW/2, -bodyH/2);
      // Three rectangular drawer-sized holes, one per drawer row.
      const holeW=drawerW+0.3;           // slightly wider than drawer face for clearance
      const holeH=drawerH-0.3;           // slightly shorter so face rests against rails
      for(let d=0;d<3;d++){
        const dyCenter=drawerGap*(d+1)+drawerH*(d+0.5)-bodyH/2; // body-local Y
        const hole=new THREE.Path();
        hole.moveTo(-holeW/2, dyCenter-holeH/2);
        hole.lineTo( holeW/2, dyCenter-holeH/2);
        hole.lineTo( holeW/2, dyCenter+holeH/2);
        hole.lineTo(-holeW/2, dyCenter+holeH/2);
        hole.lineTo(-holeW/2, dyCenter-holeH/2);
        faceShape.holes.push(hole);
      }
      // Extrude along +Z through the full body depth. Final mesh origin at its
      // geometric center (bodyH/2, tblD/2 in-shape).
      const bodyGeo=new THREE.ExtrudeGeometry(faceShape, {depth:tblD, bevelEnabled:false});
      bodyGeo.translate(0, 0, -tblD/2);   // center on Z
      const body=new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(tblX, floorY+bodyH/2, tblZ);
      body.castShadow=true; body.receiveShadow=true; body._isRoom=true;
      addRoom(body);
    }
  
    // Dark oak top — also curved front, with overhang
    const topOverhang=1;
    const topW=tblW+topOverhang*2;
    const topD=tblD+topOverhang;
    const topThick=1;
    const topGeo=curvedFrontBox(topW, topThick, topD, curveBulge+0.5);
    const topMat=new THREE.MeshStandardMaterial({color:tblOak,roughness:0.6,metalness:0.05});
    const topMesh=new THREE.Mesh(topGeo, topMat);
    topMesh.position.set(tblX, floorY+tblH-topThick/2, tblZ-topOverhang/2);
    topMesh.castShadow=true; topMesh._isRoom=true; addRoom(topMesh);
  
    // 3 drawers — curved front face + hollow tray (left/right/back walls + floor).
    // Each drawer is a THREE.Group positioned at (tblX, dy, drawerFrontZ). The
    // group slides along local Z (toward -Z = out) when opened. Marked _isRoom
    // so it mirrors with the rest of the room; children are in local coords.
    // (drawerGap, drawerH, drawerW, drawerFrontZ, trayD declared above for the
    // body-cavity math and reused here.)
    const drawerFaceMat=new THREE.MeshStandardMaterial({color:0x222222,roughness:0.5});
    const drawerTrayMat=new THREE.MeshStandardMaterial({color:0x151515,roughness:0.85,metalness:0.02});
    const trayWall=0.5;              // thickness of tray walls
    const drawerSlideMax=8;          // how far the drawer pulls out
    for(let d=0;d<3;d++){
      const dy=floorY+drawerGap*(d+1)+drawerH*(d+0.5);
      const grp=new THREE.Group();
      grp.position.set(tblX, dy, drawerFrontZ);
      grp._drawerBaseZ=drawerFrontZ;
      grp._isRoom=true;
      grp._isDrawer=true;
      grp._drawerIdx=d;
      grp._drawerOpen=false;
      grp._drawerSlide=0;              // current slide amount (0..slideMax)
      grp._drawerSlideMax=drawerSlideMax;
      grp._drawerW=drawerW;
      grp._drawerH=drawerH;
      grp._drawerTrayD=trayD;
      grp._drawerTrayWall=trayWall;
      // Curved front face — same as before, centered at group origin.
      const faceGeo=curvedFrontBox(drawerW, drawerH-0.5, 0.8, curveBulge*0.8);
      const face=new THREE.Mesh(faceGeo, drawerFaceMat);
      face._isDrawer=true; face._drawerIdx=d;
      grp.add(face);
      // Tray: open-top box extending behind the face in +Z (into the body).
      // Tray interior runs from z=0.4 (behind face) to z=trayD.
      const trayBottom=new THREE.Mesh(
        new THREE.BoxGeometry(drawerW-trayWall*2, trayWall, trayD),
        drawerTrayMat
      );
      trayBottom.position.set(0, -drawerH/2+trayWall/2, trayD/2+0.4);
      trayBottom._isDrawer=true; trayBottom._drawerIdx=d;
      grp.add(trayBottom);
      const trayLeft=new THREE.Mesh(
        new THREE.BoxGeometry(trayWall, drawerH-0.5, trayD),
        drawerTrayMat
      );
      trayLeft.position.set(-drawerW/2+trayWall/2, 0, trayD/2+0.4);
      trayLeft._isDrawer=true; trayLeft._drawerIdx=d;
      grp.add(trayLeft);
      const trayRight=trayLeft.clone();
      trayRight.position.x=drawerW/2-trayWall/2;
      grp.add(trayRight);
      const trayBack=new THREE.Mesh(
        new THREE.BoxGeometry(drawerW-trayWall*2, drawerH-0.5, trayWall),
        drawerTrayMat
      );
      trayBack.position.set(0, 0, trayD+0.4-trayWall/2);
      trayBack._isDrawer=true; trayBack._drawerIdx=d;
      grp.add(trayBack);
      // 2 round handles per drawer — live on the face, so they travel with it.
      const handleMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:0.3,metalness:0.6});
      for(let h of[-1,1]){
        const handle=new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), handleMat);
        handle.position.set(h*4, 0, -0.8);
        handle._isDrawer=true; handle._drawerIdx=d;
        grp.add(handle);
        const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.5,6), handleMat);
        stem.rotation.x=Math.PI/2;
        stem.position.set(h*4, 0, -0.5);
        stem._isDrawer=true; stem._drawerIdx=d;
        grp.add(stem);
      }
      addRoom(grp);
      drawers.push(grp);
    }
  }
  
  // Coffee mug on nightstand — ceramic with handle
  {
    const mugX=tblX-3, mugZ=tblZ-5, mugY=floorY+tblH;
    const mugR=1.4, mugH=3.5, mugThick=0.15;
    const mugMat=new THREE.MeshStandardMaterial({color:0xf5f5f0,roughness:0.3,metalness:0.05});
    const mugGroup=new THREE.Group();
    // Outer cylinder
    const mugOuter=new THREE.Mesh(new THREE.CylinderGeometry(mugR,mugR*0.95,mugH,16),mugMat);
    mugOuter.position.set(0, mugH/2, 0);
    mugGroup.add(mugOuter);
    // Inner dark cavity (coffee)
    const coffeeMat=new THREE.MeshStandardMaterial({color:0x2a1a0a,roughness:0.8});
    const coffee=new THREE.Mesh(new THREE.CircleGeometry(mugR-mugThick,16),coffeeMat);
    coffee.rotation.x=-Math.PI/2;
    coffee.position.set(0, mugH-0.1, 0);
    mugGroup.add(coffee);
    // Handle — torus arc attached to mug side
    const handleGeo=new THREE.TorusGeometry(0.65, 0.15, 8, 12, Math.PI);
    const handle=new THREE.Mesh(handleGeo, mugMat);
    handle.rotation.z=Math.PI/2;
    handle.rotation.y=Math.PI/2;
    handle.position.set(0, mugH*0.5, mugR);
    mugGroup.add(handle);
    // Position and rotate the whole mug
    mugGroup.position.set(mugX, mugY, mugZ);
    mugGroup.rotation.y=30*Math.PI/180; // angled so handle faces toward player
    // Only mark the GROUP as room — not the children. Marking children caused
    // applyRoomDelta to double-shift them (once for group, once per child) each
    // time the room was nudged, which is why the mug drifted outside the room.
    mugGroup._isRoom=true;
    addRoom(mugGroup);
  }
  
  // Qingping Air Quality Monitor — white wedge with tilted screen
  {
    const aqX=tblX-8, aqZ=tblZ+2, aqY=floorY+tblH;
    const aqW=3.5, aqH=4.0, aqD=2.8; // taller to include chin
    const chinH=0.8; // chin height below screen
    const tilt=15*Math.PI/180;
    const wedgeMat=new THREE.MeshStandardMaterial({color:0xeeeee8,roughness:0.35,metalness:0.05});
  
    // Screen panel — rounded edges like a tablet
    const panelR=0.4; // corner radius
    const panelShape=new THREE.Shape();
    panelShape.moveTo(-aqW/2+panelR, -aqH/2);
    panelShape.lineTo(aqW/2-panelR, -aqH/2);
    panelShape.quadraticCurveTo(aqW/2, -aqH/2, aqW/2, -aqH/2+panelR);
    panelShape.lineTo(aqW/2, aqH/2-panelR);
    panelShape.quadraticCurveTo(aqW/2, aqH/2, aqW/2-panelR, aqH/2);
    panelShape.lineTo(-aqW/2+panelR, aqH/2);
    panelShape.quadraticCurveTo(-aqW/2, aqH/2, -aqW/2, aqH/2-panelR);
    panelShape.lineTo(-aqW/2, -aqH/2+panelR);
    panelShape.quadraticCurveTo(-aqW/2, -aqH/2, -aqW/2+panelR, -aqH/2);
    const panelGeo=new THREE.ExtrudeGeometry(panelShape, {depth:0.3, bevelEnabled:true, bevelSize:0.08, bevelThickness:0.08, bevelSegments:3});
    panelGeo.translate(0,0,-0.15);
    const screenPanel=new THREE.Mesh(panelGeo, wedgeMat);
    screenPanel.rotation.x=tilt;
    screenPanel.position.set(aqX, aqY+aqH/2+0.3, aqZ-0.3);
    screenPanel._isRoom=true; addRoom(screenPanel);
  
    // Base/stand — thicker
    const baseMesh=new THREE.Mesh(new THREE.BoxGeometry(aqW, 1.2, aqD*0.8), wedgeMat);
    baseMesh.position.set(aqX, aqY+0.6, aqZ+0.3);
    baseMesh._isRoom=true; addRoom(baseMesh);
  
    // Chin slit — horizontal dark line in the chin area
    const slitMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:0.5});
    const slit=new THREE.Mesh(new THREE.BoxGeometry(aqW*0.7, 0.08, 0.05), slitMat);
    slit.rotation.x=tilt;
    // Position at bottom of panel face, in the chin area
    slit.position.set(aqX, aqY+chinH*0.5+0.45, aqZ-0.3-0.8);
    slit._isRoom=true; addRoom(slit);
  
    // Screen content — canvas texture with AQI data
    const screenH=aqH-chinH-0.4; // screen area = panel minus chin minus bezel
    const aqiCvs=document.createElement('canvas');
    aqiCvs.width=512; aqiCvs.height=512;
    const actx=aqiCvs.getContext('2d');
    actx.fillStyle='#0a0a0a';
    actx.fillRect(0,0,512,512);
  
    // Header — centered
    actx.fillStyle='#cccccc';
    actx.font='bold 52px -apple-system,sans-serif';
    actx.textAlign='center'; actx.textBaseline='middle';
    actx.fillText('AIR QUALITY',256,120);
    actx.fillText('MONITOR',256,180);
  
    // Divider line
    actx.strokeStyle='#333333';
    actx.lineWidth=1;
    actx.beginPath(); actx.moveTo(30,250); actx.lineTo(482,250); actx.stroke();
  
    // Bottom grid — 2×3 layout with larger text
    const gx=[128,384];
    const gy=[295,370,445];
    const gridData=[
      ['36','Noise dB','#00cc44'],    ['187','PM 10 µg/m³','#ffaa00'],
      ['631','CO₂ ppm','#ffaa00'],    ['27','eTVOC index','#00cc44'],
      ['25.5','Temp °C','#00cc44'],   ['55.5','RH %','#00cc44'],
    ];
    for(let i=0;i<gridData.length;i++){
      const col=i%2, row=Math.floor(i/2);
      const x=gx[col], y=gy[row];
      actx.fillStyle=gridData[i][2];
      actx.font='bold 42px -apple-system,sans-serif';
      actx.textAlign='center';
      actx.fillText(gridData[i][0],x,y-6);
      actx.fillStyle='#555555';
      actx.font='18px -apple-system,sans-serif';
      actx.fillText(gridData[i][1],x,y+22);
    }
  
    const aqiTex=new THREE.CanvasTexture(aqiCvs);
    const screenW2=aqW*0.85;
    const scrMesh=new THREE.Mesh(
      new THREE.PlaneGeometry(screenW2, screenH),
      new THREE.MeshBasicMaterial({map:aqiTex})
    );
    scrMesh.rotation.x=tilt;
    scrMesh.rotation.y=Math.PI;
    // Screen sits above the chin, centered in the upper portion of the panel
    scrMesh.position.set(aqX, aqY+chinH+screenH/2+0.4, aqZ-0.3-0.25);
    scrMesh._isRoom=true; addRoom(scrMesh);
  }
  
  // Lamp on nightstand — near the corner closest to the door extrusion
  let lampLight, lampShade, lampOn=true;
  let lampBulb=null;
  let ceilLightOn=true; // ceiling fixture togglable by clicking
  let ceilGlow=null;
  {
    const lampX=tblX+tblW/2-6; // 6" from the extrusion-side edge
    const lampZ=tblZ+tblD/2-6; // 6" from the back edge (avoid wall clip)
    const lampBaseY=floorY+tblH;
    // Base — dark metal disc (larger)
    const baseMat=new THREE.MeshStandardMaterial({color:0x222222,roughness:0.4,metalness:0.6});
    const base=new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 0.8, 16), baseMat);
    base.position.set(lampX, lampBaseY+0.4, lampZ);
    base._isRoom=true; base._isLamp=true; addRoom(base);
    // Stem — thin metal rod (taller)
    const stemH=16;
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, stemH, 8), baseMat);
    stem.position.set(lampX, lampBaseY+0.8+stemH/2, lampZ);
    stem._isRoom=true; stem._isLamp=true; addRoom(stem);
    // Shade — fabric cylinder, slightly tapered (larger)
    const shadeR1=5, shadeR2=6.5, shadeH=10;
    const shadeMat=new THREE.MeshStandardMaterial({
      color:0xd8d0c0, roughness:0.9, metalness:0, side:THREE.DoubleSide,
      transparent:true, opacity:0.85,
      emissive:0xffeedd, emissiveIntensity:0.75
    });
    lampShade=new THREE.Mesh(new THREE.CylinderGeometry(shadeR1, shadeR2, shadeH, 24, 1, true), shadeMat);
    lampShade.position.set(lampX, lampBaseY+0.8+stemH+shadeH/2-1, lampZ);
    lampShade._isRoom=true; lampShade._isLamp=true; addRoom(lampShade);
    // Top ring with a center opening so the player can drop into the shade.
    const topCap=new THREE.Mesh(new THREE.RingGeometry(4.2, shadeR1, 24), shadeMat);
    topCap.rotation.x=-Math.PI/2;
    topCap.position.set(lampX, lampBaseY+0.8+stemH+shadeH-1, lampZ);
    topCap._isRoom=true; topCap._isLamp=true; addRoom(topCap);
    // Warm glow light — strong enough to visibly illuminate surroundings
    lampLight=new THREE.PointLight(0xffddaa, 400, 110);
    lampLight.position.set(lampX, lampBaseY+0.8+stemH+shadeH/2-1, lampZ);
    lampLight.castShadow=false;
    lampLight._isRoom=true; addRoom(lampLight);
    // Bulb visible inside shade
    const bulbMat=new THREE.MeshStandardMaterial({color:0xffffcc,emissive:0xffeedd,emissiveIntensity:1.9,roughness:0.3});
    lampBulb=new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), bulbMat);
    lampBulb.position.set(lampX, lampBaseY+0.8+stemH+1, lampZ);
    lampBulb._isRoom=true; lampBulb._isLamp=true; addRoom(lampBulb);
  }
  
  // Wall section — back wall with door extrusion bumping INTO the room (-Z direction)
  const recessDepth=30; // 2.5 feet into room
  const extrusionW=40; // door (32") + 4" each side
  const extRight=51; // flush with right/side wall
  const extLeft=extRight-extrusionW; // 11
  const extCenterX=extLeft+extrusionW/2; // 31
  const recessZ=49-recessDepth; // front face of extrusion at Z=19

  // Front face of extrusion — has the door opening
  const doorW=32, doorH=80;
  const doorCenterX=extCenterX;
  const doorLeft=doorCenterX-doorW/2;
  const doorRight=doorCenterX+doorW/2;

  // Back wall — full width with a doorway hole so the door opens into the
  // hallway beyond. Built as an ExtrudeGeometry (shape in X-Y plane, extruded
  // along +Z) mirroring the closet-wall-with-hole approach.
  // NOTE: room meshes are X-mirrored via position.x, but ExtrudeGeometry bakes
  // shape vertices into the geometry — position flipping doesn't flip them.
  // So we negate every shape X coord up front: the geometry is authored in
  // *post-mirror* world X, and we set position.x=0 so the mirror pass (which
  // just flips 0 → 0) leaves it where we want.
  const backWallFullW=81+51;
  const wallMeshL=(()=>{
    const mat=new THREE.MeshStandardMaterial({color:0xd8d4ce,roughness:0.7,metalness:0.05});
    const shape=new THREE.Shape();
    // Post-mirror world X range: -51..81 (centered at +15).
    const xMin=-51, xMax=81;
    const yMin=0, yMax=80;
    shape.moveTo(xMin,yMin);
    shape.lineTo(xMax,yMin);
    shape.lineTo(xMax,yMax);
    shape.lineTo(xMin,yMax);
    shape.lineTo(xMin,yMin);
    const hole=new THREE.Path();
    // Doorway hole — post-mirror X = -doorRight..-doorLeft (= -47..-15).
    const hxMin=-doorRight, hxMax=-doorLeft;
    hole.moveTo(hxMin,yMin);
    hole.lineTo(hxMax,yMin);
    hole.lineTo(hxMax,doorH);
    hole.lineTo(hxMin,doorH);
    hole.lineTo(hxMin,yMin);
    shape.holes.push(hole);
    const geo=new THREE.ExtrudeGeometry(shape, {depth:0.5, bevelEnabled:false});
    const mesh=new THREE.Mesh(geo, mat);
    mesh.position.set(0, floorY, 48.75); // front face at Z=48.75, back at 49.25
    mesh.castShadow=true; mesh.receiveShadow=true; mesh._isRoom=true;
    addRoom(mesh);
    return mesh;
  })();

  // Extrusion side walls (going from back wall into room)
  const returnWallL=roomBox(0.5, 80, recessDepth, 0xd8d4ce, extLeft, floorY+40, 49-recessDepth/2, 0,0,0);
  // Right side wall omitted — flush with side wall, would clip
  // Top of extrusion
  roomBox(extrusionW, 0.5, recessDepth, 0xd8d4ce, extCenterX, floorY+80, 49-recessDepth/2, 0,0,0);
  
  // Wall left of door
  const recessWallLeftW=doorLeft-extLeft;
  if(recessWallLeftW>0.5) var recessWallL=roomBox(recessWallLeftW, 80, 0.5, 0xd8d4ce, extLeft+recessWallLeftW/2, floorY+40, recessZ, 0,0,0);
  // Wall right of door
  const recessWallRightW=extRight-doorRight;
  if(recessWallRightW>0.5) var recessWallR=roomBox(recessWallRightW, 80, 0.5, 0xd8d4ce, doorRight+recessWallRightW/2, floorY+40, recessZ, 0,0,0);
  
  // Baseboards — split around the doorway so the threshold stays clear.
  const bbLeftW = (doorLeft) - (-15 - backWallFullW/2);   // -81 → doorLeft
  const bbRightW = (-15 + backWallFullW/2) - doorRight;    // doorRight → 51
  const baseboardMeshL = roomBox(bbLeftW, 3, 0.6, 0xc0bbb4,
    (-15 - backWallFullW/2 + doorLeft)/2, floorY+1.5, 48.5, 0,0,0);
  const baseboardMeshR = roomBox(bbRightW, 3, 0.6, 0xc0bbb4,
    (doorRight + (-15 + backWallFullW/2))/2, floorY+1.5, 48.5, 0,0,0);
  const baseboardRetL=roomBox(0.6, 3, recessDepth, 0xc0bbb4, extLeft+0.5, floorY+1.5, 49-recessDepth/2, 0,0,0);
  // Right extrusion baseboard omitted — flush with side wall
  const baseboardRecessL=recessWallLeftW>0.5?roomBox(recessWallLeftW, 3, 0.6, 0xc0bbb4, extLeft+recessWallLeftW/2, floorY+1.5, recessZ+0.5, 0,0,0):null;
  const baseboardRecessR=recessWallRightW>0.5?roomBox(recessWallRightW, 3, 0.6, 0xc0bbb4, doorRight+recessWallRightW/2, floorY+1.5, recessZ+0.5, 0,0,0):null;
  
  // ─── Door ───
  const doorThick=1.5, doorFrameW=2.5, doorFrameD=recessDepth>4?4:recessDepth;
  const doorColor=0xf0ebe4; // warm off-white painted door
  const doorFrameColor=0xf5f5f0;
  
  // Door panel — hinged so it can swing open from the handle click.
  const doorPanelZ=recessZ-doorThick/2;
  const doorPanelW=doorW-1;
  const doorPanelH=doorH-0.5;
  const cornerDoorPivot=new THREE.Group();
  cornerDoorPivot.position.set(doorCenterX-doorPanelW/2, floorY+doorH/2, doorPanelZ);
  cornerDoorPivot._isRoom=true;
  addRoom(cornerDoorPivot);

  const doorPanelMat=new THREE.MeshStandardMaterial({color:doorColor, roughness:0.5, metalness:0.05});
  const doorPanel=new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorPanelH, doorThick), doorPanelMat);
  doorPanel.position.set(doorPanelW/2, 0, 0);
  doorPanel.castShadow=true;
  doorPanel.receiveShadow=true;
  doorPanel._isRoom=true;
  doorPanel._isCornerDoor=true;
  cornerDoorPivot.add(doorPanel);
  
  // Six-panel door detail — raised panels on both faces.
  const dpInset=0.3, dpW=doorW*0.35, dpH1=doorH*0.22, dpH2=doorH*0.30;
  const dpY=[doorH*0.14-doorH/2, doorH*0.42-doorH/2, doorH*0.74-doorH/2]; // centers of 3 rows (door-local)
  const dpHArr=[dpH1, dpH2, dpH1];
  const dpMat=new THREE.MeshStandardMaterial({color:0xe8e3dc,roughness:0.45,metalness:0.02});
  [-1, 1].forEach(faceSign=>{
    [-1,1].forEach(side=>{
      dpHArr.forEach((ph,ri)=>{
        const pg=new THREE.BoxGeometry(dpW, ph, dpInset);
        const pm=new THREE.Mesh(pg, dpMat);
        pm.position.set(
          doorPanelW/2+side*(doorW*0.2),
          dpY[ri],
          faceSign*(doorThick/2+dpInset/2+0.01)
        );
        pm.castShadow=false;
        pm._isRoom=true;
        pm._isCornerDoor=true;
        cornerDoorPivot.add(pm);
      });
    });
  });
  
  // Door frame (trim around opening — spans from recessed wall into room)
  const dfMat=new THREE.MeshStandardMaterial({color:doorFrameColor,roughness:0.35,metalness:0.05});
  const frameZ=recessZ-doorFrameD/2;
  // Left jamb
  const dfl=new THREE.Mesh(new THREE.BoxGeometry(doorFrameW, doorH, doorFrameD), dfMat);
  dfl.position.set(doorLeft-doorFrameW/2+0.5, floorY+doorH/2, frameZ);
  dfl.castShadow=false; dfl._isRoom=true; addRoom(dfl);
  // Right jamb
  const dfr=new THREE.Mesh(new THREE.BoxGeometry(doorFrameW, doorH, doorFrameD), dfMat);
  dfr.position.set(doorRight+doorFrameW/2-0.5, floorY+doorH/2, frameZ);
  dfr.castShadow=false; dfr._isRoom=true; addRoom(dfr);
  // Header
  const dfh=new THREE.Mesh(new THREE.BoxGeometry(doorW+doorFrameW*2-1, doorFrameW, doorFrameD), dfMat);
  dfh.position.set(doorCenterX, floorY+doorH+doorFrameW/2-0.5, frameZ);
  dfh.castShadow=false; dfh._isRoom=true; addRoom(dfh);
  
  // Door knob + plate (interactive) — front and back so both sides match.
  const knobMat=new THREE.MeshStandardMaterial({color:0xaaaaaa,roughness:0.25,metalness:0.8});
  const knobGeo=new THREE.SphereGeometry(1.2, 16, 12);
  const knob=new THREE.Mesh(knobGeo, knobMat);
  knob.position.set(doorPanelW/2+doorW*0.35, 36-doorH/2, -doorThick/2-1.2);
  knob.castShadow=false;
  knob._isRoom=true;
  knob._isCornerDoorHandle=true;
  cornerDoorPivot.add(knob);
  const knobBack=new THREE.Mesh(knobGeo, knobMat);
  knobBack.position.set(doorPanelW/2+doorW*0.35, 36-doorH/2, doorThick/2+1.2);
  knobBack.castShadow=false;
  knobBack._isRoom=true;
  knobBack._isCornerDoorHandle=true;
  cornerDoorPivot.add(knobBack);
  // Knob base plate
  const plateMat=new THREE.MeshStandardMaterial({color:0xbbbbbb,roughness:0.3,metalness:0.7});
  const plateGeo=new THREE.CylinderGeometry(1.8, 1.8, 0.3, 16);
  plateGeo.rotateX(Math.PI/2);
  const plate=new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(doorPanelW/2+doorW*0.35, 36-doorH/2, -doorThick/2-0.2);
  plate.castShadow=false;
  plate._isRoom=true;
  plate._isCornerDoorHandle=true;
  cornerDoorPivot.add(plate);
  const plateBack=new THREE.Mesh(plateGeo, plateMat);
  plateBack.position.set(doorPanelW/2+doorW*0.35, 36-doorH/2, doorThick/2+0.2);
  plateBack.castShadow=false;
  plateBack._isRoom=true;
  plateBack._isCornerDoorHandle=true;
  cornerDoorPivot.add(plateBack);

  // Simple smooth hinge animation for the corner door.
  let _cornerDoorOpen=false;
  let _cornerDoorAngle=0;
  let _cornerDoorAnim=0;
  const _cornerDoorOpenAngle=72*Math.PI/180;
  function _stepCornerDoor(){
    const target=_cornerDoorOpen?_cornerDoorOpenAngle:0;
    _cornerDoorAngle += (target-_cornerDoorAngle)*0.22;
    cornerDoorPivot.rotation.y=_cornerDoorAngle;
    if(Math.abs(target-_cornerDoorAngle)>0.001){
      _cornerDoorAnim=requestAnimationFrame(_stepCornerDoor);
    } else {
      _cornerDoorAngle=target;
      cornerDoorPivot.rotation.y=_cornerDoorAngle;
      _cornerDoorAnim=0;
    }
  }
  function toggleCornerDoor(forceOpen){
    _cornerDoorOpen = (typeof forceOpen==='boolean') ? forceOpen : !_cornerDoorOpen;
    if(_cornerDoorAnim) cancelAnimationFrame(_cornerDoorAnim);
    _cornerDoorAnim=requestAnimationFrame(_stepCornerDoor);
  }
  
  // Collect all back wall + recess meshes for fading
  const backWallParts=[wallMeshL,returnWallL,
    baseboardMeshL,baseboardMeshR,baseboardRetL];
  if(recessWallL) backWallParts.push(recessWallL);
  if(recessWallR) backWallParts.push(recessWallR);
  if(baseboardRecessL) backWallParts.push(baseboardRecessL);
  if(baseboardRecessR) backWallParts.push(baseboardRecessR);

  // ─── Hallway beyond the bedroom door ──────────────────────────────
  // 20 ft long hallway extruded out through the back wall, aligned to the
  // same X range as the door extrusion (extLeft..extRight) so the doorway
  // leads straight into it. Two closed decorative doors sit ~6 ft in on
  // opposite side walls.
  const _hallZStart = 49;
  const _hallLen = 240;                 // 20 ft
  const _hallZEnd = _hallZStart + _hallLen;  // 289
  const _hallCenterZ = (_hallZStart + _hallZEnd)/2; // 169
  const _hallXLeft = extLeft;           // 11 (pre-mirror; -11 world)
  const _hallXRight = extRight;         // 51 (pre-mirror; -51 world)
  const _hallCenterX = extCenterX;      // 31
  const _hallWidth = extrusionW;        // 40
  const _hallHeight = 80;               // match wallHeight
  const _hallWallColor = 0xd8d4ce;
  const _hallCeilColor = 0xe0ddd6;
  const _hallDoorCenterZ = _hallZStart + 72; // 6 ft into the hallway
  const _hallDoorW = 32;
  const _hallDoorH = 80;
  const _hallBbColor = 0xc0bbb4;

  // Floor extension — main floor plane is 200×200 centered at origin, so it
  // already reaches Z=+100. Extend from Z=100 to Z=_hallZEnd at the hallway's
  // X range using the same floor material so carpet tiling is continuous.
  {
    const extZMin = 100, extZMax = _hallZEnd;
    const extD = extZMax - extZMin;
    const floorExtGeo = new THREE.PlaneGeometry(_hallWidth, extD);
    const floorExt = new THREE.Mesh(floorExtGeo, floorMat);
    floorExt.rotation.x = -Math.PI/2;
    floorExt.position.set(_hallCenterX, floorY, (extZMin+extZMax)/2);
    floorExt.receiveShadow = true;
    floorExt._isRoom = true;
    floorExt._isFloor = true;
    floorExt._isHallway = true;
    addRoom(floorExt);
  }

  // Ceiling for the hallway — flat panel at the same height as the room ceiling
  {
    const ceilGeo = new THREE.BoxGeometry(_hallWidth, 0.5, _hallLen);
    const ceilMat = new THREE.MeshStandardMaterial({color:_hallCeilColor, roughness:0.9, metalness:0.0});
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.set(_hallCenterX, floorY+_hallHeight+0.25, _hallCenterZ);
    ceil.receiveShadow = true;
    ceil._isRoom = true;
    ceil._isHallway = true;
    addRoom(ceil);
  }

  // Hallway side walls — built as continuous boxes. The two hallway doors are
  // decorative closed panels attached to the interior face of each wall (not
  // actual openings), so the walls remain solid for collision and framing.
  const hallWallMat = new THREE.MeshStandardMaterial({color:_hallWallColor, roughness:0.7, metalness:0.05});
  // -X side wall (pre-mirror X=_hallXLeft=11)
  const hallWallL = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, _hallHeight, _hallLen),
    hallWallMat
  );
  hallWallL.position.set(_hallXLeft-0.25, floorY+_hallHeight/2, _hallCenterZ);
  hallWallL.castShadow = true; hallWallL.receiveShadow = true;
  hallWallL._isRoom = true; hallWallL._isHallway = true;
  addRoom(hallWallL);
  // +X side wall (pre-mirror X=_hallXRight=51). This is the continuation of
  // the main room's right wall so its inside face sits at +_hallXRight.
  const hallWallR = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, _hallHeight, _hallLen),
    hallWallMat
  );
  hallWallR.position.set(_hallXRight+0.25, floorY+_hallHeight/2, _hallCenterZ);
  hallWallR.castShadow = true; hallWallR.receiveShadow = true;
  hallWallR._isRoom = true; hallWallR._isHallway = true;
  addRoom(hallWallR);
  // End wall (Z=_hallZEnd)
  const hallWallEnd = new THREE.Mesh(
    new THREE.BoxGeometry(_hallWidth+1, _hallHeight, 0.5),
    hallWallMat
  );
  hallWallEnd.position.set(_hallCenterX, floorY+_hallHeight/2, _hallZEnd+0.25);
  hallWallEnd.castShadow = true; hallWallEnd.receiveShadow = true;
  hallWallEnd._isRoom = true; hallWallEnd._isHallway = true;
  addRoom(hallWallEnd);

  // Hallway baseboards — split around each decorative door so they don't
  // cross the door trim. Ends run from the bedroom-doorway jamb (Z=49) out
  // to the end wall (Z=_hallZEnd).
  {
    const bbColor = _hallBbColor;
    const doorZmin = _hallDoorCenterZ - _hallDoorW/2 - 2.5;
    const doorZmax = _hallDoorCenterZ + _hallDoorW/2 + 2.5;
    const segs = [
      { zMin: _hallZStart, zMax: doorZmin },
      { zMin: doorZmax,    zMax: _hallZEnd  },
    ];
    for (const s of segs){
      const w = s.zMax - s.zMin; if (w < 0.5) continue;
      const zc = (s.zMin+s.zMax)/2;
      // -X wall (box sits just inside the wall face)
      roomBox(0.6, 3, w, bbColor, _hallXLeft+0.5, floorY+1.5, zc, 0,0,0);
      // +X wall
      roomBox(0.6, 3, w, bbColor, _hallXRight-0.5, floorY+1.5, zc, 0,0,0);
    }
    // Baseboard along the end wall
    roomBox(_hallWidth, 3, 0.6, bbColor, _hallCenterX, floorY+1.5, _hallZEnd-0.5, 0,0,0);
  }

  // Two decorative doors, one on each side wall, ~6 ft in from the room.
  // Simple raised-panel style matching the bedroom door palette; no hinge
  // animation — they read as "other rooms" off the hallway.
  {
    const doorMat = new THREE.MeshStandardMaterial({color:0xf0ebe4, roughness:0.5, metalness:0.05});
    const trimMat = new THREE.MeshStandardMaterial({color:0xf5f5f0, roughness:0.35, metalness:0.05});
    const knobMat = new THREE.MeshStandardMaterial({color:0xaaaaaa, roughness:0.25, metalness:0.8});
    const dpAccentMat = new THREE.MeshStandardMaterial({color:0xe8e3dc, roughness:0.45, metalness:0.02});
    const panelThick = 1.2;
    const trimW = 2.5, trimD = 1;
    const headerH = 4;
    // sides: -1 → -X wall (door faces +X, into hallway), +1 → +X wall.
    const _hallwayDoorSides = [-1, +1];
    for (const side of _hallwayDoorSides){
      const wallX = side < 0 ? _hallXLeft : _hallXRight;
      // Door panel inset ~0.3" in front of the wall face so the painted face
      // reads inside the hallway and the trim brackets it.
      const innerFaceX = wallX + side*0.25; // inside surface of the wall
      const panelX = innerFaceX - side*(panelThick/2);
      const panelY = floorY + _hallDoorH/2;
      const panelZ = _hallDoorCenterZ;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(panelThick, _hallDoorH-1, _hallDoorW-1),
        doorMat
      );
      panel.position.set(panelX, panelY, panelZ);
      panel.castShadow = true; panel.receiveShadow = true;
      panel._isRoom = true; panel._isHallway = true;
      addRoom(panel);
      // Raised panel accents — three rows, two columns, on the hallway face.
      const faceX = panelX - side*(panelThick/2 + 0.15);
      const dpW = (_hallDoorW-1)*0.35;
      const dpH1 = _hallDoorH*0.22, dpH2 = _hallDoorH*0.30;
      const dpY = [
        panelY - _hallDoorH/2 + _hallDoorH*0.14,
        panelY - _hallDoorH/2 + _hallDoorH*0.42,
        panelY - _hallDoorH/2 + _hallDoorH*0.74,
      ];
      const dpHArr = [dpH1, dpH2, dpH1];
      for (const col of [-1, +1]){
        dpHArr.forEach((ph, ri) => {
          const dp = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, ph, dpW),
            dpAccentMat
          );
          dp.position.set(faceX, dpY[ri], panelZ + col*(_hallDoorW*0.2));
          dp.castShadow = false; dp.receiveShadow = true;
          dp._isRoom = true; dp._isHallway = true;
          addRoom(dp);
        });
      }
      // Door frame trim around the opening (on the hallway-facing side).
      // Header
      const trimX = innerFaceX - side*(trimD/2 + 0.04);
      const trH = new THREE.Mesh(
        new THREE.BoxGeometry(trimD, headerH, _hallDoorW+trimW*2),
        trimMat
      );
      trH.position.set(trimX, floorY+_hallDoorH+headerH/2, panelZ);
      trH.castShadow = false; trH.receiveShadow = true;
      trH._isRoom = true; trH._isHallway = true;
      addRoom(trH);
      // Left/right jambs (along Z)
      for (const jz of [-1, +1]){
        const tr = new THREE.Mesh(
          new THREE.BoxGeometry(trimD, _hallDoorH, trimW),
          trimMat
        );
        tr.position.set(trimX, floorY+_hallDoorH/2, panelZ + jz*(_hallDoorW/2+trimW/2));
        tr.castShadow = false; tr.receiveShadow = true;
        tr._isRoom = true; tr._isHallway = true;
        addRoom(tr);
      }
      // Doorknob on the hallway face
      const knob = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), knobMat);
      knob.position.set(faceX - side*0.2, panelY - _hallDoorH/2 + 36, panelZ + (_hallDoorW/2 - 4));
      knob.castShadow = false;
      knob._isRoom = true; knob._isHallway = true;
      addRoom(knob);
      const plateGeo = new THREE.CylinderGeometry(1.8, 1.8, 0.3, 16);
      plateGeo.rotateZ(Math.PI/2);
      const plate = new THREE.Mesh(plateGeo, knobMat);
      plate.position.set(faceX + side*0.05, panelY - _hallDoorH/2 + 36, panelZ + (_hallDoorW/2 - 4));
      plate.castShadow = false;
      plate._isRoom = true; plate._isHallway = true;
      addRoom(plate);
    }
  }

  // Trim around the bedroom-side of the back-wall doorway (hallway-facing)
  // so the hole has a clean jamb when viewed from the hallway.
  {
    const trimMat = new THREE.MeshStandardMaterial({color:0xf5f5f0, roughness:0.35, metalness:0.05});
    const trimW = 2.5, trimD = 1;
    const headerH = 4;
    const trimZ = 49 + 0.5 + trimD/2 + 0.04;
    // Header
    const trH = new THREE.Mesh(
      new THREE.BoxGeometry(doorW+trimW*2, headerH, trimD),
      trimMat
    );
    trH.position.set(doorCenterX, floorY+doorH+headerH/2, trimZ);
    trH.castShadow = false; trH.receiveShadow = true;
    trH._isRoom = true; trH._isHallway = true;
    addRoom(trH);
    for (const jx of [-1, +1]){
      const tr = new THREE.Mesh(
        new THREE.BoxGeometry(trimW, doorH, trimD),
        trimMat
      );
      tr.position.set(doorCenterX + jx*(doorW/2+trimW/2), floorY+doorH/2, trimZ);
      tr.castShadow = false; tr.receiveShadow = true;
      tr._isRoom = true; tr._isHallway = true;
      addRoom(tr);
    }
  }

  // Simple ceiling fixture + point light at the hallway midpoint so it's not
  // pitch black. Warm tone similar to the main room's ceiling light.
  {
    const fixMat = new THREE.MeshStandardMaterial({color:0xf4ead5, emissive:0xf4ead5, emissiveIntensity:0.45, roughness:0.5});
    const fixGeo = new THREE.CylinderGeometry(4, 4, 1.2, 24);
    const fix = new THREE.Mesh(fixGeo, fixMat);
    fix.position.set(_hallCenterX, floorY+_hallHeight-0.7, _hallCenterZ);
    fix.castShadow = false; fix.receiveShadow = false;
    fix._isRoom = true; fix._isHallway = true;
    addRoom(fix);
    const hallLight = new THREE.PointLight(0xffe6bb, 260, 220);
    hallLight.position.set(_hallCenterX, floorY+_hallHeight-6, _hallCenterZ);
    hallLight.castShadow = false;
    hallLight._isRoom = true; hallLight._isHallway = true;
    addRoom(hallLight);
  }

  // Book stack — between mug and lamp
  roomBox(5, 1.2, 7, 0x8b4513, tblX-1, floorY+tblH+0.6, tblZ+2, 0, 0.1, 0);
  roomBox(4.5, 0.8, 6.5, 0x2d5a27, tblX-1, floorY+tblH+1.6, tblZ+2, 0, -0.05, 0);
  
  // ─── Opposite wall + 65" OLED TV ───
  // oppWallZ declared in header
  const oppWall=roomBox(132, 80, 0.5, 0xd8d4ce, -15, floorY+40, oppWallZ, 0,0,0);
  const oppBaseboard=roomBox(132, 3, 0.6, 0xc0bbb4, -15, floorY+1.5, oppWallZ+0.5, 0,0,0);
  
  // 65" OLED: diagonal=65", 16:9 → ~56.7"W × 31.9"H, bezel ~0.3", depth ~1"
  const tvW=56.7, tvH=31.9, tvD=1.0, bezel=0.3;
  const tvCenterX=bedX; // centered on the bed
  const tvCenterY=floorY+46; // center of screen ~46" from floor
  const tvZ=oppWallZ+0.5+tvD/2+1.1; // 1" away from wall
  
  // Thin black bezel frame
  const tvFrame=roomRoundBox(tvW+bezel*2, tvH+bezel*2, tvD, 0.4, 0x111111,
    tvCenterX, tvCenterY, tvZ, 0,0,0);
  tvFrame.material.roughness=0.3;
  tvFrame.material.metalness=0.6;
  tvFrame._isTV=true;
  
  // Screen — dark glossy panel, optionally displays an image (pokopia.jpg if present).
  const screenGeo=new THREE.PlaneGeometry(tvW, tvH);
  const screenMat=stdMat({color:0x0a0a0a,roughness:0.05,metalness:0.0,envMapIntensity:1.5});
  screenMat.polygonOffset=true;
  screenMat.polygonOffsetFactor=-2;
  screenMat.polygonOffsetUnits=-2;
  screenMat.depthWrite=false;
  const screen=new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(tvCenterX, tvCenterY, tvZ+tvD/2+0.08);
  screen._isRoom=true;
  screen._isTV=true;
  addRoom(screen);
  // Load TV screen image — falls back silently to dark glass if file is missing.
  new THREE.TextureLoader().load(
    'img/pokopia.jpg',
    (tex)=>{
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy=Math.min(8, (state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 4));
      screen.material.map=tex;
      screen.material.emissiveMap=tex;
      screen.material.emissive=new THREE.Color(0xffffff);
      screen.material.emissiveIntensity=0.85;
      screen.material.color=new THREE.Color(0x000000);
      screen.material.roughness=0.4;
      screen.material.needsUpdate=true;
    },
    undefined,
    ()=>{ /* no-op if missing */ }
  );
  
  // Small bottom-center power nub (trapezoid pod + tiny center button).
  // TV ambient glow — washes the bed and floor in front of the TV.
  // Positioned well in front of the screen so it reaches the bed area.
  const tvGlow=new THREE.PointLight(0x6688cc,50,80,0.9);
  tvGlow.position.set(tvCenterX, tvCenterY, tvZ+tvD/2+12);
  tvGlow.castShadow=false;
  tvGlow._isRoom=true;
  addRoom(tvGlow);
  {
    const nubGroup=new THREE.Group();
    nubGroup.position.set(tvCenterX, tvCenterY-(tvH+bezel*2)/2-0.24, tvZ+tvD/2-0.06);
    nubGroup._isRoom=true;
  
    const nubWTop=2.25;
    const nubWBot=1.55;
    const nubH=0.4;
    const nubD=0.12;
    const nubShape=new THREE.Shape();
    nubShape.moveTo(-nubWTop/2, nubH/2);
    nubShape.lineTo(nubWTop/2, nubH/2);
    nubShape.lineTo(nubWBot/2, -nubH/2);
    nubShape.lineTo(-nubWBot/2, -nubH/2);
    nubShape.lineTo(-nubWTop/2, nubH/2);
    const nubGeo=new THREE.ExtrudeGeometry(nubShape,{depth:nubD,bevelEnabled:false});
    nubGeo.translate(0,0,-nubD/2);
    const nubMat=stdMat({color:0xaeb4bd,roughness:0.28,metalness:0.55});
    const nubMesh=new THREE.Mesh(nubGeo,nubMat);
    nubMesh.castShadow=false;
    nubMesh.receiveShadow=true;
    nubGroup.add(nubMesh);
  
    const btnMat=stdMat({color:0x8c929b,roughness:0.3,metalness:0.4});
    const btn=new THREE.Mesh(new THREE.CylinderGeometry(0.105,0.105,0.045,18),btnMat);
    btn.rotation.x=Math.PI/2;
    btn.position.set(0,-0.02,nubD/2+0.01);
    nubGroup.add(btn);
  
    const btnDot=new THREE.Mesh(
      new THREE.CircleGeometry(0.03,16),
      new THREE.MeshBasicMaterial({color:0xdadada,transparent:true,opacity:0.85})
    );
    btnDot.position.set(0,-0.02,nubD/2+0.028);
    nubGroup.add(btnDot);
  
    addRoom(nubGroup);
  }
  
  // ─── Mini split indoor unit (on TV wall, near closet wall, 1ft from ceiling) ───
  const msW=32, msH=11, msD=8; // typical wall-mount unit dimensions
  const msX=51-18-msW/2; // 1.5 feet gap from closet wall to edge of unit (before flip)
  const msY=floorY+80-12-msH/2; // 1 foot from ceiling
  const msZ=oppWallZ+0.5+msD/2; // flush against TV wall
  {
    const msMat=new THREE.MeshStandardMaterial({color:0xf0f0f0,roughness:0.3,metalness:0.05});
    // Main body — rounded rectangle
    const msBody=roomRoundBox(msW, msH, msD, 2, 0xf0f0f0, msX, msY, msZ, 0,0,0);
    msBody.material.roughness=0.3;
    msBody.material.metalness=0.05;
    // Bottom air vent — darker slit
    const ventMat=new THREE.MeshStandardMaterial({color:0x333333,roughness:0.5});
    const vent=new THREE.Mesh(new THREE.BoxGeometry(msW-4, 1.5, 0.3), ventMat);
    vent.position.set(msX, msY-msH/2+2, msZ+msD/2+0.16);
    vent._isRoom=true; addRoom(vent);
    // Horizontal louver lines on the vent
    for(let i=0;i<3;i++){
      const louver=new THREE.Mesh(new THREE.BoxGeometry(msW-6, 0.15, 0.4), msMat);
      louver.position.set(msX, msY-msH/2+1.2+i*0.5, msZ+msD/2+0.2);
      louver._isRoom=true; addRoom(louver);
    }
    // Small LED indicator dot
    const ledMat=new THREE.MeshStandardMaterial({color:0x00cc44,emissive:0x00cc44,emissiveIntensity:0.5});
    const led=new THREE.Mesh(new THREE.SphereGeometry(0.25,8,6), ledMat);
    led.position.set(msX+msW/2-3, msY-msH/2+3, msZ+msD/2+0.16);
    led._isRoom=true; addRoom(led);
    // Brand logo area (subtle lighter rectangle)
    const logoArea=new THREE.Mesh(new THREE.BoxGeometry(8,2,0.1),
      new THREE.MeshStandardMaterial({color:0xfafafa,roughness:0.2}));
    logoArea.position.set(msX, msY+msH/2-3, msZ+msD/2+0.06);
    logoArea._isRoom=true; addRoom(logoArea);
  }

  // ─── Cat food feeder on black shoe box (TV wall / closet corner) ────
  let _foodGroup = null;
  {
    // Placement: between TV wall and closet opening, ~1.5ft from closet wall.
    // Pre-mirror coords: sideWallX=51, oppWallZ=-78, closet edge at Z=-70.
    const boxCenterX = 28;    // box center
    const feederZ = -74;      // Z position for everything

    // ── Black shoe box (platform) ──
    const boxW = 24, boxH = 5, boxD = 16;
    const boxY = floorY + boxH / 2;
    const boxMat = new THREE.MeshStandardMaterial({color:0x111111, roughness:0.85, metalness:0.02});
    const shoeBox = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), boxMat);
    shoeBox.position.set(boxCenterX, boxY, feederZ);
    shoeBox.castShadow = true; shoeBox.receiveShadow = true;
    shoeBox._isFoodBowl = true;
    addRoom(shoeBox);

    // ── WOpet-style automatic cat feeder (offset toward closet = "left" in world) ──
    const topOfBox = floorY + boxH;
    const feederX = boxCenterX + 6; // shifted toward closet side

    // Main body — white rounded cylinder
    const bodyR = 4.2, bodyH = 8;
    const bodyY = topOfBox + bodyH / 2;
    const bodyMat = new THREE.MeshStandardMaterial({color:0xf0f0f0, roughness:0.35, metalness:0.05});
    const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR+0.3, bodyH, 32), bodyMat);
    body.position.set(feederX, bodyY, feederZ);
    body.castShadow = true; body.receiveShadow = true;
    body._isFoodBowl = true;
    addRoom(body);

    // Hopper — smoked transparent dome/cylinder on top
    const hopperR = 4.0, hopperH = 6;
    const hopperY = topOfBox + bodyH + hopperH / 2;
    const hopperMat = new THREE.MeshStandardMaterial({
      color:0x3d2b1a, roughness:0.15, metalness:0.02,
      transparent:true, opacity:0.55, side:THREE.DoubleSide
    });
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(hopperR-0.3, hopperR, hopperH, 32), hopperMat);
    hopper.position.set(feederX, hopperY, feederZ);
    hopper.castShadow = true; hopper.receiveShadow = true;
    hopper._isFoodBowl = true;
    addRoom(hopper);

    // Hopper lid — flat disc on top
    const lidMat = new THREE.MeshStandardMaterial({color:0x4a3828, roughness:0.3, metalness:0.05, transparent:true, opacity:0.6});
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(hopperR-0.2, hopperR-0.3, 0.5, 32), lidMat);
    lid.position.set(feederX, hopperY + hopperH/2 + 0.25, feederZ);
    lid._isFoodBowl = true;
    addRoom(lid);
    // Lid knob
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.6, 12), new THREE.MeshStandardMaterial({color:0x666666, roughness:0.4, metalness:0.3}));
    knob.position.set(feederX, hopperY + hopperH/2 + 0.8, feederZ);
    knob._isFoodBowl = true;
    addRoom(knob);

    // Kibble visible inside hopper — cluster of small brown spheres
    const kibbleMat = new THREE.MeshStandardMaterial({color:0x4a3020, roughness:0.9, metalness:0.0});
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (hopperR - 1.2);
      const kx = feederX + Math.cos(angle) * r;
      const kz = feederZ + Math.sin(angle) * r;
      const ky = hopperY - hopperH/2 + 0.4 + Math.random() * (hopperH * 0.6);
      const kSize = 0.2 + Math.random() * 0.15;
      const kibble = new THREE.Mesh(new THREE.SphereGeometry(kSize, 5, 4), kibbleMat);
      kibble.position.set(kx, ky, kz);
      kibble._isFoodBowl = true;
      addRoom(kibble);
    }

    // Front panel — black display area (faces +Z in pre-mirror → faces -Z in world)
    const panelW = 3.5, panelH = 3, panelD = 0.15;
    const panelY = bodyY + bodyH/2 - panelH/2 - 1.5;
    const panelZ = feederZ + bodyR + 0.1;
    const panelMat = new THREE.MeshStandardMaterial({color:0x111111, roughness:0.3, metalness:0.1});
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, panelH, panelD), panelMat);
    panel.position.set(feederX, panelY, panelZ);
    panel._isFoodBowl = true;
    addRoom(panel);

    // Blue LED status bar on the panel
    const ledBarMat = new THREE.MeshStandardMaterial({color:0x2288ff, emissive:0x2288ff, emissiveIntensity:0.6, roughness:0.2});
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 0.05), ledBarMat);
    ledBar.position.set(feederX, panelY + 0.5, panelZ + panelD/2 + 0.03);
    ledBar._isFoodBowl = true;
    addRoom(ledBar);

    // Two round buttons below the panel
    const btnMat = new THREE.MeshStandardMaterial({color:0xe8e8e8, roughness:0.3, metalness:0.05});
    for (let bi = -1; bi <= 1; bi += 2) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 12), btnMat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(feederX + bi * 1.0, panelY - panelH/2 - 0.7, panelZ + 0.1);
      btn._isFoodBowl = true;
      addRoom(btn);
    }

    // "wopet" brand text area — small lighter rectangle on hopper front
    const brandArea = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.08),
      new THREE.MeshStandardMaterial({color:0xff6633, emissive:0xff6633, emissiveIntensity:0.15, roughness:0.3}));
    brandArea.position.set(feederX, hopperY - 0.5, feederZ + hopperR + 0.05);
    brandArea._isFoodBowl = true;
    addRoom(brandArea);

    // Food chute — dark opening at front-bottom of feeder body where food
    // dispenses into the bowl. Sits at the body's front surface.
    const chuteW = 3.0, chuteH = 2.0, chuteD = 0.6;
    const chuteZ = feederZ + bodyR - chuteD / 2 + 0.05;
    const chuteY = topOfBox + chuteH / 2;
    const chuteMat = new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:0.9, metalness:0.0});
    const chute = new THREE.Mesh(new THREE.BoxGeometry(chuteW, chuteH, chuteD), chuteMat);
    chute.position.set(feederX, chuteY, chuteZ);
    chute._isFoodBowl = true;
    addRoom(chute);
    // Chute surround — thin white frame around the opening
    const csThick = 0.2;
    const csTop = new THREE.Mesh(new THREE.BoxGeometry(chuteW + csThick * 2, csThick, chuteD + 0.1), bodyMat);
    csTop.position.set(feederX, chuteY + chuteH / 2 + csThick / 2, chuteZ + 0.05);
    csTop._isFoodBowl = true;
    addRoom(csTop);
    const csL = new THREE.Mesh(new THREE.BoxGeometry(csThick, chuteH, chuteD + 0.1), bodyMat);
    csL.position.set(feederX - chuteW / 2 - csThick / 2, chuteY, chuteZ + 0.05);
    csL._isFoodBowl = true;
    addRoom(csL);
    const csR = new THREE.Mesh(new THREE.BoxGeometry(csThick, chuteH, chuteD + 0.1), bodyMat);
    csR.position.set(feederX + chuteW / 2 + csThick / 2, chuteY, chuteZ + 0.05);
    csR._isFoodBowl = true;
    addRoom(csR);

    // Food tray — rounded rectangle with very rounded edges, bowl in the middle,
    // embedded into the feeder body (~2.5" overlap)
    const trayW = 8, trayD = 7, trayH = 1.6, trayCornerR = 2.5;
    const embedDepth = 2.5; // how far back the tray tucks into the body
    const trayZ = feederZ + bodyR + trayD / 2 + 0.5 - embedDepth;
    const trayMat = new THREE.MeshStandardMaterial({color:0xe0e0e0, roughness:0.4, metalness:0.05});

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
    trayMesh._isFoodBowl = true;
    addRoom(trayMesh);

    // Inner bowl (hollow, sits in the hole we punched in the tray)
    const ibMat = new THREE.MeshStandardMaterial({color:0xd8d8d8, roughness:0.35, metalness:0.08, side: THREE.DoubleSide});
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
    innerBowl._isFoodBowl = true;
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

    // 1) Shoe box base (slight padding for forgiving hover at edges)
    const hbBase = new THREE.Mesh(
      new THREE.BoxGeometry(boxW + 1, boxH + 0.4, boxD + 1),
      hbMat
    );
    hbBase.position.set(boxCenterX, boxY, feederZ);
    hbBase._isFoodBowl = true;
    addRoom(hbBase);

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

    // 3) Front tray + bowl area (tight box covering the dish)
    const hbTrayH = trayH + ibDepth + 0.4; // tray + bowl rim height
    const hbTray = new THREE.Mesh(
      new THREE.BoxGeometry(trayW + 0.5, hbTrayH, trayD + 0.5),
      hbMat
    );
    hbTray.position.set(feederX, topOfBox + hbTrayH / 2, trayZ);
    hbTray._isFoodBowl = true;
    addRoom(hbTray);

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
      k._isFoodBowl = true;
      addRoom(k);
      _foodKibbles.push(k);
    }
    _foodGroup = _foodKibbles; // store array reference

    // ── Stainless steel water bowl (right / window side of box) ──
    const bowlX = boxCenterX - 6; // toward window ("right" in world)
    const bowlR = 3.2, bowlH = 1.2, bowlWall = 0.2, bowlLipW = 0.4, bowlLipH = 0.2;
    const bowlMat = stdMat({color:0xe8e8e8, roughness:0.08, metalness:0.92, envMapIntensity:2.0});
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
  const _closetW=48, _closetH=66, _closetInteriorH=wallHeight, _closetDepth=36, _closetInteriorW=64;
  const _closetZ=oppWallZ+_closetW/2+8; // = -46 (5.5" trim-to-TV-wall gap)
  const rightWall=(()=>{
    // Build the wall as an extruded rectangle with a rectangular hole at the
    // closet opening. Shape lives in Y-Z (the wall's face plane); extrudes along
    // +X, then positioned so the inward face sits at sideWallX.
    const wallMat=new THREE.MeshStandardMaterial({color:0xd8d4ce,roughness:0.7,metalness:0.05});
    const zCenter=-15;
    const wallShape=new THREE.Shape();
    const zMin=zCenter-wallDepth/2, zMax=zCenter+wallDepth/2;
    const yMin=0, yMax=wallHeight;
    wallShape.moveTo(zMin, yMin);
    wallShape.lineTo(zMax, yMin);
    wallShape.lineTo(zMax, yMax);
    wallShape.lineTo(zMin, yMax);
    wallShape.lineTo(zMin, yMin);
    // Rectangular hole for the closet opening. Bottom aligns with the wall
    // bottom; the threshold z-fighting is addressed by lifting the wall mesh a
    // hair above the floor and giving the wall material polygonOffset.
    const hZMin=_closetZ-_closetW/2, hZMax=_closetZ+_closetW/2;
    const hYMin=0, hYMax=_closetH;
    const hole=new THREE.Path();
    hole.moveTo(hZMin, hYMin);
    hole.lineTo(hZMax, hYMin);
    hole.lineTo(hZMax, hYMax);
    hole.lineTo(hZMin, hYMax);
    hole.lineTo(hZMin, hYMin);
    wallShape.holes.push(hole);
    const wallGeo=new THREE.ExtrudeGeometry(wallShape, {depth:0.5, bevelEnabled:false});
    // After extrude: shape axes are (Z,Y) in the local XY plane. Rotate so
    // shape's X-coord → world Z, shape's Y-coord → world Y, extrude → world +X.
    // ExtrudeGeometry extrudes along +Z of its own frame; rotate the whole geo
    // to map (localX→worldZ, localY→worldY, localZ→worldX).
    wallGeo.rotateY(-Math.PI/2);
    const rightWall=new THREE.Mesh(wallGeo, wallMat);
    rightWall.position.set(sideWallX, floorY-0.5, 0);
    rightWall.castShadow=true; rightWall.receiveShadow=true; rightWall._isRoom=true;
    addRoom(rightWall);
    // Extension panels on the main wall plane where the closet interior extends
    // past rightWall's Z span. These cover the "gaps" flanking the opening so
    // the closet doesn't look open to the void.
    const rwZMin=-15-wallDepth/2, rwZMax=-15+wallDepth/2;
    const intZMin=_closetZ-_closetInteriorW/2, intZMax=_closetZ+_closetInteriorW/2;
    if(intZMin<rwZMin){
      const w=rwZMin-intZMin;
      const ext=roomBox(0.5, wallHeight, w, 0xd8d4ce, sideWallX, floorY+wallHeight/2, (intZMin+rwZMin)/2, 0,0,0);
      ext._wallExtMinZ=true;
    }
    if(intZMax>rwZMax){
      const w=intZMax-rwZMax;
      const ext=roomBox(0.5, wallHeight, w, 0xd8d4ce, sideWallX, floorY+wallHeight/2, (rwZMax+intZMax)/2, 0,0,0);
      ext._wallExtMaxZ=true;
    }
    return rightWall;
  })();

  // Corner fill — patch the 0.5" gap between right wall (z=48.5) and back wall (z=49)
  roomBox(0.5, wallHeight, 0.5, 0xd8d4ce, sideWallX, floorY + wallHeight / 2, 48.75, 0, 0, 0);

  // Baseboard — break into two pieces so it doesn't cross the closet opening.
  // Inset by trimW (2.5") to not stick past the door trim.
  const bbTrimInset=2.5;
  const sideBaseboard1=roomBox(0.6, 3, (_closetZ-_closetW/2-bbTrimInset) - (-15 - wallDepth/2), 0xc0bbb4,
    sideWallX-0.5, floorY+1.5, (-15 - wallDepth/2 + (_closetZ-_closetW/2-bbTrimInset))/2, 0,0,0);
  const sideBaseboard2=roomBox(0.6, 3, (-15 + wallDepth/2) - (_closetZ+_closetW/2+bbTrimInset), 0xc0bbb4,
    sideWallX-0.5, floorY+1.5, (_closetZ+_closetW/2+bbTrimInset + (-15 + wallDepth/2))/2, 0,0,0);
  
  // ─── Bifold closet doors on right wall (becomes -X after flip) ───
  {
    const closetW=_closetW, closetH=_closetH; // share with the wall cut-out
    const closetX=sideWallX-0.5; // flush against wall
    const closetZ=_closetZ; // match the wall opening exactly
    const bifoldColor=0xe0d8cc;
    const bifoldMat=new THREE.MeshStandardMaterial({color:bifoldColor,roughness:0.72,metalness:0.0});
    const panelW2=closetW/4; // 4 panels (2 per side)
    const panelThick=1.2;
    // Two bifold leaves. Each leaf's pivot sits at its outer jamb (the hinge to
    // the wall). Inside the leaf, an outer panel is fixed and an inner panel is
    // attached via a second hinge group (the mid-leaf joint). Clicking a panel
    // toggles the whole leaf open/closed — we animate leafPivot.rotation.y = θ
    // and innerGroup.rotation.y = -2θ so the two panels fold into a V whose
    // endpoint stays along the wall track.
    const bifoldLeaves=[];
    window._bifoldLeavesRef=bifoldLeaves; // exposed for first-person collision
    const handleMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.3,metalness:0.15});
    for(let leafIdx=0; leafIdx<2; leafIdx++){
      const leafSide=leafIdx===0?-1:1; // -1 → -Z jamb leaf, +1 → +Z jamb leaf
      const leafPivot=new THREE.Group();
      leafPivot.position.set(closetX-panelThick/2, floorY+closetH/2, closetZ+leafSide*closetW/2);
      leafPivot._isRoom=true;
      leafPivot._isBifoldLeaf=true;
      leafPivot._leafOpen=false;
      leafPivot._leafAngle=0;       // current θ (rad)
      leafPivot._leafTarget=0;      // target θ (rad)
      leafPivot._leafSide=leafSide;
      addRoom(leafPivot);
      bifoldLeaves.push(leafPivot);
      // Outer panel — centered panelW2/2 along -leafSide*Z from pivot.
      function addRaisedDetails(parent, zCenter){
        const rpH1=closetH*0.35, rpH2=closetH*0.45;
        const rpW=panelW2*0.7;
        // Thin boxes proud of the door. Key fix: receiveShadow must match the
        // door (both true) or the panels look brighter under any shadow.
        const rp1=new THREE.Mesh(new THREE.BoxGeometry(0.3, rpH1, rpW), bifoldMat);
        rp1.position.set(panelThick/2+0.16, -closetH*0.26, zCenter);
        rp1.castShadow=true; rp1.receiveShadow=true;
        rp1._isBifoldLeaf=true; parent.add(rp1);
        const rp2=new THREE.Mesh(new THREE.BoxGeometry(0.3, rpH2, rpW), bifoldMat);
        rp2.position.set(panelThick/2+0.16, closetH*0.18, zCenter);
        rp2.castShadow=true; rp2.receiveShadow=true;
        rp2._isBifoldLeaf=true; parent.add(rp2);
      }
      const outerPanel=new THREE.Mesh(
        new THREE.BoxGeometry(panelThick, closetH-1, panelW2-0.3),
        bifoldMat
      );
      outerPanel.position.set(0, 0, -leafSide*panelW2/2);
      outerPanel.castShadow=true; outerPanel.receiveShadow=true;
      outerPanel._isBifoldLeaf=true;
      leafPivot.add(outerPanel);
      addRaisedDetails(leafPivot, -leafSide*panelW2/2);
      // Inner-panel hinge group — pivoted at the middle joint (panelW2 along
      // -leafSide*Z from leaf pivot).
      const innerGroup=new THREE.Group();
      innerGroup.position.set(0, 0, -leafSide*panelW2);
      leafPivot.add(innerGroup);
      leafPivot._innerGroup=innerGroup;
      const innerPanel=new THREE.Mesh(
        new THREE.BoxGeometry(panelThick, closetH-1, panelW2-0.3),
        bifoldMat
      );
      innerPanel.position.set(0, 0, -leafSide*panelW2/2);
      innerPanel.castShadow=true; innerPanel.receiveShadow=true;
      innerPanel._isBifoldLeaf=true;
      innerGroup.add(innerPanel);
      addRaisedDetails(innerGroup, -leafSide*panelW2/2);
      // White round handle on the inner panel, near the mid-leaf joint side so
      // it reads as the "pull" side of the bifold. Sits proud of the room-facing
      // face by ~0.6".
      const handle=new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), handleMat);
      handle.position.set(panelThick/2+0.6, 0, -leafSide*(panelW2*0.22));
      handle._isBifoldLeaf=true;
      const handleStem=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.55,10), handleMat);
      handleStem.rotation.z=Math.PI/2;
      handleStem.position.set(panelThick/2+0.25, 0, -leafSide*(panelW2*0.22));
      handleStem._isBifoldLeaf=true;
      innerGroup.add(handle);
      innerGroup.add(handleStem);
    }
    // Moulding / trim around the opening
    const trimMat=new THREE.MeshStandardMaterial({color:0xe4ddd1,roughness:0.7,metalness:0.0});
    const trimW=2.5, trimD=1;
    const headerH=4; // taller top casing for a proper door-header look
    // Top header
    const trimTop=new THREE.Mesh(new THREE.BoxGeometry(trimD, headerH, closetW+trimW*2), trimMat);
    trimTop.position.set(closetX-trimD/2, floorY+closetH+headerH/2, closetZ);
    trimTop.castShadow=true; trimTop.receiveShadow=true; trimTop._isRoom=true; addRoom(trimTop);
    // Left jamb
    const trimL=new THREE.Mesh(new THREE.BoxGeometry(trimD, closetH, trimW), trimMat);
    trimL.position.set(closetX-trimD/2, floorY+closetH/2, closetZ-closetW/2-trimW/2);
    trimL.castShadow=true; trimL.receiveShadow=true; trimL._isRoom=true; addRoom(trimL);
    // Right jamb
    const trimR=new THREE.Mesh(new THREE.BoxGeometry(trimD, closetH, trimW), trimMat);
    trimR.position.set(closetX-trimD/2, floorY+closetH/2, closetZ+closetW/2+trimW/2);
    trimR.castShadow=true; trimR.receiveShadow=true; trimR._isRoom=true; addRoom(trimR);
  
    // ─── Walk-in closet interior box (behind the wall opening) ───
    // The wall sits at x=sideWallX with a hole cut out and thickness 0.5 (so
    // its back face sits at sideWallX+0.5). Interior side walls and ceiling
    // start at sideWallX+0.5 to butt cleanly against the wall's back face
    // (avoiding z-fighting where they cross the solid part of the wall).
    const closetDepth=_closetDepth;
    const interiorW=_closetInteriorW;
    const interiorH=_closetInteriorH; // full room-height interior, independent of door opening
    const wallBack=0.5; // rightWall thickness
    // Side walls start at the inner face of the main wall (sideWallX+wallBack)
    // and extend past the back wall center to eliminate corner gaps.
    const innerDepth=closetDepth;
    const innerCx=sideWallX+wallBack+innerDepth/2;
    const insideMat=new THREE.MeshStandardMaterial({color:0xe4dcce,roughness:0.85,metalness:0.0});
    // Back wall
    const closetBack=new THREE.Mesh(new THREE.BoxGeometry(0.5, interiorH, interiorW), insideMat);
    closetBack.position.set(sideWallX+closetDepth, floorY+interiorH/2, closetZ);
    closetBack.castShadow=false; closetBack.receiveShadow=true; closetBack._isRoom=true; addRoom(closetBack);
    // +Z side wall
    const closetSideP=new THREE.Mesh(new THREE.BoxGeometry(innerDepth, interiorH, 0.5), insideMat);
    closetSideP.position.set(innerCx, floorY+interiorH/2, closetZ+interiorW/2);
    closetSideP.receiveShadow=true; closetSideP._isRoom=true; addRoom(closetSideP);
    // -Z side: the TV/mini-split wall (oppWallZ) extends into the closet depth
    // to act as the closet's -Z boundary. This eliminates the gap that caused
    // light bleed. The wall extends from sideWallX into the full closet depth.
    const oppWallExt=new THREE.Mesh(
      new THREE.BoxGeometry(closetDepth+1, interiorH, 0.5),
      new THREE.MeshStandardMaterial({color:0xd0ccc6, roughness:0.7, metalness:0.05})
    );
    oppWallExt.position.set(sideWallX+closetDepth/2, floorY+interiorH/2, oppWallZ);
    oppWallExt.receiveShadow=true; oppWallExt._isRoom=true; addRoom(oppWallExt);
    // Ceiling
    const closetCeil=new THREE.Mesh(new THREE.BoxGeometry(innerDepth, 0.5, interiorW), insideMat);
    closetCeil.position.set(innerCx, floorY+interiorH, closetZ);
    closetCeil.receiveShadow=true; closetCeil._isRoom=true; addRoom(closetCeil);
    // Clothes rod across the closet, ~30" below the ceiling
    const rodMat=new THREE.MeshStandardMaterial({color:0xb8b8b8,roughness:0.35,metalness:0.6});
    const rod=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,interiorW-2,14), rodMat);
    rod.rotation.x=Math.PI/2;
    rod.position.set(innerCx, floorY+interiorH-30, closetZ);
    rod.castShadow=true; rod._isRoom=true; addRoom(rod);
    // Shelf above the rod. Position constants are shared with the shelf
    // collision AABB and the shelf coin further below. Shelf is shallower
    // along X than the closet and pushed flush against the back wall.
    const shelfDrop=24;         // inches below the ceiling
    const shelfXDepth=14;       // shelf depth along X (room-to-back axis)
    const shelfBackGap=0.1;     // gap between shelf and back wall (flush)
    // Back wall inner face is at sideWallX+closetDepth-0.5. Center the shelf
    // against it with shelfBackGap of clearance.
    const shelfCenterX=sideWallX+closetDepth-0.5-shelfBackGap-shelfXDepth/2;
    const shelfY=floorY+interiorH-shelfDrop;
    const shelfMat=new THREE.MeshStandardMaterial({color:0xdcd2c0,roughness:0.75,metalness:0.0});
    const shelfLen=interiorW-1;
    const shelf=new THREE.Mesh(new THREE.BoxGeometry(shelfXDepth, 0.8, shelfLen), shelfMat);
    shelf.position.set(shelfCenterX, shelfY, closetZ);
    shelf.castShadow=true; shelf.receiveShadow=true; shelf._isRoom=true; addRoom(shelf);
    // Three vertical dividers split the shelf into 4 equal sections. Each
    // divider runs from just above the shelf top up to the closet ceiling.
    const divThick=0.6;
    const divTopY=floorY+interiorH-0.5; // just below ceiling panel
    const divBotY=shelfY+0.4;           // top face of shelf
    const divH=divTopY-divBotY;
    const divCenterY=(divTopY+divBotY)/2;
    const shelfZMin=closetZ-shelfLen/2;
    for(let i=1;i<=3;i++){
      const zC=shelfZMin + (shelfLen*i/4);
      const div=new THREE.Mesh(new THREE.BoxGeometry(shelfXDepth, divH, divThick), shelfMat);
      div.position.set(shelfCenterX, divCenterY, zC);
      div.castShadow=true; div.receiveShadow=true; div._isRoom=true;
      addRoom(div);
    }
    // Z-center of the 1st section (between the -Z shelf end and divider #1).
    const section1Z = shelfZMin + (shelfLen/4)/2; // = shelfZMin + shelfLen/8
    window._closetShelf1Z = section1Z;
  }
  
  // ─── Left side wall with window (near the bed) ───
  // leftWallX declared in header
  // winW, winH declared in header
  // winCenterY declared in header
  // winCenterZ declared in header
  const winBottom=winCenterY-winH/2;
  const winTop=winCenterY+winH/2;
  const winFront=winCenterZ-winW/2;
  const winBack=winCenterZ+winW/2;
  
  // Keep daylight aligned with the mirrored window opening to avoid overhead leakage.
  const mirroredWindowX=-leftWallX;
  // key light repositioning moved to lighting module — needs window coords
  // key.position.set(mirroredWindowX+14, winCenterY+3, winCenterZ);
  // key.target.position.set(0, winCenterY+1, winCenterZ);
  
  // Wall sections around the window (4 pieces: below, above, front, back)
  // Below window
  const belowH=winBottom-floorY;
  const leftWallBelow=roomBox(0.5, belowH, wallDepth, 0xd8d4ce, leftWallX, floorY+belowH/2, -15, 0,0,0);
  // Above window
  const aboveH=floorY+wallHeight-winTop;
  const leftWallAbove=roomBox(0.5, aboveH, wallDepth, 0xd8d4ce, leftWallX, winTop+aboveH/2, -15, 0,0,0);
  // Front of window (toward TV wall)
  const frontZmin=oppWallZ;
  const frontW=winFront-frontZmin;
  const leftWallFront=roomBox(0.5, winH, frontW, 0xd8d4ce, leftWallX, winCenterY, frontZmin+frontW/2, 0,0,0);
  // Back of window (toward Z=+50)
  const backZmax=49;
  const backW=backZmax-winBack;
  const leftWallBack=roomBox(0.5, winH, backW, 0xd8d4ce, leftWallX, winCenterY, winBack+backW/2, 0,0,0);
  
  // Baseboard on left wall
  const leftBaseboard=roomBox(0.6, 3, wallDepth, 0xc0bbb4, leftWallX+0.5, floorY+1.5, -15, 0,0,0);
  
  // Corner fill — patch gap between left wall (z=48.5) and back wall (z=49)
  roomBox(0.5, wallHeight, 0.5, 0xd8d4ce, leftWallX, floorY + wallHeight / 2, 48.75, 0, 0, 0);

  // Window sill
  roomBox(0.8, 0.5, winW+2, 0xc8c4be, leftWallX+0.4, winBottom-0.25, winCenterZ, 0,0,0);
  
  // Window frame (thin white trim) — sit fully proud of the wall surface.
  // The wall sections around the opening (above/below/front/back) are 0.5" thick
  // centered at leftWallX, so their inner face is at leftWallX+0.25. The trim
  // back face must clear that plane or its edges become coplanar with the wall
  // (along the winTop/winBottom/winFront/winBack boundaries) and z-fight.
  const frameMat=stdMat({color:0xf5f5f0,shininess:10});
  const frameT=0.8, frameD=0.6;
  const wallInnerX = leftWallX + 0.25;
  const trimX = wallInnerX + frameD / 2 + 0.04; // back face ~0.04" proud of wall
  // Top
  const wft=new THREE.Mesh(new THREE.BoxGeometry(frameD, frameT, winW+frameT*2), frameMat);
  wft.position.set(trimX, winTop+frameT/2, winCenterZ); wft._isRoom=true; wft._isWindow=true; addRoom(wft);
  // Bottom
  const wfb=new THREE.Mesh(new THREE.BoxGeometry(frameD, frameT, winW+frameT*2), frameMat);
  wfb.position.set(trimX, winBottom-frameT/2, winCenterZ); wfb._isRoom=true; wfb._isWindow=true; addRoom(wfb);
  // Left (toward outside)
  const wfl=new THREE.Mesh(new THREE.BoxGeometry(frameD, winH, frameT), frameMat);
  wfl.position.set(trimX, winCenterY, winFront-frameT/2); wfl._isRoom=true; wfl._isWindow=true; addRoom(wfl);
  // Right (toward inside)
  const wfr=new THREE.Mesh(new THREE.BoxGeometry(frameD, winH, frameT), frameMat);
  wfr.position.set(trimX, winCenterY, winBack+frameT/2); wfr._isRoom=true; wfr._isWindow=true; addRoom(wfr);
  // Horizontal mullion (center bar)
  const wfm=new THREE.Mesh(new THREE.BoxGeometry(frameD, frameT*0.6, winW), frameMat);
  wfm.position.set(trimX, winCenterY, winCenterZ); wfm._isRoom=true; wfm._isWindow=true; addRoom(wfm);
  
  // Outdoor scene visible through window — same composition for day + night.
  const _clouds = [[80,90,60,25],[200,70,80,30],[350,100,55,20],[430,60,70,28]];
  function drawOutdoorScene(ctx, night){
    const skyGrad=ctx.createLinearGradient(0,0,0,300);
    if(night){
      skyGrad.addColorStop(0,'#0d1425');
      skyGrad.addColorStop(0.35,'#1a2740');
      skyGrad.addColorStop(0.55,'#232f45');
      skyGrad.addColorStop(0.7,'#2b3242');
    } else {
      skyGrad.addColorStop(0,'#6a99c4');
      skyGrad.addColorStop(0.35,'#a8c8da');
      skyGrad.addColorStop(0.55,'#ddd8c8');
      skyGrad.addColorStop(0.7,'#f0e8d8');
    }
    ctx.fillStyle=skyGrad;
    ctx.fillRect(0,0,512,300);

    // Distant hazy hills (same profile)
    ctx.fillStyle=night?'#34404a':'#8aab8a';
    ctx.beginPath(); ctx.moveTo(0,300);
    for(let x=0;x<=512;x+=8) ctx.lineTo(x,280-Math.sin(x*0.012)*18-Math.sin(x*0.031)*8);
    ctx.lineTo(512,300); ctx.fill();

    // Closer tree line (same profile)
    ctx.fillStyle=night?'#263427':'#4a7a4a';
    ctx.beginPath(); ctx.moveTo(0,310);
    for(let x=0;x<=512;x+=4){
      const base=295-Math.sin(x*0.02)*10;
      const tree=Math.sin(x*0.08)*12+Math.sin(x*0.15)*6+Math.cos(x*0.05)*8;
      ctx.lineTo(x,base-Math.max(tree,0));
    }
    ctx.lineTo(512,310); ctx.fill();

    // Ground / grass (same geometry)
    const grassGrad=ctx.createLinearGradient(0,310,0,512);
    if(night){
      grassGrad.addColorStop(0,'#2b3f27');
      grassGrad.addColorStop(0.4,'#223521');
      grassGrad.addColorStop(1,'#182817');
    } else {
      grassGrad.addColorStop(0,'#5a8a45');
      grassGrad.addColorStop(0.4,'#4a7a3a');
      grassGrad.addColorStop(1,'#3a6a2a');
    }
    ctx.fillStyle=grassGrad; ctx.fillRect(0,305,512,207);

    // Same cloud placements; dimmer at night.
    ctx.globalAlpha=night?0.14:0.3;
    ctx.fillStyle=night?'#9db2cf':'#ffffff';
    _clouds.forEach(([cx,cy,rx,ry])=>{
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1.0;
  }

  const outdoorCvs=document.createElement('canvas');
  outdoorCvs.width=512; outdoorCvs.height=512;
  const oCtx=outdoorCvs.getContext('2d');
  drawOutdoorScene(oCtx, false);
  const outdoorTex=new THREE.CanvasTexture(outdoorCvs);
  outdoorTex.generateMipmaps=false;
  outdoorTex.minFilter=THREE.LinearFilter;

  const nightOutdoorCvs=document.createElement('canvas');
  nightOutdoorCvs.width=512; nightOutdoorCvs.height=512;
  const nCtx=nightOutdoorCvs.getContext('2d');
  drawOutdoorScene(nCtx, true);
  const nightOutdoorTex=new THREE.CanvasTexture(nightOutdoorCvs);
  nightOutdoorTex.generateMipmaps=false;
  nightOutdoorTex.minFilter=THREE.LinearFilter;
  
  // Auto-detect night based on local clock (before 6 AM or after 8 PM)
  const _curHour = new Date().getHours();
  let _windowIsNight = _curHour >= 20 || _curHour < 6;
  const _outdoorDayTex=outdoorTex;
  const _outdoorNightTex=nightOutdoorTex;
  
  const outdoorMat=new THREE.MeshBasicMaterial({map:_windowIsNight?nightOutdoorTex:outdoorTex, color:_windowIsNight?0x445566:0xfff0d4});
  outdoorMat.toneMapped=false;
  const outdoorGeo=new THREE.PlaneGeometry(winW*2.5, winH*2);
  const outdoor=new THREE.Mesh(outdoorGeo, outdoorMat);
  outdoor.rotation.y=Math.PI/2;
  outdoor.position.set(leftWallX-4, winCenterY+5, winCenterZ);
  outdoor._isRoom=true; outdoor._isWindow=true; addRoom(outdoor);
  
  // Moonlight glow through the window — subtle blue-white light that's
  // controlled by time-of-day (bright at night, off during day).
  const moonGlow=new THREE.PointLight(0x8899bb,0,60,1.0);
  moonGlow.position.set(leftWallX+3, winCenterY, winCenterZ);
  moonGlow.castShadow=false;
  moonGlow._isRoom=true;
  addRoom(moonGlow);
  
  // Ceiling light fixture — flush-mount dome with warm SpotLight
  const ceilY=floorY+79.5; // just below ceiling
  // ceilLightX, ceilLightZ declared in header
  // Fixture base (flush mount disc)
  const fixBase=new THREE.Mesh(
    new THREE.CylinderGeometry(4,4,0.4,24),
    new THREE.MeshStandardMaterial({color:0xd8d4c8,roughness:0.4,metalness:0.1})
  );
  fixBase.position.set(ceilLightX,ceilY,ceilLightZ);
  fixBase._isRoom=true; fixBase._isCeilLight=true; addRoom(fixBase);
  // Frosted glass dome
  const domeMat=stdMat({color:0xfff8ee,emissive:0xfff0d0,emissiveIntensity:0.55,transparent:true,opacity:0.85,shininess:60});
  const dome=new THREE.Mesh(new THREE.SphereGeometry(3.5,16,8,0,Math.PI*2,0,Math.PI/2),domeMat);
  dome.rotation.x=Math.PI; // flip dome to hang down
  dome.position.set(ceilLightX,ceilY-0.2,ceilLightZ);
  dome._isRoom=true; dome._isCeilLight=true; addRoom(dome);
  // Downward spot lights the floor (main pool). Ceiling + upper walls need
  // their own source since a spot only throws inside its cone, and the room
  // has no global ambient bounce. We split those two jobs on purpose.
  const ceilSpot=new THREE.SpotLight(0xfff0dd,60,0,Math.PI*0.42,0.6,0.9);
  ceilSpot.position.set(ceilLightX,ceilY-1,ceilLightZ);
  ceilSpot.target.position.set(ceilLightX,floorY,ceilLightZ);
  addRoom(ceilSpot); addRoom(ceilSpot.target);
  ceilSpot.castShadow=false;
  ceilSpot.shadow.mapSize.set(512,512);
  ceilSpot.shadow.bias=-0.0005;
  ceilSpot.shadow.radius=5; ceilSpot.shadow.blurSamples=12;
  ceilSpot.shadow.camera.near=10;
  ceilSpot.shadow.camera.far=95;
  // ── IMPORTANT: ceiling light fixture vs. light source positioning ──────────
  // The fixture MESH (fixBase, dome) is at (ceilLightX=0, ceilY, ceilLightZ=-15)
  // but the actual LIGHT SOURCE (ceilGlow) is at (-45, ceilY-8, 51). These are
  // NOT at the same coordinates and never were. An hour of troubleshooting
  // The light SOURCE should be co-located with the fixture mesh and tagged
  // _isRoom so it moves with the room when placement changes. Previously
  // it was at a hardcoded world position that only matched in Under TV mode.
  ceilGlow=new THREE.PointLight(0xfff3df,25,0,0.8);
  ceilGlow.position.set(ceilLightX,ceilY-8,ceilLightZ);
  ceilGlow.castShadow=false;
  ceilGlow._isRoom=true;
  addRoom(ceilGlow);
  
  // Curtains — draped fabric panels with ripple folds
  const curtainH=winH+12, curtainW=14, curtainD=2;
  const curtainMat=new THREE.MeshStandardMaterial({color:0xc5bfb5,roughness:0.95,metalness:0,side:THREE.DoubleSide});
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
  cL.position.set(leftWallX+1.2, winCenterY, winFront-curtainW/2-1);
  cL.castShadow=true; cL.receiveShadow=true; cL._isRoom=true; addRoom(cL);
  // Back curtain (toward Z=+50 side of window)
  const cRGeo = makeCurtainGeo(curtainW, curtainH, curtainD);
  const cR = new THREE.Mesh(cRGeo, curtainMat);
  cR.position.set(leftWallX+1.2, winCenterY, winBack+curtainW/2+1);
  cR.castShadow=true; cR.receiveShadow=true; cR._isRoom=true; addRoom(cR);
  // Curtain rod
  const rodGeo=new THREE.CylinderGeometry(0.25,0.25,winW+curtainW*2+8,8);
  rodGeo.rotateX(Math.PI/2);
  const rodMat=new THREE.MeshStandardMaterial({color:0x444444,roughness:0.3,metalness:0.7});
  const rod=new THREE.Mesh(rodGeo,rodMat);
  rod.position.set(leftWallX+1.5, winTop+4, winCenterZ);
  rod.castShadow=false; rod._isRoom=true; addRoom(rod);
  
  // Mark only wall meshes that actually fade as transparent (keeps other room objects in fast opaque pass)
  // Upholstered headboard (full height, at back of bed)
  const hbThick=3, hbH=bedH-bedClearance, hbW=bedW;
  const headboard=roomRoundBox(hbW, hbH, hbThick, 2, 0x4a4a55,
    bedX, floorY+bedClearance+hbH/2, bedZ+bedL/2-hbThick/2, 0,0,0);
  // Give headboard a fabric look
  headboard.material.roughness=0.95;
  
  // Side rails — upholstered panels running the length
  const railH=bedSlatsFromFloor-bedClearance; // height from clearance to slat level = 7.5"
  const railThick=1.5;
  const railY=floorY+bedClearance+railH/2;
  // Left rail
  const lRail=roomRoundBox(railThick, railH, bedL, 1, 0x4a4a55,
    bedX-bedW/2+railThick/2, railY, bedZ, 0,0,0);
  lRail.material.roughness=0.95;
  // Right rail
  const rRail=roomRoundBox(railThick, railH, bedL, 1, 0x4a4a55,
    bedX+bedW/2-railThick/2, railY, bedZ, 0,0,0);
  rRail.material.roughness=0.95;
  
  // Footboard — lower profile
  const fbH=railH, fbThick=2;
  const footboard=roomRoundBox(bedW, fbH, fbThick, 1.5, 0x4a4a55,
    bedX, railY, bedZ-bedL/2+fbThick/2, 0,0,0);
  footboard.material.roughness=0.95;
  
  // Slat platform (at 14" from floor)

  const slatY=floorY+bedSlatsFromFloor;
  roomBox(bedW-2*railThick, 1.0, bedL-hbThick-fbThick, 0x3a3a44,
    bedX, slatY, bedZ+(hbThick-fbThick)/2, 0,0,0);
  
  // Legs — cylinders at corners reaching from floor to slat platform
  const legBedH=bedSlatsFromFloor, legBedR=1.2;
  const legPositions=[
    [bedX-bedW/2+3, bedZ-bedL/2+3],
    [bedX+bedW/2-3, bedZ-bedL/2+3],
    [bedX-bedW/2+3, bedZ+bedL/2-3],
    [bedX+bedW/2-3, bedZ+bedL/2-3],
  ];
  for(const [lx,lz] of legPositions){
    const lg=new THREE.CylinderGeometry(legBedR,legBedR,legBedH,12);
    const lm=new THREE.MeshStandardMaterial({color:0x222222,roughness:0.6});
    const lmesh=new THREE.Mesh(lg,lm);
    lmesh.position.set(lx, floorY+legBedH/2, lz);
    lmesh.castShadow=false; lmesh.receiveShadow=true; lmesh._isRoom=true;
    addRoom(lmesh);
  }

  // Under-bed frame — center rail + cross supports (visible when cat walks under)
  const bedFrameY=floorY+bedSlatsFromFloor-0.5; // just below slat platform
  // Center rail running length of bed
  const centerRailW=2, centerRailH=1.5;
  const innerL=bedL-hbThick-fbThick;
  roomBox(centerRailW, centerRailH, innerL, 0x2a2a2a,
    bedX, bedFrameY-centerRailH/2, bedZ+(hbThick-fbThick)/2, 0,0,0);
  // Cross supports (4 evenly spaced)
  const innerW=bedW-2*railThick-2;
  const crossH=1.2, crossD=2;
  for(let i=0;i<4;i++){
    const t=(i+1)/5;
    const cz=bedZ-innerL/2+innerL*t+(hbThick-fbThick)/2;
    roomBox(innerW, crossH, crossD, 0x2a2a2a,
      bedX, bedFrameY-crossH/2, cz, 0,0,0);
  }
  
  // Mattress (approx 60"×80"×10")
  const mattW=58, mattL=78, mattH=10;
  const mattY=slatY+1+mattH/2;
  const mattCenterZ=bedZ+(hbThick-fbThick)/2;
  const mattress=roomRoundBox(mattW, mattH, mattL, 3, 0xd4cdc0,
    bedX, mattY, mattCenterZ, 0,0,0);
  mattress.material.roughness=0.92;
  mattress.material.color.set(0xd4cdc0);
  
  // Pillow pair — puffy rectangular shapes via vertex-displaced box
  const pillowW=22, pillowH=4, pillowD=14;
  const pillowY=mattY+mattH/2-0.8; // sits snug on mattress surface
  const pillowBaseZ=bedZ+bedL/2-hbThick-pillowD/2-2;
  const pillows=[];
  for(const px of [-13, 13]){
    const pGeo=new THREE.BoxGeometry(pillowW, pillowH, pillowD, 16, 8, 12);
    const pp=pGeo.attributes.position;
    for(let i=0;i<pp.count;i++){
      let x=pp.getX(i), y=pp.getY(i), z=pp.getZ(i);
      // Normalized coords (-1 to 1)
      const nx=x/(pillowW/2), ny=y/(pillowH/2), nz=z/(pillowD/2);
      // Round the edges: pull corners inward using a soft rounding
      const edgeRound=2.5;
      const ex=Math.max(0, Math.abs(x)-pillowW/2+edgeRound);
      const ey=Math.max(0, Math.abs(y)-pillowH/2+edgeRound);
      const ez=Math.max(0, Math.abs(z)-pillowD/2+edgeRound);
      const dist=Math.sqrt(ex*ex+ey*ey+ez*ez);
      if(dist>edgeRound){
        const scale=edgeRound/dist;
        if(ex>0) x=Math.sign(x)*(pillowW/2-edgeRound+ex*scale);
        if(ey>0) y=Math.sign(y)*(pillowH/2-edgeRound+ey*scale);
        if(ez>0) z=Math.sign(z)*(pillowD/2-edgeRound+ez*scale);
      }
      // Puffiness: inflate top center upward
      const cx=nx*nx, cz=nz*nz;
      const puff=(1-cx)*(1-cz);
      if(y>0) y+=puff*1.5;
      // Flatten bottom slightly
      if(y<0) y*=0.6;
      pp.setX(i,x); pp.setY(i,y); pp.setZ(i,z);
    }
    pGeo.computeVertexNormals();
    const pMat=stdMat({color:0xeae6de, roughness:0.92});
    const pillow=new THREE.Mesh(pGeo, pMat);
    pillow.position.set(bedX+px, pillowY+pillowH/2, pillowBaseZ);
    pillow.rotation.set(0, px>0?0.05:-0.05, px>0?-0.03:0.03);
    pillow.castShadow=true; pillow.receiveShadow=true; pillow._isRoom=true;
    addRoom(pillow);
    pillows.push(pillow);
  }
  
  // Duvet / comforter — thin blanket that drapes over mattress edges
  const duvetH=1.5;
  const duvetL=mattL-pillowD-4;
  const duvetZ=mattCenterZ-(mattL/2-duvetL/2)-1.5; // shifted toward foot of bed
  // Generate a wrinkle normal map
  const duvetCanvas=document.createElement('canvas');
  duvetCanvas.width=256; duvetCanvas.height=256;
  const dctx=duvetCanvas.getContext('2d');
  dctx.fillStyle='#6b6b72';
  dctx.fillRect(0,0,256,256);
  // Dense velvet fiber texture — short fuzzy strokes for fabric feel
  for(let i=0;i<3000;i++){
    const fx=Math.random()*256, fy=Math.random()*256;
    const bright=90+Math.random()*40;
    dctx.strokeStyle=`rgba(${bright},${bright-2},${bright+4},${0.15+Math.random()*0.2})`;
    dctx.lineWidth=0.5+Math.random()*1.5;
    dctx.beginPath();
    dctx.moveTo(fx, fy);
    dctx.lineTo(fx+Math.random()*4-2, fy+2+Math.random()*4);
    dctx.stroke();
  }
  // Subtle wrinkle folds on top
  for(let i=0;i<25;i++){
    const y=Math.random()*256;
    dctx.strokeStyle=`rgba(${85+Math.random()*25},${83+Math.random()*22},${90+Math.random()*22},${0.08+Math.random()*0.12})`;
    dctx.lineWidth=3+Math.random()*5;
    dctx.beginPath();
    dctx.moveTo(0, y+Math.random()*10);
    for(let x=0;x<256;x+=20){
      dctx.lineTo(x, y+Math.sin(x*0.05)*8+Math.random()*6);
    }
    dctx.stroke();
  }
  const duvetTex=new THREE.CanvasTexture(duvetCanvas);
  duvetTex.wrapS=duvetTex.wrapT=THREE.RepeatWrapping;
  duvetTex.repeat.set(3,4);
  // Generate a bump map for extra fabric relief
  const _bumpCanvas=document.createElement('canvas');
  _bumpCanvas.width=256; _bumpCanvas.height=256;
  const _bctx=_bumpCanvas.getContext('2d');
  _bctx.fillStyle='#808080';
  _bctx.fillRect(0,0,256,256);
  for(let i=0;i<4000;i++){
    const bx=Math.random()*256, by=Math.random()*256;
    const v=Math.random()>0.5?140+Math.random()*50:60+Math.random()*50;
    _bctx.fillStyle=`rgba(${v},${v},${v},0.3)`;
    _bctx.fillRect(bx, by, 1+Math.random()*2, 1+Math.random()*3);
  }
  const duvetBump=new THREE.CanvasTexture(_bumpCanvas);
  duvetBump.wrapS=duvetBump.wrapT=THREE.RepeatWrapping;
  duvetBump.repeat.set(4,6);
  // Continuous blanket — single mesh with vertex-displaced draped edges (no seams)
  const _bSideHang=2.5, _bFootHang=3, _bMaxDrape=10;
  const _bTotW=mattW+_bSideHang*2, _bTotL=duvetL+_bFootHang;
  const blanketGeo=new THREE.BoxGeometry(_bTotW, duvetH, _bTotL, 28, 1, 36);
  const _bp=blanketGeo.attributes.position;
  for(let i=0;i<_bp.count;i++){
    let x=_bp.getX(i), y=_bp.getY(i), z=_bp.getZ(i);
    z-=_bFootHang/2; // shift so extra length extends past foot (-Z)
    // Side drape: vertices past mattress edge drop nearly straight down
    const sx=Math.max(0,Math.abs(x)-mattW/2);
    const sideDrop=sx>0 ? _bMaxDrape*(sx/_bSideHang) : 0;
    if(sx>0) x=Math.sign(x)*(mattW/2+sx*0.25);
    // Foot drape: vertices past foot edge drop nearly straight down
    const fz=Math.max(0,-duvetL/2-z);
    const footDrop=fz>0 ? _bMaxDrape*(fz/_bFootHang) : 0;
    if(fz>0) z=-duvetL/2-fz*0.25;
    // Use the larger of the two drops at corners (not the sum) so corner
    // vertices don't stretch to an unnatural point below the edge drape.
    const drop=Math.max(sideDrop, footDrop);
    _bp.setX(i,x); _bp.setY(i,y-drop); _bp.setZ(i,z);
  }
  blanketGeo.computeVertexNormals();
  const duvet=new THREE.Mesh(blanketGeo, stdMat({color:0x6e6e78, roughness:1.0, metalness:0.0, map:duvetTex, bumpMap:duvetBump, bumpScale:0.1}));
  duvet.position.set(bedX, mattY+mattH/2+duvetH/2, duvetZ);
  duvet.castShadow=true; duvet.receiveShadow=true; duvet._isRoom=true;
  addRoom(duvet);

  // ── Items under the bed (partially hiding the coin) ────────────────
  {
    const underBedY = floorY;
    const itemX = bedX + 5; // slightly off-center
    const itemZ = bedZ + 4; // near coin

    // Helper: load SVG to canvas for texture
    function loadSvgTex(url, size, cb) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        cb(new THREE.CanvasTexture(c));
      };
      img.crossOrigin = 'anonymous';
      img.src = url;
    }

    // 1. Microsoft Surface laptop box — clean white box with MS logo
    {
      const boxW = 16, boxD = 12, boxH = 2.5;
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.05 });
      const surfBox = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), boxMat);
      surfBox.position.set(itemX, underBedY + boxH / 2 + 0.1, itemZ);
      surfBox.rotation.y = 0.15;
      surfBox.castShadow = true; surfBox.receiveShadow = true; surfBox._isRoom = true;
      addRoom(surfBox);
      // Microsoft logo on top (async — added after mirror pass, so use post-mirror coords)
      loadSvgTex('img/Microsoft_logo.svg', 256, (tex) => {
        const logo = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 3),
          new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3 })
        );
        logo.rotation.x = -Math.PI / 2;
        logo.position.set(-itemX, underBedY + boxH + 0.12, itemZ);
        logo.rotation.z = -0.15;
        logo._isRoom = true;
        scene.add(logo);
      });
    }

    // 2. Power BI notebook/binder — dark yellow-gold cover
    {
      const nbW = 10, nbD = 7.5, nbH = 0.8;
      const nbMat = new THREE.MeshStandardMaterial({ color: 0xf2c811, roughness: 0.6, metalness: 0.05 });
      const notebook = new THREE.Mesh(new THREE.BoxGeometry(nbW, nbH, nbD), nbMat);
      // Lean it against the Surface box at an angle
      notebook.position.set(itemX + 8, underBedY + nbH / 2 + 0.1, itemZ - 1);
      notebook.rotation.y = -0.3;
      notebook.rotation.z = 0.08; // slight tilt
      notebook.castShadow = true; notebook.receiveShadow = true; notebook._isRoom = true;
      addRoom(notebook);
      // Power BI logo on top (async — post-mirror coords)
      loadSvgTex('img/Power_BI_Logo.svg', 256, (tex) => {
        const logo = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 4),
          new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 })
        );
        logo.rotation.x = -Math.PI / 2;
        logo.position.set(-(itemX + 8), underBedY + nbH + 0.12, itemZ - 1);
        logo.rotation.z = 0.3;
        logo._isRoom = true;
        scene.add(logo);
      });
      // Spine detail (darker edge)
      const spine = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, nbH + 0.1, nbD),
        new THREE.MeshStandardMaterial({ color: 0xc9a00e, roughness: 0.5 })
      );
      spine.position.set(itemX + 8 - nbW / 2 - 0.15, underBedY + nbH / 2 + 0.1, itemZ - 1);
      spine.rotation.y = -0.3;
      spine._isRoom = true;
      addRoom(spine);
    }
  }
  
  // Enable shadows on key furniture (not walls/baseboards/trim — those don't need it)
  [headboard, lRail, rRail, footboard, mattress, duvet].forEach(m=>{ m.castShadow=true; });
  
  // XYZ axis helper — press 'X' to toggle (positioned beside purifier)
  const axesGroup=new THREE.Group();
  const axesOrig=new THREE.Vector3(panelW/2+4, -H/2-ply, D/2+ply+4); // front-right of purifier, at foot level
  axesGroup.position.copy(axesOrig);
  // Build thick arrow axes that render on top of everything
  {
    const axLen=22, shaftR=0.35, coneR=1.2, coneH=3.5;
    const axes=[
      {dir:[1,0,0], color:0xff4444, label:'X'},
      {dir:[0,1,0], color:0x44ff44, label:'Y'},
      {dir:[0,0,1], color:0x4488ff, label:'Z'},
    ];
    axes.forEach(a=>{
      const mat=new THREE.MeshBasicMaterial({color:a.color, depthTest:false, depthWrite:false, transparent:true, opacity:0.9});
      // Shaft (cylinder along Y, then rotated)
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(shaftR,shaftR,axLen,8),mat);
      shaft.renderOrder=999;
      // Arrowhead cone
      const cone=new THREE.Mesh(new THREE.ConeGeometry(coneR,coneH,12),mat);
      cone.renderOrder=999;
      // Position along the correct axis
      const dx=a.dir[0], dy=a.dir[1], dz=a.dir[2];
      if(dx){ // X axis
        shaft.rotation.z=-Math.PI/2;
        shaft.position.set(axLen/2,0,0);
        cone.rotation.z=-Math.PI/2;
        cone.position.set(axLen+coneH/2,0,0);
      } else if(dy){ // Y axis
        shaft.position.set(0,axLen/2,0);
        cone.position.set(0,axLen+coneH/2,0);
      } else { // Z axis
        shaft.rotation.x=Math.PI/2;
        shaft.position.set(0,0,axLen/2);
        cone.rotation.x=Math.PI/2;
        cone.position.set(0,0,axLen+coneH/2);
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
    if (obj.isMesh && !obj.isPoints && obj._isRoom && !obj._isBifoldLeaf) {
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
  try { _macbookMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1'; } catch (e) {}
  const _mbPlaylist = [
    { name: 'Octodad Theme', src: 'assets/songs/Octodad (Nobody Suspects a Thing).mp3', volume: 0.28 },
    { name: 'Escape from the City', src: 'assets/songs/Escape From The City ... for City Escape.mp3', volume: 0.28 },
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
      try { a.load(); } catch (e) {}
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
    try { audio.currentTime = 0; } catch (e) {}
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
    try { localStorage.setItem(MUSIC_MUTE_KEY, _macbookMuted ? '1' : '0'); } catch (e) {}
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
    try { _macbookAudio.volume = Math.max(0, Math.min(1, _macbookBaseVol * _macbookProxVol)); } catch (e) {}
  }

  function resetMacbookProximity() {
    _macbookProxVol = 1;
    if (_macbookAudio) {
      try { _macbookAudio.volume = _macbookBaseVol; } catch (e) {}
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
    getCornerDoorPanelMesh: () => doorPanel,
    getCornerDoorAngle: () => _cornerDoorAngle,
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
    isFoodVisible: () => _foodGroup && _foodGroup.length ? _foodGroup[0].visible : false
  };
}
