#!/usr/bin/env python3
"""Mechanical checks for data/i18n/ja.json against the English bank.

These checks catch translation slips that a machine can see: changed code tokens or
product names, lost numbers, lost negations/limits, answer-length bias and placeholder
changes. They do not prove the meaning matches; translations stay "needs_review" until a
human compares them with the English source.

Run: python3 scripts/check_translations.py [--json]
Exit code 1 when a hard error is found (missing translation, changed answer alignment,
missing code token).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "data" / "bank.json"
JA = ROOT / "data" / "i18n" / "ja.json"

PRODUCT_NAMES = [
    "Azure AI Search", "Content Understanding", "Document Intelligence", "Foundry", "Voice Live",
    "Sora", "Translator", "Content Safety", "Video Indexer", "Azure OpenAI", "Speech SDK",
    "Image Analysis", "Custom Neural Voice", "Agent Framework", "DefaultAzureCredential",
]
# Must survive translation verbatim: identifiers, calls, CamelCase class names, acronyms, numbers.
CODE_TOKEN = re.compile(
    r"[A-Za-z_][A-Za-z0-9_]*\([^)]*\)"  # call()
    r"|[A-Za-z0-9]+(?:[._][A-Za-z0-9]+)+"  # dotted or snake_case identifiers
    r"|_[A-Za-z0-9_]+|[A-Za-z0-9]+_"  # leading/trailing underscore identifiers
    r"|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+"  # CamelCase
    r"|\b[A-Z]{2,}[0-9]*\b"  # acronyms
    r"|\b\d+(?:\.\d+)?\b"  # numbers
)
# An option that is only a hyphenated/slashed token is usually a value (prebuilt-invoice): warn if it changed.
SOFT_TOKEN = re.compile(r"\b[a-z0-9]+(?:[-/][a-z0-9]+)+\b")
NEGATION_EN = re.compile(r"\b(not|no|never|without|only|cannot|can't|don't|doesn't|isn't)\b", re.I)
NEGATION_JA = re.compile(r"ない|ず|せず|なし|無し|以外|のみ|だけ|しか|専用|不要|禁止|無効|せん|不可|欠")


def protected_tokens(text: str) -> set[str]:
    tokens = set(CODE_TOKEN.findall(text or ""))
    tokens |= {name for name in PRODUCT_NAMES if name in (text or "")}
    return {t for t in tokens if t not in {"AI"}}


def pairs(q, t):
    """Yield (field, english, japanese) text pairs."""
    yield "stem", q["stem"], t.get("stem", "")
    if q["type"] == "dropdown":
        for d in q["dropdowns"]:
            td = (t.get("dropdowns") or {}).get(d["id"], {})
            for i, choice in enumerate(d["choices"]):
                ja = (td.get("choices") or [None] * len(d["choices"]))[i] if i < len(td.get("choices") or []) else ""
                yield f"{d['id']}.choice{i}", choice, ja or ""
    else:
        for i, option in enumerate(q["options"]):
            ja = (t.get("options") or [])[i] if i < len(t.get("options") or []) else ""
            yield f"option{i}", option, ja or ""


def unique_longest(texts, index):
    lengths = [len(x) for x in texts]
    return lengths[index] == max(lengths) and lengths.count(max(lengths)) == 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args()
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    ja = json.loads(JA.read_text(encoding="utf-8")).get("questions", {}) if JA.exists() else {}

    errors, warnings = [], []
    bias = {"singleQuestions": 0, "englishCorrectLongest": 0, "japaneseCorrectLongest": 0, "newlyLongest": []}
    for q in bank:
        t = ja.get(q["id"])
        if not t or t.get("status") == "untranslated":
            errors.append((q["id"], "untranslated", "日本語訳がない"))
            continue
        for field, en, jp in pairs(q, t):
            if not jp.strip():
                errors.append((q["id"], field, "訳が空"))
                continue
            missing = sorted(tok for tok in protected_tokens(en) if tok not in jp)
            if missing:
                errors.append((q["id"], field, f"英語のトークンが訳にない: {', '.join(missing)}"))
            if field != "stem" and SOFT_TOKEN.fullmatch(en.strip()) and en.strip() not in jp:
                warnings.append((q["id"], field, f"値の可能性がある選択肢が訳で変わった（意図した翻訳か確認）: {en.strip()}"))
            if field != "stem" and en.strip() == en.strip().strip("\"'") and (CODE_TOKEN.fullmatch(en.strip()) or (q["type"] == "dropdown" and " " not in en.strip())) and jp != en:
                warnings.append((q["id"], field, f"コード・値の可能性がある選択肢が変わった: {en} → {jp}"))
            if NEGATION_EN.search(en) and not NEGATION_JA.search(jp):
                warnings.append((q["id"], field, f"否定・限定の語（{NEGATION_EN.search(en).group(0)}）に対応する表現が見当たらない"))
        if sorted(re.findall(r"\[\[drop\d+\]\]", q["stem"])) != sorted(re.findall(r"\[\[drop\d+\]\]", t.get("stem", ""))):
            errors.append((q["id"], "stem", "空欄のプレースホルダーが変わった"))
        if q["type"] == "single":
            bias["singleQuestions"] += 1
            i = q["answer"][0]
            en_long = unique_longest(q["options"], i)
            ja_long = unique_longest(t["options"], i)
            bias["englishCorrectLongest"] += en_long
            bias["japaneseCorrectLongest"] += ja_long
            if ja_long and not en_long:
                bias["newlyLongest"].append(q["id"])
        if not t.get("references"):
            warnings.append((q["id"], "references", "参照 URL がない"))

    report = {
        "translated": sum(1 for q in bank if q["id"] in ja and ja[q["id"]].get("status") != "untranslated"),
        "total": len(bank),
        "errors": errors,
        "warnings": warnings,
        "lengthBias": bias,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(f"translated {report['translated']}/{report['total']}")
        print(
            f"answer-length bias (single choice, correct option is the unique longest): "
            f"English {bias['englishCorrectLongest']}/{bias['singleQuestions']}, "
            f"Japanese {bias['japaneseCorrectLongest']}/{bias['singleQuestions']}, "
            f"newly longest in Japanese: {', '.join(bias['newlyLongest']) or 'none'}"
        )
        for qid, field, message in errors:
            print(f"ERROR {qid} {field}: {message}")
        for qid, field, message in warnings:
            print(f"WARN  {qid} {field}: {message}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
