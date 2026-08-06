export const CONTROLLER_ACTIONS = Object.freeze(["light", "strong", "guard", "counter", "jump", "skill", "special"]);
export const DEFAULT_CONTROLLER_BINDINGS = Object.freeze({ light: 0, strong: 2, guard: 3, counter: 4, jump: 8, skill: 1, special: 5 });
export const RESERVED_CONTROLLER_BUTTONS = Object.freeze(new Set([9, 10, 11, 12, 13, 14, 15]));

export function isAssignableControllerButton(button) {
  return Number.isInteger(button) && button >= 0 && button <= 31 && !RESERVED_CONTROLLER_BUTTONS.has(button);
}

export function normalizeControllerBindings(value) {
  const result = {};
  for (const player of ["p1", "p2"]) {
    const source = value?.[player] || {};
    result[player] = {};
    for (const action of CONTROLLER_ACTIONS) {
      const button = source[action];
      result[player][action] = isAssignableControllerButton(button) ? button : DEFAULT_CONTROLLER_BINDINGS[action];
    }
  }
  return result;
}
