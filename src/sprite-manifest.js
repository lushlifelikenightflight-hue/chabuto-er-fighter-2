import { SKILL_CONFIGS } from "./skills.js";

export const EXPANDED_FIGHTER_IDS = Object.freeze([
  "guitar-boy", "green-slime", "bob-girl", "uncle",
  "rusty", "kazushige", "norio", "toko",
]);

export const REQUIRED_ANIMATION_CLIPS = Object.freeze([
  "idle", "walk_forward", "walk_backward", "dash", "backstep",
  "crouch_start", "crouch_idle", "crouch_end",
  "jump_start", "jump_rise", "jump_apex", "jump_fall", "landing", "double_jump",
  "light_stand", "light_crouch", "light_air",
  "heavy_stand", "heavy_crouch", "heavy_air",
  "guard_high", "guard_low", "just_guard",
  "throw_start", "throw_success", "throw_miss", "thrown", "throw_break",
  "special_start", "special_active", "special_recovery",
  "hit_light", "hit_heavy", "hit_crouch", "air_hit", "knockback", "knockdown", "down_idle", "wakeup",
  "victory", "defeat",
]);

export const RUNTIME_ANIMATION_ALIASES = Object.freeze({
  crouch: "crouch_idle",
  jump_up: "jump_rise",
  light_attack_neutral: "light_stand",
  light_attack_crouch: "light_crouch",
  light_attack_air: "light_air",
  strong_attack_neutral: "heavy_stand",
  strong_attack_crouch: "heavy_crouch",
  strong_attack_air: "heavy_air",
  throw_hit: "throw_success",
  // A few callers retain the authored damage-sheet frame labels. Keep those
  // labels pointed at the semantic down clips so damage-11..16 are rendered
  // instead of falling through to the idle sheet.
  damage11: "knockdown",
  damage12: "knockdown",
  damage13: "down_idle",
  damage14: "down_idle",
  damage15: "wakeup",
  damage16: "wakeup",
  "damage-11": "knockdown",
  "damage-12": "knockdown",
  "damage-13": "down_idle",
  "damage-14": "down_idle",
  "damage-15": "wakeup",
  "damage-16": "wakeup",
});

// Skill artwork is authored as one six-frame body sheet for each fighter.
// Skill phase names remain data-owned by `skills.js`; this small bridge keeps
// those public action ids resolvable by the runtime loader without inflating
// the canonical 41-clip fighter manifest.
export const SKILL_BODY_FRAME_COUNT = 6;
export const SKILL_BODY_FRAME_DURATION = 4;

export const SKILL_SPRITE_ACTIONS = Object.freeze(Object.fromEntries(
  Object.entries(SKILL_CONFIGS).map(([id, config]) => [id, Object.freeze([...(config.spriteActions || [])])]),
));

export function getSkillAnimationClip(id, actionName) {
  const actions = SKILL_SPRITE_ACTIONS[id];
  if (!actions || !actions.includes(actionName)) return null;
  return Object.freeze({
    name: actionName,
    group: "skill_body",
    frames: Object.freeze(Array.from({ length: SKILL_BODY_FRAME_COUNT }, (_, index) => `assets/sprites/${id}/actions/skill_body/skill_body-${index + 1}.png`)),
    frameDuration: SKILL_BODY_FRAME_DURATION,
    loop: false,
    cellWidth: 256,
    cellHeight: 256,
    origin: Object.freeze({ x: 128, y: 233 }),
    groundPoint: Object.freeze({ x: 128, y: 233 }),
  });
}

