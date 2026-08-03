# スプライト素材・生成途中ファイル監査（Phase 1）

監査日: 2026-08-03  
対象: `F:/Github/chabuto-er-fighter-2`  
方針: 読み取り専用調査を先に行い、素材の移動・削除・改名・再生成・ビルド・デプロイは実施しない。

## 1. 結論

現在の格闘アニメーションの正本は、`assets/sprites/<character>/actions/<group>/<group>-N.png` と `assets/sprites/<character>/actions/skill_body/skill_body-N.png` である（**Confirmed**）。`src/sprite-manifest.js` が8キャラクター共通の動的パスを生成し、`src/data.js`、`src/game.js` がそのマニフェストを読み込んで描画する。

`dist` は正本ではない（**Confirmed**）。`scripts/build.mjs` が毎回 `dist` を削除して作り直し、`assets` のうちデプロイ対象だけを `dist/client/assets` へコピーする。現在の `dist/client/assets` 1,054件は、ビルド規則から期待される `assets` 1,054件とパスが完全一致し、SHA-256も1,054/1,054件で一致した。`dist` は `.gitignore` の `dist/` により全件Git非追跡である。

`raw-sheet*.png`、アクションディレクトリ内の `sheet-transparent.png`、`animation.gif`、`pipeline-meta*.json`、`prompt*.txt`、`corrected-*`、`recomposed-*`、`*-failed.*` は、生成・補正・QCの中間物または生成記録であり、現行ビルドから除外される（**Confirmed**）。ただし、将来の再生成元になり得るため、削除可否はまだ確定していない。

プロジェクト直下の `player_01_...png` から `player_08_...png` はGit追跡済みの初期資料だが、現行ソース、ビルドスクリプト、テストから直接参照されていない（**Confirmed**）。用途は「初期の人物参照画像」が最も妥当だが、生成元としての正式な記録が不足しているため分類は **Probable** とする。

完全なファイル別一覧は [asset-organization-inventory.csv](./asset-organization-inventory.csv) に記録した。5,500件すべてについて、相対パス、ファイル名、拡張子、サイズ、更新日時、Git状態、SHA-256、PNG幅・高さ、アルファチャンネル、完全重複グループを収録している。

## 2. 根拠強度

|区分|意味|
|---|---|
|Confirmed|コード参照、ビルド規則、Git状態、SHA-256、または生成スクリプトから確定|
|Probable|複数の証拠が一致するが、生成コマンドまたは明示的provenanceが不足|
|Unknown|根拠不足。移動・削除・正本認定を行わない|

## 3. Git状態

- ブランチ: `main`
- 調査時HEAD: `9c2228a20ef6fe541a09106ac63c26b6d5509d67`
- `origin/main` に対して4コミットahead
- 調査開始時、追跡済みファイルの変更は0件
- 既存untrackedファイル: 1,150件
  - `assets`: 629件
  - ルートの `tmp*`: 521件
- 監査対象内のGit状態: tracked 1,107件、untracked 1,150件、ignored 3,243件
- `.gitignore`: `dist/` と `*.tar.gz`
- `dist`: 1,066件すべてignored、追跡済み0件
- `tmp/uv-cache/.gitignore` の `*` により、その配下もignored
- 既存の未コミット素材には変更を加えていない。本監査で新規作成したのは、この報告書とCSV付録だけである。

注意: untrackedの生成途中ファイルが非常に多いため、`git status` の表示だけでは全体像を把握しづらい。CSV付録を判定の基準にする。

## 4. 監査対象の総量

|領域|ファイル数|合計バイト|Git状態|
|---|---:|---:|---|
|`assets`|1,707|330,950,345|tracked 1,078 / untracked 629|
|`src`|8|230,876|全件tracked|
|`scripts`|8|23,064|全件tracked|
|`tests`|5|70,983|全件tracked|
|`dist`|1,066|33,317,834|全件ignored|
|ルート `tmp*`|2,698|375,458,507|untracked 521 / ignored 2,177|
|ルート `player_*.png`|8|7,869,239|全件tracked|
|合計|5,500|747,920,848|tracked 1,107 / untracked 1,150 / ignored 3,243|

