import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CHARACTERS, NORMAL_ATTACK_REACH_MULTIPLIER, TRAINING_SETTINGS_ITEMS } from "../src/data.js";
import { aiPlan, createFighterState, evaluateStrike, evaluateThrow, getFighterBoxes } from "../src/engine.js";
import { Game, animationNameFor } from "../src/game.js";
import { canStartSkill, getSkillConfig, getSkillHudState } from "../src/skills.js";
import { getEffectAssetManifest } from "../src/sprite-manifest.js";

test("every screen keeps menu controls available outside battle and pause is header-owned", () => {
  const gameSource = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  const touchSource = fs.readFileSync(new URL("../src/touch-input.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(gameSource, /touchMode = touchBattleScreens\.has\(screen\) \? "battle" : "menu"/);
  assert.match(html, /data-header-pause[^>]*disabled[^>]*>PAUSE<\/button>/);
  assert.doesNotMatch(touchSource, /createButton\("pause"/);
  assert.deepEqual(TRAINING_SETTINGS_ITEMS, ["START TRAINING", "CPU FIGHTER", "STAGE", "CPU MOVE", "CPU ATTACK", "BACK"]);
});

test("attack wind appears on whiff and a contact burst uses the overlap position", () => {
  const game = new Game(null);
  const attacker = createFighterState("guitar-boy", 100, 1);
  game.player = attacker;
  game.cpu = createFighterState("toko", 450, -1);
  assert.equal(game.startAttack(attacker, { lightPressed: true }), true);
  for (let i = 0; i <= attacker.currentMove.startupFrames; i += 1) game.updateFighter(attacker, {}, true);
  assert.equal(game.state.vfx.some((effect) => effect.effectId === "attack-wind"), true);

  const defender = createFighterState("uncle", 126, -1);
  game.cpu = defender;
  attacker.state = "attacking";
  attacker.currentMove = CHARACTERS[attacker.id].moves.strong_attack_neutral;
  attacker.currentAttackId = "contact-test";
  attacker.actionFrame = attacker.currentMove.startupFrames;
  attacker.hitRegistry.clear();
  game.handleCombat(attacker, defender);
  const burst = game.state.vfx.findLast((effect) => effect.effectId === "hit-burst");
  assert.ok(burst);
  assert.notEqual(Math.round(burst.x), Math.round(defender.x));
  assert.equal(getEffectAssetManifest("attack-wind").frames.length, 4);
  assert.equal(getEffectAssetManifest("hit-burst").frames.length, 4);
});

test("knockdown launches, lands, and holds the down state before wakeup", () => {
  const game = new Game(null);
  const fighter = createFighterState("toko", 160, -1);
  game.launchKnockdown(fighter, { knockbackY: 4.5, hardKnockdown: false });
  assert.equal(fighter.state, "knockback");
  assert.equal(fighter.grounded, false);
  for (let i = 0; i < 90 && !fighter.downed; i += 1) game.updateFighter(fighter, {}, false);
  assert.equal(fighter.downed, true);
  assert.ok(["knockdownLanding", "downed"].includes(fighter.state));
  const landedState = fighter.state;
  for (let i = 0; i < 12; i += 1) game.updateFighter(fighter, {}, false);
  assert.notEqual(fighter.state, "idle");
  assert.ok(landedState === "knockdownLanding" || fighter.state === "downed");
});

test("combo cap starts cooldown and attack/guard/throw priority is deterministic", () => {
  const game = new Game(null);
  const attacker = createFighterState("rusty", 100, 1);
  const defender = createFighterState("toko", 126, -1);
  game.player = attacker; game.cpu = defender;
  attacker.comboHits = CHARACTERS.rusty.stats.comboLimit - 1;
  attacker.state = "attacking";
  attacker.currentMove = CHARACTERS.rusty.moves.light_attack_neutral;
  attacker.currentAttackId = "combo-cap";
  attacker.actionFrame = attacker.currentMove.startupFrames;
  game.handleCombat(attacker, defender);
  assert.ok(attacker.attackCooldownFrames > 0);
  attacker.state = "idle"; attacker.currentMove = null;
  assert.equal(game.startAttack(attacker, { lightPressed: true }), false);

  const guard = createFighterState("uncle", 126, -1);
  guard.state = "guarding"; guard.action = "guard_high"; guard.guardHeld = true;
  const strike = CHARACTERS.rusty.moves.light_attack_neutral;
  attacker.state = "attacking"; attacker.currentMove = strike; attacker.actionFrame = strike.startupFrames;
  assert.equal(evaluateStrike(attacker, guard, strike, strike.startupFrames, new Set()).blocked, true);
  assert.equal(evaluateThrow(attacker, guard, 0), false);
  guard.state = "attacking"; guard.currentMove = CHARACTERS.uncle.moves.light_attack_neutral; guard.actionFrame = guard.currentMove.startupFrames;
  assert.equal(evaluateThrow(attacker, guard, 0), true);
  guard.x = 420;
  assert.equal(evaluateThrow(attacker, guard, 0), false);
});

test("partial charge persists, Norio auto-fires, Toko repeats, and Uncle travels by charge", () => {
  const game = new Game(null);
  const rusty = createFighterState("rusty", 100, 1);
  game.player = rusty; game.cpu = createFighterState("guitar-boy", 400, -1);
  game.startSkill(rusty, { skill: true, skillPressed: true });
  for (let i = 0; i < 45; i += 1) game.updateFighter(rusty, { skill: true }, true);
  game.updateFighter(rusty, { skill: false, skillReleased: true }, true);
  assert.ok(rusty.skillGauge > 0);

  const norio = createFighterState("norio", 100, 1);
  game.player = norio; game.cpu = createFighterState("uncle", 400, -1); game.skillEntities = [];
  game.startSkill(norio, { skill: true, skillPressed: true });
  for (let i = 0; i < 220 && !game.skillEntities.some((entity) => entity.type === "snareMarker"); i += 1) game.updateFighter(norio, { skill: true }, true);
  assert.equal(game.skillEntities.some((entity) => entity.type === "snareMarker"), true);
  assert.equal(game.skillEntities.find((entity) => entity.type === "snareMarker").y, 88);

  const kazushige = createFighterState("kazushige", 100, 1);
  game.player = kazushige; game.cpu = createFighterState("uncle", 400, -1); game.skillEntities = [];
  game.startSkill(kazushige, { skill: true, skillPressed: true });
  for (let i = 0; i < 220; i += 1) game.updateFighter(kazushige, { skill: true }, true);
  assert.equal(kazushige.skillPhase, "skillUnavailable");
  assert.ok(kazushige.buff?.frames > 0);

  const toko = createFighterState("toko", 100, 1);
  const target = createFighterState("guitar-boy", 141, -1);
  game.player = toko; game.cpu = target; game.skillEntities = [];
  game.activateSkill(toko, getSkillConfig("toko"));
  game.updateSkillEntities();
  assert.equal(target.flashStunned, true);
  target.flashStunFrames = 1; target.stunFrames = 1; target.state = "hitstun";
  game.updateFighter(target, {}, false);
  assert.equal(target.flashComboHit, false);
  game.activateSkill(toko, getSkillConfig("toko"));
  target.x = game.skillEntities.at(-1).x + game.skillEntities.at(-1).vx;
  game.updateSkillEntities();
  assert.equal(target.flashStunned, true);

  const uncle = createFighterState("uncle", 24, 1);
  game.player = uncle; game.cpu = createFighterState("toko", -1000, -1); game.skillEntities = [];
  uncle.skillGauge = getSkillConfig("uncle").chargeMax;
  game.activateSkill(uncle, getSkillConfig("uncle"));
  const fullSpeed = Math.abs(game.skillEntities[0].vx);
  for (let i = 0; i < 30; i += 1) game.updateSkillEntities();
  assert.ok(uncle.x >= 450);
  const partialUncle = createFighterState("uncle", 24, 1);
  game.player = partialUncle; game.cpu = createFighterState("toko", -1000, -1); game.skillEntities = [];
  partialUncle.skillGauge = getSkillConfig("uncle").chargeMax * 0.25;
  game.activateSkill(partialUncle, getSkillConfig("uncle"));
  assert.ok(Math.abs(game.skillEntities[0].vx) < fullSpeed);
});

test("title panel uses the supplied logo asset", () => {
  const gameSource = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(gameSource, /assets\/ui\/title-logo\.png/);
  assert.equal(fs.existsSync(new URL("../assets/ui/title-logo.png", import.meta.url)), true);
});

test("fighter normal VFX styles, complementary color 2, facing, and reach tip are data-driven", () => {
  const expected = {
    "guitar-boy": ["#a855f7", 1], "green-slime": ["#22d3ee", 0.7], "bob-girl": ["#ff75b5", 1.2],
    uncle: ["#8b5a2b", 0.8], rusty: ["#dc2626", 0.9], kazushige: ["#111111", 1.1], norio: ["#facc15", 0.9], toko: ["#22c55e", 1.1],
  };
  for (const [id, [color, scale]] of Object.entries(expected)) {
    assert.equal(CHARACTERS[id].normalAttackVfx.color, color);
    assert.equal(CHARACTERS[id].normalAttackVfx.scale, scale);
    const c1 = CHARACTERS[id].palettes.color1[0].slice(1);
    const c2 = CHARACTERS[id].palettes.color2[0].slice(1);
    const primary = Number.parseInt(c1, 16); const complement = Number.parseInt(c2, 16);
    assert.notEqual(primary ^ complement, 0xffffff);
  }
  assert.equal(CHARACTERS["green-slime"].normalAttackVfx.offsetY, -22);
  assert.equal(CHARACTERS["guitar-boy"].moves.light_attack_neutral.hitboxWidth, Math.round(34 * NORMAL_ATTACK_REACH_MULTIPLIER * 1.1));
  const game = new Game(null);
  for (const facing of [1, -1]) {
    const fighter = createFighterState("guitar-boy", 200, facing);
    const move = CHARACTERS["guitar-boy"].moves.strong_attack_neutral;
    const tip = game.attackReachPoint(fighter, move);
    const box = getFighterBoxes(fighter, move).hitbox;
    assert.equal(tip.x, facing > 0 ? box.x + box.w : box.x);
    const record = game.spawnVfx("attack-wind", tip, { facing, tipAnchored: true, tint: CHARACTERS["guitar-boy"].normalAttackVfx.color });
    assert.equal(record.facing, facing); assert.equal(record.tipAnchored, true); assert.equal(record.tint, "#a855f7");
  }
});

test("Kazushige ramen skill fully resets and can activate twice", () => {
  const game = new Game(null); const fighter = createFighterState("kazushige", 100, 1); game.player = fighter; game.cpu = createFighterState("uncle", 330, -1);
  const run = () => {
    assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), true);
    for (let i = 0; i < 220 && fighter.skillPhase !== "skillUnavailable"; i += 1) game.updateSkill(fighter, { skill: true }, true);
    assert.equal(fighter.skillPhase, "skillUnavailable"); assert.equal(fighter.skillConfig, null); assert.ok(fighter.buff?.frames > 0);
  };
  run();
  assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), false);
  for (let i = 0; i < 600; i += 1) game.updateFighter(fighter, {}, true);
  assert.equal(fighter.buff, null); assert.equal(fighter.skillGauge, 0);
  run();
});