const EFFECT_ASSET_DEFINITIONS = Object.freeze({
  "attack-wind": ["assets/effects/attack-wind", "attack", 3, false],
  "hit-burst": ["assets/effects/hit-burst", "hit", 2, false],
  "attack-light": ["assets/effects/attack-light", "attack", 5, false],
  "attack-heavy": ["assets/effects/attack-heavy", "attack", 9, false],
  "attack-weapon": ["assets/effects/attack-weapon", "attack", 10, false],
  "attack-slime": ["assets/effects/attack-slime", "attack", 8, false],
  "hit-spark": ["assets/effects/hit-spark", "hit", 7, false],
  "guard-spark": ["assets/effects/guard-spark", "guard", 6, false],
  "just-guard-ring": ["assets/effects/just-guard-ring", "guard", 10, false],
  "throw-impact": ["assets/effects/throw-impact", "throw", 14, false],
  "down-impact": ["assets/effects/down-impact", "down", 16, false],
  "super-explosion": ["assets/effects/super-explosion", "special", 4, false],
  "skill-copy": ["assets/effects/skills/guitar-boy/skill-copy", "skill", 20, false],
  "skill-slime-shot": ["assets/effects/skills/green-slime/skill-slime-shot", "skill", 18, false],
  "skill-mirror": ["assets/effects/skills/bob-girl/skill-mirror", "skill", 12, false],
  "skill-tackle": ["assets/effects/skills/uncle/skill-tackle", "skill", 14, false],
  "skill-ramen": ["assets/effects/skills/kazushige/skill-ramen", "skill", 20, false],
  "skill-drum-beat": ["assets/effects/skills/norio/skill-drum-beat", "skill", 12, false],
  "skill-flash": ["assets/effects/skills/toko/skill-flash", "skill", 9, false],
});

function effectFramePaths(basePath, id) {
  return Array.from({ length: 4 }, (_, index) => `${basePath}/${id}-${index + 1}.png`);
}

function effectManifestEntry(id, [basePath, category, frameDuration, loop]) {
  return Object.freeze({
    id,
    category,
    metadata: `${basePath}/${id}.json`,
    frames: Object.freeze(effectFramePaths(basePath, id)),
    frameDuration,
    loop,
    cellWidth: 256,
    cellHeight: 256,
    origin: Object.freeze({ x: 128, y: 128 }),
    groundPoint: Object.freeze({ x: 128, y: 128 }),
  });
}

const DOG_SUMMON_MANIFEST = Object.freeze({
  id: "skill-dog-summon",
  category: "skill",
  metadata: "assets/effects/skills/rusty/dog-drop/skill-dog-summon.json",
  frames: Object.freeze([
    "assets/effects/skills/rusty/dog-drop/dog-marker-1.png",
    "assets/effects/skills/rusty/dog-drop/dog-marker-2.png",
    "assets/effects/skills/rusty/dog-drop/dog-marker-3.png",
    "assets/effects/skills/rusty/dog-drop/dog-marker-4.png",
    "assets/effects/skills/rusty/dog-drop/dog-fall-1.png",
    "assets/effects/skills/rusty/dog-drop/dog-fall-2.png",
    "assets/effects/skills/rusty/dog-drop/dog-fall-3.png",
    "assets/effects/skills/rusty/dog-drop/dog-fall-4.png",
    "assets/effects/skills/rusty/dog-drop/dog-impact-1.png",
    "assets/effects/skills/rusty/dog-drop/dog-impact-2.png",
    "assets/effects/skills/rusty/dog-drop/dog-impact-3.png",
    "assets/effects/skills/rusty/dog-drop/dog-impact-4.png",
  ]),
  frameDuration: 24,
  loop: false,
  cellWidth: 256,
  cellHeight: 256,
  origin: Object.freeze({ x: 128, y: 128 }),
  groundPoint: Object.freeze({ x: 128, y: 128 }),
});

/** Runtime-ready, generated VFX assets. Paths are project-relative and stable. */
export const EFFECT_ASSET_MANIFEST = Object.freeze({
  ...Object.fromEntries(Object.entries(EFFECT_ASSET_DEFINITIONS).map(([id, definition]) => [id, effectManifestEntry(id, definition)])),
  "skill-dog-summon": DOG_SUMMON_MANIFEST,
});

/** Semantic aliases reuse the numbered frames above without duplicating files. */
export const EFFECT_ASSET_ALIASES = Object.freeze({
  combo: "attack-light",
  comboLight: "attack-light",
  comboHeavy: "attack-heavy",
  combo_light: "attack-light",
  combo_heavy: "attack-heavy",
  down: "down-impact",
  wakeup: "down-impact",
  guardDash: "attack-weapon",
  guard_dash: "attack-weapon",
  justGuardRecoil: "just-guard-ring",
  just_guard_recoil: "just-guard-ring",
  skillStartup: "skill-copy",
  skillCharging: "skill-copy",
  skillActive: "skill-slime-shot",
  skillRecovery: "skill-flash",
  skillUnavailable: "hit-spark",
});

