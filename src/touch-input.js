const TOUCH_MODES = Object.freeze({ hidden: "hidden", battle: "battle", preview: "howToPlay" });

// Pointer coordinates are normalized to the stick's travel radius before
// direction edges are emitted. Keeping this as a pure helper also makes the
// dead-zone contract deterministic for keyboard-less/mobile test harnesses.
export const STICK_DEAD_ZONE = 0.28;
export function stickActionsFromVector(x = 0, y = 0, deadZone = STICK_DEAD_ZONE) {
  const horizontal = Number(x) || 0;
  const vertical = Number(y) || 0;
  const threshold = Math.max(0, Math.min(1, Number(deadZone) || 0));
  const actions = [];
  if (horizontal <= -threshold) actions.push("left");
  if (horizontal >= threshold) actions.push("right");
  if (vertical <= -threshold) actions.push("up");
  if (vertical >= threshold) actions.push("down");
  return actions;
}

const ACTIONS = Object.freeze([
  { key: "a", label: "A", ariaLabel: "A: 弱攻撃" },
  { key: "b", label: "B", ariaLabel: "B: キャンセル / バックステップ" },
  { key: "x", label: "X", ariaLabel: "X: ガード / 左で投げ返し" },
  { key: "y", label: "Y", ariaLabel: "Y: ジャンプ" },
]);