test("guard dash uses the authored dash clip and combo continuation changes clips without changing hit logic", () => {
  const game = new Game(null); const fighter = createFighterState("guitar-boy", 100, 1);
  game.startGuardDash(fighter); assert.equal(animationNameFor(fighter), "dash");
  fighter.state = "idle";
  game.startAttack(fighter, { lightPressed: true }); assert.equal(animationNameFor(fighter), "light_stand");
  fighter.state = "idle"; fighter.comboHits = 1; fighter.comboTimer = 20;
  game.startAttack(fighter, { lightPressed: true }); assert.equal(animationNameFor(fighter), "heavy_stand");
  assert.equal(fighter.currentMove.damage, CHARACTERS["guitar-boy"].moves.light_attack_neutral.damage);
});

test("Rusty dog pauses overhead and can damage its owner once on impact", () => {
  const game = new Game(null); const rusty = createFighterState("rusty", 130, 1); const target = createFighterState("guitar-boy", 360, -1);
  game.player = rusty; game.cpu = target; game.activateSkill(rusty, getSkillConfig("rusty"));
  for (let i = 0; i < 21; i += 1) game.updateSkillEntities();
  const dog = game.skillEntities[0]; assert.equal(dog.type, "fallingDog"); const overheadY = dog.y;
  for (let i = 0; i < 18; i += 1) game.updateSkillEntities(); assert.equal(dog.y, overheadY);
  dog.x = rusty.x; dog.y = 1; dog.graceFrames = 0;
  const hp = rusty.hp; game.updateSkillEntities(); assert.equal(rusty.hp, hp - rusty.maxHp * 0.8);
  game.updateSkillEntities(); assert.equal(rusty.hp, hp - rusty.maxHp * 0.8);
});

