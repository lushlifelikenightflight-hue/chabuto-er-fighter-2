# Asset provenance

The runtime references only binary assets already supplied in this workspace:

- `assets/sprites/{guitar-boy,green-slime,bob-girl,uncle,rusty,kazushige,norio,toko}/sheet-transparent.png`
- The corresponding `combat-1.png` through `combat-4.png` files for each fighter
- `assets/stages/stage-toko.png`, `stage-norio.png`, `stage-kazushige.png`, `stage-rusty.png`, and `stage-mirror.png`
- `assets/audio/bgm-title.mp3` and `assets/audio/bgm-battle.mp3`, copied from the existing 茶封筒erファイター source project

The combat PNGs are rendered directly with nearest-neighbor scaling. `combat-1` is the idle/neutral frame, `combat-2` is used for light attacks, `combat-3` for strong/throw poses, and `combat-4` for special, hit, knockdown, and defeat poses. Runtime transforms and timing provide the remaining animation contract clips; no SVG, CSS, HTML, or canvas-drawn character substitute is used.

The game code and UI in this directory are new standalone files. No sibling repository was modified and no external dependency or network asset is required.