主な拡張子はPNG 2,890件、JSON 217件、GIF 129件、MP3 4件、TXT 63件である。`tmp` 内にはPython仮想環境・キャッシュ由来の `.py` 1,011件も含まれる。

PNGのアルファ判定はPNGのIHDR color typeと `tRNS` チャンク有無による。「alphaあり」はチャンネルの存在を示し、全画素の透明度をデコードして検証した値ではない。現行の標準アクション、skill body、VFXの256×256 PNGはRGBAである（**Confirmed**）。

## 5. 現在ゲームから参照される正本

### 5.1 標準アクションフレーム — Confirmed

`src/sprite-manifest.js` は8キャラクターに対し、次のパターンを動的生成する。

`assets/sprites/${id}/actions/${group}/${group}-${index}.png`

1キャラクターあたり105フレームで、内訳は次のとおり。

|グループ|枚数|用途|
|---|---:|---|
|`idle`|4|待機|
|`movement`|12|前進、後退、ダッシュ、バックステップ|
|`crouch`|6|しゃがみ開始、維持、終了|
|`jump`|12|開始、上昇、頂点、下降、着地、二段ジャンプ|
|`light_attacks`|12|立ち・しゃがみ・空中の弱攻撃|
|`heavy_attacks`|12|立ち・しゃがみ・空中の強攻撃|
|`guard`|6|上段、下段、ジャストガード|
|`throw`|10|開始、成功、失敗、投げられ、投げ抜け|
|`special`|9|開始、攻撃、硬直|
|`damage`|16|各被弾、ノックバック、ダウン、起き上がり|
|`result`|6|勝利、敗北|

8人すべてで所定枚数が存在し、正本フレームはGit追跡済みである。`guitar-boy/actions/damage/damage-8.pre-edge-shift.png` と `uncle/actions/heavy_attacks` の補正前ファイル群は名前が似ていても `group-N.png` の厳密形式ではないため、ビルド対象外の中間物である。

### 5.2 固有スキル本体 — Confirmed

各キャラクターに `actions/skill_body/skill_body-1.png` から `skill_body-6.png` があり、合計48枚、全件Git追跡済みである。`src/sprite-manifest.js` の `getSkillAnimationClip` が動的に参照する。最初の追加コミットは `77b4670`。

### 5.3 VFX、ステージ、音声 — Confirmed

- `assets/effects`: 93件。`src/sprite-manifest.js` の `EFFECT_ASSET_MANIFEST` から参照される。
- `assets/stages`: 5件。ゲームデータから参照される。
- `assets/audio`: 2件のBGMがゲームから参照される。

### 5.4 互換・フォールバック素材 — Confirmed（ただし主アニメーションではない）

各キャラクター直下の `combat-1.png` ～ `combat-4.png` と `sheet-transparent.png` は `src/data.js` に残っている。全8IDは展開済みマニフェストを取得できるため、現在の主アニメーションは `actions` 側である。一方、キャラクター選択等のフォールバックやデータ契約としてコード参照が残るため、現段階では移動・削除不可。

`ASSET_PROVENANCE.md` はこれら4ポーズを主なruntime素材と説明しているが、現在の41クリップ実装より古い記述である。将来更新対象だが、Phase 1では変更していない。

## 6. キャラクター別素材状況