function canUseDom() {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

export function isTouchAvailable(win = typeof window !== "undefined" ? window : null, _nav = typeof navigator !== "undefined" ? navigator : null) {
  // Pointer events work for touch, mouse, and stylus. The pad intentionally
  // remains available on desktop as well as mobile.
  return Boolean(win && typeof win.PointerEvent !== "undefined");
}

export class TouchInput {
  constructor(container = null) {
    this.container = container;
    this.root = null;
    this.stick = null;
    this.stickKnob = null;
    this.mode = TOUCH_MODES.hidden;
    this.available = false;
    this.destroyed = false;
    this.pointers = new Map();
    this.buttonCounts = new Map();
    this.actionCounts = new Map();
    this.pressed = new Set();
    this.stickActions = new Set();
    this.stickVector = { x: 0, y: 0 };
    this.bindings = [];
    this.stickPointerId = null;
    this.onBlur = () => this.reset();
    this.onVisibility = () => { if (document.hidden) this.reset(); };
    this.onResize = () => this.syncAvailability();
    this.onWindowPointerUp = (event) => {
      if (event.pointerId === this.stickPointerId) this.releaseStick(event.pointerId);
      else this.releasePointer(event.pointerId);
    };
    this.onWindowPointerCancel = () => this.reset();
    // The pad is deliberately non-copyable/non-contextual in every mode.
    this.onContextMenu = (event) => event.preventDefault();
    if (!container || !canUseDom()) return;
    this.build();
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("orientationchange", this.onResize, { passive: true });
    window.addEventListener("pointerup", this.onWindowPointerUp, true);
    window.addEventListener("pointercancel", this.onWindowPointerCancel, true);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.syncAvailability();
  }

  build() {
    const root = document.createElement("div");
    root.className = "virtual-pad";
    root.dataset.mode = TOUCH_MODES.hidden;
    root.hidden = true;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "バーチャルゲームコントローラー");
    root.setAttribute("aria-hidden", "true");
    root.addEventListener("contextmenu", this.onContextMenu);

    const stick = document.createElement("div");
    stick.className = "virtual-pad__stick";
    stick.setAttribute("role", "application");
    stick.setAttribute("aria-label", "3Dスティック: 移動、しゃがむ、ジャンプ");
    stick.setAttribute("aria-disabled", "true");
    stick.tabIndex = -1;
    const knob = document.createElement("span");
    knob.className = "virtual-pad__stick-knob";
    knob.setAttribute("aria-hidden", "true");
    stick.appendChild(knob);
    root.appendChild(stick);
    this.stick = stick;
    this.stickKnob = knob;

    const down = (event) => this.pressStick(event);
    const move = (event) => this.moveStick(event);
    const up = (event) => this.releaseStick(event.pointerId);
    const cancel = () => this.reset();
    stick.addEventListener("pointerdown", down, { passive: false });
    stick.addEventListener("pointermove", move, { passive: false });
    stick.addEventListener("pointerup", up);
    stick.addEventListener("pointercancel", cancel);
    stick.addEventListener("lostpointercapture", up);
    this.stickBindings = { stick, down, move, up, cancel };

    const actions = document.createElement("div");
    actions.className = "virtual-pad__actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "A B X Y アクションボタン");
    for (const item of ACTIONS) {
      actions.appendChild(this.createButton(item.key, item.label, item.ariaLabel, [item.key], "virtual-pad__action"));
    }
    root.appendChild(actions);

    // Pause is a compact system control outside the four-face action cluster.
    const system = document.createElement("div");
    system.className = "virtual-pad__system-control";
    system.setAttribute("role", "group");
    system.setAttribute("aria-label", "システム操作");
    system.appendChild(this.createButton("pause", "Ⅱ", "ポーズ", ["pause"], "virtual-pad__pause"));
    root.appendChild(system);

    this.container.appendChild(root);
    this.root = root;
  }

  createButton(key, label, ariaLabel, actions, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset.action = key;
    button.dataset.actions = actions.join(" ");
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-disabled", "true");
    button.tabIndex = -1;
    const down = (event) => this.pressPointer(event, button, actions);
    const up = (event) => this.releasePointer(event.pointerId);
    const cancel = () => this.reset();
    const lost = (event) => this.releasePointer(event.pointerId);
    button.addEventListener("pointerdown", down, { passive: false });
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", lost);
    this.bindings.push({ button, down, up, cancel, lost });
    return button;
  }

  addAction(action) {
    const count = (this.actionCounts.get(action) || 0) + 1;
    this.actionCounts.set(action, count);
    if (count === 1) this.pressed.add(action);
  }

  removeAction(action) {
    const count = (this.actionCounts.get(action) || 0) - 1;
    if (count > 0) this.actionCounts.set(action, count);
    else this.actionCounts.delete(action);
  }

  setStickActions(actions) {
    const next = new Set(actions);
    for (const action of this.stickActions) if (!next.has(action)) this.removeAction(action);
    for (const action of next) if (!this.stickActions.has(action)) this.addAction(action);
    this.stickActions = next;
  }

  pressStick(event) {
    if (this.destroyed || !this.available || this.mode === TOUCH_MODES.hidden) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    if (this.stickPointerId !== null && this.stickPointerId !== pointerId) this.releaseStick(this.stickPointerId);
    this.stickPointerId = pointerId;
    try { this.stick.setPointerCapture(pointerId); } catch { /* capture is optional */ }
    this.moveStick(event);
  }

  moveStick(event) {
    if (this.stickPointerId !== event.pointerId || !this.stick || !this.available) return;
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    const width = Math.max(1, Number(rect.width) || 1);
    const height = Math.max(1, Number(rect.height) || 1);
    const radius = Math.max(1, Math.min(width, height) * 0.5);
    const dx = (Number(event.clientX) || 0) - (Number(rect.left) || 0) - width * 0.5;
    const dy = (Number(event.clientY) || 0) - (Number(rect.top) || 0) - height * 0.5;
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > radius ? radius / magnitude : 1;
    const x = Math.max(-1, Math.min(1, (dx * scale) / radius));
    const y = Math.max(-1, Math.min(1, (dy * scale) / radius));
    this.stickVector = { x, y };
    if (this.stickKnob) this.stickKnob.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${y * radius}px))`;
    this.setStickActions(stickActionsFromVector(x, y));
  }

  releaseStick(pointerId = this.stickPointerId) {
    if (pointerId === null || pointerId === undefined || pointerId !== this.stickPointerId) return;
    try { if (this.stick?.hasPointerCapture(pointerId)) this.stick.releasePointerCapture(pointerId); } catch { /* already released */ }
    this.stickPointerId = null;
    this.stickVector = { x: 0, y: 0 };
    this.setStickActions([]);
    if (this.stickKnob) this.stickKnob.style.transform = "translate(-50%, -50%)";
  }

  pressPointer(event, button, actions) {
    if (this.destroyed || !this.available || this.mode === TOUCH_MODES.hidden) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    if (this.pointers.has(pointerId)) this.releasePointer(pointerId);
    try { button.setPointerCapture(pointerId); } catch { /* capture is optional */ }
    this.pointers.set(pointerId, { button, actions });
    this.buttonCounts.set(button, (this.buttonCounts.get(button) || 0) + 1);
    button.setAttribute("aria-pressed", "true");
    for (const action of actions) this.addAction(action);
  }

  releasePointer(pointerId) {
    const state = this.pointers.get(pointerId);
    if (!state) return;
    this.pointers.delete(pointerId);
    const buttonCount = (this.buttonCounts.get(state.button) || 0) - 1;
    if (buttonCount > 0) this.buttonCounts.set(state.button, buttonCount);
    else {
      this.buttonCounts.delete(state.button);
      state.button.setAttribute("aria-pressed", "false");
    }
    for (const action of state.actions) this.removeAction(action);
  }

  getSnapshot() {
    return { held: new Set(this.actionCounts.keys()), pressed: new Set(this.pressed) };
  }

  clearEdges() { this.pressed.clear(); }

  reset() {
    for (const [pointerId, state] of this.pointers) {
      try { if (state.button.hasPointerCapture(pointerId)) state.button.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    this.pointers.clear();
    this.buttonCounts.clear();
    this.actionCounts.clear();
    this.pressed.clear();
    this.stickActions.clear();
    this.stickPointerId = null;
    this.stickVector = { x: 0, y: 0 };
    for (const { button } of this.bindings) button.setAttribute("aria-pressed", "false");
    if (this.stickKnob) this.stickKnob.style.transform = "translate(-50%, -50%)";
  }

  syncAvailability() {
    this.available = isTouchAvailable();
    this.updateVisibility();
  }

  setMode(mode) {
    const next = mode === TOUCH_MODES.battle || mode === TOUCH_MODES.preview ? mode : TOUCH_MODES.hidden;
    if (next !== TOUCH_MODES.battle) this.reset();
    this.mode = next;
    if (this.root) this.root.dataset.mode = next;
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.root) return;
    const visible = this.available && (this.mode === TOUCH_MODES.battle || this.mode === TOUCH_MODES.preview);
    const interactive = visible;
    this.root.hidden = !visible;
    this.root.setAttribute("aria-hidden", visible ? "false" : "true");
    if (this.stick) {
      this.stick.tabIndex = interactive ? 0 : -1;
      this.stick.setAttribute("aria-disabled", interactive ? "false" : "true");
    }
    for (const { button } of this.bindings) {
      button.disabled = !interactive;
      button.tabIndex = interactive ? 0 : -1;
      button.setAttribute("aria-disabled", interactive ? "false" : "true");
    }
    if (!interactive) this.reset();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    window.removeEventListener("pointerup", this.onWindowPointerUp, true);
    window.removeEventListener("pointercancel", this.onWindowPointerCancel, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root?.removeEventListener("contextmenu", this.onContextMenu);
    if (this.stick && this.stickBindings) {
      const { down, move, up, cancel } = this.stickBindings;
      this.stick.removeEventListener("pointerdown", down);
      this.stick.removeEventListener("pointermove", move);
      this.stick.removeEventListener("pointerup", up);
      this.stick.removeEventListener("pointercancel", cancel);
      this.stick.removeEventListener("lostpointercapture", up);
    }
    for (const { button, down, up, cancel, lost } of this.bindings) {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("lostpointercapture", lost);
    }
    this.bindings = [];
    this.root?.remove();
    this.root = null;
    this.stick = null;
    this.stickKnob = null;
  }
}

export { TOUCH_MODES };
