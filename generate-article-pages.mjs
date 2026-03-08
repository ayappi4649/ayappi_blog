import fs from "fs/promises";
import path from "path";

const SITE_URL = "https://ayappi4649.github.io/ayappi_blog";
const SITE_NAME = "Ayappi Canvas";
const COMMON_OG_IMAGE = `${SITE_URL}/icon.jpeg`;

const articlesModulePath = path.resolve("./articles.js");
const articlesDir = path.resolve("./articles");
const templateArticlePath = path.resolve("./article.html");

async function loadArticles() {
  const source = await fs.readFile(articlesModulePath, "utf8");
  const sandbox = { window: {} };
  const fn = new Function("window", `${source}; return window.ARTICLES;`);
  const articles = fn(sandbox.window);

  if (!Array.isArray(articles)) {
    throw new Error("window.ARTICLES が配列ではありません。");
  }

  return articles;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<video[\s\S]*?<\/video>/gi, "")
    .replace(/<audio[\s\S]*?<\/audio>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/　+/g, " ")
    .trim();
}

function extractDescription(html) {
  const rawText = stripHtmlToText(html);
  if (!rawText) return "";
  const shortened = rawText.slice(0, 120).trim();
  return rawText.length > 120 ? `${shortened}…` : shortened;
}

function formatDisplayDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function buildArticleHtml({ article, bodyHtml, description }) {
  const pageUrl = `${SITE_URL}/articles/${encodeURIComponent(article.slug)}.html`;
  const pageTitle = `${article.title} | ${SITE_NAME}`;
  const displayDate = formatDisplayDate(article.date);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="icon" type="image/jpeg" href="../icon.jpeg">

  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(article.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:image" content="${escapeHtml(COMMON_OG_IMAGE)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(article.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(COMMON_OG_IMAGE)}">

  <style>
    :root {
      --bg: #ffffff;
      --text: #111111;
      --muted: #51624f;
      --line: #e2e2de;
      --surface: #cfcfcf;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      width: 100%;
      min-height: 100%;
      font-family: Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      color: var(--text);
      background: var(--bg);
      overflow-x: hidden;
    }

    body {
      position: relative;
      background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(0, 0, 0, 0.012));
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle at 14% 18%, rgba(0,0,0,0.12) 0 1.25px, transparent 1.9px),
        radial-gradient(circle at 77% 28%, rgba(0,0,0,0.11) 0 1.3px, transparent 1.95px),
        radial-gradient(circle at 35% 74%, rgba(0,0,0,0.1) 0 1.18px, transparent 1.82px),
        radial-gradient(circle at 62% 84%, rgba(0,0,0,0.095) 0 1.12px, transparent 1.76px),
        radial-gradient(circle at 10% 12%, rgba(0,0,0,0.085) 0 0.72px, transparent 1.18px),
        radial-gradient(circle at 22% 36%, rgba(0,0,0,0.08) 0 0.68px, transparent 1.12px),
        radial-gradient(circle at 38% 22%, rgba(0,0,0,0.078) 0 0.66px, transparent 1.08px),
        radial-gradient(circle at 52% 48%, rgba(0,0,0,0.074) 0 0.68px, transparent 1.12px),
        radial-gradient(circle at 66% 18%, rgba(0,0,0,0.07) 0 0.64px, transparent 1.04px),
        radial-gradient(circle at 82% 42%, rgba(0,0,0,0.068) 0 0.66px, transparent 1.08px),
        radial-gradient(circle at 8% 58%, rgba(255,255,255,0.13) 0 0.82px, transparent 1.3px),
        radial-gradient(circle at 56% 12%, rgba(255,255,255,0.1) 0 0.76px, transparent 1.22px),
        radial-gradient(circle at 18% 72%, rgba(0,0,0,0.06) 0 0.58px, transparent 0.98px),
        radial-gradient(circle at 44% 86%, rgba(0,0,0,0.056) 0 0.56px, transparent 0.94px),
        radial-gradient(circle at 72% 78%, rgba(0,0,0,0.052) 0 0.54px, transparent 0.92px),
        linear-gradient(115deg, rgba(0,0,0,0.028) 0, rgba(0,0,0,0.028) 1px, transparent 1px, transparent 24px),
        linear-gradient(65deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 26px);
      background-size: 124px 124px, 142px 142px, 156px 156px, 174px 174px, 26px 26px, 28px 28px, 30px 30px, 28px 28px, 32px 32px, 30px 30px, 74px 74px, 86px 86px, 28px 28px, 30px 30px, 32px 32px, 26px 26px, 30px 30px;
      background-position: 0 0, 40px 54px, 92px 22px, 124px 88px, 0 0, 8px 6px, 12px 10px, 6px 14px, 10px 4px, 16px 12px, 20px 18px, 62px 12px, 4px 18px, 14px 8px, 18px 14px, 0 0, 8px 10px;
      mix-blend-mode: multiply;
      opacity: 0.82;
      filter: blur(0.16px);
      z-index: 0;
    }

    .site-header {
      position: fixed;
      inset-inline: 0;
      top: 0;
      z-index: 20;
      height: 88px;
      pointer-events: none;
    }

    .site-header__inner {
      position: relative;
      height: 100%;
      padding: 24px 34px 0;
    }

    .site-header a {
      position: absolute;
      top: 24px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--muted);
      text-decoration: none;
      pointer-events: auto;
    }

    .site-header__title { left: 34px; }
    .site-header__about { right: 34px; }

    .site-header__tagline {
      position: absolute;
      left: 34px;
      top: 46px;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.01em;
      color: rgba(81, 98, 79, 0.88);
      white-space: nowrap;
      pointer-events: none;
    }

    .page {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      padding: 128px 40px 80px;
    }

    .page-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      column-gap: 64px;
      align-items: start;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      width: fit-content;
      color: var(--text);
      text-decoration: none;
      font-size: 64px;
      line-height: 1;
      margin-top: 24px;
      align-self: start;
    }

    .back-link:hover { opacity: 0.7; }

    .article { max-width: 600px; }

    .article-title {
      margin: 0;
      font-size: 34px;
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .article-date {
      margin: 10px 0 0;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.5;
    }

    .article-body {
      margin-top: 52px;
      font-size: 16px;
      line-height: 2.25;
      word-break: break-word;
    }

    .article-body p { margin: 0 0 18px; }
    .article-body h1,
    .article-body h2,
    .article-body h3,
    .article-body h4 {
      margin: 42px 0 18px;
      line-height: 1.6;
    }

    .article-body img {
      display: block;
      width: 100%;
      height: auto;
      margin: 42px 0 10px;
    }

    .article-body .post-figure {
      width: 100%;
      margin: 42px 0 18px;
    }

    .article-body .post-figure img {
      display: block;
      width: 100%;
      height: auto;
    }

    .article-body .post-figure figcaption {
      margin-top: 10px;
      font-size: 13px;
      line-height: 1.7;
      color: rgba(17, 17, 17, 0.72);
      text-align: center;
    }

    @media (max-width: 860px) {
      .page { padding: 112px 24px 64px; }
      .page-inner {
        grid-template-columns: 1fr;
        row-gap: 24px;
      }
      .back-link {
        font-size: 52px;
        margin-top: 0;
      }
      .article { max-width: 100%; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-header__title" href="../index.html">Ayappi Canvas</a>
      <div class="site-header__tagline">Life is not colorful, life is coloring</div>
      <a class="site-header__about" href="../about.html">About Me</a>
    </div>
  </header>

  <main class="page">
    <div class="page-inner">
      <a class="back-link" href="../index.html" aria-label="Indexへ戻る">←</a>
      <article class="article">
        <header>
          <h1 class="article-title">${escapeHtml(article.title)}</h1>
          <p class="article-date">${escapeHtml(displayDate)}</p>
        </header>
        <section class="article-body">
          ${bodyHtml}
        </section>
      </article>
    </div>
  </main>
</body>
</html>`;
}

async function main() {
  const articles = await loadArticles();
  await fs.mkdir(articlesDir, { recursive: true });

  for (const article of articles) {
    if (!article.slug) {
      throw new Error(`slug がありません: ${article.title}`);
    }
    if (!article.contentFile) {
      throw new Error(`contentFile がありません: ${article.title}`);
    }

    const contentPath = path.resolve(article.contentFile);
    const bodyHtml = await fs.readFile(contentPath, "utf8");
    const description = extractDescription(bodyHtml);

    const outputHtml = buildArticleHtml({
      article,
      bodyHtml,
      description
    });

    const outputPath = path.join(articlesDir, `${article.slug}.html`);
    await fs.writeFile(outputPath, outputHtml, "utf8");
    console.log(`Generated: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});