const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../js/core.js");

const domains = [
  { id: "plan", weight: "25–30%" },
  { id: "genai", weight: "30–35%" },
  { id: "vision", weight: "10–15%" },
  { id: "text", weight: "10–15%" },
  { id: "extract", weight: "10–15%" },
];

const single = { id: "q001", domain: "plan", type: "single", options: ["a", "b", "c", "d"], answer: [0], status: "verified" };
const multi = { id: "q002", domain: "genai", type: "multiple", options: ["a", "b", "c", "d"], answer: [0, 1], status: "verified" };
const dropdown = {
  id: "q003",
  domain: "text",
  type: "dropdown",
  dropdowns: [
    { id: "drop1", choices: ["x", "y", "z"], answer: "x" },
    { id: "drop2", choices: ["p", "q"], answer: "q" },
  ],
  status: "unverified",
};
const bank = [single, multi, dropdown];

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test("single choice scoring", () => {
  assert.equal(Core.isCorrect(single, { selected: [0] }), true);
  assert.equal(Core.isCorrect(single, { selected: [1] }), false);
  assert.equal(Core.isCorrect(single, undefined), false);
  assert.equal(Core.isAnswerComplete(single, { selected: [] }), false);
  assert.equal(Core.isAnswerComplete(single, { selected: [2] }), true);
});

test("multiple response scoring requires the exact set", () => {
  assert.equal(Core.isCorrect(multi, { selected: [1, 0] }), true);
  assert.equal(Core.isCorrect(multi, { selected: [0] }), false, "partial answer is wrong");
  assert.equal(Core.isCorrect(multi, { selected: [0, 2] }), false, "one wrong option is wrong");
  assert.equal(Core.isCorrect(multi, { selected: [0, 1, 2] }), false, "extra option is wrong");
  assert.equal(Core.isAnswerComplete(multi, { selected: [0] }), false);
  assert.equal(Core.isAnswerComplete(multi, { selected: [0, 3] }), true);
  assert.equal(Core.isAnswerComplete(multi, { selected: [0, 1, 3] }), false);
  assert.equal(Core.requiredSelections(multi), 2);
});

test("dropdown scoring checks every blank", () => {
  assert.equal(Core.isCorrect(dropdown, { dropdowns: { drop1: "x", drop2: "q" } }), true);
  assert.equal(Core.isCorrect(dropdown, { dropdowns: { drop1: "x", drop2: "p" } }), false);
  assert.equal(Core.isAnswerComplete(dropdown, { dropdowns: { drop1: "x" } }), false);
  assert.equal(Core.isAnswerComplete(dropdown, { dropdowns: { drop1: "x", drop2: "p" } }), true);
});

test("pool filter keeps unverified out unless requested", () => {
  assert.deepEqual(Core.filterPool(bank, { pool: "verified" }).map((q) => q.id), ["q001", "q002"]);
  assert.deepEqual(Core.filterPool(bank, { pool: "all" }).map((q) => q.id), ["q001", "q002", "q003"]);
  assert.deepEqual(Core.filterPool(bank, { pool: "all", domain: "text" }).map((q) => q.id), ["q003"]);
  const bad = [{ ...single, status: "outdated" }, { ...multi, status: "ambiguous" }, { ...dropdown, status: "out_of_scope" }];
  assert.equal(Core.filterPool(bad, { pool: "all" }).length, 0, "outdated/ambiguous/out_of_scope are never served");
});

test("mock exam quota follows official weights and sums to 50", () => {
  const quota = Core.allocateByWeight(domains, 50);
  assert.equal(Object.values(quota).reduce((a, b) => a + b, 0), 50);
  assert.deepEqual(quota, { plan: 14, genai: 17, vision: 7, text: 6, extract: 6 });
});

test("pickMock returns unique questions and tops up short domains", () => {
  const pool = [];
  domains.forEach((d) => {
    const n = d.id === "vision" ? 3 : 30;
    for (let i = 0; i < n; i += 1) pool.push({ id: `${d.id}-${i}`, domain: d.id, type: "single", options: ["a"], answer: [0], status: "verified" });
  });
  const picked = Core.pickMock(pool, domains, 50, seeded(7));
  assert.equal(picked.length, 50);
  assert.equal(new Set(picked.map((q) => q.id)).size, 50);
  assert.equal(picked.filter((q) => q.domain === "vision").length, 3);
  assert.equal(Core.pickMock(pool.slice(0, 10), domains, 50).length, 10, "small pool uses everything");
});

test("session survives a JSON round trip (localStorage) and keeps answers", () => {
  const session = Core.createSession({ mode: "domain", title: "t", questions: bank, rand: seeded(3) });
  assert.deepEqual([...session.order.q001].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...session.order.q003.drop1].sort(), ["x", "y", "z"]);
  session.answers.q001 = { selected: [0], dropdowns: {}, submitted: true, correct: true };
  session.current = 1;
  const byId = Core.indexBank(bank);
  const restored = Core.reconcileSession(JSON.parse(JSON.stringify(session)), byId);
  assert.deepEqual(restored.answers.q001.selected, [0]);
  assert.equal(restored.current, 1);
  assert.deepEqual(restored.questionIds, ["q001", "q002", "q003"]);
});

