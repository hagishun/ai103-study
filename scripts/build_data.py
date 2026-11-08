#!/usr/bin/env python3
"""Build the study-site question bank from the unmodified source data.

Inputs (all in the repository):
  data/source/questions.json        original bank from pvejayan/ai103-exam-simulator (never edited)
  data/domains.json                 AI-103 skills measured (kept separate from question data)
  data/review/semantic-merges.json  manual decisions for semantic (paraphrased) duplicates
  data/review/quality.json          per-question quality status, evidence URLs, notes, skills

Outputs:
  data/bank.json        de-duplicated questions used by the site
  data/dedup-log.json   every source question number -> canonical question ID
  data/dedup-log.csv    same as above, readable on GitHub
  data/stats.json       counts used by the site and docs/question-audit.md

Run: python3 scripts/build_data.py [--check]
  --check  fail if generated files are out of date (used in CI)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCE = DATA / "source" / "questions.json"
DOMAINS = DATA / "domains.json"
MERGES = DATA / "review" / "semantic-merges.json"
QUALITY = DATA / "review" / "quality.json"
OUT_BANK = DATA / "bank.json"
OUT_LOG_JSON = DATA / "dedup-log.json"
OUT_LOG_CSV = DATA / "dedup-log.csv"
OUT_STATS = DATA / "stats.json"

# Generic closing questions appended to the same scenario. Listed in the order used to
# pick the canonical wording: the first ones read naturally for any option list.
TEMPLATE_TAILS = [
    "Which choice best satisfies this requirement?",
    "Which option is most appropriate?",
    "Which design decision best matches the scenario?",
    "What should you implement first?",
    "Which Microsoft Learn objective does this test most directly?",
]
INCOHERENT_TAIL = "Which Microsoft Learn objective does this test most directly?"
STATUSES = ["verified", "unverified", "outdated", "ambiguous", "out_of_scope"]
TYPE_MAP = {
    "Single answer": "single",
    "Multiple response (2 correct)": "multiple",
    "Dropdown choice": "dropdown",
}


def qid(number: int) -> str:
    return f"q{number:03d}"


def split_tail(stem: str) -> tuple[str, str | None]:
    for tail in TEMPLATE_TAILS:
        if stem.endswith(" " + tail):
            return stem[: -len(tail) - 1], tail
    return stem, None


def correct_texts(q: dict) -> list[str]:
    if q.get("dropdowns"):
        return [d["correctAnswer"] for d in q["dropdowns"]]
    letters = [part.strip() for part in q["answer"].split(",")]
    return sorted(q["options"][ord(letter) - 65] for letter in letters)


def exact_key(q: dict) -> str:
    return json.dumps(
        [q["type"], q["stem"], q.get("code"), q.get("options"), q.get("answer"), q.get("dropdowns")],
        sort_keys=True,
        ensure_ascii=False,
    )


def scenario_key(q: dict) -> str:
    """Same scenario, same code, same choices (any order), same correct answer."""
    scenario, _ = split_tail(q["stem"])
    dropdowns = None
    if q.get("dropdowns"):
        dropdowns = [[d["id"], sorted(d["choices"]), d["correctAnswer"]] for d in q["dropdowns"]]
    return json.dumps(
        [q["type"], scenario, q.get("code"), sorted(q.get("options") or []), correct_texts(q), dropdowns],
        sort_keys=True,
        ensure_ascii=False,
    )


def wording_rank(q: dict) -> tuple[int, int]:
    _, tail = split_tail(q["stem"])
    rank = -1 if tail is None else TEMPLATE_TAILS.index(tail)
    return (rank, q["number"])


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def build():
    source = load_json(SOURCE)
    domains = load_json(DOMAINS)
    merges = load_json(MERGES, {"merges": []})["merges"]
    quality = {k: v for k, v in load_json(QUALITY, {}).items() if not k.startswith("_")}

    numbers = [q["number"] for q in source]
    assert len(numbers) == len(set(numbers)), "source question numbers must be unique"
    by_number = {q["number"]: q for q in source}

    section_to_domain = {}
    skill_ids = set()
    for domain in domains["domains"]:
        for section in domain["sourceSections"]:
            section_to_domain[section] = domain["id"]
        for group in domain["groups"]:
            for skill in group["skills"]:
                skill_ids.add(skill["id"])

    # 1) exact duplicates + template/choice-order variants share a scenario key
    groups: "OrderedDict[str, list[int]]" = OrderedDict()
    for q in source:
        groups.setdefault(scenario_key(q), []).append(q["number"])
    group_of = {}
    group_members = {}
    for key, members in groups.items():
        canonical = min(members, key=lambda n: wording_rank(by_number[n]))
        group_members[canonical] = sorted(members)
        for n in members:
            group_of[n] = canonical

    # 2) semantic duplicates (manual decisions)
    semantic_reason = {}
    for merge in merges:
        removed_group = group_of[merge["removed"]]
        target_group = group_of[merge["canonical"]]
        assert removed_group != target_group, f"merge {merge} is already in one group"
        assert removed_group in group_members, f"group of {merge['removed']} was already merged"
        a, b = by_number[removed_group], by_number[target_group]
        assert a["section"] == b["section"], f"semantic merge across sections: {merge}"
        assert a["type"] == b["type"], f"semantic merge across question types: {merge}"
        for n in group_members.pop(removed_group):
            group_of[n] = target_group
            group_members[target_group].append(n)
            semantic_reason[n] = merge["reason"]
        group_members[target_group].sort()

    # 3) canonical questions
    bank = []
    log_rows = []
    for canonical in sorted(group_members):
        q = by_number[canonical]
        cid = qid(canonical)
        members = group_members[canonical]
        review = quality.get(cid, {})
        status = review.get("status", "unverified")
        evidence = review.get("evidence", [])
        notes = review.get("notes", "")
        skills = review.get("skills", [])
        _, tail = split_tail(q["stem"])
        if tail == INCOHERENT_TAIL and status == "verified":
            raise SystemExit(f"{cid}: question and options do not match; cannot be verified")
        assert status in STATUSES, f"{cid}: unknown status {status}"
        if status == "verified":
            assert evidence, f"{cid}: verified questions need at least one evidence URL"
        for url in evidence:
            assert url.startswith("https://"), f"{cid}: evidence must be an https URL: {url}"
        for skill in skills:
            assert skill in skill_ids, f"{cid}: unknown skill id {skill}"

        record = OrderedDict()
        record["id"] = cid
        record["sourceNumbers"] = members
        record["domain"] = section_to_domain[q["section"]]
        record["skills"] = skills
        record["type"] = TYPE_MAP[q["type"]]
        record["topic"] = q["topic"].rstrip("0123456789 ").strip() or q["topic"]
        record["stem"] = q["stem"]
        record["code"] = q.get("code")
        if record["type"] == "dropdown":
            record["dropdowns"] = [
                {"id": d["id"], "choices": d["choices"], "answer": d["correctAnswer"], "explanation": d.get("explanation", "")}
                for d in q["dropdowns"]
            ]
        else:
            record["options"] = q["options"]
            record["answer"] = [ord(part.strip()) - 65 for part in q["answer"].split(",")]
        record["explanation"] = q["explanation"]
        record["explanationJa"] = review.get("explanationJa", "")
        record["status"] = status
        record["evidence"] = evidence
        record["notes"] = notes
        bank.append(record)

        exact = exact_key(q)
        for n in members:
            m = by_number[n]
            if n == canonical:
                relation, reason = "canonical", ""
            elif n in semantic_reason:
                relation, reason = "semantic_duplicate", semantic_reason[n]
            elif exact_key(m) == exact:
                relation, reason = "exact_duplicate", "問題文・コード・選択肢・正解が完全一致"
            elif m["stem"] == q["stem"]:
                relation, reason = "choice_order_variant", "選択肢の並び順だけが異なる"
            else:
                relation, reason = "template_variant", "同じシナリオ・選択肢・正解で、末尾の定型の問いだけが異なる"
            log_rows.append(
                OrderedDict(
                    sourceNumber=n,
                    sourceId=qid(n),
                    canonicalId=cid,
                    relation=relation,
                    reason=reason,
                    sourceStem=m["stem"],
                )
            )
    log_rows.sort(key=lambda row: row["sourceNumber"])

    stats = make_stats(source, bank, log_rows, domains)
    return bank, log_rows, stats


def make_stats(source, bank, log_rows, domains):
    relation_counts = Counter(row["relation"] for row in log_rows)
    by_domain = OrderedDict()
    for domain in domains["domains"]:
        items = [q for q in bank if q["domain"] == domain["id"]]
        by_domain[domain["id"]] = OrderedDict(
            name=domain["name"],
            source=sum(1 for q in source if q["section"] in domain["sourceSections"]),
            total=len(items),
            status=OrderedDict((s, sum(1 for q in items if q["status"] == s)) for s in STATUSES),
        )
    skills = OrderedDict()
    for domain in domains["domains"]:
        for group in domain["groups"]:
            for skill in group["skills"]:
                items = [q for q in bank if skill["id"] in q["skills"]]
                skills[skill["id"]] = OrderedDict(
                    total=len(items),
                    verified=sum(1 for q in items if q["status"] == "verified"),
                )
    return OrderedDict(
        sourceTotal=len(source),
        afterExactDedup=len({exact_key(q) for q in source}),
        total=len(bank),
        removed=len(source) - len(bank),
        relations=OrderedDict((k, relation_counts.get(k, 0)) for k in [
            "canonical", "exact_duplicate", "choice_order_variant", "template_variant", "semantic_duplicate"
        ]),
        status=OrderedDict((s, sum(1 for q in bank if q["status"] == s)) for s in STATUSES),
        type=OrderedDict((t, sum(1 for q in bank if q["type"] == t)) for t in ["single", "multiple", "dropdown"]),
        domains=by_domain,
        skills=skills,
        unmappedQuestions=[q["id"] for q in bank if not q["skills"]],
        uncoveredSkills=[sid for sid, item in skills.items() if item["total"] == 0],
        unverifiedOnlySkills=[sid for sid, item in skills.items() if item["total"] > 0 and item["verified"] == 0],
    )


def render(bank, log_rows, stats):
    outputs = {}
    outputs[OUT_BANK] = json.dumps(bank, ensure_ascii=False, indent=1) + "\n"
    outputs[OUT_LOG_JSON] = json.dumps(log_rows, ensure_ascii=False, indent=1) + "\n"
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(log_rows[0].keys()), lineterminator="\n")
    writer.writeheader()
    writer.writerows(log_rows)
    outputs[OUT_LOG_CSV] = buffer.getvalue()
    outputs[OUT_STATS] = json.dumps(stats, ensure_ascii=False, indent=1) + "\n"
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files are stale")
    args = parser.parse_args()
    bank, log_rows, stats = build()
    outputs = render(bank, log_rows, stats)
    if args.check:
        stale = [str(p.relative_to(ROOT)) for p, text in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("Generated data is out of date. Run python3 scripts/build_data.py:", ", ".join(stale))
            return 1
        print("Generated data is up to date.")
        return 0
    for path, text in outputs.items():
        path.write_text(text, encoding="utf-8")
    print(
        f"source={stats['sourceTotal']} exact-dedup={stats['afterExactDedup']} canonical={stats['total']} "
        f"removed={stats['removed']} status={dict(stats['status'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
