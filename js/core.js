/* Pure study logic shared by the browser app and Node tests. No DOM access here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STATUSES = ["verified", "unverified", "outdated", "ambiguous", "out_of_scope"];
  const POOL_STATUSES = {
    verified: ["verified"],
    all: ["verified", "unverified"],
  };
  const HISTORY_VERSION = 1;
  const MAX_SESSIONS = 50;
  const MAX_LOG = 3000;

  function shuffle(items, rand = Math.random) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function indexBank(bank) {
    const byId = new Map();
    bank.forEach((q) => byId.set(q.id, q));
    return byId;
  }

  function filterPool(bank, { pool = "verified", domain = null } = {}) {
    const allowed = POOL_STATUSES[pool] || POOL_STATUSES.verified;
    return bank.filter((q) => allowed.includes(q.status) && (!domain || q.domain === domain));
  }

  function weightMidpoint(weight) {
    const nums = String(weight || "").match(/\d+(\.\d+)?/g);
    if (!nums || nums.length === 0) return 1;
    const values = nums.map(Number);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** Split `total` across domains in proportion to the official weights (largest remainder). */
  function allocateByWeight(domains, total) {
    const weights = domains.map((d) => weightMidpoint(d.weight));
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (w / sum) * total);
    const counts = raw.map(Math.floor);
    let rest = total - counts.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) counts[order[k][1]] += 1;
    const result = {};
    domains.forEach((d, i) => {
      result[d.id] = counts[i];
    });
    return result;
  }

  /** Pick a mock exam: official-weight quota per domain, topped up randomly if a domain runs short. */
  function pickMock(pool, domains, size, rand = Math.random) {
    const quota = allocateByWeight(domains, size);
    const chosen = [];
    const used = new Set();
    domains.forEach((d) => {
      shuffle(pool.filter((q) => q.domain === d.id), rand)
        .slice(0, quota[d.id])
        .forEach((q) => {
          chosen.push(q);
          used.add(q.id);
        });
    });
    if (chosen.length < size) {
      shuffle(pool.filter((q) => !used.has(q.id)), rand)
        .slice(0, size - chosen.length)
        .forEach((q) => chosen.push(q));
    }
    return shuffle(chosen, rand);
  }

  function makeId(rand = Math.random) {
    return `${Date.now().toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
  }

  function defaultOrder(question) {
    if (question.type === "dropdown") {
      return Object.fromEntries(question.dropdowns.map((d) => [d.id, [...d.choices]]));
    }
    return question.options.map((_, i) => i);
  }

  function createSession({ mode, title, questions, timeLimitSec = 0, settings = {}, rand = Math.random, now = Date.now() }) {
    const order = {};
    questions.forEach((q) => {
      if (q.type === "dropdown") {
        order[q.id] = {};
        q.dropdowns.forEach((d) => {
          order[q.id][d.id] = shuffle(d.choices, rand);
        });
      } else {
        order[q.id] = shuffle(q.options.map((_, i) => i), rand);
      }
    });
    return {
      version: 1,
      id: makeId(rand),
      mode,
      title,
      createdAt: now,
      updatedAt: now,
      questionIds: questions.map((q) => q.id),
      order,
      current: 0,
      answers: {},
      flagged: [],
      timeLimitSec,
      elapsedSec: 0,
      settings,
    };
  }

  /** Drop questions that no longer exist in the bank (e.g. after a data update). */
  function reconcileSession(session, byId) {
    if (!session || typeof session !== "object" || !Array.isArray(session.questionIds)) return null;
    const ids = session.questionIds.filter((id) => byId.has(id));
    if (ids.length === 0) return null;
    const next = { ...session, questionIds: ids, answers: {}, order: { ...(session.order || {}) } };
    next.current = Math.min(Math.max(0, Number(session.current) || 0), ids.length - 1);
    ids.forEach((id) => {
      const q = byId.get(id);
      const answer = session.answers && session.answers[id];
      if (answer) next.answers[id] = answer;
      const order = next.order[id];
      const valid =
        q.type === "dropdown"
          ? Boolean(order) && q.dropdowns.every((d) => Array.isArray(order[d.id]) && order[d.id].length === d.choices.length)
          : Array.isArray(order) && order.length === q.options.length;
      if (!valid) {
        next.order[id] = defaultOrder(q);
        delete next.answers[id];
      }
    });
    next.flagged = (session.flagged || []).filter((id) => byId.has(id));
    next.elapsedSec = Number(session.elapsedSec) || 0;
    next.timeLimitSec = Number(session.timeLimitSec) || 0;
    return next;
  }

  function requiredSelections(question) {
    if (question.type === "dropdown") return question.dropdowns.length;
    return question.answer.length;
  }

  function isAnswerComplete(question, answer) {
    if (!answer) return false;
    if (question.type === "dropdown") {
      return question.dropdowns.every((d) => Boolean(answer.dropdowns && answer.dropdowns[d.id]));
    }
    const selected = answer.selected || [];
    return selected.length === requiredSelections(question);
  }

  function isCorrect(question, answer) {
    if (!answer) return false;
    if (question.type === "dropdown") {
      return question.dropdowns.every((d) => Boolean(answer.dropdowns) && answer.dropdowns[d.id] === d.answer);
    }
    const selected = new Set(answer.selected || []);
    const correct = new Set(question.answer);
    if (selected.size !== correct.size) return false;
    return [...correct].every((i) => selected.has(i));
  }

  /** Practice modes score only submitted questions; mock exams score every question (unanswered = wrong). */
  function scoreSession(session, byId, domains) {
    const byDomain = {};
    domains.forEach((d) => {
      byDomain[d.id] = { total: 0, correct: 0 };
    });
    const items = [];
    session.questionIds.forEach((id) => {
      const q = byId.get(id);
      if (!q) return;
      const answer = session.answers[id];
      const complete = isAnswerComplete(q, answer);
      const answered = session.mode === "mock" ? complete : complete && Boolean(answer.submitted);
      if (session.mode !== "mock" && !answered) return;
      const correct = answered && isCorrect(q, answer);
      if (!byDomain[q.domain]) byDomain[q.domain] = { total: 0, correct: 0 };
      byDomain[q.domain].total += 1;
      if (correct) byDomain[q.domain].correct += 1;
      items.push({
        id,
        answered,
        correct,
        selected: answer && Array.isArray(answer.selected) ? [...answer.selected] : [],
        dropdowns: answer && answer.dropdowns ? { ...answer.dropdowns } : {},
      });
    });
    const total = items.length;
    const correct = items.filter((item) => item.correct).length;
    return { total, correct, byDomain, items };
  }

  function emptyHistory() {
    return { version: HISTORY_VERSION, questions: {}, sessions: [], log: [] };
  }

  function sanitizeHistory(raw) {
    if (!raw || typeof raw !== "object" || raw.version !== HISTORY_VERSION) return emptyHistory();
    return {
      version: HISTORY_VERSION,
      questions: raw.questions && typeof raw.questions === "object" && !Array.isArray(raw.questions) ? raw.questions : {},
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      log: Array.isArray(raw.log) ? raw.log : [],
    };
  }

  function recordAnswer(history, id, correct, mode, at = Date.now()) {
    const item = history.questions[id] || { attempts: 0, correct: 0, lastCorrect: null, lastAt: 0 };
    item.attempts += 1;
    if (correct) item.correct += 1;
    item.lastCorrect = Boolean(correct);
    item.lastAt = at;
    history.questions[id] = item;
    history.log.push({ id, correct: Boolean(correct), mode, at });
    if (history.log.length > MAX_LOG) history.log.splice(0, history.log.length - MAX_LOG);
    return history;
  }

  function recordSession(history, summary) {
    history.sessions.unshift(summary);
    if (history.sessions.length > MAX_SESSIONS) history.sessions.length = MAX_SESSIONS;
    return history;
  }

  /** Questions to review: last attempt wrong (default) or every answered question. Most recent first. */
  function reviewCandidates(history, byId, { includeCorrect = false, domain = null } = {}) {
    return Object.entries(history.questions)
      .filter(([id, item]) => byId.has(id) && (includeCorrect || item.lastCorrect === false))
      .filter(([id]) => !domain || byId.get(id).domain === domain)
      .sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
      .map(([id]) => byId.get(id));
  }

  function historySummary(history, byId, domains) {
    const byDomain = {};
    domains.forEach((d) => {
      byDomain[d.id] = { questions: 0, attempts: 0, correct: 0, wrongNow: 0 };
    });
    const total = { questions: 0, attempts: 0, correct: 0, wrongNow: 0 };
    Object.entries(history.questions).forEach(([id, item]) => {
      const q = byId.get(id);
      if (!q) return;
      [total, byDomain[q.domain]].forEach((target) => {
        if (!target) return;
        target.questions += 1;
        target.attempts += item.attempts;
        target.correct += item.correct;
        if (item.lastCorrect === false) target.wrongNow += 1;
      });
    });
    return { ...total, byDomain };
  }

  function percent(correct, total) {
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }

  return {
    STATUSES,
    POOL_STATUSES,
    shuffle,
    indexBank,
    filterPool,
    allocateByWeight,
    pickMock,
    createSession,
    reconcileSession,
    requiredSelections,
    isAnswerComplete,
    isCorrect,
    scoreSession,
    emptyHistory,
    sanitizeHistory,
    recordAnswer,
    recordSession,
    reviewCandidates,
    historySummary,
    percent,
  };
});
