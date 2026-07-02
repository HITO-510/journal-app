# HITO Journal

日記PWA。iPhone/PCのブラウザから GitHub Private リポ（`HITO-510/journal`）の Markdown 日記を読み書きする。

- **公開URL**: https://hito-510.github.io/journal-app/（GitHub Pages）
- **このリポは Public** — 秘密情報（APIキー・実名辞書）は絶対にコードへ書かない（下記セキュリティ設計）

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 全画面（セットアップ/ダッシュボード/カレンダー/一覧/タグ/検索/エディタ/設定） |
| `js/app.js` | アプリ本体。状態管理・描画・音声入力UX（下書き/原文保護/辞書追加） |
| `js/github.js` | GitHub Contents API クライアント（読み書き・sha管理） |
| `js/anthropic.js` | Claude API クライアント。AI整形（ツール呼び出し強制の構造化出力） |
| `js/markdown.js` | frontmatterパース/シリアライズ・簡易MD→HTML・空テンプレ見出し除去 |
| `sw.js` | Service Worker。**フロント改修のたびに `CACHE_NAME` をバンプ必須**（さもないとiOSに反映されない） |

## AI整形（音声入力 → 日記）

iPhoneはOS純正音声入力で口述 → エディタ「✨AIで整形」→ Claude API → `{title, title_alts, tags, mood, body}` を構造化出力で受信。

- 整形ルール・誤変換辞書は **Private リポの `RULES.md` を実行時に動的取得**してシステムプロンプトへ注入（Publicコードに実名を載せないため）
- モデルは⚙設定で選択（Sonnet標準/Opus/Haiku）。APIキーは localStorage のみ
- 失敗時は textarea を触らない＝口述原文は消えない

## 音声入力UX（v2.9・2026-07-02）

- **原文保護**: 整形後も「原文を表示⇔整形結果に戻す」で相互切替（双方の編集を保持）
- **下書き自動保存**: 1.5秒デバウンスで localStorage へ。次回オープン時に復元/破棄バナー
- **タイトル候補チップ**: AIの複数案をタップで選択
- **↻再整形**: 任意の追加指示（例:もっと短く）つきで原文から整形し直し
- **＋辞書**: 誤→正ペアを `RULES.md` 末尾「## アプリからの辞書追加分」へ直接コミット（末尾追記方式。セクションは必ずファイル末尾に維持すること）

## 運用メモ

- 日記データの正本は `HITO-510/journal`（Private）。PCでは Claude Code が commit → HITOが手元で `git push`
- このアプリのデプロイも push（GitHub Pages が自動反映）→ iPhoneでアプリを完全終了→再起動で新版になる
- PAT は journal / journal-app 両対応の Fine-grained 1本に統一（Contents: Read and write）
