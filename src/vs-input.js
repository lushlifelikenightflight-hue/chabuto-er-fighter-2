// Local VS input is deliberately isolated from the single-player/touch contract.
// Each keyboard half is a distinct claimable source; gamepads retain their browser
// index so unplugging one controller cannot affect the other player's edges.
import { DEFAULT_CONTROLLER_BINDINGS, normalizeControllerBindings } from "./controller-bindings.js";
export const VS_KEYBOARD_PROFILES = Object.freeze({
  p1: Object.freeze({ left: "a", right: "d", up: "w", down: "s", jump: "e", light: "f", strong: "g", guard: "h", skill: "r", special: "t", pause: "q" }),
  p2: Object.freeze({ left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown", jump: "u", light: "j", strong: "k", guard: "l", skill: "b", special: "i", pause: "backspace" }),
});

export const VS_KEYBOARD_SOURCES = Object.freeze(["keyboard-p1", "keyboard-p2"]);

export function blankVsInput() {
  return { left: false, right: false, up: false, down: false, jump: false, light: false, strong: false, guard: false, counter: false, skill: false, special: false, pause: false, leftPressed: false, rightPressed: false, upPressed: false, upReleased: false, downPressed: false, jumpPressed: false, jumpReleased: false, lightPressed: false, strongPressed: false, guardPressed: false, counterPressed: false, counterReleased: false, skillPressed: false, skillReleased: false, specialPressed: false, specialReleased: false, pausePressed: false, confirm: false, cancel: false };
}

function edgeInput(down, pressed, released, profile) {
  const result = blankVsInput();
  for (const [action, key] of Object.entries(profile)) {
    if (action === "pause") { result.pause = down(key); result.pausePressed = pressed(key); continue; }
    result[action] = down(key);
    result[`${action}Pressed`] = pressed(key);
    if (["skill", "special", "jump", "up"].includes(action)) result[`${action}Released`] = released(key);
  }
  result.confirm = result.lightPressed || result.strongPressed;
  result.cancel = result.pausePressed;
  return result;
}

export class VsInputRouter {
  constructor(bindings = null) { this.claims = { p1: null, p2: null }; this.padHeld = new Map(); this.disconnectedPlayers = new Set(); this.bindings = normalizeControllerBindings(bindings); }

  setBindings(bindings) { this.bindings = normalizeControllerBindings(bindings); }

  resetClaims() { this.claims = { p1: null, p2: null }; this.disconnectedPlayers.clear(); }
  consumeDisconnectedPlayers() { const players = [...this.disconnectedPlayers]; this.disconnectedPlayers.clear(); return players; }
  sourceForPlayer(player) { return this.claims[player] || null; }
  isReady() { return Boolean(this.claims.p1 && this.claims.p2); }

  poll(keys = new Set(), justKeys = new Set(), releasedKeys = new Set(), pads = null) {
    const down = (key) => keys.has(key);
    const pressed = (key) => justKeys.has(key);
    const released = (key) => releasedKeys.has(key);
    const sources = new Map([
      ["keyboard-p1", edgeInput(down, pressed, released, VS_KEYBOARD_PROFILES.p1)],
      ["keyboard-p2", edgeInput(down, pressed, released, VS_KEYBOARD_PROFILES.p2)],
    ]);
    const list = pads === null ? (() => { try { return Array.from(globalThis.navigator?.getGamepads?.() || []); } catch { return []; } })() : Array.from(pads || []);
    const seen = new Set();
    list.forEach((pad, fallbackIndex) => {
      if (!pad || pad.connected === false) return;
      const index = Number.isInteger(pad.index) ? pad.index : fallbackIndex;
      seen.add(index);
      sources.set(`gamepad-${index}`, this.padInput(pad, index));
    });
    for (const index of this.padHeld.keys()) {
      if (seen.has(index)) continue;
      this.padHeld.delete(index);
      const source = `gamepad-${index}`;
      for (const player of ["p1", "p2"]) if (this.claims[player] === source) { this.claims[player] = null; this.disconnectedPlayers.add(player); }
    }
    return sources;
  }

  padInput(pad, index) {
    const held = this.padHeld.get(index) || new Set();
    const button = (i) => Boolean(pad.buttons?.[i]?.pressed);
    const axisX = Number(pad.axes?.[0] || 0); const axisY = Number(pad.axes?.[1] || 0);
    const player = this.claims.p1 === `gamepad-${index}` ? "p1" : this.claims.p2 === `gamepad-${index}` ? "p2" : "p1";
    const binding = this.bindings[player] || DEFAULT_CONTROLLER_BINDINGS;
    const values = { left: axisX < -.35 || button(14), right: axisX > .35 || button(15), up: axisY < -.35 || button(12), down: axisY > .35 || button(13), jump: button(binding.jump), light: button(binding.light), skill: button(binding.skill), strong: button(binding.strong), guard: button(binding.guard), counter: button(binding.counter), special: button(binding.special), pause: button(9) };
    const result = blankVsInput();
    for (const [action, value] of Object.entries(values)) {
      result[action] = value;
      result[`${action}Pressed`] = value && !held.has(action);
      if (["skill", "special", "jump", "counter", "up"].includes(action)) result[`${action}Released`] = !value && held.has(action);
      if (value) held.add(action); else held.delete(action);
    }
    result.confirm = result.lightPressed || result.strongPressed || result.pausePressed;
    result.cancel = result.pausePressed;
    this.padHeld.set(index, held);
    return result;
  }

  claim(sources) {
    for (const [source, input] of sources) {
      if (!input.confirm && !input.leftPressed && !input.rightPressed && !input.upPressed && !input.downPressed) continue;
      if (Object.values(this.claims).includes(source)) continue;
      const vacant = !this.claims.p1 ? "p1" : !this.claims.p2 ? "p2" : null;
      if (vacant) this.claims[vacant] = source;
    }
    return this.isReady();
  }

  playerInputs(sources) { return { p1: sources.get(this.claims.p1) || blankVsInput(), p2: sources.get(this.claims.p2) || blankVsInput() }; }
}
