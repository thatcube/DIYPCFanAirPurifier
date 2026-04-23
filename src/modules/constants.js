// ─── Quality tiers + performance constants ──────────────────────────

// Shadow quality tiers (map size) — 4 tiers, mobile/desktop
export const QUALITY_SHADOW_TIERS_MOBILE  = [1024, 768, 512, 384];
export const QUALITY_SHADOW_TIERS_DESKTOP = [2048, 1536, 1024, 768];

// Particle count tiers
export const PARTICLE_TIER_COUNTS = [350, 280, 200, 140];

// Device pixel ratio cap tiers — raw caps, NOT pre-computed.
// Apply as Math.min(devicePixelRatio, cap) at usage time.
export const QUALITY_DPR_TIERS_MOBILE  = [0.72, 0.64, 0.56, 0.50];
export const QUALITY_DPR_TIERS_DESKTOP = [0.85, 0.74, 0.64, 0.55];

// Shadow throttle in play mode (~12 Hz)
export const SHADOW_UPDATE_INTERVAL_MS = 1000 / 12;

// Idle frame rate (non-game mode, no interaction)
export const IDLE_FRAME_MS = 1000 / 18;

// Raycast throttle in play mode (~10 Hz)
export const RAYCAST_INTERVAL_MS = 96;

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
  classic:   { label: 'Classic Cat',   sources: ['assets/cat.glb'],         colorable: true,  animSpeed: 0.85, idleLoopPause: 0,   sprintAnimMult: 1.0 },
  toon:      { label: 'Toon Cat',      sources: ['assets/tooncat.glb', 'assets/toon-cat.glb'], colorable: false, animSpeed: 0.85, idleLoopPause: 0,   sprintAnimMult: 2 },
  bababooey: { label: 'Bababooey Cat', sources: ['assets/bababooey_cat.glb'], colorable: false, animSpeed: 0.6, idleLoopPause: 2.2, sprintAnimMult: 1.4 }
};

// Secret coin total (for all-found check)
export const TOTAL_SECRETS = 9;
