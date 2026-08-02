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
} from "./engine.js";
import { appendHighScore, loadSave, resetSave, saveData } from "./storage.js";
import { RUNTIME_ANIMATION_ALIASES } from "./sprite-manifest.js";
import { TouchInput } from "./touch-input.js";

export const SCREEN = Object.freeze({
  boot: "boot", title: "title", menu: "menu", difficultySelect: "difficultySelect",
  characterSelect: "characterSelect", colorSelect: "colorSelect", trainingSettings: "trainingSettings",
  howToPlay: "howToPlay", settings: "settings",
  stageIntro: "stageIntro", roundIntro: "roundIntro", battle: "battle", pause: "pause",
  roundResult: "roundResult", stageResult: "stageResult", continue: "continue",
  gameOver: "gameOver", ending: "ending", score: "score",
});

const FRAME = 1000 / FIXED_HZ;
export const DEFAULT_SPRITE_SCALE = 0.82;

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
  if (fighter?.visualAction) return { name: fighter.visualAction, frame: Math.max(0, fighter.visualFrame || 0) };
  if (fighter?.state === "wakeup") return { name: "wakeup", frame: Math.max(0, fighter?.actionFrame || 0) };
  const action = fighter?.action || "idle";
  const move = fighter?.currentMove;
  const frame = Math.max(0, fighter?.actionFrame || 0);
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
// A held jump key must not reduce gravity indefinitely.  Constant gravity
// keeps jumps short and deterministic, while the air-frame guard below is a
// last-resort safety net for malformed/custom fighter data.
const GRAVITY = 0.48;
const MAX_AIR_FRAMES = 48;
const ACTION_LOCK_STATES = new Set(["attacking", "hitstun", "blockstun", "knockdown", "throwing"]);
const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
const MOVE_KEYS = Object.freeze({ light: "light_attack_neutral", strong: "strong_attack_neutral" });

