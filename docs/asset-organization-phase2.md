# スプライト中間生成物の段階整理（Phase 2）

実施日: 2026-08-03

## 結果

現行の `assets/sprites/<character>/actions` runtimeパスを変更せず、確認済みの中間生成物984件を3段階で移動した。ファイル削除と上書きは0件。

|段階|移動先|件数|bytes|Git状態|
|---|---|---:|---:|---|
|action制作物|`source/action-production`|629|279,125,818|untracked 629|
|旧トップレベル制作物|`source/legacy-production`|32|18,810,275|tracked 32（`git mv`）|
|root/tmp由来|`source/root-tmp`|323|64,351,337|untracked 323|
|合計||984|362,287,430|tracked 32 / untracked 952|

各移動の旧パス、新パス、サイズ、Git状態、SHA-256は次のファイルに保存した。

- `docs/asset-organization-phase2-map-action-production.json`
- `docs/asset-organization-phase2-map-legacy-production.json`
- `docs/asset-organization-phase2-map-root-tmp.json`

## 維持した正本

- 標準アクション: 8人 × 105枚
- skill body: 8人 × 6枚
- 合計runtimeフレーム: 888枚
- `actions/character-scale-profile.json`
- top-level `combat-1.png` ～ `combat-4.png`
- top-level `sheet-transparent.png`
- 既存metadataディレクトリ

Phase 1のCSVに記録された888枚のSHA-256と整理後ファイルを照合し、不一致0件を確認した。

## 新しい構成

```text
assets/sprites/<character>/
├─ actions/                    # runtime正本。パス変更なし
├─ source/
│  ├─ action-production/       # 旧actions配下のraw/QC/GIF/prompt等
│  ├─ legacy-production/       # 旧キャラ直下のraw/GIF/pipeline metadata
│  └─ root-tmp/                # root tmp、aligned、skill生成セッション
├─ metadata/
├─ manifest.json
├─ combat-1.png ... combat-4.png
└─ sheet-transparent.png
```

細かな `sheets/generated/references/archive` への再分類は、生成セッションを推測しないため今回は行っていない。元のファイル名と相対階層を保持した。

## ビルド保護

`scripts/build.mjs` に、`assets/sprites/**/source/**` と `assets/sprites/**/archive/**` をproduction buildから除外する規則を追加した。`dist` は引き続き正本ではなく、buildから再生成する。

## manifest

8キャラクターに `manifest.json` を追加した。character、status、runtime authority、全runtimeフレーム、canvas size、anchor、compatibility assets、production source roots、provenance statusを記録する。

生成は `scripts/generate_sprite_asset_manifests.mjs` で再現できる。

## 保留したもの

次はキャラクタースプライト中間物として一意に分類できないため移動していない。

- `tmp/imagegen/major-combat-upgrade`
- `tmp/imagegen/major-combat-upgrade-assets`
- `tmp/deploy`
- `tmp/uv-cache`
- 仮想環境・依存キャッシュ
- ルート `player_*.png`（参考資料候補だが、今回は「中間物だけ」の範囲外）

これらも削除していない。

## 回復方法

移動マップの `moves` を逆順に使い、`destination` から `source` へ戻せる。tracked 32件は `git mv`、untracked 952件は通常の同一ボリューム内移動であり、内容はSHA-256で照合できる。

## 検証結果

- production build: 成功（`dist/client/assets` 1,054件）
- `dist` 内の `source` / `archive` ファイル: 0件
- syntax check: 成功
- 自動テスト: 84/84件成功
- `validate_sprite_bundle.py`: 全8人成功、各105 RGBAフレーム
- `validate_asset_organization.mjs`: 成功
- runtime 888枚とPhase 1 SHA-256の不一致: 0件
- 移動マップ984件の旧パス残存・新パス欠落・SHA不一致: 0件
- ルートの `tmp_{norio,toko}_*_raw.png` / `tmp_aligned_*`: 0件
- 整理スクリプト再dry-run: 移動対象0件

ブラウザ操作確認は実施していない。ゲームコード・runtime画像は変更しておらず、今回は静的参照、画像bundle、production buildで確認した。

独立reviewerはPascal MCPの初期化タイムアウトにより起動できなかった。代替として差分、全移動先SHA、Phase 1 inventory、dist内容を親タスクで再監査し、整理スクリプトの空ディレクトリ後処理を対象skillディレクトリのみに限定した。