|キャラクター|全ファイル / bytes|`actions` ファイル / bytes|tracked / untracked (`actions`)|`result`|`skill_body`|
|---|---:|---:|---:|---:|---:|
|bob-girl|221 / 43,508,953|211 / 41,095,155|112 / 99|14（正本6 + U8）|6 T|
|green-slime|220 / 42,468,780|210 / 40,125,135|112 / 98|11（正本6 + U5）|6 T|
|guitar-boy|221 / 45,503,247|210 / 42,917,725|112 / 98|14（正本6 + U8）|6 T|
|kazushige|188 / 39,686,202|178 / 36,646,910|112 / 66|12（正本6 + U6）|6 T|
|norio|177 / 35,368,962|167 / 32,812,381|112 / 55|11（正本6 + U5）|6 T|
|rusty|189 / 48,903,902|179 / 46,410,620|112 / 67|11（正本6 + U5）|6 T|
|toko|177 / 34,305,934|167 / 31,702,440|112 / 55|11（正本6 + U5）|6 T|
|uncle|213 / 30,931,374|203 / 28,207,084|112 / 91|11（正本6 + U5）|6 T|

`T` はtracked、`U` はuntracked。各キャラクターの112件のアクション配下デプロイ対象は、標準105フレーム、skill body 6フレーム、`character-scale-profile.json` 1件である。

## 7. 実際の参照関係

|参照元|参照方法|対象|判定|
|---|---|---|---|
|`src/sprite-manifest.js`|テンプレート文字列・配列生成|標準action、skill body、effects|Confirmed runtime|
|`src/data.js`|`createExpandedAnimationManifest`、テンプレート文字列|全8人のaction、legacy combat/sheet|Confirmed runtime/compatibility|
|`src/game.js`|マニフェストのフレーム文字列をロード・描画|action/effects|Confirmed runtime|
|`scripts/generate_sprite_metadata.mjs`|マニフェストからJSON生成|`metadata/<id>-animations.json`|Confirmed generated metadata|
|`tests/game.test.js`|JSON読込・フレーム存在確認|metadata、scale report、action frames|Confirmed test support|
|`tests/repairs.test.js`|パス存在確認|skill body、damage、effects|Confirmed test support|
|`scripts/build.mjs`|再帰コピー + action名規則フィルタ|deployable assets|Confirmed build input|
|`pipeline-meta.json`|入力パス記録|主に `raw-sheet*.png`|Confirmed provenance fragment|
|`prompt-used.txt`|参照画像名の記録|combat/sheet/player等|Probable generation provenance|

`special-1.png` と `result-1.png` は文字列を個別に直書きしているだけではなく、`GROUPS` と `numberedFrames()` による動的パス生成で参照される。したがって、個別ファイル名の単純検索だけで未使用判定してはいけない。

`player_*.png`、ルート `tmp_*_raw.png`、`tmp_aligned_*`、アクション内の `raw-sheet*`、`animation.gif` は、`src`、`scripts`、`tests`、HTML、CSS、ビルド処理からruntime入力として参照されていない。ただし `pipeline-meta` とプロンプトに生成時の入力記録があるものは、再生成のための資料として保持価値がある。

CSS `background-image`、HTML `<img>` の固定パス、`fetch`、globによる別系統のスプライト読込は確認されなかった。キャラクター選択画像も `CHARACTERS[id].sprite.frames[0]` を通じた動的参照である。

## 8. ビルド構成と `dist` の関係

`package.json` のproduction buildは `node scripts/build.mjs`。

`scripts/build.mjs` は次を行う。

1. `dist` を再帰削除して再作成する。
2. `index.html`、`style.css`、`src` を `dist/client` にコピーする。
3. `assets` を `deployableAsset` 規則でフィルタしてコピーする。
4. `raw-sheet.png`、`raw-sheet-clean.png`、`animation.gif` を明示的に除外する。
5. `actions` 配下では `actions/character-scale-profile.json` または `actions/<group>/<group>-<数字>.png` のみ許可する。
6. `.openai` と静的server workerを生成する。

比較結果:

- `assets` のデプロイ対象: 1,054件
- `dist/client/assets`: 1,054件
- 欠落: 0件
- 余分・stale: 0件
- SHA-256不一致: 0件
- `assets` 側のビルド除外: 653件（すべて `assets/sprites` 配下）

除外653件の概況は、GIF 99、JSON 98、TXT 45、PNG 411。うち297件は `raw-sheet.png`、`raw-sheet-clean.png`、`animation.gif` の明示除外、残る356件はaction正本の命名規則に一致しないpipeline/QC/プロンプト/派生画像である。