function byId(id) { return typeof document === "undefined" ? null : document.getElementById(id); }
function text(value) { return String(value ?? ""); }

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
    this.touchInput = new TouchInput(this.root?.querySelector?.(".lcd") || this.root);
    this.save = loadSave();
    this.images = new Map();
    // Keep the last decoded frame for each fighter.  Animation frames load
    // asynchronously; retaining a ready frame prevents a one-frame blank
    // whenever a newly requested action image has not decoded yet.
    this.lastReadySprites = new Map();
    this.backgrounds = new Map();
    this.keys = new Set();
    this.justKeys = new Set();
    this.padHeld = new Set();
    this.padJust = new Set();
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
      stageFrame: 0,
      timerFrames: ROUND_TIME_SECONDS * FIXED_HZ,
      result: "",
      stageResult: "",
      screenFrames: 0,
      debug: this.save.debug === true,
      sound: this.save.sound !== false,
      bgmEnabled: this.save.bgmEnabled !== false,
      seEnabled: this.save.seEnabled !== false,
    };
    this.player = createFighterState(this.state.selectedId, 150, 1);
    this.cpu = createFighterState("toko", 330, -1);
    this.projectiles = [];
    this.installInput();
    this.render();
  }

  installInput() {
    if (typeof window === "undefined") return;
    this.onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "escape"].includes(key)) event.preventDefault();
      if (!this.keys.has(key)) this.justKeys.add(key);
      this.keys.add(key);
      if (this.state.screen !== SCREEN.battle && this.state.screen !== SCREEN.pause) this.ensureAudio();
    };
    this.onKeyUp = (event) => this.keys.delete(event.key.toLowerCase());
    this.onBlur = () => this.resetInput();
    this.onFocus = () => this.resetInput();
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
  }

  resetInput() {
    this.keys.clear();
    this.justKeys.clear();
    this.padHeld.clear();
    this.padJust.clear();
    this.touchInput?.reset();
  }

  destroy() {
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
    if (!this.state.seEnabled || this.soundContext || typeof AudioContext === "undefined") return;
    try { this.soundContext = new AudioContext(); } catch { this.soundContext = null; }
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
    if (!this.state.seEnabled || !this.soundContext) return;
    try {
      const oscillator = this.soundContext.createOscillator();
      const gain = this.soundContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.045, this.soundContext.currentTime);
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
    this.state.inputHistory.push({ frame: this.frame, left: input.left, right: input.right, down: input.down, up: input.up, light: input.light, strong: input.strong, guard: input.guard, special: input.special });
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
      if (input.confirm || this.state.screenFrames > 90) this.beginRound();
    } else if (this.state.screen === SCREEN.roundIntro) {
      if (input.confirm || this.state.screenFrames > 70) this.setScreen(SCREEN.battle);
    } else if (this.state.screen === SCREEN.battle) {
      if (input.pause || input.cancel) this.setScreen(SCREEN.pause);
      else this.tickBattle(input);
    } else if (this.state.screen === SCREEN.pause) {
      if (input.pause || input.cancel || input.confirm) this.setScreen(SCREEN.battle);
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
    this.touchInput?.clearEdges();
  }

  readInput() {
    const gamepad = this.pollGamepad();
    const touch = this.touchInput?.getSnapshot() || { held: new Set(), pressed: new Set() };
    const held = (key) => this.keys.has(key);
    const pressed = (...keys) => keys.some((key) => this.justKeys.has(key));
    const button = (key, aliases = []) => held(key) || aliases.some((alias) => held(alias));
    const touchHeld = (key) => touch.held.has(key);
    const touchPressed = (key) => touch.pressed.has(key);
    const left = button("arrowleft", ["a"]) || gamepad.left || touchHeld("left");
    const right = button("arrowright", ["d"]) || gamepad.right || touchHeld("right");
    const up = button("arrowup", ["w"]) || gamepad.up || touchHeld("up") || touchHeld("jump");
    const down = button("arrowdown", ["s"]) || gamepad.down || touchHeld("down");
    const leftPressed = pressed("arrowleft", "a") || gamepad.leftPressed || touchPressed("left");
    const rightPressed = pressed("arrowright", "d") || gamepad.rightPressed || touchPressed("right");
    const upPressed = pressed("arrowup", "w") || gamepad.upPressed || touchPressed("up") || touchPressed("jump");
    const downPressed = pressed("arrowdown", "s") || gamepad.downPressed || touchPressed("down");
    let light = button("j", ["z"]) || gamepad.light || touchHeld("light");
    let strong = button("k", ["x"]) || gamepad.strong || touchHeld("strong");
    let guard = button("l", ["c"]) || gamepad.guard || touchHeld("guard");
    const special = button("i", ["v"]) || gamepad.special || touchHeld("special");
    const throwHeld = (light && strong) || touchHeld("throw");
    const lightPressed = pressed("j", "z") || gamepad.lightPressed || touchPressed("light");
    const strongPressed = pressed("k", "x") || gamepad.strongPressed || touchPressed("strong");
    const specialPressed = pressed("i", "v") || gamepad.specialPressed || touchPressed("special");
    const confirm = pressed("enter", " ") || gamepad.confirmPressed;
    const cancel = pressed("escape", "backspace");
    const pause = cancel || touchPressed("pause");
    // A held J+K is a throw, while the individual attack edges remain usable.
    if (throwHeld) { light = false; strong = false; }
    return {
      left, right, up, down, light, strong, guard, special, throwHeld,
      leftPressed, rightPressed, upPressed, downPressed, lightPressed, strongPressed, specialPressed,
      throwPressed: touchPressed("throw") || (throwHeld && (lightPressed || strongPressed)),
      confirm, cancel, pause, start: confirm,
    };
  }

  pollGamepad() {
    const blank = { left: false, right: false, up: false, down: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, light: false, strong: false, guard: false, special: false, lightPressed: false, strongPressed: false, specialPressed: false, confirmPressed: false };
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") { this.padHeld.clear(); return blank; }
    let pad = null;
    try { pad = Array.from(navigator.getGamepads() || []).find(Boolean); } catch { this.padHeld.clear(); return blank; }
    if (!pad) { this.padHeld.clear(); return blank; }
    const buttonDown = (index) => Boolean(pad.buttons?.[index]?.pressed);
    const edge = (name, down) => { const just = down && !this.padHeld.has(name); if (just) this.padJust.add(name); if (down) this.padHeld.add(name); else this.padHeld.delete(name); return just; };
    const axisX = Number(pad.axes?.[0] || 0);
    const axisY = Number(pad.axes?.[1] || 0);
    const left = axisX < -0.35 || buttonDown(14);
    const right = axisX > 0.35 || buttonDown(15);
    const up = axisY < -0.35 || buttonDown(12);
    const down = axisY > 0.35 || buttonDown(13);
    const light = buttonDown(0) || buttonDown(2);
    const strong = buttonDown(1) || buttonDown(3);
    const guard = buttonDown(4) || buttonDown(6);
    const special = buttonDown(5) || buttonDown(7);
    const confirm = buttonDown(9) || buttonDown(0);
    const result = {
      left, right, up, down,
      leftPressed: edge("left", left), rightPressed: edge("right", right), upPressed: edge("up", up), downPressed: edge("down", down),
      light, strong, guard, special,
      lightPressed: edge("light", light), strongPressed: edge("strong", strong), specialPressed: edge("special", special), confirmPressed: edge("confirm", confirm),
    };
    this.padJust.clear();
    return result;
  }

  setScreen(screen) {
    this.state.screen = screen;
    this.state.screenFrames = 0;
    this.resetInput();
    this.touchInput?.setMode(screen === SCREEN.battle ? "battle" : screen === SCREEN.howToPlay ? "howToPlay" : "hidden");
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
      this.state.debug = !this.state.debug;
    } else if (index === 4) {
      this.save = resetSave(); this.state.sound = true; this.state.bgmEnabled = true; this.state.seEnabled = true; this.state.debug = false;
      this.beep(160, 0.1);
    } else if (index === 5) {
      this.setScreen(SCREEN.menu); return;
    }
    this.save = saveData({ ...this.save, sound: this.state.sound, bgmEnabled: this.state.bgmEnabled, seEnabled: this.state.seEnabled, debug: this.state.debug });
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
      if (index === 0) this.state.trainingCpuMove = !this.state.trainingCpuMove;
      else if (index === 1) this.state.trainingCpuAttack = !this.state.trainingCpuAttack;
      else if (index === 2) this.startTraining();
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
    this.state.combatNotice = { text: "", kind: "", damage: 0, x: 240, y: 120, frames: 0 };
    this.beginTrainingRound();
  }

  startStage() {
    this.state.stageFrame = 0;
    this.state.playerRounds = 0;
    this.state.cpuRounds = 0;
    this.state.round = 1;
    this.state.stageBonusAwarded = false;
    this.setScreen(SCREEN.stageIntro);
  }

  beginRound() {
    const opponentId = stageOpponent(this.state.stage, this.state.selectedId);
    this.player = createFighterState(this.state.selectedId, 150, 1);
    this.cpu = createFighterState(opponentId, 330, -1);
    this.player.color = this.state.color;
    this.cpu.color = opponentId === this.state.selectedId ? (this.state.color === 1 ? 2 : 1) : 1;
    this.player.boxProfile = "standing";
    this.cpu.boxProfile = "standing";
    this.state.timerFrames = ROUND_TIME_SECONDS * FIXED_HZ;
    this.projectiles = [];
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
    this.state.timerFrames = Number.POSITIVE_INFINITY;
    this.state.stageFrame = 0;
    this.projectiles = [];
    this.setScreen(SCREEN.roundIntro);
  }

  tickBattle(input) {
    const training = this.state.mode === "training";
    if (!training) this.state.timerFrames = Math.max(0, this.state.timerFrames - 1);
    this.state.stageFrame += 1;
    this.state.comboTimer = Math.max(0, this.state.comboTimer - 1);
    if (this.state.comboTimer === 0) this.state.combo = 0;
    if (this.state.combatNotice?.frames > 0) this.state.combatNotice.frames -= 1;
    this.updateFighter(this.player, input, true);
    const plan = training ? null : aiPlan({ self: this.cpu, opponent: this.player, difficulty: this.state.difficulty, nowFrame: this.frame });
    const aiInput = training ? this.trainingInput() : this.inputForPlan(plan);
    this.updateFighter(this.cpu, aiInput, false);
    resolvePushboxes(this.player, this.cpu);
    this.player.facing = this.player.x <= this.cpu.x ? 1 : -1;
    this.cpu.facing = -this.player.facing;
    this.handleCombat(this.player, this.cpu);
    this.handleCombat(this.cpu, this.player);
    this.updateProjectiles();
    if (training) this.resetTrainingDamageDummy();
    else if (this.player.hp <= 0 || this.cpu.hp <= 0 || this.state.timerFrames <= 0) this.finishRound();
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
      this.player.hp = MAX_HP;
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
    const blank = { left: false, right: false, up: false, down: false, light: false, strong: false, guard: false, special: false, throwHeld: false, leftPressed: false, rightPressed: false, upPressed: false, downPressed: false, lightPressed: false, strongPressed: false, specialPressed: false, throwPressed: false };
    if (!plan) return blank;
    if (plan.action === "walk") { blank[plan.direction < 0 ? "left" : "right"] = true; }
    else if (plan.action === "guard") blank.guard = true;
    else if (plan.action === "guard_low") { blank.guard = true; blank.down = true; }
    else if (plan.action === "jump") { blank.up = true; blank.upPressed = true; }
    else if (plan.action === "light") { blank.light = true; blank.lightPressed = true; }
    else if (plan.action === "strong") { blank.strong = true; blank.strongPressed = true; }
    else if (plan.action === "special") { blank.special = true; blank.specialPressed = true; }
    else if (plan.action === "throw") { blank.throwHeld = true; blank.throwPressed = true; }
    return blank;
  }

  updateFighter(fighter, input, isPlayer) {
    const character = CHARACTERS[fighter.id];
    advanceVisualSequence(fighter);
    const moveLocked = ACTION_LOCK_STATES.has(fighter.state);
    fighter.invulnerableFrames = Math.max(0, fighter.invulnerableFrames - 1);
    if (fighter.stunFrames > 0) {
      fighter.stunFrames -= 1;
      if (fighter.stunFrames === 0 && fighter.hp > 0) fighter.state = fighter.grounded ? "idle" : "jumping";
      return;
    }
    if (fighter.state === "knockdown") {
      fighter.boxProfile = "down";
      fighter.action = fighter.actionFrame < 18 ? "knockdown" : "down_idle";
      if (fighter.actionFrame++ > 45 && fighter.hp > 0) { fighter.state = "wakeup"; fighter.actionFrame = 0; }
      return;
    }
    if (fighter.state === "wakeup") {
      fighter.boxProfile = "standing";
      if (fighter.actionFrame++ > 20) { fighter.state = "idle"; fighter.actionFrame = 0; }
      return;
    }
    if (fighter.state === "attacking" || fighter.state === "throwing") {
      fighter.actionFrame += 1;
      const move = fighter.currentMove;
      if (move?.specialType === "projectile" && fighter.pendingProjectile && !fighter.projectileSpawned && fighter.actionFrame >= move.startupFrames) {
        this.projectiles.push(createProjectile(fighter === this.player ? "player" : "cpu", fighter, move, this.frame));
        fighter.projectileSpawned = true;
        fighter.pendingProjectile = null;
      }
      if (!move || fighter.actionFrame > move.startupFrames + move.activeFrames + move.recoveryFrames) {
        if (move?.kind === "special" && fighter === this.player && fighter.hitRegistry.size === 0) this.state.score += scoreForEvent("whiffSpecial");
        fighter.state = fighter.grounded ? "idle" : "jumping";
        fighter.actionFrame = 0;
        fighter.currentMove = null;
        fighter.hitRegistry.clear();
        fighter.pendingProjectile = null;
        fighter.projectileSpawned = false;
      }
      this.applyMoveMotion(fighter, move);
      if (!fighter.grounded) {
        fighter.airFrames = (fighter.airFrames || 0) + 1;
        fighter.vy -= GRAVITY;
        fighter.y += fighter.vy;
        if (fighter.y <= 0 || fighter.airFrames >= MAX_AIR_FRAMES) {
          fighter.y = 0;
          fighter.vy = 0;
          fighter.grounded = true;
          fighter.airFrames = 0;
          fighter.jumpsUsed = 0;
          fighter.doubleJumpAvailable = true;
          fighter.boxProfile = "standing";
        }
      }
      return;
    }
    const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (fighter.grounded && input.upPressed) {
      if (fighter.jumpsUsed === 0) {
        fighter.vy = character.stats.jumpVelocity;
        fighter.grounded = false;
        fighter.airFrames = 0;
        fighter.jumpsUsed = 1;
        fighter.state = "jumping";
        fighter.boxProfile = "air";
        fighter.action = "jump_start";
      } else if (fighter.doubleJumpAvailable) {
        fighter.vy = character.stats.jumpVelocity * 0.88;
        fighter.doubleJumpAvailable = false;
        fighter.airFrames = 0;
        fighter.state = "jumping";
        fighter.boxProfile = "air";
        fighter.action = "double_jump";
      }
    } else if (!fighter.grounded && input.upPressed && fighter.doubleJumpAvailable) {
      fighter.vy = character.stats.jumpVelocity * 0.88;
      fighter.doubleJumpAvailable = false;
      fighter.airFrames = 0;
      fighter.action = "double_jump";
    }
    if (!moveLocked && input.throwPressed) this.startThrow(fighter);
    else if (!moveLocked && input.specialPressed) this.startSpecial(fighter);
    else if (!moveLocked && (input.lightPressed || input.strongPressed)) this.startAttack(fighter, input);
    else if (!moveLocked && fighter.grounded && input.guard) {
      fighter.state = "guarding";
      fighter.action = input.down ? "guard_low" : "guard_high";
      fighter.boxProfile = input.down ? "crouch" : "standing";
      if (!fighter.guardHeld) fighter.guardStartedFrame = this.frame;
      fighter.guardHeld = true;
    } else {
      fighter.guardHeld = false;
      if (fighter.grounded) {
        const wasCrouching = fighter.crouching;
        fighter.crouching = input.down;
        fighter.boxProfile = input.down ? "crouch" : "standing";
        if (input.down && !wasCrouching) setVisualSequence(fighter, [{ name: "crouch_start", duration: 8 }]);
        else if (!input.down && wasCrouching) setVisualSequence(fighter, [{ name: "crouch_end", duration: 8 }]);
        if (direction !== 0 && !input.down) {
          const doubleTap = (input.leftPressed || input.rightPressed) && this.frame - fighter.lastDirectionFrame <= 14 && direction === fighter.lastDirection;
          // A backstep is a backward double-tap; crouch+back remains a normal
          // walk/crouch input and never silently changes movement semantics.
          const isBackstep = doubleTap && direction === -fighter.facing;
          if (isBackstep) { fighter.action = "backstep"; fighter.vx = -fighter.facing * character.stats.speed * 2.4; fighter.invulnerableFrames = 5; }
          else if (doubleTap) { fighter.action = "dash"; fighter.vx = direction * character.stats.speed * 2.2; }
          else { fighter.action = direction === fighter.facing ? "walk_forward" : "walk_backward"; fighter.vx = direction * character.stats.speed; }
          fighter.lastDirection = direction;
          fighter.lastDirectionFrame = this.frame;
          fighter.state = "moving";
        } else {
          fighter.vx *= 0.65;
          fighter.state = input.down ? "crouching" : "idle";
          fighter.action = input.down ? "crouch" : "idle";
          fighter.actionFrame = 0;
        }
      } else {
        fighter.airFrames = (fighter.airFrames || 0) + 1;
        fighter.actionFrame += 1;
        fighter.state = "jumping";
        fighter.action = fighter.vy > 0 ? "jump_up" : "jump_fall";
        fighter.vx = direction * character.stats.speed * character.stats.airControl;
      }
    }
    fighter.x += fighter.vx;
    if (!fighter.grounded) {
      fighter.vy -= GRAVITY;
      fighter.y += fighter.vy;
      if (fighter.y <= 0 || (fighter.airFrames || 0) >= MAX_AIR_FRAMES) {
        fighter.y = 0;
        fighter.vy = 0;
        fighter.grounded = true;
        fighter.airFrames = 0;
        fighter.jumpsUsed = 0;
        fighter.doubleJumpAvailable = true;
        fighter.state = "idle";
        fighter.action = "landing";
        fighter.actionFrame = 0;
        fighter.boxProfile = "standing";
        setVisualSequence(fighter, [{ name: "landing", duration: 6 }]);
      }
    }
    fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
  }

  applyMoveMotion(fighter, move) {
    if (!move) return;
    if (move.kind === "special" && move.movement) fighter.x += fighter.facing * move.movement;
    fighter.x = clamp(fighter.x, STAGE_BOUNDS.left, STAGE_BOUNDS.right);
  }

  startAttack(fighter, input) {
    const airborne = !fighter.grounded;
    const crouch = fighter.crouching;
    const key = input.strongPressed ? (airborne ? "strong_attack_air" : crouch ? "strong_attack_crouch" : "strong_attack_neutral") : (airborne ? "light_attack_air" : crouch ? "light_attack_crouch" : "light_attack_neutral");
    fighter.currentMove = CHARACTERS[fighter.id].moves[key];
    fighter.action = key;
    fighter.state = "attacking";
    fighter.actionFrame = 0;
    fighter.hitRegistry.clear();
  }

  startSpecial(fighter) {
    const move = CHARACTERS[fighter.id].special;
    if (fighter.meter < move.meterCost || fighter.state === "attacking") return;
    fighter.currentMove = move;
    fighter.meter = 0;
    fighter.state = "attacking";
    fighter.action = "special_start";
    fighter.actionFrame = 0;
    fighter.hitRegistry.clear();
    if (move.specialType === "projectile") {
      fighter.pendingProjectile = { move, owner: fighter === this.player ? "player" : "cpu" };
      fighter.projectileSpawned = false;
    }
  }

  startThrow(fighter) {
    fighter.currentMove = { id: "throw", kind: "throw", startupFrames: 5, activeFrames: 3, recoveryFrames: 22, damage: 150 * CHARACTERS[fighter.id].stats.throw, hitstunFrames: 30, scoreValue: 400, hitbox: null };
    fighter.state = "throwing";
    fighter.action = "throw_start";
    fighter.actionFrame = 0;
    fighter.hitRegistry.clear();
  }

  handleCombat(attacker, defender) {
    if (!attacker || !defender || attacker.hp <= 0 || defender.hp <= 0) return;
    const move = attacker.currentMove;
    if (!move || attacker.state !== "attacking" && attacker.state !== "throwing") return;
    if (move.kind === "throw" && activeFrame(move, attacker.actionFrame)) {
      if (!attacker.hitRegistry.has(`throw:${defender.id}`) && evaluateThrow(attacker, defender, attacker.actionFrame)) {
        attacker.hitRegistry.add(`throw:${defender.id}`);
        const damage = applyDamage(defender, move.damage, { knockbackX: move.knockbackX || 5, knockbackY: 2, hitstunFrames: move.hitstunFrames });
        defender.state = "knockdown";
        defender.action = "knockdown";
        defender.actionFrame = 0;
        setVisualSequence(defender, [{ name: "thrown", duration: 10 }]);
        this.onHit(attacker, defender, move, false, true, damage);
        attacker.action = "throw_hit";
        setVisualSequence(attacker, [{ name: "throw_success", duration: 10 }]);
      }
      return;
    }
    // Projectile specials resolve only through the projectile collision path.
    // Their authored move hitbox is a preview/debug shape, not a second hit.
    if (move.specialType === "projectile") return;
    const result = evaluateStrike(attacker, defender, move, attacker.actionFrame, attacker.hitRegistry);
    if (!result.hit) return;
    const difficulty = DIFFICULTIES[this.state.difficulty] || DIFFICULTIES.normal;
    const guardWasJustPressed = defender.guardHeld && defender.guardStartedFrame === this.frame - 1 && result.guardLevelOk && !result.unblockable;
    const justGuard = guardWasJustPressed && (defender === this.player || Math.random() < difficulty.justGuardRate);
    if (justGuard) {
      defender.meter = clamp(defender.meter + 12, 0, MAX_METER);
      if (defender === this.player) {
        this.state.justGuards += 1;
        this.state.score += scoreForEvent("justGuard");
      }
      defender.state = "idle";
      setVisualSequence(defender, [{ name: "just_guard", duration: 6 }]);
      attacker.stunFrames = 8;
      this.showCombatNotice("GUARD", "guard", 0, defender);
      this.beep(880, 0.08, "triangle");
      return;
    }
    const wasAirborne = !defender.grounded;
    const wasCrouching = defender.crouching || defender.boxProfile === "crouch";
    const damage = result.damage * (defender === this.cpu ? 1 : 0.92);
    const dealtDamage = applyDamage(defender, damage, { blocked: result.blocked, knockbackX: move.knockbackX, knockbackY: move.knockbackY, hitstunFrames: result.blocked ? move.blockstunFrames : move.hitstunFrames });
    if (!result.blocked && defender.hp > 0) {
      const firstHit = wasAirborne ? "air_hit" : wasCrouching ? "hit_crouch" : move.id.includes("strong") || move.kind === "special" ? "hit_heavy" : "hit_light";
      const sequence = [{ name: firstHit, duration: firstHit === "hit_heavy" ? 12 : 10 }];
      if (move.kind === "special" || move.knockbackX >= 4) sequence.push({ name: "knockback", duration: 10 });
      setVisualSequence(defender, sequence);
    }
    if (!result.blocked && move.kind === "special" && defender.hp > 0) {
      defender.state = "knockdown";
      defender.action = "knockdown";
      defender.actionFrame = 0;
      defender.boxProfile = "down";
    }
    attacker.meter = clamp(attacker.meter + (result.blocked ? move.meterGainOnBlock : move.meterGainOnHit), 0, MAX_METER);
    if (!result.blocked) defender.meter = clamp(defender.meter + Math.max(1, (move.meterGainOnHit || 4) * 0.5), 0, MAX_METER);
    this.onHit(attacker, defender, move, result.blocked, false, dealtDamage);
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
      this.showCombatNotice("GUARD", "guard", 0, defender);
      return;
    }
    this.showCombatNotice(`HIT ${Math.round(Number(damage) || 0)}`, "hit", damage, defender);
    if (this.state.mode === "training") this.state.trainingDamage = Math.round(Number(damage) || 0);
    if (!playerAttacker) {
      // CPU damage never awards player points/combo and ends a perfect run.
      this.state.perfect = false;
      this.state.combo = 0;
      return;
    }
    this.state.combo = Math.min(8, this.state.combo + 1);
    this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);
    this.state.comboTimer = 70;
    const key = thrown ? "throw" : move.kind === "special" ? "special" : move.id.includes("strong") ? "strong" : "light";
    this.state.score += scoreForEvent(key) + this.state.combo * 25;
    if (move.kind === "special") this.state.specialHits += 1;
    this.beep(move.kind === "special" ? 90 : 240, move.kind === "special" ? 0.13 : 0.045, "sawtooth");
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
        const damage = applyDamage(target, projectile.damage, { hitstunFrames: 32, knockbackX: 4, knockbackY: 2 });
        this.showCombatNotice(`HIT ${Math.round(Number(damage) || 0)}`, "hit", damage, target);
        if (this.state.mode === "training") this.state.trainingDamage = Math.round(Number(damage) || 0);
        if (target.hp > 0) setVisualSequence(target, [{ name: "hit_heavy", duration: 12 }, { name: "knockback", duration: 10 }]);
        if (target.hp > 0) {
          target.state = "knockdown";
          target.action = "knockdown";
          target.actionFrame = 0;
          target.boxProfile = "down";
        }
        if (projectile.owner === "player") this.state.score += scoreForEvent("special");
        else this.state.perfect = false;
        if (target.hp <= 0) { this.projectiles = []; break; }
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.x > STAGE_BOUNDS.left - 80 && projectile.x < STAGE_BOUNDS.right + 80 && !projectile.hit && this.frame <= projectile.activeUntil);
  }

  finishRound() {
    if (this.state.screen !== SCREEN.battle) return;
    const remaining = Math.floor(this.state.timerFrames / FIXED_HZ);
    const outcome = resolveRound(this.player, this.cpu, remaining);
    this.state.result = outcome.result;
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
      if (this.player.hp >= 1000) this.state.score += scoreForEvent("perfect");
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

  loadSprite(id, animationName, actionFrame = 0) {
    const character = CHARACTERS[id];
    const clip = character?.animation?.[animationName] || character?.animation?.idle;
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
    this.drawFighter(ctx, this.player);
    this.drawFighter(ctx, this.cpu);
    for (const projectile of this.projectiles) {
      ctx.fillStyle = "#ffe467";
      ctx.fillRect(projectile.x, INTERNAL_HEIGHT - projectile.y - 14, projectile.w, projectile.h);
      ctx.fillStyle = "#fff6bd";
      ctx.fillRect(projectile.x + 3, INTERNAL_HEIGHT - projectile.y - 11, projectile.w - 6, projectile.h - 6);
    }
    this.drawHud(ctx);
  }

  drawFighter(ctx, fighter) {
    const selection = animationSelectionFor(fighter);
    const image = this.loadSprite(fighter.id, selection.name, selection.frame);
    const character = CHARACTERS[fighter.id];
    const placement = spriteDrawPlacement(fighter, character?.sprite);
    const x = placement.originX;
    const y = placement.baselineY;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = fighter.hp <= 0 ? 0.66 : 1;
    if (fighter.color === 2) ctx.filter = "hue-rotate(70deg) saturate(1.2)";
    if (imageReady(image)) {
      ctx.translate(x, y);
      if (fighter.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(image, placement.drawX, placement.drawY, placement.width, placement.height);
    }
    ctx.restore();
    if (fighter.state === "guarding") {
      ctx.strokeStyle = "#79dfff"; ctx.strokeRect(x - 25, y - 92, 50, 72);
    }
    if (fighter.state === "attacking" && fighter.currentMove?.kind === "special" && fighter.actionFrame < fighter.currentMove.startupFrames) {
      ctx.fillStyle = "#ffe56e"; ctx.font = "bold 11px monospace"; ctx.fillText("!", x + fighter.facing * 24, y - 104);
    }
  }

  drawHud(ctx) {
    const bar = (x, y, width, value, color) => {
      ctx.fillStyle = "#0b101b"; ctx.fillRect(x, y, width, 8);
      ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, (width - 2) * clamp(value, 0, 1), 6);
      ctx.strokeStyle = "#eaf0ff"; ctx.strokeRect(x, y, width, 8);
    };
    bar(16, 14, 170, this.player.hp / 1000, "#ef505c");
    bar(294, 14, 170, this.cpu.hp / 1000, "#ef505c");
    bar(16, 25, 110, this.player.meter / 100, "#f6c84c");
    bar(354, 25, 110, this.cpu.meter / 100, "#f6c84c");
    ctx.fillStyle = "#f6f5de"; ctx.font = "bold 9px monospace";
    ctx.fillText(CHARACTERS[this.player.id]?.name || "1P", 16, 9);
    ctx.textAlign = "right"; ctx.fillText(CHARACTERS[this.cpu.id]?.name || "CPU", 464, 9);
    ctx.textAlign = "center"; ctx.font = "bold 18px monospace";
    const timerLabel = this.state.mode === "training" ? "--" : String(Math.ceil(this.state.timerFrames / FIXED_HZ)).padStart(2, "0");
    ctx.fillText(timerLabel, 240, 21);
    ctx.font = "bold 9px monospace"; ctx.fillText(`R${this.state.playerRounds}-${this.state.cpuRounds}  STAGE ${this.state.stage}`, 240, 34);
    ctx.textAlign = "left"; ctx.fillStyle = "#ffe795"; ctx.fillText(`${this.state.score.toString().padStart(6, "0")}  COMBO ${this.state.combo}`, 16, 45);
    if (this.state.mode === "training") {
      ctx.fillStyle = "#9de8ff";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`TRAINING  DAMAGE ${Math.round(this.state.trainingDamage || 0)}`, 16, 57);
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
    if (this.state.screen === SCREEN.pause) { ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT); ctx.fillStyle = "#fff"; ctx.font = "bold 28px monospace"; ctx.fillText("PAUSE", 268, 130); }
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
    else if (screen === SCREEN.title) { heading(GAME_TITLE, "RETRO DUEL / PRESS ENTER"); button("START", () => this.setScreen(SCREEN.menu)); }
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
        if (index === 0) this.state.trainingCpuMove = !this.state.trainingCpuMove;
        else if (index === 1) this.state.trainingCpuAttack = !this.state.trainingCpuAttack;
        else if (index === 2) this.startTraining();
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
      buttonRow([{ label: "CONFIRM", onClick: () => this.setScreen(SCREEN.colorSelect) }, { label: "BACK", onClick: () => this.setScreen(this.state.mode === "training" ? SCREEN.menu : SCREEN.difficultySelect) }]);
    } else if (screen === SCREEN.colorSelect) {
      heading("COLOR VARIATION", `${CHARACTERS[this.state.selectedId].name} / SELECT COLOR`);
      [1, 2].forEach((color) => button(`COLOR ${color}`, () => { this.state.color = color; this.renderPanel(); }, color === this.state.color));
      buttonRow([{ label: "FIGHT", onClick: () => this.state.mode === "training" ? this.setScreen(SCREEN.trainingSettings) : this.startMatch() }, { label: "BACK", onClick: () => this.setScreen(SCREEN.characterSelect) }]);
    } else if (screen === SCREEN.howToPlay) {
      heading("HOW TO PLAY", "基本操作・攻撃・防御");
      const p = document.createElement("pre"); p.textContent = "A/D・←/→  移動　同方向を素早く2回：ダッシュ／バックステップ\nW・↑  ジャンプ　空中でもう1回：二段ジャンプ\nS・↓  しゃがむ／下段ガード\nJ  弱攻撃　　K  強攻撃　　J+K  投げ\nL  上段ガード　攻撃直前のガード：ジャストガード\nI  ゲージ100で必殺技（ガード不能）\nESC  ポーズ／再開"; this.panel.appendChild(p); button("BACK", () => this.setScreen(SCREEN.menu));
    } else if (screen === SCREEN.stageIntro) {
      const stage = STAGES[this.state.stage - 1]; heading(`STAGE ${this.state.stage}`, stage.name); this.panel.appendChild(this.stagePreview(stage)); button("START ROUND", () => this.beginRound());
    } else if (screen === SCREEN.roundIntro) {
      heading(this.state.mode === "training" ? "TRAINING" : `ROUND ${this.state.round}`, `${CHARACTERS[this.player.id].name}  VS  ${CHARACTERS[this.cpu.id].name}`); button("FIGHT", () => this.setScreen(SCREEN.battle));
    } else if (screen === SCREEN.battle) {
      this.hintText("A/D MOVE  W JUMP  S CROUCH  J/K ATTACK  L GUARD  I SPECIAL  ESC PAUSE");
    } else if (screen === SCREEN.pause) { heading("PAUSE", "PRESS ESC OR ENTER TO RESUME"); button("RESUME", () => this.setScreen(SCREEN.battle)); button("QUIT TO TITLE", () => this.returnTitle()); }
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
