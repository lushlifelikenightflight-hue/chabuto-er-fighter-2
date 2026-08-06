const TOUCH_MODES = Object.freeze({ hidden: "hidden", menu: "menu", battle: "battle", preview: "howToPlay" });

// Pointer coordinates are normalized to the stick's travel radius before
// direction edges are emitted. Keeping this helper pure makes the mobile
// input contract deterministic in browser and headless test harnesses.
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

// Keep these keys raw. The game layer decides what A/B/X/Y mean in each
// screen; the touch layer only reports physical button edges.
const ACTIONS = Object.freeze([
  { key: "a", label: "A", ariaLabel: "A: 弱攻撃" },
  { key: "b", label: "B", ariaLabel: "B: 固有スキル" },
  { key: "x", label: "X", ariaLabel: "X: 強攻撃" },
  { key: "y", label: "Y", ariaLabel: "Y: ガード" },
]);

const VIEWPORT_STYLE_PROPERTIES = Object.freeze([
  "position",
  "inset",
  "width",
  "height",
  "maxWidth",
  "minHeight",
  "overflow",
  "touchAction",
  "overscrollBehavior",
  "userSelect",
  "webkitUserSelect",
]);
const GAME_ACTIVE_CLASS = "game-active";

function canUseDom() {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

export function isTouchAvailable(win = typeof window !== "undefined" ? window : null, nav = typeof navigator !== "undefined" ? navigator : null) {
  // The on-screen controller is an input option for mouse, pen and touch,
  // not a touch-device fallback. Any browser window can use it.
  void nav;
  return Boolean(win);
}

function safePreventDefault(event) {
  if (event?.cancelable !== false) event?.preventDefault?.();
}

export class TouchInput {
  constructor(container = null) {
    this.container = container;
    this.root = null;
    this.gameRoot = null;
    this.stick = null;
    this.stickKnob = null;
    this.mode = TOUCH_MODES.hidden;
    this.available = false;
    this.destroyed = false;
    this.pointers = new Map();
    this.buttonCounts = new Map();
    this.actionCounts = new Map();
    this.pressed = new Set();
    this.released = new Set();
    this.stickActions = new Set();
    this.stickVector = { x: 0, y: 0 };
    this.bindings = [];
    this.stickPointerId = null;
    this.viewportSnapshot = null;
    this.viewportState = { width: 0, height: 0, orientation: "landscape" };
    // Set by Game so the first touch edge can initialize audio synchronously.
    this.onInput = null;
    this.onBlur = () => this.reset();
    this.onVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) this.reset();
    };
    this.onResize = () => this.syncAvailability();
    this.onOrientationChange = () => {
      this.reset();
      this.syncAvailability();
    };
    this.onVisualViewportResize = () => this.syncViewportMetrics();
    this.onWindowPointerUp = (event) => {
      if (event?.pointerId === this.stickPointerId) this.releaseStick(event.pointerId);
      else this.releasePointer(event?.pointerId);
    };
    this.onWindowPointerCancel = (event) => {
      if (event?.pointerId === this.stickPointerId) this.releaseStick(event.pointerId);
      else this.releasePointer(event?.pointerId);
    };
    this.onRootPointerMove = (event) => {
      if (this.available && this.mode !== TOUCH_MODES.hidden) safePreventDefault(event);
    };
    this.onRootTouchMove = (event) => {
      if (this.available && this.mode !== TOUCH_MODES.hidden) safePreventDefault(event);
    };
    this.onSurfacePointerDown = (event) => {
      if (this.available && this.mode !== TOUCH_MODES.hidden) safePreventDefault(event);
    };
    this.onSurfacePointerMove = (event) => {
      if (this.available && this.mode !== TOUCH_MODES.hidden) safePreventDefault(event);
    };
    this.onSurfaceTouchMove = (event) => {
      if (this.available && this.mode !== TOUCH_MODES.hidden) safePreventDefault(event);
    };
    this.onContextMenu = (event) => safePreventDefault(event);
    if (!container || !canUseDom()) return;
    this.gameRoot = this.resolveGameRoot();
    this.build();
    this.container.addEventListener("pointerdown", this.onSurfacePointerDown, { passive: false });
    this.container.addEventListener("pointermove", this.onSurfacePointerMove, { passive: false });
    this.container.addEventListener("touchmove", this.onSurfaceTouchMove, { passive: false });
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("orientationchange", this.onOrientationChange, { passive: true });
    window.visualViewport?.addEventListener?.("resize", this.onVisualViewportResize, { passive: true });
    window.addEventListener("pointerup", this.onWindowPointerUp, true);
    window.addEventListener("pointercancel", this.onWindowPointerCancel, true);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.syncAvailability();
  }

  resolveGameRoot() {
    const closest = this.container?.closest?.("[data-game-root], #game");
    if (closest) return closest;
    let node = this.container;
    while (node) {
      if (node.id === "game" || node.dataset?.gameRoot !== undefined) return node;
      node = node.parentElement;
    }
    return document.querySelector?.("[data-game-root], #game") || this.container;
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
    root.addEventListener("pointermove", this.onRootPointerMove, { passive: false });
    root.addEventListener("touchmove", this.onRootTouchMove, { passive: false });

    const stick = document.createElement("div");
    stick.className = "virtual-pad__stick";
    stick.setAttribute("role", "application");
    stick.setAttribute("aria-label", "スティック: 移動、しゃがむ、ジャンプ");
    stick.setAttribute("aria-pressed", "false");
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
    const cancel = (event) => this.releaseStick(event.pointerId);
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
    // DOM order follows the face labels; CSS grid places them Y / X B / A.
    for (const item of ACTIONS) {
      actions.appendChild(this.createButton(item.key, item.label, item.ariaLabel, [item.key], "virtual-pad__action"));
    }
    root.appendChild(actions);

    // Jump and special are deliberately separate from the face cluster so
    // they remain reachable while a face button is held.
    const utilities = document.createElement("div");
    utilities.className = "virtual-pad__utilities";
    utilities.setAttribute("role", "group");
    utilities.setAttribute("aria-label", "ジャンプと必殺技");
    utilities.appendChild(this.createButton("jump", "JUMP", "ジャンプ", ["jump"], "virtual-pad__utility virtual-pad__jump"));
    utilities.appendChild(this.createButton("special", "SP", "必殺技", ["special"], "virtual-pad__utility virtual-pad__special"));
    utilities.appendChild(this.createButton("throw", "COUNTER", "カウンター", ["throw"], "virtual-pad__utility virtual-pad__throw"));
    root.appendChild(utilities);

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
    const down = (event) => {
      // Native pointer interaction also emits a click. Mark it briefly so the
      // click fallback below does not create a duplicate held edge.
      button.dataset.pointerActivated = "true";
      if (typeof setTimeout === "function") setTimeout(() => { delete button.dataset.pointerActivated; }, 0);
      this.pressPointer(event, button, actions);
    };
    const up = (event) => this.releasePointer(event.pointerId);
    const cancel = (event) => this.releasePointer(event.pointerId);
    const lost = (event) => this.releasePointer(event.pointerId);
    // Some embedded WebViews expose a click without PointerEvent dispatch.
    // Treat that as a one-frame pulse so menu A/B and direct mouse clicks are
    // usable while preserving pointerdown's held semantics in battle.
    const click = (event) => {
      if (button.dataset.pointerActivated === "true" || this.destroyed || !this.available || this.mode === TOUCH_MODES.hidden) return;
      this.onInput?.(event);
      button.classList.add("is-pressed");
      if (typeof setTimeout === "function") setTimeout(() => button.classList.remove("is-pressed"), 120);
      for (const action of actions) { this.addAction(action); this.removeAction(action); }
    };
    button.addEventListener("pointerdown", down, { passive: false });
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", lost);
    button.addEventListener("click", click);
    this.bindings.push({ button, down, up, cancel, lost, click });
    return button;
  }

  addAction(action) {
    const count = (this.actionCounts.get(action) || 0) + 1;
    this.actionCounts.set(action, count);
    if (count === 1) this.pressed.add(action);
  }

  removeAction(action) {
    const count = this.actionCounts.get(action);
    if (!count) return;
    if (count > 1) {
      this.actionCounts.set(action, count - 1);
      return;
    }
    this.actionCounts.delete(action);
    this.released.add(action);
  }

  setStickActions(actions) {
    const next = new Set(actions);
    for (const action of this.stickActions) if (!next.has(action)) this.removeAction(action);
    for (const action of next) if (!this.stickActions.has(action)) this.addAction(action);
    this.stickActions = next;
  }

  pressStick(event) {
    if (this.destroyed || !this.available || this.mode === TOUCH_MODES.hidden) return;
    this.onInput?.(event);
    safePreventDefault(event);
    const pointerId = event.pointerId ?? 0;
    if (this.stickPointerId !== null && this.stickPointerId !== pointerId) this.releaseStick(this.stickPointerId);
    if (this.pointers.has(pointerId)) this.releasePointer(pointerId);
    this.stickPointerId = pointerId;
    this.stick?.setAttribute("aria-pressed", "true");
    try { this.stick.setPointerCapture(pointerId); } catch { /* capture is optional */ }
    this.moveStick(event);
  }

  moveStick(event) {
    if (this.stickPointerId !== event.pointerId || !this.stick || !this.available) return;
    safePreventDefault(event);
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
    this.stick?.setAttribute("aria-pressed", "false");
    this.stickVector = { x: 0, y: 0 };
    this.setStickActions([]);
    if (this.stickKnob) this.stickKnob.style.transform = "translate(-50%, -50%)";
  }

  pressPointer(event, button, actions) {
    if (this.destroyed || !this.available || this.mode === TOUCH_MODES.hidden) return;
    this.onInput?.(event);
    safePreventDefault(event);
    const pointerId = event.pointerId ?? 0;
    if (pointerId === this.stickPointerId) this.releaseStick(pointerId);
    if (this.pointers.has(pointerId)) this.releasePointer(pointerId);
    try { button.setPointerCapture(pointerId); } catch { /* capture is optional */ }
    this.pointers.set(pointerId, { button, actions });
    this.buttonCounts.set(button, (this.buttonCounts.get(button) || 0) + 1);
    button.setAttribute("aria-pressed", "true");
    for (const action of actions) this.addAction(action);
  }

  releasePointer(pointerId) {
    if (pointerId === null || pointerId === undefined) return;
    const state = this.pointers.get(pointerId);
    if (!state) return;
    this.pointers.delete(pointerId);
    try { if (state.button.hasPointerCapture(pointerId)) state.button.releasePointerCapture(pointerId); } catch { /* already released */ }
    const buttonCount = (this.buttonCounts.get(state.button) || 0) - 1;
    if (buttonCount > 0) this.buttonCounts.set(state.button, buttonCount);
    else {
      this.buttonCounts.delete(state.button);
      state.button.setAttribute("aria-pressed", "false");
    }
    for (const action of state.actions) this.removeAction(action);
  }

  getSnapshot() {
    return {
      held: new Set(this.actionCounts.keys()),
      pressed: new Set(this.pressed),
      released: new Set(this.released),
    };
  }

  clearEdges() {
    this.pressed.clear();
    this.released.clear();
  }

  reset() {
    for (const [pointerId, state] of this.pointers) {
      try { if (state.button.hasPointerCapture(pointerId)) state.button.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    if (this.stickPointerId !== null) {
      try { if (this.stick?.hasPointerCapture(this.stickPointerId)) this.stick.releasePointerCapture(this.stickPointerId); } catch { /* already released */ }
    }
    this.pointers.clear();
    this.buttonCounts.clear();
    this.actionCounts.clear();
    this.pressed.clear();
    this.released.clear();
    this.stickActions.clear();
    this.stickPointerId = null;
    this.stickVector = { x: 0, y: 0 };
    for (const { button } of this.bindings) button.setAttribute("aria-pressed", "false");
    this.stick?.setAttribute("aria-pressed", "false");
    if (this.stickKnob) this.stickKnob.style.transform = "translate(-50%, -50%)";
  }

  // Keyboard/gamepad play still uses the same visual controller as touch.
  // This is deliberately visual-only: it never adds held input or edges.
  setExternalVisualActions(actions = []) {
    const active = new Set(actions);
    for (const { button } of this.bindings) {
      const mapped = String(button.dataset.actions || "").split(/\s+/).filter(Boolean);
      button.classList.toggle("is-pressed", mapped.some((action) => active.has(action)));
    }
    const moving = ["left", "right", "up", "down"].some((action) => active.has(action));
    this.stick?.classList.toggle("is-pressed", moving);
    if (this.stick && this.stickPointerId === null) this.stick.setAttribute("aria-pressed", moving ? "true" : "false");
  }

  syncAvailability() {
    const win = typeof window !== "undefined" ? window : null;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    this.available = isTouchAvailable(win, nav);
    this.syncViewportMetrics();
    this.updateVisibility();
  }

  syncViewportMetrics() {
    const win = typeof window !== "undefined" ? window : null;
    const viewport = win?.visualViewport;
    const width = Math.max(0, Number(viewport?.width || win?.innerWidth || 0));
    const height = Math.max(0, Number(viewport?.height || win?.innerHeight || 0));
    const orientation = width >= height ? "landscape" : "portrait";
    this.viewportState = { width, height, orientation };
    if (this.root) {
      this.root.dataset.orientation = orientation;
      this.root.style.setProperty("--viewport-width", `${width}px`);
      this.root.style.setProperty("--viewport-height", `${height}px`);
    }
  }

  setMode(mode, { preserveInput = false } = {}) {
    const next = mode === TOUCH_MODES.menu || mode === TOUCH_MODES.battle || mode === TOUCH_MODES.preview ? mode : TOUCH_MODES.hidden;
    if (!preserveInput) this.reset();
    this.mode = next;
    if (this.root) this.root.dataset.mode = next;
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.root) return;
    const visible = this.available && (this.mode === TOUCH_MODES.menu || this.mode === TOUCH_MODES.battle || this.mode === TOUCH_MODES.preview);
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
    this.syncDocumentLock(visible);
    this.syncViewportLock(visible);
    if (!interactive) this.reset();
  }

  syncDocumentLock(locked) {
    if (typeof document === "undefined") return;
    document.documentElement?.classList?.toggle(GAME_ACTIVE_CLASS, locked);
    document.body?.classList?.toggle(GAME_ACTIVE_CLASS, locked);
  }

  syncViewportLock(locked) {
    const target = this.gameRoot;
    if (!target) return;
    if (locked) {
      if (!this.viewportSnapshot) {
        this.viewportSnapshot = {
          target,
          cssText: target.style?.cssText ?? null,
          inlineStyles: Object.fromEntries(VIEWPORT_STYLE_PROPERTIES.map((property) => [property, target.style?.[property] ?? ""])),
          className: typeof target.className === "string" ? target.className : null,
        };
      }
      target.classList?.add("game-viewport-lock");
      if (target.style) {
        target.style.position = "fixed";
        target.style.inset = "0";
        target.style.width = "100%";
        target.style.height = "100dvh";
        target.style.maxWidth = "none";
        target.style.minHeight = "0";
        target.style.overflow = "hidden";
        target.style.touchAction = "none";
        target.style.overscrollBehavior = "none";
        target.style.userSelect = "none";
        target.style.webkitUserSelect = "none";
      }
      return;
    }
    const snapshot = this.viewportSnapshot;
    if (!snapshot) return;
    const { target: lockedTarget } = snapshot;
    if (lockedTarget.style) {
      if (snapshot.cssText !== null) lockedTarget.style.cssText = snapshot.cssText;
      else for (const property of VIEWPORT_STYLE_PROPERTIES) lockedTarget.style[property] = snapshot.inlineStyles[property];
    }
    if (snapshot.className !== null) lockedTarget.className = snapshot.className;
    this.viewportSnapshot = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();
    this.syncDocumentLock(false);
    this.syncViewportLock(false);
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", this.onBlur);
      window.removeEventListener("resize", this.onResize);
      window.removeEventListener("orientationchange", this.onOrientationChange);
      window.visualViewport?.removeEventListener?.("resize", this.onVisualViewportResize);
      window.removeEventListener("pointerup", this.onWindowPointerUp, true);
      window.removeEventListener("pointercancel", this.onWindowPointerCancel, true);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.root?.removeEventListener("contextmenu", this.onContextMenu);
    this.root?.removeEventListener("pointermove", this.onRootPointerMove);
    this.root?.removeEventListener("touchmove", this.onRootTouchMove);
    this.container?.removeEventListener("pointerdown", this.onSurfacePointerDown);
    this.container?.removeEventListener("pointermove", this.onSurfacePointerMove);
    this.container?.removeEventListener("touchmove", this.onSurfaceTouchMove);
    if (this.stick && this.stickBindings) {
      const { down, move, up, cancel } = this.stickBindings;
      this.stick.removeEventListener("pointerdown", down);
      this.stick.removeEventListener("pointermove", move);
      this.stick.removeEventListener("pointerup", up);
      this.stick.removeEventListener("pointercancel", cancel);
      this.stick.removeEventListener("lostpointercapture", up);
    }
    for (const { button, down, up, cancel, lost, click } of this.bindings) {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("lostpointercapture", lost);
      button.removeEventListener("click", click);
    }
    this.bindings = [];
    this.root?.remove();
    this.root = null;
    this.stick = null;
    this.stickKnob = null;
  }
}

export { TOUCH_MODES };