非action素材はビルド規則上コピーされるため、「distにある」だけではruntime消費の証拠にならない。metadata JSON、pipeline metadata、scale reportの一部はテスト・制作支援用であり、runtimeで直接読まれないものもある。

## 9. 生成パイプライン

ローカルスクリプトと `pipeline-meta.json` から確定または推定できる関係は次のとおり。

|段階|代表ファイル|生成・加工手段|根拠|
|---|---|---|---|
|人物参考|ルート `player_*.png`、`combat-*.png`、キャラ直下sheet|画像生成時のidentity/keyframe参照|Probable（prompt記録、直接runtime主経路ではない）|
|生成直後のグリッド|`raw-sheet.png`、`raw-sheet-generated.png`、ルート `tmp_*_raw.png`|外部画像生成工程|Probable。生成器本体はrepo内にない|
|整列・再構成|`raw-sheet-aligned*`、`raw-sheet-profile-input.png`、`tmp_aligned_*`|`align_raw_sprite_grid.py`、`recompose_sprite_grid.py`|Confirmed for tool capability / Probable for個別実行履歴|
|透過・分割・QC|`raw-sheet-clean.png`、`sheet-transparent.png`、`corrected-qc`、`recomposed-qc`、`animation.gif`|generate2dsprite系の加工記録とpipeline metadata|Probable。すべての実行コマンドは保存されていない|
|フレーム補正|個別`group-N.png`、`*.pre-*`、補正用dir|`align_processed_sprite_frames.py`、`shift_sprite_frame.py`、`normalize_action_scales.py`|Confirmed for scripts; per-file lineageは一部Probable|
|runtime正本|`actions/<group>/<group>-N.png`、`skill_body-N.png`|マニフェストが直接参照|Confirmed|
|メタデータ|`metadata/<id>-animations.json`|`generate_sprite_metadata.mjs`|Confirmed|
|検証|正本フレーム|`validate_sprite_bundle.py`、tests|Confirmed|
|配布物|`dist/client/assets/...`|`scripts/build.mjs`|Confirmed、SHA一致|

概念上の家系図:

```text
人物参考・既存4ポーズ
  ↓
raw生成グリッド（raw-sheet / tmp_*_raw）
  ↓
整列・透過・補正・QC（aligned / clean / sheet-transparent / corrected / GIF）
  ↓
分割済み正本（actions/<group>/<group>-N.png）
  ↓
src/sprite-manifest.js の動的マニフェスト
  ↓
scripts/build.mjs
  ↓
dist/client/assets（再生成可能な配布コピー）
```

22件のルート `tmp_{norio,toko}_{action}_raw.png` は、対応する `assets/.../raw-sheet.png` とSHA-256が22/22件で不一致だった。したがって、同じファイルの単純コピーではなく、別生成版または加工前後の可能性がある（**Probable**）。移動先を決める前に各生成セッションとの対応付けが必要。

## 10. Git履歴

|対象|最初の追加・主な変更|現在との関係|
|---|---|---|
|ルート `player_*.png`、初期combat/sheet|`a0e69db` (`Build Chabuto er Fighter 2`)|tracked legacy/reference。以後の変更履歴なし|
|初期actionフレーム|主に `0240823`|その後 `b68becb` 等で拡張・補正|
|expanded manifest|`b68becb`|現在の動的runtime参照の基礎|
|全8人の展開済みanimation|`1a97678`|現在の全キャラクターaction契約|
|ビルド除外規則|`d94604d`|production intermediateをdistから除外|
|skill body 48枚|`77b4670`|現在の固有スキル本体正本|
|`dist`|追跡履歴なし|常に生成物・ignored|
|untracked raw/GIF/pipeline/prompt/tmp|Git履歴なし|生成途中、生成記録または用途不明|

対象範囲ではGit rename履歴、削除・復活履歴は確認されなかった。untrackedファイルにはGit上の追加・変更・rename履歴が存在しない。

