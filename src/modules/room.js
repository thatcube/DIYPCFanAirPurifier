// ─── Room construction (bridge) ─────────────────────────────────────
// This module will eventually contain all room geometry construction.
// For now it exports a createRoom() that returns placeholder refs.
// The actual construction code remains in index.html during migration.
//
// When the migration is complete, the full room construction will
// live here and index.html will be deleted.

import * as THREE from 'three';
import { state } from './state.js';
import { stdMat } from './materials.js';
import {
  LEFT_WALL_X, SIDE_WALL_X, OPP_WALL_Z, BACK_WALL_Z,
  WALL_HEIGHT, BED_X, BED_Z, BED_L, BED_W, BED_H,
  BED_CLEARANCE, BED_SLATS_FROM_FLOOR,
  TBL_X, TBL_Z, TBL_W, TBL_D, TBL_H,
  CEIL_LIGHT_X, CEIL_LIGHT_Z,
  CLOSET_W, CLOSET_H, CLOSET_DEPTH, CLOSET_INTERIOR_W, CLOSET_Z,
  WIN_W, WIN_H, WIN_CENTER_Z,
  getFloorY, getCeilingY, getWinCenterY
} from './spatial.js';

/**
 * Room construction output — references to meshes/materials that
 * other modules need (lighting, collision, game mode, etc.).
 */
export class RoomRefs {
  constructor() {
    // Walls
    this.wallMeshL = null;
    this.returnWallL = null;
    this.oppWall = null;
    this.rightWall = null;
    this.leftWallBelow = null;
    this.leftWallAbove = null;
    this.leftWallFront = null;
    this.leftWallBack = null;

    // Baseboards
    this.baseboardMeshL = null;
    this.baseboardRetL = null;
    this.oppBaseboard = null;
    this.sideBaseboard1 = null;
    this.sideBaseboard2 = null;
    this.leftBaseboard = null;
    this.recessWallL = null;
    this.recessWallR = null;
    this.baseboardRecessL = null;
    this.baseboardRecessR = null;

    // Floor + ceiling
    this.floor = null;
    this.floorMat = null;
    this.ceiling = null;

    // Outdoor backdrop
    this.outdoor = null;
    this.outdoorMat = null;

    // Ceiling light
    this.ceilY = 0;
    this.domeMat = null;

    // Bed
    this.mattY = 0;
    this.mattH = 0;
    this.mattW = 0;
    this.mattL = 0;
    this.mattCenterZ = 0;
    this.duvetH = 0;
    this.headboard = null;
    this.footboard = null;

    // Nightstand + lamp
    this.lampLight = null;
    this.lampShade = null;
    this.lampBulb = null;
    this.lampOn = true;

    // TV
    this.tvCenterX = 0;
    this.tvCenterY = 0;
    this.tvZ = 0;
    this.tvW = 0;
    this.tvH = 0;
    this.tvD = 0;

    // Drawers
    this.drawers = [];

    // Closet
    this.bifoldLeaves = [];

    // Fading walls list
    this.fadingWalls = [];

    // Window
    this.winCenterY = 0;
    this.winCenterZ = 0;
    this.winTop = 0;
    this.winBottom = 0;
    this.winFront = 0;
    this.winBack = 0;
    this.mirroredWindowX = 0;

    // Night textures
    this.nightOutdoorTex = null;
    this.dayOutdoorTex = null;
    this.windowIsNight = false;

    // Misc
    this.sceneFloor = null;
    this.consoleProps = null;
    this.tvGameStackProps = null;
    this.wallBracketGroup = null;
  }
}

/**
 * Create the complete room environment.
 * Returns a RoomRefs object with all mesh references.
 *
 * During migration, this is a stub. The actual room construction
 * remains in index.html. Once fully migrated, this function will
 * contain all the mesh creation code.
 */
export function createRoom(scene) {
  const refs = new RoomRefs();
  // Stub — actual construction will be migrated from index.html
  console.log('[room] createRoom stub — room construction pending migration');
  return refs;
}