test("Kazushige ramen duration drains its full gauge and attached aura does not create entities", () => {
  const game = new Game(null); const fighter = createFighterState("kazushige", 100, 1); game.player = fighter; game.cpu = createFighterState("uncle", 330, -1);
  fighter.skillGauge = 100; game.activateSkill(fighter, getSkillConfig("kazushige"));
  assert.equal(fighter.skillGauge, 100); assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), false);
  const entities = game.skillEntities.length; const vfx = game.state.vfx.length;
  for (let i = 0; i < 300; i += 1) game.updateFighter(fighter, {}, true);
  assert.equal(fighter.skillGauge, 50); assert.equal(game.skillEntities.length, entities); assert.equal(game.state.vfx.length, vfx);
  for (let i = 0; i < 300; i += 1) game.updateFighter(fighter, {}, true);
  assert.equal(fighter.buff, null); assert.equal(fighter.skillGauge, 0); assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), true);
});

test("Kazushige regains control immediately when the ramen buff activates", () => {
  const game = new Game(null);
  const fighter = createFighterState("kazushige", 100, 1);
  game.player = fighter; game.cpu = createFighterState("uncle", 330, -1);
  assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), true);
  for (let frame = 0; frame < 180 && !fighter.buff; frame += 1) {
    game.frame = frame;
    game.updateFighter(fighter, { skill: true }, true);
  }
  assert.ok(fighter.buff?.frames > 0);
  assert.equal(fighter.skillPhase, "skillUnavailable");
  assert.equal(fighter.state, "idle");
  const startX = fighter.x;
  game.frame += 1;
  game.updateFighter(fighter, { right: true }, true);
  assert.equal(fighter.action, "dash");
  assert.ok(fighter.x > startX);
  assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), false);
  for (let frame = 0; frame < 600; frame += 1) game.updateFighter(fighter, {}, true);
  assert.equal(fighter.buff, null);
  assert.equal(game.startSkill(fighter, { skillHoldRequired: false }), true);
});