## 11. 完全重複と非完全一致

### 完全重複 — Confirmed

- 重複SHA-256グループ: 2,141グループ、該当4,536ファイル
- `assets` ↔ `dist` の同一コピー: 1,054グループ
  - 862グループは2ファイル
  - 192グループはtmp側コピーも含む3ファイル
- action ↔ `tmp/imagegen` のskill body系: 104グループ。各グループは `assets` 正本、`dist` コピー、tmp生成出力の3者
- action中間物どうし: 98グループ（2者30、3者68）

代表例:

- `78efb7...ccd90`: bob-girl `skill_body-1.png` のassets / dist / `tmp/imagegen` が一致
- `3573a2...6ac7`: bob-girl crouchの `raw-sheet-normalized.png` と `raw-sheet.png` が一致
- `5015a0...0325`: bob-girl movementの `raw-sheet-anchor-aligned.png` と `raw-sheet.png` が一致
- `c68c6d...bb2d`: green-slime light attackのcorrected-QC / assets正本 / distが一致
- `03694a...0a64`: green-slime movementのaligned sheetとrecomposed-QC raw sheetが一致

全ハッシュとグループIDはCSV付録に記録した。重複していても、`dist` は配布コピー、tmpは生成証跡、assetsは正本という役割差があるため、「同一内容」だけを根拠に削除してはいけない。

### 内容が似ている可能性はあるが完全一致ではない — Probable

- `tmp_{norio,toko}_*_raw.png` と対応するaction `raw-sheet.png`: 22組すべてSHA不一致
- `raw-sheet.png`、`raw-sheet-generated.png`、`raw-sheet-normalized.png`、`raw-sheet-aligned.png`、`raw-sheet-v*-failed.png`: 同一生成セッションの版違いを示す命名・metadataがあるが、多くはSHA不一致
- `sheet-transparent.png` と分割済みactionフレーム: シートとセルの関係が推定できても、ファイル単位のSHA比較では一致しない
- `combat-*.png` と一部action keyframe: 意味上のキーフレーム関係はmetadataに記録されるが、ファイル同一性は別問題

Phase 1では画像の見た目だけによる同一・旧版判定を行っていない。

## 12. 分類一覧

|分類|対象|判定|根拠|
|---|---|---|---|
|現在の正本|`assets/sprites/*/actions/<group>/<group>-N.png`、`skill_body-N.png`|Confirmed|runtime manifest + build + tests|
|runtime補助|effects、stages、audio|Confirmed|明示マニフェスト・ゲーム参照|
|互換・reference兼用|各キャラ直下combat/sheet|Confirmed keep|コード参照が残る|
|ビルド生成物|`dist/**`|Confirmed|buildが全削除・再作成、全SHA一致、Git ignored|
|再生成可能な中間|aligned/recomposed/normalized/corrected/QC/GIF|Probable|加工スクリプト・metadata。ただし全コマンド未保存|
|生成元素材|raw-sheet、root tmp raw、player、combat keyframes|Probable|prompt・pipeline metadata・metadata sourceKeyframes|
|参考画像|ルート `player_*.png`|Probable|tracked初期素材、直接runtime参照なし|
|旧版候補|`*-failed.*`、`*.pre-*`、複数raw版、古いtmp deploy tar|Probable|命名・現行参照なし。削除は未承認|
|用途不明|provenanceがない一部raw/QC派生、対応が一意でないtmp|Unknown|生成コマンド・manifest不足|
|削除候補|現時点では確定なし|Unknown|削除は別フェーズ、明示承認が必要|
|移動候補|中間物をsource/archiveへ、root tmpを隔離|Probable|runtime参照なし。ただしPhase 2で参照更新・履歴保存が必要|

## 13. 参照切れリスク