test("reconcileSession drops questions removed from the bank", () => {
  const session = Core.createSession({ mode: "mock", title: "t", questions: bank });
  session.current = 2;
  session.answers.q003 = { dropdowns: { drop1: "x", drop2: "q" } };
  const byId = Core.indexBank([single, multi]);
  const restored = Core.reconcileSession(session, byId);
  assert.deepEqual(restored.questionIds, ["q001", "q002"]);
  assert.equal(restored.current, 1);
  assert.equal(restored.answers.q003, undefined);
  assert.equal(Core.reconcileSession(session, Core.indexBank([])), null);
  assert.equal(Core.reconcileSession({ garbage: true }, byId), null);
  const broken = { ...session, order: { q001: [0, 1] } };
  assert.deepEqual(Core.reconcileSession(broken, byId).order.q001, [0, 1, 2, 3], "invalid option order is repaired");
});

test("practice scoring counts submitted answers only; mock counts unanswered as wrong", () => {
  const byId = Core.indexBank(bank);
  const practice = Core.createSession({ mode: "domain", title: "t", questions: bank });
  practice.answers.q001 = { selected: [0], submitted: true };
  practice.answers.q002 = { selected: [0, 2], submitted: true };
  practice.answers.q003 = { dropdowns: { drop1: "x", drop2: "q" }, submitted: false };
  const p = Core.scoreSession(practice, byId, domains);
  assert.equal(p.total, 2);
  assert.equal(p.correct, 1);
  assert.deepEqual(p.byDomain.plan, { total: 1, correct: 1 });
  assert.deepEqual(p.byDomain.genai, { total: 1, correct: 0 });

  const mock = Core.createSession({ mode: "mock", title: "t", questions: bank });
  mock.answers.q002 = { selected: [1, 0] };
  mock.answers.q003 = { dropdowns: { drop1: "x" } };
  const m = Core.scoreSession(mock, byId, domains);
  assert.equal(m.total, 3);
  assert.equal(m.correct, 1);
  assert.equal(m.items.filter((item) => !item.answered).length, 2);
  assert.deepEqual(m.byDomain.text, { total: 1, correct: 0 });
});

test("outdated/ambiguous/out_of_scope questions are dropped from review and resumed sessions", () => {
  const outdated = { ...single, id: "q009", status: "outdated" };
  const byId = Core.indexBank([...bank, outdated]);
  const history = Core.emptyHistory();
  Core.recordAnswer(history, "q009", false, "domain", 1);
  Core.recordAnswer(history, "q001", false, "domain", 2);
  assert.deepEqual(Core.reviewCandidates(history, byId).map((q) => q.id), ["q001"]);
  const session = Core.createSession({ mode: "domain", title: "t", questions: [outdated, single] });
  assert.deepEqual(Core.reconcileSession(session, byId).questionIds, ["q001"]);
  assert.equal(Core.isServable(dropdown), true, "unverified is servable (shown with a label)");
  assert.equal(Core.isServable(outdated), false);
});

test("history records answers and drives review", () => {
  const byId = Core.indexBank(bank);
  const history = Core.emptyHistory();
  Core.recordAnswer(history, "q001", false, "domain", 1);
  Core.recordAnswer(history, "q002", true, "domain", 2);
  Core.recordAnswer(history, "q003", false, "mock", 3);
  Core.recordAnswer(history, "q003", true, "review", 4);
  Core.recordAnswer(history, "gone", false, "domain", 5);
  assert.deepEqual(Core.reviewCandidates(history, byId).map((q) => q.id), ["q001"]);
  assert.deepEqual(Core.reviewCandidates(history, byId, { includeCorrect: true }).map((q) => q.id), ["q003", "q002", "q001"]);
  assert.deepEqual(Core.reviewCandidates(history, byId, { includeCorrect: true, domain: "genai" }).map((q) => q.id), ["q002"]);
  const summary = Core.historySummary(history, byId, domains);
  assert.equal(summary.questions, 3);
  assert.equal(summary.attempts, 4);
  assert.equal(summary.correct, 2);
  assert.equal(summary.wrongNow, 1);
  assert.equal(history.questions.q003.attempts, 2);
  const restored = Core.sanitizeHistory(JSON.parse(JSON.stringify(history)));
  assert.deepEqual(restored, history);
});

test("sanitizeHistory rejects malformed storage", () => {
  assert.deepEqual(Core.sanitizeHistory(null), Core.emptyHistory());
  assert.deepEqual(Core.sanitizeHistory({ version: 99 }), Core.emptyHistory());
  assert.deepEqual(Core.sanitizeHistory({ version: 1, questions: [], sessions: "x" }).sessions, []);
  const h = Core.emptyHistory();
  for (let i = 0; i < 60; i += 1) Core.recordSession(h, { id: String(i) });
  assert.equal(h.sessions.length, 50);
  assert.equal(h.sessions[0].id, "59");
});