test("slime projectile faces its travel direction and enforces a short cooldown", () => {
  const game = new Game(null);
  const fighter = createFighterState("green-slime", 360, -1);
  game.player = fighter; game.cpu = createFighterState("toko", 100, 1);
  const config = getSkillConfig("green-slime");
  fighter.skillGauge = 70;
  game.activateSkill(fighter, config);
  const projectile = game.skillEntities.find((entry) => entry.type === "slimeProjectile");
  assert.ok(projectile);
  assert.equal(projectile.facing, -1);
  assert.ok(projectile.vx < 0);
  assert.equal(fighter.slimeCooldown, config.cooldownFrames);
  assert.equal(canStartSkill(fighter, config), false);
  assert.equal(getSkillHudState(fighter, config).disabled, true);
  for (let frame = 0; frame < config.cooldownFrames; frame += 1) game.updateFighter(fighter, {}, true);
  assert.equal(fighter.slimeCooldown, 0);
  assert.equal(canStartSkill(fighter, config), true);
});

test("knockdown contact effect is raised slightly above the floor", () => {
  const game = new Game(null);
  const fighter = createFighterState("toko", 160, -1);
  game.beginKnockdownLanding(fighter);
  const effect = game.state.vfx.find((entry) => entry.effectId === "down-impact");
  assert.ok(effect);
  assert.equal(effect.y, 32);
  assert.equal(effect.scale, 0.78);
  assert.equal(effect.layer, "behind");
});