1. **高**: action正本をゼロ埋めへ即改名すると、`numberedFrames()`、metadata JSON、tests、build規則が同時に不一致になる。
2. **高**: `combat-*` / top-level `sheet-transparent.png` は主アニメーションではなくてもコード参照が残るため、旧版に見えても移動・削除できない。
3. **中**: `pipeline-meta.json` に絶対パスや現在位置が記録されている。移動するとprovenanceが壊れるため、manifestへの移記が必要。
4. **中**: untracked中間物はGit履歴がなく、移動後に由来を追いにくい。先にmanifestと対応表が必要。
5. **中**: `dist` の直接編集は次回buildで消える。正本変更は必ず`assets`側で行う。
6. **中**: Windowsで動作しても、GitHub/Linux配信では大文字小文字の差が404になり得る。Phase 3でcase-sensitive検査が必要。
7. **低**: `ASSET_PROVENANCE.md` が現行runtime構造を反映しておらず、将来の作業者がlegacy素材を正本と誤認する可能性がある。

## 14. Phase 2の推奨構成

全面的な一括移動より、現行runtimeパスを維持しながらsource/archiveを追加する案が最も安全である。

```text
assets/
└─ sprites/
   └─ <character>/
      ├─ actions/                 # 当面のruntime正本。既存パス維持
      │  ├─ idle/idle-1.png
      │  └─ ...
      ├─ source/
      │  ├─ sheets/               # raw/clean/transparent/aligned sheets
      │  ├─ generated/            # 生成直後・補正途中・QC
      │  └─ references/           # player、combat keyframe等の参照資料
      ├─ archive/                 # failed/pre-change/旧生成セッション
      ├─ metadata/                # 既存metadataを当面維持
      └─ manifest.json            # provenanceとruntime正本を明記
```

理由:

- `actions` を直ちに `runtime/actions` へ移すと、動的パス、metadata、tests、build規則の広範囲変更が必要になる。
- 最初の整理ではruntimeパスを維持し、中間物だけを `source` / `archive` へ `git mv` または安全な移動で段階的に集約する方が参照切れリスクが低い。
- `runtime/` への完全移行は、manifest駆動ローダーに切り替えた後の別フェーズが適切。

推奨 `manifest.json` 候補:

```json
{
  "character": "toko",
  "status": "active",
  "canvasSize": [256, 256],
  "anchor": [128, 233],
  "actions": {
    "special": {
      "runtimeFrames": ["actions/special/special-1.png"],
      "sourceSheet": "source/sheets/special/raw-sheet.png",
      "generatedFrom": ["source/references/player_08_toko.png"],
      "frameOrder": [1],
      "frameDuration": 4,
      "loop": false,
      "hitbox": null,
      "notes": ""
    }
  },
  "createdAt": null,
  "updatedAt": null
}
```

日時や生成元が確定できない箇所は推測値を入れず `null` または `Unknown` とする。

## 15. 推奨リネームとパス対応表案

ゼロ埋めは望ましいが、現在コードは非ゼロ埋めを生成しているため、別フェーズに分ける。

|現在|将来案|実施条件|
|---|---|---|
|`actions/idle/idle-1.png`|`runtime/actions/idle/idle-01.png`|manifest、loader、metadata、tests、buildを同時更新|
|`actions/special/special-1.png`|`runtime/actions/special/special-01.png`|同上|
|`actions/result/result-1.png`|`runtime/actions/result/result-01.png`|同上|
|`actions/<group>/raw-sheet*.png`|`source/sheets/<group>/raw-*.png`|pipeline-meta参照をmanifestへ移記後|
|`actions/<group>/sheet-transparent.png`|`source/sheets/<group>/transparent.png`|生成関係確定後|
|`actions/<group>/animation.gif`|`source/generated/<group>/preview.gif`|生成関係確定後|
|`actions/<group>/*failed*`|`archive/<generation-id>/<group>/...`|generation-id採番・provenance記録後|
|ルート `player_08_toko.png`|`assets/sprites/toko/source/references/player-08-toko.png`|コード非参照再確認・manifest追加後|
|ルート `tmp_toko_special_raw.png`|`assets/sprites/toko/source/generated/special/raw-<generation-id>.png`|対応セッション確定後|
|`tmp_aligned_toko_special/`|同generation-idの`source/generated/special/aligned/`|個別フレーム対応確認後|
|`dist/client/assets/...`|変更しない|buildで再生成するのみ|

