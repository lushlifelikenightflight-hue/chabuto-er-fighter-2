# 茶封筒erファイター2

Standalone, dependency-free browser fighting game. Open `index.html` from a static server (or any host that serves ES modules) and press Enter. The game runs at a fixed 60 Hz simulation step inside a 480×270 pixel arena and uses keyboard or a standard gamepad mapped by the browser.

Controls:

- `A/D` or `←/→`: walk, dash, and backstep
- `W` or `↑`: jump / double jump; `S` or `↓`: crouch and low guard
- `J`: light, `K`: strong, `J+K`: throw, `L`: guard, `I`: 100-meter unblockable special
- `Esc`: pause; the menu also exposes independent BGM/SE toggles, score, reset data, and a debug-box toggle

The five ordered CPU stages are トコ → のりお → かずしげ → らすてぃー → selected-character mirror. A stage is a two-round match with 60-second rounds; a draw rematches the round. Continues are Easy ∞, Normal 3, and Hard 1.

No build or install step is required. Static checks:

```text
npm test
npm run syntax
```

The test suite is intentionally Node-only and checks data invariants, facing/collision helpers, progression, fixed-step timing, and corrupted-storage recovery. Browser rendering and audio are kept dependency-free and are not exercised by those tests.
