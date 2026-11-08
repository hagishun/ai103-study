/* AI-103 study site UI. Vanilla JS, no build step. Learning data stays in localStorage. */
(function () {
  "use strict";

  const Core = window.Core;
  const REPO_URL = "https://github.com/hagishun/ai103-study";
  const STORAGE = {
    session: "ai103.session.v1",
    history: "ai103.history.v1",
    settings: "ai103.settings.v1",
  };
  const MOCK_SIZE = 50;
  const STUDY_SIZES = [10, 20, 50];
  const STATUS_LABELS = {
    verified: "検証済み",
    unverified: "未検証",
    outdated: "古い仕様",
    ambiguous: "曖昧",
    out_of_scope: "範囲外",
  };
  const STATUS_DESCRIPTIONS = {
    verified: "公式ドキュメントで正答を確認済み",
    unverified: "公式ドキュメントでの確認が済んでいない",
    outdated: "古い API・製品仕様を使用している",
    ambiguous: "設問や正答に曖昧さがある",
    out_of_scope: "現行の試験範囲外",
  };
  const TYPE_LABELS = { single: "単一選択", multiple: "複数選択", dropdown: "空欄選択" };
  const TRANSLATION_LABELS = { untranslated: "未翻訳", needs_review: "訳: 要確認", reviewed: "訳: 確認済み" };
  const TRANSLATION_DESCRIPTIONS = {
    untranslated: "日本語訳がありません（英語原文を表示）",
    needs_review: "AI による翻訳と自動チェックのみ。人による確認は済んでいません",
    reviewed: "人が英語原文と照合して確認済み",
  };
  const MODE_LABELS = { domain: "分野別学習", mock: "模擬試験", review: "復習" };

  const state = {
    bank: [],
    byId: new Map(),
    domains: [],
    domainById: new Map(),
    domainsDoc: null,
    stats: null,
    glossary: null,
    history: null,
    settings: { pool: "verified", lang: "ja" },
    ja: {},
    session: null,
    timerId: null,
    lastTick: 0,
    ticksSinceSave: 0,
  };

  const app = document.getElementById("app");
  const topbarStatus = document.getElementById("topbarStatus");

  // ---------- storage ----------
  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      showToast("ブラウザに保存できませんでした（プライベートモードや容量不足の可能性があります）");
      return false;
    }
  }

  function removeStore(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      /* ignore */
    }
  }

  /** `touch` marks real progress; background saves (load, tab hidden) keep the last-activity time. */
  function saveSession(touch = true) {
    if (!state.session) return;
    if (touch) state.session.updatedAt = Date.now();
    writeStore(STORAGE.session, state.session);
  }

  function clearSession() {
    stopTimer();
    state.session = null;
    removeStore(STORAGE.session);
  }

  function saveHistory() {
    writeStore(STORAGE.history, state.history);
  }

  /** Re-read stored history before changing it so another open tab's answers are not overwritten. */
  function updateHistory(change) {
    state.history = Core.sanitizeHistory(readStore(STORAGE.history));
    change(state.history);
    saveHistory();
  }

  function saveSettings() {
    writeStore(STORAGE.settings, state.settings);
  }

  // ---------- DOM helpers ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    });
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return el;
  }

  function render(...nodes) {
    app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  }

  function showToast(message) {
    const toast = h("div", { class: "toast", role: "status" }, message);
    document.body.append(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function domainLabel(id) {
    const d = state.domainById.get(id);
    return d ? d.shortJa : id;
  }

  function translationBadge(q) {
    const status = translationStatus(q);
    return h("span", { class: `badge tr-${status}`, title: TRANSLATION_DESCRIPTIONS[status] }, TRANSLATION_LABELS[status]);
  }

  function statusBadge(status) {
    return h("span", { class: `badge status-${status}`, title: STATUS_DESCRIPTIONS[status] }, STATUS_LABELS[status] || status);
  }

  function learnSearchUrl(q) {
    return `https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(`${q.topic} Azure`)}`;
  }

  // ---------- question language (UI labels stay Japanese; question content switches) ----------
  function isJa() {
    return state.settings.lang !== "en";
  }

  function tr(q) {
    const item = isJa() ? state.ja[q.id] : null;
    return item && item.status !== "untranslated" ? item : null;
  }

  function translationStatus(q) {
    const item = state.ja[q.id];
    return item ? item.status || "needs_review" : "untranslated";
  }

  function qLang(q) {
    return tr(q) ? "ja" : "en";
  }

  function stemText(q) {
    const t = tr(q);
    return t ? t.stem : q.stem;
  }

  function optionText(q, index) {
    const t = tr(q);
    return t && t.options && t.options[index] ? t.options[index] : q.options[index];
  }

  function choiceText(q, dropId, choice) {
    const t = tr(q);
    const d = q.dropdowns.find((item) => item.id === dropId);
    const td = t && t.dropdowns && t.dropdowns[dropId];
    const index = d ? d.choices.indexOf(choice) : -1;
    return td && td.choices && index >= 0 && td.choices[index] ? td.choices[index] : choice;
  }

  function paragraphs(text, lang) {
    return String(text)
      .split(/\n+/)
      .filter((line) => line.trim())
      .map((line) => h("p", { lang }, line));
  }

  function langToggle() {
    const button = document.getElementById("langToggle");
    if (!button) return;
    const ja = isJa();
    button.setAttribute("aria-pressed", String(!ja));
    button.querySelector(".lang-ja").classList.toggle("is-on", ja);
    button.querySelector(".lang-en").classList.toggle("is-on", !ja);
    button.title = ja ? "問題・選択肢・解説を英語原文で表示" : "問題・選択肢・解説を日本語訳で表示";
  }

  function switchLanguage() {
    state.settings.lang = isJa() ? "en" : "ja";
    saveSettings();
    langToggle();
    const y = window.scrollY;
    if (location.hash.startsWith("#/quiz")) renderQuiz(false);
    else route();
    window.scrollTo(0, y);
  }

  function pageHeader(title, lead) {
    return h("div", { class: "page-head" }, h("h1", null, title), lead ? h("p", { class: "lead" }, lead) : null);
  }

  function backLink() {
    return h("a", { class: "back-link", href: "#/" }, "← ホーム");
  }

  function poolLabel(pool) {
    return pool === "all" ? "検証済み＋未検証" : "検証済みのみ";
  }

  // ---------- routing ----------
  function route() {
    stopTimer();
    const hash = location.hash.replace(/^#\/?/, "");
    const [name, param] = hash.split("/");
    topbarStatus.textContent = "";
    switch (name) {
      case "":
        renderHome();
        break;
      case "study":
        renderStudySetup();
        break;
      case "mock":
        renderMockSetup();
        break;
      case "review":
        renderReviewSetup();
        break;
      case "quiz":
        renderQuiz(true);
        break;
      case "result":
        renderResult(param);
        break;
      case "history":
        renderHistory();
        break;
      case "quality":
        renderQuality();
        break;
      case "glossary":
        renderGlossary();
        break;
      default:
        renderHome();
    }
    app.focus({ preventScroll: true });
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  // ---------- home ----------
  function poolSelector(onChange) {
    const counts = {
      verified: Core.filterPool(state.bank, { pool: "verified" }).length,
      all: Core.filterPool(state.bank, { pool: "all" }).length,
    };
    const option = (value, label, note) =>
      h(
        "label",
        { class: "segment" },
        h("input", {
          type: "radio",
          name: "pool",
          value,
          checked: state.settings.pool === value,
          onchange: () => {
            state.settings.pool = value;
            saveSettings();
            if (onChange) onChange();
          },
        }),
        h("span", null, label, h("small", null, note)),
      );
    return h(
      "fieldset",
      { class: "pool" },
      h("legend", null, "出題する問題"),
      h(
        "div",
        { class: "segments" },
        option("verified", "検証済みのみ（推奨）", `${counts.verified}問`),
        option("all", "未検証も含める", `${counts.all}問`),
      ),
      h(
        "p",
        { class: "hint" },
        "未検証の問題は、公式ドキュメントで正答を確認できていない問題です。出題時に「未検証」と表示します。古い仕様・曖昧・範囲外の問題は出題せず、「問題データ」で確認できます。",
        counts.all === counts.verified ? "（現在、未検証の問題はありません）" : "",
      ),
    );
  }

  function resumeCard() {
    const s = state.session;
    if (!s) return null;
    const answered = s.questionIds.filter((id) => {
      const a = s.answers[id];
      const q = state.byId.get(id);
      return q && a && (s.mode === "mock" ? Core.isAnswerComplete(q, a) : a.submitted);
    }).length;
    return h(
      "section",
      { class: "card resume", "aria-label": "途中のセッション" },
      h("h2", null, "前回の続き"),
      h("p", null, h("strong", null, s.title), h("br"), `${answered} / ${s.questionIds.length} 問回答済み・最終更新 ${formatDate(s.updatedAt)}`),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn primary", type: "button", onclick: () => go("#/quiz") }, "続きから再開"),
        h(
          "button",
          {
            class: "btn ghost",
            type: "button",
            onclick: () => {
              if (confirm("途中のセッションを破棄しますか？（回答済みの学習履歴は残ります）")) {
                clearSession();
                renderHome();
              }
            },
          },
          "破棄",
        ),
      ),
    );
  }

  function renderHome() {
    const summary = Core.historySummary(state.history, state.byId, state.domains);
    const tile = (href, title, desc, extra) =>
      h("a", { class: "tile", href }, h("span", { class: "tile-title" }, title), h("span", { class: "tile-desc" }, desc), extra || null);
    render(
      h(
        "div",
        { class: "home" },
        resumeCard(),
        h(
          "nav",
          { class: "tiles", "aria-label": "学習メニュー" },
          tile("#/study", "分野別学習", "分野を選んで 10・20・50 問。1問ごとに正誤と解説"),
          tile("#/mock", "模擬試験", `${MOCK_SIZE}問をランダム出題し、最後に採点`),
          tile(
            "#/review",
            "復習",
            "間違えた問題を再出題",
            summary.wrongNow ? h("span", { class: "count-badge" }, `${summary.wrongNow}問`) : null,
          ),
          tile("#/history", "学習履歴", `回答 ${summary.attempts} 回・正答率 ${Core.percent(summary.correct, summary.attempts)}%`),
          tile("#/quality", "問題データ", "重複除去・品質状態・分野カバレッジ"),
          state.glossary ? tile("#/glossary", "用語集", "製品名・役割・公式リンク") : null,
        ),
        poolSelector(() => renderHome()),
        disclaimer(),
      ),
    );
  }

  function disclaimer() {
    return h(
      "footer",
      { class: "disclaimer" },
      h("p", null, "Microsoft 非公式の学習教材です。問題・解説の正確性は保証しません。試験前に必ず ", h("a", { href: state.domainsDoc.studyGuideUrl, target: "_blank", rel: "noopener" }, "公式 Study guide"), " と Microsoft Learn で確認してください。"),
      h(
        "p",
        null,
        "問題データの出典: ",
        h("a", { href: "https://github.com/pvejayan/ai103-exam-simulator", target: "_blank", rel: "noopener" }, "pvejayan/ai103-exam-simulator"),
        "（MIT License, © 2026 Praba Vejayan）。",
        h("a", { href: `${REPO_URL}/blob/main/LICENSE`, target: "_blank", rel: "noopener" }, "ライセンス"),
        "・",
        h("a", { href: REPO_URL, target: "_blank", rel: "noopener" }, "ソースコード"),
      ),
      h("p", null, "学習履歴はこの端末のブラウザ（localStorage）にだけ保存し、外部へ送信しません。"),
    );
  }

  function confirmReplaceSession() {
    if (!state.session) return true;
    return confirm(`途中の「${state.session.title}」を破棄して、新しく始めますか？`);
  }

  function startSession(session) {
    state.session = session;
    saveSession();
    go("#/quiz");
  }

  // ---------- study setup ----------
  function sizeSelector(name, sizes, selected, available, onChange) {
    return h(
      "div",
      { class: "segments sizes" },
      sizes.map((size) =>
        h(
          "label",
          { class: "segment" },
          h("input", { type: "radio", name, value: String(size), checked: selected === size, onchange: () => onChange(size) }),
          h("span", null, size === Infinity ? "すべて" : `${size}問`, size !== Infinity && available < size ? h("small", null, `全${available}問`) : null),
        ),
      ),
    );
  }

  function renderStudySetup() {
    const pool = state.settings.pool;
    let domain = state.settings.lastDomain && state.domainById.has(state.settings.lastDomain) ? state.settings.lastDomain : state.domains[0].id;
    let size = STUDY_SIZES.includes(state.settings.studySize) ? state.settings.studySize : 10;

    const draw = () => {
      const available = Core.filterPool(state.bank, { pool, domain }).length;
      render(
        backLink(),
        pageHeader("分野別学習", "分野を選んでランダムに出題します。1問ごとに正誤と解説を表示します。"),
        h(
          "fieldset",
          { class: "choices-list" },
          h("legend", null, "分野"),
          state.domains.map((d) => {
            const count = Core.filterPool(state.bank, { pool, domain: d.id }).length;
            const allCount = Core.filterPool(state.bank, { pool: "all", domain: d.id }).length;
            return h(
              "label",
              { class: `pick${count === 0 ? " is-disabled" : ""}` },
              h("input", {
                type: "radio",
                name: "domain",
                value: d.id,
                checked: domain === d.id,
                disabled: count === 0,
                onchange: () => {
                  domain = d.id;
                  draw();
                },
              }),
              h(
                "span",
                { class: "pick-body" },
                h("span", { class: "pick-title" }, d.nameJa),
                h("span", { class: "pick-meta" }, `配点 ${d.weight}・${count}問`, count === 0 ? h("span", { class: "warn" }, allCount ? `（未検証を含めると${allCount}問）` : "（カバレッジ不足）") : null),
              ),
            );
          }),
        ),
        h(
          "fieldset",
          null,
          h("legend", null, "問題数"),
          sizeSelector("size", STUDY_SIZES, size, available, (value) => {
            size = value;
            draw();
          }),
        ),
        h("p", { class: "hint" }, `出題: ${poolLabel(pool)}（ホーム画面で切り替え）`),
        h(
          "div",
          { class: "actionbar" },
          h(
            "button",
            {
              class: "btn primary block",
              type: "button",
              disabled: available === 0,
              onclick: () => {
                if (!confirmReplaceSession()) return;
                state.settings.lastDomain = domain;
                state.settings.studySize = size;
                saveSettings();
                const questions = Core.shuffle(Core.filterPool(state.bank, { pool, domain })).slice(0, size);
                startSession(
                  Core.createSession({
                    mode: "domain",
                    title: `分野別学習：${domainLabel(domain)}`,
                    questions,
                    settings: { pool, domain },
                  }),
                );
              },
            },
            `${Math.min(size, available)}問で開始`,
          ),
        ),
      );
    };
    draw();
  }

  // ---------- mock setup ----------
  function renderMockSetup() {
    const pool = state.settings.pool;
    const candidates = Core.filterPool(state.bank, { pool });
    let minutes = Number.isFinite(state.settings.mockMinutes) ? state.settings.mockMinutes : 0;
    const quota = Core.allocateByWeight(state.domains, MOCK_SIZE);
    const draw = () => {
      render(
        backLink(),
        pageHeader("模擬試験", `${MOCK_SIZE}問をランダムに出題し、最後にまとめて採点します。分野の比率は公式の配点に合わせます。`),
        h(
          "div",
          { class: "card" },
          h("h2", null, "出題の内訳（目安）"),
          h(
            "ul",
            { class: "plain" },
            state.domains.map((d) => {
              const have = candidates.filter((q) => q.domain === d.id).length;
              return h("li", null, `${d.shortJa}（${d.weight}）: ${quota[d.id]}問`, have < quota[d.id] ? h("span", { class: "warn" }, ` 対象の問題が${have}問のため不足分は他分野から補います`) : null);
            }),
          ),
          candidates.length < MOCK_SIZE ? h("p", { class: "warn" }, `対象の問題が${candidates.length}問しかないため、${candidates.length}問で実施します。`) : null,
          h("p", { class: "hint" }, `出題: ${poolLabel(pool)}（ホーム画面で切り替え）`),
        ),
        h(
          "fieldset",
          null,
          h("legend", null, "制限時間"),
          h(
            "div",
            { class: "segments" },
            [
              [0, "なし"],
              [100, "100分"],
            ].map(([value, label]) =>
              h(
                "label",
                { class: "segment" },
                h("input", {
                  type: "radio",
                  name: "minutes",
                  value: String(value),
                  checked: minutes === value,
                  onchange: () => {
                    minutes = value;
                    draw();
                  },
                }),
                h("span", null, label),
              ),
            ),
          ),
          h("p", { class: "hint" }, "途中で閉じた場合、閉じている間は時間を数えません。"),
        ),
        h(
          "p",
          { class: "note" },
          "この問題集は誤答の選択肢が易しいものが多く、正答率は実力より高く出やすい傾向があります。本番の合否予測には使わず、弱い分野の把握に使ってください。",
        ),
        h(
          "div",
          { class: "actionbar" },
          h(
            "button",
            {
              class: "btn primary block",
              type: "button",
              disabled: candidates.length === 0,
              onclick: () => {
                if (!confirmReplaceSession()) return;
                state.settings.mockMinutes = minutes;
                saveSettings();
                const questions = Core.pickMock(candidates, state.domains, MOCK_SIZE);
                startSession(
                  Core.createSession({
                    mode: "mock",
                    title: `模擬試験（${questions.length}問）`,
                    questions,
                    timeLimitSec: minutes * 60,
                    settings: { pool },
                  }),
                );
              },
            },
            "模擬試験を開始",
          ),
        ),
      );
    };
    draw();
  }

  // ---------- review setup ----------
  function renderReviewSetup() {
    let includeCorrect = Boolean(state.settings.reviewIncludeCorrect);
    let domain = null;
    let size = state.settings.reviewSize || 20;
    const draw = () => {
      const candidates = Core.reviewCandidates(state.history, state.byId, { includeCorrect, domain });
      const wrongCount = Core.reviewCandidates(state.history, state.byId, {}).length;
      const answeredCount = Core.reviewCandidates(state.history, state.byId, { includeCorrect: true }).length;
      render(
        backLink(),
        pageHeader("復習", "直近の回答が不正解だった問題を再出題します。正解した問題を含めることもできます。"),
        h(
          "div",
          { class: "card stats-row" },
          h("div", null, h("strong", null, wrongCount), h("span", null, "要復習")),
          h("div", null, h("strong", null, answeredCount), h("span", null, "回答済み")),
        ),
        h(
          "label",
          { class: "toggle" },
          h("input", {
            type: "checkbox",
            checked: includeCorrect,
            onchange: (event) => {
              includeCorrect = event.target.checked;
              state.settings.reviewIncludeCorrect = includeCorrect;
              saveSettings();
              draw();
            },
          }),
          h("span", null, "正解した問題も含める"),
        ),
        h(
          "fieldset",
          null,
          h("legend", null, "分野"),
          h(
            "select",
            {
              class: "select",
              onchange: (event) => {
                domain = event.target.value || null;
                draw();
              },
            },
            h("option", { value: "", selected: !domain }, "すべての分野"),
            state.domains.map((d) => h("option", { value: d.id, selected: domain === d.id }, d.nameJa)),
          ),
        ),
        h(
          "fieldset",
          null,
          h("legend", null, "問題数"),
          sizeSelector("rsize", [10, 20, 50, Infinity], size, candidates.length, (value) => {
            size = value;
            state.settings.reviewSize = value === Infinity ? null : value;
            saveSettings();
            draw();
          }),
        ),
        candidates.length === 0
          ? h("p", { class: "empty" }, wrongCount === 0 && answeredCount === 0 ? "まだ回答履歴がありません。分野別学習か模擬試験から始めましょう。" : "条件に合う問題はありません。")
          : h("p", { class: "hint" }, `対象 ${candidates.length} 問（新しく回答した順）から${size === Infinity ? "すべて" : `最大${size}問`}をランダムな順で出題します。`),
        h(
          "div",
          { class: "actionbar" },
          h(
            "button",
            {
              class: "btn primary block",
              type: "button",
              disabled: candidates.length === 0,
              onclick: () => {
                if (!confirmReplaceSession()) return;
                const questions = Core.shuffle(candidates.slice(0, size === Infinity ? candidates.length : size));
                startSession(
                  Core.createSession({
                    mode: "review",
                    title: includeCorrect ? "復習（回答済みの問題）" : "復習（間違えた問題）",
                    questions,
                    settings: { pool: "history", domain },
                  }),
                );
              },
            },
            "復習を開始",
          ),
        ),
      );
    };
    draw();
  }

  function startReviewOf(ids, title) {
    const questions = ids.map((id) => state.byId.get(id)).filter(Boolean);
    if (!questions.length || !confirmReplaceSession()) return;
    startSession(Core.createSession({ mode: "review", title, questions: Core.shuffle(questions), settings: { pool: "history" } }));
  }

  // ---------- quiz ----------
  function currentQuestion() {
    const s = state.session;
    return state.byId.get(s.questionIds[s.current]);
  }

  function answerOf(q) {
    const s = state.session;
    if (!s.answers[q.id]) s.answers[q.id] = { selected: [], dropdowns: {}, submitted: false };
    return s.answers[q.id];
  }

  function blankLabel(dropId) {
    const n = String(dropId).replace(/\D+/g, "");
    return `空欄${n || dropId}`;
  }

  function fillBlanks(text) {
    return String(text).replace(/\[\[(drop\d+)\]\]/g, (_, id) => `［${blankLabel(id)}］`);
  }

  function optionLetter(position) {
    return String.fromCharCode(65 + position);
  }

  function renderQuiz(scrollTop) {
    const s = state.session;
    if (!s) {
      render(backLink(), pageHeader("進行中のセッションはありません"), h("p", null, h("a", { href: "#/" }, "ホームに戻る")));
      return;
    }
    const q = currentQuestion();
    const answer = answerOf(q);
    const isMock = s.mode === "mock";
    const locked = !isMock && answer.submitted;
    const total = s.questionIds.length;
    const flagged = s.flagged.includes(q.id);

    const head = h(
      "div",
      { class: "quiz-head" },
      h(
        "div",
        { class: "quiz-head-row" },
        h("span", { class: "quiz-title" }, s.title),
        h(
          "button",
          {
            class: "btn small ghost",
            type: "button",
            onclick: () => {
              saveSession();
              go("#/");
            },
          },
          "中断",
        ),
      ),
      h(
        "div",
        { class: "quiz-head-row" },
        h("span", { class: "quiz-count" }, `${s.current + 1} / ${total}`),
        isMock && s.timeLimitSec ? h("span", { id: "timer", class: "timer" }, formatDuration(s.timeLimitSec - s.elapsedSec)) : null,
        h(
          "button",
          {
            class: "btn small ghost",
            type: "button",
            onclick: () => {
              const msg = isMock ? mockFinishMessage() : "ここで終了して、回答した問題だけで結果を表示しますか？";
              if (confirm(msg)) finishSession();
            },
          },
          isMock ? "採点する" : "終了",
        ),
      ),
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(s.current + 1) }, h("span", { style: `width:${((s.current + 1) / total) * 100}%` })),
    );

    const meta = h(
      "div",
      { class: "q-meta" },
      h("span", { class: "badge domain" }, domainLabel(q.domain)),
      statusBadge(q.status),
      h("span", { class: "badge type" }, q.type === "multiple" ? `${q.answer.length}つ選択` : TYPE_LABELS[q.type]),
      isJa() ? translationBadge(q) : null,
      h("span", { class: "qid" }, q.id),
      isMock
        ? h(
            "button",
            {
              class: `btn small flag${flagged ? " is-on" : ""}`,
              type: "button",
              "aria-pressed": String(flagged),
              onclick: () => {
                s.flagged = flagged ? s.flagged.filter((id) => id !== q.id) : [...s.flagged, q.id];
                saveSession();
                renderQuiz(false);
              },
            },
            flagged ? "★ 見直し" : "☆ 見直し",
          )
        : null,
    );

    const stemNodes = [h("p", { class: "stem", lang: qLang(q) }, q.type === "dropdown" ? fillBlanks(stemText(q)) : stemText(q))];
    if (q.code) stemNodes.push(h("pre", { class: "code", lang: "en" }, h("code", null, q.type === "dropdown" ? fillBlanks(q.code) : q.code)));

    const body = q.type === "dropdown" ? renderDropdownInputs(q, answer, locked) : renderOptionInputs(q, answer, locked);
    const feedback = locked ? renderFeedback(q, answer) : null;
    const nav = isMock ? renderMockNav() : null;

    render(h("section", { class: "quiz" }, head, h("article", { class: "question" }, meta, stemNodes, body, feedback), nav, renderActionBar(q, answer)));
    if (scrollTop) window.scrollTo(0, 0);
    if (isMock && s.timeLimitSec) startTimer();
  }

  function mockFinishMessage() {
    const s = state.session;
    const unanswered = s.questionIds.filter((id) => !Core.isAnswerComplete(state.byId.get(id), s.answers[id])).length;
    return unanswered ? `未回答が${unanswered}問あります（不正解として採点）。採点しますか？` : "採点しますか？";
  }

  function onAnswerChanged(q, answer) {
    saveSession();
    const bar = document.getElementById("actionbar");
    if (bar) bar.replaceWith(renderActionBar(q, answer));
    if (state.session.mode === "mock") {
      const navButton = document.querySelector(`.qnav [data-index="${state.session.current}"]`);
      if (navButton) navButton.classList.toggle("answered", Core.isAnswerComplete(q, answer));
    }
  }

  function renderOptionInputs(q, answer, locked) {
    const s = state.session;
    const order = s.order[q.id];
    const multi = q.type === "multiple";
    const correctSet = new Set(q.answer);
    return h(
      "div",
      { class: "choices", role: multi ? "group" : "radiogroup", "aria-label": "選択肢" },
      order.map((optionIndex, position) => {
        const selected = answer.selected.includes(optionIndex);
        let cls = "choice";
        if (locked && correctSet.has(optionIndex)) cls += " is-correct";
        if (locked && selected && !correctSet.has(optionIndex)) cls += " is-wrong";
        const input = h("input", {
          type: multi ? "checkbox" : "radio",
          name: `q-${q.id}`,
          value: String(optionIndex),
          checked: selected,
          disabled: locked,
          onchange: (event) => {
            if (multi) {
              const set = new Set(answer.selected);
              if (event.target.checked) set.add(optionIndex);
              else set.delete(optionIndex);
              answer.selected = [...set];
            } else {
              answer.selected = [optionIndex];
            }
            onAnswerChanged(q, answer);
          },
        });
        return h(
          "label",
          { class: cls, "data-option": String(optionIndex) },
          input,
          h("span", { class: "choice-letter", "aria-hidden": "true" }, optionLetter(position)),
          h("span", { class: "choice-text", lang: qLang(q) }, optionText(q, optionIndex)),
          locked && correctSet.has(optionIndex) ? h("span", { class: "choice-mark", "aria-label": "正解" }, "✓") : null,
          locked && selected && !correctSet.has(optionIndex) ? h("span", { class: "choice-mark", "aria-label": "あなたの回答" }, "✗") : null,
        );
      }),
    );
  }

  function renderDropdownInputs(q, answer, locked) {
    const s = state.session;
    return h(
      "div",
      { class: "blanks" },
      q.dropdowns.map((d) => {
        const value = answer.dropdowns[d.id] || "";
        const ok = value === d.answer;
        return h(
          "label",
          { class: `blank${locked ? (ok ? " is-correct" : " is-wrong") : ""}` },
          h("span", { class: "blank-label" }, blankLabel(d.id)),
          h(
            "select",
            {
              class: "select",
              disabled: locked,
              lang: qLang(q),
              onchange: (event) => {
                answer.dropdowns = { ...answer.dropdowns, [d.id]: event.target.value };
                onAnswerChanged(q, answer);
              },
            },
            h("option", { value: "", selected: !value }, "選択してください"),
            s.order[q.id][d.id].map((choice) => h("option", { value: choice, selected: value === choice }, choiceText(q, d.id, choice))),
          ),
          locked && !ok ? h("span", { class: "blank-answer" }, "正解: ", h("span", { lang: qLang(q) }, choiceText(q, d.id, d.answer))) : null,
        );
      }),
    );
  }

  function correctAnswerText(q, order) {
    if (q.type === "dropdown") return q.dropdowns.map((d) => `${blankLabel(d.id)}: ${choiceText(q, d.id, d.answer)}`).join(" / ");
    return q.answer
      .map((i) => (order ? `${optionLetter(order.indexOf(i))}. ${optionText(q, i)}` : optionText(q, i)))
      .sort()
      .join(" / ");
  }

  function linkLabel(url) {
    return url.replace(/^https:\/\/learn\.microsoft\.com\/(en-us|ja-jp)\//, (_, locale) => (locale === "ja-jp" ? "Learn（日本語）: " : "Learn: "));
  }

  function evidenceLinks(q) {
    const t = tr(q);
    const urls = t && t.references && t.references.length ? t.references : q.evidence || [];
    if (urls.length) {
      return h(
        "div",
        { class: "links" },
        h("h4", null, "公式ドキュメント"),
        h(
          "ul",
          null,
          urls.map((url) => h("li", null, h("a", { href: url, target: "_blank", rel: "noopener" }, linkLabel(url)))),
        ),
      );
    }
    return h(
      "div",
      { class: "links" },
      h("h4", null, "公式ドキュメント"),
      h("p", null, "この問題には確認済みの根拠 URL がありません。", h("a", { href: learnSearchUrl(q), target: "_blank", rel: "noopener" }, "Microsoft Learn で検索")),
    );
  }

  function explanationBlock(q) {
    const nodes = [];
    const t = tr(q);
    if (t) {
      nodes.push(h("h4", null, "解説"), paragraphs(t.explanation, "ja"));
      if (q.type === "dropdown") {
        nodes.push(
          h(
            "ul",
            { class: "plain" },
            q.dropdowns.map((d) => {
              const td = t.dropdowns && t.dropdowns[d.id];
              return td && td.explanation ? h("li", null, `${blankLabel(d.id)}: ${td.explanation}`) : null;
            }),
          ),
        );
      }
      if (t.terms && t.terms.length) {
        nodes.push(h("h4", null, "用語メモ"), h("ul", { class: "plain terms" }, t.terms.map((term) => h("li", null, h("b", { lang: "en" }, term.term), `: ${term.note}`))));
      }
      nodes.push(
        h(
          "details",
          { class: "original" },
          h("summary", null, "英語原文の解説（English）"),
          h("p", { lang: "en" }, q.explanation),
          q.type === "dropdown" ? h("ul", { class: "plain" }, q.dropdowns.filter((d) => d.explanation).map((d) => h("li", { lang: "en" }, `${d.id}: ${d.explanation}`))) : null,
        ),
      );
      if (translationStatus(q) !== "reviewed") {
        nodes.push(h("p", { class: "hint" }, `日本語訳・解説は AI が作成し、人による確認は済んでいません（${TRANSLATION_LABELS[translationStatus(q)]}）。迷ったら「EN」で英語原文を確認してください。`));
      }
    } else {
      nodes.push(h("h4", null, "解説（英語原文）"), h("p", { lang: "en" }, q.explanation));
      if (q.type === "dropdown") {
        nodes.push(h("ul", { class: "plain" }, q.dropdowns.filter((d) => d.explanation).map((d) => h("li", null, `${blankLabel(d.id)}: `, h("span", { lang: "en" }, d.explanation)))));
      }
      if (isJa() && q.explanationJa) {
        nodes.push(h("h4", null, "日本語の要約（品質レビュー時に作成）"), h("p", null, q.explanationJa));
      }
    }
    if (q.notes) nodes.push(h("p", { class: "note" }, `レビューメモ: ${q.notes}`));
    if (q.status !== "verified") nodes.push(h("p", { class: "warn" }, `この問題は「${STATUS_LABELS[q.status]}」です（${STATUS_DESCRIPTIONS[q.status]}）。公式ドキュメントで確認してください。`));
    return nodes;
  }

  function renderFeedback(q, answer) {
    const ok = Core.isCorrect(q, answer);
    return h(
      "section",
      { class: `feedback ${ok ? "ok" : "ng"}`, "aria-live": "polite" },
      h("p", { class: "verdict" }, ok ? "正解" : "不正解"),
      ok ? null : h("p", { class: "correct-answer" }, "正解: ", h("span", { lang: qLang(q) }, correctAnswerText(q, state.session.order[q.id]))),
      explanationBlock(q),
      evidenceLinks(q),
    );
  }

  function renderMockNav() {
    const s = state.session;
    return h(
      "details",
      { class: "qnav-wrap" },
      h("summary", null, `問題一覧（回答 ${s.questionIds.filter((id) => Core.isAnswerComplete(state.byId.get(id), s.answers[id])).length} / ${s.questionIds.length}、見直し ${s.flagged.length}）`),
      h(
        "div",
        { class: "qnav" },
        s.questionIds.map((id, index) => {
          const cls = ["qnav-btn"];
          if (index === s.current) cls.push("current");
          if (Core.isAnswerComplete(state.byId.get(id), s.answers[id])) cls.push("answered");
          if (s.flagged.includes(id)) cls.push("flagged");
          return h(
            "button",
            {
              class: cls.join(" "),
              type: "button",
              "data-index": String(index),
              "aria-label": `問題 ${index + 1}`,
              onclick: () => {
                s.current = index;
                saveSession();
                renderQuiz(true);
              },
            },
            String(index + 1),
          );
        }),
      ),
    );
  }

  function moveTo(index) {
    const s = state.session;
    s.current = Math.max(0, Math.min(s.questionIds.length - 1, index));
    saveSession();
    renderQuiz(true);
  }

  function renderActionBar(q, answer) {
    const s = state.session;
    const isMock = s.mode === "mock";
    const last = s.current === s.questionIds.length - 1;
    const prev = h("button", { class: "btn ghost", type: "button", disabled: s.current === 0, onclick: () => moveTo(s.current - 1) }, "前へ");
    let primary;
    if (isMock) {
      primary = last
        ? h("button", { class: "btn primary", type: "button", onclick: () => confirm(mockFinishMessage()) && finishSession() }, "採点する")
        : h("button", { class: "btn primary", type: "button", onclick: () => moveTo(s.current + 1) }, "次へ");
    } else if (!answer.submitted) {
      const complete = Core.isAnswerComplete(q, answer);
      const need = Core.requiredSelections(q);
      const label = complete ? "回答する" : q.type === "multiple" ? `${need}つ選択してください（${answer.selected.length}/${need}）` : q.type === "dropdown" ? "すべての空欄を選択してください" : "選択してください";
      primary = h(
        "button",
        {
          class: "btn primary",
          type: "button",
          disabled: !complete,
          onclick: () => {
            answer.submitted = true;
            answer.correct = Core.isCorrect(q, answer);
            updateHistory((history) => Core.recordAnswer(history, q.id, answer.correct, s.mode));
            saveSession();
            renderQuiz(false);
            const fb = document.querySelector(".feedback");
            if (fb) fb.scrollIntoView({ behavior: "smooth", block: "start" });
          },
        },
        label,
      );
    } else {
      primary = last
        ? h("button", { class: "btn primary", type: "button", onclick: () => finishSession() }, "結果を見る")
        : h("button", { class: "btn primary", type: "button", onclick: () => moveTo(s.current + 1) }, "次へ");
    }
    return h("div", { id: "actionbar", class: "actionbar" }, prev, primary);
  }

  // ---------- timer (mock exam) ----------
  function startTimer() {
    stopTimer();
    state.lastTick = Date.now();
    state.ticksSinceSave = 0;
    state.timerId = setInterval(() => {
      const s = state.session;
      if (!s || s.mode !== "mock" || !s.timeLimitSec) return stopTimer();
      const now = Date.now();
      if (document.visibilityState === "visible") s.elapsedSec += Math.min(5, (now - state.lastTick) / 1000);
      state.lastTick = now;
      const remaining = s.timeLimitSec - s.elapsedSec;
      const label = document.getElementById("timer");
      if (label) {
        label.textContent = formatDuration(remaining);
        label.classList.toggle("low", remaining < 300);
      }
      state.ticksSinceSave += 1;
      if (state.ticksSinceSave >= 5) {
        state.ticksSinceSave = 0;
        saveSession();
      }
      if (remaining <= 0) {
        stopTimer();
        showToast("制限時間になりました。採点します。");
        finishSession();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  // ---------- finish & results ----------
  function finishSession() {
    const s = state.session;
    if (!s) return;
    stopTimer();
    const score = Core.scoreSession(s, state.byId, state.domains);
    if (score.total === 0) {
      clearSession();
      showToast("回答した問題がないため、結果は記録しませんでした。");
      go("#/");
      return;
    }
    const summary = {
      id: s.id,
      mode: s.mode,
      title: s.title,
      startedAt: s.createdAt,
      finishedAt: Date.now(),
      planned: s.questionIds.length,
      total: score.total,
      correct: score.correct,
      byDomain: score.byDomain,
      items: score.items,
      order: s.order,
      pool: s.settings && s.settings.pool,
      elapsedSec: Math.round(s.elapsedSec || 0),
    };
    updateHistory((history) => {
      if (s.mode === "mock") {
        score.items.forEach((item) => {
          if (item.answered) Core.recordAnswer(history, item.id, item.correct, "mock");
        });
      }
      Core.recordSession(history, summary);
    });
    clearSession();
    go(`#/result/${encodeURIComponent(summary.id)}`);
  }

  function yourAnswerText(q, item, order) {
    if (!item.answered) return "未回答";
    if (q.type === "dropdown") return q.dropdowns.map((d) => `${blankLabel(d.id)}: ${item.dropdowns[d.id] ? choiceText(q, d.id, item.dropdowns[d.id]) : "—"}`).join(" / ");
    return item.selected
      .map((i) => (order ? `${optionLetter(order.indexOf(i))}. ${optionText(q, i)}` : optionText(q, i)))
      .sort()
      .join(" / ");
  }

  const SUMMARY_STEM = 80;

  function shortStem(q) {
    const stem = q.type === "dropdown" ? fillBlanks(stemText(q)) : stemText(q);
    return stem.length > SUMMARY_STEM ? `${stem.slice(0, SUMMARY_STEM)}…` : stem;
  }

  function questionDetail(q, extra) {
    const stem = q.type === "dropdown" ? fillBlanks(stemText(q)) : stemText(q);
    return h(
      "div",
      { class: "detail" },
      stem.length > SUMMARY_STEM ? h("p", { class: "stem", lang: qLang(q) }, stem) : null,
      q.code ? h("pre", { class: "code", lang: "en" }, h("code", null, q.type === "dropdown" ? fillBlanks(q.code) : q.code)) : null,
      extra,
      explanationBlock(q),
      evidenceLinks(q),
    );
  }

  function domainBars(byDomain) {
    return h(
      "div",
      { class: "bars" },
      state.domains.map((d) => {
        const item = byDomain[d.id] || { total: 0, correct: 0 };
        const pct = Core.percent(item.correct, item.total);
        return h(
          "div",
          { class: "bar-row" },
          h("div", { class: "bar-label" }, h("span", null, d.shortJa), h("span", null, item.total ? `${item.correct}/${item.total}（${pct}%）` : "出題なし")),
          h("div", { class: "bar" }, h("span", { style: `width:${item.total ? pct : 0}%` })),
        );
      }),
    );
  }

  function renderResult(id) {
    const summary = state.history.sessions.find((item) => item.id === decodeURIComponent(id || ""));
    if (!summary) {
      render(backLink(), pageHeader("結果が見つかりません"), h("p", null, "学習履歴がリセットされた可能性があります。"));
      return;
    }
    const pct = Core.percent(summary.correct, summary.total);
    const wrong = summary.items.filter((item) => !item.correct && state.byId.has(item.id));
    const unanswered = summary.items.filter((item) => !item.answered).length;
    render(
      backLink(),
      pageHeader(`${MODE_LABELS[summary.mode] || ""}の結果`, summary.title),
      h(
        "section",
        { class: `card score ${pct >= 70 ? "good" : "low"}` },
        h("strong", { class: "score-pct" }, `${pct}%`),
        h("p", null, `${summary.correct} / ${summary.total} 問正解`, unanswered ? `（未回答 ${unanswered} 問）` : "", summary.elapsedSec ? `・所要 ${formatDuration(summary.elapsedSec)}` : ""),
        h("p", { class: "hint" }, `${formatDate(summary.finishedAt)}・出題: ${summary.pool === "history" ? "回答履歴から" : poolLabel(summary.pool)}`),
        summary.mode === "mock" ? h("p", { class: "note" }, "正答率は本番の合否予測ではありません。分野別の弱点把握に使ってください。") : null,
      ),
      h("section", { class: "card" }, h("h2", null, "分野別の正答率"), domainBars(summary.byDomain)),
      h(
        "section",
        { class: "card" },
        h("h2", null, `間違えた問題（${wrong.length}問）`),
        wrong.length
          ? [
              h("button", { class: "btn primary block", type: "button", onclick: () => startReviewOf(wrong.map((item) => item.id), "復習（直前の間違い）") }, "間違えた問題を復習する"),
              h(
                "div",
                { class: "review-list" },
                wrong.map((item) => {
                  const q = state.byId.get(item.id);
                  const order = summary.order ? summary.order[item.id] : null;
                  const optionOrder = Array.isArray(order) ? order : null;
                  return h(
                    "details",
                    { class: "review-item" },
                    h("summary", null, h("span", { class: "qid" }, q.id), " ", h("span", { lang: qLang(q) }, shortStem(q))),
                    questionDetail(
                      q,
                      h(
                        "div",
                        { class: "answers" },
                        h("p", null, h("b", null, "あなたの回答: "), h("span", { lang: qLang(q) }, yourAnswerText(q, item, optionOrder))),
                        h("p", null, h("b", null, "正解: "), h("span", { lang: qLang(q) }, correctAnswerText(q, optionOrder))),
                      ),
                    ),
                  );
                }),
              ),
            ]
          : h("p", null, "間違えた問題はありません。"),
      ),
      h("div", { class: "actionbar" }, h("a", { class: "btn ghost", href: "#/history" }, "学習履歴"), h("a", { class: "btn primary", href: "#/" }, "ホームへ")),
    );
  }

  // ---------- history ----------
  function renderHistory() {
    const sum = Core.historySummary(state.history, state.byId, state.domains);
    const recent = state.history.log.slice(-20).reverse();
    render(
      backLink(),
      pageHeader("学習履歴", "この端末のブラウザに保存されています。外部には送信しません。"),
      h(
        "section",
        { class: "card stats-row" },
        h("div", null, h("strong", null, `${sum.questions}/${state.bank.length}`), h("span", null, "回答した問題")),
        h("div", null, h("strong", null, sum.attempts), h("span", null, "回答回数")),
        h("div", null, h("strong", null, `${Core.percent(sum.correct, sum.attempts)}%`), h("span", null, "正答率")),
        h("div", null, h("strong", null, sum.wrongNow), h("span", null, "要復習")),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "分野別"),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "分野"), h("th", null, "回答した問題"), h("th", null, "正答率"), h("th", null, "要復習"))),
            h(
              "tbody",
              null,
              state.domains.map((d) => {
                const item = sum.byDomain[d.id];
                const bankCount = state.bank.filter((q) => q.domain === d.id).length;
                return h("tr", null, h("td", null, d.shortJa), h("td", null, `${item.questions}/${bankCount}`), h("td", null, item.attempts ? `${Core.percent(item.correct, item.attempts)}%` : "—"), h("td", null, item.wrongNow));
              }),
            ),
          ),
        ),
        sum.wrongNow ? h("a", { class: "btn primary block", href: "#/review" }, "間違えた問題を復習する") : null,
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "最近のセッション"),
        state.history.sessions.length
          ? h(
              "ul",
              { class: "list" },
              state.history.sessions.slice(0, 20).map((item) =>
                h(
                  "li",
                  null,
                  h(
                    "a",
                    { href: `#/result/${encodeURIComponent(item.id)}` },
                    h("span", null, item.title),
                    h("span", { class: "list-meta" }, `${formatDate(item.finishedAt)}・${item.correct}/${item.total}（${Core.percent(item.correct, item.total)}%）`),
                  ),
                ),
              ),
            )
          : h("p", { class: "empty" }, "まだ記録がありません。"),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "最近の回答"),
        recent.length
          ? h(
              "ul",
              { class: "list compact" },
              recent.map((entry) => {
                const q = state.byId.get(entry.id);
                return h(
                  "li",
                  null,
                  h("span", { class: entry.correct ? "ok-mark" : "ng-mark" }, entry.correct ? "○" : "×"),
                  " ",
                  h("span", { class: "qid" }, entry.id),
                  " ",
                  h("span", { class: "list-meta" }, `${MODE_LABELS[entry.mode] || entry.mode}・${formatDate(entry.at)}`),
                  q ? h("span", { class: "list-stem", lang: qLang(q) }, shortStem(q)) : null,
                );
              }),
            )
          : h("p", { class: "empty" }, "まだ回答がありません。"),
      ),
      h(
        "section",
        { class: "card danger-zone" },
        h("h2", null, "学習履歴のリセット"),
        h("p", null, "回答履歴・正答率・間違えた問題・途中のセッションをすべて削除します。元に戻せません。"),
        h(
          "button",
          {
            class: "btn danger",
            type: "button",
            onclick: () => {
              if (!confirm("学習履歴をすべて削除しますか？元に戻せません。")) return;
              state.history = Core.emptyHistory();
              saveHistory();
              clearSession();
              showToast("学習履歴をリセットしました");
              renderHistory();
            },
          },
          "学習履歴をリセット",
        ),
      ),
    );
  }

  // ---------- quality ----------
  function renderQuality() {
    const st = state.stats;
    let statusFilter = "";
    let domainFilter = "";
    let translationFilter = "";
    const listHolder = h("div", { class: "review-list" });

    const drawList = () => {
      const items = state.bank.filter(
        (q) =>
          (!statusFilter || q.status === statusFilter) &&
          (!domainFilter || q.domain === domainFilter) &&
          (!translationFilter || translationStatus(q) === translationFilter || (translationFilter === "low" && state.ja[q.id] && state.ja[q.id].lowConfidence)),
      );
      listHolder.replaceChildren(
        h("p", { class: "hint" }, `${items.length}問`),
        ...items.map((q) =>
          h(
            "details",
            { class: "review-item" },
            h("summary", null, h("span", { class: "qid" }, q.id), " ", statusBadge(q.status), " ", h("span", { lang: qLang(q) }, shortStem(q))),
            questionDetail(
              q,
              h(
                "div",
                { class: "answers" },
                h("p", null, h("b", null, "正解: "), h("span", { lang: qLang(q) }, correctAnswerText(q, null))),
                q.type !== "dropdown" ? h("ul", { class: "plain options-list", lang: qLang(q) }, q.options.map((_, i) => h("li", { class: q.answer.includes(i) ? "is-correct" : "" }, optionText(q, i)))) : null,
                h("p", { class: "hint" }, `分野: ${domainLabel(q.domain)}・スキル: ${q.skills.join(", ") || "未割当"}・翻訳: ${TRANSLATION_LABELS[translationStatus(q)]}・統合元の元問題番号: ${q.sourceNumbers.map((n) => `#${n}`).join(", ")}`),
                state.ja[q.id] && state.ja[q.id].reviewNotes ? h("p", { class: "hint" }, `翻訳メモ: ${state.ja[q.id].reviewNotes}`) : null,
              ),
            ),
          ),
        ),
      );
    };

    const skillRows = [];
    state.domainsDoc.domains.forEach((d) => {
      d.groups.forEach((g) => {
        skillRows.push(h("tr", { class: "group-row" }, h("th", { colspan: "3" }, `${g.id} ${g.nameJa}`)));
        g.skills.forEach((skill) => {
          const item = st.skills[skill.id] || { total: 0, verified: 0 };
          const flag = item.total === 0 ? h("span", { class: "badge gap" }, "カバレッジ不足") : item.verified === 0 ? h("span", { class: "badge thin" }, "検証済みなし") : null;
          skillRows.push(h("tr", null, h("td", { lang: "en" }, h("span", { class: "skill-id" }, skill.id), " ", skill.name, " ", flag), h("td", null, item.total), h("td", null, item.verified)));
        });
      });
    });

    render(
      backLink(),
      pageHeader("問題データ", "重複除去の結果と、各問題の品質状態・試験範囲のカバレッジです。"),
      h(
        "section",
        { class: "card" },
        h("h2", null, "重複除去"),
        h(
          "ul",
          { class: "plain" },
          h("li", null, `元データ: ${st.sourceTotal}問`),
          h("li", null, `完全一致を統合後: ${st.afterExactDedup}問`),
          h("li", null, `表現違い・意味的重複も統合後: `, h("strong", null, `${st.total}問`), `（${st.removed}問を統合）`),
        ),
        h(
          "p",
          { class: "hint" },
          `内訳: 完全一致 ${st.relations.exact_duplicate}・選択肢の順序違い ${st.relations.choice_order_variant}・定型の問い違い ${st.relations.template_variant}・意味的重複 ${st.relations.semantic_duplicate}`,
        ),
        h(
          "p",
          null,
          h("a", { href: `${REPO_URL}/blob/main/data/dedup-log.csv`, target: "_blank", rel: "noopener" }, "統合記録（元ID→統合先ID）"),
          "・",
          h("a", { href: `${REPO_URL}/blob/main/docs/question-audit.md`, target: "_blank", rel: "noopener" }, "品質監査レポート"),
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "品質状態"),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "状態"), h("th", null, "問題数"), h("th", null, "意味"))),
            h(
              "tbody",
              null,
              Core.STATUSES.map((s) => h("tr", null, h("td", null, statusBadge(s)), h("td", null, st.status[s] || 0), h("td", null, STATUS_DESCRIPTIONS[s]))),
            ),
          ),
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "日本語訳の状態"),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "翻訳状態"), h("th", null, "問題数"), h("th", null, "意味"))),
            h(
              "tbody",
              null,
              Object.keys(TRANSLATION_LABELS).map((key) =>
                h("tr", null, h("td", null, h("span", { class: `badge tr-${key}` }, TRANSLATION_LABELS[key])), h("td", null, (st.translation && st.translation.status[key]) || 0), h("td", null, TRANSLATION_DESCRIPTIONS[key])),
              ),
            ),
          ),
        ),
        st.translation && st.translation.lowConfidence.length
          ? h("p", { class: "hint" }, `翻訳に自信がなく特に確認が必要な問題: ${st.translation.lowConfidence.join(", ")}`)
          : null,
        h("p", null, h("a", { href: `${REPO_URL}/blob/main/docs/translation-audit.md`, target: "_blank", rel: "noopener" }, "翻訳品質の監査レポート")),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "分野別の問題数"),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "分野"), h("th", null, "配点"), h("th", null, "元"), h("th", null, "統合後"), h("th", null, "検証済み"))),
            h(
              "tbody",
              null,
              state.domains.map((d) => {
                const item = st.domains[d.id];
                return h("tr", null, h("td", null, d.shortJa), h("td", null, d.weight), h("td", null, item.source), h("td", null, item.total), h("td", null, item.status.verified));
              }),
            ),
          ),
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "スキル別カバレッジ"),
        h("p", { class: "hint" }, `基準: Study guide（Skills measured as of ${state.domainsDoc.skillsMeasuredAsOf}）。問題がないスキルは「カバレッジ不足」です。不足分野の問題は自動生成していません。`),
        h("div", { class: "table-wrap" }, h("table", { class: "skills" }, h("thead", null, h("tr", null, h("th", null, "スキル"), h("th", null, "問題"), h("th", null, "検証済み"))), h("tbody", null, skillRows))),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "問題一覧"),
        h(
          "div",
          { class: "filters" },
          h(
            "select",
            {
              class: "select",
              "aria-label": "状態で絞り込み",
              onchange: (event) => {
                statusFilter = event.target.value;
                drawList();
              },
            },
            h("option", { value: "" }, "すべての状態"),
            Core.STATUSES.map((s) => h("option", { value: s }, `${STATUS_LABELS[s]}（${st.status[s] || 0}）`)),
          ),
          h(
            "select",
            {
              class: "select",
              "aria-label": "分野で絞り込み",
              onchange: (event) => {
                domainFilter = event.target.value;
                drawList();
              },
            },
            h("option", { value: "" }, "すべての分野"),
            state.domains.map((d) => h("option", { value: d.id }, d.shortJa)),
          ),
          h(
            "select",
            {
              class: "select",
              "aria-label": "翻訳状態で絞り込み",
              onchange: (event) => {
                translationFilter = event.target.value;
                drawList();
              },
            },
            h("option", { value: "" }, "すべての翻訳状態"),
            Object.keys(TRANSLATION_LABELS).map((key) => h("option", { value: key }, TRANSLATION_LABELS[key])),
            h("option", { value: "low" }, "翻訳に自信なし"),
          ),
        ),
        listHolder,
      ),
    );
    drawList();
  }

  // ---------- glossary ----------
  function renderGlossary() {
    if (!state.glossary) {
      renderHome();
      return;
    }
    let query = "";
    const holder = h("div", { class: "glossary" });
    const corpus = state.bank.map((q) =>
      [q.stem, q.code || "", ...(q.options || []), ...(q.dropdowns || []).flatMap((d) => d.choices), q.explanation].join(" ").toLowerCase(),
    );
    const related = new Map(state.glossary.terms.map((t) => [t.term, corpus.filter((text) => (t.match || []).some((m) => text.includes(m))).length]));
    const draw = () => {
      const q = query.trim().toLowerCase();
      const items = state.glossary.terms.filter((t) => !q || `${t.term} ${t.jaName || ""} ${t.roleJa} ${(t.aliases || []).join(" ")}`.toLowerCase().includes(q));
      holder.replaceChildren(
        ...items.map((t) =>
          h(
            "article",
            { class: "card term" },
            h("h3", { lang: "en" }, t.term),
            t.jaName && t.jaName !== t.term ? h("p", { class: "hint" }, `Learn 日本語版の表記: ${t.jaName}`) : null,
            t.aliases && t.aliases.length ? h("p", { class: "hint" }, `別名・旧称・関連語: ${t.aliases.join(", ")}`) : null,
            h("p", null, t.roleJa),
            h("p", { class: "hint" }, `関連分野: ${t.domains.map(domainLabel).join("・")}・関連する問題: 約${related.get(t.term)}問`),
            h(
              "p",
              { class: "row" },
              t.urlJa ? h("a", { href: t.urlJa, target: "_blank", rel: "noopener" }, "Microsoft Learn（日本語）") : null,
              h("a", { href: t.url, target: "_blank", rel: "noopener" }, "Microsoft Learn（English）"),
            ),
          ),
        ),
      );
    };
    render(
      backLink(),
      pageHeader("用語集", state.glossary.description),
      h("input", {
        class: "search",
        type: "search",
        placeholder: "用語を検索",
        "aria-label": "用語を検索",
        oninput: (event) => {
          query = event.target.value;
          draw();
        },
      }),
      holder,
    );
    draw();
  }

  // ---------- boot ----------
  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is optional */
    });
  }

  async function init() {
    const [bank, domainsDoc, stats, glossary, ja] = await Promise.all([
      fetchJson("data/bank.json"),
      fetchJson("data/domains.json"),
      fetchJson("data/stats.json"),
      fetchJson("data/glossary.json").catch(() => null),
      fetchJson("data/i18n/ja.json").catch(() => null),
    ]);
    state.ja = ja && ja.questions ? ja.questions : {};
    state.bank = bank;
    state.byId = Core.indexBank(bank);
    state.domainsDoc = domainsDoc;
    state.domains = domainsDoc.domains;
    state.domains.forEach((d) => state.domainById.set(d.id, d));
    state.stats = stats;
    state.glossary = glossary && Array.isArray(glossary.terms) && glossary.terms.length ? glossary : null;
    state.history = Core.sanitizeHistory(readStore(STORAGE.history));
    state.settings = { pool: "verified", lang: "ja", ...(readStore(STORAGE.settings) || {}) };
    if (!Core.POOL_STATUSES[state.settings.pool]) state.settings.pool = "verified";
    if (state.settings.lang !== "en") state.settings.lang = "ja";
    const toggle = document.getElementById("langToggle");
    if (toggle) toggle.addEventListener("click", switchLanguage);
    langToggle();
    state.session = Core.reconcileSession(readStore(STORAGE.session), state.byId);
    if (state.session) saveSession(false);
    else removeStore(STORAGE.session);

    window.addEventListener("hashchange", route);
    const persist = () => {
      if (state.session) saveSession(false);
    };
    // Keep several open tabs (or the installed app and a browser tab) in sync.
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE.history || event.key === null) {
        state.history = Core.sanitizeHistory(readStore(STORAGE.history));
      }
      if (event.key === STORAGE.session || event.key === null) {
        const previous = state.session;
        state.session = Core.reconcileSession(readStore(STORAGE.session), state.byId);
        const onQuiz = location.hash.startsWith("#/quiz");
        if (onQuiz && previous && state.session && previous.id === state.session.id) {
          renderQuiz(false);
          return;
        }
      }
      if (!location.hash.startsWith("#/quiz") || !state.session) route();
    });
    document.addEventListener("visibilitychange", persist);
    window.addEventListener("pagehide", persist);
    route();
    registerServiceWorker();
  }

  init().catch((error) => {
    render(h("section", { class: "card" }, h("h1", null, "データを読み込めませんでした"), h("p", null, error.message), h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "再読み込み")));
  });
})();