## 16. Phase 2での安全な実施順案

1. 既存dirty worktreeを保全し、今回の監査成果物だけを分離して確認する。
2. 各キャラクターの `manifest.json` を、確定情報だけで先に追加する。
3. runtime正本の現行パスを固定し、生成スクリプトの出力先だけを `source/generated` に統一する。
4. 1キャラクター・1アクション単位で中間物を移し、`pipeline-meta` とmanifestを同時更新する。
5. 各小単位で参照切れ検査、metadata整合、production buildを実施する。
6. root `tmp*` は由来が確定したものだけarchiveへ移す。cache/deploy archiveは別ポリシーで扱う。
7. ゼロ埋め・`runtime/` 移行は最後の独立フェーズにする。
8. 削除候補一覧を作り、明示承認後にのみ削除する。

## 17. Phase 1で作成したファイル

- `docs/asset-organization-audit.md`
- `docs/asset-organization-inventory.csv`

作成していないもの:

- `docs/asset-deletion-candidates.md`（Phase 4用。今回は削除判定を行わないため未作成）
- キャラクター別 `manifest.json`（Phase 2）

## 18. 実行した調査

- `git branch --show-current`
- `git status --short --branch` / `git status --porcelain=v1 --untracked-files=all`
- `git ls-files` / `git ls-files -o --exclude-standard` / `git ls-files -o -i --exclude-standard`
- `git check-ignore -v`
- `Get-ChildItem` による指定領域の再帰一覧
- `rg` による `assets/sprites`、action名、player、tmp、raw sheet、GIF、fetch/import/CSS/HTML/JSON参照の検索
- `package.json`、`scripts/build.mjs`、画像加工・metadata生成・検証スクリプトの読取
- `git log --all --follow`、追加・変更・rename・delete履歴の確認
- Node.js `fs` / `crypto` とPNGヘッダ解析による5,500件のサイズ、mtime、SHA-256、PNG属性、完全重複グループ抽出
- build規則を読み取りで再現した `assets` ↔ 既存 `dist/client/assets` のパス・SHA比較
- `npm.cmd run syntax`: 成功
- `npm.cmd test`: 84/84件成功
- `.uv-venv/Scripts/python.exe scripts/validate_sprite_bundle.py <id>`: 全8人成功（各105 RGBAフレーム）
- runtimeマニフェスト存在検査: 標準840パス、固有スキル198パス、effect 76フレーム + 17 metadataで欠落0件

## 19. Phase 1で未実施の項目

- production build: 未実施。`build.mjs` は `dist` を削除・再作成するため、読み取り専用Phase 1の範囲外。
- 専用の型チェック・lintコマンド: `package.json` に定義がないため未実施。代替としてsyntax checkと84件の自動テストは成功。
- ブラウザ操作確認: 未実施。Phase 1ではruntimeファイルを変更していない。
- 404確認、全アクション描画確認: 未実施。Phase 3で実施。
- 素材の移動、改名、削除、`git mv`: 未実施。
- `dist` 再生成・直接修正: 未実施。
- commit、push、デプロイ: 未実施。

## 20. 次に判断が必要な事項

1. Phase 2では「`actions` の現行runtimeパスを維持する安全案」を採用するか。
2. root `player_*.png` を正式なreferenceとして各キャラクター配下へ移すか。
3. untrackedのraw/QC/failed版を、生成セッション単位でarchiveするためのID規則をどうするか。
4. `tmp` 内の仮想環境・uv cache・deploy tarを、素材整理とは別のcleanup対象にするか。
5. ゼロ埋め命名と `runtime/actions` への移行を、互換レイヤー付きの別フェーズにするか。
6. Phase 4で削除候補一覧を作成する際、再生成可能でもprovenance未確定のファイルを原則keep/archiveのどちらにするか。

明示承認があるまで、削除は行わない。
