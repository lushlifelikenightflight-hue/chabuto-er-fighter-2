export const EXPANDED_FIGHTER_IDS = Object.freeze([
  "guitar-boy", "green-slime", "bob-girl", "uncle",
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
});

const GROUPS = Object.freeze({
  idle: ["idle", 1, 4, 10, true],
  walk_forward: ["movement", 1, 3, 5, true],
  walk_backward: ["movement", 4, 3, 6, true],
  dash: ["movement", 7, 3, 3, false],
  backstep: ["movement", 10, 3, 4, false],
  crouch_start: ["crouch", 1, 2, 4, false],
  crouch_idle: ["crouch", 3, 2, 10, true],
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
  return Object.freeze(Object.fromEntries(REQUIRED_ANIMATION_CLIPS.map((name) => {
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
  })));
}
