# Changelog

## v2.0.0 - 2026-11-08（ai103-study）

- GitHub Pages で動く日本語の学習サイトに作り直し（分野別学習・50問の模擬試験・復習・学習履歴・問題データ・用語集）。
- 問題データを重複除去（748問 → 172問）し、元ID→統合先IDの記録を追加。
- 全問題の品質状態（verified など）、公式根拠 URL、日本語解説を追加。
- 分野定義を `data/domains.json` に分離し、スキル別のカバレッジ不足を表示。
- モバイルファーストのレイアウト、途中再開、PWA（ホーム画面に追加・オフライン表示）に対応。
- Docker 関連ファイルと旧 UI を削除し、GitHub Actions でテストとデプロイを自動化。
- 全 172 問の日本語訳（問題文・選択肢・解説）を追加し、日本語を初期表示に。画面上部の1タップで英語原文に切り替え（回答・正誤は保持）。翻訳状態（未翻訳／要確認／確認済み）を管理。

## v1.2.0 - 2026-05-06

- Expanded the practice bank to 600 questions weighted to the Microsoft Learn AI-103 skills measured.
- Changed exam simulation to draw 100 randomized questions from the larger bank on each attempt.
- Added full bank review mode for working through every question.
- Kept quick, code, speech, and section modes randomized on each start.

## v1.1.0 - 2026-05-06

- Added Microsoft Learn-grounded Speech and Voice Live practice questions.
- Added Speech practice mode.
- Added Cancel exam control.
- Added in-app test-taker guide.
- Added repository test-taker guide.

## v1.0.0 - 2026-05-06

- Initial Dockerized AI-103 exam simulator.
- Added 300 original practice questions.
- Added full, quick, code, and section practice modes.
- Added timer, flagging, pass/fail simulation, explanations, and section breakdown.
