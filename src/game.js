import {
  ANIMATION_CLIPS, CHARACTERS, CHARACTER_IDS, DIFFICULTIES, GAME_TITLE,
  INTERNAL_HEIGHT, INTERNAL_WIDTH, MAX_HP, MAX_METER, MENU_ITEMS, ROUND_TIME_SECONDS, SETTINGS_ITEMS,
  TRAINING_SETTINGS_ITEMS,
  STAGE_BOUNDS, STAGES,
} from "./data.js";
import {
  FIXED_DT, FIXED_HZ, activeFrame, aiPlan, applyDamage, clamp, createFighterState,
  createProjectile, evaluateStrike, evaluateThrow, fixedStep, getFighterBoxes, projectileIsActive, rankForScore,
  resolvePushboxes, resolveRound, scoreForEvent, stageOpponent,
  canDownFollowup, comboDamageScale, getComboLimit, isDownState, isJustGuardEligible,
  justGuardWithinWindow, shouldKnockdown,
} from "./engine.js";
import { appendHighScore, loadSave, resetSave, saveData } from "./storage.js";
import { EFFECT_ASSET_MANIFEST, RUNTIME_ANIMATION_ALIASES, getEffectAssetManifest, getSkillAnimationClip } from "./sprite-manifest.js";
import { TouchInput } from "./touch-input.js";
import {
  canContinueSkill, canStartSkill, getSkillConfig, getSkillHudState, interruptSkill,
  SKILL_HOLD_THRESHOLD_FRAMES,
} from "./skills.js";
import { effectForMove, getEffectDescriptor } from "./vfx.js";

export const SCREEN = Object.freeze({
  boot: "boot", title: "title", menu: "menu", difficultySelect: "difficultySelect",
  characterSelect: "characterSelect", colorSelect: "colorSelect", trainingSettings: "trainingSettings",
  howToPlay: "howToPlay", settings: "settings",
  stageIntro: "stageIntro", roundIntro: "roundIntro", battle: "battle", pause: "pause",
  roundResult: "roundResult", stageResult: "stageResult", continue: "continue",
  gameOver: "gameOver", ending: "ending", score: "score",
});

const FRAME = 1000 / FIXED_HZ;
export const STAGE_DIALOGUE_FRAMES = 4 * FIXED_HZ;
export const DEFAULT_SPRITE_SCALE = 0.82;

// Action PNGs are normalized around their authored 128,233 anchor, so runtime
// rendering uses one scale contract for every fighter and every action.
export function spriteScaleFor(_fighter, _animationName = "") { return DEFAULT_SPRITE_SCALE; }

export function spriteDrawPlacement(fighter, sprite, scale = DEFAULT_SPRITE_SCALE) {
  const anchor = sprite?.anchor || { x: 128, y: 233 };
  const cellWidth = sprite?.cellWidth || 256;
  const cellHeight = sprite?.cellHeight || 256;
  const baselineY = STAGE_BOUNDS.floor - Math.max(0, Number(fighter?.y) || 0);
  return {
    originX: Number(fighter?.x) || 0,
    baselineY,
    drawX: -anchor.x * scale,
    drawY: -anchor.y * scale,
    width: cellWidth * scale,
    height: cellHeight * scale,
  };
}

export function animationSelectionFor(fighter) {
  if (fighter?.state === "guardDash") return { name: "dash", frame: Math.max(0, fighter?.guardDashFrames || fighter?.actionFrame || 0) };
  if (fighter?.visualAction) return { name: fighter.visualAction, frame: Math.max(0, fighter.visualFrame || 0) };
  if (fighter?.state === "wakeup") return { name: "wakeup", frame: Math.max(0, fighter?.actionFrame || 0) };
  const action = fighter?.action || "idle";
  const move = fighter?.currentMove;
  const frame = Math.max(0, fighter?.actionFrame || 0);
  const skillPhase = String(fighter?.skillPhase || "");
  if (String(action).startsWith("skill_") || (skillPhase.startsWith("skill") && skillPhase !== "skillUnavailable")) {
    const skillAction = skillSpriteActionFor(fighter);
    if (skillAction) return { name: skillAction, frame };
  }
  if (move?.animation && action === move.id) return { name: move.animation, frame };
  // Combo bookkeeping uses left/right variant ids for grounded lights, while
  // the authored sheet exposes one canonical standing/crouching light clip.
  // Preserve the attack motion instead of falling through to an idle frame.
  if (fighter?.grounded !== false && /^(?:forward_)?light_(?:left|right)$/.test(action)) {
    const crouching = fighter?.crouching === true || fighter?.state === "crouching" || fighter?.boxProfile === "crouch";
    const continuation = Number(fighter?.currentMove?.comboIndex || 0) % 2 === 1;
    return { name: crouching ? (continuation ? "heavy_crouch" : "light_crouch") : (continuation ? "heavy_stand" : "light_stand"), frame };
  }
  if (action === "special_start" && move) {
    if (frame < move.startupFrames) return { name: "special_start", frame };
    if (frame < move.startupFrames + move.activeFrames) return { name: "special_active", frame: frame - move.startupFrames };
    return { name: "special_recovery", frame: frame - move.startupFrames - move.activeFrames };
  }
  if (action === "throw_start" && move && frame >= move.startupFrames + move.activeFrames) {
    return { name: "throw_miss", frame: frame - move.startupFrames - move.activeFrames };
  }
  if (action === "jump_up" && Math.abs(fighter?.vy || 0) < 1) return { name: "jump_apex", frame };
  return { name: RUNTIME_ANIMATION_ALIASES[action] || action, frame };
}

export function animationNameFor(fighter) {
  return animationSelectionFor(fighter).name;
}

export function setVisualSequence(fighter, sequence) {
  const entries = sequence.filter((entry) => entry?.name && entry.duration > 0).map((entry) => ({ ...entry }));
  const first = entries.shift();
  fighter.visualQueue = entries;
  fighter.visualAction = first?.name || "";
  fighter.visualFrame = 0;
  fighter.visualFramesRemaining = first?.duration || 0;
}

export function advanceVisualSequence(fighter) {
  if (!fighter?.visualAction) return;
  fighter.visualFrame += 1;
  fighter.visualFramesRemaining -= 1;
  if (fighter.visualFramesRemaining > 0) return;
  const next = fighter.visualQueue?.shift();
  fighter.visualAction = next?.name || "";
  fighter.visualFrame = 0;
  fighter.visualFramesRemaining = next?.duration || 0;
}

