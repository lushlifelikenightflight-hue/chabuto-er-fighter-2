/** Data-only visual effect descriptors for combat feedback. */

const DESCRIPTOR_DEFAULTS = Object.freeze({
  durationFrames: 8,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  layer: "fighters",
  blend: "alpha",
  palette: Object.freeze(["#fff5c7", "#ffb347"]),
  tags: Object.freeze([]),
});

function descriptor(id, category, values = {}) {
  return Object.freeze({
    ...DESCRIPTOR_DEFAULTS,
    id,
    category,
    ...values,
    tags: Object.freeze(values.tags ? [...values.tags] : [...DESCRIPTOR_DEFAULTS.tags]),
    palette: Object.freeze(values.palette ? [...values.palette] : [...DESCRIPTOR_DEFAULTS.palette]),
  });
}

const CORE_EFFECTS = Object.freeze({
  "attack-wind": descriptor("attack-wind", "attack", { durationFrames: 12, scale: 0.62, offsetX: 48, offsetY: 78, tags: ["attack", "wind", "trail"] }),
  "hit-burst": descriptor("hit-burst", "hit", { durationFrames: 8, scale: 0.38, offsetX: 0, offsetY: 0, palette: ["#ffffff", "#ffd84d", "#f06b32"], tags: ["hit", "impact", "burst"] }),
  "attack-light": descriptor("attack-light", "attack", { durationFrames: 5, scale: 0.92, offsetX: 28, offsetY: 82, tags: ["attack", "light", "trail"] }),
  "attack-heavy": descriptor("attack-heavy", "attack", { durationFrames: 9, scale: 1.16, offsetX: 42, offsetY: 79, palette: ["#fff6d5", "#f38b5d", "#d83957"], tags: ["attack", "heavy", "trail"] }),
  "attack-kick": descriptor("attack-kick", "attack", { durationFrames: 8, scale: 1.1, offsetX: 46, offsetY: 95, palette: ["#fff5c7", "#8fc9ff", "#df6cf2"], tags: ["attack", "kick", "trail"] }),
  "attack-weapon": descriptor("attack-weapon", "attack", { durationFrames: 10, scale: 1.22, offsetX: 54, offsetY: 78, palette: ["#fff4bd", "#c6e7ff", "#9e8cff"], tags: ["attack", "weapon", "afterimage"] }),
  "attack-slime": descriptor("attack-slime", "attack", { durationFrames: 8, scale: 1.08, offsetX: 52, offsetY: 82, palette: ["#f5ffb1", "#7ee787", "#53c6b0"], tags: ["attack", "slime", "splash"] }),
  "attack-special": descriptor("attack-special", "special", { durationFrames: 18, scale: 1.52, offsetX: 64, offsetY: 84, layer: "foreground", palette: ["#fff8dc", "#ffdc71", "#ff6f61"], tags: ["attack", "special", "telegraph"] }),
  "super-explosion": descriptor("super-explosion", "special", { durationFrames: 24, scale: 2.8, offsetX: 0, offsetY: 0, layer: "foreground", palette: ["#ffffff", "#ffe14f", "#ff6a22"], tags: ["attack", "special", "explosion", "impact"] }),
  "hit-spark": descriptor("hit-spark", "hit", { durationFrames: 7, scale: 0.86, offsetX: 0, offsetY: -4, palette: ["#ffffff", "#ffe37b", "#ec6c51"], tags: ["hit", "spark"] }),
  "guard-spark": descriptor("guard-spark", "guard", { durationFrames: 6, scale: 0.82, offsetX: 0, offsetY: -2, palette: ["#d8efff", "#72b9ff", "#5782ce"], tags: ["guard", "spark"] }),
  "just-guard-ring": descriptor("just-guard-ring", "justGuard", { durationFrames: 10, scale: 1.12, offsetX: 0, offsetY: -6, palette: ["#ffffff", "#7be8ff", "#d6a2ff"], tags: ["guard", "justGuard", "ring"] }),
  "throw-impact": descriptor("throw-impact", "throw", { durationFrames: 14, scale: 1.04, offsetX: 0, offsetY: 100, layer: "ground", palette: ["#fff9e6", "#f7b84b", "#d9684d"], tags: ["throw", "impact", "ground"] }),
  "down-impact": descriptor("down-impact", "down", { durationFrames: 16, scale: 1.18, offsetX: 0, offsetY: 114, layer: "ground", palette: ["#f5f5f5", "#a8d8ff", "#7589c9"], tags: ["down", "impact", "ground"] }),
  "skill-copy": descriptor("skill-copy", "skill", { durationFrames: 20, scale: 1.12, palette: ["#fff4b8", "#c77dff", "#6dd5fa"], tags: ["skill", "copy"] }),
  "skill-slime-shot": descriptor("skill-slime-shot", "skill", { durationFrames: 18, scale: 1.26, palette: ["#f4ffb0", "#66e69a", "#4bb9a5"], tags: ["skill", "slime", "projectile"] }),
  "skill-mirror": descriptor("skill-mirror", "skill", { durationFrames: 12, scale: 1.06, palette: ["#ffffff", "#b9e9ff", "#9d8cff"], tags: ["skill", "mirror", "reflect"] }),
  "skill-tackle": descriptor("skill-tackle", "skill", { durationFrames: 14, scale: 1.32, palette: ["#fff3cd", "#ff9e62", "#d84b5a"], tags: ["skill", "tackle", "charge"] }),
  "skill-dog-summon": descriptor("skill-dog-summon", "skill", { durationFrames: 24, scale: 1.7, offsetY: -18, layer: "foreground", palette: ["#ffffff", "#e8f1ff", "#b5c8e8"], tags: ["skill", "summon", "dog", "drop"] }),
  "skill-ramen": descriptor("skill-ramen", "skill", { durationFrames: 20, scale: 1.14, palette: ["#fff4bb", "#f3a55f", "#df6c67"], tags: ["skill", "buff", "ramen"] }),
  "skill-drum-beat": descriptor("skill-drum-beat", "skill", { durationFrames: 12, scale: 1.02, palette: ["#fff6d3", "#ee8dff", "#88a6ff"], tags: ["skill", "drum", "marker"] }),
  "skill-flash": descriptor("skill-flash", "skill", { durationFrames: 9, scale: 1.4, offsetX: 48, offsetY: 78, layer: "foreground", palette: ["#ffffff", "#ecf7ff", "#d0e9ff"], tags: ["skill", "flash", "stun"] }),
});