test("new rounds clear transient effects and keep CPU idle for the first second", () => {
  const game = new Game(null); game.state.vfx = [{ frames: 99 }]; game.state.effects = game.state.vfx; game.skillEntities = [{ active: true }]; game.projectiles = [{ hit: false }];
  game.beginRound(); assert.equal(game.state.vfx.length, 0); assert.equal(game.skillEntities.length, 0); assert.equal(game.projectiles.length, 0);
  game.state.screen = "battle"; const startX = game.cpu.x; const blank = game.inputForPlan(null);
  for (let i = 0; i < 60; i += 1) game.tickBattle(blank);
  assert.equal(game.cpu.x, startX);
});

test("mobile fighter select remains four columns and attack/hit SE hooks are present", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.character-grid\s*\{[^}]*repeat\(4,/);
  assert.match(source, /this\.playSe\(strong \? "strong" : "light"\)/);
  assert.match(source, /move\.id\?\.includes\("strong"\) \? 125 : 240/);
});

test("ground and air attacks preserve incoming movement momentum", () => {
  const game = new Game(null);
  const ground = createFighterState("guitar-boy", 100, 1);
  game.player = ground; game.cpu = createFighterState("toko", 420, -1);
  ground.vx = 4;
  assert.equal(game.startAttack(ground, { lightPressed: true }), true);
  const groundX = ground.x;
  game.updateFighter(ground, {}, true);
  assert.ok(ground.x > groundX);
  assert.ok(ground.attackMomentumX > 0);

  const air = createFighterState("guitar-boy", 100, 1);
  game.player = air;
  air.grounded = false; air.y = 40; air.vy = 3; air.vx = 2;
  assert.equal(game.startAttack(air, { lightPressed: true }), true);
  const airX = air.x;
  game.updateFighter(air, {}, true);
  assert.ok(air.x > airX);
  assert.ok(air.y > 40);
});

test("Norio charges from zero, auto-starts 16 shots, and drains one gauge share per shot", () => {
  const game = new Game(null);
  const norio = createFighterState("norio", 100, 1);
  game.player = norio; game.cpu = createFighterState("toko", 420, -1);
  const config = getSkillConfig("norio");
  assert.equal(getSkillHudState(norio, config).mode, "charge");
  game.activateSkill(norio, config);
  assert.equal(norio.skillAmmo, 16);
  assert.equal(norio.skillGauge, 100);
  assert.equal(getSkillHudState(norio, config).mode, "ammo");
  game.updateSkillEntities();
  assert.equal(norio.skillAmmo, 15);
  assert.equal(norio.skillGauge, 93.75);
  for (let i = 0; i < 520 && norio.norioVolleyActive; i += 1) game.updateSkillEntities();
  assert.equal(norio.skillAmmo, 0);
  assert.equal(norio.skillGauge, 0);
  assert.equal(norio.norioVolleyActive, false);
  assert.equal(getSkillHudState(norio, config).mode, "charge");
});

test("throw release sends the defender backward into airborne knockdown", () => {
  const game = new Game(null);
  const attacker = createFighterState("uncle", 120, 1);
  const defender = createFighterState("toko", 145, -1);
  game.player = attacker; game.cpu = defender;
  assert.equal(game.startThrow(attacker), true);
  attacker.throwTarget = defender; defender.thrownBy = attacker;
  attacker.actionFrame = attacker.currentMove.startupFrames + attacker.currentMove.activeFrames + 6;
  game.updateThrowSequence();
  assert.equal(defender.state, "knockback");
  assert.equal(defender.grounded, false);
  assert.ok(defender.vx > 0);
  assert.ok(defender.vy >= 4.2);
});