export function formatDuration(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function skillHudStateFor(fighter) {
  return getSkillHudState(fighter, fighter?.id);
}

/** Copy for the small status line directly beneath a fighter's skill gauge. */
export function skillStatusTextFor(fighter = {}) {
  const phase = String(fighter.skillPhase || fighter.skillState || fighter.state || "");
  const charging = phase === "skillCharging";
  if (fighter.id === "guitar-boy" && charging) return "猛烈に耳コピ中";
  if (fighter.id === "rusty" && charging) return "犬、呼んでます";
  if (fighter.id === "kazushige" && charging) return "バトル中らーめん。";
  if (fighter.id === "toko" && Number(fighter.skillAmmo ?? fighter.ammo ?? 0) === 0 && fighter.flashReloading) return "フィルム交換しなくちゃ";
  return "";
}

/** Resolve the phase-facing action id exposed by a fighter's skill config. */
export function skillSpriteActionFor(fighter = {}) {
  const actions = getSkillConfig(fighter?.id)?.spriteActions || [];
  if (!actions.length) return null;
  const action = String(fighter?.action || "");
  const phase = String(fighter?.skillPhase || fighter?.skillState || fighter?.state || "");
  const recovery = action === "skill_recovery" || action === "skill_reload" || phase === "skillRecovery";
  const active = action === "skill_active" || action === "skillActive" || phase === "skillActive";
  const charging = action === "skill_charge" || action === "skillCharging" || phase === "skillCharging";
  const findAction = (patterns) => actions.findIndex((name) => patterns.some((pattern) => name.includes(pattern)));
  const activeIndex = findAction(["_active", "_activate", "_success", "_fire", "_complete"]);
  const index = recovery
    ? actions.length - 1
    : active
      ? (activeIndex >= 0 ? activeIndex : Math.min(2, actions.length - 1))
      : charging
        ? Math.max(0, findAction(["_loop", "_hold", "_charge", "_count", "_marker"]))
        : 0;
  return actions[index];
}
// A held jump key must not reduce gravity indefinitely.  Constant gravity
// keeps jumps short and deterministic, while the air-frame guard below is a
// last-resort safety net for malformed/custom fighter data.
// Raising both takeoff velocity and gravity keeps the familiar apex while
// shortening the time spent in the air.
const GRAVITY = 0.43;
const JUMP_TAKEOFF_MULTIPLIER = 1.16;
const MAX_AIR_FRAMES = 90;
const MAX_JUMP_HEIGHT = STAGE_BOUNDS.floor * 0.9;
const DASH_LOCK_FRAMES = 9;
const BACKSTEP_LOCK_FRAMES = 12;
const GUARD_DASH_FRAMES = 18;
const GUARD_DASH_COOLDOWN = 18;
const GUARD_DASH_GUARD_FRAMES = 4;
const WAKEUP_INVULN_FRAMES = 12;
const DOWN_LANDING_FRAMES = 10;
const DOWN_FOLLOWUP_FRAMES = 45;
const DOWN_WAKEUP_FRAMES = 60;
const DOWN_HARD_WAKEUP_FRAMES = 90;
const WAKEUP_FRAMES = 20;
const JUST_GUARD_WINDOW = 3;
const JUST_GUARD_HITSTOP = 4;
const COMBO_BUFFER_FRAMES = 8;
const SKILL_ENTITY_LIMIT = 96;
const HITSTOP_ON_HIT_FRAMES = 2;
const ACTION_LOCK_STATES = new Set(["attacking", "hitstun", "blockstun", "knockback", "knockdown", "knockdownLanding", "downed", "groundHit", "throwing", "skillStartup", "skillCharging", "skillActive", "skillRecovery"]);
const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
const MOVE_KEYS = Object.freeze({ light: "light_attack_neutral", strong: "strong_attack_neutral" });

function byId(id) { return typeof document === "undefined" ? null : document.getElementById(id); }
function text(value) { return String(value ?? ""); }

// Debug geometry is a development aid only.  A saved preference or a URL
// query must not expose it to production users; an explicit dev build flag is
// required before either source is honored.
export function debugBuildEnabled() {
  if (typeof globalThis !== "undefined" && (globalThis.__GAME_DEBUG_BUILD__ === true || globalThis.__DEV__ === true)) return true;
  return typeof process !== "undefined" && process?.env?.NODE_ENV === "development";
}

export function resolveDebugFlag(save = {}) {
  if (!debugBuildEnabled()) return false;
  const query = typeof location !== "undefined" ? new URLSearchParams(location.search || "").get("debug") : null;
  return query === "1" || query === "true" || save.debug === true;
}

function makeImage(src) {
  if (typeof Image === "undefined") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
}

function imageReady(image) {
  return Boolean(image?.complete && (typeof image.naturalWidth === "undefined" || image.naturalWidth > 0));
}

export class Game {
  constructor(root = null) {
    this.root = root || byId("game");
    this.canvas = this.root?.querySelector?.("canvas") || byId("arena");
    if (this.canvas) {
      this.canvas.width = INTERNAL_WIDTH;
      this.canvas.height = INTERNAL_HEIGHT;
    }
    this.ctx = this.canvas?.getContext?.("2d") || null;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.panel = this.root?.querySelector?.("[data-panel]") || byId("panel");
    this.hud = this.root?.querySelector?.("[data-hud]") || byId("hud");
    this.hint = this.root?.querySelector?.("[data-hint]") || byId("hint");
    this.headerPause = this.root?.querySelector?.("[data-header-pause]") || null;
    this.touchInput = new TouchInput(this.root?.querySelector?.("[data-virtual-pad]") || this.root);
    // TouchInput emits its first pointer edge synchronously.  Starting audio
    // here (without awaiting it) keeps that edge in the same simulation tick.
    if (this.touchInput) this.touchInput.onInput = () => this.ensureAudio();
    this.save = loadSave();
    this.images = new Map();
    this.platformImages = new Map();
    this.effectImages = new Map();
    this.effectTintCache = new Map();
    // Keep the last decoded frame for each fighter.  Animation frames load
    // asynchronously; retaining a ready frame prevents a one-frame blank
    // whenever a newly requested action image has not decoded yet.
    this.lastReadySprites = new Map();
    this.backgrounds = new Map();
    this.keys = new Set();
    this.justKeys = new Set();
    this.releasedKeys = new Set();
    this.padHeld = new Set();
    this.padJust = new Set();
    this.padReleased = new Set();
    this.inputEdgeFrames = new Map();
    this.lastDirection = 0;
    this.lastDirectionFrame = -999;
    this.frame = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.soundContext = null;
    this.bgm = null;
    this.bgmSource = "";
    this.state = {
      screen: SCREEN.boot,
      menuIndex: 0,
      settingsIndex: 0,
      trainingSettingsIndex: 0,
      difficulty: "normal",
      mode: "arcade",
      trainingCpuMove: false,
      trainingCpuAttack: false,
      trainingDamage: 0,
      combatNotice: { text: "", kind: "", damage: 0, x: 240, y: 120, frames: 0 },
      selectedId: "guitar-boy",
      color: 1,
      stage: 1,
      round: 1,
      playerRounds: 0,
      cpuRounds: 0,
      continueUsed: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      justGuards: 0,
      specialHits: 0,
      perfect: true,
      roundLosses: 0,
      finalStats: null,
      stageBonusAwarded: false,
      inputHistory: [],
      roundCarry: { meter: 0, specialGauge: 0, skillGauge: 0, ammo: 0, copyCharges: 0 },
      cpuRoundCarry: { meter: 0, specialGauge: 0, skillGauge: 0, ammo: 0, copyCharges: 0 },
      vfx: [],
      effects: [],
      skillEntities: [],
      hitstopFrames: 0,
      specialCinematic: null,
      pauseIndex: 0,
      stageFrame: 0,
      battleFrames: 0,
      timerFrames: ROUND_TIME_SECONDS * FIXED_HZ,
      result: "",
      stageResult: "",
      koFrames: 0,
      screenFrames: 0,
      debug: resolveDebugFlag(this.save),
      sound: this.save.sound !== false,
      bgmEnabled: this.save.bgmEnabled !== false,
      seEnabled: this.save.seEnabled !== false,
    };
    this.player = createFighterState(this.state.selectedId, 150, 1);
    this.cpu = createFighterState("toko", 330, -1);
    this.projectiles = [];
    this.skillEntities = [];
    this.installInput();
    if (this.headerPause) {
      this.onHeaderPause = () => {
        this.ensureAudio();
        if (this.state.screen === SCREEN.battle) this.setScreen(SCREEN.pause);
        else if (this.state.screen === SCREEN.pause) this.setScreen(SCREEN.battle);
      };
      this.headerPause.addEventListener("click", this.onHeaderPause);
    }
    this.touchInput?.setMode("menu");
    this.render();
  }

  installInput() {
    if (typeof window === "undefined") return;
    this.onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "escape"].includes(key)) event.preventDefault();
      if (!this.keys.has(key)) this.justKeys.add(key);
      this.keys.add(key);
      // Audio initialization is deliberately independent from gameplay
      // routing so the first face-button edge is never dropped in battle.
      this.ensureAudio();
    };
    this.onKeyUp = (event) => {
      const key = event.key.toLowerCase();
      this.keys.delete(key);
      this.releasedKeys.add(key);
    };
    this.onBlur = () => this.resetInput();
    // Focus can be restored in the same turn as a pointer/key edge.  Do not
    // clear that edge here; blur/visibility handlers already clear stale holds.
    this.onFocus = () => {};
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
  }

  resetInput() {
    this.keys.clear();
    this.justKeys.clear();
    this.releasedKeys.clear();
    this.padHeld.clear();
    this.padJust.clear();
    this.padReleased.clear();
    this.touchInput?.reset();
  }

  destroy() {
    this.headerPause?.removeEventListener?.("click", this.onHeaderPause);
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      window.removeEventListener("focus", this.onFocus);
    }
    this.touchInput?.destroy();
    if (this.bgm) this.bgm.pause();
    this.running = false;
  }

  ensureAudio() {
    if (this.state.bgmEnabled) this.syncBgm();
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!this.state.seEnabled || !Context) return;
    try {
      if (!this.soundContext) this.soundContext = new Context();
      // Browsers commonly return a Promise here.  Attach the continuation but
      // never await it from the input handler, preserving the original edge.
      if (this.soundContext?.state === "suspended" && typeof this.soundContext.resume === "function") {
        const resumed = this.soundContext.resume();
        this.audioResumePromise = Promise.resolve(resumed).catch(() => undefined);
      }
    } catch { this.soundContext = null; }
  }

  syncBgm() {
    if (typeof Audio === "undefined") return;
    if (!this.state.bgmEnabled) {
      if (this.bgm) this.bgm.pause();
      return;
    }
    const battleLike = [SCREEN.roundIntro, SCREEN.battle, SCREEN.pause, SCREEN.roundResult, SCREEN.stageResult].includes(this.state.screen);
    const source = battleLike ? "assets/audio/bgm-battle.mp3" : "assets/audio/bgm-title.mp3";
    if (!this.bgm) {
      this.bgm = new Audio();
      this.bgm.loop = true;
      this.bgm.volume = 0.24;
    }
    if (this.bgmSource !== source) {
      this.bgmSource = source;
      this.bgm.src = source;
    }
    const playback = this.bgm.play();
    if (playback?.catch) playback.catch(() => {});
  }

  beep(frequency = 220, duration = 0.05, type = "square") {
    if (!this.state.seEnabled) return;
    this.ensureAudio();
    if (!this.soundContext || this.soundContext.state === "suspended") return;
    try {
      const oscillator = this.soundContext.createOscillator();
      const gain = this.soundContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.12, this.soundContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.soundContext.currentTime + duration);
      oscillator.connect(gain).connect(this.soundContext.destination);
      oscillator.start();
      oscillator.stop(this.soundContext.currentTime + duration);
    } catch { /* audio is an optional enhancement */ }
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const loop = (now) => {
      if (!this.running) return;
      const elapsed = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      const result = fixedStep(this.accumulator, elapsed);
      this.accumulator = result.accumulator;
      for (let i = 0; i < result.steps; i += 1) this.tick();
      this.render();
      if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(loop);
    };
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(loop);
    return this;
  }

  tick() {
    this.frame += 1;
    const input = this.readInput();
    this.state.inputHistory.push({ frame: this.frame, left: input.left, right: input.right, down: input.down, up: input.up, light: input.light, strong: input.strong, guard: input.guard, skill: input.skill, special: input.special });
    if (this.state.inputHistory.length > 30) this.state.inputHistory.shift();
    this.state.screenFrames += 1;
    if (this.state.screen === SCREEN.boot) {
      if (this.state.screenFrames > 25 || input.start) this.setScreen(SCREEN.title);
    } else if (this.state.screen === SCREEN.title) {
      if (input.start || input.confirm) this.setScreen(SCREEN.menu);
    } else if (this.state.screen === SCREEN.menu) this.tickMenu(input);
    else if (this.state.screen === SCREEN.difficultySelect) this.tickDifficulty(input);
    else if (this.state.screen === SCREEN.characterSelect) this.tickCharacter(input);
    else if (this.state.screen === SCREEN.colorSelect) this.tickColor(input);
    else if (this.state.screen === SCREEN.trainingSettings) this.tickTrainingSettings(input);
    else if (this.state.screen === SCREEN.howToPlay) {
      if (input.cancel || input.confirm) this.setScreen(SCREEN.menu);
    } else if (this.state.screen === SCREEN.settings) {
      this.tickSettings(input);
    } else if (this.state.screen === SCREEN.score) {
      if (input.cancel || input.confirm) this.setScreen(SCREEN.menu);
    } else if (this.state.screen === SCREEN.stageIntro) {
      // Stage dialogue is shown for exactly four seconds at the fixed 60 Hz
      // simulation rate. Confirm remains an explicit skip affordance.
      if (input.confirm || this.state.screenFrames >= STAGE_DIALOGUE_FRAMES) this.beginRound();
    } else if (this.state.screen === SCREEN.roundIntro) {
      if (input.confirm || this.state.screenFrames > 70) this.setScreen(SCREEN.battle);
    } else if (this.state.screen === SCREEN.battle) {
      if (input.pause || input.cancel) this.setScreen(SCREEN.pause);
      else this.tickBattle(input);
    } else if (this.state.screen === SCREEN.pause) {
      // ENTER/the virtual pause button resumes. ESC is also a training escape
      // route so a training session can be left without requiring a mouse.
      if (input.upPressed) this.state.pauseIndex = (this.state.pauseIndex + 1) % 2;
      if (input.downPressed) this.state.pauseIndex = (this.state.pauseIndex + 1) % 2;
      if (input.cancel) this.state.mode === "training" || this.state.pauseIndex === 1 ? this.returnTitle() : this.setScreen(SCREEN.battle);
      else if (input.pause || input.confirm) this.state.pauseIndex === 0 ? this.setScreen(SCREEN.battle) : this.returnTitle();
    } else if (this.state.screen === SCREEN.roundResult) {
      if (input.confirm || this.state.screenFrames > 100) this.resolveRoundResult();
    } else if (this.state.screen === SCREEN.stageResult) {
      if (input.confirm || this.state.screenFrames > 110) this.resolveStageResult();
    } else if (this.state.screen === SCREEN.continue) {
      if (input.confirm) this.continueMatch(true);
      else if (input.cancel || this.state.screenFrames > 300) this.continueMatch(false);
    } else if (this.state.screen === SCREEN.gameOver) {
      if (input.confirm) this.returnTitle();
      else if (input.cancel) this.returnTitle();
    } else if (this.state.screen === SCREEN.ending) {
      if (input.confirm || this.state.screenFrames > 240) this.finishEnding();
    }
    this.justKeys.clear();
    this.releasedKeys.clear();
    this.touchInput?.clearEdges();
  }

  readInput() {
    const gamepad = this.pollGamepad();
    const touchSnapshot = this.touchInput?.getSnapshot?.() || {};
    const touch = {
      held: touchSnapshot.held instanceof Set ? touchSnapshot.held : new Set(touchSnapshot.held || []),
      pressed: touchSnapshot.pressed instanceof Set ? touchSnapshot.pressed : new Set(touchSnapshot.pressed || []),
      released: touchSnapshot.released instanceof Set ? touchSnapshot.released : new Set(touchSnapshot.released || []),
    };
    const held = (key) => this.keys.has(key);
    const pressed = (...keys) => keys.some((key) => this.justKeys.has(key));
    const released = (...keys) => keys.some((key) => this.releasedKeys.has(key));
    const button = (key, aliases = []) => held(key) || aliases.some((alias) => held(alias));
    const touchHeld = (key) => touch.held.has(key);
    const touchPressed = (key) => touch.pressed.has(key);
    const touchReleased = (key) => touch.released.has(key);
    const battleScreen = this.state.screen === SCREEN.battle;
    const left = button("arrowleft") || gamepad.left || touchHeld("left");
    const right = button("arrowright") || gamepad.right || touchHeld("right");
    const up = button("arrowup", ["w"]) || gamepad.up || touchHeld("up");
    const down = button("arrowdown", ["s"]) || gamepad.down || touchHeld("down");
    const leftPressed = pressed("arrowleft") || gamepad.leftPressed || touchPressed("left");
    const rightPressed = pressed("arrowright") || gamepad.rightPressed || touchPressed("right");
    const upPressed = pressed("arrowup", "w") || gamepad.upPressed || touchPressed("up");
    const downPressed = pressed("arrowdown", "s") || gamepad.downPressed || touchPressed("down");
    const upReleased = released("arrowup", "w") || gamepad.upReleased || touchReleased("up");

    // Physical face controls are normalized before gameplay decides legality:
    // A=light, X=strong, Y=guard, B=skill.  The same fields are emitted by
    // keyboard, gamepad, and touch so command conditions cannot diverge.
    const aHeld = button("j", ["z"]) || gamepad.a || touchHeld("a");
    const xHeld = button("k", ["x"]) || gamepad.x || touchHeld("x");
    const yHeld = button("l", ["c"]) || gamepad.y || touchHeld("y");
    const bHeld = button("b") || gamepad.b || touchHeld("b");
    const aPressed = pressed("j", "z") || gamepad.aPressed || touchPressed("a");
    const xPressed = pressed("k", "x") || gamepad.xPressed || touchPressed("x");
    const yPressed = pressed("l", "c") || gamepad.yPressed || touchPressed("y");
    const bPressed = pressed("b") || gamepad.bPressed || touchPressed("b");
    const aReleased = released("j", "z") || gamepad.aReleased || touchReleased("a");
    const xReleased = released("k", "x") || gamepad.xReleased || touchReleased("x");
    const yReleased = released("l", "c") || gamepad.yReleased || touchReleased("y");
    const bReleased = released("b") || gamepad.bReleased || touchReleased("b");
    const dedicatedThrowHeld = touchHeld("throw");
    const dedicatedThrowPressed = touchPressed("throw");
    const dedicatedThrowReleased = touchReleased("throw");
    const edgeFrame = (name, edge) => {
      if (edge) this.inputEdgeFrames.set(name, this.frame);
      return this.inputEdgeFrames.get(name);
    };
    const aEdgeFrame = edgeFrame("a", aPressed);
    const xEdgeFrame = edgeFrame("x", xPressed);
    const throwHeld = dedicatedThrowHeld || (aHeld && xHeld);
    const throwWithinWindow = Number.isFinite(aEdgeFrame) && Number.isFinite(xEdgeFrame) && Math.abs(aEdgeFrame - xEdgeFrame) <= 8;
    const throwPressed = dedicatedThrowPressed || (throwHeld && throwWithinWindow && !this.throwChordHeld);
    this.throwChordHeld = throwHeld;
    if (!throwHeld) this.throwChordHeld = false;
    let light = aHeld && !throwHeld;
    let strong = xHeld && !throwHeld;
    const guard = yHeld && !throwHeld;
    const skill = bHeld;
    const skillPressed = bPressed;
    const jump = (upPressed || gamepad.jumpPressed || touchPressed("jump"));
    const jumpHeld = up || gamepad.jump || touchHeld("jump");
    const jumpReleased = upReleased || gamepad.jumpReleased || touchReleased("jump");
    const special = button("i", ["v"]) || gamepad.special || touchHeld("special");
    const specialPressed = pressed("i", "v") || gamepad.specialPressed || touchPressed("special");
    const specialReleased = released("i", "v") || gamepad.specialReleased || touchReleased("special");
    const lightPressed = aPressed && !throwHeld;
    const strongPressed = xPressed && !throwHeld;
    const guardPressed = yPressed && !throwHeld;
    const keyboardCancel = pressed("escape", "backspace");
    const menuCancel = !battleScreen && touchPressed("b");
    const confirm = pressed("enter", " ") || gamepad.confirmPressed || (!battleScreen && touchPressed("a"));
    const cancel = keyboardCancel || menuCancel;
    const pause = (battleScreen && keyboardCancel) || touchPressed("pause");
    return {
      left, right, up, down, light, strong, guard, skill, special,
      a: aHeld, b: bHeld, x: xHeld, y: yHeld,
      jump: jumpHeld, jumpPressed: jump, jumpReleased, specialPressed, specialReleased,
      skillPressed, skillReleased: bReleased,
      throwHeld, throwPressed, throwReleased: dedicatedThrowReleased || (aReleased || xReleased), counterThrow: false,
      leftPressed, rightPressed, upPressed, upReleased, downPressed,
      lightPressed, strongPressed, guardPressed,
      confirm, cancel, pause, start: confirm,
    };
  }

  pollGamepad() {
    const blank = { left: false, right: false, up: false, down: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, upReleased: false, a: false, b: false, x: false, y: false, aPressed: false, bPressed: false, xPressed: false, yPressed: false, aReleased: false, bReleased: false, xReleased: false, yReleased: false, jump: false, jumpPressed: false, jumpReleased: false, special: false, specialPressed: false, specialReleased: false, confirmPressed: false };
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") { this.padHeld.clear(); return blank; }
    let pad = null;
    try { pad = Array.from(navigator.getGamepads() || []).find(Boolean); } catch { this.padHeld.clear(); return blank; }
    if (!pad) { this.padHeld.clear(); return blank; }
    const buttonDown = (index) => Boolean(pad.buttons?.[index]?.pressed);
    const edge = (name, down) => { const was = this.padHeld.has(name); const just = down && !was; const up = !down && was; if (down) this.padHeld.add(name); else this.padHeld.delete(name); return { just, up }; };
    const axisX = Number(pad.axes?.[0] || 0);
    const axisY = Number(pad.axes?.[1] || 0);
    const left = axisX < -0.35 || buttonDown(14);
    const right = axisX > 0.35 || buttonDown(15);
    const up = axisY < -0.35 || buttonDown(12);
    const down = axisY > 0.35 || buttonDown(13);
    const a = buttonDown(0);
    const b = buttonDown(1);
    const x = buttonDown(2);
    const y = buttonDown(3);
    const jump = buttonDown(8) || buttonDown(10);
    const special = buttonDown(5) || buttonDown(7) || buttonDown(9) || buttonDown(11);
    const ea = edge("a", a); const eb = edge("b", b); const ex = edge("x", x); const ey = edge("y", y);
    const ejump = edge("jump", jump); const espec = edge("special", special);
    const confirm = a || buttonDown(9);
    const result = {
      left, right, up, down,
      leftPressed: edge("left", left).just, rightPressed: edge("right", right).just, upPressed: edge("up", up).just, downPressed: edge("down", down).just,
      upReleased: edge("up", up).up,
      a, b, x, y, aPressed: ea.just, bPressed: eb.just, xPressed: ex.just, yPressed: ey.just,
      aReleased: ea.up, bReleased: eb.up, xReleased: ex.up, yReleased: ey.up,
      jump, jumpPressed: ejump.just, jumpReleased: ejump.up,
      special, specialPressed: espec.just, specialReleased: espec.up,
      confirmPressed: confirm && !this.padHeld.has("confirm"),
    };
    if (ea.just || eb.just || ex.just || ey.just || ejump.just || espec.just || result.leftPressed || result.rightPressed || result.upPressed || result.downPressed) this.ensureAudio();
    if (confirm) this.padHeld.add("confirm"); else this.padHeld.delete("confirm");
    return result;
  }

  setScreen(screen) {
    this.state.screen = screen;
    this.state.screenFrames = 0;
    if (screen === SCREEN.pause) this.state.pauseIndex = 0;
    // Do not clear the edge that caused this transition.  The originating
    // pointer/key event is consumed at the end of the current tick; clearing
    // it here made the first A/X/touch input disappear when entering battle.
    const touchBattleScreens = new Set([SCREEN.battle, SCREEN.pause]);
    const touchMode = touchBattleScreens.has(screen) ? "battle" : "menu";
    this.touchInput?.setMode(touchMode, { preserveInput: false });
    if (this.headerPause) {
      const pauseAvailable = touchBattleScreens.has(screen);
      this.headerPause.disabled = !pauseAvailable;
      this.headerPause.setAttribute("aria-pressed", screen === SCREEN.pause ? "true" : "false");
      this.headerPause.setAttribute("aria-label", screen === SCREEN.pause ? "Resume battle" : "Pause battle");
    }
    if (screen !== SCREEN.battle) this.state.result = this.state.result || "";
    this.beep(screen === SCREEN.battle ? 330 : 220, 0.045);
    this.syncBgm();
    this.render();
  }

  tickMenu(input) {
    if (input.upPressed) { this.state.menuIndex = (this.state.menuIndex + MENU_ITEMS.length - 1) % MENU_ITEMS.length; this.beep(260); }
    if (input.downPressed) { this.state.menuIndex = (this.state.menuIndex + 1) % MENU_ITEMS.length; this.beep(280); }
    if (input.confirm) this.activateMenu(this.state.menuIndex);
  }

  activateMenu(index) {
    if (index === 0) { this.state.mode = "arcade"; this.setScreen(SCREEN.difficultySelect); }
    else if (index === 1) { this.state.mode = "training"; this.state.trainingSettingsIndex = 0; this.setScreen(SCREEN.characterSelect); }
    else if (index === 2) this.setScreen(SCREEN.howToPlay);
    else if (index === 3) this.setScreen(SCREEN.score);
    else if (index === 4) this.setScreen(SCREEN.settings);
  }

  tickSettings(input) {
    if (input.upPressed) this.state.settingsIndex = (this.state.settingsIndex + SETTINGS_ITEMS.length - 1) % SETTINGS_ITEMS.length;
    if (input.downPressed) this.state.settingsIndex = (this.state.settingsIndex + 1) % SETTINGS_ITEMS.length;
    if (input.confirm) this.activateSettings(this.state.settingsIndex);
    else if (input.cancel) this.setScreen(SCREEN.menu);
  }

  activateSettings(index) {
    if (index === 0) {
      const enabled = !(this.state.bgmEnabled && this.state.seEnabled);
      this.state.bgmEnabled = enabled; this.state.seEnabled = enabled; this.state.sound = enabled;
    } else if (index === 1) {
      this.state.bgmEnabled = !this.state.bgmEnabled;
      this.state.sound = this.state.bgmEnabled || this.state.seEnabled;
    } else if (index === 2) {
      this.state.seEnabled = !this.state.seEnabled;
      this.state.sound = this.state.bgmEnabled || this.state.seEnabled;
    } else if (index === 3) {
      if (debugBuildEnabled()) this.state.debug = !this.state.debug;
    } else if (index === 4) {
      this.save = resetSave(); this.state.sound = true; this.state.bgmEnabled = true; this.state.seEnabled = true; this.state.debug = false;
      this.beep(160, 0.1);
    } else if (index === 5) {
      this.setScreen(SCREEN.menu); return;
    }
    this.save = saveData({ ...this.save, sound: this.state.sound, bgmEnabled: this.state.bgmEnabled, seEnabled: this.state.seEnabled, debug: debugBuildEnabled() && this.state.debug });
    this.syncBgm();
    this.renderPanel();
  }

  tickDifficulty(input) {
    let index = DIFFICULTY_IDS.indexOf(this.state.difficulty);
    if (input.upPressed) index = (index + DIFFICULTY_IDS.length - 1) % DIFFICULTY_IDS.length;
    if (input.downPressed) index = (index + 1) % DIFFICULTY_IDS.length;
    this.state.difficulty = DIFFICULTY_IDS[index];
    if (input.confirm) { this.state.mode = "arcade"; this.state.menuIndex = 0; this.setScreen(SCREEN.characterSelect); }
    else if (input.cancel) this.setScreen(SCREEN.menu);
  }

  tickCharacter(input) {
    const index = CHARACTER_IDS.indexOf(this.state.selectedId);
    let next = index;
    if (input.leftPressed) next = (index + CHARACTER_IDS.length - 1) % CHARACTER_IDS.length;
    if (input.rightPressed) next = (index + 1) % CHARACTER_IDS.length;
    if (input.upPressed) next = (index + CHARACTER_IDS.length - 4) % CHARACTER_IDS.length;
    if (input.downPressed) next = (index + 4) % CHARACTER_IDS.length;
    this.state.selectedId = CHARACTER_IDS[next];
    if (input.confirm) { this.state.color = 1; this.setScreen(SCREEN.colorSelect); }
    else if (input.cancel) this.setScreen(this.state.mode === "training" ? SCREEN.menu : SCREEN.difficultySelect);
  }

  tickColor(input) {
    if (input.leftPressed || input.rightPressed || input.upPressed || input.downPressed) this.state.color = this.state.color === 1 ? 2 : 1;
    if (input.confirm) this.state.mode === "training" ? this.setScreen(SCREEN.trainingSettings) : this.startMatch();
    else if (input.cancel) this.setScreen(SCREEN.characterSelect);
  }

  tickTrainingSettings(input) {
    const items = TRAINING_SETTINGS_ITEMS;
    if (input.upPressed) this.state.trainingSettingsIndex = (this.state.trainingSettingsIndex + items.length - 1) % items.length;
    if (input.downPressed) this.state.trainingSettingsIndex = (this.state.trainingSettingsIndex + 1) % items.length;
    if (input.confirm) {
      const index = this.state.trainingSettingsIndex;
      if (index === 0) this.startTraining();
      else if (index === 1) this.state.trainingCpuMove = !this.state.trainingCpuMove;
      else if (index === 2) this.state.trainingCpuAttack = !this.state.trainingCpuAttack;
      else if (index === 3) this.setScreen(SCREEN.colorSelect);
    } else if (input.cancel) this.setScreen(SCREEN.colorSelect);
  }

  startMatch() {
    this.state.mode = "arcade";
    this.state.stage = 1;
    this.state.round = 1;
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.continueUsed = 0;
    this.state.score = 0;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.justGuards = 0;
    this.state.specialHits = 0;
    this.state.roundLosses = 0;
    this.state.finalStats = null;
    this.state.perfect = true;
    this.resetRoundCarry();
    this.startStage();
  }

  startTraining() {
    this.state.mode = "training";
    this.state.stage = 1;
    this.state.round = 1;
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.score = 0;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.justGuards = 0;
    this.state.specialHits = 0;
    this.state.trainingDamage = 0;
    this.resetRoundCarry();
    this.state.combatNotice = { text: "", kind: "", damage: 0, x: 240, y: 120, frames: 0 };
    this.beginTrainingRound();
  }

  startStage() {
    this.state.stageFrame = 0;
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.round = 1;
    this.state.stageBonusAwarded = false;
    this.resetRoundCarry();
    this.setScreen(SCREEN.stageIntro);
  }

  resetRoundCarry() {
    this.state.roundCarry = { meter: 0, specialGauge: 0, skillGauge: 0, ammo: 0, copyCharges: 0 };
    this.state.cpuRoundCarry = { meter: 0, specialGauge: 0, skillGauge: 0, ammo: 0, copyCharges: 0 };
  }

  captureRoundCarry() {
    const capture = (fighter) => {
      if (!fighter) return null;
      const skill = fighter.skill || {};
      return {
        meter: clamp(Number(fighter.meter) || 0, 0, MAX_METER),
        specialGauge: clamp(Number(fighter.specialGauge ?? fighter.meter) || 0, 0, MAX_METER),
        skillGauge: clamp(Number(fighter.skillGauge ?? skill.gauge) || 0, 0, Number(fighter.skillGaugeMax || skill.gaugeMax || 100)),
        ammo: Math.max(0, Number(fighter.ammo ?? fighter.skillAmmo) || 0),
        copyCharges: Math.max(0, Number(fighter.copyCharges ?? fighter.copy?.charges) || 0),
        copiedSkillId: fighter.copiedSkillId || fighter.copy?.skillId || null,
        copiedSkillUses: Math.max(0, Number(fighter.copiedSkillUses ?? fighter.copy?.uses) || 0),
      };
    };
    const playerCarry = capture(this.player);
    const cpuCarry = capture(this.cpu);
    if (playerCarry) this.state.roundCarry = playerCarry;
    if (cpuCarry) this.state.cpuRoundCarry = cpuCarry;
  }

  beginRound() {
    const opponentId = stageOpponent(this.state.stage, this.state.selectedId);
    this.player = createFighterState(this.state.selectedId, 150, 1);
    this.cpu = createFighterState(opponentId, 330, -1);
    this.player.color = this.state.color;
    this.cpu.color = opponentId === this.state.selectedId ? (this.state.color === 1 ? 2 : 1) : 1;
    this.player.boxProfile = "standing";
    this.cpu.boxProfile = "standing";
    this.restoreRoundCarry(this.player);
    this.restoreRoundCarry(this.cpu, this.state.cpuRoundCarry);
    this.state.timerFrames = ROUND_TIME_SECONDS * FIXED_HZ;
    this.state.battleFrames = 0;
    this.state.koFrames = 0;
    this.projectiles = [];
    this.skillEntities = [];
    this.state.skillEntities = [];
    this.state.vfx = [];
    this.state.effects = this.state.vfx;
    this.setScreen(SCREEN.roundIntro);
  }

  beginTrainingRound() {
    // Keep a predictable dummy opponent while allowing every selected fighter
    // to be practiced, including Toko (who otherwise mirrors himself).
    const opponentId = this.state.selectedId === "toko" ? "guitar-boy" : "toko";
    this.player = createFighterState(this.state.selectedId, 150, 1);
    this.cpu = createFighterState(opponentId, 330, -1);
    this.player.color = this.state.color;
    this.cpu.color = this.state.color === 1 ? 2 : 1;
    this.player.boxProfile = "standing";
    this.cpu.boxProfile = "standing";
    this.restoreRoundCarry(this.player);
    this.restoreRoundCarry(this.cpu, this.state.cpuRoundCarry);
    this.state.timerFrames = Number.POSITIVE_INFINITY;
    this.state.stageFrame = 0;
    this.state.battleFrames = 0;
    this.projectiles = [];
    this.skillEntities = [];
    this.state.skillEntities = [];
    this.state.vfx = [];
    this.state.effects = this.state.vfx;
    this.setScreen(SCREEN.roundIntro);
  }

  restoreRoundCarry(fighter, carryOverride = null) {
    const carry = carryOverride || this.state.roundCarry || {};
    if (!fighter || this.state.mode === "training") return;
    fighter.meter = clamp(Number(carry.meter) || 0, 0, MAX_METER);
    fighter.specialGauge = fighter.meter;
    fighter.skillGauge = clamp(Number(carry.skillGauge) || 0, 0, Number(fighter.skillGaugeMax || 100));
    fighter.skill.gauge = fighter.skillGauge;
    fighter.ammo = Math.max(0, Number(carry.ammo) || 0);
    fighter.skillAmmo = fighter.ammo;
    fighter.copyCharges = Math.max(0, Number(carry.copyCharges) || 0);
    fighter.copy.charges = fighter.copyCharges;
    fighter.copiedSkillId = carry.copiedSkillId || fighter.copiedSkillId || null;
    fighter.copiedSkillUses = Math.max(0, Number(carry.copiedSkillUses) || 0);
  }

  tickBattle(input) {
    const training = this.state.mode === "training";
    const cinematic = this.state.specialCinematic;
    if (cinematic) {
      cinematic.frames -= 1;
      this.updateVfx();
      if (cinematic.frames <= 0) {
        this.state.specialCinematic = null;
        this.commitSpecial(cinematic.fighter, cinematic.move);
      }
      return;
    }
    if (!training && this.state.koFrames > 0) {
      this.state.koFrames += 1;
      if (this.state.koFrames % 3 === 0) {
        advanceVisualSequence(this.player);
        advanceVisualSequence(this.cpu);
      }
      if (this.state.koFrames >= 72) this.finishRound();
      return;
    }
    if (!training) this.state.timerFrames = Math.max(0, this.state.timerFrames - 1);
    this.state.stageFrame += 1;
    this.state.battleFrames = Number(this.state.battleFrames || 0) + 1;
    this.state.comboTimer = Math.max(0, this.state.comboTimer - 1);
    if (this.state.comboTimer === 0) {
      this.state.combo = 0;
      for (const fighter of [this.player, this.cpu]) { if (fighter) { fighter.comboHits = 0; fighter.combo = 0; fighter.comboFinished = false; } }
    }
    if (this.state.combatNotice?.frames > 0) this.state.combatNotice.frames -= 1;
    if (this.state.hitstopFrames > 0) {
      this.state.hitstopFrames -= 1;
      this.updateVfx();
      return;
    }
    this.updateThrowSequence();
    this.updateFighter(this.player, input, true);
    const cpuIntroLocked = !training && this.state.battleFrames <= FIXED_HZ;
    const plan = training || cpuIntroLocked ? null : aiPlan({ self: this.cpu, opponent: this.player, difficulty: this.state.difficulty, nowFrame: this.frame });
    const aiInput = training ? this.trainingInput() : this.inputForPlan(cpuIntroLocked ? null : plan);
    this.updateFighter(this.cpu, aiInput, false);
    if (!this.player.thrownBy && !this.cpu.thrownBy) resolvePushboxes(this.player, this.cpu);
    this.player.facing = this.player.x <= this.cpu.x ? 1 : -1;
    this.cpu.facing = -this.player.facing;
    this.handleCombat(this.player, this.cpu);
    this.handleCombat(this.cpu, this.player);
    this.updateProjectiles();
    this.updateSkillEntities();
    this.updateVfx();
    if (training) this.resetTrainingDamageDummy();
    else if (this.player.hp <= 0 || this.cpu.hp <= 0) this.startKoSequence();
    else if (this.state.timerFrames <= 0) this.finishRound();
  }

  startKoSequence() {
    if (this.state.koFrames > 0 || this.state.screen !== SCREEN.battle) return;
    this.state.koFrames = 1;
    this.projectiles = [];
    this.skillEntities = [];
    this.state.skillEntities = [];
    const loser = this.player.hp <= 0 ? this.player : this.cpu;
    const winner = loser === this.player ? this.cpu : this.player;
    loser.state = "defeat"; loser.action = "defeat"; loser.actionFrame = 0;
    winner.state = "victory"; winner.action = "victory"; winner.actionFrame = 0;
    setVisualSequence(loser, [{ name: "knockdown", duration: 12 }, { name: "defeat", duration: 36 }]);
    setVisualSequence(winner, [{ name: "victory", duration: 48 }]);
    this.showCombatNotice("K.O.", "ko", 0, loser);
  }

  updateThrowSequence() {
    for (const attacker of [this.player, this.cpu]) {
      const defender = attacker?.throwTarget;
      const move = attacker?.currentMove;
      if (!defender || !move || move.kind !== "throw") continue;
      defender.x = clamp(attacker.x + attacker.facing * 22, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
      defender.y = 0; defender.vx = 0; defender.vy = 0; defender.grounded = true;
      defender.facing = -attacker.facing; defender.state = "grabbed"; defender.action = "thrown";
      if (!attacker.throwReleased && attacker.actionFrame >= move.startupFrames + move.activeFrames + 6) {
        attacker.throwReleased = true;
        const damage = applyDamage(defender, Number(move.damage || 0) * Number(attacker.buff?.attackScale || 1), { knockbackX: 6, knockbackY: 3, hitstunFrames: move.hitstunFrames });
        defender.thrownBy = null;
        this.launchKnockdown(defender, move);
        attacker.throwTarget = null;
        setVisualSequence(defender, [{ name: "thrown", duration: 5 }, { name: "knockdown", duration: 10 }]);
        setVisualSequence(attacker, [{ name: "throw_success", duration: 12 }]);
        this.onHit(attacker, defender, move, false, true, damage);
      }
    }
  }

  trainingInput() {
    const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
    if (this.state.trainingCpuMove) {
      const direction = this.cpu.x < this.player.x ? 1 : -1;
      blank[direction < 0 ? "left" : "right"] = true;
    }
    if (this.state.trainingCpuAttack && this.frame % 36 === 0) {
      const distance = Math.abs(this.cpu.x - this.player.x);
      if (distance < 130) {
        blank.light = true;
        blank.lightPressed = true;
      } else {
        blank.strong = true;
        blank.strongPressed = true;
      }
    }
    return blank;
  }

  resetTrainingDamageDummy() {
    if (this.cpu.hp <= 0) {
      const id = this.cpu.id;
      const color = this.cpu.color;
      this.cpu = createFighterState(id, 330, -1);
      this.cpu.color = color;
    }
    if (this.player.hp <= 0) {
      this.player.hp = this.player.maxHp || MAX_HP;
      this.player.state = "idle";
      this.player.action = "idle";
      this.player.actionFrame = 0;
      this.player.stunFrames = 0;
      this.player.grounded = true;
      this.player.y = 0;
      this.player.vy = 0;
      this.player.boxProfile = "standing";
    }
  }

  inputForPlan(plan) {
    const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, skill: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, skillPressed: false, skillReleased: false, specialPressed: false, throwPressed: false };
    if (!plan) return blank;
    if (plan.action === "walk") { blank[plan.direction < 0 ? "left" : "right"] = true; }
    else if (plan.action === "guard") blank.guard = true;
    else if (plan.action === "guard_low") { blank.guard = true; blank.down = true; }
    else if (plan.action === "jump") { blank.up = true; blank.upPressed = true; }
    else if (plan.action === "light") { blank.light = true; blank.lightPressed = true; }
    else if (plan.action === "strong") { blank.strong = true; blank.strongPressed = true; }
    else if (plan.action === "skill") {
      this.cpuSkillLifecycle = this.cpuSkillLifecycle || { issuedAt: null, started: false, releaseSent: false };
      if (this.cpuSkillLifecycle.issuedAt !== plan.issuedAt) this.cpuSkillLifecycle = { issuedAt: plan.issuedAt, started: false, releaseSent: false };
      if (plan.released) {
        if (!this.cpuSkillLifecycle.releaseSent) { blank.skillReleased = true; this.cpuSkillLifecycle.releaseSent = true; }
      } else {
        blank.skill = true; blank.skillHeld = true; blank.skillHoldRequired = false;
        if (!this.cpuSkillLifecycle.started) { blank.skillPressed = true; this.cpuSkillLifecycle.started = true; }
      }
    }
    else if (plan.action === "special") { blank.special = true; blank.specialPressed = true; }
    else if (plan.action === "throw") { blank.throwHeld = true; blank.throwPressed = true; }
    return blank;
  }

  updateFighter(fighter, input, isPlayer) {
    input = input || {};
    const character = CHARACTERS[fighter.id];
    const stats = character.stats || {};
    if (fighter.comboBuffer) {
      fighter.comboBuffer.frames = Math.max(0, Number(fighter.comboBuffer.frames || 0) - 1);
      if (fighter.comboBuffer.frames <= 0) fighter.comboBuffer = null;
    }
    advanceVisualSequence(fighter);
    if (fighter.state === "grabbed") return;
    if (fighter.hitstopFrames > 0 || fighter.hitstopRemaining > 0) {
      fighter.hitstopFrames = Math.max(0, fighter.hitstopFrames - 1);
      fighter.hitstopRemaining = Math.max(0, fighter.hitstopRemaining - 1);
      return;
    }
    fighter.invulnerableFrames = Math.max(0, fighter.invulnerableFrames - 1);
    fighter.guardDashCooldown = Math.max(0, Number(fighter.guardDashCooldown) - 1);
    fighter.tackleCooldown = Math.max(0, Number(fighter.tackleCooldown || 0) - 1);
    fighter.slimeCooldown = Math.max(0, Number(fighter.slimeCooldown || 0) - 1);
    fighter.attackCooldownFrames = Math.max(0, Number(fighter.attackCooldownFrames || 0) - 1);
    if (fighter.buff?.frames > 0) {
      fighter.buff.frames -= 1;
      if (fighter.id === "kazushige" && fighter.buff.durationFrames) {
        fighter.skillGauge = clamp(Number(fighter.buff.chargeMax || 100) * fighter.buff.frames / fighter.buff.durationFrames, 0, Number(fighter.buff.chargeMax || 100));
        fighter.skill.gauge = fighter.skillGauge; fighter.gauge.skill = fighter.skillGauge;
      }
      if (fighter.buff.frames <= 0) {
        fighter.buff = null;
        if (fighter.id === "kazushige") { fighter.skillGauge = 0; fighter.skill.gauge = 0; fighter.gauge.skill = 0; }
      }
    }
    if (fighter.flashStunFrames > 0) {
      fighter.flashStunFrames -= 1;
      fighter.flashStunned = fighter.flashStunFrames > 0;
      if (!fighter.flashStunned && fighter.state === "hitstun") {
        fighter.stunFrames = 0;
        fighter.state = fighter.grounded ? "idle" : "jumping";
        fighter.flashComboHit = false;
        // A generic stun can follow a training hit that interrupted a down
        // state. Once the stun expires, clear the stale down latch so the
        // dummy can be hit again without requiring a down follow-up.
        fighter.downed = false;
        fighter.downedFrames = 0;
        fighter.downTimer = 0;
      }
    }
    fighter.wakeupInvulnerableFrames = Math.max(0, Number(fighter.wakeupInvulnerableFrames) - 1);
    if (fighter.state === "wakeupInvulnerable") {
      fighter.wakeupInvulnerable = fighter.wakeupInvulnerableFrames > 0;
      if (fighter.wakeupInvulnerableFrames <= 0) { fighter.state = "idle"; fighter.wakeupState = "idle"; fighter.actionFrame = 0; }
      else { fighter.boxProfile = "standing"; fighter.action = "wakeup"; fighter.actionFrame += 1; return; }
    }
    if (fighter.stunFrames > 0) {
      fighter.stunFrames -= 1;
      if (fighter.stunFrames === 0 && fighter.hp > 0) {
        fighter.state = fighter.grounded ? "idle" : "jumping";
        fighter.downed = false;
        fighter.downedFrames = 0;
        fighter.downTimer = 0;
      }
      return;
    }
    if (fighter.state === "knockback") {
      this.advanceAir(fighter, input, stats);
      if (fighter.grounded) this.beginKnockdownLanding(fighter);
      return;
    }
    if (fighter.state === "knockdownLanding") {
      fighter.boxProfile = "down"; fighter.action = "knockdown"; fighter.downedFrames += 1; fighter.actionFrame += 1;
      if (fighter.downedFrames >= DOWN_LANDING_FRAMES) { fighter.state = "downed"; fighter.action = "down_idle"; fighter.actionFrame = 0; }
      return;
    }
    if (fighter.state === "downed" || fighter.state === "groundHit" || fighter.state === "knockdown") {
      fighter.downed = true; fighter.boxProfile = "down"; fighter.action = fighter.downedFrames < 10 ? "knockdown" : "down_idle";
      fighter.downedFrames += 1; fighter.downTimer = fighter.downedFrames; fighter.actionFrame += 1;
      const autoWake = fighter.hardKnockdown ? DOWN_HARD_WAKEUP_FRAMES : DOWN_WAKEUP_FRAMES;
      if (fighter.hp > 0 && fighter.downedFrames >= autoWake) this.startWakeup(fighter);
      return;
    }
    if (fighter.state === "wakeup") {
      fighter.boxProfile = "standing"; fighter.action = "wakeup"; fighter.actionFrame += 1;
      if (fighter.actionFrame >= WAKEUP_FRAMES) this.startWakeupInvulnerable(fighter);
      return;
    }
    if (fighter.state === "guardDash") {
      if (input.lightPressed || input.strongPressed) { fighter.guardDashActive = false; fighter.guardDash.active = false; fighter.guardDashCooldown = GUARD_DASH_COOLDOWN; fighter.state = "idle"; this.startAttack(fighter, input); return; }
      fighter.guardDashFrames += 1; fighter.guardDashActive = true; fighter.guardDash.active = true;
      fighter.vx = fighter.facing * (stats.dashSpeed || stats.speed) * 1.2;
      fighter.x += fighter.vx; fighter.state = fighter.guardDashFrames < GUARD_DASH_FRAMES ? "guardDash" : "idle";
      fighter.action = fighter.state === "idle" ? "idle" : "guard_dash";
      if (fighter.guardDashFrames >= GUARD_DASH_FRAMES) { fighter.guardDashActive = false; fighter.guardDash.active = false; fighter.guardDashCooldown = GUARD_DASH_COOLDOWN; }
      fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
      return;
    }
    if (fighter.skillPhase && fighter.skillPhase !== "skillUnavailable") {
      this.updateSkill(fighter, input, isPlayer);
      return;
    }
    if (fighter.state === "attacking" || fighter.state === "throwing") {
      fighter.actionFrame += 1;
      const move = fighter.currentMove;
      if (move && !fighter.attackVfxSpawned && move.kind === "normal" && fighter.actionFrame >= Number(move.startupFrames || 0)) {
        const point = this.attackReachPoint(fighter, move);
        const strong = Boolean(move.id?.includes("strong") || move.id?.includes("forward_light"));
        const style = move.kind === "normal" ? CHARACTERS[fighter.id]?.normalAttackVfx : null;
        const baseScale = strong ? 0.72 : 0.58;
        this.spawnVfx("attack-wind", point, {
          x: 0, y: Number(style?.offsetY || 0), scale: baseScale * Number(style?.scale || 1), tint: style?.color || null,
          facing: fighter.facing, tipAnchored: true, owner: fighter.id,
        });
        this.beep(strong ? 150 : 360, strong ? 0.055 : 0.035, strong ? "sawtooth" : "triangle");
        fighter.attackVfxSpawned = true;
      }
      if (move?.specialType === "projectile" && fighter.pendingProjectile && !fighter.projectileSpawned && fighter.actionFrame >= move.startupFrames) {
        this.projectiles.push(createProjectile(fighter === this.player ? "player" : "cpu", fighter, move, this.frame));
        fighter.projectileSpawned = true; fighter.pendingProjectile = null;
      }
      const finished = !move || fighter.actionFrame > move.startupFrames + move.activeFrames + move.recoveryFrames;
      if (finished) {
        if (move?.downFollowup) {
          const target = fighter === this.player ? this.cpu : this.player;
          if (target?.followupAttacker === fighter) { target.followupReserved = false; target.followupAttacker = null; }
        }
        const buffered = fighter.comboBuffer?.input;
        const canBuffer = Boolean(buffered && fighter.hitConfirmed && fighter.comboHits < getComboLimit(CHARACTERS[fighter.id]));
        if (fighter.forceWakeupAfterFollowup) { fighter.forceWakeupAfterFollowup = false; fighter.downed = false; this.startWakeup(fighter); }
        else { fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.actionFrame = 0; }
        if (!fighter.hitConfirmed) { fighter.comboHits = 0; fighter.combo = 0; fighter.comboTimer = 0; }
        fighter.currentMove = null; fighter.hitRegistry.clear(); fighter.hitConfirmed = false; fighter.pendingProjectile = null; fighter.projectileSpawned = false;
        fighter.comboBuffer = null;
        if (canBuffer && fighter.state !== "wakeup") this.startAttack(fighter, buffered);
      } else if (input.lightPressed || input.strongPressed) {
        const recoveryStart = move.startupFrames + move.activeFrames;
        if (fighter.actionFrame >= recoveryStart - 2) fighter.comboBuffer = { input: { ...input }, frames: COMBO_BUFFER_FRAMES };
      }
      this.applyMoveMotion(fighter, move);
      if (!fighter.grounded) this.advanceAir(fighter, input, stats);
      return;
    }
    if (fighter.grounded && fighter.locomotionAction === "backstep" && fighter.locomotionFramesRemaining > 0) {
      fighter.action = "backstep";
      fighter.actionFrame += 1;
      fighter.state = "moving";
      fighter.vx = -fighter.facing * (stats.backstepDistance || 36) / BACKSTEP_LOCK_FRAMES;
      fighter.locomotionFramesRemaining -= 1;
      if (fighter.locomotionFramesRemaining <= 0) fighter.locomotionAction = "";
      fighter.x += fighter.vx;
      fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
      return;
    }
    const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (fighter.grounded && fighter.platformY > 0) {
      const supported = this.stagePlatforms().some((entry) => fighter.x >= entry.x && fighter.x <= entry.x + entry.w && Math.abs(entry.y - fighter.platformY) < 0.5);
      if (!supported) { fighter.grounded = false; fighter.platformY = 0; fighter.vy = 0; fighter.state = "jumping"; fighter.action = "jump_fall"; fighter.boxProfile = "air"; }
    }
    if (fighter.grounded && fighter.platformY > 0 && input.down) {
      fighter.grounded = false; fighter.dropThroughFrames = 12; fighter.platformY = 0; fighter.vy = -1; fighter.state = "jumping"; fighter.action = "jump_fall"; fighter.boxProfile = "air";
    }
    if (input.jumpPressed || (input.upPressed && fighter.grounded && fighter.jumpsUsed === 0)) this.tryJump(fighter, stats);
    const moveLocked = ACTION_LOCK_STATES.has(fighter.state);
    const forward = direction === fighter.facing;
    if (!moveLocked && input.throwPressed && !fighter.downed && !fighter.flashStunned) this.startThrow(fighter);
    else if (!moveLocked && input.skillPressed) this.startSkill(fighter, input);
    else if (!moveLocked && input.specialPressed && !fighter.downed && !fighter.flashStunned) this.startSpecial(fighter);
    else if (!moveLocked && (input.lightPressed || input.strongPressed)) this.startAttack(fighter, input);
    else if (!moveLocked && fighter.grounded && input.guard && forward && input.guardPressed && fighter.guardDashCooldown <= 0) this.startGuardDash(fighter);
    else if (!moveLocked && fighter.grounded && input.guard) {
      fighter.state = "guarding"; fighter.action = input.down ? "guard_low" : "guard_high"; fighter.boxProfile = input.down ? "crouch" : "standing";
      if (!fighter.guardHeld) fighter.guardStartedFrame = this.frame;
      fighter.guardHeld = true;
    } else {
      fighter.guardHeld = false;
      if (fighter.grounded) {
        const wasCrouching = Boolean(fighter.crouching);
        fighter.crouching = Boolean(input.down); fighter.boxProfile = input.down ? "crouch" : "standing";
        if (fighter.crouching && !wasCrouching) setVisualSequence(fighter, [{ name: "crouch_start", duration: 8 }]);
        else if (!fighter.crouching && wasCrouching) setVisualSequence(fighter, [{ name: "crouch_end", duration: 8 }]);
        if (direction !== 0 && !input.down) {
          const directionPressed = Boolean(input.leftPressed || input.rightPressed);
          // Two identical direction edges within 250 ms (15 fixed frames)
          // trigger dash/backstep; held input alone never qualifies.
          const doubleTap = directionPressed && this.frame - fighter.lastDirectionFrame <= 15 && direction === fighter.lastDirection;
          const isBackstep = doubleTap && direction === -fighter.facing;
          const nextAction = isBackstep ? "backstep" : direction === fighter.facing ? "dash" : "walk_backward";
          fighter.actionFrame = fighter.action === nextAction ? fighter.actionFrame + 1 : 0;
          fighter.action = nextAction;
          const backwardSpeed = (stats.walkSpeed || stats.speed) * 1.45;
          fighter.vx = isBackstep ? -fighter.facing * (stats.backstepDistance || 36) / BACKSTEP_LOCK_FRAMES : direction * (direction === fighter.facing ? (stats.dashSpeed || stats.speed) : backwardSpeed);
          if (isBackstep) { fighter.invulnerableFrames = 5; fighter.locomotionAction = "backstep"; fighter.locomotionFramesRemaining = BACKSTEP_LOCK_FRAMES - 1; }
          if (directionPressed) { fighter.lastDirection = direction; fighter.lastDirectionFrame = this.frame; }
          fighter.state = "moving";
        } else {
          fighter.vx *= 0.65; fighter.state = input.down ? "crouching" : "idle"; fighter.action = input.down ? "crouch" : "idle"; fighter.actionFrame = 0;
        }
      } else {
        fighter.state = "jumping"; fighter.actionFrame += 1; fighter.action = fighter.vy > 0 ? "jump_up" : "jump_fall"; fighter.vx = direction * (stats.speed || 2) * (stats.airControl || 1);
      }
    }
    fighter.x += fighter.vx; this.advanceAir(fighter, input, stats);
    fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
  }

  advanceAir(fighter, input = {}, stats = {}) {
    if (fighter.grounded) return;
    fighter.airFrames = (fighter.airFrames || 0) + 1;
    if (input.jumpReleased && fighter.vy > 0) fighter.vy = Math.min(fighter.vy, 1.5);
    const previousY = fighter.y;
    fighter.vy -= GRAVITY; fighter.y = clamp(fighter.y + fighter.vy, 0, MAX_JUMP_HEIGHT);
    fighter.dropThroughFrames = Math.max(0, Number(fighter.dropThroughFrames || 0) - 1);
    const platform = fighter.dropThroughFrames <= 0 && fighter.vy <= 0
      ? this.stagePlatforms().find((entry) => fighter.x >= entry.x && fighter.x <= entry.x + entry.w && previousY >= entry.y && fighter.y <= entry.y)
      : null;
    if (platform) {
      fighter.y = platform.y; fighter.vy = 0; fighter.grounded = true; fighter.platformY = platform.y;
      fighter.airFrames = 0; fighter.jumpsUsed = 0; fighter.doubleJumpAvailable = true; fighter.state = "idle"; fighter.action = "landing"; fighter.actionFrame = 0; fighter.boxProfile = "standing";
      return;
    }
    if (fighter.y <= 0 || fighter.airFrames >= MAX_AIR_FRAMES) {
      fighter.y = 0; fighter.vy = 0; fighter.grounded = true; fighter.platformY = 0; fighter.airFrames = 0; fighter.jumpsUsed = 0; fighter.doubleJumpAvailable = true; fighter.state = "idle"; fighter.action = "landing"; fighter.actionFrame = 0; fighter.boxProfile = "standing";
    } else fighter.boxProfile = "air";
    fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
  }

  tryJump(fighter, stats = {}) {
    if (fighter.grounded && fighter.platformY > 0 && fighter.dropThroughRequested) {
      fighter.grounded = false; fighter.dropThroughFrames = 12; fighter.dropThroughRequested = false; fighter.platformY = 0; fighter.vy = -1; fighter.state = "jumping"; fighter.action = "jump_fall"; return;
    }
    if (fighter.grounded && fighter.jumpsUsed === 0) {
      fighter.vy = Number(stats.jumpPower || stats.jumpVelocity || 8) * JUMP_TAKEOFF_MULTIPLIER; fighter.grounded = false; fighter.platformY = 0; fighter.airFrames = 0; fighter.jumpsUsed = 1; fighter.state = "jumping"; fighter.action = "jump_start"; fighter.boxProfile = "air";
    } else if (!fighter.grounded && fighter.doubleJumpAvailable) {
      fighter.vy = Number(stats.jumpPower || stats.jumpVelocity || 8) * 1.2 * JUMP_TAKEOFF_MULTIPLIER; fighter.doubleJumpAvailable = false; fighter.jumpsUsed = 2; fighter.airFrames = 0; fighter.state = "jumping"; fighter.action = "double_jump"; fighter.boxProfile = "air";
    }
  }

  stagePlatforms() {
    if (![SCREEN.battle, SCREEN.pause, SCREEN.roundResult].includes(this.state.screen)) return [];
    return STAGES[this.state.stage - 1]?.platforms || [];
  }

  beginKnockdownLanding(fighter, hard = fighter.hardKnockdown) {
    fighter.state = "knockdownLanding"; fighter.action = "knockdown"; fighter.actionFrame = 0; fighter.downed = true; fighter.downedFrames = 0; fighter.downTimer = 0; fighter.downStartedFrame = this.frame; fighter.hardKnockdown = Boolean(hard); fighter.followupAvailable = true; fighter.followupReserved = false; fighter.downFollowupUsed = false; fighter.followupUsed = false; fighter.followupCount = 0; fighter.boxProfile = "down"; fighter.grounded = true; fighter.y = 0;
    this.spawnVfx("down-impact", fighter, { x: 0, y: 24 });
  }

  launchKnockdown(fighter, move = {}) {
    fighter.state = "knockback";
    fighter.action = "knockback";
    fighter.actionFrame = 0;
    fighter.stunFrames = 0;
    fighter.downed = false;
    fighter.downedFrames = 0;
    fighter.downTimer = 0;
    fighter.hardKnockdown = Boolean(move.hardKnockdown);
    fighter.grounded = false;
    fighter.y = Math.max(1, Number(fighter.y || 0));
    fighter.vy = Math.max(3.8, Math.abs(Number(move.knockbackY || fighter.vy || 0)));
    fighter.airFrames = 0;
    fighter.boxProfile = "air";
    setVisualSequence(fighter, [{ name: "air_hit", duration: 8 }, { name: "knockback", duration: 12 }]);
  }

  startWakeup(fighter) {
    fighter.state = "wakeup"; fighter.wakeupState = "wakeup"; fighter.action = "wakeup"; fighter.actionFrame = 0; fighter.downed = false; fighter.downValue = 0; fighter.knockdownValue = 0; fighter.followupReserved = false; fighter.followupAttacker = null; fighter.boxProfile = "standing"; fighter.grounded = true; fighter.y = 0;
  }

  startWakeupInvulnerable(fighter) {
    fighter.state = "wakeupInvulnerable"; fighter.wakeupState = "wakeupInvulnerable"; fighter.action = "wakeup"; fighter.actionFrame = 0; fighter.wakeupInvulnerable = true; fighter.wakeupInvulnerableFrames = WAKEUP_INVULN_FRAMES; fighter.invulnerableFrames = WAKEUP_INVULN_FRAMES; fighter.downed = false; fighter.downValue = 0; fighter.knockdownValue = 0; fighter.followupReserved = false; fighter.followupAttacker = null; fighter.boxProfile = "standing";
  }

  startGuardDash(fighter) {
    fighter.state = "guardDash"; fighter.action = "guard_dash"; fighter.actionFrame = 0; fighter.guardDashFrames = 0; fighter.guardDashActive = true; fighter.guardDash.active = true; fighter.guardDashState = "guardDash"; fighter.guardDashInvulnerableFrames = GUARD_DASH_GUARD_FRAMES; fighter.guardDash.invulnerableFrames = GUARD_DASH_GUARD_FRAMES; fighter.guardHeld = false; fighter.crouching = false; fighter.boxProfile = "standing";
  }

  applyMoveMotion(fighter, move) {
    if (!move) return;
    if (move.kind === "special" && move.movement) fighter.x += fighter.facing * move.movement;
    if (move.id === "forward_light" && move.movement && fighter.actionFrame <= move.startupFrames + move.activeFrames) fighter.x += fighter.facing * move.movement;
    fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
  }

  startAttack(fighter, input) {
    if (!fighter || fighter.hp <= 0 || fighter.downed || ["wakeup", "knockdownLanding", "downed", "groundHit"].includes(fighter.state)) return false;
    if (Number(fighter.attackCooldownFrames || 0) > 0) return false;
    const wakeupLocked = Number(fighter.wakeupInvulnerableFrames || 0) > 0 && (fighter.wakeupInvulnerable === true || fighter.state === "wakeupInvulnerable");
    if (wakeupLocked) return false;
    const airborne = !fighter.grounded;
    const crouch = Boolean(input.down || fighter.crouching);
    const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const forwardLight = input.lightPressed && !airborne && !crouch && direction === fighter.facing;
    const lightInput = Boolean(input.lightPressed) && !input.strongPressed;
    if (lightInput && fighter.comboHits >= getComboLimit(CHARACTERS[fighter.id]) && fighter.comboTimer > 0) return false;
    const comboActive = lightInput && fighter.comboHits > 0 && fighter.comboTimer > 0 && !fighter.comboFinished;
    let key = forwardLight ? "forward_light" : input.strongPressed ? (airborne ? "strong_attack_air" : crouch ? "strong_attack_crouch" : "strong_attack_neutral") : (airborne ? "light_attack_air" : crouch ? "light_attack_crouch" : "light_attack_neutral");
    const base = CHARACTERS[fighter.id].moves[key];
    const target = fighter === this.player ? this.cpu : this.player;
    const wantsDownFollowup = Boolean(target?.downed && input.down && (input.lightPressed || input.strongPressed));
    const downFollowup = wantsDownFollowup && canDownFollowup(target, this.frame) && !target.followupReserved;
    if (wantsDownFollowup && !downFollowup) return false;
    if (downFollowup) {
      target.followupReserved = true;
      target.followupAttacker = fighter;
    }
    if (lightInput && !airborne) {
      const side = ((fighter.comboHits || 0) % 2 === 0) ? "left" : "right";
      const variantId = `${forwardLight ? "forward_light" : "light"}_${side}`;
      key = variantId;
      fighter.currentMove = { ...base, id: variantId, comboIndex: fighter.comboHits || 0, comboActive, downFollowup, hitbox: base?.hitbox ? { ...base.hitbox } : null };
    } else fighter.currentMove = downFollowup ? { ...base, downFollowup } : base;
    if (!fighter.currentMove) return false;
    fighter.action = key;
    fighter.state = "attacking";
    fighter.actionFrame = 0;
    fighter.attackInstanceId = Number(fighter.attackInstanceId || 0) + 1;
    fighter.currentAttackId = `${fighter.id}:${fighter.attackInstanceId}`;
    fighter.hitRegistry.clear();
    if (fighter.alreadyHitTargets instanceof Set) fighter.alreadyHitTargets.clear();
    else fighter.alreadyHitTargets = new Set();
    fighter.hitConfirmed = false;
    fighter.attackVfxSpawned = false;
    fighter.comboLastMove = key;
    fighter.comboBuffer = null;
    fighter.locomotionAction = "";
    fighter.locomotionFramesRemaining = 0;
    fighter.wakeupInvulnerable = false;
    fighter.wakeupInvulnerableFrames = 0;
    return true;
  }

  startSkill(fighter, input = {}) {
    const config = getSkillConfig(fighter?.id);
    if (!config || !fighter || fighter.hp <= 0 || fighter.flashStunned || (config.type === "tackle" && Number(fighter.tackleCooldown || 0) > 0) || !canStartSkill(fighter, config)) return false;
    const owner = fighter === this.player ? "player" : "cpu";
    if (config.type === "drumBeat" && this.skillEntities.some((entry) => entry.active && entry.owner === owner && ["snareMarker", "snareImpact"].includes(entry.type))) return false;
    fighter.skillPhase = "skillStartup"; fighter.skillState = "skillStartup"; fighter.skill.phase = "skillStartup";
    fighter.skillCopiedUse = config.type === "copy" && Number(fighter.copiedSkillUses || 0) > 0;
    // A copied skill is a stocked use, not another charge attempt.  B starts
    // its normal startup immediately even when the button is only tapped.
    const holdRequired = config.type !== "ramenBuff" && !fighter.skillCopiedUse && input.skillHoldRequired !== false && (input.skillHoldRequired === true || input.skillPressed === true);
    fighter.skillCharging = false; fighter.skillActive = false; fighter.skillActivated = false; fighter.skillInterrupted = false; fighter.skillInterruptionReason = null; fighter.skillRecoveryFrames = 0; fighter.skillActionFrame = 0; fighter.skillHoldFrames = 0; fighter.skillHoldThresholdFrames = SKILL_HOLD_THRESHOLD_FRAMES; fighter.skillHoldActive = !holdRequired; fighter.skillHoldRequired = holdRequired; fighter.skillCancelled = false; fighter.skillHeld = true; fighter.skillStartFrame = this.frame; fighter.action = "skill_start"; fighter.state = "skillStartup"; fighter.actionFrame = 0; fighter.hitRegistry.clear();
    fighter.skillConfig = config;
    // Stocked copy uses are already paid for by the original full charge.
    // Fire the copied action immediately so the first of the two uses cannot
    // become an empty copy startup (notably when the copied skill is Flash).
    if (fighter.skillCopiedUse) {
      fighter.skillHoldActive = true;
      fighter.skillHoldRequired = false;
      fighter.skillActivated = true;
      this.activateSkill(fighter, config);
      fighter.skillPhase = "skillRecovery"; fighter.skillState = "skillRecovery"; fighter.skill.phase = "skillRecovery";
      fighter.skillRecoveryFrames = config.phase?.recoveryFrames || 1; fighter.state = "skillRecovery"; fighter.action = "skill_recovery"; fighter.skillActionFrame = 0;
      return true;
    }
    // Flash's authored body/shot is rendered by its moving skill entity. Do
    // not seed a second static VFX record during the hold phase.
    if (config.type !== "flash") {
      const midBodyEffect = config.type === "ramenBuff" || config.type === "drumBeat";
      this.spawnVfx(config.effectId, fighter, { x: 0, y: midBodyEffect ? 84 : 0, scale: config.type === "drumBeat" ? 0.48 : undefined });
    }
    return true;
  }

  updateSkill(fighter, input = {}, isPlayer = false) {
    const config = fighter.skillConfig || getSkillConfig(fighter.id);
    if (!config) { fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.state = "idle"; return; }
    if (fighter.hp <= 0) { this.interruptSkillFor(fighter, "ko"); return; }
    const skillHeld = Boolean(input.skill ?? input.skillHeld);
    const released = Boolean(input.skillReleased || !skillHeld);
    // A tap is intentionally inert.  Only after the full 350 ms gesture do
    // we enter the authored startup/charge phases; releasing sooner cancels
    // without consuming gauge, ammo, or copy uses.
    if (!fighter.skillHoldActive) {
      if (released) {
        fighter.skillHoldFrames = 0;
        fighter.skillHoldActive = false;
        fighter.skillCancelled = true;
        fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable";
        fighter.skillCharging = false; fighter.skillActive = false; fighter.state = fighter.hp > 0 ? (fighter.grounded ? "idle" : "jumping") : "defeat"; fighter.action = fighter.state; fighter.actionFrame = 0;
        return;
      }
      fighter.skillHoldFrames = Math.min(Number(fighter.skillHoldThresholdFrames || SKILL_HOLD_THRESHOLD_FRAMES), Number(fighter.skillHoldFrames || 0) + 1);
      fighter.skillHeld = true;
      fighter.state = "skillStartup"; fighter.action = "skill_charge"; fighter.actionFrame = fighter.skillHoldFrames;
      if (fighter.skillHoldFrames < Number(fighter.skillHoldThresholdFrames || SKILL_HOLD_THRESHOLD_FRAMES)) return;
      fighter.skillHoldActive = true;
      fighter.skillActionFrame = 0;
      fighter.skillCharging = config.trigger === "hold-release" || (config.type === "copy" && !fighter.skillCopiedUse);
    }
    fighter.skillActionFrame = (fighter.skillActionFrame || 0) + 1;
    if (config.type === "flash" && Number(fighter.skillAmmo || fighter.ammo || 0) <= 0) {
      if (released && !fighter.flashReloading) {
        fighter.flashReloadFrames = 0; fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.skillActivated = false; fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.action = fighter.state; return;
      }
      if (input.skill) {
        fighter.flashReloading = true;
        fighter.flashReloadFrames = Math.min(Number(config.filmReloadFrames || 36), Number(fighter.flashReloadFrames || 0) + 1);
        fighter.skillPhase = "skillActive"; fighter.skillState = "skillActive"; fighter.skill.phase = "skillActive"; fighter.state = "skillActive"; fighter.action = "skill_reload";
        if (fighter.flashReloadFrames >= Number(config.filmReloadFrames || 36)) {
          fighter.skillAmmo = 3; fighter.ammo = 3; fighter.flashReloading = false; fighter.flashReloadFrames = 0; fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.skillActivated = false; fighter.state = "idle"; fighter.action = "idle";
        }
        return;
      }
      if (released && fighter.flashReloading) { fighter.flashReloadFrames = 0; fighter.flashReloading = false; fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.skillActivated = false; fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.action = fighter.state; return; }
    }
    if (fighter.skillPhase === "skillStartup" && fighter.skillActionFrame >= (config.phase?.startupFrames || 1)) {
      const needsCharge = config.trigger === "hold-release" || (config.type === "copy" && !fighter.skillCopiedUse) || (config.trigger === "hold" && Number(config.chargeRate || 0) > 0);
      fighter.skillPhase = needsCharge && !released ? "skillCharging" : "skillActive";
      fighter.skillState = fighter.skillPhase; fighter.skill.phase = fighter.skillPhase; fighter.state = fighter.skillPhase; fighter.action = fighter.skillPhase;
    }
    if (fighter.skillPhase === "skillCharging") {
      const rate = Number(config.chargeRate || 0) * Number(CHARACTERS[fighter.id].stats.skillChargeRate || 1);
      fighter.skillGauge = clamp((fighter.skillGauge || 0) + rate, 0, Number(config.chargeMax || 100)); fighter.skill.gauge = fighter.skillGauge; fighter.gauge.skill = fighter.skillGauge;
      const requiresFullCharge = config.type === "copy" || config.type === "dogSummon" || config.type === "ramenBuff";
      const autoAtFull = config.type === "drumBeat" || config.type === "ramenBuff";
      if ((autoAtFull && fighter.skillGauge >= Number(config.chargeMax || 100)) || (released && (!requiresFullCharge || fighter.skillGauge >= Number(config.chargeMax || 100)))) { fighter.skillPhase = "skillActive"; fighter.skillState = "skillActive"; fighter.skill.phase = "skillActive"; fighter.state = "skillActive"; fighter.action = "skill_active"; fighter.skillActionFrame = 0; }
      else if (released && requiresFullCharge) { fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.skillCharging = false; fighter.skillActivated = false; fighter.skillCancelled = true; fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.action = fighter.state; fighter.skill.gauge = fighter.skillGauge; fighter.gauge.skill = fighter.skillGauge; }
      else return;
    }
    if (fighter.skillPhase === "skillActive") {
      if (!fighter.skillActivated) { fighter.skillActivated = true; this.activateSkill(fighter, config); }
      // Ramen's 600-frame buff owns its lifetime.  Do not leave the fighter in
      // the generic active/recovery state machine after its automatic full
      // charge activation, or every later fighter update is locked out.
      if (config.type === "ramenBuff" && fighter.skillActivated) {
        fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable";
        fighter.skillActive = false; fighter.skillCharging = false; fighter.skillActivated = false; fighter.skillConfig = null;
        fighter.skillHeld = false; fighter.skillHoldRequired = false; fighter.skillHoldActive = false; fighter.skillHoldFrames = 0; fighter.skillActionFrame = 0;
        fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.action = fighter.state === "idle" ? "idle" : "jump_fall"; fighter.actionFrame = 0;
        return;
      }
      if (config.type === "mirror" && input.skill && fighter.mirrorActiveFrames > 0) return;
      if (config.type === "flash" && fighter.flashReloading) return;
      if (fighter.skillActionFrame >= (config.phase?.activeFrames || 1)) { fighter.skillPhase = "skillRecovery"; fighter.skillState = "skillRecovery"; fighter.skill.phase = "skillRecovery"; fighter.skillRecoveryFrames = config.phase?.recoveryFrames || 1; fighter.state = "skillRecovery"; fighter.action = "skill_recovery"; fighter.skillActionFrame = 0; }
      return;
    }
    if (fighter.skillPhase === "skillRecovery") {
      fighter.skillRecoveryFrames = Math.max(0, (fighter.skillRecoveryFrames || 1) - 1);
      if (fighter.skillRecoveryFrames <= 0) {
        fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable";
        fighter.skillActive = false; fighter.skillCharging = false; fighter.skillActivated = false; fighter.skillConfig = null;
        fighter.skillHeld = false; fighter.skillHoldRequired = false; fighter.skillHoldActive = false; fighter.skillHoldFrames = 0; fighter.skillActionFrame = 0;
        fighter.skillCopiedUse = false; fighter.skillCancelled = false; fighter.skillInterrupted = false;
        fighter.state = fighter.grounded ? "idle" : "jumping"; fighter.action = fighter.state === "idle" ? "idle" : "jump_fall"; fighter.actionFrame = 0;
      }
    }
  }

  activateSkill(fighter, config, resourceMode = "native") {
    const opponent = fighter === this.player ? this.cpu : this.player;
    const owner = fighter === this.player ? "player" : "cpu";
    const type = config.type;
    if (type === "copy") {
      if (fighter.skillCopiedUse) {
        const copiedConfig = getSkillConfig(fighter.copiedSkillId);
        fighter.skillCopiedUse = false;
        if (copiedConfig && copiedConfig.type !== "copy") {
          fighter.copiedSkillUses = Math.max(0, Number(fighter.copiedSkillUses || 0) - 1);
          fighter.copyCharges = fighter.copiedSkillUses;
          fighter.copy.charges = fighter.copyCharges; fighter.copy.uses = fighter.copiedSkillUses;
          // A copied flash must use Guitar's stocked use only. It must not
          // inherit Toko's empty film resource or reload state.
          this.activateSkill(fighter, copiedConfig, "copied");
        }
        this.showCombatNotice("COPY USE", "skill", 0, fighter);
      } else if (Number(fighter.skillGauge || 0) >= Number(config.chargeMax || 100)) {
        const copied = getSkillConfig(opponent?.id);
        if (copied && copied.type !== "copy") {
          fighter.copiedSkillId = opponent.id;
          fighter.copiedSkillUses = Number(config.copiedSkillUses || config.copyCharges || 2);
          fighter.copyCharges = fighter.copiedSkillUses; fighter.copy.charges = fighter.copyCharges;
          fighter.copy.skillId = fighter.copiedSkillId; fighter.copy.uses = fighter.copiedSkillUses;
          this.showCombatNotice("COPY", "skill", 0, fighter);
        }
        fighter.skillGauge = 0; fighter.skill.gauge = 0;
      }
    } else if (type === "slimeShot") {
      const charge = Number(fighter.skillGauge || 0); const stage = [...(config.chargeStages || [])].reverse().find((entry) => charge >= entry.minCharge) || config.chargeStages?.[0] || { damageScale: 1, sizeScale: 1, speedScale: 1, knockdownValue: 14 };
      this.spawnSkillEntity({ owner, type: "slimeProjectile", facing: fighter.facing, x: fighter.x + fighter.facing * 36, y: fighter.y + 72, vx: fighter.facing * 4 * stage.speedScale, damage: 80 * stage.damageScale, w: 24 * stage.sizeScale, h: 18 * stage.sizeScale, duration: 120, knockdownValue: stage.knockdownValue, causesKnockdown: stage.causesKnockdown, hardKnockdown: stage.hardKnockdown, effectId: config.effectId }); if (resourceMode === "native") { fighter.slimeCooldown = Number(config.cooldownFrames || 0); fighter.skillGauge = 0; fighter.skill.gauge = 0; }
    } else if (type === "mirror") {
      fighter.mirrorActiveFrames = config.phase?.activeFrames || 2; fighter.mirrorReflectable = new Set(config.reflectable || []); fighter.mirrorNonReflectable = new Set(config.nonReflectable || []); fighter.mirrorHolding = true; fighter.mirrorResourceMode = resourceMode;
    } else if (type === "tackle") {
      fighter.tackleCooldown = Number(config.cooldownFrames || 42);
      const chargeRatio = clamp(Number(fighter.skillGauge || 0) / Math.max(1, Number(config.chargeMax || 36)), 0.12, 1);
      const travelDistance = (STAGE_BOUNDS.right - STAGE_BOUNDS.left) * chargeRatio;
      const duration = 30;
      this.spawnSkillEntity({ owner, type: "tackle", x: fighter.x, y: fighter.y + 70, vx: fighter.facing * travelDistance / duration, damage: 150, w: 70, h: 42, duration, travelDistance, unblockable: true, causesKnockdown: true, hardKnockdown: true, jumpAvoidable: true, effectId: config.effectId }); if (resourceMode === "native") { fighter.skillGauge = 0; fighter.skill.gauge = 0; fighter.gauge.skill = 0; }
    } else if (type === "dogSummon") {
      this.skillEntities = Array.isArray(this.skillEntities) ? this.skillEntities : [];
      if (this.skillEntities.some((entry) => entry.owner === owner && ["dogMarker", "fallingDog", "dogImpact"].includes(entry.type) && entry.active)) return;
      this.spawnSkillEntity({ owner, type: "dogMarker", x: opponent?.x || fighter.x + fighter.facing * 90, targetX: opponent?.x || fighter.x + fighter.facing * 90, y: 0, delay: 20, duration: 116, damage: 0, w: 0, h: 0, guardable: true, effectId: config.effectId });
      if (resourceMode === "native") { fighter.skillGauge = 0; fighter.skill.gauge = 0; fighter.gauge.skill = 0; }
    } else if (type === "ramenBuff") {
      const durationFrames = Number(config.buffDurationFrames || 600);
      const chargeMax = Number(config.chargeMax || 100);
      fighter.buff = { ...(fighter.buff || {}), ...config.buff, frames: durationFrames, durationFrames, chargeMax };
      if (resourceMode === "native") { fighter.skillGauge = chargeMax; fighter.skill.gauge = chargeMax; fighter.gauge.skill = chargeMax; }
    } else if (type === "drumBeat") {
      const random = typeof this.random === "function" ? this.random : Math.random;
      const activation = Number(fighter.norioActivationCount || 0) + 1;
      const previous = Array.isArray(fighter.norioLastPositions) ? fighter.norioLastPositions : [];
      const positions = [];
      const span = Math.max(1, STAGE_BOUNDS.right - STAGE_BOUNDS.left - 40);
      const validPosition = (candidate) => positions.every((value) => Math.abs(value - candidate) >= 18) && previous.every((value) => Math.abs(value - candidate) >= 18);
      for (let i = 0; i < (config.snareCount || 16); i += 1) {
        let x = STAGE_BOUNDS.left + 20 + random() * span;
        if (!validPosition(x)) {
          const fallback = STAGE_BOUNDS.left + 20 + ((i * 97 + activation * 53) % span);
          x = fallback;
          if (!validPosition(x)) x = STAGE_BOUNDS.left + 20 + ((i * 31 + activation * 17) % span);
        }
        x = clamp(x, STAGE_BOUNDS.left + 20, STAGE_BOUNDS.right - 20); positions.push(x);
        this.spawnSkillEntity({ owner, type: "snareMarker", x, targetX: x, y: 88, delay: i * (config.intervalFrames || 30), duration: (config.durationFrames || 480) - i * (config.intervalFrames || 30), damage: 36, w: 0, h: 0, marker: true, scale: 0.48, effectId: config.effectId, spawnVfx: false });
      }
      fighter.norioActivationCount = activation; fighter.norioLastPositions = positions;
      if (resourceMode === "native") { fighter.skillAmmo = Math.max(0, (fighter.skillAmmo || config.initialAmmo || 16) - 1); fighter.ammo = fighter.skillAmmo; }
    } else if (type === "flash") {
      if (fighter.flashReloadFrames == null) fighter.flashReloadFrames = 0;
      if (resourceMode === "native" && (fighter.skillAmmo || fighter.ammo || 0) <= 0) { fighter.flashReloadFrames = 0; fighter.flashReloading = false; fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.skillActivated = false; return; }
      if (resourceMode === "native") { fighter.skillAmmo = Math.max(0, (fighter.skillAmmo || fighter.ammo) - 1); fighter.ammo = fighter.skillAmmo; }
      fighter.flashHitUsed = false; fighter.flashReloading = false;
      // The shot travels in a straight line. It deals no damage, but a clean
      // hit applies the existing guardable flash stun for up to three seconds.
      const speed = Number(config.projectileSpeed || 6);
      const duration = Number(config.projectileDurationFrames || config.maxHitstopFrames || 180);
      this.spawnSkillEntity({ owner, type: "flash", facing: fighter.facing, x: fighter.x + fighter.facing * 35, y: fighter.y + 76, vx: fighter.facing * speed, duration, damage: 0, maxHitstopFrames: Number(config.maxHitstopFrames || 180), w: 95, h: 85, guardable: true, justGuardable: true, oneHit: true, effectId: config.effectId, spawnVfx: false });
    }
  }

  interruptSkillFor(fighter, reason = "hit") {
    const next = interruptSkill(fighter, reason);
    Object.assign(fighter, next);
    fighter.skillPhase = "skillUnavailable"; fighter.skillState = "skillUnavailable"; fighter.skill.phase = "skillUnavailable"; fighter.state = fighter.hp > 0 ? (fighter.grounded ? "idle" : "jumping") : "defeat"; fighter.actionFrame = 0; fighter.skillActivated = false;
    if (fighter.id === "kazushige" && fighter.skillGauge != null) fighter.skillGauge *= 0.5;
  }

  startSpecial(fighter) {
    const move = CHARACTERS[fighter.id].special;
    if (this.state.specialCinematic || fighter.meter < move.meterCost || fighter.state === "attacking" || fighter.downed || fighter.wakeupTimer > 0) return false;
    fighter.meter = 0;
    fighter.specialGauge = 0;
    // Keep direct simulation/test callers compatible while the live battle
    // always presents the cinematic freeze before committing the move.
    if (this.state.screen !== SCREEN.battle) return this.commitSpecial(fighter, move);
    this.state.specialCinematic = { fighter, move, frames: 32 };
    this.specialBeep();
    return true;
  }

  commitSpecial(fighter, move) {
    if (!fighter || fighter.hp <= 0 || !move) return false;
    fighter.currentMove = move;
    fighter.state = "attacking";
    fighter.attackInstanceId = Number(fighter.attackInstanceId || 0) + 1;
    fighter.currentAttackId = `${fighter.id}:special:${fighter.attackInstanceId}`;
    fighter.action = "special_start";
    fighter.actionFrame = 0;
    fighter.hitRegistry.clear();
    fighter.locomotionAction = "";
    fighter.locomotionFramesRemaining = 0;
    fighter.hitConfirmed = false;
    fighter.attackVfxSpawned = false;
    fighter.invulnerableFrames = move.startupFrames + move.activeFrames + move.recoveryFrames + 2;
    this.spawnVfx("super-explosion", fighter, { x: fighter.facing * 62, y: 84, scale: 3.8, facing: fighter.facing, frames: 24 });
    this.beep(115, 0.14, "sawtooth");
    if (move.specialType === "projectile") {
      fighter.pendingProjectile = { move, owner: fighter === this.player ? "player" : "cpu" };
      fighter.projectileSpawned = false;
    }
    return true;
  }

  specialBeep() {
    if (!this.state.seEnabled) return;
    this.ensureAudio();
    if (!this.soundContext || this.soundContext.state === "suspended") return;
    try {
      const now = this.soundContext.currentTime;
      for (const [frequency, offset] of [[110, 0], [220, 0.055], [440, 0.11]]) {
        const oscillator = this.soundContext.createOscillator();
        const gain = this.soundContext.createGain();
        oscillator.type = "sawtooth"; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.14, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.16);
        oscillator.connect(gain).connect(this.soundContext.destination);
        oscillator.start(now + offset); oscillator.stop(now + offset + 0.17);
      }
    } catch { /* WebAudio remains optional. */ }
  }

  startThrow(fighter) {
    if (!fighter || fighter.hp <= 0 || fighter.downed || fighter.wakeupTimer > 0) return false;
    fighter.currentMove = { id: "throw", kind: "throw", startupFrames: 5, activeFrames: 3, recoveryFrames: 22, damage: Number(CHARACTERS[fighter.id].stats.throwDamage || 150), hitstunFrames: 30, scoreValue: 400, hitbox: null, causesKnockdown: true, hardKnockdown: false, throw: true };
    fighter.state = "throwing";
    fighter.attackInstanceId = Number(fighter.attackInstanceId || 0) + 1;
    fighter.currentAttackId = `${fighter.id}:throw:${fighter.attackInstanceId}`;
    fighter.action = "throw_start";
    fighter.actionFrame = 0;
    fighter.crouching = false;
    fighter.boxProfile = "standing";
    fighter.guardHeld = false;
    fighter.hitRegistry.clear();
    fighter.throwTarget = null;
    fighter.throwReleased = false;
    fighter.locomotionAction = "";
    fighter.locomotionFramesRemaining = 0;
    // Do not let a prior crouch/guard transition mask the authored throw
    // startup pose when the command is entered on the same frame.
    setVisualSequence(fighter, []);
    return true;
  }

  attackReachPoint(fighter, move) {
    const hitbox = getFighterBoxes(fighter, move).hitbox;
    if (!hitbox) return { x: fighter.x + fighter.facing * 42, y: fighter.y + 80 };
    return {
      x: fighter.facing >= 0 ? hitbox.x + hitbox.w : hitbox.x,
      y: hitbox.y + hitbox.h * 0.5,
    };
  }

  combatContactPoint(attacker, defender, move) {
    const hitbox = getFighterBoxes(attacker, move).hitbox;
    const hurtbox = getFighterBoxes(defender).hurtboxes.find((part) => part && hitbox && part.x < hitbox.x + hitbox.w && part.x + part.w > hitbox.x && part.y < hitbox.y + hitbox.h && part.y + part.h > hitbox.y);
    if (!hitbox || !hurtbox) return { x: (attacker.x + defender.x) * 0.5, y: defender.y + 82 };
    const left = Math.max(hitbox.x, hurtbox.x);
    const right = Math.min(hitbox.x + hitbox.w, hurtbox.x + hurtbox.w);
    const bottom = Math.max(hitbox.y, hurtbox.y);
    const top = Math.min(hitbox.y + hitbox.h, hurtbox.y + hurtbox.h);
    return { x: (left + right) * 0.5, y: (bottom + top) * 0.5 };
  }

  spawnVfx(effectId, fighterOrPoint = null, overrides = {}) {
    const descriptor = getEffectDescriptor(effectId) || effectForMove({ effectId });
    if (!descriptor) return null;
    const point = fighterOrPoint && typeof fighterOrPoint.x === "number" ? fighterOrPoint : { x: 0, y: 0 };
    const manifest = getEffectAssetManifest(effectId) || EFFECT_ASSET_MANIFEST?.[effectId];
    const frameCount = Array.isArray(manifest?.frames) ? manifest.frames.length : 0;
    const frameDuration = Math.max(1, Number(manifest?.frameDuration || 1));
    const allFramesDuration = frameCount > 0 ? frameCount * frameDuration : Number(descriptor.durationFrames || 1);
    const hasExplicitDuration = Object.prototype.hasOwnProperty.call(overrides, "frames");
    const record = {
      effectId, x: Number(point.x || 0) + Number(overrides.x ?? descriptor.offsetX ?? 0), y: Number(point.y || 0) + Number(overrides.y ?? descriptor.offsetY ?? 0),
      scale: Number(overrides.scale ?? descriptor.scale ?? 1),
      facing: Number(overrides.facing || fighterOrPoint?.facing || 1) < 0 ? -1 : 1,
      tint: overrides.tint || null,
      tipAnchored: overrides.tipAnchored === true,
      // Keep the authored descriptor as a lower bound, but let every generic
      // effect advance through its complete numbered-frame manifest unless a
      // caller deliberately supplies a shorter/longer duration.
      frames: Number(hasExplicitDuration ? overrides.frames : Math.max(Number(descriptor.durationFrames || 1), allFramesDuration)),
      age: 0, owner: overrides.owner || fighterOrPoint?.id || null, hitbox: null,
    };
    this.state.vfx = Array.isArray(this.state.vfx) ? this.state.vfx : [];
    this.state.vfx.push(record); this.state.effects = this.state.vfx;
    if (this.state.vfx.length > 128) this.state.vfx.splice(0, this.state.vfx.length - 128);
    return record;
  }

  resolveEffectFrame(effectId, age = 0) {
    const manifest = getEffectAssetManifest(effectId) || EFFECT_ASSET_MANIFEST?.[effectId];
    if (!manifest || !Array.isArray(manifest.frames) || manifest.frames.length === 0) return null;
    const frameDuration = Math.max(1, Number(manifest.frameDuration || 1));
    const index = Math.min(manifest.frames.length - 1, Math.floor(Math.max(0, Number(age) || 0) / frameDuration));
    return { manifest, index, src: manifest.frames[index] };
  }

  loadEffectFrame(effectId, age = 0) {
    const resolved = this.resolveEffectFrame(effectId, age);
    if (!resolved?.src) return { ...resolved, image: null };
    let image = this.effectImages.get(resolved.src);
    if (!image) {
      image = makeImage(resolved.src);
      if (image) this.effectImages.set(resolved.src, image);
    }
    return { ...resolved, image };
  }

  tintedEffectFrame(asset, tint) {
    if (!tint || !imageReady(asset?.image) || typeof document === "undefined") return asset?.image || null;
    const key = `${asset.src}:${tint}`;
    if (this.effectTintCache.has(key)) return this.effectTintCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = asset.image.naturalWidth || asset.image.width || 1;
    canvas.height = asset.image.naturalHeight || asset.image.height || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return asset.image;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(asset.image, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.effectTintCache.set(key, canvas);
    return canvas;
  }

  spawnSkillEntity(entity = {}) {
    this.skillEntities = Array.isArray(this.skillEntities) ? this.skillEntities : [];
    const record = { id: `${entity.type || "skill"}:${this.frame}:${this.skillEntities.length}`, active: true, age: 0, delay: 0, duration: 60, ...entity };
    this.skillEntities.push(record);
    if (record.effectId && record.spawnVfx !== false) this.spawnVfx(record.effectId, { x: record.x, y: record.y }, { scale: record.scale || 1 });
    if (this.skillEntities.length > SKILL_ENTITY_LIMIT) this.skillEntities.splice(0, this.skillEntities.length - SKILL_ENTITY_LIMIT);
    return record;
  }

  updateSkillEntities() {
    if (!Array.isArray(this.skillEntities)) this.skillEntities = [];
    const fighters = [this.player, this.cpu];
    for (const entity of this.skillEntities) {
      if (!entity.active) continue;
      entity.age += 1;
      if (entity.delay > 0) { entity.delay -= 1; continue; }
      if (entity.type === "dogMarker") {
        if (entity.age < Number(entity.markerFrames || 20)) continue;
        entity.type = "fallingDog"; entity.age = 0; entity.frameOffset = 96; entity.y = 180; entity.w = 72; entity.h = 72; entity.duration = 114; entity.vy = -10; entity.graceFrames = 18; entity.spawnedDrop = true; this.spawnVfx("skill-dog-summon", entity); continue;
      }
      if (entity.type === "fallingDog") {
        if (entity.age <= Number(entity.graceFrames || 0)) continue;
        entity.y += Number(entity.vy || -10);
        if (entity.y <= 0) { entity.type = "dogImpact"; entity.age = 0; entity.frameOffset = 192; entity.y = 0; entity.w = 90; entity.h = 80; entity.damage = 220; entity.duration = 96; entity.guardable = true; entity.causesKnockdown = true; entity.hardKnockdown = true; entity.ownerHit = false; }
        else continue;
      }
      if (entity.type === "snareMarker") {
        entity.type = "snareImpact"; entity.age = 0; entity.w = 34; entity.h = 30; entity.duration = 18; entity.hitTargets = new Set();
        this.spawnVfx("skill-drum-beat", entity, { x: 0, y: 0, scale: 0.48 });
      }
      entity.x += Number(entity.vx || 0); entity.y = Math.max(0, Number(entity.y || 0) + Number(entity.vy || 0));
      const attacker = entity.owner === "player" ? this.player : this.cpu;
      const defender = entity.owner === "player" ? this.cpu : this.player;
      if (!attacker || !defender || attacker.hp <= 0 || defender.hp <= 0) { entity.active = false; continue; }
      if (entity.type === "tackle") attacker.x = clamp(entity.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
      if (entity.type === "tackle" && defender.downed) { entity.active = false; continue; }
      if (entity.type === "tackle" && entity.jumpAvoidable && (defender.y > 0 || defender.boxProfile === "air")) { entity.active = false; continue; }
      const entityHitboxScale = Number(attacker.buff?.hitboxScale || 1);
      const hitbox = { x: entity.x - (entity.w || 0) * entityHitboxScale * 0.5, y: entity.y, w: (entity.w || 0) * entityHitboxScale, h: (entity.h || 0) * entityHitboxScale };
      const targetHit = getFighterBoxes(defender).hurtboxes.some((part) => part.x < hitbox.x + hitbox.w && part.x + part.w > hitbox.x && part.y < hitbox.y + hitbox.h && part.y + part.h > hitbox.y);
      if (entity.type === "dogImpact" && attacker.id === "rusty" && !entity.ownerHit) {
        const ownerHit = getFighterBoxes(attacker).hurtboxes.some((part) => part.x < hitbox.x + hitbox.w && part.x + part.w > hitbox.x && part.y < hitbox.y + hitbox.h && part.y + part.h > hitbox.y);
        if (ownerHit) {
          const selfDamage = Number(attacker.maxHp || CHARACTERS.rusty.stats.hp || 0) * 0.8;
          applyDamage(attacker, selfDamage * Number(CHARACTERS.rusty.stats.defense || 1), { knockbackX: 0, knockbackY: 0, hitstunFrames: 0 });
          entity.ownerHit = true;
          this.spawnVfx("hit-burst", { x: attacker.x, y: attacker.y + 82 }, { x: 0, y: 0, scale: 0.38 });
        }
      }
      const targetKey = `${attacker.id}:${defender.id}`;
      if (!entity.hit && targetHit && !(entity.hitTargets?.has(defender.id))) {
        if (entity.type === "flash" && (defender.downed || defender.flashComboHit)) { entity.hit = true; entity.active = false; continue; }
        if (entity.type === "snareImpact") {
          entity.hitTargets = entity.hitTargets || new Set();
          const count = Number(defender.norioHits || 0);
          if (count >= 3) { entity.active = false; continue; }
          defender.norioHits = count + 1; entity.hitTargets.add(defender.id);
        }
        const move = { id: entity.type, kind: "skill", damage: entity.damage || 0, hitLevel: entity.hitLevel || "mid", unblockable: entity.unblockable === true, causesKnockdown: entity.causesKnockdown, hardKnockdown: entity.hardKnockdown, knockdownValue: entity.knockdownValue || 0, chipDamage: entity.chipDamage || 0, justGuardable: entity.justGuardable !== false, guardable: entity.guardable !== false, hitstunFrames: entity.hitstunFrames || 28, blockstunFrames: entity.blockstunFrames || 8, knockbackX: entity.knockbackX || 3, knockbackY: entity.knockbackY || 1 };
        const guardStart = defender.guardStartedFrame;
        const justGuard = defender.guardHeld && move.justGuardable && !move.unblockable && Number.isFinite(guardStart) && this.frame - guardStart <= JUST_GUARD_WINDOW;
        const blocked = defender.guardHeld && move.guardable && !move.unblockable;
        const contactPoint = { x: Math.max(hitbox.x, Math.min(defender.x, hitbox.x + hitbox.w)), y: Math.max(hitbox.y, Math.min(defender.y + 82, hitbox.y + hitbox.h)) };
        if (entity.type === "flash") {
          entity.hit = true; entity.active = false;
          this.spawnVfx("skill-flash", contactPoint, { x: 0, y: 0, scale: 1, facing: entity.facing || attacker.facing });
          if (justGuard) { defender.meter = clamp(defender.meter + 10, 0, MAX_METER); attacker.stunFrames = 12; defender.stunFrames = 3; this.state.hitstopFrames = JUST_GUARD_HITSTOP; this.spawnVfx("just-guard-ring", defender); continue; }
          if (blocked) { this.onHit(attacker, defender, move, true, false, 0); this.spawnVfx("guard-spark", defender); continue; }
          defender.flashComboHit = true; defender.flashStunned = true; defender.flashStunFrames = Math.min(180, Number(entity.maxHitstopFrames || 180)); defender.state = "hitstun"; defender.action = "hit_light"; defender.stunFrames = defender.flashStunFrames; this.onHit(attacker, defender, move, false, false, 0); continue;
        }
        const buff = attacker.buff || {};
        const damageScale = Number(buff.attackScale || 1);
        const chipScale = Number(buff.chipScale || 1);
        const damage = blocked ? (move.chipDamage * chipScale) : move.damage * damageScale;
        const dealt = blocked ? 0 : applyDamage(defender, damage, { blocked, knockbackX: move.knockbackX, knockbackY: move.knockbackY, hitstunFrames: blocked ? move.blockstunFrames : move.hitstunFrames });
        if (!blocked && (move.causesKnockdown || move.hardKnockdown) && defender.hp > 0) this.launchKnockdown(defender, move);
        this.onHit(attacker, defender, move, blocked, false, dealt); this.spawnVfx(blocked ? "guard-spark" : "hit-burst", contactPoint, { x: 0, y: 0, scale: move.kind === "special" ? 1.8 : blocked ? 0.55 : 0.38 }); entity.hit = true; if (entity.oneHit || !["snareImpact", "dogImpact"].includes(entity.type)) entity.active = false;
      }
      if (entity.age >= (entity.duration || 60)) entity.active = false;
    }
    this.skillEntities = this.skillEntities.filter((entry) => entry.active);
    this.state.skillEntities = this.skillEntities;
  }

  updateVfx() {
    if (!Array.isArray(this.state.vfx)) this.state.vfx = [];
    for (const record of this.state.vfx) {
      record.age = Number(record.age || 0) + 1;
      record.frames = Math.max(0, Number(record.frames || 0) - 1);
    }
    this.state.vfx = this.state.vfx.filter((record) => record.frames > 0);
    this.state.effects = this.state.vfx;
  }

  handleCombat(attacker, defender) {
    if (!attacker || !defender || attacker.hp <= 0 || defender.hp <= 0 || this.state.koFrames > 0) return;
    if (defender.wakeupInvulnerable && defender.wakeupInvulnerableFrames > 0) return;
    const rawMove = attacker.currentMove;
    const buff = attacker.buff || null;
    const move = rawMove && buff ? {
      ...rawMove,
      attackId: attacker.currentAttackId || rawMove?.id,
      damage: Number(rawMove.damage || 0) * Number(buff.attackScale || 1),
      chipDamage: Number(rawMove.chipDamage || 0) * Number(buff.chipScale || 1),
      hitboxWidth: Number(rawMove.hitboxWidth || 0) * Number(buff.hitboxScale || 1),
      hitboxHeight: Number(rawMove.hitboxHeight || 0) * Number(buff.hitboxScale || 1),
      hitbox: rawMove.hitbox ? { ...rawMove.hitbox, w: Number(rawMove.hitbox.w || 0) * Number(buff.hitboxScale || 1), h: Number(rawMove.hitbox.h || 0) * Number(buff.hitboxScale || 1) } : rawMove.hitbox,
      effectScale: Number(buff.effectScale || 1),
    } : rawMove ? { ...rawMove, attackId: attacker.currentAttackId || rawMove.id } : null;
    if (!move || attacker.state !== "attacking" && attacker.state !== "throwing") return;
    const wasFlashStunned = Boolean(defender.flashStunned);
    if (wasFlashStunned) { defender.flashStunned = false; defender.flashStunFrames = 0; defender.flashComboHit = false; defender.stunFrames = 0; }
    if (defender.downed && !move.downFollowup) return;
    if (move.kind === "throw" && activeFrame(move, attacker.actionFrame)) {
      if (!attacker.hitRegistry.has(`throw:${defender.id}`) && evaluateThrow(attacker, defender, attacker.actionFrame)) {
        attacker.hitRegistry.add(`throw:${defender.id}`);
        attacker.throwTarget = defender;
        attacker.throwReleased = false;
        defender.thrownBy = attacker;
        defender.currentMove = null;
        defender.vx = 0;
        defender.hitRegistry?.clear?.();
        this.state.vfx = (this.state.vfx || []).filter((effect) => !(effect.effectId === "attack-wind" && effect.owner === defender.id));
        this.state.effects = this.state.vfx;
        defender.state = "grabbed";
        defender.action = "thrown";
        defender.actionFrame = 0;
        attacker.action = "throw_hit";
        this.spawnVfx("throw-impact", defender);
        this.showCombatNotice("COUNTER", "counter", 0, defender);
        this.beep(520, 0.075, "square");
        setVisualSequence(attacker, [{ name: "throw_success", duration: 18 }]);
        setVisualSequence(defender, [{ name: "thrown", duration: 18 }]);
      }
      return;
    }
    if (defender.mirrorActiveFrames > 0 && move.kind === "special" && ["projectile", "energy", "linearSpecial"].includes(move.specialType)) {
      defender.mirrorActiveFrames = 0;
      defender.mirrorHolding = false;
      if (defender.mirrorResourceMode !== "copied") {
        defender.skillAmmo = Math.max(0, Number(defender.skillAmmo || defender.ammo || 1) - 1);
        defender.ammo = defender.skillAmmo;
        defender.skillGauge = defender.skillAmmo > 0 ? 1 : 0;
        defender.skill.gauge = defender.skillGauge;
      }
      defender.mirrorResourceMode = null;
      attacker.hitRegistry.add(`mirror:${defender.id}`);
      this.spawnVfx("skill-mirror", defender);
      this.spawnSkillEntity({ owner: defender === this.player ? "player" : "cpu", type: "reflected", x: defender.x + defender.facing * 38, y: defender.y + 70, vx: defender.facing * 5, damage: move.damage, w: move.hitboxWidth || 48, h: move.hitboxHeight || 24, duration: 90, effectId: "skill-mirror" });
      return;
    }
    // Projectile specials resolve only through the projectile collision path.
    // Their authored move hitbox is a preview/debug shape, not a second hit.
    if (move.specialType === "projectile") return;
    const result = evaluateStrike(attacker, defender, move, attacker.actionFrame, attacker.hitRegistry);
    if (!result.hit) return;
    if (!(attacker.alreadyHitTargets instanceof Set)) attacker.alreadyHitTargets = new Set();
    attacker.alreadyHitTargets.add(defender.id);
    const guardDashGuard = defender.guardDashActive && defender.guardDashFrames <= GUARD_DASH_GUARD_FRAMES;
    const guardWasJustPressed = defender.guardHeld && Number.isFinite(defender.guardStartedFrame) && this.frame - defender.guardStartedFrame <= JUST_GUARD_WINDOW && result.guardLevelOk && !result.unblockable;
    const justGuard = guardWasJustPressed && isJustGuardEligible(move) && defender.justGuardConsumedFrame !== defender.guardStartedFrame;
    if (justGuard) {
      defender.justGuardConsumedFrame = defender.guardStartedFrame;
      defender.meter = clamp(defender.meter + 10, 0, MAX_METER);
      if (defender === this.player) {
        this.state.justGuards += 1;
        this.state.score += scoreForEvent("justGuard");
      }
      defender.state = "idle";
      defender.stunFrames = 3;
      setVisualSequence(defender, [{ name: "just_guard", duration: 6 }]);
      attacker.stunFrames = 12;
      attacker.hitstopFrames = JUST_GUARD_HITSTOP;
      defender.hitstopFrames = JUST_GUARD_HITSTOP;
      this.state.hitstopFrames = JUST_GUARD_HITSTOP;
      this.spawnVfx("just-guard-ring", defender);
      this.showCombatNotice("GUARD", "guard", 0, defender);
      this.beep(880, 0.08, "triangle");
      return;
    }
    const wasAirborne = !defender.grounded;
    const wasCrouching = defender.crouching || defender.boxProfile === "crouch";
    const blocked = Boolean(result.blocked || guardDashGuard);
    if (!blocked && defender.skillPhase && defender.skillPhase !== "skillUnavailable") this.interruptSkillFor(defender, move.kind === "throw" ? "throw" : "hit");
    const comboScale = attacker.comboHits > 0 ? comboDamageScale(attacker.comboHits, CHARACTERS[attacker.id]) : 1;
    const damage = blocked && guardDashGuard ? 0 : result.damage * comboScale * (defender === this.cpu ? 1 : 0.92) * (wasFlashStunned ? 0.5 : 1);
    const dealtDamage = applyDamage(defender, damage, { blocked, knockbackX: move.knockbackX, knockbackY: move.knockbackY, hitstunFrames: blocked ? move.blockstunFrames : move.hitstunFrames });
    // Freeze the simulation briefly on confirmed contact; the normal tick
    // path decrements this counter and resumes all state machines cleanly.
    const contactHitstop = blocked ? 1 : HITSTOP_ON_HIT_FRAMES;
    this.state.hitstopFrames = Math.max(Number(this.state.hitstopFrames || 0), contactHitstop);
    if (!blocked && move.downFollowup && defender.downed && defender.followupReserved && defender.followupAttacker === attacker) {
      defender.downFollowupUsed = true;
      defender.followupUsed = true;
      defender.followupCount = 1;
      defender.followupReserved = false;
      defender.followupAttacker = null;
      defender.downed = false;
      defender.stunFrames = 0;
      this.startWakeup(defender);
      attacker.comboFinished = true;
      attacker.comboTimer = 0;
      this.state.comboTimer = 0;
    }
    const contactPoint = this.combatContactPoint(attacker, defender, move);
    if (blocked) this.spawnVfx("guard-spark", contactPoint, { x: 0, y: 0, scale: move.kind === "special" ? 1.8 : 0.55 });
    else this.spawnVfx("hit-burst", contactPoint, { x: 0, y: 0, scale: move.kind === "special" ? 1.8 : 0.38 });
    if (move.kind === "special") this.spawnVfx("super-explosion", contactPoint, { x: 0, y: 0, scale: 3.8, facing: attacker.facing, frames: 24 });
    if (!result.blocked && defender.hp > 0) {
      const firstHit = wasAirborne ? "air_hit" : wasCrouching ? "hit_crouch" : move.id.includes("strong") || move.kind === "special" ? "hit_heavy" : "hit_light";
      const sequence = [{ name: firstHit, duration: firstHit === "hit_heavy" ? 12 : 10 }];
      if (move.kind === "special" || move.knockbackX >= 4) sequence.push({ name: "knockback", duration: 10 });
      setVisualSequence(defender, sequence);
    }
    if (!blocked && defender.hp > 0 && !move.downFollowup) {
      defender.downValue = (defender.downValue || 0) + Number(move.knockdownValue || 0);
      defender.knockdownValue = defender.downValue;
      if (shouldKnockdown(move, defender.downValue)) this.launchKnockdown(defender, move);
    }
    if (attacker.hp > 0 && this.state.koFrames <= 0) attacker.meter = clamp(attacker.meter + (blocked ? (move.meterGainOnBlock || 0) : (move.meterGainOnHit || 4)), 0, MAX_METER);
    if (!blocked && defender.hp > 0 && this.state.koFrames <= 0) defender.meter = clamp(defender.meter + Math.max(1, (move.meterGainOnHit || 4) * 0.5), 0, MAX_METER);
    if (!blocked) attacker.hitConfirmed = true;
    this.onHit(attacker, defender, move, blocked, false, dealtDamage);
  }

  showCombatNotice(textValue, kind, damage = 0, defender = null) {
    const x = Number(defender?.x) || 240;
    const y = STAGE_BOUNDS.floor - (Number(defender?.y) || 0) - 104;
    this.state.combatNotice = { text: textValue, kind, damage: Number(damage) || 0, x, y, frames: 42 };
    if (kind === "guard") this.beep(180, 0.035);
  }

  onHit(attacker, defender, move, blocked, thrown, damage = 0) {
    const playerAttacker = attacker === this.player;
    if (blocked) {
      if (playerAttacker) this.state.score += scoreForEvent("light", move.chipDamage);
      attacker.comboTimer = Math.min(attacker.comboTimer || 0, 18);
      this.state.comboTimer = Math.min(this.state.comboTimer || 0, 18);
      this.showCombatNotice("GUARD", "guard", 0, defender);
      return;
    }
    this.showCombatNotice(`HIT ${Math.round(Number(damage) || 0)}`, "hit", damage, defender);
    if (this.state.mode === "training") this.state.trainingDamage = Math.round(Number(damage) || 0);
    const limit = getComboLimit(CHARACTERS[attacker.id]);
    attacker.comboHits = Math.min(limit, (attacker.comboHits || 0) + 1);
    attacker.combo = attacker.comboHits;
    attacker.comboScale = comboDamageScale(attacker.comboHits - 1, CHARACTERS[attacker.id]);
    attacker.comboTimer = 70;
    if (attacker.comboHits >= limit) {
      attacker.comboFinished = true;
      attacker.attackCooldownFrames = Math.max(Number(attacker.attackCooldownFrames || 0), Number(attacker.attackCooldownMax || 36));
    }
    this.beep(move.kind === "special" ? 90 : move.id?.includes("strong") ? 125 : 240, move.kind === "special" ? 0.13 : move.id?.includes("strong") ? 0.075 : 0.045, "sawtooth");
    if (!playerAttacker) {
      // CPU damage never awards player points/combo and ends a perfect run.
      this.state.perfect = false;
      this.state.combo = 0;
      return;
    }
    this.state.combo = Math.min(limit, attacker.comboHits);
    this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);
    this.state.comboTimer = 70;
    const key = thrown ? "throw" : move.kind === "special" ? "special" : move.id.includes("strong") ? "strong" : "light";
    this.state.score += scoreForEvent(key) + this.state.combo * 25;
    if (move.kind === "special") this.state.specialHits += 1;
  }

  updateProjectiles() {
    if (this.player.hp <= 0 || this.cpu.hp <= 0) { this.projectiles = []; return; }
    for (const projectile of this.projectiles) {
      if (!projectileIsActive(projectile, this.frame)) continue;
      projectile.x += projectile.vx;
      const target = projectile.owner === "player" ? this.cpu : this.player;
      if (target.hp <= 0) { this.projectiles = []; break; }
      const hitbox = { x: projectile.x, y: projectile.y, w: projectile.w, h: projectile.h, type: "projectileHitbox" };
      const targetBoxes = getFighterBoxes(target).hurtboxes;
      if (!projectile.hit && targetBoxes.some((part) => part && part.x < hitbox.x + hitbox.w && part.x + part.w > hitbox.x && part.y < hitbox.y + hitbox.h && part.y + part.h > hitbox.y)) {
        projectile.hit = true;
        const attacker = projectile.owner === "player" ? this.player : this.cpu;
        attacker.hitRegistry.add(`projectile:${target.id}`);
        const buffScale = Number(attacker.buff?.attackScale || 1);
        const damage = applyDamage(target, Number(projectile.damage || 0) * buffScale, { hitstunFrames: 32, knockbackX: 4, knockbackY: 2 });
        this.showCombatNotice(`HIT ${Math.round(Number(damage) || 0)}`, "hit", damage, target);
        if (this.state.mode === "training") this.state.trainingDamage = Math.round(Number(damage) || 0);
        if (target.hp > 0) setVisualSequence(target, [{ name: "hit_heavy", duration: 12 }, { name: "knockback", duration: 10 }]);
        if (target.hp > 0) this.launchKnockdown(target, { knockbackY: 4, hardKnockdown: false });
        const part = targetBoxes.find((box) => box && box.x < hitbox.x + hitbox.w && box.x + box.w > hitbox.x && box.y < hitbox.y + hitbox.h && box.y + box.h > hitbox.y);
        const contactPoint = part ? { x: (Math.max(part.x, hitbox.x) + Math.min(part.x + part.w, hitbox.x + hitbox.w)) * 0.5, y: (Math.max(part.y, hitbox.y) + Math.min(part.y + part.h, hitbox.y + hitbox.h)) * 0.5 } : { x: target.x, y: target.y + 82 };
        this.spawnVfx("hit-burst", contactPoint, { x: 0, y: 0, scale: 1.8 });
        this.spawnVfx("super-explosion", contactPoint, { x: 0, y: 0, scale: 3.8, facing: projectile.facing, frames: 24 });
        if (target.skillPhase && target.skillPhase !== "skillUnavailable") this.interruptSkillFor(target, "hit");
        if (projectile.owner === "player") this.state.score += scoreForEvent("special");
        else this.state.perfect = false;
        if (target.hp <= 0) { this.projectiles = []; break; }
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.x > STAGE_BOUNDS.left - 80 && projectile.x < STAGE_BOUNDS.right + 80 && !projectile.hit && this.frame <= projectile.activeUntil);
  }

  finishRound() {
    if (this.state.screen !== SCREEN.battle) return;
    this.captureRoundCarry();
    const remaining = Math.floor(this.state.timerFrames / FIXED_HZ);
    const outcome = resolveRound(this.player, this.cpu, remaining);
    this.state.result = outcome.result;
    this.state.koFrames = 0;
    this.projectiles = [];
    this.player.hitRegistry.clear();
    this.cpu.hitRegistry.clear();
    setVisualSequence(this.player, []);
    setVisualSequence(this.cpu, []);
    if (outcome.result === "loss") this.state.perfect = false;
    if (outcome.result === "win") {
      this.player.state = "victory";
      this.player.action = "victory";
      this.cpu.state = "defeat";
      this.cpu.action = "defeat";
      this.state.playerRounds += 1;
      this.state.score += scoreForEvent("round");
      this.state.score += scoreForEvent("hp", Math.round(this.player.hp));
      this.state.score += scoreForEvent("time", remaining);
      if (this.player.hp >= (this.player.maxHp || MAX_HP)) this.state.score += scoreForEvent("perfect");
    } else if (outcome.result === "loss") {
      this.player.state = "defeat";
      this.player.action = "defeat";
      this.cpu.state = "victory";
      this.cpu.action = "victory";
      this.state.cpuRounds += 1;
      this.state.roundLosses += 1;
      this.state.score += scoreForEvent("roundLoss");
    }
    this.state.round += outcome.result === "draw" ? 0 : 1;
    this.setScreen(SCREEN.roundResult);
  }

  resolveRoundResult() {
    if (this.state.playerRounds >= 2) {
      this.state.stageResult = "win";
      if (!this.state.stageBonusAwarded) {
        this.state.score += scoreForEvent("stage");
        this.state.stageBonusAwarded = true;
      }
      this.setScreen(SCREEN.stageResult);
    }
    else if (this.state.cpuRounds >= 2) this.offerContinue();
    else this.beginRound();
  }

  resolveStageResult() {
    if (this.state.stage >= STAGES.length) {
      if (this.state.continueUsed === 0) this.state.score += scoreForEvent("noContinue");
      this.state.score += scoreForEvent("clear");
      this.state.finalStats = {
        score: this.state.score,
        rank: rankForScore(this.state.score, { perfect: this.state.perfect, difficulty: this.state.difficulty }),
        difficulty: this.state.difficulty,
        character: this.state.selectedId,
        color: this.state.color,
        maxCombo: this.state.maxCombo,
        justGuards: this.state.justGuards,
        specialHits: this.state.specialHits,
        roundLosses: this.state.roundLosses,
        continues: this.state.continueUsed,
        durationMs: Math.round(this.frame * FRAME),
      };
      this.setScreen(SCREEN.ending); return;
    }
    this.state.stage += 1;
    this.startStage();
  }

  offerContinue() {
    const max = DIFFICULTIES[this.state.difficulty].continues;
    if (max === Infinity || this.state.continueUsed < max) this.setScreen(SCREEN.continue);
    else this.setScreen(SCREEN.gameOver);
  }

  continueMatch(yes) {
    if (!yes) { this.setScreen(SCREEN.gameOver); return; }
    this.state.continueUsed += 1;
    this.state.score += scoreForEvent("continue");
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.round = 1;
    this.startStage();
  }

  retryStage() {
    const max = DIFFICULTIES[this.state.difficulty]?.continues ?? 0;
    if (max !== Infinity && this.state.continueUsed >= max) { this.returnTitle(); return; }
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.round = 1;
    this.startStage();
  }

  finishEnding() {
    const rank = rankForScore(this.state.score, { perfect: this.state.perfect, difficulty: this.state.difficulty });
    const finalStats = this.state.finalStats || {
      score: this.state.score,
      rank,
      difficulty: this.state.difficulty,
      character: this.state.selectedId,
      color: this.state.color,
      maxCombo: this.state.maxCombo,
      justGuards: this.state.justGuards,
      specialHits: this.state.specialHits,
      roundLosses: this.state.roundLosses,
      continues: this.state.continueUsed,
      durationMs: Math.round(this.frame * FRAME),
    };
    this.state.finalStats = finalStats;
    this.save = appendHighScore(this.save, {
      score: this.state.score,
      rank,
      character: this.state.selectedId,
      difficulty: this.state.difficulty,
      color: this.state.color,
      durationMs: finalStats.durationMs,
    });
    this.setScreen(SCREEN.score);
  }

  returnTitle() {
    this.state.score = 0;
    this.state.stage = 1;
    this.setScreen(SCREEN.title);
  }

  loadBackground(stage) {
    const source = STAGES[stage - 1]?.background;
    if (!source) return null;
    if (!this.backgrounds.has(source)) this.backgrounds.set(source, makeImage(source));
    return this.backgrounds.get(source);
  }

  loadPlatform(assetId) {
    if (!assetId) return null;
    const source = `assets/platforms/${assetId}.png`;
    if (!this.platformImages.has(source)) this.platformImages.set(source, makeImage(source));
    return this.platformImages.get(source);
  }

  loadSprite(id, animationName, actionFrame = 0) {
    const character = CHARACTERS[id];
    const resolvedName = RUNTIME_ANIMATION_ALIASES[animationName] || animationName;
    const clip = character?.animation?.[resolvedName] || getSkillAnimationClip(id, resolvedName) || character?.animation?.idle;
    const frames = clip?.frames || [0];
    const rawIndex = Math.floor(Math.max(0, actionFrame) / Math.max(1, clip?.frameDuration || 8));
    const frameIndex = clip?.loop ? rawIndex % frames.length : Math.min(frames.length - 1, rawIndex);
    const frame = frames[Math.max(0, frameIndex)];
    const source = typeof frame === "string"
      ? frame
      : character?.sprite.frames[Math.max(0, Math.min(3, Number(frame) || 0))];
    if (!source) return null;
    if (!this.images.has(source)) this.images.set(source, makeImage(source));
    const image = this.images.get(source);
    if (imageReady(image)) {
      this.lastReadySprites.set(id, image);
      return image;
    }
    // A frame can be requested before its PNG has decoded (or after a failed
    // request). Reuse the last ready frame for this fighter so the character
    // remains visible while the next frame arrives.
    const fallback = this.lastReadySprites.get(id);
    if (imageReady(fallback)) return fallback;
    return image;
  }

  render() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    const stageImage = this.loadBackground(this.state.stage);
    if (stageImage?.complete && stageImage.naturalWidth) ctx.drawImage(stageImage, 0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    else {
      ctx.fillStyle = "#101a2e"; ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      ctx.fillStyle = "#182a43"; ctx.fillRect(0, 154, INTERNAL_WIDTH, 116);
      ctx.fillStyle = "#365276"; ctx.fillRect(0, 228, INTERNAL_WIDTH, 4);
    }
    if (this.state.screen === SCREEN.battle || this.state.screen === SCREEN.pause || this.state.screen === SCREEN.roundResult) {
      this.drawBattle(ctx);
    }
    if (this.state.debug && (this.state.screen === SCREEN.battle || this.state.screen === SCREEN.pause)) this.drawDebug(ctx);
    this.renderPanel();
  }

  drawBattle(ctx) {
    for (const platform of this.stagePlatforms()) {
      const image = this.loadPlatform(platform.asset);
      const top = STAGE_BOUNDS.floor - platform.y;
      ctx.save();
      if (imageReady(image)) ctx.drawImage(image, platform.x, top - Math.max(20, platform.y * 0.42), platform.w, Math.max(24, platform.y * 0.42 + 5));
      else {
        ctx.fillStyle = "rgba(14,20,33,.86)"; ctx.fillRect(platform.x, top, platform.w, 5);
        ctx.strokeStyle = "#d7b35e"; ctx.strokeRect(platform.x, top, platform.w, 5);
        ctx.fillStyle = "#f4d887"; ctx.font = "6px monospace"; ctx.fillText(platform.label, platform.x + 3, top - 3);
      }
      ctx.restore();
    }
    this.drawFighter(ctx, this.player);
    this.drawFighter(ctx, this.cpu);
    for (const projectile of this.projectiles) {
      ctx.fillStyle = "#ffe467";
      ctx.fillRect(projectile.x, INTERNAL_HEIGHT - projectile.y - 14, projectile.w, projectile.h);
      ctx.fillStyle = "#fff6bd";
      ctx.fillRect(projectile.x + 3, INTERNAL_HEIGHT - projectile.y - 11, projectile.w - 6, projectile.h - 6);
    }
    for (const entity of this.skillEntities || []) {
      if (!entity.active || entity.delay > 0) continue;
      ctx.save();
      ctx.globalAlpha = entity.type === "dogMarker" ? 0.42 : 0.78;
      const asset = this.loadEffectFrame(entity.effectId, (entity.age || 0) + (entity.frameOffset || 0));
      if (imageReady(asset?.image)) {
        const manifest = asset.manifest;
        const width = Number(entity.renderWidth || manifest.cellWidth || entity.w || 16);
        const height = Number(entity.renderHeight || manifest.cellHeight || entity.h || 16);
        const origin = manifest.origin || { x: width * 0.5, y: height * 0.5 };
        ctx.translate(Number(entity.x || 0), 0);
        if (Number(entity.facing || 1) < 0) ctx.scale(-1, 1);
        ctx.drawImage(asset.image, -Number(origin.x || 0), INTERNAL_HEIGHT - Number(entity.y || 0) - Number(origin.y || 0), width, height);
      } else {
        ctx.fillStyle = entity.type === "flash" ? "#ffffff" : entity.type === "snare" || entity.type === "snareImpact" ? "#cf87ff" : entity.type === "dogMarker" ? "#b9e7ff" : "#7ee787";
        ctx.fillRect((entity.x || 0) - (entity.w || 16) * 0.5, INTERNAL_HEIGHT - (entity.y || 0) - (entity.h || 16), entity.w || 16, entity.h || 16);
      }
      ctx.restore();
    }
    for (const effect of this.state.vfx || []) {
      const alpha = clamp((effect.frames || 0) / 12, 0, 1);
      const asset = this.loadEffectFrame(effect.effectId, effect.age || 0);
      ctx.save(); ctx.globalAlpha = alpha;
      if (imageReady(asset?.image)) {
        const manifest = asset.manifest;
        const width = Number(manifest.cellWidth || 256) * Number(effect.scale || 1);
        const height = Number(manifest.cellHeight || 256) * Number(effect.scale || 1);
        const origin = manifest.origin || { x: width * 0.5, y: height * 0.5 };
        const source = this.tintedEffectFrame(asset, effect.tint);
        if (effect.tipAnchored) {
          ctx.translate(Number(effect.x || 0), INTERNAL_HEIGHT - Number(effect.y || 0));
          if (Number(effect.facing || 1) < 0) ctx.scale(-1, 1);
          ctx.drawImage(source, -width, -Number(origin.y || 0) * Number(effect.scale || 1), width, height);
        } else {
          ctx.translate(Number(effect.x || 0), 0);
          if (Number(effect.facing || 1) < 0) ctx.scale(-1, 1);
          ctx.drawImage(source, -Number(origin.x || 0) * Number(effect.scale || 1), INTERNAL_HEIGHT - Number(effect.y || 0) - Number(origin.y || 0) * Number(effect.scale || 1), width, height);
        }
      } else {
        ctx.strokeStyle = effect.effectId?.includes("guard") ? "#7de7ff" : "#ffe37b"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(effect.x || 0, INTERNAL_HEIGHT - (effect.y || 0), Math.max(4, 10 * (effect.scale || 1)), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    this.drawHud(ctx);
    const cinematic = this.state.specialCinematic;
    if (cinematic?.fighter) {
      const fighter = cinematic.fighter;
      const image = this.loadSprite(fighter.id, "special", 0);
      const isPlayer = fighter === this.player;
      const x = isPlayer ? 16 : 348;
      const textX = isPlayer ? x + 48 : x + 62;
      ctx.save();
      ctx.fillStyle = "rgba(8,5,19,.86)"; ctx.fillRect(x, 54, 116, 54);
      ctx.strokeStyle = CHARACTERS[fighter.id]?.stats?.tint || "#ffe56e"; ctx.strokeRect(x, 54, 116, 54);
      if (imageReady(image)) ctx.drawImage(image, x + (isPlayer ? 2 : 70), 58, 44, 44);
      ctx.fillStyle = "#fff7c7"; ctx.font = "bold 7px monospace"; ctx.textAlign = isPlayer ? "left" : "right";
      ctx.fillText(CHARACTERS[fighter.id]?.name || "FIGHTER", textX, 69, 64);
      ctx.fillText(CHARACTERS[fighter.id]?.special?.name || "SPECIAL", textX, 82, 64);
      ctx.restore();
    }
  }

  drawFighter(ctx, fighter) {
    const selection = animationSelectionFor(fighter);
    const image = this.loadSprite(fighter.id, selection.name, selection.frame);
    const character = CHARACTERS[fighter.id];
    const placement = spriteDrawPlacement(fighter, character?.sprite, spriteScaleFor(fighter, selection.name));
    const x = placement.originX;
    const y = placement.baselineY;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = fighter.hp <= 0 ? 0.66 : 1;
    if (fighter.color === 2) ctx.filter = "hue-rotate(180deg) saturate(0.95)";
    if (imageReady(image)) {
      ctx.translate(x, y);
      if (fighter.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(image, placement.drawX, placement.drawY, placement.width, placement.height);
    }
    ctx.restore();
    if (fighter.id === "kazushige" && fighter.buff?.frames > 0) {
      const aura = this.loadEffectFrame("attack-heavy", Math.max(0, Number(fighter.buff.durationFrames || 0) - Number(fighter.buff.frames || 0)));
      if (imageReady(aura?.image)) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1;
        ctx.filter = "brightness(0)";
        ctx.translate(x, y);
        if (fighter.facing < 0) ctx.scale(-1, 1);
        ctx.drawImage(aura.image, -82, -170, 164, 164);
        ctx.restore();
      }
    }
    if (fighter.state === "attacking" && fighter.currentMove?.kind === "special" && fighter.actionFrame < fighter.currentMove.startupFrames) {
      ctx.fillStyle = "#ffe56e"; ctx.font = "bold 11px monospace"; ctx.fillText("!", x + fighter.facing * 24, y - 104);
    }
  }

  drawHud(ctx) {
    const pulse = Math.floor(this.frame / 10) % 2 === 0;
    const bar = (x, y, width, value, color) => {
      ctx.fillStyle = "#0b101b"; ctx.fillRect(x, y, width, 8);
      ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, (width - 2) * clamp(value, 0, 1), 6);
      ctx.strokeStyle = "#eaf0ff"; ctx.strokeRect(x, y, width, 8);
    };
    bar(16, 14, 170, this.player.hp / (this.player.maxHp || MAX_HP), "#ef505c");
    bar(294, 14, 170, this.cpu.hp / (this.cpu.maxHp || MAX_HP), "#ef505c");
    bar(16, 25, 110, this.player.meter / 100, this.player.meter >= 100 && pulse ? "#fff8b2" : "#f6c84c");
    bar(354, 25, 110, this.cpu.meter / 100, this.cpu.meter >= 100 && pulse ? "#fff8b2" : "#f6c84c");
    const drawSkill = (fighter, x, align = "left") => {
      const skill = skillHudStateFor(fighter);
      const ratio = skill.max > 0 ? skill.value / skill.max : 0;
      bar(x, 36, 110, ratio, skill.ready && pulse ? "#f4d4ff" : skill.ready ? "#b875ff" : "#5c6474");
      ctx.save();
      ctx.textAlign = align;
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = skill.ready ? "#e4c5ff" : "#aab2c3";
      const valueLabel = skill.mode === "duration" ? `${Math.ceil(skill.value / FIXED_HZ)}s` : `${Math.round(skill.value)}/${Math.round(skill.max)}`;
      const cooldownLabel = skill.cooldownRemaining > 0 ? ` CD ${Math.ceil(skill.cooldownRemaining / FIXED_HZ)}s` : "";
      ctx.fillText(`${skill.label} ${valueLabel}${cooldownLabel}${skill.ready ? " READY" : ""}`, align === "right" ? x + 110 : x, 51);
      const status = skillStatusTextFor(fighter);
      // The special cut-in uses this same side lane, so leave the status line
      // empty until it has cleared instead of drawing the two on top of one another.
      if (status && !this.state.specialCinematic) {
        ctx.font = "bold 7px monospace";
        ctx.fillStyle = "#fff1a3";
        ctx.fillText(status, align === "right" ? x + 110 : x, 62);
      }
      ctx.restore();
    };
    drawSkill(this.player, 16, "left");
    drawSkill(this.cpu, 354, "right");
    ctx.fillStyle = "#f6f5de"; ctx.font = "bold 9px monospace";
    ctx.fillText(CHARACTERS[this.player.id]?.name || "1P", 16, 9);
    ctx.textAlign = "right"; ctx.fillText(CHARACTERS[this.cpu.id]?.name || "CPU", 464, 9);
    ctx.textAlign = "center"; ctx.font = "bold 18px monospace";
    const timerLabel = this.state.mode === "training" ? "--" : String(Math.ceil(this.state.timerFrames / FIXED_HZ)).padStart(2, "0");
    ctx.fillText(timerLabel, 240, 21);
    ctx.font = "bold 9px monospace"; ctx.fillText(`R${this.state.playerRounds}-${this.state.cpuRounds}  STAGE ${this.state.stage}`, 240, 34);
    // Keep live information in the central lane. The left/right lanes below
    // the skill gauges are reserved for each fighter's special cut-in.
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe795"; ctx.fillText(`${this.state.score.toString().padStart(6, "0")}  COMBO ${this.state.combo}`, 240, 51, 200);
    if (this.state.mode === "training") {
      ctx.fillStyle = "#9de8ff";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`TRAINING  DAMAGE ${Math.round(this.state.trainingDamage || 0)}`, 240, 64, 200);
      ctx.font = "bold 7px monospace";
      ctx.fillText("COMMAND: →+A  DOWN+A/X  UP+A/X  B SKILL  SP SPECIAL", 240, 75, 200);
    }
    const notice = this.state.combatNotice;
    if (notice?.frames > 0 && notice.text) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "900 15px monospace";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5,7,15,.9)";
      ctx.fillStyle = notice.kind === "guard" ? "#7de7ff" : "#ffda66";
      ctx.strokeText(notice.text, clamp(notice.x, 38, INTERNAL_WIDTH - 38), clamp(notice.y, 62, STAGE_BOUNDS.floor - 20));
      ctx.fillText(notice.text, clamp(notice.x, 38, INTERNAL_WIDTH - 38), clamp(notice.y, 62, STAGE_BOUNDS.floor - 20));
      ctx.restore();
    }
    ctx.textAlign = "right";
    if (this.state.screen === SCREEN.pause) { ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT); ctx.fillStyle = "#fff"; ctx.font = "bold 28px monospace"; ctx.fillText("PAUSE", 268, 105); ctx.font = "bold 12px monospace"; ctx.fillStyle = this.state.pauseIndex === 0 ? "#ffe56e" : "#fff"; ctx.fillText("▶ RESUME", 268, 132); ctx.fillStyle = this.state.pauseIndex === 1 ? "#ffe56e" : "#fff"; ctx.fillText("▶ QUIT TO TITLE", 268, 151); }
    ctx.textAlign = "left";
  }

  drawDebug(ctx) {
    for (const fighter of [this.player, this.cpu]) {
      const boxes = getFighterBoxes(fighter, fighter.currentMove);
      for (const part of [...boxes.hurtboxes, boxes.pushbox, ...(boxes.hitbox ? [boxes.hitbox] : []), boxes.throwbox]) {
        ctx.strokeStyle = part.type === "hitbox" ? "#ff5252" : part.type === "pushbox" ? "#75ff8b" : part.type === "throwbox" ? "#c672ff" : "#59b8ff";
        ctx.strokeRect(part.x, STAGE_BOUNDS.floor - part.y - part.h, part.w, part.h);
      }
      ctx.fillStyle = "#fff";
      ctx.font = "7px monospace";
      const debugY = STAGE_BOUNDS.floor - fighter.y;
      ctx.fillText(`${fighter.id} ${fighter.state}/${fighter.action} f${fighter.actionFrame}`, fighter.x - 34, debugY - 108);
      ctx.fillText(`origin ${Math.round(fighter.x)},${Math.round(fighter.y)} foot ${Math.round(fighter.x)},${STAGE_BOUNDS.floor}`, fighter.x - 34, debugY - 99);
    }
    const recent = this.state.inputHistory.slice(-8).map((entry) => `${entry.frame}:${entry.left ? "L" : ""}${entry.right ? "R" : ""}${entry.up ? "U" : ""}${entry.down ? "D" : ""}${entry.light ? "j" : ""}${entry.strong ? "k" : ""}${entry.guard ? "g" : ""}${entry.special ? "i" : ""}`).join(" ");
    ctx.fillStyle = "#ffe795";
    ctx.font = "7px monospace";
    ctx.fillText(`input ${recent}`, 8, INTERNAL_HEIGHT - 5);
  }

  renderPanel() {
    if (!this.panel) return;
    const screen = this.state.screen;
    this.panel.innerHTML = "";
    this.panel.dataset.screen = screen;
    const heading = (title, subtitle = "") => { const h = document.createElement("h1"); h.textContent = title; this.panel.appendChild(h); if (subtitle) { const p = document.createElement("p"); p.textContent = subtitle; this.panel.appendChild(p); } };
    const button = (label, onClick, selected = false, parent = this.panel) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", String(label)); if (selected) { b.classList.add("selected"); b.setAttribute("aria-current", "true"); } b.addEventListener("click", () => { this.ensureAudio(); onClick(); }); parent.appendChild(b); return b; };
    const buttonRow = (items) => { const row = document.createElement("div"); row.className = "action-button-row"; this.panel.appendChild(row); items.forEach(({ label, onClick, selected = false }) => button(label, onClick, selected, row)); return row; };
    if (screen === SCREEN.boot) heading(GAME_TITLE, "LOADING...");
    else if (screen === SCREEN.title) {
      const logo = document.createElement("img");
      logo.className = "title-logo";
      logo.src = "assets/ui/title-logo.png";
      logo.alt = GAME_TITLE;
      this.panel.appendChild(logo);
      button("START", () => this.setScreen(SCREEN.menu));
    }
    else if (screen === SCREEN.menu) {
      heading(GAME_TITLE, "MAIN MENU");
      MENU_ITEMS.forEach((item, index) => button(item, () => this.activateMenu(index), index === this.state.menuIndex));
      this.hintText("↑↓ SELECT   ENTER OK");
    } else if (screen === SCREEN.settings) {
      heading("SETTINGS", "SOUND / DATA / DEBUG");
      const settingsLabel = (item) => item === "SOUND" ? `${item}: ${this.state.sound ? "ON" : "OFF"}` : item === "BGM" ? `${item}: ${this.state.bgmEnabled ? "ON" : "OFF"}` : item === "SE" ? `${item}: ${this.state.seEnabled ? "ON" : "OFF"}` : item === "DEBUG OVERLAY" ? `${item}: ${this.state.debug ? "ON" : "OFF"}` : item;
      SETTINGS_ITEMS.forEach((item, index) => button(settingsLabel(item), () => this.activateSettings(index), index === this.state.settingsIndex));
      this.hintText("↑↓ SELECT   ENTER OK   ESC BACK");
    } else if (screen === SCREEN.trainingSettings) {
      heading("TRAINING MODE", "SELECT OPTIONS / DAMAGE DISPLAY ON");
      const trainingLabel = (item) => item === "CPU MOVE" ? `${item}: ${this.state.trainingCpuMove ? "ON" : "OFF"}` : item === "CPU ATTACK" ? `${item}: ${this.state.trainingCpuAttack ? "ON" : "OFF"}` : item;
      TRAINING_SETTINGS_ITEMS.forEach((item, index) => button(trainingLabel(item), () => {
        this.state.trainingSettingsIndex = index;
        if (index === 0) this.startTraining();
        else if (index === 1) this.state.trainingCpuMove = !this.state.trainingCpuMove;
        else if (index === 2) this.state.trainingCpuAttack = !this.state.trainingCpuAttack;
        else this.setScreen(SCREEN.colorSelect);
        this.renderPanel();
      }, index === this.state.trainingSettingsIndex));
      this.hintText("UP/DOWN SELECT   ENTER TOGGLE / START   ESC BACK");
    } else if (screen === SCREEN.difficultySelect) {
      heading("SELECT DIFFICULTY", "CPU REACTION IS DELAYED, NEVER READS LIVE INPUT");
      DIFFICULTY_IDS.forEach((id) => button(DIFFICULTIES[id].label, () => { this.state.difficulty = id; this.setScreen(SCREEN.characterSelect); }, id === this.state.difficulty));
      button("BACK", () => this.setScreen(SCREEN.menu));
    } else if (screen === SCREEN.characterSelect) {
      heading("SELECT FIGHTER", "8 FIGHTERS / DISTINCT STATS");
      const grid = document.createElement("div"); grid.className = "character-grid";
      CHARACTER_IDS.forEach((id) => { const b = document.createElement("button"); b.type = "button"; b.className = this.state.selectedId === id ? "selected" : ""; b.setAttribute("aria-label", `${CHARACTERS[id].name}を選択`); if (this.state.selectedId === id) b.setAttribute("aria-current", "true"); b.innerHTML = `<img alt="" src="${CHARACTERS[id].sprite.frames[0]}"><strong>${CHARACTERS[id].name}</strong><small>${CHARACTERS[id].type}</small>`; b.addEventListener("click", () => { this.ensureAudio(); this.state.selectedId = id; this.beep(320); this.renderPanel(); }); grid.appendChild(b); });
      this.panel.appendChild(grid);
      const selected = CHARACTERS[this.state.selectedId];
      const selectedSkill = getSkillConfig(this.state.selectedId);
      const stats = document.createElement("div"); stats.className = "fighter-stats";
      stats.textContent = `HP ${selected.stats.hp}  SPD ${selected.stats.speed.toFixed(2)}  POW ${selected.stats.power.toFixed(2)}  REACH ${selected.stats.reach.toFixed(2)}  DEF ${selected.stats.defense.toFixed(2)}  COMBO ${selected.stats.comboLimit}  A ${selected.moves.light_attack_neutral.name}  →+A ${selected.moves.forward_light.name}  X ${selected.moves.strong_attack_neutral.name}  B長押し ${selectedSkill?.name || "固有スキル"}  SP ${selected.special.name}`;
      this.panel.appendChild(stats);
      buttonRow([{ label: "CONFIRM", onClick: () => this.setScreen(SCREEN.colorSelect) }, { label: "BACK", onClick: () => this.setScreen(this.state.mode === "training" ? SCREEN.menu : SCREEN.difficultySelect) }]);
    } else if (screen === SCREEN.colorSelect) {
      heading("COLOR VARIATION", `${CHARACTERS[this.state.selectedId].name} / SELECT COLOR`);
      [1, 2].forEach((color) => button(`COLOR ${color}`, () => { this.state.color = color; this.renderPanel(); }, color === this.state.color));
      buttonRow([{ label: "FIGHT", onClick: () => this.state.mode === "training" ? this.setScreen(SCREEN.trainingSettings) : this.startMatch() }, { label: "BACK", onClick: () => this.setScreen(SCREEN.characterSelect) }]);
    } else if (screen === SCREEN.howToPlay) {
      heading("HOW TO PLAY", "現在の操作と技相性");
      this.hintText("A 弱攻撃 / X 強攻撃 / Y ガード / B長押し 固有スキル / A+X 投げ / JUMP ジャンプ / SP 必殺技");
      const p = document.createElement("pre");
      p.textContent = "スティック・A/D・←/→  移動\nスティック上・W・↑・JUMP  ジャンプ（空中でもう1回で二段ジャンプ）\nスティック下・S・↓  しゃがみ／下段ガード\nA・J  弱攻撃　　→+A・→+J  キャラクター固有通常技\nX・K  強攻撃　　Y・L  ガード／ジャストガード\nA+X  投げ（ガード中の相手に有効）\nB長押し  キャラクター固有スキル（チャージは次回へ持越し）\nSP・I  必殺技（必殺ゲージ100で発動）\n相性：ガード ＞ 弱・強攻撃 ＞ 投げ ＞ ガード\nPAUSE・ESC  ポーズ／再開";
      this.panel.appendChild(p);
      button("BACK", () => this.setScreen(SCREEN.menu));
    } else if (screen === SCREEN.stageIntro) {
      const stage = STAGES[this.state.stage - 1];
      const opponentId = stageOpponent(this.state.stage, this.state.selectedId);
      const opponent = CHARACTERS[opponentId];
      heading(`STAGE ${this.state.stage}`, stage.name);
      const encounter = document.createElement("div"); encounter.className = "stage-encounter"; encounter.style.backgroundImage = `linear-gradient(rgba(5,8,15,.28),rgba(5,8,15,.72)),url(${stage.background})`;
      const portrait = document.createElement("img"); portrait.className = "stage-opponent"; portrait.alt = opponent.name; portrait.src = opponent.animation.idle?.frames?.[0] || opponent.sprite.frames[0]; encounter.appendChild(portrait);
      const dialogue = document.createElement("p"); dialogue.className = "stage-dialogue"; dialogue.textContent = `${stage.id === "mirror" ? "ミラー" : opponent.name}「${stage.dialogue}」`; encounter.appendChild(dialogue);
      this.panel.appendChild(encounter); button("START ROUND", () => this.beginRound());
    } else if (screen === SCREEN.roundIntro) {
      heading(this.state.mode === "training" ? "TRAINING" : `ROUND ${this.state.round}`, `${CHARACTERS[this.player.id].name}  VS  ${CHARACTERS[this.cpu.id].name}`); button("FIGHT", () => this.setScreen(SCREEN.battle));
    } else if (screen === SCREEN.battle) {
      this.hintText("");
    } else if (screen === SCREEN.pause) { heading("PAUSE", this.state.mode === "training" ? "ENTER RESUME / ESC EXIT TRAINING" : "STICK SELECT / A OK / B BACK"); button("RESUME", () => this.setScreen(SCREEN.battle), this.state.pauseIndex === 0); button("QUIT TO TITLE", () => this.returnTitle(), this.state.pauseIndex === 1); }
    else if (screen === SCREEN.roundResult) { heading(this.state.result === "win" ? "ROUND WIN" : this.state.result === "loss" ? "ROUND LOSE" : "DRAW / REMATCH", `STAGE ${this.state.stage}  SCORE ${this.state.score}`); button("CONTINUE", () => this.resolveRoundResult()); }
    else if (screen === SCREEN.stageResult) { heading("STAGE CLEAR", `STAGE ${this.state.stage}  /  ${this.state.score} PTS`); button("NEXT STAGE", () => this.resolveStageResult()); }
    else if (screen === SCREEN.continue) { const max = DIFFICULTIES[this.state.difficulty].continues; heading("CONTINUE?", `${max === Infinity ? "∞" : max - this.state.continueUsed} CONTINUES LEFT`); button("YES", () => this.continueMatch(true)); button("NO", () => this.continueMatch(false)); }
    else if (screen === SCREEN.gameOver) {
      heading("GAME OVER", `STAGE ${this.state.stage}  SCORE ${this.state.score}`);
      button("TITLE", () => this.returnTitle());
    }
    else if (screen === SCREEN.ending) { heading("ALL STAGES CLEAR", `${CHARACTERS[this.state.selectedId].name} / FINAL SCORE ${this.state.score}`); button("VIEW SCORE", () => this.finishEnding()); }
    else if (screen === SCREEN.score) {
      const rank = rankForScore(this.state.score, { perfect: this.state.perfect, difficulty: this.state.difficulty }); heading("SCORE", `CURRENT ${this.state.score}  RANK ${rank}`);
      if (this.state.finalStats) {
        const stats = document.createElement("p");
        stats.textContent = `${this.state.finalStats.character} / ${this.state.finalStats.difficulty.toUpperCase()} / COLOR ${this.state.finalStats.color} · TIME ${formatDuration(this.state.finalStats.durationMs)} · MAX COMBO ${this.state.finalStats.maxCombo} · JUST ${this.state.finalStats.justGuards} · SPECIAL ${this.state.finalStats.specialHits} · CONTINUES ${this.state.finalStats.continues}`;
        this.panel.appendChild(stats);
      }
      const list = document.createElement("ol"); list.className = "score-list"; for (const entry of this.save.highScores) { const li = document.createElement("li"); li.textContent = `${entry.score}  ${entry.rank}  ${entry.character || "—"}  ${entry.difficulty}`; list.appendChild(li); } this.panel.appendChild(list); button("BACK", () => this.setScreen(SCREEN.menu));
    }
  }

  stagePreview(stage) {
    const img = document.createElement("img"); img.className = "stage-preview"; img.alt = stage.name; img.src = stage.background; return img;
  }

  hintText(value) { if (this.hint) this.hint.textContent = value; }
}

export function createGame(root = null) { return new Game(root); }

if (typeof document !== "undefined") {
  const boot = () => { const root = byId("game"); if (root) { const game = new Game(root); game.start(); globalThis.chabutoGame = game; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
