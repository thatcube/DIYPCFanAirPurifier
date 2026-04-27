// ─── Purifier construction ──────────────────────────────────────────
// All purifier geometry: fan panels, grills, rotors, blades, filters,
// drawers, RGB LEDs, shell (plywood + foam), bun feet, console props.
//
// Migrated from the monolith index.html (lines 2422-5660).

import * as THREE from 'three';
import { state } from './state.js';
import { stdMat } from './materials.js';
import { fpMode as _fpMode, sfxMuted as _sfxMuted } from './game-fp.js';
import {
  spawnSecretBinderCoin,
  spawnSecretLampCoin,
  spawnSecretCeilingLightCoins,
  spawnSecretWindowCoin,
  spawnSecretDrawerCoin,
  spawnSecretMacbookCoin,
  spawnSecretTvCoin,
  spawnSecretFoodBowlCoin,
  getAudioCtx as _getAudioCtx,
  setAudioCtx as _setAudioCtx
} from './coins.js';
import { triggerNod as _triggerCatNod } from './cat-animation.js';

export function createPurifier(scene) {
  const canvas = document.getElementById('c');
  const camera = state.camera;
  const renderer = state.renderer;
  // Safe DOM helper — returns a no-op proxy if element doesn't exist
  const _nullEl = { classList: { add(){}, remove(){}, toggle(){} }, style: {}, querySelector(){ return _nullEl; }, querySelectorAll(){ return []; }, get value(){ return ''; }, set value(v){}, get textContent(){ return ''; }, set textContent(v){} };
  const _el = (id) => document.getElementById(id) || _nullEl;
  let _markShadowsDirty = () => {};
  const { H, W, D, ply, ft, bunFootH, bunFootR, panelW } = state;
  const _boardThickness = ply === 0.75 ? '34' : 'half';

  // Room refs — set after both room and purifier are built via setRoomRefs()
  let _roomLampOn = true, _roomLampLight = null, _roomLampShade = null, _roomLampBulb = null;
  let _roomCeilLightOn = true, _roomCeilSpot = null, _roomDomeMat = null, _roomCeilGlow = null, _todRefs = null;
  let _roomOutdoorMat = null, _roomOutdoorDayTex = null, _roomOutdoorNightTex = null;
  let _windowIsNight = false;
  let _applyTimeOfDay = null;
  let _toggleMacbook = null;
  let _toggleTV = null;
  let _toggleCornerDoor = null;
  let _toggleGuestDoor = null;
  let _toggleFoodBowl = null;
  let _getFoodBowlMesh = null;
  let _uiSfxAC = null;

  function _ensureUiSfxAC() {
    let ac = _uiSfxAC || _getAudioCtx();
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
      if (ac) _setAudioCtx(ac);
    }
    if (ac && ac.state === 'suspended' && ac.resume) ac.resume();
    _uiSfxAC = ac;
    return ac;
  }

  function _playDrawerCue(opening) {
    if (_sfxMuted) return;
    const ac = _ensureUiSfxAC();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    const startF = opening ? 170 : 215;
    const endF = opening ? 240 : 150;
    const dur = 0.07;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(endF, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.0095, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function _playDoorCue(opening, intensity = 1) {
    if (_sfxMuted) return;
    const ac = _ensureUiSfxAC();
    if (!ac) return;
    const now = ac.currentTime;
    const vol = Math.max(0.4, Math.min(1.25, intensity));

    // Main wooden swing body.
    const body = ac.createOscillator();
    const bodyGain = ac.createGain();
    const bodyDur = 0.12;
    body.type = 'triangle';
    body.frequency.setValueAtTime(opening ? 120 : 170, now);
    body.frequency.exponentialRampToValueAtTime(opening ? 178 : 114, now + bodyDur);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(0.010 * vol, now + 0.014);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + bodyDur);
    body.connect(bodyGain).connect(ac.destination);
    body.start(now);
    body.stop(now + bodyDur + 0.02);

    // Quick latch click so open/close has a crisp endpoint.
    const latch = ac.createOscillator();
    const latchGain = ac.createGain();
    const latchStart = now + (opening ? 0.05 : 0.032);
    const latchDur = 0.04;
    latch.type = 'square';
    latch.frequency.setValueAtTime(opening ? 760 : 980, latchStart);
    latch.frequency.exponentialRampToValueAtTime(opening ? 520 : 640, latchStart + latchDur);
    latchGain.gain.setValueAtTime(0.0001, latchStart);
    latchGain.gain.linearRampToValueAtTime(0.0046 * vol, latchStart + 0.006);
    latchGain.gain.exponentialRampToValueAtTime(0.0001, latchStart + latchDur);
    latch.connect(latchGain).connect(ac.destination);
    latch.start(latchStart);
    latch.stop(latchStart + latchDur + 0.02);
  }

  // Kibble-pouring sound — short burst of filtered noise to simulate
  // dry food hitting a metal/plastic bowl
  function _playFoodPourSfx() {
    if (_sfxMuted) return;
    const ac = _ensureUiSfxAC();
    if (!ac) return;
    const now = ac.currentTime;
    const dur = 0.45;
    // Create noise buffer
    const bufLen = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);
    const src = ac.createBufferSource();
    src.buffer = buf;
    // Band-pass filter to sound like small hard bits hitting a surface
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3200, now);
    bp.frequency.exponentialRampToValueAtTime(1800, now + dur);
    bp.Q.value = 1.2;
    // Resonant ping to simulate bowl ring
    const ping = ac.createOscillator();
    const pingGain = ac.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(1400, now);
    ping.frequency.exponentialRampToValueAtTime(800, now + dur * 0.8);
    pingGain.gain.setValueAtTime(0.008, now);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.7);
    // Envelope for the noise
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.03);
    gain.gain.setValueAtTime(0.015, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(gain).connect(ac.destination);
    ping.connect(pingGain).connect(ac.destination);
    src.start(now);
    src.stop(now + dur + 0.05);
    ping.start(now);
    ping.stop(now + dur + 0.05);
  }

  // W, H, D, ply, ft declared in header from state
  // panelW declared in header from state
  
  // Arctic P12 Pro: 120×120×27mm (FIXED — do not change)
  const fanFrame=4.724;    // 120mm
  const fanDepth=1.063;    // 27mm
  const hubR=0.787;        // ~40mm hub diameter / 2 (20mm radius)
  const impellerR=2.126;   // ~108mm impeller OD / 2
  const mountSpacing=4.134; // 105mm hole spacing
  const bladeCount=7;
  const holeR=impellerR*1.02;
  const cornerR=0.2;
  const allRotors=[];
  const allFanMats=[]; // all fan plastic materials (frame, hub, cap, blade0)
  const allBladeMatsPerFan=[]; // array of arrays: allBladeMatsPerFan[fanIdx] = [mat0..mat6]
  const allBraceMats=[]; // brace spoke materials (color-switched with frame)
  const allFanGlows=[]; // PointLight per fan for RGB glow
  let filterMatRef=null; // set inside makePleatedFilter for direct RGB lookup
  
  // Fans stacked touching, equal gap at top/bottom
  const numFans=4;
  const totalFanH=numFans*fanFrame;
  const endGapY=(H-totalFanH)/2;
  function fanY(i){return -H/2+endGapY+fanFrame*(i+0.5);}
  
  // ─── Fan color constants (defined early so init block at ~line 741 can use them) ───
  const C_FAN=0x1a1a1a, C_FOAM=0x3a3a3a;
  let fansWhite=true;
  let fansRGB=true; // start as RGB (frosted translucent blades)
  const FAN_BLACK={frame:0x1a1a1a,hub:0x111111,cap:0x181818,blade:0x1e1e1e};
  const FAN_WHITE={frame:0xe8e8e8,hub:0xdddddd,cap:0xd0d0d0,blade:0xf0f0f0};
  const BLADE_FROSTED={color:0xffffff,opacity:0.3,shininess:5};
  
  // ─── Birch plywood texture (procedural, higher quality) ───
  function makeBirchTexture(size,seed){
    const cvs=document.createElement('canvas');
    cvs.width=cvs.height=size||512;
    const ctx=cvs.getContext('2d');
    const W=cvs.width, H=cvs.height;
    let s=seed||1;
    function rand(){s=(s*16807+0)%2147483647;return(s&0x7fffffff)/0x7fffffff;}
  
    // Warm base — varies by seed for panel diversity
    const baseColors=['#e8d5b0','#e5d0a8','#ecdcb8','#e0c89e'];
    ctx.fillStyle=baseColors[Math.floor(rand()*baseColors.length)];
    ctx.fillRect(0,0,W,H);
  
    // Large soft color bands — vary count and prominence
    const bandCount=15+Math.floor(rand()*15);
    for(let i=0;i<bandCount;i++){
      const y=rand()*H;
      const h=20+rand()*80;
      const lightness=rand()>0.5?'rgba(235,218,185,':'rgba(200,175,135,';
      ctx.fillStyle=lightness+(0.15+rand()*0.25)+')';
      ctx.fillRect(0,y,W,h);
    }
  
    // Curved grain lines — the key to looking natural
    for(let i=0;i<400;i++){
      const baseY=rand()*H;
      const amplitude=2+rand()*8;
      const frequency=0.005+rand()*0.015;
      const phase=rand()*Math.PI*2;
      const isDark=rand()>0.4;
      ctx.strokeStyle=isDark
        ?`rgba(150,115,60,${0.15+rand()*0.25})`
        :`rgba(180,150,100,${0.1+rand()*0.15})`;
      ctx.lineWidth=0.5+rand()*2;
      ctx.beginPath();
      ctx.moveTo(0,baseY+Math.sin(phase)*amplitude);
      for(let x=0;x<W;x+=3){
        ctx.lineTo(x, baseY+Math.sin(x*frequency+phase)*amplitude+(rand()-0.5)*1.5);
      }
      ctx.stroke();
    }
  
    // Tight grain clusters (groups of fine lines close together)
    for(let g=0;g<10;g++){
      const cy=rand()*H;
      const count=4+Math.floor(rand()*12);
      for(let i=0;i<count;i++){
        const y=cy+i*(1+rand()*1.5);
        const freq=0.008+rand()*0.01;
        const ph=rand()*6;
        ctx.strokeStyle=`rgba(140,105,50,${0.08+rand()*0.12})`;
        ctx.lineWidth=0.3+rand()*0.5;
        ctx.beginPath();
        ctx.moveTo(0,y);
        for(let x=0;x<W;x+=4){
          ctx.lineTo(x, y+Math.sin(x*freq+ph)*3+(rand()-0.5)*0.8);
        }
        ctx.stroke();
      }
    }
  
    // Occasional darker streaks
    for(let i=0;i<3+Math.floor(rand()*3);i++){
      const y=rand()*H;
      ctx.strokeStyle=`rgba(120,85,35,${0.2+rand()*0.15})`;
      ctx.lineWidth=1+rand()*2.5;
      const freq=0.003+rand()*0.008;
      const ph=rand()*6;
      ctx.beginPath();
      ctx.moveTo(0,y);
      for(let x=0;x<W;x+=4){
        ctx.lineTo(x, y+Math.sin(x*freq+ph)*6+(rand()-0.5)*2);
      }
      ctx.stroke();
    }
  
    // Knot with growth rings — only 30% chance, but dramatic when present
    if(rand()<0.3){
      const kx=W*(0.2+rand()*0.6), ky=H*(0.2+rand()*0.6);
      const kr=20+rand()*50; // highly variable size
      const angle=rand()*0.5-0.25;
      // Dark center
      const grad=ctx.createRadialGradient(kx,ky,0,kx,ky,kr*0.35);
      grad.addColorStop(0,'rgba(80,50,15,0.5)');
      grad.addColorStop(1,'rgba(110,75,30,0.3)');
      ctx.fillStyle=grad;
      ctx.beginPath(); ctx.ellipse(kx,ky,kr*0.35,kr*0.2,angle,0,Math.PI*2); ctx.fill();
      // Growth rings — concentric ellipses getting lighter outward
      for(let r=0;r<8;r++){
        const rr=kr*(0.2+r*0.1);
        const alpha=0.25-r*0.025;
        ctx.strokeStyle=`rgba(120,85,35,${Math.max(0.04,alpha)})`;
        ctx.lineWidth=0.8+rand()*1.2;
        ctx.beginPath();
        ctx.ellipse(kx,ky,rr,rr*0.55,angle+(rand()-0.5)*0.1,0,Math.PI*2);
        ctx.stroke();
      }
      // Grain lines curve around the knot
      for(let i=0;i<15;i++){
        const offset=(rand()-0.5)*kr*1.5;
        const y=ky+offset;
        ctx.strokeStyle=`rgba(155,120,65,${0.08+rand()*0.1})`;
        ctx.lineWidth=0.3+rand()*0.8;
        ctx.beginPath();
        for(let x=0;x<W;x+=3){
          const dx=x-kx, dy=y-ky;
          const dist=Math.sqrt(dx*dx+dy*dy);
          const deflect=dist<kr*1.2 ? Math.sign(offset)*kr*0.4*Math.exp(-dist*dist/(kr*kr*0.8)) : 0;
          ctx.lineTo(x, y+deflect+(rand()-0.5)*0.5);
        }
        ctx.stroke();
      }
    }
  
    // Subtle highlights
    for(let i=0;i<30;i++){
      const y=rand()*H;
      ctx.strokeStyle=`rgba(245,235,215,${0.06+rand()*0.1})`;
      ctx.lineWidth=2+rand()*6;
      ctx.beginPath();
      ctx.moveTo(0,y);
      for(let x=0;x<W;x+=8) ctx.lineTo(x, y+(rand()-0.5)*2);
      ctx.stroke();
    }
  
    const tex=new THREE.CanvasTexture(cvs);
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.rotation = Math.PI / 2; // rotate 90° so grain runs vertically
    tex.center.set(0.5, 0.5);
    return tex;
  }
  const birchTexPool=[];
  for(let i=0;i<6;i++) birchTexPool.push(makeBirchTexture(1024, 42+i*73));
  let _birchTexIdx=0;
  
  // Normalize UVs on an ExtrudeGeometry so texture maps 0-1 across the face
  function normalizeUVs(geo){
    const uv=geo.attributes.uv;
    if(!uv) return;
    let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
    for(let i=0;i<uv.count;i++){
      const u=uv.getX(i), v=uv.getY(i);
      if(u<minU) minU=u; if(u>maxU) maxU=u;
      if(v<minV) minV=v; if(v>maxV) maxV=v;
    }
    const du=maxU-minU||1, dv=maxV-minV||1;
    for(let i=0;i<uv.count;i++){
      uv.setXY(i, (uv.getX(i)-minU)/du, (uv.getY(i)-minV)/dv);
    }
    uv.needsUpdate=true;
  }
  
  // Outer-edge-only roundover in XZ cross-section, applied uniformly through full Y.
  // Optional `outerSignZ` lets us round only one Z side: -1 (negative), +1 (positive), 0 (both).
  function applyOuterEdgeRoundXZ(geo,w,d,r,outerSignZ=0){
    const R=Math.min(r, w/2-1e-3, d/2-1e-3);
    if(!(R>0)) return;
    const innerX=w/2-R;
    const innerZ=d/2-R;
    const EPS=1e-7;
    const pp=geo.attributes.position;
    for(let i=0;i<pp.count;i++){
      let x=pp.getX(i), y=pp.getY(i), z=pp.getZ(i);
      const ex=Math.max(0, Math.abs(x)-innerX);
      const ez=(outerSignZ===1)
        ? Math.max(0, z-innerZ)
        : (outerSignZ===-1)
          ? Math.max(0, -z-innerZ)
          : Math.max(0, Math.abs(z)-innerZ);
      if(ex>EPS && ez>EPS){
        const dist=Math.sqrt(ex*ex+ez*ez);
        if(dist>R+EPS){
          const s=R/dist;
          x=Math.sign(x)*(innerX+ex*s);
          z=(outerSignZ===0)
            ? Math.sign(z)*(innerZ+ez*s)
            : outerSignZ*(innerZ+ez*s);
        }
      }
      pp.setXYZ(i,x,y,z);
    }
    geo.computeVertexNormals();
  }
  
  const allBirchMats=[];
  function birchMat(){
    const t=birchTexPool[_birchTexIdx%birchTexPool.length].clone();
    _birchTexIdx++;
    t.needsUpdate=true;
    t.repeat.set(1,1);
    t.center.set(0.5,0.5);
    t.rotation=Math.PI/2; // rotate 90° so grain runs vertically
    const m=stdMat({map:t,color:0xd2b48c,shininess:18,side:THREE.DoubleSide});
    allBirchMats.push(m);
    return m;
  }
  
  function mk(geo,color,opacity=1){
    return new THREE.Mesh(geo,stdMat({
      color,transparent:opacity<1,opacity,side:THREE.DoubleSide,depthWrite:opacity>0.45
    }));
  }
  
  const parts={}, origins={}, targets={};
  let sceneFloor=null;
  let updatePowerCordGeometry=()=>{};
  let topEdgeProfile='curved'; // 'curved' or 'flat'
  
  // ─── Top/bottom cap panels (flat, birch textured, with screws) ───
  // Old bevel approach (kept for reference):
  // function makeCapPanel_bevel(w,h,d,isTop){
  //   const bvS=0.12, bvT=0.12, bvSeg=3;
  //   const capShape=new THREE.Shape(); ...ExtrudeGeometry with uniform bevel...
  // }
  function makeCapPanel(w,h,d,isTop,edgeProfile='curved'){
    const g=new THREE.Group();
    const curved=(edgeProfile==='curved');
    const baseR=0.25;
    const R=Math.min(baseR, w/2-1e-3, d/2-1e-3);
    const edgeStep=Math.max(0.07, R/3);
    const segsW=curved?Math.min(160, Math.max(24, Math.ceil(w/edgeStep))):1;
    const segsD=curved?Math.min(320, Math.max(48, Math.ceil(d/edgeStep))):1;
    const segsH=curved?Math.min(24, Math.max(4, Math.ceil(h/Math.max(0.03, R/4)))):1;
    const geo=new THREE.BoxGeometry(w, h, d, segsW, segsH, segsD);
    if(curved) applyOuterEdgeRoundXZ(geo,w,d,R);
    normalizeUVs(geo);
    g.add(new THREE.Mesh(geo,birchMat()));
    return g;
  }
  
  const topPanel=makeCapPanel(panelW,ply,D+2*ply,true,topEdgeProfile);
  topPanel.position.set(0,H/2+ply/2,0);
  scene.add(topPanel); parts.top=topPanel; origins.top=topPanel.position.clone();
  
  const botPanel=makeCapPanel(panelW,ply,D+2*ply,false,topEdgeProfile);
  botPanel.position.set(0,-(H/2+ply/2),0);
  scene.add(botPanel); parts.bot=botPanel; origins.bot=botPanel.position.clone();
  
  // ─── Fan grills ───
  const allGrillMeshes=[];
  const _allGrillMats=[]; // cached flat list of all grill materials (avoid per-frame traverse)
  let grillsVisible=false;
  let grillColor='black'; // 'black' or 'silver'
  const C_GRILL_BLACK=0x1a1a1a;
  const C_GRILL_SILVER=0x9a9a9a;
  function grillMat(){
    const c=grillColor==='silver'?C_GRILL_SILVER:C_GRILL_BLACK;
    return stdMat({color:c,shininess:grillColor==='silver'?60:20,side:THREE.DoubleSide,metalness:grillColor==='silver'?0.7:0.1});
  }
  function makeGrill(radius, wireR){
    // Classic fan grill: concentric rings + 2 bent wires (4 spokes) + angled corner legs
    wireR=wireR||0.045;
    const standoff=0.25; // grill sits 0.25" proud of the wood surface
    const g=new THREE.Group();
    g.userData._isGrill=true;
    const mat=grillMat();
  
    // Ring+spoke sub-group — offset outward by standoff
    const ringGroup=new THREE.Group();
    ringGroup.position.z=standoff;
    g.add(ringGroup);
  
    // Concentric rings — 6 rings from center to edge
    const ringRadii=[radius*0.09, radius*0.26, radius*0.43, radius*0.60, radius*0.77, radius*0.94];
    for(const r of ringRadii){
      const ringGeo=new THREE.TorusGeometry(r,wireR,6,48);
      ringGroup.add(new THREE.Mesh(ringGeo,mat));
    }
  
    // 2 wires: straight toward center, ONE bend near hub, straight to bottom corner
    const s=0.707*radius; // corner ON the outer ring (cos45 * radius)
    const off=0.04*radius; // offset from center — wires get close but don't touch
    const gp=0.30*radius;  // guide point — keeps wire straight until near center
    // Wire 1: top-right → straight → bend near center (slightly right) → straight → bottom-right
    // Wire 2: top-left → straight → bend near center (slightly left) → straight → bottom-left
    [[ [s,s], [gp,gp], [off,0], [gp,-gp], [s,-s] ],
     [ [-s,s], [-gp,gp], [-off,0], [-gp,-gp], [-s,-s] ]].forEach(w=>{
      const pts=w.map(p=>new THREE.Vector3(p[0],p[1],0));
      const curve=new THREE.CatmullRomCurve3(pts);
      const tubeGeo=new THREE.TubeGeometry(curve,32,wireR,6,false);
      ringGroup.add(new THREE.Mesh(tubeGeo,mat));
    });
  
    // 4 corner legs — angled from grill plane down to flush against wood
    // Each leg goes from the outer ring edge (at z=standoff) to the corner (at z=0)
    const cornerDist=radius*1.18; // where the hook meets the wood — well outside the hole
    const rimDist=radius*0.92;    // where the leg starts on the grill rim
    for(let ci=0;ci<4;ci++){
      const ca=Math.PI/4+ci*Math.PI/2;
      const rx=Math.cos(ca)*rimDist;
      const ry=Math.sin(ca)*rimDist;
      const cx=Math.cos(ca)*cornerDist;
      const cy=Math.sin(ca)*cornerDist;
      // Leg from (rx,ry,standoff) to (cx,cy,0) — angled strut
      const dx=cx-rx, dy=cy-ry, dz=-standoff;
      const legLen=Math.sqrt(dx*dx+dy*dy+dz*dz);
      const legGeo=new THREE.CylinderGeometry(wireR*0.9,wireR*0.9,legLen,6);
      legGeo.translate(0,legLen/2,0);
      legGeo.rotateX(Math.PI/2);
      const leg=new THREE.Mesh(legGeo,mat);
      leg.position.set(rx,ry,standoff);
      // Aim toward the corner mount point
      leg.lookAt(new THREE.Vector3(cx,cy,0));
      g.add(leg);
      // Small flat tab at the corner touching the wood
      const tabGeo=new THREE.CylinderGeometry(wireR*2.5,wireR*2.5,wireR*1.5,8);
      tabGeo.rotateX(Math.PI/2);
      const tab=new THREE.Mesh(tabGeo,mat);
      tab.position.set(cx,cy,wireR*0.75);
      g.add(tab);
    }
  
    return g;
  }
  function updateGrillColors(){
    const c=grillColor==='silver'?C_GRILL_SILVER:C_GRILL_BLACK;
    const s=grillColor==='silver'?60:20;
    for(const m of allGrillMeshes){
      m.traverse(o=>{
        if(o.isMesh&&o.material){
          o.material.color.setHex(c);
          o.material.shininess=s;
        }
      });
    }
  }
  
  // ─── Fan panels (front/back) ───
  function buildFanPanelShellGeometry(nFans, edgeProfile='curved', outerSignZ=0){
    nFans = nFans || numFans;
    const buf = (nFans === 3) ? 1.5 : (H - nFans*fanFrame) / 2;
    const usableH = H - 2*buf;
    const slotH = usableH / nFans;
    const shape=new THREE.Shape();
    shape.moveTo(-panelW/2,-H/2);
    shape.lineTo( panelW/2,-H/2);
    shape.lineTo( panelW/2, H/2);
    shape.lineTo(-panelW/2, H/2);
    shape.lineTo(-panelW/2,-H/2);
    for(let i=0;i<nFans;i++){
      const fy=-H/2 + buf + slotH*(i+0.5);
      const hole=new THREE.Path();
      hole.absarc(0,fy,holeR,0,Math.PI*2,false,64);
      shape.holes.push(hole);
    }
    const depthSteps=(edgeProfile==='curved')?16:1;
    const geo=new THREE.ExtrudeGeometry(shape,{depth:ply,bevelEnabled:false,curveSegments:64,steps:depthSteps});
    geo.translate(0,0,-ply/2);
    if(edgeProfile==='curved'){
      const sideR=Math.min(0.25, panelW/2-1e-3, ply/2-1e-3);
      applyOuterEdgeRoundXZ(geo,panelW,ply,sideR,outerSignZ);
    }
    normalizeUVs(geo);
    return geo;
  }
  
  function buildSolidBackShellGeometry(edgeProfile='curved', outerSignZ=0){
    const shape=new THREE.Shape();
    shape.moveTo(-panelW/2,-H/2);
    shape.lineTo( panelW/2,-H/2);
    shape.lineTo( panelW/2, H/2);
    shape.lineTo(-panelW/2, H/2);
    shape.lineTo(-panelW/2,-H/2);
    const depthSteps=(edgeProfile==='curved')?16:1;
    const geo=new THREE.ExtrudeGeometry(shape,{depth:ply,bevelEnabled:false,curveSegments:64,steps:depthSteps});
    geo.translate(0,0,-ply/2);
    if(edgeProfile==='curved'){
      const sideR=Math.min(0.25, panelW/2-1e-3, ply/2-1e-3);
      applyOuterEdgeRoundXZ(geo,panelW,ply,sideR,outerSignZ);
    }
    normalizeUVs(geo);
    return geo;
  }
  
  function buildAltTopPanelShellGeometry(nFans, edgeProfile='curved'){
    nFans = nFans || numFans;
    const topW=panelW, topD=D+2*ply;
    const topBuffer=1.0;
    const topUsable=topD-2*topBuffer;
    const topSlot=topUsable/nFans;
    const shape=new THREE.Shape();
    shape.moveTo(-topW/2,-topD/2);
    shape.lineTo( topW/2,-topD/2);
    shape.lineTo( topW/2, topD/2);
    shape.lineTo(-topW/2, topD/2);
    shape.lineTo(-topW/2,-topD/2);
    for(let i=0;i<nFans;i++){
      const fz=-topD/2+topBuffer+topSlot*(i+0.5);
      const hole=new THREE.Path();
      hole.absarc(0,fz,holeR,0,Math.PI*2,false,64);
      shape.holes.push(hole);
    }
    const depthSteps=(edgeProfile==='curved')?16:1;
    const geo=new THREE.ExtrudeGeometry(shape,{depth:ply,bevelEnabled:false,curveSegments:64,steps:depthSteps});
    geo.translate(0,0,-ply/2);
    geo.rotateX(-Math.PI/2);
    if(edgeProfile==='curved'){
      const sideR=Math.min(0.25, topW/2-1e-3, topD/2-1e-3);
      applyOuterEdgeRoundXZ(geo,topW,topD,sideR);
    }
    normalizeUVs(geo);
    return geo;
  }
  
  function findOuterPanelMesh(group){
    let panelMesh=null;
    group.traverse(o=>{ if(!panelMesh && o._isOuterPanel) panelMesh=o; });
    return panelMesh;
  }
  
  function replaceOuterPanelGeometry(group,newGeo){
    const panelMesh=findOuterPanelMesh(group);
    if(!panelMesh){
      if(newGeo&&newGeo.dispose) newGeo.dispose();
      return;
    }
    if(panelMesh.geometry) panelMesh.geometry.dispose();
    panelMesh.geometry=newGeo;
  }
  
  function refreshPanelEdgeProfiles(){
    replaceOuterPanelGeometry(front4, buildFanPanelShellGeometry(4, topEdgeProfile, -1));
    replaceOuterPanelGeometry(front3, buildFanPanelShellGeometry(3, topEdgeProfile, -1));
    replaceOuterPanelGeometry(back4, buildFanPanelShellGeometry(4, topEdgeProfile, 1));
    replaceOuterPanelGeometry(back3, buildFanPanelShellGeometry(3, topEdgeProfile, 1));
    replaceOuterPanelGeometry(altBackGroup, buildSolidBackShellGeometry(topEdgeProfile, 1));
    replaceOuterPanelGeometry(altTop4, buildAltTopPanelShellGeometry(4, topEdgeProfile));
  }
  
  function makeFanPanel(flip, nFans, edgeProfile=topEdgeProfile){
    nFans = nFans || numFans;
    const buf = (nFans === 3) ? 1.5 : (H - nFans*fanFrame) / 2;
    const usableH = H - 2*buf;
    const slotH = usableH / nFans;
    function localFanY(i){ return -H/2 + buf + slotH*(i+0.5); }
    const g=new THREE.Group();
  
    // Plywood shell: flat top/bottom edges, optional curved left/right outer edges only.
    const panelGeo=buildFanPanelShellGeometry(nFans, edgeProfile, flip?1:-1);
    const panel=new THREE.Mesh(panelGeo,birchMat());
    panel._isOuterPanel=true;
    g.add(panel);
  
    // Fans mounted inside the box, flush against plywood inner face
    const inDir=flip?-1:1;
    const fanZ=inDir*(ply/2+fanDepth/2);
  
    for(let i=0;i<nFans;i++){
      const fy=localFanY(i);
  
      // Square fan frame with rounded corners and circular opening
      const hf=fanFrame/2, cr=cornerR;
      const fs=new THREE.Shape();
      fs.moveTo(-hf+cr,-hf);
      fs.lineTo( hf-cr,-hf);
      fs.quadraticCurveTo( hf,-hf, hf,-hf+cr);
      fs.lineTo( hf, hf-cr);
      fs.quadraticCurveTo( hf, hf, hf-cr, hf);
      fs.lineTo(-hf+cr, hf);
      fs.quadraticCurveTo(-hf, hf,-hf, hf-cr);
      fs.lineTo(-hf,-hf+cr);
      fs.quadraticCurveTo(-hf,-hf,-hf+cr,-hf);
      const fh=new THREE.Path();
      fh.absarc(0,0,impellerR,0,Math.PI*2,false);
      fs.holes.push(fh);
      const frameGeo=new THREE.ExtrudeGeometry(fs,{depth:fanDepth,bevelEnabled:false});
      frameGeo.translate(0,0,-fanDepth/2);
      const frameMat=stdMat({color:C_FAN,shininess:30});
      allFanMats.push(frameMat);
      const frame=new THREE.Mesh(frameGeo,frameMat);
      frame.position.set(0,fy,fanZ);
      frame._isFan=true;
      g.add(frame);
  
      // Rotor group (hub + blades) — spins as a unit
      const rotor=new THREE.Group();
      rotor.position.set(0,fy,fanZ);
      rotor.userData.axis=new THREE.Vector3(0,0,inDir);
      frame._rotor=rotor;
  
      // Hub
      const hubMat=stdMat({color:0x111111,shininess:40});
      allFanMats.push(hubMat);
      const hub=new THREE.Mesh(
        new THREE.CylinderGeometry(hubR,hubR,fanDepth*0.85,24),
        hubMat
      );
      hub.rotation.x=Math.PI/2;
      hub._isFan=true;
      hub._rotor=rotor;
      rotor.add(hub);
  
      // Hub cap
      const capMat=stdMat({color:0x181818,shininess:50});
      allFanMats.push(capMat);
      const cap=new THREE.Mesh(
        new THREE.CylinderGeometry(hubR*1.15,hubR*1.15,fanDepth*0.08,24),
        capMat
      );
      cap.rotation.x=Math.PI/2;
      cap.position.set(0,0,-inDir*fanDepth*0.4);
      cap._isFan=true;
      cap._rotor=rotor;
      rotor.add(cap);
  
      // Swept fan blades (7 blades) — P12 Pro sickle-shaped, wide with minimal gaps
      // Each blade gets its own material for per-blade RGB coloring
      const fanBlades=[];
      allFanMats.push(null); // placeholder at [i+3], replaced below with blade[0]
      for(let b=0;b<bladeCount;b++){
        // FrontSide + OPAQUE blades (was transparent:true, opacity:0.65). The
        // translucent look was visually lost once blades spin anyway — motion
        // blurs them into a solid disc. Going opaque lets the GPU's depth
        // prepass + early-Z kill every overlapping blade pixel behind the
        // frontmost blade, turning a catastrophic overdraw case into O(1)
        // per pixel. Also drops blade-to-blade alpha sorting out of the
        // transparent pass entirely.
        const bladeMat=stdMat({color:0xf0ece8,shininess:30,side:THREE.FrontSide});
        fanBlades.push(bladeMat);
        const baseAngle=b/bladeCount*Math.PI*2;
        const bladeShape=new THREE.Shape();
        const innerR=hubR*1.05, outerR=impellerR*0.96;
        const sweep=0.52, steps=8;
        // Leading edge: sickle curve from hub to tip
        const pts=[], trailPts=[];
        for(let st=0;st<=steps;st++){
          const t=st/steps;
          const r=innerR+(outerR-innerR)*t;
          const ang=baseAngle+t*t*sweep;
          pts.push([Math.cos(ang)*r,Math.sin(ang)*r]);
        }
        // Trailing edge: wide blades — nearly fill the gap to adjacent blade
        const gapAngle=Math.PI*2/bladeCount; // angular space per blade
        for(let st=steps;st>=0;st--){
          const t=st/steps;
          const r=innerR+(outerR-innerR)*t;
          // Width fills ~85% of available gap, tapering slightly at tip
          const width=(gapAngle*0.82)*(0.85+0.15*(1-t));
          const ang=baseAngle+t*t*sweep+width;
          trailPts.push([Math.cos(ang)*r,Math.sin(ang)*r]);
        }
        bladeShape.moveTo(pts[0][0],pts[0][1]);
        for(let st=1;st<pts.length;st++) bladeShape.lineTo(pts[st][0],pts[st][1]);
        for(let st=0;st<trailPts.length;st++) bladeShape.lineTo(trailPts[st][0],trailPts[st][1]);
        bladeShape.lineTo(pts[0][0],pts[0][1]);
        const bladeGeo=new THREE.ExtrudeGeometry(bladeShape,{depth:fanDepth*0.65,bevelEnabled:false});
        bladeGeo.translate(0,0,-fanDepth*0.325);
        const bladeMesh=new THREE.Mesh(bladeGeo,bladeMat);
        // Fan blades are decorative + spinning — skip raycast tests so the
        // hover picker doesn't iterate 14+ ExtrudeGeometry blades every
        // mousemove when the cursor drifts near the purifier. Huge win on
        // high-refresh mice where mousemove fires ~1 kHz.
        bladeMesh.raycast=function(){};
        // Skip shadow casting too — blade silhouettes through the grill
        // would be invisible regardless, and keeping them out of the
        // shadow pass avoids redrawing 40+ ExtrudeGeometry meshes into
        // the shadow map every time it re-bakes.
        bladeMesh.castShadow=false;
        bladeMesh.receiveShadow=false;
        rotor.add(bladeMesh);
      }
      allFanMats[allFanMats.length-1]=fanBlades[0]; // slot blade[0] into the placeholder
      allBladeMatsPerFan.push(fanBlades);
  
      g.add(rotor);
      allRotors.push(rotor);
  
      // Invisible click target for reliable fan clicking
      const clickBox=new THREE.Mesh(
        new THREE.BoxGeometry(fanFrame, fanFrame, fanDepth),
        new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false})
      );
      clickBox.position.set(0, fy, fanZ);
      clickBox._isFanHitbox=true;
      clickBox.raycast=function(){};
      g.add(clickBox);
  
      // Back support brace — 4 spokes, pinwheel offset (each arm misses center)
      const braceR=0.07, braceD=fanDepth*0.12;
      // Slightly in front of hub back face so brace blends into the fan back
      const braceZ=fanZ-inDir*(fanDepth*0.35);
      const cornerDist=fanFrame*0.44;
      const hubOff=hubR*0.9;
      const spokeAngles=[Math.PI*0.75, Math.PI*0.25, -Math.PI*0.25, -Math.PI*0.75];
      const tangentOff=0.65;
      for(let s=0;s<4;s++){
        const ca=spokeAngles[s];
        const cx=Math.cos(ca)*cornerDist;
        const cy=Math.sin(ca)*cornerDist;
        const ha=ca+Math.PI+tangentOff;
        const hx=Math.cos(ha)*hubOff;
        const hy=Math.sin(ha)*hubOff;
        const dx=cx-hx, dy=cy-hy;
        const len=Math.sqrt(dx*dx+dy*dy);
        const ang=Math.atan2(dy,dx);
        const spokeGeo=new THREE.BoxGeometry(len,braceR*2,braceD);
        const spokeMat=stdMat({color:C_FAN,shininess:30});
        allBraceMats.push(spokeMat);
        const spoke=new THREE.Mesh(spokeGeo,spokeMat);
        spoke.position.set((cx+hx)/2, fy+(cy+hy)/2, braceZ);
        spoke.rotation.z=ang;
        g.add(spoke);
      }
  
      // Mounting posts
      const mh=mountSpacing/2;
      const postMat=stdMat({color:0x222222,roughness:0.5});
      for(let mx of[-1,1]){
        for(let my of[-1,1]){
          const post=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,fanDepth,8),postMat);
          post.rotation.x=Math.PI/2;
          post.position.set(mx*mh,fy+my*mh,fanZ);
          g.add(post);
        }
      }
  
      // Fan grill (outside face of plywood panel)
      const grillZ=-inDir*(ply/2); // flush with panel outer face
      const grill=makeGrill(fanFrame/2);
      grill.position.set(0,fy,grillZ);
      if(!flip) grill.rotation.y=Math.PI; // front panel: flip so standoff goes outward (-Z)
      grill.visible=grillsVisible;
      g.add(grill);
      allGrillMeshes.push(grill);
      grill.traverse(o=>{ if(o.isMesh&&o.material) _allGrillMats.push(o.material); });
  
      // (RGB glow handled by single panel-level light below)
    }
  
    // Per-panel glow lights REMOVED — replaced with per-grill emissive
    // materials (zero lighting cost) + a single purifier-level PointLight.
    // Each grill still visually glows its own color; only 1 light hits the
    // GPU instead of 5.
  
    return g;
  }
  
  // ─── Build 4-fan and 3-fan variants of front, back, altTop panels ───
  let activeFanCount=3;
  
  const front4=makeFanPanel(false,4);
  front4.position.set(0,0,-(D/2+ply/2));
  front4.visible=false;
  scene.add(front4);
  
  const front3=makeFanPanel(false,3);
  front3.position.set(0,0,-(D/2+ply/2));
  scene.add(front3);
  
  parts.front=front3; origins.front=front3.position.clone();
  
  const back4=makeFanPanel(true,4);
  back4.position.set(0,0,D/2+ply/2);
  back4.visible=false;
  scene.add(back4);
  
  const back3=makeFanPanel(true,3);
  back3.position.set(0,0,D/2+ply/2);
  scene.add(back3);
  
  parts.back=back3; origins.back=back3.position.clone();
  
  // ─── Alternate layout: solid back + top fan panel ───
  // Solid back panel (no holes) — hidden by default
  const altBackGroup=(function(){
    const g=new THREE.Group();
    const geo=buildSolidBackShellGeometry(topEdgeProfile, 1);
    const panel=new THREE.Mesh(geo,birchMat());
    panel._isOuterPanel=true;
    g.add(panel);
    return g;
  })();
  altBackGroup.position.set(0,0,D/2+ply/2);
  altBackGroup.visible=false;
  scene.add(altBackGroup);
  parts.altBack=altBackGroup; origins.altBack=altBackGroup.position.clone();
  
  // Top fan panel (horizontal, fans point up) — hidden by default
  function makeAltTopPanel(nFans){
    nFans = nFans || numFans;
    const g=new THREE.Group();
    const topW=panelW, topD=D+2*ply;
    // Fan positions along Z (local coords: shape is in XZ, extruded along Y)
    const topBuffer=1.0;
    const topUsable=topD-2*topBuffer;
    const topSlot=topUsable/nFans;
    function topFanZ(i){return -topD/2+topBuffer+topSlot*(i+0.5);}
  
    const panelGeo=buildAltTopPanelShellGeometry(nFans, topEdgeProfile);
    const panel=new THREE.Mesh(panelGeo,birchMat());
    panel._isOuterPanel=true;
    g.add(panel);
  
    // Fans mounted on top, pointing upward
    for(let i=0;i<nFans;i++){
      const fz=topFanZ(i);
      const fanYPos=-(ply/2+fanDepth/2); // inside the box (below panel)
  
      // Fan frame
      const hf=fanFrame/2, cr=cornerR;
      const fs=new THREE.Shape();
      fs.moveTo(-hf+cr,-hf);
      fs.lineTo( hf-cr,-hf);
      fs.quadraticCurveTo( hf,-hf, hf,-hf+cr);
      fs.lineTo( hf, hf-cr);
      fs.quadraticCurveTo( hf, hf, hf-cr, hf);
      fs.lineTo(-hf+cr, hf);
      fs.quadraticCurveTo(-hf, hf,-hf, hf-cr);
      fs.lineTo(-hf,-hf+cr);
      fs.quadraticCurveTo(-hf,-hf,-hf+cr,-hf);
      const fh=new THREE.Path();
      fh.absarc(0,0,impellerR,0,Math.PI*2,false);
      fs.holes.push(fh);
      const frameGeo=new THREE.ExtrudeGeometry(fs,{depth:fanDepth,bevelEnabled:false});
      frameGeo.translate(0,0,-fanDepth/2);
      // Rotate frame to point up: Z→Y
      frameGeo.rotateX(-Math.PI/2);
      const frameMat=stdMat({color:C_FAN,shininess:30});
      allFanMats.push(frameMat);
      const frame=new THREE.Mesh(frameGeo,frameMat);
      frame.position.set(0,fanYPos,fz);
      frame._isFan=true;
      g.add(frame);
  
      // Rotor
      const rotor=new THREE.Group();
      rotor.position.set(0,fanYPos,fz);
      rotor.userData.axis=new THREE.Vector3(0,0,-1); // spin around local Z (= world Y after rotateX PI/2)
      rotor.rotation.x=Math.PI/2; // orient blades horizontally, facing down
      frame._rotor=rotor;
  
      const hubMat=stdMat({color:0x111111,shininess:40});
      allFanMats.push(hubMat);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(hubR,hubR,fanDepth*0.85,24),hubMat);
      hub.rotation.x=Math.PI/2;
      hub._isFan=true;
      hub._rotor=rotor;
      rotor.add(hub);
  
      const capMat=stdMat({color:0x181818,shininess:50});
      allFanMats.push(capMat);
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(hubR*1.15,hubR*1.15,fanDepth*0.08,24),capMat);
      cap.rotation.x=Math.PI/2;
      cap.position.set(0,0,-fanDepth*0.4);
      cap._isFan=true;
      cap._rotor=rotor;
      rotor.add(cap);
  
      const fanBlades2=[];
      allFanMats.push(null); // placeholder for blade[0]
      for(let b=0;b<bladeCount;b++){
        // See fan-panel blades: FrontSide + opaque + 8 steps.
        const bladeMat=stdMat({color:0xf0ece8,shininess:30,side:THREE.FrontSide});
        fanBlades2.push(bladeMat);
        const baseAngle=b/bladeCount*Math.PI*2;
        const bladeShape=new THREE.Shape();
        const innerR=hubR*1.05, outerR=impellerR*0.96;
        const sweep=0.52, steps=8;
        const pts=[], trailPts=[];
        for(let st=0;st<=steps;st++){
          const t=st/steps;
          const r=innerR+(outerR-innerR)*t;
          const ang=baseAngle+t*t*sweep;
          pts.push([Math.cos(ang)*r,Math.sin(ang)*r]);
        }
        const gapAngle=Math.PI*2/bladeCount;
        for(let st=steps;st>=0;st--){
          const t=st/steps;
          const r=innerR+(outerR-innerR)*t;
          const width=(gapAngle*0.82)*(0.85+0.15*(1-t));
          const ang=baseAngle+t*t*sweep+width;
          trailPts.push([Math.cos(ang)*r,Math.sin(ang)*r]);
        }
        bladeShape.moveTo(pts[0][0],pts[0][1]);
        for(let st=1;st<pts.length;st++) bladeShape.lineTo(pts[st][0],pts[st][1]);
        for(let st=0;st<trailPts.length;st++) bladeShape.lineTo(trailPts[st][0],trailPts[st][1]);
        bladeShape.lineTo(pts[0][0],pts[0][1]);
        const bladeGeo=new THREE.ExtrudeGeometry(bladeShape,{depth:fanDepth*0.65,bevelEnabled:false});
        bladeGeo.translate(0,0,-fanDepth*0.325);
        const bladeMesh=new THREE.Mesh(bladeGeo,bladeMat);
        bladeMesh.raycast=function(){};
        bladeMesh.castShadow=false;
        bladeMesh.receiveShadow=false;
        rotor.add(bladeMesh);
      }
      allFanMats[allFanMats.length-1]=fanBlades2[0];
      allBladeMatsPerFan.push(fanBlades2);
      g.add(rotor);
      allRotors.push(rotor);
  
      // Invisible click target for top-mount fan
      const clickBox2=new THREE.Mesh(
        new THREE.BoxGeometry(fanFrame, fanDepth, fanFrame),
        new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false})
      );
      clickBox2.position.set(0, fanYPos, fz);
      clickBox2._isFanHitbox=true;
      clickBox2.raycast=function(){};
      g.add(clickBox2);
  
      // Back support brace — 4 spokes, pinwheel offset (top-mount: exhaust is UP/+Y)
      const braceR2=0.07, braceD2=fanDepth*0.12;
      // Slightly in front of hub back face
      const braceY=fanYPos+(fanDepth*0.34);
      const cornerDist2=fanFrame*0.44;
      const hubOff2=hubR*0.9;
      const spokeAngles2=[Math.PI*0.75, Math.PI*0.25, -Math.PI*0.25, -Math.PI*0.75];
      const tangentOff2=0.65;
      for(let s=0;s<4;s++){
        const ca=spokeAngles2[s];
        const cx2=Math.cos(ca)*cornerDist2;
        const cz2=Math.sin(ca)*cornerDist2;
        const ha=ca+Math.PI+tangentOff2;
        const hx2=Math.cos(ha)*hubOff2;
        const hz2=Math.sin(ha)*hubOff2;
        const dx2=cx2-hx2, dz2=cz2-hz2;
        const len2=Math.sqrt(dx2*dx2+dz2*dz2);
        const ang2=Math.atan2(dz2,dx2);
        const spokeGeo2=new THREE.BoxGeometry(len2,braceD2,braceR2*2);
        const spokeMat2=stdMat({color:C_FAN,shininess:30});
        allBraceMats.push(spokeMat2);
        const spoke2=new THREE.Mesh(spokeGeo2,spokeMat2);
        spoke2.position.set((cx2+hx2)/2, braceY, fz+(cz2+hz2)/2);
        spoke2.rotation.y=-ang2;
        g.add(spoke2);
      }
  
      // Mounting posts
      const mh=mountSpacing/2;
      const postMat=stdMat({color:0x222222,roughness:0.5});
      for(let mx of[-1,1]){
        for(let my of[-1,1]){
          const post=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,fanDepth,8),postMat);
          post.position.set(mx*mh,fanYPos,fz+my*mh);
          post.rotation.x=0; // vertical posts
          g.add(post);
        }
      }
  
      // Fan grill (outside/top face of top panel)
      const grillTop=makeGrill(fanFrame/2);
      grillTop.rotation.x=-Math.PI/2; // rotate flat onto XZ plane, facing up
      grillTop.position.set(0, ply/2, fz); // sit on top surface of panel
      grillTop.visible=grillsVisible;
      g.add(grillTop);
      allGrillMeshes.push(grillTop);
      grillTop.traverse(o=>{ if(o.isMesh&&o.material) _allGrillMats.push(o.material); });
  
      // (RGB glow handled by single panel-level light below)
    }
  
    // Per-panel glow lights REMOVED — see purifier-level PointLight below.
  
    return g;
  }
  
  const altTop4=makeAltTopPanel(4);
  altTop4.position.set(0, H/2+ply/2, 0);
  altTop4.visible=false;
  scene.add(altTop4);
  
  parts.altTop=altTop4; origins.altTop=altTop4.position.clone();
  
  // Track fan count per panel for RGB glow sync (order matches allFanGlows push order)
  const _panelFanCounts=[4, 3, 4, 3, 4]; // front4, front3, back4, back3, altTop4
  
  // Apply default fan color at init (materials are created with C_FAN black)
  {
    const c=fansWhite?FAN_WHITE:FAN_BLACK;
    for(let i=0;i<allFanMats.length;i+=4){
      allFanMats[i].color.setHex(c.frame);
      allFanMats[i+1].color.setHex(c.hub);
      allFanMats[i+2].color.setHex(c.cap);
    }
    for(const blades of allBladeMatsPerFan){
      for(const blade of blades){
        if(fansRGB){
          blade.color.setHex(BLADE_FROSTED.color);
          blade.transparent=false;
          blade.opacity=1;
          blade.shininess=BLADE_FROSTED.shininess;
          blade.depthWrite=true;
        } else {
          blade.color.setHex(c.blade);
        }
      }
    }
    for(const m of allBraceMats) m.color.setHex(c.frame);
  }
  
  // ─── Pleated MERV 13 filters ───
  function makePleatedFilter(){
    const g=new THREE.Group();
    const pleats=80;
    const pleatDepth=ft*0.4;
    const pleatStep=H/pleats;
    // Procedural filter media texture — soft papery/cloth look
    const fCvs=document.createElement('canvas');
    fCvs.width=512; fCvs.height=512;
    const fCtx=fCvs.getContext('2d');
    fCtx.fillStyle='#eeeae4';
    fCtx.fillRect(0,0,512,512);
    let fs=77;
    function fRand(){fs=(fs*16807)%2147483647;return(fs&0x7fffffff)/0x7fffffff;}
    // Very fine fibers — cloth/paper weave feel
    for(let i=0;i<600;i++){
      const x=fRand()*512, y=fRand()*512;
      const len=2+fRand()*8, ang=fRand()*Math.PI;
      fCtx.strokeStyle=`rgba(190,182,170,${0.08+fRand()*0.12})`;
      fCtx.lineWidth=0.3+fRand()*1;
      fCtx.beginPath();
      fCtx.moveTo(x,y);
      fCtx.lineTo(x+Math.cos(ang)*len,y+Math.sin(ang)*len);
      fCtx.stroke();
    }
    // Faint specks
    for(let i=0;i<80;i++){
      fCtx.fillStyle=`rgba(175,165,148,${0.06+fRand()*0.08})`;
      const sz=1+fRand()*2;
      fCtx.fillRect(fRand()*512,fRand()*512,sz,sz);
    }
    const filterTex=new THREE.CanvasTexture(fCvs);
    filterTex.wrapS=filterTex.wrapT=THREE.RepeatWrapping;
    filterTex.repeat.set(2,3);
    filterTex.generateMipmaps=false;
    filterTex.minFilter=THREE.LinearFilter;
    filterTex.magFilter=THREE.LinearFilter;
  
    const filterMat=stdMat({map:filterTex,color:0xffffff,side:THREE.DoubleSide,shininess:1,transparent:true,opacity:0.99});
    filterMatRef=filterMat; // cache for direct RGB lookup (avoids scene.traverse)
  
    // Zigzag pleated mesh — vertical folds (step along Y, fold lines run along Z)
    const verts=[], uvs=[], indices=[];
    for(let p=0;p<=pleats;p++){
      const y=-H/2+p*pleatStep;
      const xOff=(p%2===0)?-pleatDepth:pleatDepth;
      const u=p/pleats;
      verts.push(xOff,y,-D/2);
      uvs.push(u, 0);
      verts.push(xOff,y, D/2);
      uvs.push(u, 1);
    }
    for(let p=0;p<pleats;p++){
      const i0=p*2, i1=p*2+1, i2=(p+1)*2, i3=(p+1)*2+1;
      indices.push(i0,i2,i1, i1,i2,i3);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo,filterMat));
  
    // Expanded metal wire mesh (diamond pattern) on both outer faces
    const wirePoints=[];
    const dw=D/16, dh=H/32; // 16 visible diamonds on each axis
    const cols=Math.ceil(D/dw)+1, rows=Math.ceil(H/dh)+1;
    const wireXoff=pleatDepth+0.02;
    const bIn=0.3; // wire reaches close to edge, behind the border
    for(let r=0;r<=rows;r++){
      for(let c=0;c<=cols;c++){
        const cy=-H/2+r*dh;
        const cz=-D/2+c*dw+(r%2===0?0:dw/2);
        // Up-right
        if(c<=cols && r<rows){
          const ny=cy+dh, nz=cz+dw/2;
          if(cy>=-H/2+bIn && ny<=H/2-bIn && cz>=-D/2+bIn && nz<=D/2-bIn){
            wirePoints.push(new THREE.Vector3(0,cy,cz));
            wirePoints.push(new THREE.Vector3(0,ny,nz));
          }
        }
        // Up-left
        if(c>0 && r<rows){
          const ny=cy+dh, nz=cz-dw/2;
          if(cy>=-H/2+bIn && ny<=H/2-bIn && nz>=-D/2+bIn && cz<=D/2-bIn){
            wirePoints.push(new THREE.Vector3(0,cy,cz));
            wirePoints.push(new THREE.Vector3(0,ny,nz));
          }
        }
      }
    }
    const wireGeo=new THREE.BufferGeometry().setFromPoints(wirePoints);
    const wireMat=stdMat({color:0x777777,shininess:40,metalness:0.7});
    const wireRadius=0.01;
    const wireSeg=4; // segments around each cylinder
    // Merge all wire strands into a single geometry per face
    for(const sign of [-1,1]){
      const positions=[], normals=[], indices=[];
      let vOffset=0;
      for(let i=0;i<wirePoints.length;i+=2){
        const a=wirePoints[i], b=wirePoints[i+1];
        const dir=new THREE.Vector3().subVectors(b,a);
        const len=dir.length();
        dir.normalize();
        // Build a local coordinate frame
        const up=Math.abs(dir.y)<0.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
        const perp1=new THREE.Vector3().crossVectors(dir,up).normalize();
        const perp2=new THREE.Vector3().crossVectors(dir,perp1);
        const mid=new THREE.Vector3((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
        // Two rings: bottom and top
        for(let ring=0;ring<2;ring++){
          const along=(ring===0)?-len/2:len/2;
          for(let s=0;s<wireSeg;s++){
            const angle=(s/wireSeg)*Math.PI*2;
            const nx=perp1.x*Math.cos(angle)+perp2.x*Math.sin(angle);
            const ny=perp1.y*Math.cos(angle)+perp2.y*Math.sin(angle);
            const nz=perp1.z*Math.cos(angle)+perp2.z*Math.sin(angle);
            positions.push(
              mid.x+dir.x*along+nx*wireRadius,
              mid.y+dir.y*along+ny*wireRadius,
              mid.z+dir.z*along+nz*wireRadius
            );
            normals.push(nx,ny,nz);
          }
        }
        // Triangles connecting the two rings
        for(let s=0;s<wireSeg;s++){
          const s1=(s+1)%wireSeg;
          const b0=vOffset+s, b1=vOffset+s1;
          const t0=vOffset+wireSeg+s, t1=vOffset+wireSeg+s1;
          indices.push(b0,t0,b1, b1,t0,t1);
        }
        vOffset+=wireSeg*2;
      }
      const mergedGeo=new THREE.BufferGeometry();
      mergedGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      mergedGeo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
      mergedGeo.setIndex(indices);
      const wireMesh=new THREE.Mesh(mergedGeo,wireMat);
      wireMesh.position.x=sign*(pleatDepth+0.02);
      g.add(wireMesh);
    }
  
    // 1″ white cardboard border on flat faces
    const border=1.0;
    const borderMat=stdMat({color:0xf5f5f5,shininess:3});
    g.add(new THREE.Mesh(new THREE.BoxGeometry(ft,border,D),borderMat).translateY(H/2-border/2));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(ft,border,D),borderMat).translateY(-H/2+border/2));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(ft,H,border),borderMat).translateZ(D/2-border/2));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(ft,H,border),borderMat).translateZ(-D/2+border/2));
  
    // Blue on thin perimeter edges (top/bottom/front/back of slab)
    const blueMat=stdMat({color:0x1a3d7c,shininess:8});
    const blueT=0.025;
    // Top edge
    const eTop=new THREE.Mesh(new THREE.PlaneGeometry(ft,D),blueMat);
    eTop.rotation.x=-Math.PI/2; eTop.position.set(0,H/2+blueT,0); g.add(eTop);
    // Bottom edge
    const eBot=new THREE.Mesh(new THREE.PlaneGeometry(ft,D),blueMat);
    eBot.rotation.x=Math.PI/2; eBot.position.set(0,-H/2-blueT,0); g.add(eBot);
    // Front edge
    const eFront=new THREE.Mesh(new THREE.PlaneGeometry(ft,H),blueMat);
    eFront.position.set(0,0,D/2+blueT); g.add(eFront);
    // Back edge
    const eBack=new THREE.Mesh(new THREE.PlaneGeometry(ft,H),blueMat);
    eBack.rotation.y=Math.PI; eBack.position.set(0,0,-D/2-blueT); g.add(eBack);
  
    // 3M logos on perimeter edges — each oriented to read correctly from its viewing side
    function make3MLogoMat(){
      const cvs=document.createElement('canvas');
      cvs.width=256; cvs.height=256;
      const ctx=cvs.getContext('2d');
      ctx.fillStyle='#1a3d7c';
      ctx.fillRect(0,0,256,256);
      ctx.fillStyle='#cc0000';
      ctx.font='bold 180px -apple-system,BlinkMacSystemFont,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('3M',128,128);
      return stdMat({map:new THREE.CanvasTexture(cvs),shininess:5,side:THREE.DoubleSide});
    }
    function flipUGeo(w,h){
      const geo=new THREE.PlaneGeometry(w,h);
      const uv=geo.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setX(i,1-uv.getX(i));
      return geo;
    }
    const logoMat=make3MLogoMat();
    const ls=ft*0.55; // square logo fits within 0.78″ edge
  
    // Front edge — faces +Z, readable from front
    const lFront=new THREE.Mesh(new THREE.PlaneGeometry(ls,ls),logoMat);
    lFront.position.set(0,0,D/2+blueT+0.01);
    g.add(lFront);
  
    // Back edge — faces -Z, UV-flipped so text isn't mirrored
    const lBack=new THREE.Mesh(flipUGeo(ls,ls),logoMat);
    lBack.rotation.y=Math.PI;
    lBack.position.set(0,0,-(D/2+blueT+0.01));
    g.add(lBack);
  
    // Top edge — faces +Y, readable looking down
    const lTop=new THREE.Mesh(new THREE.PlaneGeometry(ls,ls),logoMat);
    lTop.rotation.x=-Math.PI/2;
    lTop.position.set(0,H/2+blueT+0.01,0);
    g.add(lTop);
  
    // Bottom edge — faces -Y, readable looking up
    const lBot=new THREE.Mesh(new THREE.PlaneGeometry(ls,ls),logoMat);
    lBot.rotation.x=Math.PI/2;
    lBot.position.set(0,-(H/2+blueT+0.01),0);
    g.add(lBot);
  
    return g;
  }
  
  const filterL=makePleatedFilter();
  filterL.position.set(-(W/2+ft/2),0,0);
  scene.add(filterL); parts.filterL=filterL; origins.filterL=filterL.position.clone();
  
  const filterR=makePleatedFilter();
  filterR.position.set(W/2+ft/2,0,0);
  scene.add(filterR); parts.filterR=filterR; origins.filterR=filterR.position.clone();
  
  // ─── Foam tape seal ring (all 8 strips — stays as one group in exploded view) ───
  const foamGroup=new THREE.Group();
  {
    const foamT=0.09, foamW=0.45, foamInset=0.25;
    const fx=panelW/2-foamW/2-foamInset;
    // Vertical strips on front/back inner faces
    for(let sx of[-1,1]){
      const ff=mk(new THREE.BoxGeometry(foamW,H,foamT),C_FOAM,0.85);
      ff.position.set(sx*fx, 0, -D/2+foamT/2);
      foamGroup.add(ff);
      const fb=mk(new THREE.BoxGeometry(foamW,H,foamT),C_FOAM,0.85);
      fb.position.set(sx*fx, 0, D/2-foamT/2);
      foamGroup.add(fb);
    }
    // Horizontal strips on top/bottom inner faces
    for(let sx of[-1,1]){
      for(let sy of[-1,1]){
        const ft=mk(new THREE.BoxGeometry(foamW,foamT,D),C_FOAM,0.9);
        ft.position.set(sx*fx, sy*(H/2-foamT/2), 0);
        foamGroup.add(ft);
      }
    }
  }
  foamGroup.position.set(0,0,0);
  scene.add(foamGroup);
  parts.foam=foamGroup; origins.foam=foamGroup.position.clone();
  
  // ─── Ledge strips on top/bottom panels (70% width, centered) ───
  const ledgeW=0.56, ledgeDepth=(D+2*ply)*0.70;
  const ledgeX=W/2-ledgeW/2;
  const ledgeT=0.35;
  const ledgeTopGroup=new THREE.Group();
  const ledgeBotGroup=new THREE.Group();
  for(let sx of[-1,1]){
    const lt=new THREE.Mesh(
      new THREE.BoxGeometry(ledgeW,ledgeT,ledgeDepth),
      birchMat()
    );
    lt.position.set(sx*ledgeX, H/2-ledgeT/2, 0);
    ledgeTopGroup.add(lt);
    const lb=new THREE.Mesh(
      new THREE.BoxGeometry(ledgeW,ledgeT,ledgeDepth),
      birchMat()
    );
    lb.position.set(sx*ledgeX, -(H/2-ledgeT/2), 0);
    ledgeBotGroup.add(lb);
  }
  ledgeTopGroup.position.set(0,0,0);
  scene.add(ledgeTopGroup);
  parts.ledgeTop=ledgeTopGroup; origins.ledgeTop=ledgeTopGroup.position.clone();
  ledgeBotGroup.position.set(0,0,0);
  scene.add(ledgeBotGroup);
  parts.ledgeBot=ledgeBotGroup; origins.ledgeBot=ledgeBotGroup.position.clone();
  
  // ─── Corner legs/feet ───
  const legH=0.75, legR=0.3;
  const legInset=0.4; // inset from panel edges
  const legY=-(H/2+ply+legH/2);
  const legGroup=new THREE.Group();
  const allLegMeshes=[];
  const woodLegMat=birchMat();
  const rubberMat=stdMat({color:0x2a2a2a,shininess:5});
  
  // Peg leg geometry (tapered cylinder)
  const pegGeo=new THREE.CylinderGeometry(legR,legR*0.85,legH,16);
  
  // Round wooden foot — 2.5" tall, 0.55" radius, rounded cylinder
  // bunFootH, bunFootR declared in header from state
  const bunInset=0.68; // inset from panel edges for round feet
  function makeBunGeo(radius, height){
    const h=height||bunFootH;
    const pts=[];
    const hH=h/2;
    pts.push(new THREE.Vector2(0, -hH));
    const arcSegs=8;
    for(let i=1;i<=arcSegs;i++){
      const a=Math.PI/2*(i/arcSegs);
      pts.push(new THREE.Vector2(Math.sin(a)*radius, -hH+radius-Math.cos(a)*radius));
    }
    pts.push(new THREE.Vector2(radius, hH-0.08));
    pts.push(new THREE.Vector2(radius-0.04, hH-0.02));
    pts.push(new THREE.Vector2(radius-0.12, hH));
    return new THREE.LatheGeometry(pts, 20);
  }
  let bunGeo=makeBunGeo(bunFootR, bunFootH);
  
  let currentFeetH=bunFootH;
  let feetStyle='bun';
  let feetSplay=0; // 0 = straight, ~35° when angled
  const SPLAY_ANGLE=35*Math.PI/180;
  const legSigns=[]; // store {x,z} sign per leg for re-tilting

  function applyFootTilt(leg, xSgn, zSgn, h){
    leg.rotation.set(0,0,0);
    const yBase=-(H/2+ply+h/2);
    if(feetSplay>0.01){
      const ax=new THREE.Vector3(-zSgn, 0, xSgn).normalize();
      leg.rotateOnAxis(ax, feetSplay);
    }
    leg.position.y=yBase;
  }

  function reapplyAllFeetTilt(){
    const h=currentFeetH;
    const ins=feetStyle==='bun'?Math.max(bunInset,(currentFootDiameter/2)+0.1):legInset;
    for(let i=0;i<allLegMeshes.length;i++){
      const leg=allLegMeshes[i], s=legSigns[i];
      leg.position.x=s.x*(panelW/2-ins);
      leg.position.z=s.z*(D/2+ply-ins);
      applyFootTilt(leg, s.x, s.z, h);
      leg.matrixAutoUpdate=true;
      leg.updateMatrixWorld(true);
      leg.matrixAutoUpdate=false;
    }
  }

  function setFeetAngled(angled){
    feetSplay=angled?SPLAY_ANGLE:0;
    if(feetStyle!=='none') reapplyAllFeetTilt();
  }

  for(let xSgn of[-1,1]){
    for(let zSgn of[-1,1]){
      const leg=new THREE.Mesh(bunGeo, woodLegMat);
      leg.position.set(xSgn*(panelW/2-bunInset), -(H/2+ply+bunFootH/2), zSgn*(D/2+ply-bunInset));
      legSigns.push({x:xSgn, z:zSgn});
      legGroup.add(leg);
      allLegMeshes.push(leg);
    }
  }
  legGroup.position.set(0,0,0);
  scene.add(legGroup);
  parts.legs=legGroup; origins.legs=legGroup.position.clone();
  
  // ─── ESP32 + power supply on bottom interior ───
  {
    // ESP32-C3 Super Mini
    const espMat=stdMat({color:0x1a5c1a,shininess:30});
    const esp=new THREE.Mesh(new THREE.BoxGeometry(0.87,0.2,0.71),espMat);
    esp.position.set(0.5,-(H/2-0.1),0);
    scene.add(esp);
    // USB-C stub
    const usb=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.1,0.15),
      stdMat({color:0xaaaaaa,shininess:50,metalness:0.7}));
    usb.position.set(0.5,-(H/2-0.1),-0.71/2-0.075);
    scene.add(usb);
    // Chip
    const chip=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.06,0.25),
      stdMat({color:0x111111,roughness:0.8}));
    chip.position.set(0.5,-(H/2-0.23),0);
    scene.add(chip);
  
    // 5V buck converter
    const psu=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.47,0.71),
      stdMat({color:0x1a1a8a,shininess:20}));
    psu.position.set(-0.6,-(H/2-0.235),0);
    scene.add(psu);
    // Barrel jack
    const jack=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.25,12),
      stdMat({color:0x222222,roughness:0.7}));
    jack.rotation.x=Math.PI/2;
    jack.position.set(-0.6,-(H/2-0.235),0.71/2+0.125);
    scene.add(jack);
  
    const powerCordGroup=new THREE.Group();
    scene.add(powerCordGroup);
    parts.powerCord=powerCordGroup;
    origins.powerCord=powerCordGroup.position.clone();
  
    // Power cord hole in back panel
    const holeMesh=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.4,ply+0.02),
      stdMat({color:0x222222,roughness:0.7}));
    holeMesh.position.set(-0.6,-(H/2-0.235),D/2+ply/2);
    powerCordGroup.add(holeMesh);
  
    // Power cord — dynamic spline that drapes to the current floor level
    const cordMat=stdMat({color:0x111111,shininess:15});
    const cordR=0.09;
    const cX=-0.6, cY=-(H/2-0.235), cZ_hole=D/2+ply;
    const cordTube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(),new THREE.Vector3(0,0.01,0)),2,cordR,8,false),cordMat);
    powerCordGroup.add(cordTube);
  
    // US plug at cable end, resting near the floor
    const plugEndGroup=new THREE.Group();
    powerCordGroup.add(plugEndGroup);
    const plugMat=stdMat({color:0x222222,shininess:25});
    const plugBody=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.32,0.9),plugMat);
    plugEndGroup.add(plugBody);
    const prongMat=stdMat({color:0xbbbbbb,shininess:70,metalness:0.9});
    for(const px of [-0.12,0.12]){
      const prong=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.02,0.62),prongMat);
      prong.position.set(px,-0.015,0.43);
      plugEndGroup.add(prong);
    }
    const gndPin=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.42,8),prongMat);
    gndPin.rotation.x=Math.PI/2;
    gndPin.position.set(0,-0.10,0.34);
    plugEndGroup.add(gndPin);
  
    updatePowerCordGeometry=function(){
      const floorYLocal=sceneFloor?sceneFloor.position.y:-(H/2+ply+currentFeetH);
      const touchY=floorYLocal+cordR+0.06; // keep cable slightly above carpet to avoid clipping
      const bendY1=Math.max(touchY+1.8,cY-3.0);
      const bendY2=Math.max(touchY+0.5,cY-6.1);
      const runEndZ=cZ_hole+9.6;
  
      const cordPts=[
        new THREE.Vector3(cX, cY, cZ_hole),
        new THREE.Vector3(cX, cY, cZ_hole+1.4),
        new THREE.Vector3(cX, cY-0.25, cZ_hole+2.5),
        new THREE.Vector3(cX, bendY1, cZ_hole+3.4),
        new THREE.Vector3(cX, bendY2, cZ_hole+4.7),
        new THREE.Vector3(cX, touchY, cZ_hole+6.0),
        new THREE.Vector3(cX, touchY, cZ_hole+8.2),
        new THREE.Vector3(cX, touchY+0.08, runEndZ),
      ];
      const cordCurve=new THREE.CatmullRomCurve3(cordPts);
      const newCordGeo=new THREE.TubeGeometry(cordCurve,72,cordR,10,false);
      cordTube.geometry.dispose();
      cordTube.geometry=newCordGeo;
  
      const plugAnchor=cordCurve.getPointAt(1);
      const plugY=Math.max(floorYLocal+0.17, plugAnchor.y-0.02);
      plugEndGroup.position.set(plugAnchor.x, plugY, plugAnchor.z+0.08);
    };
    updatePowerCordGeometry();
  }
  
  // ─── Fan wiring — daisy-chained with connectors ───
  {
    const wireR=0.045;
    const wireMat=stdMat({color:0x444444,shininess:15}); // dark gray, not black
    const redMat=stdMat({color:0xaa2222,shininess:10});
    const connMat=stdMat({color:0xeeeeee,shininess:40}); // white JST connector
    const connBlack=stdMat({color:0x333333,shininess:25});
  
    function makeWire(pts, mat, segs){
      if(pts.length<2) return;
      const curve=new THREE.CatmullRomCurve3(pts);
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve, segs||24, wireR, 6, false), mat||wireMat);
      scene.add(tube);
    }
  
    function makeConn(x,y,z, mat){
      const c=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.12,0.15), mat||connMat);
      c.position.set(x,y,z);
      scene.add(c);
    }
  
    const busX=fanFrame/2+0.15;
    const botY=-(H/2)+0.3;
    const espX=0.5, espY=-(H/2-0.1), espZ=0;
    const psuX=-0.6, psuY=-(H/2-0.235), psuZ=0;
  
    for(const side of ['front','back']){
      const zSign=side==='front'?-1:1;
      const wz=zSign*(D/2-fanDepth*0.5); // between fan and filter
  
      // Daisy chain: vertical bus along right edge connecting all 4 fans
      const topFanY=fanY(3)+fanFrame/2;
      const botFanY=fanY(0)-fanFrame/2;
      makeWire([
        new THREE.Vector3(busX, topFanY, wz),
        new THREE.Vector3(busX, botFanY, wz),
      ], wireMat, 12);
  
      // Stub + connectors per fan
      for(let i=0;i<numFans;i++){
        const fy=fanY(i);
        // Stub wire from fan edge to bus
        makeWire([
          new THREE.Vector3(fanFrame/2-0.2, fy, wz),
          new THREE.Vector3(busX, fy, wz),
        ], wireMat, 6);
        // White connector at fan
        makeConn(fanFrame/2-0.1, fy, wz, connMat);
        // Black connector at bus junction
        makeConn(busX, fy, wz, connBlack);
      }
  
      // Lead wire from bottom of bus → down → to PSU or ESP32
      const leadMat=side==='front'?redMat:wireMat;
      makeWire([
        new THREE.Vector3(busX, botFanY, wz),
        new THREE.Vector3(busX, botY, wz),
        new THREE.Vector3(busX, botY, wz*0.5),
        new THREE.Vector3(busX, botY, 0),
        new THREE.Vector3(side==='front'?psuX+0.75:espX+0.4, botY, 0),
        new THREE.Vector3(side==='front'?psuX:espX, side==='front'?psuY:espY, 0),
      ], leadMat, 30);
    }
  
    // Wire from PSU → ESP32
    makeWire([
      new THREE.Vector3(psuX+0.75, psuY, psuZ),
      new THREE.Vector3(0, botY+0.1, 0),
      new THREE.Vector3(espX-0.4, espY, espZ),
    ], redMat, 20);
  }
  
  // ─── Explode / filter toggle ───
  const explodeV={
    top:    new THREE.Vector3(0,8,0),
    bot:    new THREE.Vector3(0,-8,0),
    front:  new THREE.Vector3(0,0,-10),
    back:   new THREE.Vector3(0,0,10),
    altTop:  new THREE.Vector3(0,8,0),
    altBack: new THREE.Vector3(0,0,10),
    powerCord:new THREE.Vector3(0,0,10),
    filterL:new THREE.Vector3(-8,0,0),
    filterR:new THREE.Vector3(8,0,0),
    foam:    new THREE.Vector3(0,0,0),
    ledgeTop:new THREE.Vector3(0,5,0),
    ledgeBot:new THREE.Vector3(0,-5,0),
    legs:    new THREE.Vector3(0,-12,0),
    console: new THREE.Vector3(0,8,0),
  };
  let exploded=false, explodeLerping=false;
  function setToggle(onId,offId,isOn){
    const onEl=_el(onId);
    const offEl=_el(offId);
    if(onEl) onEl.classList.toggle('on',isOn);
    if(offEl) offEl.classList.toggle('on',!isOn);
  }
  function collapseView(){
    if(!exploded) return;
    exploded=false;
    explodeLerping=true;
    { const el=_el('togExplode'); if(el) el.classList.remove('on'); }
    for(const k in explodeV){
      if(!parts[k]) continue;
      targets[k]=origins[k].clone();
    }
  }
  function toggleExplode(){
    exploded=!exploded;
    { const el=_el('togExplode'); if(el) el.classList.toggle('on',exploded); }
    if(exploded){
      if(dimVisible) toggleDimensions();
    }
    for(const k in explodeV){
      if(!parts[k]) continue;
      targets[k]=exploded?origins[k].clone().add(explodeV[k]):origins[k].clone();
    }
    explodeLerping=true;
  }
  let filterOn=true;
  function toggleFilter(){
    filterOn=!filterOn;
    parts.filterL.visible=filterOn;
    parts.filterR.visible=filterOn;
    { const el=_el('togFilter'); if(el) el.classList.toggle('on',filterOn); }
  }
  function toggleGrills(){
    grillsVisible=!grillsVisible;
    { const el=_el('togGrill'); if(el) el.classList.toggle('on',grillsVisible); }
    { const el=_el('grillColorSection'); if(el) el.style.display=grillsVisible?'':'none'; }
    for(const gm of allGrillMeshes) gm.visible=grillsVisible;
  }
  function setGrillColor(c){
    grillColor=c;
    document.querySelectorAll('#btnGrillBlack,#btnGrillSilver').forEach(b=>b.classList.remove('on'));
    { const el=_el(c==='black'?'btnGrillBlack':'btnGrillSilver'); if(el) el.classList.add('on'); }
    updateGrillColors();
  }
  
  // ─── Camera controls ───
  // Restore camera from sessionStorage if available (survives live reload)
  const _savedCam=sessionStorage.getItem('cam');
  const _camDefaults=_savedCam?JSON.parse(_savedCam):{p:1.03,a:0.34,r:42};
  let drag=false,px=0,py=0,polar=_camDefaults.p,azimuth=_camDefaults.a,radius=_camDefaults.r;
  let panX=0, panY=0, panZ=0; // camera target offset (shift+drag)
  const _camKeys={w:false,a:false,s:false,d:false};
  let _isPanning=false;
  let _touchMode='none';
  let _pinchStartDist=0;
  let _pinchStartRadius=radius;
  let _hadMultiTouch=false;
  let _clickStartX=0,_clickStartY=0;
  let _dragFilter=null; // hoisted — used in event listeners below
  let _pendingFilterDrag=false;
  let _hoverInteractive=false;
  const _isMobile = state.isMobile;
  const _raycaster=new THREE.Raycaster();
  _raycaster.far=220;
  const _mouse=new THREE.Vector2();
  
  canvas.addEventListener('mousedown',e=>{
    _clickStartX=e.clientX;_clickStartY=e.clientY;
    hideTooltip();
    // Reset all interaction state
    if(_dragFilter) handleDragEnd();
    _dragFilter=null;
    _pendingFilterDrag=false;
    _pendingFilterDrag=e.metaKey?handleDragStart(e.clientX,e.clientY):false;
    drag=!_pendingFilterDrag;
    if(!_pendingFilterDrag && !_hoverInteractive) canvas.style.cursor='grabbing';
    px=e.clientX;py=e.clientY;
  });
  canvas.addEventListener('touchstart',e=>{
    if(_fpMode){
      if(e.touches.length===1){
        _touchMode='fp-look';
        px=e.touches[0].clientX;
        py=e.touches[0].clientY;
        _clickStartX=px;
        _clickStartY=py;
        return;
      }
      return;
    }
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      _pinchStartDist=Math.hypot(dx,dy)||1;
      _pinchStartRadius=radius;
      _touchMode='pinch';
      _hadMultiTouch=true;
      _dragFilter=null;
      _pendingFilterDrag=false;
      drag=false;
      return;
    }
    if(e.touches.length!==1) return;
    _touchMode='rotate';
    px=e.touches[0].clientX;py=e.touches[0].clientY;
    _clickStartX=px;_clickStartY=py;
    _dragFilter=null;
    _pendingFilterDrag=_isMobile?false:handleDragStart(px,py);
    drag=!_pendingFilterDrag;
  },{passive:false});
  window.addEventListener('mouseup',e=>{
    drag=false;
    canvas.style.cursor=_hoverInteractive?'pointer':'grab';
    const wasDragging=_dragFilter && !_pendingFilterDrag;
    if(wasDragging){
      handleDragEnd();
    } else {
      _dragFilter=null;
      if(Math.abs(e.clientX-_clickStartX)<15 && Math.abs(e.clientY-_clickStartY)<15){
        // In FP mode with pointer lock, click is handled on mousedown for better browser compatibility.
        if(_fpMode && document.pointerLockElement){
          // no-op
        } else {
          handleClick(e.clientX,e.clientY);
        }
      }
    }
    _pendingFilterDrag=false;
  });
  window.addEventListener('mousedown',e=>{
    if(e.button!==0) return;
    if(_fpMode && document.pointerLockElement){
      // Exaggerated head nod on every click, regardless of whether we hit an
      // interactive target. Feels playful and confirms the click registered.
      if(typeof _triggerCatNod==='function') _triggerCatNod();
      // Crosshair click pulse — toggle a CSS class so the click animation
      // doesn't fight the .aiming hover styles managed in game-fp.js.
      const _ch=_el('fpCrosshair');
      if(_ch){
        _ch.classList.remove('click-pulse');
        // Force reflow so re-adding restarts the animation
        void _ch.offsetWidth;
        _ch.classList.add('click-pulse');
        clearTimeout(window._fpCrosshairPulseT);
        window._fpCrosshairPulseT=setTimeout(()=>{
          _ch.classList.remove('click-pulse');
        }, 220);
      }
      // In FP mode, raycast from screen center to find interactive target
      _raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const fpHits = _raycaster.intersectObjects(scene.children, true);
      let fpTarget = null;
      for (const h of fpHits) {
        if (!isAncestorVisible(h.object)) continue;
        if (h.distance > 220) break; // interaction range
        fpTarget = getInteractiveTarget(h.object);
        if (fpTarget) break;
        // Opaque non-interactive geometry blocks the click — no clicking
        // through walls, furniture, etc.
        const m = h.object && h.object.isMesh ? h.object.material : null;
        const passthrough = h.object && h.object.userData && h.object.userData.clickPassthrough;
        const transparent = m && !Array.isArray(m) && m.transparent && (m.opacity == null || m.opacity < 0.05);
        if (m && !passthrough && !transparent) break;
      }
      if (fpTarget) {
        handleClickObject(fpTarget);
      }
    }
  });
  window.addEventListener('touchend',e=>{
    if(_fpMode){
      if(e.changedTouches.length>0){
        const t=e.changedTouches[0];
        if(Math.abs(t.clientX-_clickStartX)<18 && Math.abs(t.clientY-_clickStartY)<18) handleClick(t.clientX,t.clientY);
      }
      _touchMode='none';
      drag=false;
      _isPanning=false;
      _dragFilter=null;
      _pendingFilterDrag=false;
      return;
    }
    if(e.touches.length===1 && _touchMode==='pinch'){
      _touchMode='none';
      px=e.touches[0].clientX;
      py=e.touches[0].clientY;
      _clickStartX=px;
      _clickStartY=py;
      return;
    }
    drag=false;
    _isPanning=false;
    if(e.touches.length===0 && (_touchMode==='pinch' || _hadMultiTouch)){
      _touchMode='none';
      _hadMultiTouch=false;
      _dragFilter=null;
      _pendingFilterDrag=false;
      return;
    }
    _touchMode='none';
    const wasDragging=_dragFilter && !_pendingFilterDrag;
    if(wasDragging){
      handleDragEnd();
    } else {
      _dragFilter=null;
      if(e.changedTouches.length>0){
        const t=e.changedTouches[0];
        if(Math.abs(t.clientX-_clickStartX)<25 && Math.abs(t.clientY-_clickStartY)<25) handleClick(t.clientX,t.clientY);
      }
    }
    _pendingFilterDrag=false;
  });
  let _hoverCheckTimer=0;
  let _lastHoverRaycastMs=0;
  
  function getInteractiveTarget(obj){
    let p=obj;
    while(p){
      if(p._isLamp||p._isCeilLight||p._isFan||p._isFilterL||p._isFilterR||p._isDrawer||p._isBifoldLeaf||p._isBypassPanel||p._isCornerDoorHandle||p._isCornerDoor||p._isGuestDoor||p._isGuestDoorHandle||p._isMacbook||p._isWindow||p._isWindowPane||p._isTV||p._isFoodBowl||p._isPickupSkateboard||p._isPokemonBinder) return p;
      p=p.parent;
    }
    return null;
  }
  
  function getPartIdFromAncestors(obj){
    let p=obj;
    while(p){
      if(p._partId) return p._partId;
      p=p.parent;
    }
    return null;
  }
  
  canvas.addEventListener('mousemove',e=>{
    if(_fpMode) return;
    if(_pendingFilterDrag && _dragFilter && Math.abs(e.clientX-_clickStartX)>15){
      drag=false;
      _pendingFilterDrag=false;
      canvas.style.cursor='ew-resize';
    }
    if(_dragFilter && !_pendingFilterDrag){
      handleDragMove(e.clientX);
      return;
    }
    // Hover cursor check + tooltip — time-throttled (was every-3-events,
    // which still fired hundreds of raycasts/sec on 1 kHz polling mice and
    // tanked FPS when the cursor drifted near the air purifier's spinning
    // fan blades). 50 ms = 20 Hz, plenty for hover feedback.
    const _nowHover=(typeof performance!=='undefined' && performance.now)?performance.now():Date.now();
    if(!drag && _nowHover-_lastHoverRaycastMs>=50){
      _lastHoverRaycastMs=_nowHover;
      const rect=canvas.getBoundingClientRect();
      _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
      _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
      _raycaster.setFromCamera(_mouse,camera);
      const hits=_raycaster.intersectObjects(scene.children,true);
      _hoverInteractive=false;
      let hoveredPartId=null;
      for(const h of hits){
        if(!isAncestorVisible(h.object)) continue;
        if(!_hoverInteractive){
          const target=getInteractiveTarget(h.object);
          if(target) _hoverInteractive=true;
        }
        if(!hoveredPartId) hoveredPartId=getPartIdFromAncestors(h.object);
        if(_hoverInteractive || hoveredPartId) break;
      }
      canvas.style.cursor=_hoverInteractive?'pointer':'grab';
      // Tooltip: show after 1.2s hover on same part
      if(hoveredPartId && hoveredPartId!==_hoverPartId){
        hideTooltip();
        _hoverPartId=hoveredPartId;
        _hoverTimer=setTimeout(()=>showTooltip(hoveredPartId, e.clientX, e.clientY), 1200);
      } else if(!hoveredPartId){
        hideTooltip();
      }
    }
    if(!drag) return;
    if(e.shiftKey){
      // Shift+drag: pan the camera target on the floor plane
      _isPanning=true;
      const panSpeed=0.08*radius/50;
      // Camera right vector projected onto XZ
      const rx=Math.cos(azimuth), rz=-Math.sin(azimuth);
      // Camera forward vector projected onto XZ
      const fx=-Math.sin(azimuth), fz=-Math.cos(azimuth);
      const dx=e.clientX-px, dy=e.clientY-py;
      panX-=dx*rx*panSpeed + dy*fx*panSpeed;
      panZ-=dx*rz*panSpeed + dy*fz*panSpeed;
    } else {
      _isPanning=false;
      azimuth-=(e.clientX-px)*0.013;
      polar=Math.max(0.1,Math.min(Math.PI-0.1,polar-(e.clientY-py)*0.013));
    }
    px=e.clientX;py=e.clientY;
  });
  canvas.addEventListener('touchmove',e=>{
    if(_fpMode){
      if(e.touches.length!==1) return;
      e.preventDefault();
      const tx=e.touches[0].clientX;
      const ty=e.touches[0].clientY;
      const lookScale=0.004*_fpTouchLookSensitivity;
      _fpYaw-=(tx-px)*lookScale;
      _fpPitch=Math.max(_fpPitchMin,Math.min(_fpPitchMax,_fpPitch-(ty-py)*lookScale));
      px=tx;
      py=ty;
      return;
    }
    if(e.touches.length===2){
      e.preventDefault();
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const dist=Math.hypot(dx,dy)||1;
      if(_touchMode!=='pinch'){
        _touchMode='pinch';
        _pinchStartDist=dist;
        _pinchStartRadius=radius;
        _hadMultiTouch=true;
      }
      const ratio=dist/Math.max(_pinchStartDist,1);
      radius=Math.max(20,Math.min(130,_pinchStartRadius/Math.max(0.35,ratio)));
      drag=false;
      _isPanning=false;
      return;
    }
    if(e.touches.length!==1 || _touchMode==='pinch') return;
    if(_pendingFilterDrag && _dragFilter && Math.abs(e.touches[0].clientX-_clickStartX)>20){
      drag=false;
      _pendingFilterDrag=false;
    }
    if(_dragFilter && !_pendingFilterDrag){
      handleDragMove(e.touches[0].clientX);
      return;
    }
    if(!drag)return;
    azimuth-=(e.touches[0].clientX-px)*0.013;
    polar=Math.max(0.1,Math.min(Math.PI-0.1,polar-(e.touches[0].clientY-py)*0.013));
    px=e.touches[0].clientX;py=e.touches[0].clientY;
  },{passive:false});
  // Wheel zoom — differentiate mouse wheel vs trackpad for sane sensitivity.
  // A mouse-wheel notch typically fires a single event with |deltaY| >= ~40
  // (often 100). Trackpads stream many small events, often deltaMode=0 with
  // |deltaY| < ~40. Mouse wheel ticks felt way too aggressive vs trackpad, so
  // we scale mouse ticks down to roughly match one notch ≈ 5% of the zoom
  // range; trackpads keep their smooth per-pixel feel.
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    // Heuristics for "this is a mouse wheel, not a trackpad":
    //   • deltaMode === DOM_DELTA_LINE / DOM_DELTA_PAGE (1 or 2) → definitely wheel
    //   • deltaMode 0 with a large-magnitude delta (>40) is almost always a
    //     discrete wheel notch on macOS/Windows Chrome, where trackpads emit
    //     small per-pixel deltas.
    const mag=Math.abs(e.deltaY);
    const isMouseWheel = e.deltaMode!==0 || mag>=40;
    let step;
    if(isMouseWheel){
      // Fixed-size soft notch; one click ≈ 5.5 inches of zoom regardless of
      // how aggressively the OS reports the wheel delta (some OS send 100 per
      // notch, some send 33, some send 150 with "smooth scroll"). Keeps feel
      // consistent across devices.
      step = Math.sign(e.deltaY)*5.5;
    } else {
      // Trackpad: smooth per-pixel zoom. Slightly gentler than the original
      // 0.55× so a two-finger swipe doesn't overshoot the whole range.
      step = e.deltaY*0.32;
    }
    radius=Math.max(20,Math.min(130, radius+step));
  },{passive:false});
  
  // ─── Interactive click: tap fans to toggle spin, tap filters to slide in/out ───
  // Tag interactive groups
  // Tag each rotor's children with a reference to that rotor for per-fan click.
  // Only explicit fan meshes are interactive; panel/wall meshes are not.
  for(const rotor of allRotors){
    rotor.userData.spinning=true;
    rotor.userData.spinSpeed=0.125; // start spinning immediately (50% of SPIN_MAX)
    rotor.traverse(o=>{
      if(o.isMesh){
        o._isFan=true;
        o._rotor=rotor;
      }
    });
  }
  filterL.traverse(o=>{o._isFilterL=true;});
  filterR.traverse(o=>{o._isFilterR=true;});
  
  // ─── Part info for hover tooltips ───
  const _partInfo={};
  function tagPart(group, name, dims){
    group.traverse(o=>{ if(o.isMesh) o._partId=name; });
    _partInfo[name]={name:name, dims:dims};
  }
  tagPart(parts.top, 'Top Panel', panelW.toFixed(1)+'″ × '+(D+2*ply).toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(parts.bot, 'Bottom Panel', panelW.toFixed(1)+'″ × '+(D+2*ply).toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(front3, 'Front Panel (3-fan)', panelW.toFixed(1)+'″ × '+H.toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(front4, 'Front Panel (4-fan)', panelW.toFixed(1)+'″ × '+H.toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(back3, 'Back Panel (3-fan)', panelW.toFixed(1)+'″ × '+H.toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(back4, 'Back Panel (4-fan)', panelW.toFixed(1)+'″ × '+H.toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(altBackGroup, 'Back Panel (solid)', panelW.toFixed(1)+'″ × '+H.toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(altTop4, 'Top Fan Panel', panelW.toFixed(1)+'″ × '+(D+2*ply).toFixed(1)+'″ × '+ply+'″ birch plywood');
  tagPart(filterL, 'MERV 13 Filter (left)', H.toFixed(1)+'″ × '+D.toFixed(1)+'″ × '+ft+'″ (20×25×1 nominal)');
  tagPart(filterR, 'MERV 13 Filter (right)', H.toFixed(1)+'″ × '+D.toFixed(1)+'″ × '+ft+'″ (20×25×1 nominal)');
  tagPart(foamGroup, 'Foam Tape Seal', '½″ wide × 3/32″ thick — continuous ring');
  tagPart(ledgeTopGroup, 'Ledge Strips (top)', ledgeW.toFixed(2)+'″ × '+ledgeT.toFixed(2)+'″ × '+(ledgeDepth).toFixed(1)+'″');
  tagPart(ledgeBotGroup, 'Ledge Strips (bottom)', ledgeW.toFixed(2)+'″ × '+ledgeT.toFixed(2)+'″ × '+(ledgeDepth).toFixed(1)+'″');
  tagPart(legGroup, 'Feet', feetStyle==='bun'?'2.5″ tall round bun feet':feetStyle==='peg'?'0.75″ peg legs':'0.75″ rubber feet');
  // Fans get special labeling
  [front3,front4,back3,back4,altTop4].forEach(g=>{
    g.traverse(o=>{
      if(o.isMesh && o._isFan && !o._partId){
        o._partId='fan';
        _partInfo['fan']={name:'Arctic P12 Pro ARGB', dims:'120×120×27mm (4.7″) — PWM 200-1800 RPM'};
      }
    });
  });
  
  // Hover tooltip logic
  let _hoverTimer=null, _hoverPartId=null;
  const _tooltip=_el('partTooltip');
  const _tipName=_el('tipName');
  const _tipDims=_el('tipDims');
  
  function showTooltip(partId, x, y){
    const info=_partInfo[partId];
    if(!info||!_tooltip) return;
    if(_tipName) _tipName.textContent=info.name;
    if(_tipDims) _tipDims.textContent=info.dims;
    _tooltip.style.left=x+'px';
    _tooltip.style.top=y+'px';
    _tooltip.classList.add('visible');
  }
  function hideTooltip(){
    if(!_tooltip) return;
    _tooltip.classList.remove('visible');
    _hoverPartId=null;
    if(_hoverTimer){clearTimeout(_hoverTimer);_hoverTimer=null;}
  }
  
  let filterLOut=false, filterROut=false;
  const filterLOrigin=filterL.position.clone();
  const filterROrigin=filterR.position.clone();
  const filterSlideMax=12; // slide up to 12" out from installed position
  
  function handleClickObject(obj){
    if(!obj) return;
    // Clicked pickup skateboard
    if(obj._isPickupSkateboard){
      if(window._collectPickupSkateboard) window._collectPickupSkateboard();
      return;
    }
    // Clicked corner door (handle or panel — the whole leaf opens/closes)
    if(obj._isCornerDoorHandle||obj._isCornerDoor){
      if(_toggleCornerDoor){
        const isOpen = _toggleCornerDoor();
        _playDoorCue(!!isOpen, 1);
      }
      return;
    }
    // Clicked Pokémon binder (any part) — toggle open/closed; first open
    // spawns the secret blue coin (repurposed from the corner-door secret).
    if(obj._isPokemonBinder){
      if(typeof window._togglePokemonBinder==='function'){
        const result = window._togglePokemonBinder();
        if(_fpMode && result && result.opened && result.coinPos){
          spawnSecretBinderCoin(result.coinPos);
        }
      }
      return;
    }
    // Clicked guest door (handle or panel) — leads to office
    if(obj._isGuestDoor||obj._isGuestDoorHandle){
      if(_toggleGuestDoor){
        const isOpen = _toggleGuestDoor();
        _playDoorCue(!!isOpen, 1);
      }
      return;
    }
    // Clicked lamp → toggle light
    if(obj._isLamp){
      if(!_roomLampLight) return;
      _roomLampOn=!_roomLampOn;
      _roomLampLight.intensity=_roomLampOn?400:0;
      if(_roomLampShade) _roomLampShade.material.emissiveIntensity=_roomLampOn?0.75:0;
      if(_roomLampBulb) _roomLampBulb.material.emissiveIntensity=_roomLampOn?1.9:0;
      _markShadowsDirty();
      if(_fpMode) spawnSecretLampCoin();
      return;
    }
    // Clicked ceiling light → toggle
    if(obj._isCeilLight){
      if(!_roomCeilSpot) return;
      _roomCeilLightOn=!_roomCeilLightOn;
      if(_todRefs) _todRefs.ceilLightOn=_roomCeilLightOn;
      if(_roomCeilLightOn){
        const todSlider=_el('todSlider');
        const minutes=parseInt(todSlider?.value || '870', 10);
        if(_applyTimeOfDay){
          _applyTimeOfDay(minutes);
        } else {
          _roomCeilSpot.intensity=80;
          if(_roomDomeMat) _roomDomeMat.emissiveIntensity=0.7;
          if(_roomCeilGlow) _roomCeilGlow.intensity=30;
        }
      } else {
        _roomCeilSpot.intensity=0;
        if(_roomDomeMat) _roomDomeMat.emissiveIntensity=0;
        if(_roomCeilGlow) _roomCeilGlow.intensity=0;
      }
      _markShadowsDirty();
      if(_fpMode) spawnSecretCeilingLightCoins();
      return;
    }
    // Clicked window pane → slide open/close
    if(obj._isWindowPane){
      let winGroup = obj;
      while (winGroup && !winGroup.userData?.windowModel) winGroup = winGroup.parent;
      if (!winGroup) return;
      if (_windowLerps.some(wl => wl.group === winGroup)) return; // already animating
      const wm = winGroup.userData.windowModel;
      // Toggle open state (stored on userData so it persists with the group)
      wm._isOpen = !wm._isOpen;
      const open = wm._isOpen;
      wm._slideTarget = open ? wm.lowerPane._baseY + wm.height / 2 : wm.lowerPane._baseY;
      _windowLerps.push({ group: winGroup });
      // Sync room-level state for collision gating in game-fp
      if (typeof window !== 'undefined' && window._roomRefs && window._roomRefs.setOfficeWindowOpen) {
        window._roomRefs.setOfficeWindowOpen(open);
      }
      return;
    }
    // Clicked window → toggle day/night
    if(obj._isWindow){
      if(!_roomOutdoorMat || !_applyTimeOfDay) return;
      _windowIsNight=!_windowIsNight;
      if(_roomOutdoorNightTex && _roomOutdoorDayTex) {
        // Swap the texture map on the existing MeshBasicMaterial. Do NOT
        // set material.needsUpdate — that forces a shader recompile which
        // causes a visible stutter on day/night toggle. Swapping .map on
        // a material that already has a map is a cheap pointer swap.
        _roomOutdoorMat.map=_windowIsNight?_roomOutdoorNightTex:_roomOutdoorDayTex;
        _roomOutdoorMat.color.setHex(_windowIsNight?0x445566:0xfff0d4);
      }
      const todSlider=_el('todSlider');
      if(_windowIsNight){
        _applyTimeOfDay(1320);
        if(todSlider) todSlider.value=1320;
      } else {
        _applyTimeOfDay(870);
        if(todSlider) todSlider.value=870;
      }
      _markShadowsDirty();
      if(_fpMode) spawnSecretWindowCoin();
      return;
    }
    // Clicked a fan → toggle that individual fan's rotor (only if mesh has a _rotor ref).
    if(obj._isFan && obj._rotor){
      obj._rotor.userData.spinning=!obj._rotor.userData.spinning;
      return;
    }
    // Clicked filter → toggle slide (ignore if already animating)
    if(obj._isFilterL){
      if(_filterLerps.some(fl=>fl.obj===filterL)) return; // already sliding
      filterLOut=!filterLOut;
      const target=filterLOut?filterLOrigin.clone().sub(new THREE.Vector3(filterSlideMax,0,0)):filterLOrigin.clone();
      _filterLerps.push({obj:filterL,target:target});
      return;
    }
    if(obj._isFilterR){
      if(_filterLerps.some(fl=>fl.obj===filterR)) return; // already sliding
      filterROut=!filterROut;
      const target=filterROut?filterROrigin.clone().add(new THREE.Vector3(filterSlideMax,0,0)):filterROrigin.clone();
      _filterLerps.push({obj:filterR,target:target});
      return;
    }
    // Clicked a drawer → toggle slide (ignore if already animating) + spawn
    // secret deep-under-bed coin on the first drawer interaction.
    if(obj._isDrawer){
      // Walk up to find the drawer Group (the one with _drawerSlideMax)
      let grp = obj;
      while(grp && !(grp.isGroup && grp._drawerSlideMax !== undefined)) grp = grp.parent;
      if(!grp) return;
      if(_drawerLerps.some(dl=>dl.obj===grp)) return;
      grp._drawerOpen=!grp._drawerOpen;
      _playDrawerCue(grp._drawerOpen);
      // slide=0 closed, slide=slideMax fully out (-Z direction).
      const newSlide=grp._drawerOpen ? grp._drawerSlideMax : 0;
      const deltaZ=-(newSlide - grp._drawerSlide); // change to apply to current Z
      const targetZ=grp.position.z + deltaZ;
      grp._drawerSlide=newSlide;
      _drawerLerps.push({obj:grp, targetZ});
      if(_fpMode) spawnSecretDrawerCoin();
      return;
    }
    // Clicked a bifold closet leaf → toggle fold
    if(obj._isBifoldLeaf){
      // Walk up to the leaf pivot group.
      let leaf=obj;
      while(leaf && !(leaf._isBifoldLeaf && leaf.isGroup && leaf._innerGroup)) leaf=leaf.parent;
      if(!leaf) return;
      if(_bifoldLerps.some(bl=>bl.leaf===leaf)) return;
      leaf._leafOpen=!leaf._leafOpen;
      _playDoorCue(leaf._leafOpen, 0.78);
      // Fold angle: 80° gives a nicely open V without panels intersecting.
      const openAng=80*Math.PI/180;
      leaf._leafTarget=leaf._leafOpen ? openAng : 0;
      _bifoldLerps.push({leaf});
      return;
    }
    // Clicked a bypass sliding closet panel → toggle slide
    if(obj._isBypassPanel){
      let panel=obj;
      while(panel && !(panel._isBypassPanel && panel.isGroup && panel._slideMax!==undefined)) panel=panel.parent;
      if(!panel) return;
      if(_bypassLerps.some(bl=>bl.panel===panel)) return;
      panel._slideOpen=!panel._slideOpen;
      _playDoorCue(panel._slideOpen, 0.65);
      // Each panel slides toward the other (stacks behind it on parallel track)
      panel._slideTarget=panel._slideOpen ? panel._baseZ+panel._slideDir*panel._slideMax : panel._baseZ;
      _bypassLerps.push({panel});
      return;
    }
    // Clicked the MacBook → toggle screen + spawn secret coin on first click.
    if(obj._isMacbook){
      if(_toggleMacbook) _toggleMacbook();
      if(_fpMode) spawnSecretMacbookCoin();
      return;
    }
    // Clicked the TV → toggle on/off + spawn secret coin on first click.
    if(obj._isTV){
      if(_toggleTV) _toggleTV();
      if(_fpMode) spawnSecretTvCoin();
      return;
    }
    // Clicked the food bowl → toggle kibble visibility + play kibble-pouring sound
    if(obj._isFoodBowl){
      if(_toggleFoodBowl){
        const nowVisible = _toggleFoodBowl();
        if(nowVisible) _playFoodPourSfx();
      }
      if(_fpMode && _getFoodBowlMesh){
        const bowl = _getFoodBowlMesh();
        if(bowl){
          const wp = new THREE.Vector3();
          bowl.getWorldPosition(wp);
          // Float the coin a few inches above the bowl rim so it sits in
          // the silver dish rather than clipping through the bottom.
          wp.y += 3.5;
          spawnSecretFoodBowlCoin(wp);
        }
      }
      return;
    }
  }
  
  function handleClick(clientX,clientY){
    const rect=canvas.getBoundingClientRect();
    _mouse.x=((clientX-rect.left)/rect.width)*2-1;
    _mouse.y=-((clientY-rect.top)/rect.height)*2+1;
    _raycaster.setFromCamera(_mouse,camera);
    const hits=_raycaster.intersectObjects(scene.children,true);
    // Find the first interactive hit (skip objects inside invisible parent groups)
    let obj=null;
    for(const h of hits){
      if(!isAncestorVisible(h.object)) continue;
      const target=getInteractiveTarget(h.object);
      if(target){ obj=target; break; }
    }
    handleClickObject(obj);
  }
  
  function isAncestorVisible(obj){
    let p=obj;
    while(p){ if(!p.visible) return false; p=p.parent; }
    return true;
  }
  
  function handleDragStart(clientX,clientY){
    if(_isMobile) return false;
    const rect=canvas.getBoundingClientRect();
    _mouse.x=((clientX-rect.left)/rect.width)*2-1;
    _mouse.y=-((clientY-rect.top)/rect.height)*2+1;
    _raycaster.setFromCamera(_mouse,camera);
    const hits=_raycaster.intersectObjects(scene.children,true);
    let obj=null;
    for(const h of hits){
      const target=getInteractiveTarget(h.object);
      if(target && (target._isFilterL||target._isFilterR)){ obj=target; break; }
    }
    if(!obj) return false;
    if(obj._isFilterL){
      _dragFilter={obj:filterL, side:-1, origin:filterLOrigin, startX:clientX, startPos:filterL.position.x};
      return true;
    }
    if(obj._isFilterR){
      _dragFilter={obj:filterR, side:1, origin:filterROrigin, startX:clientX, startPos:filterR.position.x};
      return true;
    }
    return false;
  }
  
  function handleDragMove(clientX){
    if(!_dragFilter) return;
    const dx=(clientX-_dragFilter.startX)*0.15;
    const side=_dragFilter.side;
    const originX=_dragFilter.origin.x;
    // Get camera's right vector X component — tells us which screen direction maps to +X in world
    const camRight=new THREE.Vector3();
    camera.getWorldDirection(camRight);
    camRight.cross(camera.up).normalize();
    const move=dx*camRight.x; // project screen drag onto world X
    const newX=_dragFilter.startPos+move;
    if(side===-1){
      _dragFilter.obj.position.x=Math.max(originX-filterSlideMax, Math.min(originX, newX));
    } else {
      _dragFilter.obj.position.x=Math.min(originX+filterSlideMax, Math.max(originX, newX));
    }
  }
  
  function handleDragEnd(){
    if(!_dragFilter) return;
    const side=_dragFilter.side;
    const originX=_dragFilter.origin.x;
    const currentX=_dragFilter.obj.position.x;
    const pulled=Math.abs(currentX-originX);
    // Update out state based on where it ended up
    if(side===-1) filterLOut=pulled>0.1;
    else filterROut=pulled>0.1;
    _dragFilter=null;
  }
  
  const _filterLerps=[];
  const _drawerLerps=[];
  const _bifoldLerps=[];
  const _bypassLerps=[];
  const _windowLerps=[];
  
  // macOS trackpad pinch-to-zoom → model zoom (Safari gesture events)
  let gestureStartRadius;
  canvas.addEventListener('gesturestart',e=>{e.preventDefault();gestureStartRadius=radius;});
  canvas.addEventListener('gesturechange',e=>{e.preventDefault();const dampedScale=1+(e.scale-1)*0.55;radius=Math.max(20,Math.min(130,gestureStartRadius/dampedScale));});
  canvas.addEventListener('gestureend',e=>{e.preventDefault();});
  
  function resize(){
    const w=canvas.parentElement.clientWidth,h=canvas.parentElement.clientHeight;
    if(renderer) { renderer.setSize(w,h,false); } if(camera) { camera.aspect=w/h; camera.updateProjectionMatrix(); }
  }
  resize(); window.addEventListener('resize',resize);
  

  // ─── Dimension annotations + placement (lines 4680-5660) ───
  // ─── Dimension annotations ───
  const dimGroup=new THREE.Group();
  dimGroup.visible=false;
  scene.add(dimGroup);
  
  function makeTextSprite(text,bgColor='#ffffff'){
    const cvs=document.createElement('canvas');
    const ctx=cvs.getContext('2d');
    const fontSize=28;
    ctx.font=`600 ${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    const tw=ctx.measureText(text).width;
    cvs.width=tw+24; cvs.height=fontSize+18;
    ctx.font=`600 ${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    ctx.fillStyle=bgColor; ctx.globalAlpha=0.92;
    ctx.beginPath(); ctx.roundRect(2,2,cvs.width-4,cvs.height-4,6); ctx.fill();
    ctx.globalAlpha=1; ctx.strokeStyle='#999'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(2,2,cvs.width-4,cvs.height-4,6); ctx.stroke();
    ctx.fillStyle='#333'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(text,cvs.width/2,cvs.height/2);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cvs),depthTest:false}));
    sp.scale.set(1.8*cvs.width/cvs.height,1.8,1);
    return sp;
  }
  
  // Thick line helper for dimension lines (WebGL ignores linewidth)
  function dimTube(a,b,color,rad=0.06){
    const dir=new THREE.Vector3().subVectors(b,a);
    const len=dir.length();
    const mat=new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:0.85});
    const geo=new THREE.CylinderGeometry(rad,rad,len,4,1);
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
    return mesh;
  }
  
  function dimLine(a,b,label,offset,color=0xff3333){
    const ao=a.clone().add(offset), bo=b.clone().add(offset);
    // Main dimension line
    dimGroup.add(dimTube(ao,bo,color,0.06));
    // Tick marks at endpoints
    const dir=bo.clone().sub(ao).normalize();
    const tickLen=0.8;
    for(const p of [ao,bo]){
      const cross=new THREE.Vector3().crossVectors(dir,offset.clone().normalize()).normalize().multiplyScalar(tickLen);
      if(cross.length()<0.01) cross.set(0,tickLen,0);
      dimGroup.add(dimTube(p.clone().add(cross),p.clone().sub(cross),color,0.04));
    }
    // Leader lines (dashed → solid thin)
    for(const [mp,dp] of [[a,ao],[b,bo]]){
      dimGroup.add(dimTube(mp,dp,0x999999,0.03));
    }
    const sp=makeTextSprite(label);
    sp.position.copy(ao.clone().add(bo).multiplyScalar(0.5));
    dimGroup.add(sp);
  }
  
  const extW=panelW, extH=H+2*ply, extD=D+2*ply, offy=4;
  dimLine(new THREE.Vector3(-extW/2,-extH/2,-extD/2),new THREE.Vector3(-extW/2,extH/2,-extD/2),
    `${extH.toFixed(1)}″ height`,new THREE.Vector3(-offy,0,-offy));
  dimLine(new THREE.Vector3(-extW/2,-extH/2,-extD/2),new THREE.Vector3(-extW/2,-extH/2,extD/2),
    `${extD.toFixed(1)}″ depth`,new THREE.Vector3(-offy,-offy,0));
  dimLine(new THREE.Vector3(-extW/2,-extH/2,-extD/2),new THREE.Vector3(extW/2,-extH/2,-extD/2),
    `${extW.toFixed(1)}″ width`,new THREE.Vector3(0,-offy,-offy));
  dimLine(new THREE.Vector3(extW/2,-H/2,extD/2),new THREE.Vector3(extW/2,H/2,extD/2),
    `${H.toFixed(1)}″ filter (20 nom)`,new THREE.Vector3(offy*1.6,0,offy*0.5),0x2277aa);
  dimLine(new THREE.Vector3(extW/2,H/2,-D/2),new THREE.Vector3(extW/2,H/2,D/2),
    `${D.toFixed(1)}″ filter (25 nom)`,new THREE.Vector3(offy*1.6,offy*0.5,0),0x2277aa);
  const fanCY=fanY(0);
  dimLine(new THREE.Vector3(-fanFrame/2,fanCY,-extD/2),new THREE.Vector3(fanFrame/2,fanCY,-extD/2),
    `${fanFrame.toFixed(1)}″ fan (120mm)`,new THREE.Vector3(0,0,-offy*1.5),0x333333);
  dimLine(new THREE.Vector3(-extW/2,extH/2,-(D/2+ply)),new THREE.Vector3(-extW/2,extH/2,-D/2),
    `${ply}″ ply`,new THREE.Vector3(-offy*1.5,offy*1.2,0),0x888888);
  
  let dimVisible=false;
  function toggleDimensions(){
    dimVisible=!dimVisible;
    dimGroup.visible=dimVisible;
    _el('togDims').classList.toggle('on',dimVisible);
    // Dimensions require assembled view — collapse if exploded
    if(dimVisible && exploded) collapseView();
  }
  
  // ─── Wood stain selector (3 species with distinct grains) ───
  let stainMode='ash';
  const STAIN_COLORS={
    ash:    {col:new THREE.Color(0xd8c8a8), shine:20, swatch:'#d8c8a8'},
    birch:  {col:new THREE.Color(0xd2b48c), shine:18, swatch:'#ddc89e'},
    walnut: {col:new THREE.Color(0x4a2c17), shine:30, swatch:'#4a2c17'},
  };
  function setStain(mode){
    stainMode=mode;
    document.querySelectorAll('#btnStainAsh,#btnStainBirch,#btnStainWalnut').forEach(b=>b.classList.remove('on'));
    _el(mode==='ash'?'btnStainAsh':mode==='birch'?'btnStainBirch':'btnStainWalnut').classList.add('on');
    applyCurrentStain();
  }
  
  // Species-specific texture pools
  const _speciesTexPools = { ash: [], birch: birchTexPool, walnut: [] };
  function _makeSpeciesTextures(species, count) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      pool.push(makeWoodTexture(1024, 42 + i * 73, species));
    }
    return pool;
  }
  function makeWoodTexture(size, seed, species) {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = size || 512;
    const ctx = cvs.getContext('2d');
    const W = cvs.width, HH = cvs.height;
    let s = seed || 1;
    function rand() { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 0x7fffffff; }

    const configs = {
      ash: {
        bases: ['#e8dcc4', '#e5d8be', '#dfd0b0', '#ecdcc8'],
        grainColor: 'rgba(170,145,100,', grainDark: 'rgba(140,115,70,',
        grainCount: 300, grainAmp: 3, grainFreq: 0.003, // straighter, subtler
        clusterCount: 15, streakCount: 2, knotChance: 0.15,
        highlightAlpha: 0.08
      },
      birch: {
        bases: ['#e8d5b0', '#e5d0a8', '#ecdcb8', '#e0c89e'],
        grainColor: 'rgba(150,115,60,', grainDark: 'rgba(180,150,100,',
        grainCount: 400, grainAmp: 5, grainFreq: 0.008,
        clusterCount: 10, streakCount: 4, knotChance: 0.3,
        highlightAlpha: 0.06
      },
      walnut: {
        bases: ['#6b4423', '#5a3a1e', '#704a28', '#4f3018'],
        grainColor: 'rgba(90,55,20,', grainDark: 'rgba(60,35,10,',
        grainCount: 350, grainAmp: 8, grainFreq: 0.012, // wavy, dramatic
        clusterCount: 8, streakCount: 6, knotChance: 0.25,
        highlightAlpha: 0.04
      }
    };
    const cfg = configs[species] || configs.birch;

    // Base color
    ctx.fillStyle = cfg.bases[Math.floor(rand() * cfg.bases.length)];
    ctx.fillRect(0, 0, W, HH);

    // Soft color bands
    const bandCount = 12 + Math.floor(rand() * 15);
    for (let i = 0; i < bandCount; i++) {
      const y = rand() * HH, h = 20 + rand() * 80;
      ctx.fillStyle = cfg.grainColor + (0.1 + rand() * 0.2) + ')';
      ctx.fillRect(0, y, W, h);
    }

    // Grain lines
    for (let i = 0; i < cfg.grainCount; i++) {
      const baseY = rand() * HH;
      const amp = cfg.grainAmp * (0.5 + rand());
      const freq = cfg.grainFreq * (0.5 + rand());
      const phase = rand() * Math.PI * 2;
      ctx.strokeStyle = (rand() > 0.4 ? cfg.grainDark : cfg.grainColor) + (0.12 + rand() * 0.2) + ')';
      ctx.lineWidth = 0.4 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let x = 0; x < W; x += 3) {
        ctx.lineTo(x, baseY + Math.sin(x * freq + phase) * amp + (rand() - 0.5) * 1.2);
      }
      ctx.stroke();
    }

    // Tight grain clusters
    for (let g = 0; g < cfg.clusterCount; g++) {
      const cy = rand() * HH;
      const count = 3 + Math.floor(rand() * 10);
      for (let i = 0; i < count; i++) {
        const y = cy + i * (0.8 + rand() * 1.2);
        ctx.strokeStyle = cfg.grainDark + (0.06 + rand() * 0.1) + ')';
        ctx.lineWidth = 0.3 + rand() * 0.5;
        ctx.beginPath();
        for (let x = 0; x < W; x += 4) {
          ctx.lineTo(x, y + Math.sin(x * cfg.grainFreq * 1.5 + rand() * 6) * 2);
        }
        ctx.stroke();
      }
    }

    // Darker streaks
    for (let i = 0; i < cfg.streakCount; i++) {
      const y = rand() * HH;
      ctx.strokeStyle = cfg.grainDark + (0.18 + rand() * 0.15) + ')';
      ctx.lineWidth = 1 + rand() * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < W; x += 4) {
        ctx.lineTo(x, y + Math.sin(x * cfg.grainFreq * 0.6 + rand() * 6) * cfg.grainAmp * 1.5);
      }
      ctx.stroke();
    }

    // Highlights
    for (let i = 0; i < 25; i++) {
      const y = rand() * HH;
      ctx.strokeStyle = `rgba(255,250,235,${cfg.highlightAlpha + rand() * 0.06})`;
      ctx.lineWidth = 2 + rand() * 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < W; x += 8) ctx.lineTo(x, y + (rand() - 0.5) * 1.5);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.rotation = Math.PI / 2;
    tex.center.set(0.5, 0.5);
    return tex;
  }
  // Pre-generate ash textures (birch already done above)
  _speciesTexPools.ash = _makeSpeciesTextures('ash', 6);
  _speciesTexPools.walnut = _makeSpeciesTextures('walnut', 6);

  function applyCurrentStain(){
    const s=STAIN_COLORS[stainMode];
    const texPool = _speciesTexPools[stainMode] || _speciesTexPools.birch;
    let tIdx = 0;
    for(const m of allBirchMats){
      m.color.copy(s.col);
      m.shininess=s.shine;
      if (texPool.length > 0) {
        m.map = texPool[tIdx % texPool.length];
        tIdx++;
      }
      m.needsUpdate=true;
    }
    const legendEl = _el('legendWood');
    if (legendEl) {
      const sw = legendEl.querySelector('.swatch');
      if (sw) sw.style.background = s.swatch;
    }
  }

  let xrayOn=false;
  
  function applyXrayToObject(root,on){
    if(!root) return;
    root.traverse(obj=>{
      if(!obj.isMesh || obj._isRoom) return;
      const mats=Array.isArray(obj.material)?obj.material:[obj.material];
      for(const mat of mats){
        if(!mat) continue;
        if(on){
          if(mat._origOpacity===undefined) mat._origOpacity=mat.opacity;
          if(mat._origTransp===undefined) mat._origTransp=mat.transparent;
          if(mat._origDepthW===undefined) mat._origDepthW=mat.depthWrite;
          mat.transparent=true;
          mat.opacity=0.35;
          mat.depthWrite=false;
          mat.needsUpdate=true;
        } else if(mat._origOpacity!==undefined){
          mat.opacity=mat._origOpacity;
          mat.transparent=mat._origTransp;
          mat.depthWrite=mat._origDepthW;
          delete mat._origOpacity;
          delete mat._origTransp;
          delete mat._origDepthW;
          mat.needsUpdate=true;
        }
      }
    });
  }

  function applyXrayToPurifier(){
    const roots=new Set();
    for(const root of Object.values(parts)){
      if(!root || roots.has(root)) continue;
      roots.add(root);
      applyXrayToObject(root,xrayOn);
    }
    if(wallBracketGroup && !roots.has(wallBracketGroup)){
      applyXrayToObject(wallBracketGroup,xrayOn);
    }
  }

  function toggleXray(force){
    xrayOn=(typeof force==='boolean')?force:!xrayOn;
    applyXrayToPurifier();
    return xrayOn;
  }

  function isXrayOn(){
    return xrayOn;
  }
  
  function rebuildTopPanel(){
    const oldTop=parts.top;
    const oldBot=parts.bot;
    const topParent=(oldTop&&oldTop.parent)?oldTop.parent:scene;
    const botParent=(oldBot&&oldBot.parent)?oldBot.parent:topParent;
    const basePos=new THREE.Vector3(0,H/2+ply/2,0);
    const baseBotPos=new THREE.Vector3(0,-(H/2+ply/2),0);
    const wasVisible=oldTop?oldTop.visible:true;
    const wasBotVisible=oldBot?oldBot.visible:true;
  
    if(oldTop&&oldTop.parent) oldTop.parent.remove(oldTop);
    if(oldBot&&oldBot.parent) oldBot.parent.remove(oldBot);
  
    const newTop=makeCapPanel(panelW,ply,D+2*ply,true,topEdgeProfile);
    const targetPos=exploded ? basePos.clone().add(explodeV.top) : basePos.clone();
    newTop.position.copy(targetPos);
    newTop.visible=wasVisible;
    topParent.add(newTop);
  
    const newBot=makeCapPanel(panelW,ply,D+2*ply,false,topEdgeProfile);
    const targetBotPos=exploded ? baseBotPos.clone().add(explodeV.bot) : baseBotPos.clone();
    newBot.position.copy(targetBotPos);
    newBot.visible=wasBotVisible;
    botParent.add(newBot);
  
    parts.top=newTop;
    parts.bot=newBot;
    origins.top=basePos.clone();
    origins.bot=baseBotPos.clone();
    targets.top=targetPos.clone();
    targets.bot=targetBotPos.clone();
  
    newTop.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
    newBot.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
    tagPart(parts.top, 'Top Panel', panelW.toFixed(1)+'″ × '+(D+2*ply).toFixed(1)+'″ × '+ply+'″ birch plywood');
    tagPart(parts.bot, 'Bottom Panel', panelW.toFixed(1)+'″ × '+(D+2*ply).toFixed(1)+'″ × '+ply+'″ birch plywood');
    applyCurrentStain();
    applyXrayToPurifier();
    applyVisibility();
  }
  
  function setEdgeProfile(mode){
    if(mode===topEdgeProfile) return;
    topEdgeProfile=mode;
    document.querySelectorAll('#btnEdgeFlat,#btnEdgeCurved').forEach(b=>b.classList.remove('on'));
    _el(mode==='flat'?'btnEdgeFlat':'btnEdgeCurved').classList.add('on');
    rebuildTopPanel();
    refreshPanelEdgeProfiles();
  }
  
  function setBoardThickness(mode){
    sessionStorage.setItem('boardThickness', mode);
    location.reload();
  }
  
  // ─── Layout toggle (Front+Back vs Front+Top) ───
  let layoutMode='fb';
  function applyVisibility(){
    const is3=(activeFanCount===3);
    const isFB=(layoutMode==='fb');
    // Front panels: active fan-count variant visible, other hidden
    front4.visible=!is3;
    front3.visible=is3;
    parts.front=is3?front3:front4;
    origins.front=parts.front.position.clone();
    // Back panels (only visible in FB mode)
    back4.visible=(!is3 && isFB);
    back3.visible=(is3 && isFB);
    parts.back=is3?back3:back4;
    origins.back=parts.back.position.clone();
    // Top cap (visible in FB, hidden in FT)
    parts.top.visible=isFB;
    // Alt back (solid, visible in FT only)
    altBackGroup.visible=!isFB;
    // Alt top fan panel (always 4 fans, only visible in FT mode)
    altTop4.visible=!isFB;
    applyXrayToPurifier();
    // Geometry visibility changed — shadow map needs one refresh.
    _markShadowsDirty();
  }
  function setLayout(mode){
    layoutMode=mode;
    document.querySelectorAll('#btnLayoutFB,#btnLayoutFT').forEach(b=>b.classList.remove('on'));
    _el(mode==='fb'?'btnLayoutFB':'btnLayoutFT').classList.add('on');
    if(exploded) collapseView();
    applyVisibility();
  }
  function setFanCount(n){
    if(n===activeFanCount) return;
    activeFanCount=n;
    document.querySelectorAll('#btnFan4,#btnFan3').forEach(b=>b.classList.remove('on'));
    _el(n===4?'btnFan4':'btnFan3').classList.add('on');
    if(exploded) collapseView();
    applyVisibility();
  }
  
  // ─── Feet style (peg / round bun / rubber) ───
  const FEET_H={peg:0.75, bun:3.5, rubber:0.75, none:0};
  let currentFootDiameter=1.5; // diameter in inches
  let currentBunH=3.5; // bun foot height in inches
  function setFootDiameter(d){
    currentFootDiameter=d;
    bunGeo=makeBunGeo(d/2, currentBunH);
    if(feetStyle==='bun'){
      // Adjust inset so larger feet don't poke outside panel edges
      const r = d / 2;
      const ins = Math.max(bunInset, r + 0.1);
      for(let i=0;i<allLegMeshes.length;i++){
        const leg=allLegMeshes[i], s=legSigns[i];
        leg.geometry=bunGeo;
        leg.position.x=s.x*(panelW/2-ins);
        leg.position.z=s.z*(D/2+ply-ins);
        applyFootTilt(leg, s.x, s.z, currentBunH);
        leg.matrixAutoUpdate=true;
        leg.updateMatrixWorld(true);
        leg.matrixAutoUpdate=false;
      }
    }
  }
  function setFootHeight(h){
    const oldH=currentFeetH;
    currentBunH=h;
    FEET_H.bun=h;
    // Update global state so floorY / collision tracks the change
    state.bunFootH = h;
    if(feetStyle==='bun'){
      const newH=h;
      currentFeetH=newH;
      // Hide legs if height is effectively zero
      legGroup.visible = h > 0.05;
      if(h > 0.05){
        bunGeo=makeBunGeo(currentFootDiameter/2, h);
        for(let i=0;i<allLegMeshes.length;i++){
          const leg=allLegMeshes[i], s=legSigns[i];
          leg.geometry=bunGeo;
          applyFootTilt(leg, s.x, s.z, h);
          leg.matrixAutoUpdate=true;
          leg.updateMatrixWorld(true);
          leg.matrixAutoUpdate=false;
        }
      }
    }
    updateTvGameStackPlacement();
  }
  function syncFootSizeRows(){
    const show=(feetStyle==='bun');
    const dia=_el('footDiameterRow');
    const hgt=_el('footHeightRow');
    const ang=_el('footAngleRow');
    if(dia) dia.style.display=show?'':'none';
    if(hgt) hgt.style.display=show?'':'none';
    if(ang) ang.style.display=(feetStyle!=='none')?'':'none';
  }
  function setFeetStyle(style){
    if(style===feetStyle){
      syncFootSizeRows();
      return;
    }
    const oldH=currentFeetH, newH=FEET_H[style];
    const delta=newH-oldH; // positive = taller feet
    feetStyle=style; currentFeetH=newH;
    syncFootSizeRows();
  
    // Update buttons
    document.querySelectorAll('#btnFeetPeg,#btnFeetBun,#btnFeetRubber,#btnFeetNone').forEach(b=>b.classList.remove('on'));
    _el(style==='peg'?'btnFeetPeg':style==='bun'?'btnFeetBun':style==='rubber'?'btnFeetRubber':'btnFeetNone').classList.add('on');
  
    // Hide legs entirely for 'none'
    legGroup.visible=(style!=='none');
  
    // Swap geometry + material + position (skip for none)
    if(style!=='none'){
    const geo=style==='bun'?bunGeo:pegGeo;
    const mat=style==='rubber'?rubberMat:woodLegMat;
    const ins=style==='bun'?bunInset:legInset;
    for(let i=0;i<allLegMeshes.length;i++){
      const leg=allLegMeshes[i], s=legSigns[i];
      leg.geometry=geo;
      leg.material=mat;
      leg.position.x=s.x*(panelW/2-ins);
      leg.position.z=s.z*(D/2+ply-ins);
      applyFootTilt(leg, s.x, s.z, newH);
      leg.matrixAutoUpdate=true;
      leg.updateMatrixWorld(true);
      leg.matrixAutoUpdate=false;
    }
    }
  
    // Shift floor + all room objects to match new clearance
    if(Math.abs(delta)>0.001) applyRoomDelta({x:0,y:delta,z:0});
    updateTvGameStackPlacement();
  }
  syncFootSizeRows();
  
  // ─── Room delta (no-op in modular build) ───
  function applyRoomDelta(delta){
    // No-op — room geometry stays fixed. Foot height changes are handled
    // by updating state.bunFootH which adjusts getFloorY() for collision.
  }
  
  function getPurifierFloorLocalY(){
    return -(H/2+ply+currentFeetH);
  }
  
  // ─── Console props (shown in Under TV mode) ───
  const consoleProps=new THREE.Group();
  consoleProps.visible=false;
  let _consoleXboxMesh=null;
  let _consoleSwitchGroup=null;
  const _consoleCollisionWorldBox=new THREE.Box3();
  const _consoleCollisionMin=new THREE.Vector3();
  const _consoleCollisionMax=new THREE.Vector3();
  parts.console=consoleProps;
  origins.console=consoleProps.position.clone();
  {
    const topY=H/2+ply; // top surface of purifier
  
    // Xbox Series X — standing vertical: 5.94"×11.85"×5.94" (W×H×D)
    const xbW=5.94, xbH=11.85, xbD=5.94;
    const xbMat=stdMat({color:0x1a1a1a,roughness:0.5});
    const xbox=new THREE.Mesh(new THREE.BoxGeometry(xbW,xbH,xbD),xbMat);
    // Rotated 90° so when purifierGroup rotates, Xbox is oriented correctly
    // Sits on top of purifier, toward the right end
    xbox.position.set(0, topY+xbH/2, 8);
    xbox.rotation.y = -7 * Math.PI / 180; // slight 5° rotation
    _consoleXboxMesh=xbox;
    consoleProps.add(xbox);
    // Green accent vent on top
    const ventMat=stdMat({color:0x107c10,roughness:0.6});
    const vent=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,0.15,32),ventMat);
    vent.position.set(0, topY+xbH+0.08, 8);
    consoleProps.add(vent);
  
    // Nintendo Switch 2 Dock — a trench runs the full width of the dock
    // (same slot width throughout), built as two parallel walls on the
    // front/back of the slot.
    const switchGroup=new THREE.Group();
    _consoleSwitchGroup=switchGroup;
    switchGroup.rotation.y=-Math.PI/2 + 5 * Math.PI / 180; // face +Z with 5° natural tilt
    switchGroup.position.z=-6; // shift along purifier length
    // Tablet dims (mirror the values defined below for slot sizing).
    const _swW_for_slot=10.5 - 2*1.4; // matches swW below
    const _swD_for_slot=0.55;         // matches swD below
    const slotD=_swD_for_slot+0.5;
    const dkW=_swW_for_slot, dkH=3.5, dkD=Math.max(2.5, slotD+1.2);
    const notchFromBottom=0.75; // notch floor sits 0.75" above dock bottom
    const floorY=topY+notchFromBottom;
    const wallD=(dkD-slotD)/2;
    const dkMat=stdMat({color:0x222222,roughness:0.6});
    // Front and back walls of the dock, with a full-width trench between.
    const wallFront=new THREE.Mesh(new THREE.BoxGeometry(dkW, dkH, wallD), dkMat);
    wallFront.position.set(0, topY+dkH/2, (slotD+wallD)/2);
    switchGroup.add(wallFront);
    const wallBack=new THREE.Mesh(new THREE.BoxGeometry(dkW, dkH, wallD), dkMat);
    wallBack.position.set(0, topY+dkH/2, -(slotD+wallD)/2);
    switchGroup.add(wallBack);
    // Solid floor of the notch so you can't see through.
    const dockFloor=new THREE.Mesh(new THREE.BoxGeometry(dkW, 0.1, slotD), dkMat);
    dockFloor.position.set(0, floorY-0.05, 0);
    switchGroup.add(dockFloor);
    // Also a filler below the notch floor so the trench looks like a
    // carved-out slot rather than an open-bottom tunnel.
    const dockBase=new THREE.Mesh(new THREE.BoxGeometry(dkW, notchFromBottom, slotD), dkMat);
    dockBase.position.set(0, topY+notchFromBottom/2, 0);
    switchGroup.add(dockBase);
  
    // Nintendo Switch 2 console in dock — the black tablet body is ONLY
    // the screen bezel; it sits between the two Joy-Cons (not behind
    // them). Joy-Cons attach on its left/right edges.
    const swH=4.7, swD=0.55;
    const jcW=1.4, jcH=swH, jcD=swD;
    const swW=10.5 - 2*jcW; // tablet width = space between Joy-Cons
    const swMat=stdMat({color:0x111111,roughness:0.5});
    const sw2=new THREE.Mesh(new THREE.BoxGeometry(swW,swH,swD),swMat);
    // Tablet sits with its bottom flush on the notch floor.
    const swCenterY=floorY+swH/2;
    sw2.position.set(0, swCenterY, 0);
    switchGroup.add(sw2);
    // Joy-Con 2 controllers — iconic blue (left) + red (right) with sticks
    // and button clusters. They sit attached to the ends of the tablet. The
    // outer-top and outer-bottom corners are rounded (like the real
    // hardware); the inner side stays square where it meets the rail.
    const jcYBase=swCenterY;
    const jcColors={left:0x1f6feb, right:0xe53935};
    // Build a rounded-side shape. outerDir=+1 rounds the +X side (right
    // controller), outerDir=-1 rounds the -X side (left controller). The
    // opposite side stays square where it meets the rail.
    const makeJoyConGeo=(outerDir)=>{
      const s=new THREE.Shape();
      const w=jcW, h=jcH, r=Math.min(w*0.38, h*0.18);
      if(outerDir>0){
        // Rounded on +X (right)
        s.moveTo(0,-h/2);
        s.lineTo(w-r,-h/2);
        s.quadraticCurveTo(w,-h/2, w,-h/2+r);
        s.lineTo(w,h/2-r);
        s.quadraticCurveTo(w,h/2, w-r,h/2);
        s.lineTo(0,h/2);
        s.lineTo(0,-h/2);
      } else {
        // Rounded on -X (left); square edge at x=0 on the inner (+X) side
        s.moveTo(0,-h/2);
        s.lineTo(0,h/2);
        s.lineTo(-w+r,h/2);
        s.quadraticCurveTo(-w,h/2, -w,h/2-r);
        s.lineTo(-w,-h/2+r);
        s.quadraticCurveTo(-w,-h/2, -w+r,-h/2);
        s.lineTo(0,-h/2);
      }
      return new THREE.ExtrudeGeometry(s, {depth:jcD, bevelEnabled:false, steps:1, curveSegments:8});
    };
    for(const side of [-1,1]){
      const key=side<0 ? 'left' : 'right';
      const jcBodyMat=stdMat({color:jcColors[key], roughness:0.55, metalness:0.05});
      const geo=makeJoyConGeo(side);
      // Center the extruded depth (it's built along +Z from 0 to jcD).
      geo.translate(0, 0, -jcD/2);
      const jc=new THREE.Mesh(geo, jcBodyMat);
      jc.position.set(side*(swW/2), jcYBase, 0);
      switchGroup.add(jc);
      // Analog stick — raised cap on a post.
      const stickMat=stdMat({color:0x111111, roughness:0.4});
      const stickPost=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.28,0.22,16), stickMat);
      stickPost.position.set(side*(swW/2+jcW/2), jcYBase + (side<0 ? jcH*0.22 : -jcH*0.22), jcD/2+0.12);
      stickPost.rotation.x=Math.PI/2;
      switchGroup.add(stickPost);
      const stickCap=new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.26,0.08,16), stickMat);
      stickCap.position.copy(stickPost.position);
      stickCap.position.z+=0.13;
      stickCap.rotation.x=Math.PI/2;
      switchGroup.add(stickCap);
      // Button cluster (4 small circles).
      const btnMat=stdMat({color:0x0f0f0f, roughness:0.5});
      const clusterY=jcYBase + (side<0 ? -jcH*0.22 : jcH*0.22);
      const clusterX=side*(swW/2+jcW/2);
      const btnOffsets=[[0,0.32],[0,-0.32],[-0.32,0],[0.32,0]];
      for(const [ox,oy] of btnOffsets){
        const btn=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.05,14), btnMat);
        btn.position.set(clusterX+ox, clusterY+oy, jcD/2+0.04);
        btn.rotation.x=Math.PI/2;
        switchGroup.add(btn);
      }
      // Plus/minus pill near top-inner of each joycon.
      const symMat=stdMat({color:0x222222, roughness:0.5});
      const sym=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.28,0.04), symMat);
      sym.position.set(clusterX - side*0.35, jcYBase + (side<0 ? -jcH*0.05 : jcH*0.05), jcD/2+0.03);
      switchGroup.add(sym);
      // Inner rail — thin light-gray strip where the joycon meets the
      // tablet, echoing the real hardware.
      const railMat=stdMat({color:0xd6d6d6, roughness:0.4, metalness:0.4});
      const rail=new THREE.Mesh(new THREE.BoxGeometry(0.08, jcH*0.92, jcD*0.6), railMat);
      rail.position.set(side*(swW/2+0.04), jcYBase, 0);
      switchGroup.add(rail);
    }
    // Screen — subtle dark display slightly inset from the tablet bezel,
    // sitting flush with the front face of the Joy-Cons.
    const screenW=swW*0.94;
    const scrMat=stdMat({color:0x050510, roughness:0.2, metalness:0.1});
    const scr=new THREE.Mesh(new THREE.PlaneGeometry(screenW, swH*0.82),scrMat);
    scr.position.set(0, jcYBase, jcD/2+0.001);
    switchGroup.add(scr);
    consoleProps.add(switchGroup);
  }
  
  // ─── Game stack props (shown in Under TV mode, next to purifier) ───
  const tvGameStackProps=new THREE.Group();
  tvGameStackProps.visible=false;
  const _tvGameCaseW=6.7;
  const _tvGameCaseT=0.43;
  const _tvGameCaseD=4.1;
  const _tvGameStackData=[
    // Edit titles here to update every case spine in one place.
    {title:'Pokemon Pokopia', platform:'switch2'},
    {title:'Pokemon Legends: Z-Acan', platform:'switch2'},
    {title:'Donkey Kong Bananza', platform:'switch2'},
    {title:'The Legend of Zelda: Skyward Sword HD', platform:'switch1'},
    {title:'Dead Cells', platform:'switch1'},
    {title:'The Legend of Zelda: Breath of the Wild', platform:'switch1'},
    {title:'The Legend of Zelda: Tears of the Kingdom', platform:'switch1'},
    {title:'Xenoblade Chronicles 2', platform:'special-gray'},
    {title:'Pokemon Violet', platform:'switch1'},
    {title:'Yoshi\'s Crafted World', platform:'switch1'},
    {title:'Moonlighter', platform:'switch1'},
    {title:'Splatoon 3', platform:'switch1'},
    {title:'Mario Party Superstars', platform:'switch1'},
    {title:'Mario Kart 8 Deluxe', platform:'switch1'},
    {title:'Pokemon Legends: Arceus', platform:'switch1'},
    {title:'My Hero One\'s Justice', platform:'switch1'},
    {title:'Astral Chain', platform:'switch1'},
    {title:'Pokemon: Let\'s Go, Eevee!', platform:'switch1'},
    {title:'Pokemon Brilliant Diamond', platform:'switch1'},
    {title:'Bayonetta 3', platform:'switch1'},
    {title:'Super Smash Bros. Ultimate', platform:'switch1'},
    {title:'Super Mario 3D All-Stars', platform:'switch1'},
    {title:'Crash Team Racing Nitro-Fueled', platform:'switch1'},
    {title:'Pokemon Sword', platform:'switch1'},
    {title:'Pokemon Shield', platform:'switch1'},
    {title:'The Legend of Zelda: Link\'s Awakening', platform:'switch1'},
    {title:'Super Mario Odyssey', platform:'switch1'},
    {title:'Ys VIII: Lacrimosa of DANA', platform:'switch1'},
    {title:'Hades', platform:'switch1'}
  ];
  if(_tvGameStackData.length!==29) console.warn('Expected 29 games in _tvGameStackData, got', _tvGameStackData.length);
  const _tvGameStackH=_tvGameStackData.length*_tvGameCaseT;
  
  function _drawRoundRect(ctx,x,y,w,h,r){
    const rr=Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }
  
  function makeGameSpineTexture(title,platform){
    const cvs=document.createElement('canvas');
    // Canvas aspect must match the spine decal plane (W:T ≈ 16.67:1) so the logo
    // and text aren't stretched horizontally when the texture is mapped.
    cvs.width=5334;
    cvs.height=320;
    const ctx=cvs.getContext('2d');
    const spineFontStack='-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const isSw2=platform==='switch2';
    const isGray=platform==='special-gray';
    const bg=isGray?'#bbbbbb':(isSw2?'#9b0a12':'#9b0a12');
    const rail=isGray?'#a1a1a1':(isSw2?'#9b0a12':'#9b0a12');
    const txt=isGray?'#262626':'#ffffff';
    const badgeStroke=isGray?'#505050':'#f6d7d8';
    const textStroke=isGray?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.35)';
  
    // Uniform red background — no separate rail stripe.
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,cvs.width,cvs.height);
  
    // Nintendo Switch logo — faithful port of icons8 SVG (48×48 viewBox).
    // Sized to fill ~80% of canvas height so it reads clearly at the spine scale.
    const ls=5.5; // 48 → 264px tall
    const lx=40, ly=(320-48*ls)/2;
    const logoCol=isGray?'#262626':'#ffffff';
    ctx.save();
    ctx.translate(lx,ly);
    ctx.scale(ls,ls);
  
    // Path 2: top half — filled with circular hole (evenodd).
    ctx.fillStyle=logoCol;
    ctx.beginPath();
    ctx.moveTo(6,18);
    ctx.lineTo(6,23);
    ctx.lineTo(42,23);
    ctx.lineTo(42,18);
    ctx.bezierCurveTo(42,13, 38,8, 33,8);
    ctx.lineTo(16,8);
    ctx.bezierCurveTo(10,8, 6,12.342, 6,18);
    ctx.closePath();
    // inner circle cutout at (27.5, 15.5) r=3.5
    ctx.moveTo(31,15.5);
    ctx.bezierCurveTo(31,17.434, 29.434,19, 27.5,19);
    ctx.bezierCurveTo(25.566,19, 24,17.434, 24,15.5);
    ctx.bezierCurveTo(24,13.566, 25.566,12, 27.5,12);
    ctx.bezierCurveTo(29.434,12, 31,13.566, 31,15.5);
    ctx.closePath();
    ctx.fill('evenodd');
  
    // Path 1: bottom half — stroked outline only.
    ctx.strokeStyle=logoCol;
    ctx.lineWidth=2;
    ctx.lineJoin='miter';
    ctx.miterLimit=10;
    ctx.beginPath();
    ctx.moveTo(7,31);
    ctx.lineTo(7,26);
    ctx.lineTo(41,26);
    ctx.lineTo(41,32);
    ctx.bezierCurveTo(41,36.401, 37.67,40, 32.947,40);
    ctx.lineTo(15.947,40);
    ctx.bezierCurveTo(10.27,40, 7,36.281, 7,31);
    ctx.closePath();
    ctx.stroke();
  
    // Path 3: small filled dot at (16.5, 32.5) r=3.5
    ctx.fillStyle=logoCol;
    ctx.beginPath();
    ctx.arc(16.5,32.5,3.5,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
    const logoRight=lx+48*ls;
    if(isSw2){
      ctx.save();
      ctx.fillStyle=logoCol;
      ctx.font='700 200px '+spineFontStack;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      // Switch 2 branding uses a tilted "2" — rotate ~90° counter-clockwise.
      const cx=logoRight+80, cy=160;
      ctx.translate(cx,cy);
      ctx.rotate(-Math.PI/2);
      ctx.fillText('2', 0, 0);
      ctx.restore();
    }
  
    const displayTitle=title;
    let font=125;
    ctx.textAlign='left';
    ctx.textBaseline='middle';
    const textLeft=logoRight+(isSw2?130:60);
    const textRight=4720;
    do {
      ctx.font='700 '+font+'px '+spineFontStack;
      font-=4;
    } while(ctx.measureText(displayTitle).width>(textRight-textLeft) && font>70);
    ctx.lineWidth=Math.max(4, Math.floor(font*0.06));
    ctx.strokeStyle=textStroke;
    ctx.shadowColor='rgba(0,0,0,0.12)';
    ctx.shadowBlur=3;
    ctx.shadowOffsetX=0;
    ctx.shadowOffsetY=1;
    // Switch 2 titles are centered within the available text area; Switch 1 stays left-aligned.
    if(isSw2){
      ctx.textAlign='center';
      const cx=(textLeft+textRight)/2;
      ctx.strokeText(displayTitle, cx, 160);
      ctx.fillStyle=txt;
      ctx.fillText(displayTitle, cx, 160);
    } else {
      ctx.strokeText(displayTitle, textLeft, 160);
      ctx.fillStyle=txt;
      ctx.fillText(displayTitle, textLeft, 160);
    }
    ctx.shadowColor='transparent';
  
    _drawRoundRect(ctx,4790,60,480,200,90);
    ctx.lineWidth=8;
    ctx.strokeStyle=badgeStroke;
    ctx.stroke();
    ctx.fillStyle=txt;
    ctx.font='600 90px '+spineFontStack;
    ctx.textAlign='center';
    ctx.fillText('Nintendo', 5030, 160);
  
    const tex=new THREE.CanvasTexture(cvs);
    tex.generateMipmaps=true;
    tex.minFilter=THREE.LinearMipmapLinearFilter;
    tex.magFilter=THREE.LinearFilter;
    if(renderer) tex.anisotropy=Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate=true;
    return tex;
  }
  
  function makeSwitch2PokopiaCoverTexture(){
    const cvs=document.createElement('canvas');
    // Match case top face ratio (~W:D) so artwork keeps proper proportions.
    cvs.width=1308;
    cvs.height=800;
    const ctx=cvs.getContext('2d');
    const fontStack='-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  
    const draw=(img,logo)=>{
      ctx.clearRect(0,0,cvs.width,cvs.height);
      // Rotate the whole composition 90deg so text + art run portrait/longways.
      ctx.save();
      ctx.translate(cvs.width/2,cvs.height/2);
      ctx.rotate(-Math.PI/2);
  
      // No outer padding/border — cover fills entire top face.
      const rw=cvs.height;
      const rh=cvs.width;
      const x=-rw/2;
      const y=-rh/2;
  
      // Red top banner — matches case body color (#9b0a12).
      const stripH=Math.round(rh*0.16);
      ctx.fillStyle='#9b0a12';
      ctx.fillRect(x,y,rw,stripH);
  
      // Centered Switch 2 logo in the banner (replaces text label).
      if(logo && logo.width>0 && logo.height>0){
        const logoH=Math.round(stripH*0.7);
        const logoW=logo.width*(logoH/logo.height);
        const lx=x+(rw-logoW)/2;
        const ly=y+(stripH-logoH)/2;
        ctx.drawImage(logo,lx,ly,logoW,logoH);
      }
  
      // Cover art fills full width of the card; vertical fits to cover area.
      const imgX=x;
      const imgY=y+stripH;
      const imgW=rw;
      const imgH=rh-stripH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(imgX,imgY,imgW,imgH);
      ctx.clip();
      ctx.fillStyle='#121212';
      ctx.fillRect(imgX,imgY,imgW,imgH);
      if(img && img.width>0 && img.height>0){
        // Fill width exactly; crop vertical overflow via clip above.
        const s=imgW/img.width;
        const dw=imgW;
        const dh=img.height*s;
        const dx=imgX;
        const dy=imgY+(imgH-dh)/2;
        ctx.drawImage(img,dx,dy,dw,dh);
      }
      ctx.restore();
  
      ctx.restore();
    };
  
    let loadedCover=null;
    let loadedLogo=null;
    draw(null,null);
    const tex=new THREE.CanvasTexture(cvs);
    tex.generateMipmaps=true;
    tex.minFilter=THREE.LinearMipmapLinearFilter;
    tex.magFilter=THREE.LinearFilter;
    if(renderer) tex.anisotropy=Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate=true;
  
    const coverImg=new Image();
    coverImg.onload=()=>{ loadedCover=coverImg; draw(loadedCover,loadedLogo); tex.needsUpdate=true; };
    coverImg.onerror=()=>{};
    coverImg.src='img/switch%202%20pokopia%20cover.jpg';
  
    const logoImg=new Image();
    logoImg.onload=()=>{ loadedLogo=logoImg; draw(loadedCover,loadedLogo); tex.needsUpdate=true; };
    logoImg.onerror=()=>{};
    // Strip the red background <rect> from the SVG so only the white mark renders.
    fetch('img/Nintendo_Switch_2_logo.svg').then(r=>r.text()).then(svg=>{
      const cleaned=svg.replace(/<path[^>]*fill="#e60012"[^>]*\/>/i,'');
      logoImg.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(cleaned);
    }).catch(()=>{ logoImg.src='img/Nintendo_Switch_2_logo.svg'; });
    return tex;
  }
  
  {
    for(let i=0;i<_tvGameStackData.length;i++){
      const game=_tvGameStackData[i];
      const isSw2=game.platform==='switch2';
      const isGray=game.platform==='special-gray';
      const isPokopiaSwitch2=isSw2 && /pokopia/i.test(String(game.title||''));
      const sideCol=isGray?0xb7b7b7:0x9b0a12;
      const bodyMat=stdMat({color:sideCol, roughness:0.72, metalness:0.02});
      const spineMap=makeGameSpineTexture(game.title, game.platform);
      const spineMat=new THREE.MeshStandardMaterial({
        map:spineMap,
        roughness:0.7,
        metalness:0.0
      });
      // Rounded case body — extrude a rounded rect (W × D silhouette) by thickness T.
      const rr=Math.min(0.12, _tvGameCaseT*0.45);
      const hw=_tvGameCaseW/2, hd=_tvGameCaseD/2;
      const shape=new THREE.Shape();
      shape.moveTo(-hw+rr,-hd);
      shape.lineTo(hw-rr,-hd);
      shape.quadraticCurveTo(hw,-hd,hw,-hd+rr);
      shape.lineTo(hw,hd-rr);
      shape.quadraticCurveTo(hw,hd,hw-rr,hd);
      shape.lineTo(-hw+rr,hd);
      shape.quadraticCurveTo(-hw,hd,-hw,hd-rr);
      shape.lineTo(-hw,-hd+rr);
      shape.quadraticCurveTo(-hw,-hd,-hw+rr,-hd);
      const caseGeo=new THREE.ExtrudeGeometry(shape,{depth:_tvGameCaseT,bevelEnabled:false,curveSegments:10});
      caseGeo.translate(0,0,-_tvGameCaseT/2);
      caseGeo.rotateX(Math.PI/2);
      const caseMesh=new THREE.Mesh(caseGeo,bodyMat);
      // Spine decal — thin plane on +Z face with the printed label texture.
      const decalGeo=new THREE.PlaneGeometry(_tvGameCaseW*0.985,_tvGameCaseT*0.92);
      const decal=new THREE.Mesh(decalGeo,spineMat);
      decal.position.set(0,0,hd+0.003);
      caseMesh.add(decal);
  
      if(isPokopiaSwitch2){
        const coverTex=makeSwitch2PokopiaCoverTexture();
        const coverMat=new THREE.MeshStandardMaterial({
          map:coverTex,
          roughness:0.72,
          metalness:0.02,
          side:THREE.DoubleSide,
          polygonOffset:true,
          polygonOffsetFactor:-1,
          polygonOffsetUnits:-2
        });
        const coverGeo=new THREE.PlaneGeometry(_tvGameCaseW*0.94,_tvGameCaseD*0.94);
        const cover=new THREE.Mesh(coverGeo,coverMat);
        cover.rotation.x=-Math.PI/2;
        cover.position.set(0,_tvGameCaseT/2+0.02,0);
        caseMesh.add(cover);
      }
      const y=(_tvGameStackData.length-1-i)*_tvGameCaseT+_tvGameCaseT/2;
      // Pseudo-random imperfect-stack jitter: small position and yaw offsets per case.
      const seed=i*12.9898;
      const jx=(Math.sin(seed)*0.5)*0.22;
      const jz=(Math.sin(seed*1.7+0.3)*0.5)*0.28;
      const jyaw=(Math.sin(seed*2.3+1.1)*0.5)*0.07; // up to ~4°
      const jtilt=(Math.sin(seed*3.1+2.2)*0.5)*0.025;
      const jroll=(Math.sin(seed*4.7+0.9)*0.5)*0.02;
      caseMesh.position.set(jx, y, jz);
      caseMesh.rotation.y=jyaw;
      caseMesh.rotation.x=jtilt;
      caseMesh.rotation.z=jroll;
      caseMesh.castShadow=true;
      caseMesh.receiveShadow=true;
      tvGameStackProps.add(caseMesh);
    }
  }
  
  function updateTvGameStackPlacement(){
    // Purifier group rotates +90° in Under TV mode; counter-rotate so spines face world +Z.
    tvGameStackProps.rotation.y=-Math.PI/2;
    tvGameStackProps.position.set(
      0,
      getPurifierFloorLocalY()-0.03,
      -(D/2+ply+_tvGameCaseD/2+8.0)
    );
  }
  updateTvGameStackPlacement();

  // Add console groups to scene so they get scooped into purifierGroup by main.js
  scene.add(consoleProps);
  scene.add(tvGameStackProps);
  
  // Add to purifierGroup so it moves/rotates with the purifier
  function showConsoleProps(show){
    consoleProps.visible=show;
    tvGameStackProps.visible=show;
    updateTvGameStackPlacement();
    _markShadowsDirty();
  }

  function _isObjectVisibleInWorld(obj){
    for(let n=obj;n;n=n.parent){
      if(n.visible===false) return false;
    }
    return true;
  }

  function _getWorldAabbFromObject(obj,padXZ=0){
    if(!obj || !_isObjectVisibleInWorld(obj)) return null;
    obj.updateWorldMatrix(true,true);
    _consoleCollisionWorldBox.setFromObject(obj);
    if(_consoleCollisionWorldBox.isEmpty()) return null;
    _consoleCollisionMin.copy(_consoleCollisionWorldBox.min);
    _consoleCollisionMax.copy(_consoleCollisionWorldBox.max);
    return {
      xMin:_consoleCollisionMin.x-padXZ,
      xMax:_consoleCollisionMax.x+padXZ,
      zMin:_consoleCollisionMin.z-padXZ,
      zMax:_consoleCollisionMax.z+padXZ,
      yTop:_consoleCollisionMax.y,
      yBottom:_consoleCollisionMin.y
    };
  }

  function getConsoleCollisionBoxes(){
    const boxes=[];
    const xboxBox=_getWorldAabbFromObject(_consoleXboxMesh,0.12);
    if(xboxBox) boxes.push(xboxBox);
    const switchBox=_getWorldAabbFromObject(_consoleSwitchGroup,0.1);
    if(switchBox) boxes.push(switchBox);
    const gameStackBox=_getWorldAabbFromObject(tvGameStackProps,0.08);
    if(gameStackBox) boxes.push(gameStackBox);
    return boxes;
  }
  
  // ─── Wall-mount bracket (shown in Wall placement mode) ───
  const wallBracketGroup=new THREE.Group();
  wallBracketGroup.visible=false;
  {
    const bkMat=stdMat({color:0x303035, roughness:0.35, metalness:0.85});
    const bkThick=0.25; // steel plate thickness
    const bkWidth=2.0; // bracket strap width
    const standoff=5; // 5" from purifier back to wall
    const purifierSide=W/2+ply; // 3.22" from center to narrow side
    const fullArmLen=purifierSide*2+standoff; // extends from far edge of purifier to wall
    const armLen=fullArmLen;
    const plateH=7; // vertical wall plate height
    const bkSpacing=8; // distance from center for each bracket (along purifier length = Z)
  
    for(const sz of [-1,1]){
      const bz=sz*bkSpacing; // spaced along purifier length (local Z)
      const bkBottom=-(H/2+ply); // bottom of purifier box
  
      // Horizontal arm — extends in +X from far edge of purifier to wall
      // (+X becomes -Z = toward wall when purifierGroup rotates 90° on Y)
      const arm=new THREE.Mesh(
        new THREE.BoxGeometry(armLen, bkThick, bkWidth),
        bkMat
      );
      arm.position.set(-purifierSide+armLen/2, bkBottom-bkThick/2, bz);
      arm.castShadow=true; arm.receiveShadow=true;
      wallBracketGroup.add(arm);
  
      // Vertical wall plate — at wall end (+X), extends upward
      const wallEndX=purifierSide+standoff;
      const plate=new THREE.Mesh(
        new THREE.BoxGeometry(bkThick, plateH, bkWidth),
        bkMat
      );
      plate.position.set(wallEndX-bkThick/2, bkBottom+plateH/2, bz);
      plate.castShadow=true; plate.receiveShadow=true;
      wallBracketGroup.add(plate);
  
      // Diagonal brace — angled support from arm to plate
      const braceLen=Math.sqrt(standoff*standoff + (plateH*0.6)*(plateH*0.6));
      const braceAngle=Math.atan2(plateH*0.6, standoff);
      const brace=new THREE.Mesh(
        new THREE.BoxGeometry(braceLen, bkThick, bkWidth*0.6),
        bkMat
      );
      brace.position.set(purifierSide+standoff/2, bkBottom+plateH*0.3, bz);
      brace.rotation.z=braceAngle;
      brace.castShadow=true;
      wallBracketGroup.add(brace);
    }
  }
  scene.add(wallBracketGroup);
  function showWallBracket(show){
    wallBracketGroup.visible=show;
  }

  // ─── Per-frame update function ────────────────────────────────────
  const SPIN_MAX = 0.25;
  let fanSpeedPct = 50;
  let spinning = true;
  let spinTarget = SPIN_MAX * (fanSpeedPct / 100);

  let _rgbTime = 0;
  const _rgbColor = new THREE.Color();
  let currentRGB = 'rainbow'; // 'rainbow', 'custom', 'off'
  let _lastRgbUpdateTs = 0;
  const _RGB_UPDATE_INTERVAL = 1000 / 15; // throttle RGB to ~15 Hz

  // Pre-cache axis keys for rotors (avoid per-frame string/vector checks)
  function _cacheRotorAxisKeys() {
    for (const rotor of allRotors) {
      if (rotor.userData._axisKeyCached) continue;
      const av = rotor.userData.axis;
      let axisKey = 'z';
      if (av && av.isVector3) {
        if (Math.abs(av.y) > Math.abs(av.x) && Math.abs(av.y) > Math.abs(av.z)) axisKey = 'y';
        else if (Math.abs(av.x) > Math.abs(av.z)) axisKey = 'x';
      } else if (typeof av === 'string') {
        axisKey = av;
      }
      rotor.userData._axisKey = axisKey;
      rotor.userData._axisKeyCached = true;
    }
  }
  _cacheRotorAxisKeys();

  function update(dtSec, animFrameScale, gameMode) {
    // Fan rotor spinning
    const globalTarget = spinning ? SPIN_MAX * (fanSpeedPct / 100) : 0;
    const aFan = 1 - Math.exp(-1.83 * dtSec);
    for (const rotor of allRotors) {
      if (!isAncestorVisible(rotor)) continue;
      const target = rotor.userData.spinning ? globalTarget : 0;
      rotor.userData.spinSpeed += (target - rotor.userData.spinSpeed) * aFan;
      const spd = rotor.userData.spinSpeed;
      if (Math.abs(spd) > 0.0001) {
        rotor.rotation[rotor.userData._axisKey || 'z'] += spd * animFrameScale;
      }
    }

    // RGB rainbow cycling — throttled and skipped in game mode
    _rgbTime += dtSec;
    if (fansRGB && currentRGB === 'rainbow' && !gameMode) {
      const now = performance.now();
      if (now - _lastRgbUpdateTs >= _RGB_UPDATE_INTERVAL) {
        _lastRgbUpdateTs = now;
        const breathe = Math.sin(_rgbTime * 1.2) * 0.5 + 0.5;
        const hueBase = _rgbTime * 0.06 + breathe * 0.1;
        let visibleFanIdx = 0;
        for (let i = 0; i < allBladeMatsPerFan.length; i++) {
          const rotor = allRotors[i];
          if (rotor && !isAncestorVisible(rotor)) continue;
          const blades = allBladeMatsPerFan[i];
          const fanHueOffset = visibleFanIdx * 0.12;
          for (let j = 0; j < blades.length; j++) {
            const bladeHue = (hueBase + fanHueOffset + j * 0.08) % 1;
            _rgbColor.setHSL(bladeHue, 0.9, 0.55);
            blades[j].emissive.copy(_rgbColor);
            blades[j].emissiveIntensity = 0.6 + breathe * 0.3;
          }
          visibleFanIdx++;
        }
      }
    }

    // Explode lerp
    if (explodeLerping) {
      const aExplode = 1 - Math.exp(-6.32 * dtSec);
      let allDone = true;
      for (const k in explodeV) {
        if (!parts[k]) continue;
        parts[k].position.lerp(targets[k], aExplode);
        if (parts[k].position.distanceToSquared(targets[k]) > 0.001) allDone = false;
      }
      if (allDone) explodeLerping = false;
    }

    // Filter slide lerp
    if (_filterLerps.length > 0) {
      const aFilter = 1 - Math.exp(-7.67 * dtSec);
      for (let i = _filterLerps.length - 1; i >= 0; i--) {
        const fl = _filterLerps[i];
        fl.obj.position.lerp(fl.target, aFilter);
        if (fl.obj.position.distanceToSquared(fl.target) < 0.001) {
          fl.obj.position.copy(fl.target);
          _filterLerps.splice(i, 1);
        }
      }
    }

    // Drawer slide lerp
    if (_drawerLerps.length > 0) {
      const aDrawer = 1 - Math.exp(-9.76 * dtSec);
      for (let i = _drawerLerps.length - 1; i >= 0; i--) {
        const dl = _drawerLerps[i];
        dl.obj.matrixAutoUpdate = true;
        dl.obj.position.z += (dl.targetZ - dl.obj.position.z) * aDrawer;
        dl.obj.updateMatrixWorld(true);
        if (Math.abs(dl.obj.position.z - dl.targetZ) < 0.01) {
          dl.obj.position.z = dl.targetZ;
          _drawerLerps.splice(i, 1);
        }
      }
    }

    // Bifold door lerp
    if (_bifoldLerps.length > 0) {
      const aBifold = 1 - Math.exp(-9.76 * dtSec);
      for (let i = _bifoldLerps.length - 1; i >= 0; i--) {
        const bl = _bifoldLerps[i];
        const leaf = bl.leaf;
        leaf._leafAngle += (leaf._leafTarget - leaf._leafAngle) * aBifold;
        const sign = leaf._leafSide < 0 ? 1 : -1;
        leaf.rotation.y = sign * leaf._leafAngle;
        if (leaf._innerGroup) leaf._innerGroup.rotation.y = -2 * sign * leaf._leafAngle;
        if (Math.abs(leaf._leafAngle - leaf._leafTarget) < 0.005) {
          leaf._leafAngle = leaf._leafTarget;
          leaf.rotation.y = sign * leaf._leafAngle;
          if (leaf._innerGroup) leaf._innerGroup.rotation.y = -2 * sign * leaf._leafAngle;
          _bifoldLerps.splice(i, 1);
        }
      }
    }

    // Bypass sliding door lerp
    if (_bypassLerps.length > 0) {
      const aBypass = 1 - Math.exp(-7.0 * dtSec);
      for (let i = _bypassLerps.length - 1; i >= 0; i--) {
        const bl = _bypassLerps[i];
        const panel = bl.panel;
        panel.matrixAutoUpdate = true;
        panel.position.z += (panel._slideTarget - panel.position.z) * aBypass;
        if (Math.abs(panel.position.z - panel._slideTarget) < 0.01) {
          panel.position.z = panel._slideTarget;
          _bypassLerps.splice(i, 1);
        }
      }
    }

    // Window pane slide lerp
    if (_windowLerps.length > 0) {
      const aWin = 1 - Math.exp(-8.0 * dtSec);
      for (let i = _windowLerps.length - 1; i >= 0; i--) {
        const wl = _windowLerps[i];
        const wm = wl.group.userData.windowModel;
        const pane = wm.lowerPane;
        pane.position.y += (wm._slideTarget - pane.position.y) * aWin;
        if (Math.abs(pane.position.y - wm._slideTarget) < 0.02) {
          pane.position.y = wm._slideTarget;
          _windowLerps.splice(i, 1);
        }
      }
    }
  }

  // ─── Fan color & RGB functions ──────────────────────────────────
  function applyBladeStyle() {
    const c = fansWhite ? FAN_WHITE : FAN_BLACK;
    for (const blades of allBladeMatsPerFan) {
      for (const blade of blades) {
        if (fansRGB) {
          blade.color.setHex(BLADE_FROSTED.color);
          blade.transparent = false; blade.opacity = 1.0;
          blade.shininess = BLADE_FROSTED.shininess; blade.depthWrite = true;
        } else {
          blade.color.setHex(c.blade);
          blade.transparent = false; blade.opacity = 1.0;
          blade.shininess = 20; blade.depthWrite = true;
        }
        blade.needsUpdate = true;
      }
    }
  }
  function applyFanColorTheme() {
    const c = fansWhite ? FAN_WHITE : FAN_BLACK;
    for (let i = 0; i < allFanMats.length; i += 4) {
      allFanMats[i].color.setHex(c.frame);
      allFanMats[i + 1].color.setHex(c.hub);
      allFanMats[i + 2].color.setHex(c.cap);
    }
    for (const m of allBraceMats) m.color.setHex(c.frame);
    applyBladeStyle();
  }
  function setFanColor(mode) {
    fansWhite = (mode === 'white');
    applyFanColorTheme();
  }
  function toggleFanRGB() {
    fansRGB = !fansRGB;
    if (fansRGB) currentRGB = 'rainbow';
    applyBladeStyle();
    // Clear emissive when turning off
    if (!fansRGB) {
      for (const blades of allBladeMatsPerFan) {
        for (const blade of blades) {
          blade.emissive.setHex(0x000000);
          blade.emissiveIntensity = 0;
        }
      }
    }
  }

  // Set room refs for click interactions (called by main.js after room is built)
  function setRoomRefs(refs) {
    if (refs.lampLight) _roomLampLight = refs.lampLight;
    if (refs.lampShade) _roomLampShade = refs.lampShade;
    if (refs.lampBulb) _roomLampBulb = refs.lampBulb;
    if (refs.ceilSpot) _roomCeilSpot = refs.ceilSpot;
    if (refs.domeMat) _roomDomeMat = refs.domeMat;
    if (refs.ceilGlow) _roomCeilGlow = refs.ceilGlow;
    if (refs.todRefs) _todRefs = refs.todRefs;
    if (refs.outdoor && refs.outdoor.material) _roomOutdoorMat = refs.outdoor.material;
    if (refs.outdoorDayTex) _roomOutdoorDayTex = refs.outdoorDayTex;
    if (refs.outdoorNightTex) _roomOutdoorNightTex = refs.outdoorNightTex;
    if (refs.windowIsNight !== undefined) _windowIsNight = refs.windowIsNight;
    if (refs.applyTimeOfDay) _applyTimeOfDay = refs.applyTimeOfDay;
    if (refs.markShadowsDirty) _markShadowsDirty = refs.markShadowsDirty;
    if (refs.toggleMacbook) _toggleMacbook = refs.toggleMacbook;
    if (refs.toggleTV) _toggleTV = refs.toggleTV;
    if (refs.toggleCornerDoor) _toggleCornerDoor = refs.toggleCornerDoor;
    if (refs.toggleGuestDoor) _toggleGuestDoor = refs.toggleGuestDoor;
    if (refs.toggleGuestDoor) _toggleGuestDoor = refs.toggleGuestDoor;
    if (refs.toggleFoodBowl) _toggleFoodBowl = refs.toggleFoodBowl;
    if (refs.getFoodBowlMesh) _getFoodBowlMesh = refs.getFoodBowlMesh;
  }

  // Apply initial wood species (ash) so panels start with correct texture
  applyCurrentStain();

  // Return purifier refs
  return {
    update,
    allRotors,
    parts, origins, targets,
    spinning,
    setSpinning(s) { spinning = s; spinTarget = s ? SPIN_MAX * (fanSpeedPct / 100) : 0; },
    setFanSpeed(pct) { fanSpeedPct = pct; if (spinning) spinTarget = SPIN_MAX * (pct / 100); },
    toggleExplode,
    collapseView,
    toggleFilter,
    isFilterOn() { return filterOn; },
    areFiltersSlid() { return { left: filterLOut, right: filterROut }; },
    resetWorld(roomRefs) {
      // Snap all run-affecting moving parts back to their default closed state.
      // Used when entering / resetting a run so the world is reproducible.

      // Filters: slid in and visible.
      _filterLerps.length = 0;
      filterL.position.copy(filterLOrigin);
      filterR.position.copy(filterROrigin);
      filterLOut = false;
      filterROut = false;
      if (!filterOn) {
        filterOn = true;
        parts.filterL.visible = true;
        parts.filterR.visible = true;
        const el = _el('togFilter');
        if (el) el.classList.toggle('on', filterOn);
      }

      // Drawers: snap fully closed.
      _drawerLerps.length = 0;
      const drawers = roomRefs && roomRefs.drawers;
      if (drawers && drawers.length) {
        for (const grp of drawers) {
          if (!grp) continue;
          if (typeof grp._drawerBaseZ === 'number') {
            grp.matrixAutoUpdate = true;
            grp.position.z = grp._drawerBaseZ;
            grp.updateMatrixWorld(true);
          }
          grp._drawerSlide = 0;
          grp._drawerOpen = false;
        }
      }

      // Bifold closet leaves: snap fully closed (angle=0).
      _bifoldLerps.length = 0;
      const leaves = (typeof window !== 'undefined') ? window._bifoldLeavesRef : null;
      if (leaves && leaves.length) {
        for (const leaf of leaves) {
          if (!leaf) continue;
          leaf._leafAngle = 0;
          leaf._leafTarget = 0;
          leaf._leafOpen = false;
          leaf.rotation.y = 0;
          if (leaf._innerGroup) leaf._innerGroup.rotation.y = 0;
        }
      }

      // Bypass sliding doors: snap fully closed.
      _bypassLerps.length = 0;
      const bypassDoors = (typeof window !== 'undefined') ? window._bypassDoorsRef : null;
      if (bypassDoors && bypassDoors.length) {
        for (const panel of bypassDoors) {
          if (!panel) continue;
          panel.position.z = panel._baseZ;
          panel._slideTarget = panel._baseZ;
          panel._slideOpen = false;
          panel.matrixAutoUpdate = true;
          panel.updateMatrixWorld(true);
        }
      }

      // Office window: snap closed.
      _windowLerps.length = 0;
      if (roomRefs && roomRefs.setOfficeWindowOpen) {
        roomRefs.setOfficeWindowOpen(false);
        const wm = roomRefs.getOfficeWindowModel && roomRefs.getOfficeWindowModel();
        if (wm && wm.userData && wm.userData.windowModel) {
          const wd = wm.userData.windowModel;
          wd._isOpen = false;
          wd.lowerPane.position.y = wd.lowerPane._baseY;
          wd._slideTarget = wd.lowerPane._baseY;
        }
      }
    },
    toggleGrills,
    setGrillColor,
    setStain,
    setEdgeProfile,
    setLayout,
    setFanCount,
    setFeetStyle,
    setFootDiameter,
    setFootHeight,
    setFeetAngled,
    toggleDimensions,
    toggleXray,
    isXrayOn,
    setFanColor,
    toggleFanRGB,
    showWallBracket,
    showConsoleProps,
    getConsoleCollisionBoxes,
    setRoomRefs,
  };
}