test("platforms crop transparent padding, cut-ins fill their frame, and locomotion has no per-frame flip", () => {
  const source = fs.readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(source, /drawImage\(image, profile\.sx, profile\.sy, profile\.sw, profile\.sh, platform\.x, top, platform\.w, platform\.y\)/);
  assert.match(source, /ctx\.drawImage\(image, cropX, bounds\.y, cropW, cropH, x \+ 2, 56, 112, 104\)/);
  assert.doesNotMatch(source, /sourceFacingCorrection|spriteFacing/);
});

test("CPU approaches reach, makes space, observes, jumps, and attacks only inside reach", () => {
  const plan = (selfX, opponentX, roll) => {
    const self = createFighterState("toko", selfX, 1);
    const opponent = createFighterState("guitar-boy", opponentX, -1);
    return aiPlan({ self, opponent, difficulty: "normal", nowFrame: 0, random: () => roll });
  };
  const far = plan(100, 360, 0.9);
  assert.equal(far.action, "walk");
  assert.equal(far.direction, 1);
  assert.equal(far.reason, "approach-reach");

  const close = plan(100, 110, 0.2);
  assert.equal(close.action, "walk");
  assert.equal(close.direction, -1);
  assert.equal(close.reason, "make-space");

  assert.equal(plan(100, 160, 0.1).action, "observe");
  assert.equal(plan(100, 160, 0.34).action, "jump");
  assert.equal(plan(100, 160, 0.95).action, "strong");
  assert.equal(new Game(null).inputForPlan({ action: "observe" }).lightPressed, false);
});

test("throw counter stays active for an extra half second and follows backward facing", () => {
  const game = new Game(null);
  game.state.screen = "battle";
  game.player.facing = -1;
  game.keys.add("arrowright"); game.keys.add("l"); game.justKeys.add("arrowright"); game.justKeys.add("l");
  assert.equal(game.readInput().throwPressed, true);
  assert.equal(game.startThrow(game.player), true);
  assert.equal(game.player.currentMove.activeFrames, 33);
});

test("keyboard input mirrors held controls onto the visual pad", () => {
  const game = new Game(null);
  let visual = [];
  game.touchInput = { getSnapshot: () => ({}), setExternalVisualActions: (actions) => { visual = actions; } };
  game.keys.add("arrowleft"); game.keys.add("j"); game.keys.add("i");
  game.readInput();
  assert.equal(visual.includes("left"), true);
  assert.equal(visual.includes("a"), true);
  assert.equal(visual.includes("special"), true);
});

test("Norio drum impacts use the widened authored hitbox scale", () => {
  const game = new Game(null);
  const norio = createFighterState("norio", 40, 1);
  game.player = norio; game.cpu = createFighterState("guitar-boy", 450, -1); game.random = () => 0.5;
  game.activateSkill(norio, getSkillConfig("norio"));
  const first = game.skillEntities[0];
  assert.ok(first.hitboxScale > 1);
  first.delay = 0; game.updateSkillEntities();
  assert.equal(first.type, "snareImpact");
  assert.ok(first.w > 34 && first.h > 30);
});

test("Toko auto-fires or completes film reload while B remains held", () => {
  const game = new Game(null);
  const toko = createFighterState("toko", 100, 1);
  game.player = toko; game.cpu = createFighterState("guitar-boy", 420, -1);
  toko.skillAmmo = 1; toko.ammo = 1;
  assert.equal(game.startSkill(toko, { skill: true, skillPressed: true }), true);
  for (let i = 0; i < 100 && !game.skillEntities.some((entry) => entry.type === "flash"); i += 1) game.updateFighter(toko, { skill: true }, true);
  assert.equal(game.skillEntities.some((entry) => entry.type === "flash"), true);
  const reload = createFighterState("toko", 100, 1); game.player = reload; reload.skillAmmo = 0; reload.ammo = 0;
  assert.equal(game.startSkill(reload, { skill: true, skillPressed: true }), true);
  for (let i = 0; i < 100 && reload.skillAmmo < 3; i += 1) game.updateFighter(reload, { skill: true }, true);
  assert.equal(reload.skillAmmo, 3);
});

