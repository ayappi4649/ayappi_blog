# Ayappi Studio（ブログ管理ダッシュボード）

Ayappi Blog の記事を「執筆 → AI校正 → HTMLプレビュー → GitHub に公開」まで行う管理画面です。
サーバーは不要で、GitHub Pages 上の `admin/` をブラウザで開くだけで使えます。

- URL: `https://ayappi4649.github.io/ayappi_blog/admin/`
- 下書き・設定・API キーは **そのブラウザの中だけ** に保存されます（リポジトリには入りません）。

## はじめに（設定）

左メニューの「設定」で次を入力して保存します。

| 項目 | 内容 |
| --- | --- |
| GitHub トークン | Fine-grained personal access token。対象リポジトリを `ayappi4649/ayappi_blog` だけにし、権限は **Contents: Read and write** のみ |
| Claude API キー | console.anthropic.com で発行（使う場合のみ） |
| OpenAI API キー | platform.openai.com で発行（使う場合のみ）。モデル名は自由に書き換え可 |

「GitHub 接続を確認」で「書き込み可」と出れば準備完了です。

## 公開時に行うこと

「公開する」を押すと、次の変更を **1 つのコミット** にまとめて `main` に push します。

1. `posts/<ファイル名>.html` に記事本文を書き込み（既存記事と同じ、本文だけの HTML）
2. 本文で使っている新しい画像を `posts/images/` に追加（同名があれば `-2` などを付けて回避）
3. `articles.js` の末尾に次の形式で 1 件追加（既存記事の編集時は該当 id の項目だけ書き換え）

```js
{
  id: 17,
  year: 2026,
  title: "記事タイトル",
  date: "2026/10/12",
  contentFile: "./posts/記事タイトル.html"
},
```

- `id` は既存の最大値 + 1、`year` は公開日の年、`date` は `YYYY/M/D` 形式です。
- 既存の項目の書式や改行コード（CRLF）はそのまま残します。
- 公開前に「HTMLプレビュー」の `articles.js` タブで変更後の内容を確認できます。

## 機能

- **執筆**：見出し・太字・下線・文字色・リンク・画像＋キャプション。大きな写真は幅 1600px の JPEG に自動縮小。
- **AI 校正**：Claude / GPT を切り替え。提案ごとに「採用 / 本文で見る / 却下」。プロンプトは「校正プロンプト」で編集可。
- **HTMLプレビュー**：実際の `article.html` のスタイルで PC / スマホ表示を確認。HTML を直接直すこともできます。
- **公開済み**：`articles.js` の一覧から記事を開いて編集・更新、または削除（記事ファイルと一覧の項目を削除するコミットを作成）。

## ファイル

- `index.html` — 画面
- `app.js` — 画面の動作（GitHub API・AI API の呼び出し）
- `lib.js` — `articles.js` の読み書きなど DOM に依存しない処理
