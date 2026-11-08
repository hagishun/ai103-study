// End-to-end checks in a real browser (Chrome via Puppeteer).
// Serves the repository under /ai103-study/ like GitHub Pages, or tests a deployed URL:
//   node tests/e2e.mjs                       # local
//   BASE_URL=https://hagishun.github.io/ai103-study/ node tests/e2e.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const Core = require("../js/core.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREENSHOTS = process.env.SCREENSHOT_DIR || "";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/ai103-study/")) {
      res.writeHead(404).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice("/ai103-study/".length)) || "index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const results = [];
let currentPage = null;
let touch = true;

// Real phones tap; mouse clicks under touch emulation can fire twice and toggle checkboxes back.
async function press(el) {
  await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
  if (touch) await el.tap();
  else await el.click();
}
async function check(name, fn) {
  try {
    await fn();
    results.push([name, "ok"]);
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push([name, error.message]);
    if (SCREENSHOTS && currentPage) await shot(currentPage, `fail-${results.length}`).catch(() => {});
    console.log(`✖ ${name}\n   ${error.stack || error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function noHorizontalOverflow(page, label) {
  const info = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed") {
        const inScroller = el.closest(".table-wrap");
        if (!inScroller) offenders.push(`${el.tagName}.${el.className} right=${Math.round(r.right)}`);
      }
    });
    return { scrollWidth: document.documentElement.scrollWidth, vw, offenders: offenders.slice(0, 5) };
  });
  assert(info.scrollWidth <= info.vw && info.offenders.length === 0, `${label}: horizontal overflow ${JSON.stringify(info)}`);
}

async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim().includes(t) && !el.disabled),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) {
    const available = await page.$$eval(selector, (els) => els.map((e) => `${e.textContent.trim().slice(0, 40)}${e.disabled ? "(disabled)" : ""}`));
    throw new Error(`no ${selector} containing "${text}"; found: ${JSON.stringify(available)}`);
  }
  await press(el);
}

async function shot(page, name) {
  if (!SCREENSHOTS) return;
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: false });
}

async function go(page, base, hash) {
  // about:blank first so every call is a full page load (a hash-only change would keep in-memory state)
  await page.goto("about:blank");
  await page.goto(`${base}${hash}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#app > *:not(.loading)");
}

// Writes a session from a same-origin page that is not running the app, so the app cannot overwrite it on pagehide.
async function injectSession(page, base, questions, mode) {
  const session = Core.createSession({ mode, title: "E2E", questions });
  await page.goto("about:blank");
  await page.goto(`${base}manifest.webmanifest`);
  await page.evaluate((value) => localStorage.setItem("ai103.session.v1", value), JSON.stringify(session));
}

async function selectCorrect(page, q, { wrong = false } = {}) {
  if (q.type === "dropdown") {
    const selects = await page.$$(".blank select");
    for (let i = 0; i < q.dropdowns.length; i += 1) {
      const d = q.dropdowns[i];
      const value = wrong && i === 0 ? d.choices.find((c) => c !== d.answer) : d.answer;
      await selects[i].select(value);
    }
    return;
  }
  const targets = [...q.answer];
  if (wrong) targets[targets.length - 1] = q.options.findIndex((_, i) => !q.answer.includes(i));
  for (const index of targets) {
    await clickChoice(page, index);
  }
}

// Options are addressed by their original index, so the helpers work in Japanese and English.
async function clickChoice(page, index) {
  const el = await page.$(`label.choice[data-option="${index}"]`);
  assert(el, `no choice with original index ${index}`);
  await press(el);
}

async function main() {
  let server = null;
  let base = process.env.BASE_URL;
  if (!base) {
    server = await serve();
    base = `http://127.0.0.1:${server.address().port}/ai103-study/`;
  }
  const bank = JSON.parse(fs.readFileSync(path.join(root, "data/bank.json"), "utf8"));
  const byId = new Map(bank.map((q) => [q.id, q]));
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: process.env.CI ? ["--no-sandbox"] : [],
  });
  const page = await browser.newPage();
  currentPage = page;
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => results.push(["page error", error.message]));
  await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  await check("home loads at 360px without horizontal scroll", async () => {
    await go(page, base, "#/");
    const tiles = await page.$$eval(".tile", (els) => els.map((e) => e.textContent));
    assert(tiles.some((t) => t.includes("分野別学習")) && tiles.some((t) => t.includes("模擬試験")), "menu tiles missing");
    await noHorizontalOverflow(page, "home");
    await shot(page, "01-home");
  });

  await check("domain study: 10 questions, feedback, explanation and official links", async () => {
    await go(page, base, "#/study");
    await clickText(page, ".pick", "生成AI");
    await clickText(page, ".segment", "10問");
    await noHorizontalOverflow(page, "study setup");
    await clickText(page, ".actionbar button", "開始");
    await page.waitForSelector(".question");
    const count = await page.$eval(".quiz-count", (el) => el.textContent);
    assert(count.trim() === "1 / 10", `unexpected counter ${count}`);
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
    session.questionIds.forEach((id) => assert(byId.get(id).domain === "genai" && byId.get(id).status === "verified", `${id} not a verified genai question`));
    const q = byId.get(session.questionIds[0]);
    const disabled = await page.$eval("#actionbar .btn.primary", (b) => b.disabled);
    assert(disabled, "submit should be disabled before answering");
    await selectCorrect(page, q);
    await shot(page, "02-question");
    await clickText(page, "#actionbar button", "回答する");
    await page.waitForSelector(".feedback");
    const verdict = await page.$eval(".verdict", (el) => el.textContent);
    assert(verdict === "正解", `expected 正解, got ${verdict}`);
    const links = await page.$$eval(".feedback .links a", (as) => as.map((a) => a.href));
    assert(links.length > 0 && links.every((l) => l.startsWith("https://learn.microsoft.com/")), "official links missing");
    const ja = await page.$eval(".feedback", (el) => el.textContent.includes("解説"));
    assert(ja, "explanation missing");
    await noHorizontalOverflow(page, "feedback");
    await shot(page, "03-feedback");
  });

  await check("resume: answer 5 questions, close, reopen and continue", async () => {
    // continue the session above: question 1 is answered; answer 2..5
    for (let i = 1; i < 5; i += 1) {
      await clickText(page, "#actionbar button", "次へ");
      await page.waitForFunction((n) => document.querySelector(".quiz-count")?.textContent.trim().startsWith(`${n} /`), {}, i + 1);
      const s = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
      await selectCorrect(page, byId.get(s.questionIds[i]), { wrong: i === 2 });
      await clickText(page, "#actionbar button", "回答する");
      await page.waitForSelector(".feedback");
    }
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
    // simulate closing the app: open a fresh page
    await page.goto("about:blank");
    await go(page, base, "#/");
    const card = await page.$eval(".resume", (el) => el.textContent);
    assert(card.includes("5 / 10"), `resume card: ${card}`);
    await shot(page, "04-resume");
    await clickText(page, ".resume button", "続きから再開");
    await page.waitForSelector(".question");
    const count = await page.$eval(".quiz-count", (el) => el.textContent.trim());
    assert(count === "5 / 10", `should reopen at question 5, got ${count}`);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
    assert(JSON.stringify(after.answers) === JSON.stringify(before.answers), "answers changed after resume");
    assert(JSON.stringify(after.order) === JSON.stringify(before.order), "option order changed after resume");
    const verdictShown = await page.$(".feedback");
    assert(verdictShown, "answered question should still show feedback");
    await clickText(page, "#actionbar button", "次へ");
    await page.waitForFunction(() => document.querySelector(".quiz-count")?.textContent.trim() === "6 / 10");
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.history.v1")));
    assert(history.log.length === 5, `history should have 5 answers, has ${history.log.length}`);
    assert(history.log.filter((e) => !e.correct).length === 1, "exactly one wrong answer expected");
  });

  await check("finish practice early, result and review of the wrong question", async () => {
    await clickText(page, ".quiz-head button", "終了");
    await page.waitForSelector(".score");
    const text = await page.$eval(".score", (el) => el.textContent);
    assert(text.includes("4 / 5"), `score text ${text}`);
    await noHorizontalOverflow(page, "result");
    await shot(page, "05-result");
    await go(page, base, "#/review");
    const stats = await page.$eval(".stats-row", (el) => el.textContent);
    assert(stats.includes("1要復習"), `review stats ${stats}`);
    await clickText(page, ".actionbar button", "復習を開始");
    await page.waitForSelector(".question");
    assert((await page.$eval(".quiz-count", (el) => el.textContent.trim())) === "1 / 1", "review should have 1 question");
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
    await selectCorrect(page, byId.get(s.questionIds[0]));
    await clickText(page, "#actionbar button", "回答する");
    await clickText(page, "#actionbar button", "結果を見る");
    await page.waitForSelector(".score");
    await go(page, base, "#/review");
    const after = await page.$eval(".stats-row", (el) => el.textContent);
    assert(after.includes("0要復習"), `after review ${after}`);
    await clickText(page, "label.toggle", "正解した問題も含める");
    const hint = await page.$eval(".hint", (el) => el.textContent);
    assert(hint.includes("対象 5 問"), `include-correct should offer 5, got ${hint}`);
  });

  await check("Japanese by default; one-tap switch to English mid-question keeps the answer", async () => {
    const ja = JSON.parse(fs.readFileSync(path.join(root, "data/i18n/ja.json"), "utf8")).questions;
    const q = bank.find((item) => Core.isServable(item) && item.type === "single" && ja[item.id]);
    const d = bank.find((item) => Core.isServable(item) && item.type === "dropdown" && ja[item.id]);
    const wrongIndex = q.options.findIndex((_, i) => !q.answer.includes(i));
    await injectSession(page, base, [q, d], "domain");
    await go(page, base, "#/quiz");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.settings.v1") || "{}").lang || "ja");
    assert(stored === "ja", `default language should be ja, got ${stored}`);
    let stem = await page.$eval(".stem", (el) => [el.textContent, el.lang]);
    assert(stem[1] === "ja" && stem[0] === ja[q.id].stem, `Japanese stem expected, got ${stem}`);
    const jaOption = await page.$eval(`label.choice[data-option="${wrongIndex}"] .choice-text`, (el) => el.textContent);
    assert(jaOption === ja[q.id].options[wrongIndex], "Japanese option text expected");
    await clickChoice(page, wrongIndex);
    await shot(page, "13-ja-question");
    await press(await page.$("#langToggle"));
    stem = await page.$eval(".stem", (el) => [el.textContent, el.lang]);
    assert(stem[1] === "en" && stem[0] === q.stem, "English stem expected after one tap");
    const enOption = await page.$eval(`label.choice[data-option="${wrongIndex}"] .choice-text`, (el) => el.textContent);
    assert(enOption === q.options[wrongIndex], "English option text expected");
    const stillChecked = await page.$eval(`label.choice[data-option="${wrongIndex}"] input`, (el) => el.checked);
    assert(stillChecked, "selection must survive the language switch");
    await noHorizontalOverflow(page, "English question");
    await clickText(page, "#actionbar button", "回答する");
    await page.waitForSelector(".feedback");
    assert((await page.$eval(".verdict", (el) => el.textContent)) === "不正解", "verdict must not depend on language");
    const enFeedback = await page.$eval(".feedback", (el) => el.textContent);
    assert(enFeedback.includes(q.options[q.answer[0]]) && enFeedback.includes(q.explanation), "English feedback expected");
    await press(await page.$("#langToggle"));
    const jaFeedback = await page.$eval(".feedback", (el) => el.textContent);
    const firstLine = ja[q.id].explanation.split(/\n+/)[0];
    assert(jaFeedback.includes(ja[q.id].options[q.answer[0]]) && jaFeedback.includes(firstLine), "Japanese feedback expected");
    assert((await page.$eval(".verdict", (el) => el.textContent)) === "不正解", "verdict unchanged after switching back");
    await noHorizontalOverflow(page, "Japanese feedback");
    await shot(page, "14-ja-feedback");
    // dropdown: Japanese labels, English values; answer survives a switch
    await clickText(page, "#actionbar button", "次へ");
    await page.waitForSelector(".blank select");
    for (let i = 0; i < d.dropdowns.length; i += 1) {
      const selects = await page.$$(".blank select");
      await selects[i].select(d.dropdowns[i].answer);
    }
    await press(await page.$("#langToggle"));
    const values = await page.$$eval(".blank select", (els) => els.map((el) => el.value));
    assert(JSON.stringify(values) === JSON.stringify(d.dropdowns.map((x) => x.answer)), "dropdown answers must survive the switch");
    await press(await page.$("#langToggle"));
    await clickText(page, "#actionbar button", "回答する");
    assert((await page.$eval(".verdict", (el) => el.textContent)) === "正解", "dropdown verdict");
    // the choice persists across reloads
    await press(await page.$("#langToggle"));
    await go(page, base, "#/quiz");
    assert((await page.$eval(".stem", (el) => el.lang)) === "en", "English should persist after reload");
    await press(await page.$("#langToggle"));
    await go(page, base, "#/");
    const lang = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.settings.v1")).lang);
    assert(lang === "ja", "Japanese should be saved again");
    await clickText(page, ".resume button", "破棄");
  });

  await check("multiple-response and dropdown scoring in the UI", async () => {
    const multi = bank.filter((q) => q.type === "multiple" && q.status === "verified").slice(0, 2).map((q) => q.id);
    const drop = bank.filter((q) => q.type === "dropdown" && q.status === "verified").slice(0, 2).map((q) => q.id);
    await injectSession(page, base, [...multi, ...drop].map((id) => byId.get(id)), "domain");
    await go(page, base, "#/quiz");
    const expectations = [
      [multi[0], false, "正解"],
      [multi[1], true, "不正解"],
      [drop[0], false, "正解"],
      [drop[1], true, "不正解"],
    ];
    for (let i = 0; i < expectations.length; i += 1) {
      const [id, wrong, expected] = expectations[i];
      const q = byId.get(id);
      if (q.type === "multiple") {
        await clickChoice(page, q.answer[0]);
        const label = await page.$eval("#actionbar .btn.primary", (b) => [b.disabled, b.textContent]);
        assert(label[0] && label[1].includes("1/2"), `one of two selected should keep submit disabled: ${label}`);
        await clickChoice(page, q.answer[0]);
      }
      await selectCorrect(page, q, { wrong });
      if (i === 2) {
        await noHorizontalOverflow(page, "dropdown");
        await shot(page, "06-dropdown");
      }
      await clickText(page, "#actionbar button", "回答する");
      await page.waitForSelector(".feedback");
      const verdict = await page.$eval(".verdict", (el) => el.textContent);
      assert(verdict === expected, `${id}: expected ${expected}, got ${verdict}`);
      if (i < expectations.length - 1) await clickText(page, "#actionbar button", "次へ");
    }
    await clickText(page, "#actionbar button", "結果を見る");
    await page.waitForSelector(".score");
  });

  await check("every question fits 360px (mock navigation through all questions)", async () => {
    // outdated/ambiguous questions are never served; they are checked on the quality page below
    const servable = bank.filter((q) => Core.isServable(q));
    await injectSession(page, base, servable, "mock");
    await go(page, base, "#/quiz");
    for (let i = 0; i < servable.length; i += 1) {
      await noHorizontalOverflow(page, `question ${i + 1}`);
      const hasCode = await page.$(".code");
      if (hasCode && !fs.existsSync(path.join(SCREENSHOTS || ".", "07-code.png")) && SCREENSHOTS) await shot(page, "07-code");
      if (i < servable.length - 1) {
        await clickText(page, "#actionbar button", "次へ");
        await page.waitForFunction((n) => document.querySelector(".quiz-count")?.textContent.trim().startsWith(`${n} /`), {}, i + 2);
      }
    }
    await go(page, base, "#/");
    await clickText(page, ".resume button", "破棄");
  });

  await check("mock exam: 50 random questions, scoring, domain breakdown, missed questions", async () => {
    await go(page, base, "#/mock");
    await noHorizontalOverflow(page, "mock setup");
    await clickText(page, ".actionbar button", "模擬試験を開始");
    await page.waitForSelector(".question");
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.session.v1")));
    assert(s.questionIds.length === 50 && new Set(s.questionIds).size === 50, "mock must have 50 unique questions");
    const perDomain = {};
    s.questionIds.forEach((id) => {
      perDomain[byId.get(id).domain] = (perDomain[byId.get(id).domain] || 0) + 1;
    });
    assert(JSON.stringify(perDomain) !== "{}" && perDomain.genai === 17 && perDomain.plan === 14, `domain mix ${JSON.stringify(perDomain)}`);
    assert(s.questionIds.every((id) => byId.get(id).status === "verified"), "mock should only use verified questions by default");
    // answer first 10: 7 correct + 3 wrong, leave the rest unanswered
    for (let i = 0; i < 10; i += 1) {
      await selectCorrect(page, byId.get(s.questionIds[i]), { wrong: i < 3 });
      const feedback = await page.$(".feedback");
      assert(!feedback, "mock must not show feedback before scoring");
      await clickText(page, "#actionbar button", "次へ");
      await page.waitForFunction((n) => document.querySelector(".quiz-count")?.textContent.trim().startsWith(`${n} /`), {}, i + 2);
    }
    await shot(page, "08-mock");
    await clickText(page, ".quiz-head button", "採点する");
    await page.waitForSelector(".score");
    const score = await page.$eval(".score", (el) => el.textContent);
    assert(score.includes("7 / 50") && score.includes("未回答 40"), `score ${score}`);
    const bars = await page.$$eval(".bar-row", (rows) => rows.length);
    assert(bars === 5, "domain breakdown should list 5 domains");
    const missed = await page.$$eval(".review-item", (items) => items.length);
    assert(missed === 43, `missed list should have 43 items, has ${missed}`);
    await press(await page.$(".review-item summary"));
    const detail = await page.$eval(".review-item[open]", (el) => el.textContent);
    assert(detail.includes("あなたの回答") && detail.includes("正解"), "missed item should show both answers");
    await noHorizontalOverflow(page, "mock result");
    await shot(page, "09-mock-result");
  });

  await check("history persists across reloads and can be reset", async () => {
    await go(page, base, "#/history");
    const stats = await page.$eval(".stats-row", (el) => el.textContent);
    assert(!/(^|\D)0回答回数/.test(stats), `history should not be empty: ${stats}`);
    const sessions = await page.$$eval(".list a", (as) => as.length);
    assert(sessions >= 3, `expected sessions, got ${sessions}`);
    await noHorizontalOverflow(page, "history");
    await shot(page, "10-history");
    await page.reload({ waitUntil: "networkidle0" });
    const again = await page.$eval(".stats-row", (el) => el.textContent);
    assert(again === stats, "history changed after reload");
    await clickText(page, ".danger-zone button", "学習履歴をリセット");
    await page.waitForFunction(() => /(^|\D)0回答回数/.test(document.querySelector(".stats-row")?.textContent || ""));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai103.history.v1")));
    assert(stored.log.length === 0 && Object.keys(stored.questions).length === 0, "history not cleared");
  });

  await check("quality page and glossary render without overflow", async () => {
    await go(page, base, "#/quality");
    const text = await page.$eval("#app", (el) => el.textContent);
    assert(text.includes(`${bank.length}問`) && text.includes("カバレッジ不足"), "quality summary missing");
    await page.$$eval("details", (ds) => ds.forEach((d) => (d.open = true)));
    await noHorizontalOverflow(page, "quality (all questions expanded)");
    await shot(page, "11-quality");
    await go(page, base, "#/glossary");
    const terms = await page.$$eval(".term", (els) => els.length);
    assert(terms > 10, "glossary should list terms");
    await noHorizontalOverflow(page, "glossary");
  });

  await check("PWA: manifest, icons and service worker (installable, offline)", async () => {
    await go(page, base, "#/");
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const m = await (await fetch(href)).json();
      const icons = await Promise.all(m.icons.map(async (i) => [i.sizes, i.purpose, (await fetch(new URL(i.src, href))).status]));
      return { m, icons, href };
    });
    assert(manifest.m.display === "standalone" && manifest.m.start_url === "./" && manifest.m.scope === "./", "manifest fields");
    assert(manifest.icons.some(([s, , st]) => s === "192x192" && st === 200) && manifest.icons.some(([s, , st]) => s === "512x512" && st === 200), "icons");
    const sw = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
      return reg ? { scope: reg.scope, active: Boolean(reg.active) } : null;
    });
    assert(sw && sw.active && sw.scope === new URL(".", manifest.href).href, `service worker ${JSON.stringify(sw)}`);
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(500);
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    assert(controlled, "page should be controlled by the service worker");
    // Chrome's own installability check
    const cdp = await page.createCDPSession();
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    assert(installabilityErrors.length === 0, `installability errors: ${JSON.stringify(installabilityErrors)}`);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tile", { timeout: 10000 });
    await page.setOfflineMode(false);
  });

  touch = false;
  await page.setViewport({ width: 1280, height: 800 });
  await check("desktop layout", async () => {
    await go(page, base, "#/");
    await noHorizontalOverflow(page, "desktop home");
    await shot(page, "12-desktop");
  });

  await browser.close();
  if (server) server.close();
  const failed = results.filter(([, r]) => r !== "ok");
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    failed.forEach(([n, r]) => console.log(`FAILED: ${n}: ${r}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
