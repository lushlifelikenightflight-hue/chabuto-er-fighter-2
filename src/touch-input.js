const TOUCH_MODES = Object.freeze({ hidden: "hidden", battle: "battle", preview: "howToPlay" });

const DIRECTIONS = Object.freeze([
  { key: "up-left", label: "↖", actions: ["left", "up"], position: "up-left" },
  { key: "up", label: "↑", actions: ["up"], position: "up" },
  { key: "up-right", label: "↗", actions: ["right", "up"], position: "up-right" },
  { key: "left", label: "←", actions: ["left"], position: "left" },
  { key: "right", label: "→", actions: ["right"], position: "right" },
  { key: "down-left", label: "↙", actions: ["left", "down"], position: "down-left" },
  { key: "down", label: "↓", actions: ["down"], position: "down" },
  { key: "down-right", label: "↘", actions: ["right", "down"], position: "down-right" },
]);

const ACTIONS = Object.freeze([
  { key: "light", label: "弱", ariaLabel: "弱攻撃" },
  { key: "strong", label: "強", ariaLabel: "強攻撃" },
  { key: "guard", label: "G", ariaLabel: "ガード" },
  { key: "throw", label: "投", ariaLabel: "投げ" },
  { key: "special", label: "必", ariaLabel: "必殺技" },
  { key: "jump", label: "J", ariaLabel: "ジャンプ" },
]);

function canUseDom() {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

export function isTouchAvailable(win = typeof window !== "undefined" ? window : null, nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!win || typeof win.PointerEvent === "undefined") return false;
  // Pointer events work for both touch and mouse/stylus.  Keep the virtual
  // pad available on desktop as well as mobile so controls are discoverable
  // and usable regardless of viewport or capability heuristics.
  return true;
}

export class TouchInput {
  constructor(container = null) {
    this.container = container;
    this.root = null;
    this.mode = TOUCH_MODES.hidden;
    this.available = false;
    this.destroyed = false;
    this.pointers = new Map();
    this.actionCounts = new Map();
    this.buttonCounts = new Map();
    this.pressed = new Set();
    this.bindings = [];
    this.onBlur = () => this.reset();
    this.onVisibility = () => { if (document.hidden) this.reset(); };
    this.onResize = () => this.syncAvailability();
    this.onWindowPointerUp = (event) => this.releasePointer(event.pointerId);
    this.onWindowPointerCancel = () => this.reset();
    this.onContextMenu = (event) => { if (this.mode === TOUCH_MODES.battle) event.preventDefault(); };
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
    root.setAttribute("aria-label", "タッチ操作");
    root.setAttribute("aria-hidden", "true");
    root.addEventListener("contextmenu", this.onContextMenu);

    const dpad = document.createElement("div");
    dpad.className = "virtual-pad__dpad";
    dpad.setAttribute("role", "group");
    dpad.setAttribute("aria-label", "方向パッド");
    for (const item of DIRECTIONS) {
      dpad.appendChild(this.createButton(item.key, item.label, `${item.label}方向`, item.actions, `virtual-pad__direction is-${item.position}`));
    }
    root.appendChild(dpad);

    const actions = document.createElement("div");
    actions.className = "virtual-pad__actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "バトル操作");
    for (const item of ACTIONS) {
      actions.appendChild(this.createButton(item.key, item.label, item.ariaLabel, [item.key], "virtual-pad__action"));
    }
    actions.appendChild(this.createButton("pause", "Ⅱ", "ポーズ", ["pause"], "virtual-pad__pause"));
    root.appendChild(actions);

    const orientation = document.createElement("p");
    orientation.className = "virtual-pad__orientation";
    orientation.textContent = "横画面でのプレイを推奨します";
    root.appendChild(orientation);
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

  pressPointer(event, button, actions) {
    if (this.destroyed || !this.available || this.mode !== TOUCH_MODES.battle) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    if (this.pointers.has(pointerId)) this.releasePointer(pointerId);
    try { button.setPointerCapture(pointerId); } catch { /* capture is optional */ }
    this.pointers.set(pointerId, { button, actions });
    this.buttonCounts.set(button, (this.buttonCounts.get(button) || 0) + 1);
    button.setAttribute("aria-pressed", "true");
    for (const action of actions) {
      const count = (this.actionCounts.get(action) || 0) + 1;
      this.actionCounts.set(action, count);
      if (count === 1) this.pressed.add(action);
    }
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
    for (const action of state.actions) {
      const count = (this.actionCounts.get(action) || 0) - 1;
      if (count > 0) this.actionCounts.set(action, count);
      else this.actionCounts.delete(action);
    }
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
    this.actionCounts.clear();
    this.buttonCounts.clear();
    this.pressed.clear();
    for (const { button } of this.bindings) button.setAttribute("aria-pressed", "false");
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
    const interactive = visible && this.mode === TOUCH_MODES.battle;
    this.root.hidden = !visible;
    this.root.setAttribute("aria-hidden", visible ? "false" : "true");
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
    for (const { button, down, up, cancel, lost } of this.bindings) {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("lostpointercapture", lost);
    }
    this.bindings = [];
    this.root?.remove();
    this.root = null;
  }
}

export { TOUCH_MODES };
