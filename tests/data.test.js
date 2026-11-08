const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const source = read("data/source/questions.json");
const bank = read("data/bank.json");
const log = read("data/dedup-log.json");
const stats = read("data/stats.json");
const domains = read("data/domains.json");
const glossary = read("data/glossary.json");
const ja = read("data/i18n/ja.json").questions;
const STATUSES = ["verified", "unverified", "outdated", "ambiguous", "out_of_scope"];

test("question IDs are stable and derived from source numbers", () => {
  const ids = new Set();
  bank.forEach((q) => {
    assert.match(q.id, /^q\d{3}$/);
    assert.ok(!ids.has(q.id), `duplicate ${q.id}`);
    ids.add(q.id);
    assert.ok(q.sourceNumbers.includes(Number(q.id.slice(1))), `${q.id} must keep its own source number`);
  });
});

test("dedup log maps every source question exactly once", () => {
  assert.equal(log.length, source.length);
  const byNumber = new Map(log.map((row) => [row.sourceNumber, row]));
  assert.equal(byNumber.size, source.length);
  const ids = new Set(bank.map((q) => q.id));
  source.forEach((q) => {
    const row = byNumber.get(q.number);
    assert.ok(row, `missing source #${q.number}`);
    assert.ok(ids.has(row.canonicalId), `unknown canonical ${row.canonicalId}`);
  });
  const fromBank = bank.flatMap((q) => q.sourceNumbers).sort((a, b) => a - b);
  assert.deepEqual(fromBank, source.map((q) => q.number).sort((a, b) => a - b));
  assert.equal(log.filter((row) => row.relation === "canonical").length, bank.length);
});

test("answers, statuses and evidence are well formed", () => {
  bank.forEach((q) => {
    assert.ok(STATUSES.includes(q.status), `${q.id} status`);
    if (q.status === "verified") assert.ok(q.evidence.length > 0, `${q.id} verified without evidence`);
    q.evidence.forEach((url) => assert.match(url, /^https:\/\//));
    assert.ok(["single", "multiple", "dropdown"].includes(q.type));
    if (q.type === "dropdown") {
      q.dropdowns.forEach((d) => assert.ok(d.choices.includes(d.answer), `${q.id} ${d.id}`));
      const blanks = `${q.stem} ${q.code || ""}`.match(/\[\[drop\d+\]\]/g) || [];
      assert.equal(blanks.length, q.dropdowns.length, `${q.id} blanks`);
    } else {
      assert.equal(q.answer.length, q.type === "multiple" ? 2 : 1, `${q.id} answer count`);
      q.answer.forEach((i) => assert.ok(i >= 0 && i < q.options.length));
    }
    assert.ok(domains.domains.some((d) => d.id === q.domain));
  });
});

test("stats match the bank", () => {
  assert.equal(stats.sourceTotal, source.length);
  assert.equal(stats.total, bank.length);
  assert.equal(Object.values(stats.status).reduce((a, b) => a + b, 0), bank.length);
  STATUSES.forEach((s) => assert.equal(stats.status[s], bank.filter((q) => q.status === s).length));
});

test("enough verified questions for a 50-question mock exam", () => {
  assert.ok(bank.filter((q) => q.status === "verified").length >= 50);
});

test("glossary terms appear in the question data", () => {
  const corpus = bank.map((q) => [q.stem, q.code || "", ...(q.options || []), ...(q.dropdowns || []).flatMap((d) => d.choices), q.explanation].join(" ").toLowerCase());
  glossary.terms.forEach((t) => {
    assert.match(t.url, /^https:\/\/learn\.microsoft\.com\//);
    assert.ok(corpus.some((text) => t.match.some((m) => text.includes(m))), `${t.term} not found in questions`);
    t.domains.forEach((d) => assert.ok(domains.domains.some((x) => x.id === d)));
  });
});

test("every adopted question has a Japanese translation aligned with the English data", () => {
  bank.forEach((q) => {
    const t = ja[q.id];
    assert.ok(t && t.status !== "untranslated", `${q.id} is untranslated`);
    assert.ok(["needs_review", "reviewed"].includes(t.status));
    assert.ok(t.stem && t.explanation, `${q.id} missing stem/explanation`);
    if (q.type === "dropdown") {
      q.dropdowns.forEach((d) => assert.equal(t.dropdowns[d.id].choices.length, d.choices.length, `${q.id} ${d.id}`));
    } else {
      assert.equal(t.options.length, q.options.length, `${q.id} options`);
    }
  });
  assert.equal(Object.keys(ja).length, bank.length);
});

test("translations are never marked human-reviewed by tooling", () => {
  const meta = read("data/i18n/ja.json")._meta;
  const reviewed = Object.entries(ja).filter(([, t]) => t.status === "reviewed");
  reviewed.forEach(([id, t]) => assert.ok(t.reviewedBy && t.reviewedBy !== "ai", `${id} reviewed without a human reviewer`));
  assert.ok(meta && meta.statusPolicy, "status policy must be documented in ja.json");
});
