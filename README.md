# AI-103 学習サイト（非公式）

Microsoft の資格試験 **AI-103（Developing AI Apps and Agents on Azure）** を効率よく学習するための静的 Web サイトです。既存の問題集を重複除去・品質確認し、PC とスマートフォンのブラウザで使えるようにしました。

**公開 URL: https://hagishun.github.io/ai103-study/**

> [!IMPORTANT]
> - Microsoft 非公式の学習教材です。Microsoft、Pearson VUE、MeasureUp とは関係ありません。
> - 問題・解説の正確性は保証しません。試験前に必ず [公式 Study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103) と Microsoft Learn で確認してください。
> - 誤答の選択肢が易しい問題が多いため、正答率は実力より高く出やすく、合否の予測には使えません。準備度の確認には公式の [Practice Assessment](https://aka.ms/AI103-PA) を使ってください。

## 目的

- 既存の問題集を最大限再利用し、重複を除いた問題で効率よく学習する
- 正答を公式ドキュメントで確認した問題（verified）を優先して出題する
- 公式の出題範囲に対して、問題が足りない分野を把握できるようにする

## 利用方法

ブラウザで公開 URL を開きます。ログインは不要です。

| 機能 | 内容 |
|---|---|
| 分野別学習 | 分野を選び、10・20・50問をランダムに出題。1問ごとに正誤・日本語解説・公式ドキュメントへのリンクを表示 |
| 模擬試験 | 50問を公式の配点比率に合わせてランダムに出題し、最後に採点。分野別の正答率と間違えた問題を確認できる。制限時間（100分）は任意 |
| 復習 | 直近で間違えた問題だけを再出題。正解した問題も含めることができる |
| 学習履歴 | 回答回数・正答率・分野別の成績・最近の回答を表示。リセットもできる |
| 問題データ | 重複除去の結果、品質状態の内訳、スキル別のカバレッジ（問題がない分野は「カバレッジ不足」と表示）、全問題の一覧 |
| 用語集 | 問題に出てくる製品名・役割・関連分野・Microsoft Learn へのリンク |

- **出題する問題**: ホーム画面で「検証済みのみ（推奨）」と「未検証も含める」を切り替えられます。未検証の問題には出題時に「未検証」と表示します。古い仕様・曖昧・範囲外の問題は出題しません。
- **途中再開**: 回答のたびに進行状況をブラウザに保存します。途中で閉じても、次に開いたときにホーム画面の「続きから再開」で再開できます。
- **ホーム画面に追加**: PWA に対応しています。iPhone は Safari の共有メニューから「ホーム画面に追加」、Android は Chrome のメニューから「ホーム画面に追加」（または「アプリをインストール」）を選ぶと、アプリのように起動できます。一度開いたページはオフラインでも表示できます。
- **プライバシー**: 学習履歴はその端末のブラウザ（localStorage）にだけ保存し、外部へ送信しません。端末やブラウザを変えると履歴は引き継がれません。
- 画面は日本語、問題文と選択肢は原文の英語のままです。

## 問題データ

| 項目 | 値 |
|---|---|
| 元の問題数 | 748 問 |
| 重複除去後 | **172 問**（完全一致・選択肢の順序違い・定型の問い違い・意味的重複を統合） |
| 品質状態 | verified 169 / outdated 2 / ambiguous 1 / unverified 0 / out_of_scope 0 |
| 分野別（重複除去後） | 計画と管理 31・生成AIとエージェント 46・コンピュータービジョン 23・テキスト分析 42・情報抽出 30 |

詳細は [品質監査レポート（docs/question-audit.md）](docs/question-audit.md) を参照してください。

| ファイル | 内容 |
|---|---|
| [`data/source/questions.json`](data/source/questions.json) | 元データ（無改変） |
| [`data/domains.json`](data/domains.json) | 試験の分野・スキル定義（Study guide、Skills measured as of April 16, 2026）。問題データとは別に管理 |
| [`data/review/semantic-merges.json`](data/review/semantic-merges.json) | 意味的重複の統合判断と、残した候補 |
| [`data/review/quality.json`](data/review/quality.json) | 問題ごとの品質状態・公式根拠 URL・対応スキル・日本語解説・レビューメモ |
| [`data/bank.json`](data/bank.json) | サイトで使う問題（生成ファイル） |
| [`data/dedup-log.csv`](data/dedup-log.csv) | 元の問題番号 → 統合先 ID の記録（生成ファイル） |
| [`data/stats.json`](data/stats.json) | 件数の集計（生成ファイル） |
| [`data/glossary.json`](data/glossary.json) | 用語集 |

### 出典

問題データは [pvejayan/ai103-exam-simulator](https://github.com/pvejayan/ai103-exam-simulator)（コミット `b610ef4`、2026-05-06）を元にしています。元リポジトリは変更していません。

## 開発

ビルド不要の静的サイト（HTML / CSS / バニラ JavaScript）です。バックエンド、データベース、認証、外部 AI API は使っていません。

```bash
# ローカルで表示（http://localhost:8000/）
python3 -m http.server 8000

# 問題データを再生成（data/review/*.json や data/domains.json を変更したとき）
python3 scripts/build_data.py

# テスト
npm install
npm test            # ロジックとデータの単体テスト
npm run test:e2e    # Chrome で 360px のスマホ表示・途中再開・PWA などを確認
```

main に push すると、GitHub Actions（[`.github/workflows/pages.yml`](.github/workflows/pages.yml)）がデータの整合性チェックとテストを実行し、GitHub Pages にデプロイします。

## ライセンス

[MIT License](LICENSE)。元の問題集の著作権表示（Copyright (c) 2026 Praba Vejayan）と許諾文を保持しています。
