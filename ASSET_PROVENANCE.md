# Asset provenance

The canonical fighter animation assets are the numbered PNG frames under:

- `assets/sprites/<character>/actions/<group>/<group>-N.png`
- `assets/sprites/<character>/actions/skill_body/skill_body-N.png`

`src/sprite-manifest.js` is the runtime authority for frame order, timing, and dynamic paths. Each character's `manifest.json` records the organization contract and complete runtime frame list. The top-level `combat-1.png` through `combat-4.png` and `sheet-transparent.png` remain compatibility/keyframe assets referenced by `src/data.js`; they are not the primary expanded animation source.

Production inputs, previews, QC output, and historical raw sheets are preserved under `assets/sprites/<character>/source`. Their pre-organization paths and SHA-256 values are recorded in `docs/asset-organization-phase2-map-*.json`. Files under `source` and `archive` are intentionally excluded from production builds.

The runtime also references the supplied stage PNGs, audio files, and generated effect assets under `assets/stages`, `assets/audio`, and `assets/effects`. No SVG, CSS, HTML, or canvas-drawn character substitute is used.

The game code and UI in this directory are standalone files. No sibling repository is modified and no external runtime asset is required.
