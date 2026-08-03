import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { CHARACTER_IDS, CHARACTERS } from "../src/data.js";
import { createFighterState } from "../src/engine.js";
import { Game, SCREEN, animationNameFor, skillSpriteActionFor } from "../src/game.js";
import { getEffectAssetManifest, getSkillAnimationClip } from "../src/sprite-manifest.js";
import { getSkillConfig } from "../src/skills.js";

test("every fighter has six processed skill-body frames and mapped skill actions", () => {
  for (const id of CHARACTER_IDS) {
    for (let frame = 1; frame <= 6; frame += 1) {
      assert.equal(existsSync(`assets/sprites/${id}/actions/skill_body/skill_body-${frame}.png`), true, `${id} skill frame ${frame}`);
    }
    const action = getSkillConfig(id).spriteActions[0];
    const clip = getSkillAnimationClip(id, action);
    assert.equal(clip.frames.length, 6);
    assert.equal(CHARACTERS[id].animation[action].frames.length, 6);
    assert.match(clip.frames[5], new RegExp(`assets/sprites/${id}/actions/skill_body/skill_body-6\\.png$`));
    assert.equal(skillSpriteActionFor({ id, action: "skill_start", skillPhase: "skillStartup" }), action);
  }
  assert.equal(skillSpriteActionFor({ id: "toko", action: "skill_active", skillPhase: "skillActive" }), "skill_flash_fire");
});

test("grounded light variants use authored attack clips and down clips retain damage-sheet frames", () => {
  assert.equal(animationNameFor({ id: "guitar-boy", grounded: true, action: "light_left" }), "light_stand");
  assert.equal(animationNameFor({ id: "guitar-boy", grounded: true, action: "light_right" }), "light_stand");
  assert.equal(animationNameFor({ id: "guitar-boy", grounded: true, state: "crouching", crouching: true, action: "light_left" }), "light_crouch");
  const game = new Game(null);
  const loaded = game.loadSprite("guitar-boy", "knockdown", 8);
  assert.equal(game.images.has("assets/sprites/guitar-boy/actions/damage/damage-12.png"), true);
  game.loadSprite("guitar-boy", "damage16", 0);
  assert.equal(game.images.has("assets/sprites/guitar-boy/actions/damage/damage-15.png"), true);
  assert.ok(loaded === null || loaded);
});

test("generic VFX stays alive long enough to show every manifest frame", () => {
  const game = new Game(null);
  const manifest = getEffectAssetManifest("attack-light");
  const record = game.spawnVfx("attack-light", { x: 100, y: 0 });
  assert.equal(record.frames, manifest.frames.length * manifest.frameDuration);
  const duration = record.frames;
  for (let i = 0; i < duration - 1; i += 1) game.updateVfx();
  assert.equal(game.state.vfx.includes(record), true);
  game.updateVfx();
  assert.equal(game.state.vfx.includes(record), false);
});

test("training hitstun expiry clears a stale down latch", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1);
  fighter.state = "hitstun";
  fighter.action = "hit_light";
  fighter.stunFrames = 1;
  fighter.downed = true;
  fighter.downedFrames = 12;
  game.updateFighter(fighter, {}, true);
  assert.equal(fighter.state, "idle");
  assert.equal(fighter.downed, false);
  assert.equal(fighter.downedFrames, 0);
});

test("Toko flash is a moving zero-damage projectile with one guarded stun hit", () => {
  const game = new Game(null);
  const toko = createFighterState("toko", 100, 1);
  const target = createFighterState("guitar-boy", 260, -1);
  game.player = toko;
  game.cpu = target;
  game.activateSkill(toko, getSkillConfig("toko"));
  const shot = game.skillEntities.find((entry) => entry.type === "flash");
  assert.ok(shot);
  assert.equal(shot.damage, 0);
  assert.ok(shot.vx > 0);
  const startX = shot.x;
  game.updateSkillEntities();
  assert.ok(shot.x > startX);
  assert.equal(target.hp, target.maxHp);
  target.x = shot.x;
  game.updateSkillEntities();
  assert.equal(target.hp, target.maxHp);
  assert.equal(target.flashStunned, true);
  assert.equal(target.flashStunFrames, 180);
  assert.equal(game.skillEntities.some((entry) => entry.type === "flash"), false);
});

test("title/menu screen routing keeps the virtual pad interactive", () => {
  const source = readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(source, /touchBattleScreens = new Set\(\[SCREEN\.battle, SCREEN\.pause\]\)/);
  assert.match(source, /touchMode = touchBattleScreens\.has\(screen\) \? "battle" : "menu"/);
  const touch = readFileSync(new URL("../src/touch-input.js", import.meta.url), "utf8");
  assert.match(touch, /menu: "menu"/);
  assert.match(touch, /button\.addEventListener\("click"/);
});