export const REQUIRED_EFFECT_ASSET_IDS = Object.freeze(Object.keys(EFFECT_ASSET_MANIFEST));

export function getEffectAssetManifest(effectId) {
  const canonicalId = EFFECT_ASSET_ALIASES[effectId] || effectId;
  return EFFECT_ASSET_MANIFEST[canonicalId] || null;
}

const GROUPS = Object.freeze({
  idle: ["idle", 1, 4, 10, true],
  walk_forward: ["movement", 1, 3, 5, true],
  walk_backward: ["movement", 4, 3, 6, true],
  // Frames 11/12 are settled standing poses.  The two airborne strides at
  // 9/10 are the authored left/right leg phases used for held locomotion.
  dash: ["movement", 9, 2, 4, true],
  backstep: ["movement", 9, 2, 4, true],
  crouch_start: ["crouch", 1, 2, 4, false],
  // The held crouch pose is a settled keyframe, not a looping animation.
  // Keeping the clip non-looping lets the runtime clamp to one stable frame
  // while the down input remains held.
  crouch_idle: ["crouch", 3, 2, 10, false],
  crouch_end: ["crouch", 5, 2, 4, false],
  jump_start: ["jump", 1, 2, 4, false],
  jump_rise: ["jump", 3, 2, 5, true],
  jump_apex: ["jump", 5, 2, 5, true],
  jump_fall: ["jump", 7, 2, 5, true],
  landing: ["jump", 9, 2, 4, false],
  double_jump: ["jump", 11, 2, 4, false],
  light_stand: ["light_attacks", 1, 4, 4, false],
  light_crouch: ["light_attacks", 5, 4, 4, false],
  light_air: ["light_attacks", 9, 4, 4, false],
  heavy_stand: ["heavy_attacks", 1, 4, 7, false],
  heavy_crouch: ["heavy_attacks", 5, 4, 7, false],
  heavy_air: ["heavy_attacks", 9, 4, 7, false],
  guard_high: ["guard", 1, 2, 6, true],
  guard_low: ["guard", 3, 2, 6, true],
  just_guard: ["guard", 5, 2, 3, false],
  throw_start: ["throw", 1, 2, 4, false],
  throw_success: ["throw", 3, 2, 5, false],
  throw_miss: ["throw", 5, 2, 5, false],
  thrown: ["throw", 7, 2, 5, false],
  throw_break: ["throw", 9, 2, 4, false],
  special_start: ["special", 1, 3, 6, false],
  special_active: ["special", 4, 3, 4, false],
  special_recovery: ["special", 7, 3, 7, false],
  hit_light: ["damage", 1, 2, 5, false],
  hit_heavy: ["damage", 3, 2, 6, false],
  hit_crouch: ["damage", 5, 2, 5, false],
  air_hit: ["damage", 7, 2, 5, false],
  knockback: ["damage", 9, 2, 5, false],
  knockdown: ["damage", 11, 2, 8, false],
  down_idle: ["damage", 13, 2, 12, true],
  wakeup: ["damage", 15, 2, 8, false],
  victory: ["result", 1, 3, 10, true],
  defeat: ["result", 4, 3, 12, true],
});

function numberedFrames(id, group, start, count) {
  return Array.from({ length: count }, (_, index) =>
    `assets/sprites/${id}/actions/${group}/${group}-${start + index}.png`);
}

export function createExpandedAnimationManifest(id) {
  if (!EXPANDED_FIGHTER_IDS.includes(id)) return null;
  const clips = Object.fromEntries(REQUIRED_ANIMATION_CLIPS.map((name) => {
    const [group, start, count, frameDuration, loop] = GROUPS[name];
    return [name, Object.freeze({
      name,
      group,
      frames: Object.freeze(numberedFrames(id, group, start, count)),
      frameDuration,
      loop,
      cellWidth: 256,
      cellHeight: 256,
      origin: Object.freeze({ x: 128, y: 233 }),
      groundPoint: Object.freeze({ x: 128, y: 233 }),
    })];
  }));
  // Keep skill actions available through the normal character.animation
  // lookup while leaving the canonical clip enumeration/metadata contract
  // unchanged for existing tools.
  for (const action of SKILL_SPRITE_ACTIONS[id] || []) {
    Object.defineProperty(clips, action, { value: getSkillAnimationClip(id, action), enumerable: false });
  }
  return Object.freeze(clips);
}
