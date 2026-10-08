/* Ayappi Studio — DOM に依存しない処理（articles.js の書き換え・ファイル名など）。
   ブラウザでは window.StudioLib、Node では module.exports として使えます。 */
(function (root) {
  "use strict";

  /* articles.js を評価して記事一覧を取り出す（自分のリポジトリのファイルだけを対象にする） */
  function parseArticles(src) {
    var win = {};
    new Function("window", src)(win);
    return Array.isArray(win.ARTICLES) ? win.ARTICLES : [];
  }

  /* "2026-10-12" → "2026/10/12"（最近の記事と同じ書き方） */
  function formatDate(iso) {
    var p = String(iso).split("-").map(Number);
    if (p.length !== 3 || p.some(isNaN)) return String(iso);
    return p[0] + "/" + p[1] + "/" + p[2];
  }

  /* articles.js の date（"2026/9/7", "2024-06-29", "2026-2-22" など）→ "YYYY-MM-DD" */
  function toIsoDate(s) {
    var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(String(s || "").trim());
    if (!m) return "";
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }

  function nextId(list) {
    return list.reduce(function (mx, a) { return Math.max(mx, Number(a.id) || 0); }, 0) + 1;
  }

  /* タイトル → posts/ に置くファイル名（拡張子なし） */
  function fileBase(title) {
    var s = String(title || "")
      .replace(/[\\\/:*?"<>|#%&{}^~\[\]`'$+=;@]/g, "")
      .replace(/\s+/g, "")
      .replace(/^\.+/, "");
    return (s || "untitled").slice(0, 80);
  }

  /* 画像ファイル名（URL で問題になりにくい形に） */
  function imageName(name) {
    var m = /^(.*?)(\.[A-Za-z0-9]+)?$/.exec(String(name || "image"));
    var base = m[1].replace(/[\\\/:*?"<>|#%&{}^~\[\]`'$+=;@\s]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "image";
    return base.slice(0, 60) + (m[2] || ".png").toLowerCase();
  }

  /* 既存の名前と重ならないように -2, -3 … を付ける */
  function uniqueName(name, taken) {
    if (!taken.has(name)) return name;
    var dot = name.lastIndexOf(".");
    var b = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (var i = 2; ; i++) { var n = b + "-" + i + ext; if (!taken.has(n)) return n; }
  }

  /* 元ファイルの改行コード（CRLF / LF）に合わせる */
  function eolOf(src) { return /\r\n/.test(src) ? "\r\n" : "\n"; }

  function entryText(a, eol) {
    eol = eol || "\n";
    return "{" + eol +
      "  id: " + a.id + "," + eol +
      "  year: " + a.year + "," + eol +
      "  title: " + JSON.stringify(a.title) + "," + eol +
      "  date: " + JSON.stringify(a.date) + "," + eol +
      "  contentFile: " + JSON.stringify(a.contentFile) + eol +
      "}";
  }

  /* 配列の最後（"];" の直前）に記事を 1 件追加。既存部分の書式には触らない */
  function addEntry(src, a) {
    var m = /\]\s*;?\s*$/.exec(src);
    if (!m) throw new Error("articles.js の末尾 \"];\" が見つかりません");
    var head = src.slice(0, m.index).replace(/\s*$/, "");
    if (!/[,\[]$/.test(head)) head += ",";
    var eol = eolOf(src);
    return head + eol + entryText(a, eol) + "," + eol + src.slice(m.index);
  }

  /* id: N を含む { … } の範囲を返す（文字列中の括弧は無視） */
  function findBlock(src, id) {
    var re = new RegExp("\\bid\\s*:\\s*" + Number(id) + "\\s*,", "g"), m = re.exec(src);
    if (!m) return null;
    var start = src.lastIndexOf("{", m.index);
    if (start < 0) return null;
    var depth = 0, q = null;
    for (var i = start; i < src.length; i++) {
      var c = src[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return { start: start, end: i + 1 }; }
    }
    return null;
  }

  var STR = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')";
  function setField(block, key, valueText, isNumber) {
    var re = new RegExp("(\\b" + key + "\\s*:\\s*)" + (isNumber ? "\\d+" : STR));
    if (re.test(block)) return block.replace(re, function (_, k) { return k + valueText; });
    /* フィールドが無ければ最後に足す */
    return block.replace(/\s*\}$/, function (tail) {
      return "," + eolOf(block) + "  " + key + ": " + valueText + tail;
    }).replace(/,\s*,/, ",");
  }

  /* 既存記事のタイトル・日付などを書き換える（他のフィールドや書式は残す） */
  function updateEntry(src, id, a) {
    var b = findBlock(src, id);
    if (!b) throw new Error("articles.js に id: " + id + " が見つかりません");
    var block = src.slice(b.start, b.end);
    block = setField(block, "year", String(a.year), true);
    block = setField(block, "title", JSON.stringify(a.title));
    block = setField(block, "date", JSON.stringify(a.date));
    block = setField(block, "contentFile", JSON.stringify(a.contentFile));
    return src.slice(0, b.start) + block + src.slice(b.end);
  }

  function removeEntry(src, id) {
    var b = findBlock(src, id);
    if (!b) throw new Error("articles.js に id: " + id + " が見つかりません");
    var after = src.slice(b.end).replace(/^\s*,/, "");
    var before = src.slice(0, b.start).replace(/[ \t]*$/, "");
    return before + after.replace(/^[ \t]*\r?\n/, "");
  }

  var api = {
    parseArticles: parseArticles, formatDate: formatDate, toIsoDate: toIsoDate, nextId: nextId,
    fileBase: fileBase, eolOf: eolOf, imageName: imageName, uniqueName: uniqueName,
    entryText: entryText, addEntry: addEntry, updateEntry: updateEntry, removeEntry: removeEntry, findBlock: findBlock
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StudioLib = api;
})(this);
