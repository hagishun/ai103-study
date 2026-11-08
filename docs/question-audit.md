# 問題データ 品質監査レポート

- 対象: [pvejayan/ai103-exam-simulator](https://github.com/pvejayan/ai103-exam-simulator) の `data/questions.json`（コミット `b610ef44d54b3820026603f59a1e8ca7ad64f4dc`、2026-05-06）。このリポジトリでは `data/source/questions.json` に無改変で保存しています。
- 監査日: 2026-11-08
- 基準: [Exam AI-103 Study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103)（Skills measured as of April 16, 2026）。分野定義は [`data/domains.json`](../data/domains.json) に問題データと分けて保存しています。
- 生成スクリプト: [`scripts/build_data.py`](../scripts/build_data.py)。`python3 scripts/build_data.py` で、下記の数値と生成ファイルを再現できます。

## 1. 結論

| 項目 | 結果 |
|---|---|
| 元の問題数 | 748 問（元 README の「600問」はデータと不一致） |
| 完全一致を統合した後 | 425 問 |
| 重複除去後の問題数（サイトで使用） | **172 問**（576 問を統合） |
| 品質状態 | verified 169 / unverified 0 / outdated 2 / ambiguous 1 / out_of_scope 0 |
| 通常の出題対象 | verified の 169 問（outdated・ambiguous・out_of_scope は出題しない） |
| カバレッジ不足のスキル | 3 項目（1.4.2、2.3.2、3.2.7） |

正答キーは公式ドキュメントで確認できました。ただし、**誤答の選択肢が易しく、模試の正答率は実力より高く出やすい**ため、合否の予測には使えません（[6. 既知の制約](#6-既知の制約)）。

## 2. 元リポジトリとライセンス

- ライセンス: MIT License（Copyright (c) 2026 Praba Vejayan）。[`LICENSE`](../LICENSE) をそのまま保持し、サイトのフッターと README に出典とライセンスを表示しています。
- 元データは変更していません。改変（重複除去・品質分類・日本語解説）は別ファイルとスクリプトで行い、元データとの対応は統合記録で追えます。
- 元リポジトリには変更を加えていません（push もしていません）。
- 元の `scripts/export_questions.py` はリポジトリ外のスクリプトに依存していて再現できないため削除しました。Docker 関連ファイルと旧 UI も GitHub Pages では不要なため削除しました（履歴には残っています）。

## 3. 重複除去

### 3.1 方法

1. **完全一致**: 問題文・コード・選択肢・正解・形式が同じ問題。トピック名の末尾番号（"Managed identity basics 1/2/3" など）だけが違うものも含みます。
2. **選択肢の順序違い**: ドロップダウン問題で、選択肢の並び順だけが違うもの（例: #701 と #707）。
3. **定型の問い違い（表現だけ異なる実質同一）**: 同じシナリオ文・同じ選択肢・同じ正解で、末尾の問いだけが次の5種類のいずれかに違うもの。
   - "Which choice best satisfies this requirement?"
   - "Which option is most appropriate?"
   - "Which design decision best matches the scenario?"
   - "What should you implement first?"
   - "Which Microsoft Learn objective does this test most directly?"

   代表として残す問題は、自然に読める問いを優先しました（上の順）。"Which Microsoft Learn objective…"（問いと選択肢が合わない、37問）と "What should you implement first?"（順序を問わない選択肢が多い）は、代表として1問も残っていません。
4. **意味的重複**: 表現は違うが同じ知識を問う問題。候補を、正解の文言の類似度・トピック名・シナリオの類似度で抽出し、内容・選択肢・解説を1組ずつ比較して判断しました。同じ分野・同じ形式で、問う知識が同じ場合だけ統合し、判断が難しいものは残しました。判断の記録は [`data/review/semantic-merges.json`](../data/review/semantic-merges.json) にあります（統合28組、残した候補9組とその理由）。

1〜3 はスクリプトが機械的に判定し、4 は人が判断した結果をファイルに記録してスクリプトに読み込ませています。

### 3.2 結果

| 区分 | 問題数 |
|---|---:|
| 代表として残した問題（canonical） | 172 |
| 完全一致として統合 | 299 |
| 選択肢の順序違いとして統合 | 24 |
| 定型の問い違いとして統合 | 150 |
| 意味的重複として統合（統合されたグループ全体） | 103 |
| **合計** | **748** |

- **削除した問題の元IDと統合先ID**: [`data/dedup-log.csv`](../data/dedup-log.csv)（JSON 版: [`data/dedup-log.json`](../data/dedup-log.json)）。748問すべてについて、元の問題番号・統合先ID・区分・理由を記録しています。
- **問題ID**: 元の問題番号から作る安定ID（例: #13 → `q013`）。代表問題は自分の元番号をIDに使うため、データを再生成しても変わりません。学習履歴はこのIDで保存しています。

## 4. 品質分類

### 4.1 方法

- 代表問題 172 問を1問ずつ、Microsoft Learn を中心とする公式ドキュメントで確認しました。根拠 URL は実際に取得して内容を確認したものだけを記録しています（132 URL、2026-11-08 時点で全件 HTTP 200）。
- 事前監査（抽出50問、[`data/review/audit-sample-2026-11-08.csv`](../data/review/audit-sample-2026-11-08.csv)）の根拠 URL は、同じ内容の問題（完全一致・定型の問い違い・順序違い）に限って引き継ぎました。意味的重複として統合した問題は、代表問題の文言で改めて確認しました。
- 結果は [`data/review/quality.json`](../data/review/quality.json) に、状態・根拠 URL・対応スキル・日本語解説・レビューメモとして保存しています。
- `verified` は根拠 URL がないと設定できません（スクリプトで検査）。未確認の問題を自動で `verified` にはしません。

| 状態 | 意味 | 問題数 |
|---|---|---:|
| verified | 公式ドキュメントで正答を確認済み | 169 |
| unverified | 未検証 | 0 |
| outdated | 古い API・製品仕様を使用 | 2 |
| ambiguous | 設問や正答に曖昧さがある | 1 |
| out_of_scope | 現行試験範囲外 | 0 |

### 4.2 verified 以外の問題

| ID | 状態 | 理由 |
|---|---|---|
| q005 | outdated | 旧 Agents API `project_client.agents.create_agent(..., tool_resources=...)` を使用。Learn は `create_version()` / `PromptAgentDefinition` への移行を案内（[Migrate](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/migrate)） |
| q083 | outdated | 同上。Azure AI Search ツールの接続も現行は `AzureAISearchTool` とプロジェクト接続 |
| q224 | ambiguous | 正解（Echo cancellation）は正しいが、コード内のプロパティ名（`"echo_cancellation": True`、`near_field`）が実際の Voice Live API と異なる |

### 4.3 判断に注意した点

- **発音評価（pronunciation assessment）**: Skills measured に明記はありませんが、speech to text の関連機能として範囲内（4.2.1）と扱いました（q227、q228、q230、q539、q662）。
- **廃止予定の機能**（現時点では現行ドキュメントがあるため verified、レビューメモに記載）:
  - Foundry workflows: 2026-12-01（q394）
  - Prompt flow: 2027-04-20（q309）
  - Azure Language の感情分析・キーフレーズ抽出: 2029-03-31（q219、q220、q240、q242、q527、q664）
  - Image Analysis API: 2028-09-25（q186、q493、q496、q642）
- **名称変更**: Custom Neural Voice → custom voice（q234、q239）、Azure AI Document Intelligence → Azure Document Intelligence in Foundry Tools（q278）。
- **問いに要件が書かれていない**: "Which choice best satisfies this requirement?" で状況だけが書かれた問題（q310 など）は、選択肢から正答が一意に決まるため verified とし、メモに記載しました。
- **原文の解説の誤り**: q701（DefaultAzureCredential は ID を作成しない）など、原文解説の誤りはレビューメモと日本語解説で補足しました。

## 5. 分野別問題数とカバレッジ

### 5.1 分野別

| 分野 | 配点 | 元データ | 完全一致統合後 | 重複除去後 | verified |
|---|---|---:|---:|---:|---:|
| Plan and manage an Azure AI solution | 25–30% | 193 | 111 | 31 | 30 |
| Implement generative AI and agentic solutions | 30–35% | 231 | 129 | 46 | 45 |
| Implement computer vision solutions | 10–15% | 108 | 57 | 23 | 23 |
| Implement text analysis solutions | 10–15% | 108 | 72 | 42 | 41 |
| Implement information extraction solutions | 10–15% | 108 | 56 | 30 | 30 |
| **合計** | | **748** | **425** | **172** | **169** |

形式の内訳: 単一選択 142、複数選択（2つ正解）24、ドロップダウン 6。

### 5.2 スキル別（Skills measured の各項目）

各問題に、最も近いスキルを1〜3個割り当てました（`data/review/quality.json` の `skills`）。サイトの「問題データ」画面に全項目の問題数を表示しています。

**カバレッジ不足（問題 0 問）** — 不足分野の問題は自動生成していません。Microsoft Learn で補ってください。

| スキル | 内容 |
|---|---|
| 1.4.2 | Apply responsible AI instrumentation, including evaluators, safety evaluations, and explanation tooling（品質評価器は 2.1.4 に6問あるが、安全性評価・説明ツールの問題がない） |
| 2.3.2 | Implement model reflection, chain-of-thought evaluations, and self-critique loops |
| 3.2.7 | Configure single-task and pro-mode Content Understanding pipelines |

**問題が少ないスキル（1 問）**: 1.2.2、1.2.3（outdated の1問のみで verified なし）、1.2.4、1.4.3、2.1.5、2.3.4（ハイブリッド LLM＋ルールエンジン）、3.1.2、3.1.4（生成動画の編集）、3.2.5、3.2.8、4.1.4、4.2.3。
1.3.2 は2問ありますが、どちらも groundedness の監視で、**drift の監視を問う問題はありません**。Azure Translator（4.1.3）も3問だけです。

## 6. 既知の制約

| 制約 | 内容 | 対応 |
|---|---|---|
| 誤答の選択肢が易しい | 多くの問題で誤答肢が無関係（例: "Use only CSS"）。単一選択 142 問中 104 問（73%）で、正解が唯一の最長の選択肢 | 指示書の必須範囲外のため書き換えていない。模試の画面に「合否予測ではない」と表示 |
| 答えがコードに書かれている | コード問題（45問）の多くは、コードを読めば答えがわかる | レビューメモに記載 |
| 原文の解説が短い | 原文の解説は中央値60文字の1文で、参照 URL がなかった | 全問に日本語解説と公式ドキュメントへのリンクを追加 |
| 正解の位置 | 元データの正解は常に A（または A, B）。旧 UI はドロップダウンの選択肢をシャッフルしていなかった | 選択肢・ドロップダウンの選択肢とも、セッションごとにシャッフル |
| 日本語解説 | レビュー時に公式ドキュメントを読んで作成した要約（AI の支援を含む）。外部の翻訳 API は使っていない | 誤りの可能性があるため、根拠リンクで確認すること。原文の英語解説も表示 |
| 公式文書の更新 | 製品名・API は頻繁に変わる。本監査は 2026-11-08 時点 | 試験前に Study guide と Learn を再確認 |

## 7. 既存 UI の再利用評価

- 元の UI（`index.html` / `app.js` / `styles.css`、ビルド不要のバニラ JS）は静的サイトとして GitHub Pages でそのまま動く構成でした。この技術構成（フレームワークなし・ビルドなし）を引き継ぎました。
- 再利用した考え方: 選択肢のシャッフル、複数選択とドロップダウンの採点、localStorage へのセッション保存、分野別の正答率表示。
- 作り直した部分: 画面は英語・PC 前提のレイアウトで、学習履歴・復習・品質状態の表示がなく、1問ごとの解説表示もありませんでした。日本語 UI・モバイルファーストで画面を作り直し、ロジックをテスト可能な [`js/core.js`](../js/core.js) に分離しました。

## 8. 動作確認（公開前）

| 確認項目 | 方法 | 結果 |
|---|---|---|
| 重複除去後の問題数・分野別問題数・品質内訳 | `scripts/build_data.py` と `tests/data.test.js`（748問すべてが統合記録に1回ずつ現れる、ID の安定性、verified に根拠 URL があること など） | OK |
| 出題と採点 | `tests/core.test.js`、`tests/e2e.mjs`（分野別10問、模擬試験50問・分野配分 14/17/7/6/6・未回答は不正解として採点） | OK |
| 複数選択問題の採点 | 単体テスト（部分正解・余分な選択は不正解）と、ブラウザでの回答・採点 | OK |
| ドロップダウン問題の採点 | 単体テストとブラウザでの回答・採点 | OK |
| 学習履歴の保存・復元・リセット | ブラウザテスト（再読み込み後も保持、リセットで消去） | OK |
| 途中再開 | ブラウザテスト（10問中5問回答 → ページを閉じて開き直す → 「続きから再開」で5問目から再開、回答と選択肢の順序を保持） | OK |
| スマートフォン表示 | 幅 360px・タッチ操作で全画面と全172問を表示し、横スクロールが出ないことを確認 | OK |
| PC 表示 | 幅 1280px で表示 | OK |
| ホーム画面に追加（PWA） | manifest・アイコン・service worker を確認し、Chrome のインストール可能性チェックでエラー 0、オフラインで再読み込みしても表示 | OK |
| GitHub Pages | GitHub Actions でテスト後にデプロイし、公開 URL で表示を確認 | README に記載 |
| ライセンス | MIT の著作権表示と許諾文を保持、出典を表示 | OK |

テストの実行方法は README を参照してください。

## 9. データを更新する手順

1. 出題範囲が変わったら `data/domains.json` を更新する。
2. 意味的重複の判断を変える場合は `data/review/semantic-merges.json` を、品質状態・根拠 URL・日本語解説を変える場合は `data/review/quality.json` を編集する。
3. `python3 scripts/build_data.py` を実行して `data/bank.json` などを再生成し、`npm test` を実行する。
4. main に push すると、GitHub Actions がテストしてから GitHub Pages にデプロイする。生成ファイルが古いと CI が失敗します。