const SPECIAL_ARCHETYPES = ["rush", "time", "ground", "projectile", "dive", "antiAir", "commandThrow", "delayed"];
const CHARACTER_SPECIAL_EFFECTS = Object.fromEntries(SPECIAL_ARCHETYPES.map((name, index) => [
  `special-${name}`,
  descriptor(`special-${name}`, "special", {
    ...CORE_EFFECTS["attack-special"],
    id: `special-${name}`,
    scale: 1.42 + (index % 4) * 0.09,
    tags: ["attack", "special", name],
  }),
]));

const CHARACTER_ATTACK_EFFECTS = Object.fromEntries(SPECIAL_ARCHETYPES.flatMap((name, index) => [
  [`attack-light-${name}`, descriptor(`attack-light-${name}`, "attack", { ...CORE_EFFECTS["attack-light"], id: `attack-light-${name}`, scale: 0.88 + (index % 3) * 0.05, tags: ["attack", "light", name] })],
  [`attack-heavy-${name}`, descriptor(`attack-heavy-${name}`, "attack", { ...CORE_EFFECTS["attack-heavy"], id: `attack-heavy-${name}`, scale: 1.1 + (index % 4) * 0.06, tags: ["attack", "heavy", name] })],
  [`attack-kick-${name}`, descriptor(`attack-kick-${name}`, "attack", { ...CORE_EFFECTS["attack-kick"], id: `attack-kick-${name}`, scale: 1.02 + (index % 3) * 0.07, tags: ["attack", "kick", name] })],
]));

const SEMANTIC_ALIASES = Object.freeze({
  lightAttack: "attack-light",
  heavyAttack: "attack-heavy",
  weaponAttack: "attack-weapon",
  slimeAttack: "attack-slime",
  specialAttack: "attack-special",
  hitSpark: "hit-spark",
  guardSpark: "guard-spark",
  justGuard: "just-guard-ring",
  justGuardRing: "just-guard-ring",
  throwImpact: "throw-impact",
  downImpact: "down-impact",
});
const ALIAS_EFFECTS = Object.fromEntries(Object.entries(SEMANTIC_ALIASES).map(([alias, source]) => [
  alias,
  descriptor(alias, CORE_EFFECTS[source]?.category || "combat", { ...CORE_EFFECTS[source], id: alias }),
]));

export const EFFECT_REGISTRY = Object.freeze({
  ...CORE_EFFECTS,
  ...CHARACTER_SPECIAL_EFFECTS,
  ...CHARACTER_ATTACK_EFFECTS,
  ...ALIAS_EFFECTS,
});

// Explicit aliases make the registry convenient for renderers and tests that
// use either the long semantic names or the compact ids.
export const VFX_EFFECT_REGISTRY = EFFECT_REGISTRY;
export const VFX_REGISTRY = EFFECT_REGISTRY;
export const REQUIRED_EFFECT_IDS = Object.freeze(Object.keys(EFFECT_REGISTRY));

export function getEffectDescriptor(effectId) {
  return EFFECT_REGISTRY[effectId] || null;
}

export function effectForMove(move = {}) {
  const descriptorValue = getEffectDescriptor(move.effectId) || getEffectDescriptor(move.kind === "special" ? "attack-special" : "attack-light");
  if (!descriptorValue) return null;
  return Object.freeze({
    ...descriptorValue,
    scale: Number.isFinite(move.effectScale) ? move.effectScale : descriptorValue.scale,
    offsetX: Number.isFinite(move.effectOffsetX) ? move.effectOffsetX : descriptorValue.offsetX,
    offsetY: Number.isFinite(move.effectOffsetY) ? move.effectOffsetY : descriptorValue.offsetY,
  });
}

export const effectDescriptorForMove = effectForMove;