test("Bob charges three mirrors, taps one quickly, and reflected damage knocks down", () => {
  const game = new Game(null);
  const bob = createFighterState("bob-girl", 100, 1);
  game.player = bob; game.cpu = createFighterState("uncle", 135, -1);
  assert.equal(game.startSkill(bob, { skill: true, skillPressed: true }), true);
  for (let i = 0; i < 180 && bob.skillAmmo < 3; i += 1) game.updateFighter(bob, { skill: true }, true);
  assert.equal(bob.skillAmmo, 3);
  assert.equal(bob.skillPhase, "skillUnavailable");
  assert.equal(game.startSkill(bob, { skill: true, skillPressed: true }), true);
  let activeSeen = false;
  for (let i = 0; i < 12; i += 1) { game.updateFighter(bob, { skill: false, skillReleased: i === 0 }, true); activeSeen ||= bob.mirrorActiveFrames > 0; }
  assert.equal(activeSeen, true);
});

test("skill and special just guards show JUST GUARD while ordinary skill guard blocks", () => {
  const makeEntityGame = (freshGuard) => {
    const game = new Game(null); game.frame = 100;
    game.player = createFighterState("uncle", 100, 1); game.cpu = createFighterState("toko", 130, -1);
    game.cpu.guardHeld = true; game.cpu.guardStartedFrame = freshGuard ? 100 : 80; game.cpu.state = "guarding";
    game.skillEntities = [{ active: true, type: "tackle", owner: "player", x: 130, y: 0, vx: 0, vy: 0, w: 100, h: 120, duration: 20, age: 0, delay: 0, damage: 160, unblockable: true, hitTargets: new Set() }];
    return game;
  };
  const just = makeEntityGame(true); const justHp = just.cpu.hp; just.updateSkillEntities();
  assert.equal(just.cpu.hp, justHp); assert.equal(just.state.combatNotice.text, "JUST GUARD");
  const normal = makeEntityGame(false); const normalHp = normal.cpu.hp; normal.updateSkillEntities();
  assert.equal(normal.cpu.hp, normalHp); assert.equal(normal.state.combatNotice.text, "GUARD");
});

test("a downed attack input is buffered into the matching crouch attack after recovery", () => {
  const game = new Game(null);
  const fighter = createFighterState("guitar-boy", 100, 1); game.player = fighter; game.cpu = createFighterState("toko", 300, -1);
  fighter.state = "downed"; fighter.downed = true; fighter.downedFrames = 20;
  game.updateFighter(fighter, { strongPressed: true }, true);
  assert.equal(fighter.downAttackBuffer, "strong");
  fighter.state = "wakeupInvulnerable"; fighter.downed = false; fighter.wakeupInvulnerable = true; fighter.wakeupInvulnerableFrames = 1;
  game.updateFighter(fighter, {}, true);
  assert.equal(fighter.state, "attacking");
  assert.equal(fighter.currentMove.id, "strong_attack_crouch");
});

test("Rusty dog uses one bounded runtime image and starts its impact effect on contact", () => {
  const game = new Game(null);
  const rusty = createFighterState("rusty", 100, 1); game.player = rusty; game.cpu = createFighterState("toko", 300, -1);
  game.activateSkill(rusty, getSkillConfig("rusty"));
  assert.equal(game.skillEntities.length, 1);
  assert.equal(game.skillEntities[0].renderWidth, 96);
  assert.equal(game.state.vfx.some((effect) => effect.effectId === "skill-dog-summon"), false);
  const dog = game.skillEntities[0]; dog.delay = 0; dog.age = 20; game.updateSkillEntities();
  assert.equal(dog.type, "fallingDog"); assert.equal(dog.renderWidth, 128);
  dog.graceFrames = 0; dog.y = 1; dog.vy = -10; game.updateSkillEntities();
  assert.equal(dog.type, "dogImpact");
  assert.equal(game.state.vfx.some((effect) => effect.effectId === "hit-burst"), true);
});
