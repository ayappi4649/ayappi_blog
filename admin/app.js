/* Ayappi Studio — 執筆 → AI校正 → HTMLプレビュー → GitHub 公開 */
(function () {
  "use strict";
  var L = window.StudioLib;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function hhmm() { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }

  /* ── 設定 ─────────────────────────────── */
  var DEFAULTS = {
    owner: "ayappi4649", repo: "ayappi_blog", branch: "main", ghToken: "",
    siteUrl: "https://ayappi4649.github.io/ayappi_blog/"
  };
  var PROMPT_DEFAULTS = {
    base: "あなたはブログ「Ayappi Blog」の編集者です。筆者「あやっぴ」の文章を校正してください。\n内容や主張は変えず、修正箇所ごとに理由を一言添えてください。",
    presets: [
      { key: "typo", label: "誤字脱字", text: "誤字脱字・変換ミス・ら抜き言葉を直してください。", on: true },
      { key: "voice", label: "あやっぴの口調を保つ", text: "「こんにちは、あやっぴです。」で始まる、くだけすぎない丁寧語の口調はそのまま残してください。", on: true },
      { key: "read", label: "読みやすく", text: "一文が長いところは読みやすく区切ってください。", on: false },
      { key: "short", label: "短く", text: "冗長な言い回しを削って、全体を1割ほど短くしてください。", on: false }
    ]
  };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動作は続ける */ } }
  var S = Object.assign({}, DEFAULTS, lsGet("studio.settings", {}));
  if (S.claudeKey || S.openaiKey) { ["provider", "claudeKey", "claudeModel", "openaiKey", "openaiModel"].forEach(function (k) { delete S[k]; }); lsSet("studio.settings", S); } /* 以前の版で保存した API キーは消す */
  var P = lsGet("studio.prompts", null) || JSON.parse(JSON.stringify(PROMPT_DEFAULTS));
  function siteBase() { var u = (S.siteUrl || "").trim(); if (!u) return new URL("../", location.href).href; return /\/$/.test(u) ? u : u + "/"; }

  /* ── 下書きの保存（IndexedDB。画像も含めて保存できる） ── */
  var store = (function () {
    var mem = {}, dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        try {
          var r = indexedDB.open("ayappi-studio", 1);
          r.onupgradeneeded = function () { r.result.createObjectStore("drafts", { keyPath: "id" }); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        if (!db) return fn(null);
        return new Promise(function (res, rej) {
          var t = db.transaction("drafts", mode), os = t.objectStore("drafts"), out = fn(os);
          t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      all: function () { return tx("readonly", function (os) { return os ? os.getAll() : { result: Object.values(mem) }; }); },
      put: function (d) { return tx("readwrite", function (os) { if (os) os.put(d); else mem[d.id] = d; }); },
      del: function (id) { return tx("readwrite", function (os) { if (os) os.delete(id); else delete mem[id]; }); }
    };
  })();

  /* ── GitHub API ─────────────────────────── */
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
  function gh(path, opts) {
    opts = opts || {};
    if (!S.ghToken) return Promise.reject(new Error("設定で GitHub のトークンを入れてください"));
    var headers = { Authorization: "Bearer " + S.ghToken, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com/repos/" + S.owner + "/" + S.repo + path, {
      method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store"
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error("GitHub " + r.status + ": " + (j.message || r.statusText)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function b64ToText(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function getText(path, ref) {
    return gh("/contents/" + encPath(path) + "?ref=" + encodeURIComponent(ref || S.branch)).then(function (j) {
      if (j.content) return b64ToText(j.content);
      return gh("/git/blobs/" + j.sha).then(function (b) { return b64ToText(b.content); });
    });
  }
  function listDir(path, ref) {
    return gh("/contents/" + encPath(path) + "?ref=" + encodeURIComponent(ref || S.branch))
      .then(function (j) { return Array.isArray(j) ? j.map(function (x) { return x.name; }) : []; })
      .catch(function (e) { if (e.status === 404) return []; throw e; });
  }
  function headSha() { return gh("/git/ref/heads/" + encodeURIComponent(S.branch)).then(function (r) { return r.object.sha; }); }
  /* changes: [{path, text}] / [{path, base64}] / [{path, remove:true}] → 1 コミットでまとめて push */
  function commit(baseSha, message, changes, onStep) {
    var tree = [];
    return gh("/git/commits/" + baseSha).then(function (c) {
      var seq = Promise.resolve();
      changes.forEach(function (ch) {
        seq = seq.then(function () {
          if (ch.remove) { tree.push({ path: ch.path, mode: "100644", type: "blob", sha: null }); return; }
          if (ch.text != null) { tree.push({ path: ch.path, mode: "100644", type: "blob", content: ch.text }); return; }
          onStep && onStep("blob", ch.path);
          return gh("/git/blobs", { method: "POST", body: { content: ch.base64, encoding: "base64" } })
            .then(function (b) { tree.push({ path: ch.path, mode: "100644", type: "blob", sha: b.sha }); });
        });
      });
      return seq.then(function () {
        onStep && onStep("tree");
        return gh("/git/trees", { method: "POST", body: { base_tree: c.tree.sha, tree: tree } });
      });
    }).then(function (t) {
      onStep && onStep("commit");
      return gh("/git/commits", { method: "POST", body: { message: message, tree: t.sha, parents: [baseSha] } });
    }).then(function (nc) {
      onStep && onStep("push");
      return gh("/git/refs/heads/" + encodeURIComponent(S.branch), { method: "PATCH", body: { sha: nc.sha } }).then(function () { return nc; });
    });
  }

  /* 公開済み記事一覧（articles.js） */
  var pub = { list: null, src: "", error: "" };
  function loadPublished() {
    if (!S.ghToken) { pub.list = null; pub.error = "設定で GitHub のトークンを入れると、ここに一覧が出ます。"; renderPublished(); return Promise.resolve(); }
    $("#pubSrc").textContent = "読み込み中…";
    return getText("articles.js").then(function (src) {
      pub.src = src; pub.list = L.parseArticles(src); pub.error = "";
      $("#liveCount").textContent = pub.list.length;
      renderPublished();
      return headSha().then(function (sha) { setGh(true, sha); });
    }).catch(function (e) { pub.error = e.message; setGh(false); renderPublished(); });
  }
  function setGh(ok, sha) {
    var b = $("#ghBadge");
    b.className = "badge " + (ok ? "badge--live" : "badge--off"); b.textContent = ok ? "接続済み" : "未接続";
    $("#ghRepo").textContent = S.owner + "/" + S.repo;
    $("#ghMeta").innerHTML = ok
      ? "ブランチ <code>" + esc(S.branch) + "</code><br>最新コミット <code>" + esc((sha || "").slice(0, 7)) + "</code><br><a href=\"" + esc(siteBase()) + "\" target=\"_blank\" rel=\"noopener\">サイトを開く</a>"
      : (S.ghToken ? "接続できませんでした。設定を確認してください" : "設定で GitHub のトークンを入れてください");
  }

  /* ── 状態 ─────────────────────────────── */
  var drafts = [], cur = null, confirmId = null, step = 1, view = "write";
  var body = $("#body"), title = $("#title"), date = $("#date"), fname = $("#fname");
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* 古いブラウザ */ }

  function blankDraft() {
    return { id: "d" + Date.now() + Math.random().toString(36).slice(2, 6), title: "", date: today(), fname: "", fnameTouched: false,
      html: "<p><br></p>", images: {}, status: "draft", updated: Date.now(), articleId: null, contentFile: null };
  }
  function chars(html) { var d = document.createElement("div"); d.innerHTML = html; return (d.textContent || "").replace(/\s/g, "").length; }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 10) return "たった今"; if (s < 60) return s + "秒前"; if (s < 3600) return Math.floor(s / 60) + "分前";
    if (s < 86400) return Math.floor(s / 3600) + "時間前"; return Math.floor(s / 86400) + "日前";
  }
  function postPath(d) { return d.contentFile ? d.contentFile.replace(/^\.\//, "") : "posts/" + (d.fname || L.fileBase(d.title)) + ".html"; }

  function renderList() {
    var q = $("#dSearch").value.trim();
    var shown = drafts.slice().sort(function (a, b) { return b.updated - a.updated; })
      .filter(function (d) { return !q || (d.title || "").indexOf(q) >= 0; });
    $("#dList").innerHTML = shown.map(function (d) {
      var t = esc(d.title || "（無題）");
      if (d.id === confirmId) {
        return '<div class="ditem"><div class="dconfirm" role="alertdialog" aria-label="下書きの削除"><p>「' + t + '」を削除しますか？</p><small>' + chars(d.html).toLocaleString() + "字の本文" + (Object.keys(d.images || {}).length ? "と添付画像" : "") + "が消えます。" + (d.articleId ? "公開済みの記事はそのまま残ります。" : "") + '</small><div><button class="btn btn--sm btn--danger" data-del="' + d.id + '">削除する</button><button class="btn btn--sm" data-cancel="1">キャンセル</button></div></div></div>';
      }
      var badge = d.articleId ? '<span class="badge badge--live">公開済みを編集</span>' : d.status === "proof" ? '<span class="badge badge--proof">校正済み</span>' : '<span class="badge badge--draft">下書き</span>';
      return '<div class="ditem"><button class="drow" data-id="' + d.id + '" aria-current="' + (d === cur) + '"><div class="drow__t">' + t + '</div><div class="drow__m">' + badge + "<span>" + ago(d.updated) + '</span><span class="sp">' + chars(d.html).toLocaleString() + "字</span></div></button>" +
        '<button class="ddel" data-ask="' + d.id + '" title="この下書きを削除" aria-label="「' + t + '」を削除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div>';
    }).join("") || '<div class="dempty">下書きはありません。<br>「新規」から書き始めましょう。</div>';
    $("#draftCount").textContent = drafts.length;
  }

  function load(d) {
    cur = d;
    title.value = d.title; date.value = d.date;
    fname.value = d.contentFile ? postPath(d).replace(/^posts\//, "").replace(/\.html$/, "") : (d.fname || (d.title ? L.fileBase(d.title) : ""));
    fname.readOnly = !!d.contentFile;
    fname.title = d.contentFile ? "公開済みの記事はファイル名を変えられません" : "";
    body.innerHTML = d.html;
    $("#editingNote").classList.toggle("hidden", !d.articleId);
    $("#editingId").textContent = d.articleId ? "id: " + d.articleId + " · " + postPath(d) : "";
    $("#results").innerHTML = "";
    meta(); renderList();
  }
  function meta() { $("#wc").textContent = chars(body.innerHTML).toLocaleString() + " 字"; }

  var saveT;
  function snapshot() {
    if (!cur) return;
    cur.title = title.value.trim(); cur.date = date.value || today();
    if (!cur.contentFile) { cur.fname = fname.value.trim(); }
    unmarkAll(); cur.html = body.innerHTML; cur.updated = Date.now();
    var used = {};
    $$("#body img[data-file]").forEach(function (i) { used[i.dataset.file] = 1; });
    Object.keys(cur.images || {}).forEach(function (k) { if (!used[k]) delete cur.images[k]; });
  }
  function dirty() {
    var s = $("#save"); s.classList.add("is-saving"); s.textContent = "保存中…";
    if (cur) cur.htmlOverride = null;
    clearTimeout(saveT);
    saveT = setTimeout(flush, 700);
    meta();
  }
  function flush() {
    clearTimeout(saveT);
    if (!cur) return Promise.resolve();
    snapshot();
    var s = $("#save");
    return store.put(cur).then(function () {
      s.classList.remove("is-saving"); s.textContent = "自動保存済み · " + hhmm(); renderList();
    }).catch(function (e) { s.textContent = "保存に失敗: " + e.message; });
  }
  body.addEventListener("input", dirty);
  date.addEventListener("input", dirty);
  title.addEventListener("input", function () {
    if (cur && !cur.contentFile && !cur.fnameTouched) fname.value = title.value.trim() ? L.fileBase(title.value) : "";
    dirty();
  });
  fname.addEventListener("input", function () { if (cur) cur.fnameTouched = true; dirty(); });

  $("#dList").addEventListener("click", function (e) {
    var ask = e.target.closest("[data-ask]");
    if (ask) { confirmId = ask.dataset.ask; renderList(); var c = $("[data-cancel]"); if (c) c.focus(); return; }
    if (e.target.closest("[data-cancel]")) { confirmId = null; renderList(); return; }
    var del = e.target.closest("[data-del]");
    if (del) { removeDraft(del.dataset.del); return; }
    var b = e.target.closest(".drow"); if (!b) return;
    confirmId = null;
    flush().then(function () { load(drafts.filter(function (d) { return d.id === b.dataset.id; })[0]); });
  });
  $("#dList").addEventListener("keydown", function (e) { if (e.key === "Escape" && confirmId) { confirmId = null; renderList(); } });
  function removeDraft(id, silent) {
    var gone = drafts.filter(function (d) { return d.id === id; })[0];
    if (!gone) return;
    clearTimeout(saveT);
    drafts = drafts.filter(function (d) { return d !== gone; });
    confirmId = null;
    store.del(id);
    if (gone === cur) { if (!drafts.length) drafts.push(blankDraft()); load(drafts.slice().sort(function (a, b) { return b.updated - a.updated; })[0]); }
    else renderList();
    if (!silent) toast({ error: true, title: "下書きを削除しました", msg: "「" + (gone.title || "（無題）") + "」", action: "元に戻す", onAction: function () { drafts.push(gone); store.put(gone); load(gone); }, ttl: 10000 });
  }
  $("#dSearch").addEventListener("input", renderList);
  $("#newDraft").addEventListener("click", function () {
    flush().then(function () { var d = blankDraft(); drafts.push(d); store.put(d); load(d); title.focus(); });
  });

  /* ── 書式 ─────────────────────────────── */
  $$("[data-block]").forEach(function (b) {
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function () { document.execCommand("formatBlock", false, b.dataset.block); dirty(); });
  });
  $$("[data-cmd]").forEach(function (b) {
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function () { document.execCommand(b.dataset.cmd); dirty(); syncTools(); });
  });
  function syncTools() { $$("[data-cmd=bold],[data-cmd=underline]").forEach(function (b) { try { b.setAttribute("aria-pressed", document.queryCommandState(b.dataset.cmd)); } catch (e) { /* noop */ } }); }
  document.addEventListener("selectionchange", syncTools);

  var pop = $("#pop");
  $("#colorBtn").addEventListener("mousedown", function (e) { e.preventDefault(); });
  $("#colorBtn").addEventListener("click", function () { pop.classList.toggle("open"); });
  $$("#pop button").forEach(function (b) {
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function () {
      var sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed && body.contains(sel.anchorNode)) {
        var r = sel.getRangeAt(0), span = document.createElement("span");
        if (b.dataset.color !== undefined) { if (b.dataset.color) span.style.color = b.dataset.color; $("#curSw").style.background = b.dataset.color || "#111"; }
        if (b.dataset.bg) span.style.backgroundColor = b.dataset.bg;
        span.appendChild(r.extractContents()); r.insertNode(span); dirty();
      }
      pop.classList.remove("open");
    });
  });
  $("#linkBtn").addEventListener("mousedown", function (e) { e.preventDefault(); });
  $("#linkBtn").addEventListener("click", function () {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !body.contains(sel.anchorNode)) { toast({ error: true, title: "リンクにしたい文字を選択してください" }); return; }
    var range = sel.getRangeAt(0).cloneRange();
    var url = prompt("リンク先の URL", "https://");
    if (!url || url === "https://") return;
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand("createLink", false, url); dirty();
  });

  /* 画像：大きすぎる写真は幅 1600px の JPEG に縮小してから入れる */
  $("#imgBtn").addEventListener("click", function () { $("#file").click(); });
  $("#file").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files); this.value = "";
    var anchor = currentBlock();
    files.reduce(function (p, f) {
      return p.then(function () { return prepareImage(f); }).then(function (r) { anchor = insertFigure(r.src, r.name, anchor); });
    }, Promise.resolve()).catch(function (e) { toast({ error: true, title: "画像を読み込めませんでした", msg: e.message }); });
  });
  function prepareImage(f) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onerror = function () { rej(rd.error); };
      rd.onload = function () {
        var src = rd.result, name = L.imageName(f.name);
        if (/svg|gif/.test(f.type)) return res({ src: src, name: name });
        var im = new Image();
        im.onerror = function () { res({ src: src, name: name }); };
        im.onload = function () {
          var max = 1600;
          if (im.naturalWidth <= max && f.size < 1.2e6) return res({ src: src, name: name });
          var w = Math.min(max, im.naturalWidth), h = Math.round(im.naturalHeight * w / im.naturalWidth);
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(im, 0, 0, w, h);
          res({ src: c.toDataURL("image/jpeg", 0.85), name: name.replace(/\.[a-z0-9]+$/, "") + ".jpg" });
        };
        im.src = src;
      };
      rd.readAsDataURL(f);
    });
  }
  function currentBlock() {
    var sel = window.getSelection(), n = sel.rangeCount && sel.anchorNode && body.contains(sel.anchorNode) ? sel.anchorNode : null;
    while (n && n.parentNode !== body) n = n.parentNode;
    return n;
  }
  function insertFigure(src, name, after) {
    var taken = new Set(Object.keys(cur.images || {}));
    $$("#body img[data-file]").forEach(function (i) { taken.add(i.dataset.file); });
    name = L.uniqueName(name, taken);
    cur.images = cur.images || {}; cur.images[name] = src;
    var fig = document.createElement("figure");
    fig.innerHTML = '<img src="' + src + '" data-file="' + esc(name) + '" alt=""><figcaption></figcaption>';
    if (after && after.parentNode === body) after.after(fig); else body.appendChild(fig);
    var p = document.createElement("p"); p.innerHTML = "<br>"; if (!fig.nextSibling) fig.after(p);
    /* キャプション欄にカーソルを置く */
    var cap = fig.querySelector("figcaption"), r = document.createRange(), sel = window.getSelection();
    r.setStart(cap, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); body.focus();
    dirty();
    return fig;
  }
  body.addEventListener("click", function (e) {
    $$(".body figure").forEach(function (f) { f.classList.remove("sel"); });
    var f = e.target.closest("figure"); if (f && e.target.tagName === "IMG") f.classList.add("sel");
  });
  body.addEventListener("keydown", function (e) {
    var f = $(".body figure.sel");
    if (f && (e.key === "Backspace" || e.key === "Delete") && !e.target.closest("figcaption")) { e.preventDefault(); f.remove(); dirty(); }
  });

  /* ── 工程 ─────────────────────────────── */
  function show(v) {
    view = v;
    $$(".nav button").forEach(function (b) { b.setAttribute("aria-current", b.dataset.nav === v ? "page" : "false"); });
    var isWrite = v === "write";
    $("#steps").classList.toggle("hidden", !isWrite);
    $("#save").classList.toggle("hidden", !isWrite);
    $("#pageTitle").classList.toggle("hidden", isWrite);
    $("#pageTitle").textContent = { published: "公開済みの記事", prompts: "校正プロンプト", settings: "設定" }[v] || "";
    $("#vWrite").classList.toggle("is-on", isWrite && step <= 2);
    $("#vPrev").classList.toggle("is-on", isWrite && step >= 3);
    $("#vPublished").classList.toggle("is-on", v === "published");
    $("#vPrompts").classList.toggle("is-on", v === "prompts");
    $("#vSettings").classList.toggle("is-on", v === "settings");
    if (v === "published") { if (pub.list) renderPublished(); else loadPublished(); }
    if (v === "prompts") renderPromptEditor();
    if (v === "settings") fillSettings();
  }
  $$(".nav button").forEach(function (b) { b.addEventListener("click", function () { flush(); show(b.dataset.nav); }); });

  function go(n) {
    if (n >= 3 && step <= 2) { flush(); postHtml = cur.htmlOverride || toSiteHtml(); }
    step = n;
    $$(".step").forEach(function (s) {
      var k = +s.dataset.step;
      s.setAttribute("aria-current", k === n ? "step" : "false");
      s.classList.toggle("done", k < n);
    });
    $("#vWrite").classList.toggle("is-on", n <= 2);
    $("#vWrite").classList.toggle("proof", n === 2);
    $("#vPrev").classList.toggle("is-on", n >= 3);
    if (n >= 3) { showTab("post"); renderLive(); refreshChanges(); }
    if (n === 4) openPublish();
  }
  $$(".step").forEach(function (s) { s.addEventListener("click", function () { go(+s.dataset.step); }); });
  $("#closeAi").addEventListener("click", function () { go(1); });
  $("#toPreview").addEventListener("click", function () { go(3); });
  $("#backEdit").addEventListener("click", function () { go(1); });

  /* ── AI 校正 ───────────────────────────── */
  function renderChips() {
    $("#presetChips").innerHTML = P.presets.map(function (p, i) { return '<button class="chip" aria-pressed="' + !!p.on + '" data-i="' + i + '">' + esc(p.label) + "</button>"; }).join("");
  }
  function buildPrompt() {
    $("#prompt").value = P.base + "\n" + P.presets.filter(function (p) { return p.on; }).map(function (p) { return "・" + p.text; }).join("\n");
  }
  $("#presetChips").addEventListener("click", function (e) {
    var c = e.target.closest(".chip"); if (!c) return;
    var p = P.presets[+c.dataset.i]; p.on = !p.on; lsSet("studio.prompts", P); renderChips(); buildPrompt();
  });

  /* 本文をプレーンテキストに（段落ごとに改行） */
  function plainText() {
    unmarkAll();
    return Array.prototype.map.call(body.childNodes, function (n) { return n.nodeType === 1 ? n.innerText || n.textContent : n.nodeValue || ""; })
      .map(function (s) { return s.trim(); }).filter(Boolean).join("\n");
  }
  /* claude.ai / ChatGPT に貼り付ける文章 */
  function copyText() {
    return $("#prompt").value.trim() + "\n\n" +
      "# 返事の形式\n" +
      "次の形の JSON だけを ```json のコードブロックで返してください。説明文は不要です。\n" +
      "```json\n" +
      "{\n" +
      "  \"suggestions\": [\n" +
      "    { \"kind\": \"誤字\", \"from\": \"修正前の文字列\", \"to\": \"修正後の文字列\", \"why\": \"理由を一言\" }\n" +
      "  ],\n" +
      "  \"summary\": \"全体の印象を1〜2文で\"\n" +
      "}\n" +
      "```\n" +
      "- from は本文にある文字列を一字一句そのまま、1つの段落の中から抜き出してください。\n" +
      "- 修正が必要な箇所だけを入れてください。直す必要がなければ suggestions は [] にしてください。\n\n" +
      "# タイトル\n" + (title.value.trim() || "（無題）") + "\n\n" +
      "# 本文\n" + plainText();
  }
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    var t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* noop */ }
    t.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("コピーできませんでした"));
  }
  /* タイトルと本文をそのままコピー */
  var copyAllT;
  $("#copyAll").addEventListener("click", function () {
    var btn = this, label = btn.querySelector("span"), text = plainText();
    if (!text) { toast({ error: true, title: "本文が空です" }); return; }
    var t = title.value.trim();
    copyToClipboard((t ? t + "\n\n" : "") + text).then(function () {
      btn.classList.add("is-done"); label.textContent = "コピーしました";
      clearTimeout(copyAllT); copyAllT = setTimeout(function () { btn.classList.remove("is-done"); label.textContent = "全文コピー"; }, 2000);
    }).catch(function (e) { toast({ error: true, title: e.message, msg: "ブラウザのクリップボード権限を確認してください" }); });
  });
  var copyT;
  $("#copyPrompt").addEventListener("click", function () {
    var btn = this, label = btn.querySelector("span");
    if (!plainText()) { $("#results").innerHTML = '<p class="ai__sum">本文が空です。</p>'; return; }
    copyToClipboard(copyText()).then(function () {
      btn.classList.add("is-done"); label.textContent = "コピーしました！ チャットに貼り付けてください";
      clearTimeout(copyT); copyT = setTimeout(function () { btn.classList.remove("is-done"); label.textContent = "校正用テキストをコピー"; }, 2500);
    }).catch(function (e) { toast({ error: true, title: e.message, msg: "ブラウザのクリップボード権限を確認してください" }); });
  });

  /* AI の返事から JSON を取り出す（```json ブロックや前後の説明文があっても読む） */
  function parseReply(text) {
    var t = String(text || "").trim();
    if (!t) throw new Error("AI の返事を貼り付けてください");
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) t = fence[1];
    var i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i < 0 || j < i) throw new Error("返事の中に JSON が見つかりませんでした。AI に「JSON だけで返して」と頼み直してください");
    t = t.slice(i, j + 1).replace(/[\u201c\u201d]/g, '"').replace(/,\s*([}\]])/g, "$1");
    var res;
    try { res = JSON.parse(t); } catch (e) { throw new Error("JSON の形が崩れていて読めませんでした。AI の返事をもう一度コピーし直すか、頼み直してください"); }
    if (Array.isArray(res)) res = { suggestions: res };
    return { suggestions: Array.isArray(res.suggestions) ? res.suggestions : [], summary: res.summary || "" };
  }

  var sugg = [];
  $("#loadReply").addEventListener("click", function () {
    var r = $("#results"), res;
    try { res = parseReply($("#reply").value); } catch (e) { r.innerHTML = '<div class="ai__err">' + esc(e.message) + "</div>"; return; }
    var text = plainText();
    sugg = res.suggestions.filter(function (s) { return s && s.from && s.from !== s.to; })
      .map(function (s) { s.to = s.to || ""; s.kind = s.kind || "提案"; s.why = s.why || ""; s.found = text.indexOf(s.from) >= 0; return s; });
    r.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span class="label" style="margin:0">提案 ' + sugg.length + " 件</span>" + (sugg.some(function (s) { return s.found; }) ? '<button class="btn btn--sm" id="acceptAll">すべて採用</button>' : "") + "</div>" +
      (sugg.length ? sugg.map(function (s, i) {
        return '<div class="sugg" data-i="' + i + '"><div class="sugg__k">' + esc(s.kind) + (s.found ? "" : " · 本文で見つかりません") + '</div><div class="sugg__txt"><span class="diff-del">' + esc(s.from) + '</span> → <span class="diff-add">' + esc(s.to) + '</span></div><div class="sugg__why">' + esc(s.why) + '</div><div class="sugg__act">' +
          (s.found ? '<button class="btn btn--sm btn--primary" data-a="ok">採用</button><button class="btn btn--sm" data-a="show">本文で見る</button>' : "") +
          '<button class="btn btn--sm btn--ghost" data-a="no">却下</button></div></div>';
      }).join("") : '<p class="ai__sum">直したい箇所は見つかりませんでした。このまま投稿できます。</p>') +
      (res.summary ? '<p class="ai__sum" style="margin-top:12px">全体の印象：' + esc(res.summary) + "</p>" : "");
    $("#reply").value = "";
    r.scrollIntoView({ block: "start", behavior: "smooth" });
    if (!sugg.length) markProofed();
  });
  function markProofed() { if (cur) { cur.status = "proof"; flush(); } }
  $("#results").addEventListener("click", function (e) {
    if (e.target.id === "acceptAll") { $$(".sugg:not(.done) [data-a=ok]").forEach(function (b) { b.click(); }); return; }
    var b = e.target.closest("[data-a]"); if (!b) return;
    var card = b.closest(".sugg"), s = sugg[+card.dataset.i];
    if (b.dataset.a === "show") { highlight(s.from); return; }
    if (b.dataset.a === "ok" && !replaceText(s.from, s.to)) {
      card.querySelector(".sugg__k").textContent = s.kind + " · 書式の境目をまたぐため自動で直せません。本文で直接直してください";
      return;
    }
    card.classList.add("done");
    if (!$$(".sugg:not(.done)").length) markProofed();
  });
  function walk(fn) { var w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), n; while ((n = w.nextNode())) { if (fn(n)) return true; } return false; }
  function replaceText(from, to) {
    unmarkAll();
    var ok = walk(function (n) { var i = n.nodeValue.indexOf(from); if (i < 0) return false; n.nodeValue = n.nodeValue.slice(0, i) + to + n.nodeValue.slice(i + from.length); return true; });
    if (ok) dirty();
    return ok;
  }
  function unmarkAll() { $$("#body mark.hl").forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); }); body.normalize(); }
  function highlight(str) {
    unmarkAll();
    walk(function (n) {
      var i = n.nodeValue.indexOf(str); if (i < 0) return false;
      var r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + str.length);
      var m = document.createElement("mark"); m.className = "hl"; r.surroundContents(m);
      m.scrollIntoView({ block: "center", behavior: "smooth" }); return true;
    });
  }

  /* ── エディタ ⇄ サイト用 HTML ───────────────── */
  var BLOCK = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, ul: 1, ol: 1, li: 1, blockquote: 1, pre: 1, hr: 1, figure: 1, figcaption: 1, table: 1, thead: 1, tbody: 1, tr: 1, th: 1, td: 1 };
  var STYLE_OK = /^(color|background-color|text-decoration|font-size|font-weight|text-align)$/;
  function cleanStyle(st) {
    return String(st || "").split(";").map(function (x) { return x.trim(); }).filter(function (x) {
      var k = x.split(":")[0].trim().toLowerCase(); return x && STYLE_OK.test(k) && !/url\(|expression/i.test(x);
    }).map(function (x) { return x.replace(/\s*:\s*/, ": ") + ";"; }).join(" ");
  }
  function imgSrcOut(img) {
    if (img.dataset.file) return "./posts/images/" + img.dataset.file;
    var src = img.getAttribute("src") || "", base = siteBase();
    return src.indexOf(base) === 0 ? "./" + src.slice(base.length) : src;
  }
  function ser(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, " ");
    if (n.nodeType !== 1) return "";
    var t = n.tagName.toLowerCase(), kids = function () { return Array.prototype.map.call(n.childNodes, ser).join(""); };
    if (t === "mark" || t === "font" && !n.getAttribute("color")) return kids();
    if (t === "br") return "<br>";
    if (t === "img") { var ic = n.getAttribute("class"); return '<img src="' + esc(imgSrcOut(n)) + '"' + (ic ? ' class="' + esc(ic) + '"' : "") + ' alt="' + esc(n.getAttribute("alt") || "") + '" />'; }
    if (t === "b" || t === "strong") { var s1 = cleanStyle(n.getAttribute("style")); return "<strong" + (s1 ? ' style="' + esc(s1) + '"' : "") + ">" + kids() + "</strong>"; }
    if (t === "i" || t === "em") return "<em>" + kids() + "</em>";
    if (t === "u") return '<span style="text-decoration: underline;">' + kids() + "</span>";
    if (t === "s" || t === "strike") return '<span style="text-decoration: line-through;">' + kids() + "</span>";
    if (t === "code") { var cl = (n.getAttribute("class") || "").replace(/[^\w\s-]/g, ""); return "<code" + (cl ? ' class="' + cl + '"' : "") + ">" + kids() + "</code>"; }
    if (t === "small" || t === "sup" || t === "sub") return "<" + t + ">" + kids() + "</" + t + ">";
    /* 埋め込み動画などはそのまま残す（エディタでは編集しない） */
    if (t === "iframe" || t === "video" || t === "audio") {
      if (/^\s*javascript:/i.test(n.getAttribute("src") || "")) return "";
      var emb = n.cloneNode(true); emb.removeAttribute("contenteditable"); return emb.outerHTML;
    }
    if (t === "a") {
      var href = n.getAttribute("href") || "";
      if (/^\s*javascript:/i.test(href)) return kids();
      return '<a href="' + esc(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + kids() + "</a>";
    }
    if (t === "span" || t === "font") {
      var st = cleanStyle(n.getAttribute("style"));
      if (t === "font" && n.getAttribute("color")) st = ("color: " + n.getAttribute("color") + "; " + st).trim();
      return st ? '<span style="' + esc(st) + '">' + kids() + "</span>" : kids();
    }
    if (t === "figure") {
      var img = n.querySelector("img"), cap = n.querySelector("figcaption");
      if (!img) return "";
      var c = cap ? Array.prototype.map.call(cap.childNodes, ser).join("").trim() : "";
      var fc = n.hasAttribute("data-cls") ? n.getAttribute("data-cls") : "post-figure";
      return "<figure" + (fc ? ' class="' + esc(fc) + '"' : "") + ">\n  " + ser(img) + (c ? "\n  <figcaption>" + c + "</figcaption>" : "") + "\n</figure>";
    }
    if (t === "div" && n.getAttribute("class")) {
      return '<div class="' + esc(n.getAttribute("class")) + '">\n  ' + Array.prototype.map.call(n.childNodes, ser).join("").trim() + "\n</div>";
    }
    if (t === "div") t = "p";
    if (BLOCK[t]) {
      var inner = kids(), bst = cleanStyle(n.getAttribute("style"));
      if (t === "hr") return "<hr>";
      if (t === "pre") return "<pre>" + inner + "</pre>";
      if (/^(p|h\d|li)$/.test(t) && !inner.replace(/<br>|\s/g, "")) return "";
      return "<" + t + (bst ? ' style="' + esc(bst) + '"' : "") + ">" + inner.replace(/(<br>)+$/, "") + "</" + t + ">";
    }
    return kids();
  }
  function toSiteHtml() {
    unmarkAll();
    var out = [], run = "";
    Array.prototype.forEach.call(body.childNodes, function (n) {
      var isBlock = n.nodeType === 1 && (BLOCK[n.tagName.toLowerCase()] || n.tagName === "DIV");
      if (!isBlock) { run += ser(n); return; }
      if (run.trim()) out.push(run.trim()); run = "";
      var h = ser(n); if (h) out.push(h);
    });
    if (run.trim()) out.push(run.trim());
    return out.join("\n\n") + "\n";
  }
  /* サイト用 HTML → エディタ（画像はサイトの URL で表示） */
  function fromSiteHtml(html, images) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    var base = siteBase();
    Array.prototype.forEach.call(tpl.content.querySelectorAll("*"), function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) { if (/^on/i.test(a.name)) el.removeAttribute(a.name); });
    });
    Array.prototype.forEach.call(tpl.content.querySelectorAll("img"), function (img) {
      var src = img.getAttribute("src") || "", m = /^(?:\.\/)?posts\/images\/(.+)$/.exec(src);
      if (m) { img.dataset.file = decodeURIComponent(m[1]); img.src = images && images[img.dataset.file] || base + "posts/images/" + m[1]; }
      else if (!/^(https?:|data:)/.test(src)) img.src = base + src.replace(/^\.\//, "");
    });
    Array.prototype.forEach.call(tpl.content.querySelectorAll("figure"), function (f) { f.setAttribute("data-cls", f.getAttribute("class") || ""); f.removeAttribute("class"); });
    Array.prototype.forEach.call(tpl.content.querySelectorAll("div[class], iframe, video, audio"), function (el) { el.setAttribute("contenteditable", "false"); });
    var d = document.createElement("div"); d.appendChild(tpl.content);
    return d.innerHTML;
  }

  /* ── プレビュー ─────────────────────────── */
  var ta = $("#html"), tab = "post", postHtml = "", articleCss = null;
  var FALLBACK_CSS = "body{margin:0;font-family:Arial,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#111;background:#fff}.page{padding:128px 40px 80px}.page-inner{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:120px minmax(0,1fr);column-gap:64px}.back-link{font-size:64px;line-height:1;color:#111;text-decoration:none;margin-top:24px}.article{max-width:600px}.article-title{margin:0;font-size:34px;line-height:1.25;font-weight:700;letter-spacing:-.02em}.article-date{margin:10px 0 0;font-size:14px;font-weight:700}.article-body{margin-top:52px;font-size:16px;line-height:2.25;word-break:break-word}.article-body p{margin:0 0 18px}.article-body h1,.article-body h2,.article-body h3,.article-body h4{margin:42px 0 18px;line-height:1.6}.article-body img{display:block;width:100%;height:auto;margin:42px 0 10px}.article-body .post-figure{width:100%;margin:42px 0 18px}.article-body .post-figure img{margin:0}.article-body .post-figure figcaption{margin-top:10px;font-size:13px;line-height:1.7;color:rgba(17,17,17,.72);text-align:center}.site-header{position:fixed;inset-inline:0;top:0;height:88px}.site-header a{position:absolute;top:24px;font-size:15px;font-weight:600;color:#51624f;text-decoration:none}.site-header__title{left:34px}.site-header__about{right:34px}.site-header__tagline{position:absolute;left:34px;top:46px;font-size:12px;color:rgba(81,98,79,.88)}@media(max-width:860px){.page{padding:112px 24px 64px}.page-inner{grid-template-columns:1fr;row-gap:24px}.back-link{font-size:52px;margin-top:0}}";
  function loadArticleCss() {
    if (articleCss !== null) return Promise.resolve(articleCss);
    /* 実際の article.html のスタイルを使う（同じサイト上に置いている前提。だめなら簡易版） */
    return fetch(new URL("../article.html", location.href).href, { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; })
      .catch(function () { return ""; })
      .then(function (t) { var m = /<style>([\s\S]*?)<\/style>/.exec(t); articleCss = m ? m[1] : FALLBACK_CSS; return articleCss; });
  }
  function displayDate(iso) {
    var d = new Date(L.formatDate(iso));
    return isNaN(d) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  function nextArticleId() { return cur.articleId || (pub.list ? L.nextId(pub.list) : "?"); }
  function renderLive() {
    loadArticleCss().then(function (css) {
      var safe = postHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      safe = safe.replace(/src="\.\/posts\/images\/([^"]+)"/g, function (m, f) {
        var key = f; try { key = decodeURIComponent(f); } catch (e) { /* noop */ }
        return cur.images && cur.images[key] ? 'src="' + cur.images[key] + '"' : m;
      });
      var doc = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="' + esc(siteBase()) + '" target="_blank"><style>' + css + "</style></head><body>" +
        '<header class="site-header"><div class="site-header__inner"><a class="site-header__title" href="./index.html">Ayappi Blog</a><div class="site-header__tagline">Life is not colorful, life is coloring</div><a class="site-header__about" href="./about.html">About Me</a></div></header>' +
        '<main class="page"><div class="page-inner"><a class="back-link" href="./index.html">←</a><article class="article"><header><h1 class="article-title">' + esc(title.value || "（無題）") + '</h1><p class="article-date">' + esc(displayDate(date.value)) + '</p></header><section class="article-body">' + safe + "</section></article></div></main></body></html>";
      var fr = $("#frame");
      fr.onload = function () { try { fr.style.height = Math.max(600, fr.contentDocument.documentElement.scrollHeight + 20) + "px"; } catch (e) { /* noop */ } };
      fr.srcdoc = doc;
      $("#url").textContent = siteBase().replace(/^https?:\/\//, "") + "article.html?id=" + nextArticleId();
      $("#tabPost").textContent = postPath(cur).replace(/^posts\//, "");
    });
  }
  function showTab(t) {
    tab = t;
    $$(".file-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === t); });
    if (t === "post") { ta.value = postHtml; ta.readOnly = false; sizeCode(); return; }
    ta.readOnly = true; ta.value = "読み込み中…";
    planArticles().then(function (p) { if (tab === "articles") { ta.value = p.text; sizeCode(); } })
      .catch(function (e) { if (tab === "articles") ta.value = "// " + e.message; });
  }
  function sizeCode() { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, $("#codeBox").clientHeight) + "px"; }
  $$(".file-tabs button").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });
  var liveT;
  ta.addEventListener("input", function () {
    if (tab !== "post") return;
    postHtml = ta.value; cur.htmlOverride = postHtml; sizeCode();
    clearTimeout(liveT); liveT = setTimeout(function () { renderLive(); refreshChanges(); }, 200);
  });
  ta.addEventListener("keydown", function (e) { if (e.key === "Tab" && !ta.readOnly) { e.preventDefault(); document.execCommand("insertText", false, "  "); } });
  $("#regen").addEventListener("click", function () { cur.htmlOverride = null; postHtml = toSiteHtml(); showTab("post"); renderLive(); refreshChanges(); });
  $("#toEditor").addEventListener("click", function () {
    body.innerHTML = fromSiteHtml(postHtml, cur.images); cur.htmlOverride = null; flush(); go(1);
    toast({ title: "HTML をエディタに反映しました" });
  });
  $$("#device button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#device button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      $("#browser").classList.toggle("mobile", b.dataset.d === "mobile");
      renderLive();
    });
  });

  /* articles.js の変更内容（プレビュー用。公開時は最新を取り直す） */
  function entryFor(list) {
    var iso = date.value || today();
    return { id: cur.articleId || L.nextId(list), year: Number(iso.slice(0, 4)), title: title.value.trim() || "無題", date: L.formatDate(iso), contentFile: "./" + postPath(cur) };
  }
  function applyArticles(src) {
    var list = L.parseArticles(src), a = entryFor(list);
    if (cur.articleId && !list.some(function (x) { return Number(x.id) === Number(cur.articleId); })) throw new Error("articles.js に id: " + cur.articleId + " がありません（削除された可能性があります）");
    var text = cur.articleId ? L.updateEntry(src, cur.articleId, a) : L.addEntry(src, a);
    L.parseArticles(text); /* 壊れていないか確認 */
    return { text: text, entry: a, list: list };
  }
  function planArticles() {
    var p = pub.list ? Promise.resolve(pub.src) : getText("articles.js").then(function (src) { pub.src = src; pub.list = L.parseArticles(src); $("#liveCount").textContent = pub.list.length; return src; });
    return p.then(applyArticles);
  }
  function usedNewImages() {
    var out = [];
    Object.keys(cur.images || {}).forEach(function (f) {
      if (postHtml.indexOf("./posts/images/" + f) >= 0 || postHtml.indexOf("./posts/images/" + encodeURI(f)) >= 0) out.push(f);
    });
    return out;
  }
  function refreshChanges() {
    var rows = [[cur.articleId ? "mod" : "add", cur.articleId ? "更新" : "新規", postPath(cur), postHtml.split("\n").length + " 行"], ["mod", "更新", "articles.js", cur.articleId ? "id: " + cur.articleId : "1 件追加"]];
    usedNewImages().forEach(function (f) { rows.push(["add", "新規", "posts/images/" + f, "画像"]); });
    $("#changes").innerHTML = rows.map(function (r) { return '<li><span class="tag ' + r[0] + '">' + r[1] + "</span>" + esc(r[2]) + '<span class="n">' + r[3] + "</span></li>"; }).join("");
  }

  /* ── 公開 ─────────────────────────────── */
  var modalAction = null;
  function openModal(o) {
    $("#mTitle").textContent = o.title; $("#mSub").textContent = o.sub;
    $("#mTarget").textContent = S.owner + "/" + S.repo + " · " + S.branch;
    $("#msg").value = o.msg;
    $("#go").textContent = o.go; $("#go").className = "btn " + (o.danger ? "btn--danger" : "btn--frog");
    $("#mForm").classList.remove("hidden"); $("#prog").classList.add("hidden"); $("#perr").classList.add("hidden");
    $("#mFoot").classList.remove("hidden"); $("#cancel").textContent = "キャンセル"; $("#go").classList.remove("hidden");
    modalAction = o.run; o.onCancel = o.onCancel || null; modalCancel = o.onCancel;
    $("#scrim").classList.add("open"); $("#go").focus();
  }
  var modalCancel = null;
  function closeModal() { $("#scrim").classList.remove("open"); if (modalCancel) modalCancel(); modalCancel = null; }
  $("#cancel").addEventListener("click", closeModal);
  $("#scrim").addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#mFoot").classList.contains("hidden")) closeModal(); });
  $("#go").addEventListener("click", function () { if (modalAction) modalAction(); });

  function progress(items) {
    $("#mForm").classList.add("hidden"); $("#mFoot").classList.add("hidden");
    var p = $("#prog"); p.classList.remove("hidden");
    p.innerHTML = items.map(function (t) { return '<li><span class="st"></span><span>' + t + "</span></li>"; }).join("");
    var lis = $$("#prog li"), i = -1;
    return {
      next: function () { if (i >= 0 && lis[i]) lis[i].className = "ok"; i++; if (lis[i]) lis[i].className = "run"; },
      done: function () { lis.forEach(function (l) { l.className = "ok"; }); },
      fail: function (e) {
        if (lis[Math.max(i, 0)]) lis[Math.max(i, 0)].className = "ng";
        $("#perr").textContent = e.message + (e.status === 409 || e.status === 422 ? "（直前に別の更新があった可能性があります。もう一度お試しください）" : "");
        $("#perr").classList.remove("hidden");
        $("#mFoot").classList.remove("hidden"); $("#go").classList.add("hidden"); $("#cancel").textContent = "閉じる";
      }
    };
  }

  $("#toPublish").addEventListener("click", function () { go(4); });
  function openPublish() {
    if (!S.ghToken) { toast({ error: true, title: "GitHub のトークンが未設定です", msg: "左の「設定」から入力してください" }); step = 3; go(3); return; }
    if (!title.value.trim()) { toast({ error: true, title: "タイトルを入れてください" }); go(1); title.focus(); return; }
    if (!cur.articleId && pub.list && pub.list.some(function (a) { return a.contentFile === "./" + postPath(cur); })) {
      toast({ error: true, title: "同じファイル名の記事がすでにあります", msg: postPath(cur) + " — 保存先のファイル名を変えてください" }); go(1); fname.focus(); return;
    }
    openModal({
      title: cur.articleId ? "記事を更新しますか？" : "GitHub に公開しますか？",
      sub: "下の " + $$("#changes li").length + " ファイルを 1 つのコミットでリポジトリに書き込みます。",
      msg: (cur.articleId ? "post: 「" + title.value.trim() + "」を更新" : "post: 「" + title.value.trim() + "」を公開"),
      go: cur.articleId ? "更新する" : "公開する",
      run: publish,
      onCancel: function () { go(3); }
    });
  }
  function publish() {
    var message = $("#msg").value.trim() || "post: update";
    var imgs = usedNewImages();
    var steps = ["最新の <code>articles.js</code> を取得"].concat(
      imgs.length ? ["画像 " + imgs.length + " 枚をアップロード"] : [],
      ["<code>" + esc(postPath(cur)) + "</code> と <code>articles.js</code> を書き込み", "コミットして <code>" + esc(S.branch) + "</code> へ push"]);
    var pr = progress(steps), d = cur, html = postHtml, base, plan, renames = {};
    pr.next();
    headSha().then(function (sha) {
      base = sha;
      return Promise.all([getText("articles.js", sha), imgs.length ? listDir("posts/images", sha) : []]);
    }).then(function (r) {
      plan = applyArticles(r[0]);
      if (!d.articleId && plan.list.some(function (a) { return a.contentFile === plan.entry.contentFile; })) throw new Error(postPath(d) + " はすでに使われています。ファイル名を変えてください");
      /* 既存の画像と名前が重なったら -2 などを付ける */
      var taken = new Set(r[1]);
      imgs.forEach(function (f) { var n = L.uniqueName(f, taken); taken.add(n); if (n !== f) renames[f] = n; });
      Object.keys(renames).forEach(function (f) { html = html.split("./posts/images/" + f).join("./posts/images/" + renames[f]); });
      if (imgs.length) pr.next();
      var changes = imgs.map(function (f) { return { path: "posts/images/" + (renames[f] || f), base64: d.images[f].split(",")[1] }; });
      changes.push({ path: postPath(d), text: html }, { path: "articles.js", text: plan.text });
      var first = true;
      return commit(base, message, changes, function (kind) {
        if (kind === "tree") pr.next();
        if (kind === "push" && first) { first = false; pr.next(); }
      });
    }).then(function (nc) {
      pr.done();
      Object.keys(renames).forEach(function (f) { d.images[renames[f]] = d.images[f]; });
      pub.src = plan.text; pub.list = L.parseArticles(plan.text); $("#liveCount").textContent = pub.list.length;
      setGh(true, nc.sha);
      var id = plan.entry.id, url = siteBase() + "article.html?id=" + id;
      setTimeout(function () {
        $("#scrim").classList.remove("open"); modalCancel = null;
        removeDraft(d.id, true);
        step = 1; go(1);
        toast({
          title: d.articleId ? "更新しました" : "公開しました",
          msg: "「" + plan.entry.title + "」を push しました。GitHub Pages への反映には 1〜2 分かかります。",
          meta: S.branch + " · " + nc.sha.slice(0, 7) + " · " + hhmm(),
          links: [["サイトで見る", url], ["コミットを見る", "https://github.com/" + S.owner + "/" + S.repo + "/commit/" + nc.sha]],
          ttl: 20000
        });
        if (!d.articleId) waitLive(plan.entry.contentFile, plan.entry.title);
      }, 500);
    }).catch(function (e) { pr.fail(e); });
  }
  /* GitHub Pages に反映されたら知らせる（新規公開のみ・最大 5 分） */
  function waitLive(contentFile, t) {
    var tries = 0, target = siteBase() + contentFile.replace(/^\.\//, "");
    function poll() {
      if (++tries > 20) return;
      fetch(target + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (r.ok) toast({ title: "サイトに反映されました", msg: "「" + t + "」", links: [["サイトで見る", siteBase()]] }); else setTimeout(poll, 15000); })
        .catch(function () { /* 確認できない環境では何もしない */ });
    }
    setTimeout(poll, 20000);
  }

  /* ── 公開済み一覧 ─────────────────────────── */
  var pubConfirm = null;
  function renderPublished() {
    $("#pubSrc").textContent = pub.list ? "· " + S.owner + "/" + S.repo + " の articles.js" : "";
    if (!pub.list) { $("#pubList").innerHTML = '<li class="empty">' + esc(pub.error || "読み込み中…") + "</li>"; return; }
    var rows = pub.list.slice().sort(function (a, b) { return Number(b.id) - Number(a.id); });
    $("#pubList").innerHTML = rows.map(function (a) {
      var editing = drafts.some(function (d) { return Number(d.articleId) === Number(a.id); });
      var conf = pubConfirm === a.id ? '<div class="dconfirm"><p>「' + esc(a.title) + '」を削除しますか？</p><small>articles.js から外し、' + esc(a.contentFile) + ' を削除するコミットを作ります（画像は残します）。GitHub の履歴からは戻せます。</small><div><button class="btn btn--sm btn--danger" data-pdel="' + a.id + '">削除する</button><button class="btn btn--sm" data-pcancel="1">キャンセル</button></div></div>' : "";
      return '<li class="prow"><span class="prow__id">#' + esc(a.id) + '</span><div><div class="prow__t">' + esc(a.title) + '</div><div class="prow__m">' + esc(a.date) + " · " + esc(a.contentFile) + "</div></div>" +
        '<div class="prow__a"><a class="btn btn--sm btn--ghost" href="' + esc(siteBase() + "article.html?id=" + a.id) + '" target="_blank" rel="noopener">見る</a><button class="btn btn--sm" data-edit="' + a.id + '">' + (editing ? "編集を続ける" : "編集") + '</button><button class="btn btn--sm btn--ghost" data-pask="' + a.id + '" aria-label="削除">削除</button></div>' + conf + "</li>";
    }).join("") || '<li class="empty">まだ記事がありません。</li>';
  }
  $("#reloadPub").addEventListener("click", function () { pub.list = null; loadPublished(); });
  $("#pubList").addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-pask]"))) { pubConfirm = Number(b.dataset.pask); renderPublished(); return; }
    if (e.target.closest("[data-pcancel]")) { pubConfirm = null; renderPublished(); return; }
    if ((b = e.target.closest("[data-pdel]"))) { deletePublished(Number(b.dataset.pdel)); return; }
    if ((b = e.target.closest("[data-edit]"))) editPublished(Number(b.dataset.edit), b);
  });
  function editPublished(id, btn) {
    var existing = drafts.filter(function (d) { return Number(d.articleId) === id; })[0];
    if (existing) { show("write"); step = 1; go(1); load(existing); return; }
    var a = pub.list.filter(function (x) { return Number(x.id) === id; })[0];
    btn.disabled = true; btn.textContent = "読み込み中…";
    getText(a.contentFile.replace(/^\.\//, "")).then(function (html) {
      var d = blankDraft();
      d.articleId = a.id; d.contentFile = a.contentFile; d.title = a.title; d.date = L.toIsoDate(a.date) || today();
      d.html = fromSiteHtml(html, {}); d.status = "proof";
      drafts.push(d); return store.put(d).then(function () { show("write"); step = 1; go(1); load(d); });
    }).catch(function (e) { toast({ error: true, title: "記事を読み込めませんでした", msg: e.message }); btn.disabled = false; btn.textContent = "編集"; });
  }
  function deletePublished(id) {
    var a = pub.list.filter(function (x) { return Number(x.id) === id; })[0];
    pubConfirm = null; renderPublished();
    openModal({
      title: "記事を削除しますか？", sub: "「" + a.title + "」を articles.js から外し、記事ファイルを削除します。", msg: "post: 「" + a.title + "」を削除",
      go: "削除する", danger: true,
      run: function () {
        var pr = progress(["最新の <code>articles.js</code> を取得", "<code>" + esc(a.contentFile.replace(/^\.\//, "")) + "</code> を削除", "コミットして <code>" + esc(S.branch) + "</code> へ push"]);
        var text;
        pr.next();
        headSha().then(function (base) {
          return getText("articles.js", base).then(function (src) {
            text = L.removeEntry(src, id); L.parseArticles(text);
            pr.next();
            var stillUsed = L.parseArticles(text).some(function (x) { return x.contentFile === a.contentFile; });
            var changes = [{ path: "articles.js", text: text }];
            if (!stillUsed) changes.push({ path: a.contentFile.replace(/^\.\//, ""), remove: true });
            return commit(base, $("#msg").value.trim() || "post: delete", changes, function (k) { if (k === "push") pr.next(); });
          });
        }).then(function (nc) {
          pr.done(); pub.src = text; pub.list = L.parseArticles(text); $("#liveCount").textContent = pub.list.length; setGh(true, nc.sha);
          setTimeout(function () { $("#scrim").classList.remove("open"); renderPublished(); toast({ title: "削除しました", msg: "「" + a.title + "」", meta: S.branch + " · " + nc.sha.slice(0, 7) }); }, 400);
        }).catch(function (e) { pr.fail(e); });
      }
    });
  }

  /* ── 校正プロンプト編集 ─────────────────────── */
  function renderPromptEditor() {
    $("#pBase").value = P.base;
    $("#presetList").innerHTML = P.presets.map(function (p, i) {
      return '<div class="preset" data-i="' + i + '"><input class="input" data-k="label" value="' + esc(p.label) + '" aria-label="名前"><textarea class="textarea" data-k="text" aria-label="指示">' + esc(p.text) + '</textarea><button class="btn btn--sm btn--ghost" data-rm="' + i + '" aria-label="削除">✕</button></div>';
    }).join("") || '<p class="help">プリセットはありません。</p>';
  }
  function readPromptEditor() {
    P.base = $("#pBase").value;
    $$("#presetList .preset").forEach(function (row) {
      var p = P.presets[+row.dataset.i];
      p.label = row.querySelector("[data-k=label]").value; p.text = row.querySelector("[data-k=text]").value;
    });
  }
  $("#presetList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]"); if (!b) return;
    readPromptEditor(); P.presets.splice(+b.dataset.rm, 1); renderPromptEditor();
  });
  $("#addPreset").addEventListener("click", function () { readPromptEditor(); P.presets.push({ key: "p" + Date.now(), label: "新しいプリセット", text: "", on: false }); renderPromptEditor(); });
  $("#savePrompts").addEventListener("click", function () { readPromptEditor(); lsSet("studio.prompts", P); renderChips(); buildPrompt(); toast({ title: "校正プロンプトを保存しました" }); });
  $("#resetPrompts").addEventListener("click", function () { P = JSON.parse(JSON.stringify(PROMPT_DEFAULTS)); renderPromptEditor(); });

  /* ── 設定 ─────────────────────────────── */
  var form = $("#settingsForm");
  function fillSettings() { ["owner", "repo", "branch", "ghToken", "siteUrl"].forEach(function (k) { form.elements[k].value = S[k] || ""; }); }
  function readSettings() { ["owner", "repo", "branch", "ghToken", "siteUrl"].forEach(function (k) { S[k] = form.elements[k].value.trim(); }); lsSet("studio.settings", S); }
  form.addEventListener("submit", function (e) {
    e.preventDefault(); readSettings(); pub.list = null;
    toast({ title: "設定を保存しました" }); loadPublished().then(testBadge);
  });
  function testBadge() {
    var b = $("#ghTest");
    if (!S.ghToken) { b.className = "badge"; b.textContent = "未確認"; return; }
    return gh("").then(function (r) {
      var ok = r.permissions && r.permissions.push;
      b.className = "badge " + (ok ? "badge--live" : "badge--off"); b.textContent = ok ? "書き込み可" : "書き込み権限なし";
    }).catch(function (e) { b.className = "badge badge--off"; b.textContent = e.status === 401 ? "トークンが無効" : e.status === 404 ? "リポジトリが見つからない" : "エラー"; });
  }
  $("#testGh").addEventListener("click", function () { readSettings(); testBadge(); });

  /* ── トースト ───────────────────────────── */
  function toast(o) {
    var el = document.createElement("div");
    el.className = "toast" + (o.error ? " toast--error" : ""); el.setAttribute("role", "status");
    el.innerHTML = '<div style="flex:1;min-width:0"><div class="toast__title">' + esc(o.title) + "</div>" +
      (o.msg ? '<div style="font-size:13px;margin:2px 0 6px">' + esc(o.msg) + "</div>" : "") +
      (o.meta ? '<div class="toast__meta">' + esc(o.meta) + "</div>" : "") +
      (o.links ? '<div style="margin-top:8px;display:flex;gap:14px;font-size:12.5px">' + o.links.map(function (l) { return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + "</a>"; }).join("") + "</div>" : "") +
      (o.action ? '<div style="margin-top:8px;font-size:12.5px"><a href="#" data-act>' + esc(o.action) + "</a></div>" : "") +
      '</div><button class="btn btn--ghost btn--sm" aria-label="閉じる">✕</button>';
    el.querySelector("button").onclick = function () { el.remove(); };
    if (o.action) el.querySelector("[data-act]").onclick = function (e) { e.preventDefault(); el.remove(); o.onAction(); };
    $("#toasts").appendChild(el);
    var ttl = o.ttl === undefined ? 5000 : o.ttl;
    if (ttl) setTimeout(function () { el.remove(); }, ttl);
  }

  document.addEventListener("click", function (e) { if (!e.target.closest(".colors")) pop.classList.remove("open"); });
  window.addEventListener("beforeunload", function () { snapshot(); store.put(cur); });

  /* ── 起動 ─────────────────────────────── */
  renderChips(); buildPrompt(); setGh(false);
  store.all().then(function (all) {
    drafts = all || [];
    if (!drafts.length) { var d = blankDraft(); drafts.push(d); store.put(d); }
    load(drafts.slice().sort(function (a, b) { return b.updated - a.updated; })[0]);
    if (!S.ghToken) { show("settings"); toast({ title: "はじめに設定をしてください", msg: "GitHub のトークンを入れると使えるようになります。", ttl: 8000 }); }
    else loadPublished();
  });
  setInterval(renderList, 30000);
  /* 動作確認用 */
  window.__studio = { toSiteHtml: toSiteHtml, fromSiteHtml: fromSiteHtml, body: body };
})();
