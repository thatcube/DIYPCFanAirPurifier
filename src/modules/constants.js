// ─── Quality tiers + performance constants ──────────────────────────

// Shadow quality tiers (map size)
export const QUALITY_SHADOW_TIERS = [2048, 1024, 512];

// Particle count tiers
export const PARTICLE_TIER_COUNTS = [350, 280, 200, 140];

// Device pixel ratio tiers  
export const QUALITY_DPR_TIERS = [
  Math.min(window.devicePixelRatio, 0.85),
  Math.min(window.devicePixelRatio, 0.65),
  Math.min(window.devicePixelRatio, 0.5)
];

// Shadow throttle in play mode (~45 Hz)
export const SHADOW_UPDATE_INTERVAL_MS = 1000 / 45;

// Idle frame rate (non-game mode, no interaction)
export const IDLE_FRAME_MS = 1000 / 18;

// Raycast throttle in play mode
export const RAYCAST_INTERVAL_MS = 32;

// RGB LED base distance
export const RGB_BASE_DIST = 45;

// Fan blade count
export const BLADE_COUNT = 7;

// Fan blade frosted look
export const BLADE_FROSTED = { color: 0xffffff, opacity: 0.3, shininess: 5 };

// Color presets
export const DAY_CLEAR = 0xd4dce8;
export const NIGHT_CLEAR = 0x181820;
export const DAY_WALL = 0xd8d4ce;
export const NIGHT_WALL = 0x2a2a35;

// Cat color presets
export const CAT_COLOR_PRESETS = {
  charcoal: { coat: 0x0a0a12, tint: 0.99, coatMix: 0.96 },
  cream:    { coat: 0xB08030, tint: 0.98, coatMix: 0.9 },
  midnight: { coat: 0x040818, tint: 0.995, coatMix: 0.98 },
  snow:     { coat: 0xd8d8d8, tint: 0.98, coatMix: 0.9 }
};

// Cat hair presets
export const CAT_HAIR_PRESETS = {
  short: { sx: 1, sy: 1, sz: 1, rough: 0.9, furRim: 0.05, bump: 0.004, boneMode: 'short' },
  long:  { sx: 1, sy: 1, sz: 1, rough: 1.34, furRim: 1.0, bump: 0.11, boneMode: 'long' }
};

// Cat model presets
export const CAT_MODEL_PRESETS = {
  classic:   { label: 'Classic Cat',   sources: ['assets/cat.glb'],         colorable: true,  animSpeed: 1.0, idleLoopPause: 0,   groundPinOffset: 0.0,  sprintAnimMult: 1.0 },
  toon:      { label: 'Toon Cat',      sources: ['assets/tooncat.glb', 'assets/toon-cat.glb'], colorable: false, animSpeed: 1.0, idleLoopPause: 0,   groundPinOffset: -1.25, sprintAnimMult: 2,   gameModelZ: -1.2, gameGroundPinOffset: -2.1 },
  bababooey: { label: 'Bababooey Cat', sources: ['assets/bababooey_cat.glb'], colorable: false, animSpeed: 0.7, idleLoopPause: 2.2, groundPinOffset: 0.0,  sprintAnimMult: 1.4 }
};

// Secret coin total (for all-found check)
export const TOTAL_SECRETS = 8;
