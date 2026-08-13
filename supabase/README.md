# Supabase

## 済んでいること

- 初期テーブル: `migrations/20260807103900_init_schema.sql`
- アプリの `.env`（`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`）

## メール認証 + 許可メール（いまやること）

### A. ダッシュボードで Email 認証を有効化

1. **Authentication → Providers → Email** を開く
2. Email を **Enable**
3. 自分用の開発中は、いったん **Confirm email をオフ** にするとログインまで通しやすい  
   （本番前にオンに戻してよい）

### B. 許可メールの SQL を実行

1. **SQL Editor → New query**
2. `migrations/20260807110000_allowed_emails.sql` をすべて Run
3. 続けて、自分のメールを許可リストへ追加（アドレスは書き換える）:

```sql
insert into public.allowed_emails (email)
values ('your@email.com')
on conflict (email) do nothing;
```

`.env` の `ALLOWED_EMAILS` はメモ用です。**実際の判定は DB の `allowed_emails` テーブル**が行います。

### C. アプリ

- 起動するとログイン画面が出ます
- 許可メールで「アカウント登録」→「ログイン」
- 許可外メールは登録できません（RPC + Auth トリガーの二重チェック）

## 資格CRUD用 RPC（選択画面のDB接続）

1. SQL Editor で `migrations/20260807113000_cert_crud_rpc.sql` を Run
2. アプリを再起動し、資格の追加・改名・アーカイブ／復元を試す
3. Table Editor の `certifications` / `user_certifications` に行が増えるか確認

## 例題AI生成（おまかせ）

### A. スキーマ

SQL Editor で `migrations/20260807143000_example_ai_schema.sql` を Run。

資格レコードを更新（ビット: `1`=単一選択, `2`=複数選択, `4`=記述。OR可）:

```sql
update public.certifications
set
  question_format = 1 | 2,  -- 例: 単一+複数
  choice_min = 4,
  choice_max = 6,
  answer_max = 2
where id = 'YOUR_CERT_ID';
```

### B. Edge Function + Gemini

1. [Google AI Studio](https://aistudio.google.com/apikey) で APIキーを発行
2. シークレット登録とデプロイ:

```bash
supabase secrets set GEMINI_API_KEY=your_gemini_api_key
# 任意（未設定時は gemini-2.5-flash）
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase functions deploy generate-example
```

3. アプリで「AIで自動生成」→ 作成中表示のあと一覧に追加される

### C. 条件付き生成（形式・キーワード・参考リンク・画像）

1. SQL Editor で `migrations/20260808120000_example_images_storage.sql` を Run  
   （`example-images` バケットと RLS）
2. 画像再生成モデル（任意。未設定時は `gemini-2.5-flash-image`）:

```bash
supabase secrets set GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
supabase functions deploy generate-example
```

3. アプリの「条件付きで生成」
   - 形式が「おまかせ」かつキーワード・画像・参考リンクがすべて空のときはボタン非活性
   - 参考リンクはページを取得し、出題向け情報を抽出してプロンプトへ
   - 画像は AI が出題利用可否を判定。使える場合はそのまま、使えない場合は描き直して `question_images`（Storage）へ保存
   - 解答画面で問題図を表示

## 資格追加時の照合（正式名称・形式）

1. SQL Editor で `migrations/20260807152000_create_certification_with_format.sql` を Run  
   （`create_certification` が形式付き引数に置き換わります）
2. Function をデプロイ:

```bash
supabase functions deploy validate-certification
```

3. アプリの「資格を追加／改名」→「照合する」→ 確認ダイアログ → 保存  
   - 1件に絞れない／特定不能／対応形式なしは登録・改名を拒否
   - 改名時も正式名称と出題形式レンジを更新（例題・履歴がある資格は従来どおり改名不可）

## 例題へのAI質問

既存の Gemini シークレット（`GEMINI_API_KEY` / 任意で `GEMINI_MODEL`）を使い、次をデプロイ:

```bash
supabase functions deploy ask-example
```

- 答え合わせ後の「AIに質問する」からチャット可能
- やり取りがある状態でダイアログを閉じると `histories`（`kind=example_ai_chat`）に保存
- 実施履歴の「詳細」から同じ例題＋チャットを再開（同じ履歴行を更新）

## 例題図解のPDF

```bash
supabase functions deploy diagram-example
```

- 答え合わせ後の「図解を作成」で、問題の問い／選択肢の意味／正解理由の3部構成図解PDFをダウンロード
- Web／デスクトップ（Electron）向け。`html2pdf.js` を使用

## キーワードの自己説明レビュー

```bash
supabase functions deploy review-keyword
```

- メイン画面右側でキーワード＋説明を入力し「レビューを実施する」
- AIが理解度を A〜D（Aが最高）で評価し、理由・良い点・改善点を返す
- 結果は `histories`（`kind=keyword_review`）に保存。実施履歴の「詳細」から再表示可能

## 例題の削除

SQL Editor で `migrations/20260807160000_fix_example_delete.sql` を Run。  
（削除時の trigger 不整合修正 + `delete_example` RPC）

削除すると、その例題に紐づくAIチャット履歴は再開できなくなります（履歴行自体は残ります）。

## 例題内容の誤り連絡 + 管理者画面

1. SQL Editor で `migrations/20260813100000_example_content_reports.sql` を Run  
   （`users.is_administrator` / `example_content_reports` / RLS）
2. 続けて `migrations/20260813110000_user_notifications.sql` を Run  
   （対応コメント欄 / `user_notifications` / 対応済 RPC）
3. 管理者にするユーザーを SQL で指定（クライアントからは変更不可）:

```sql
update public.users
set is_administrator = true
where mail_address = 'your@email.com';
```

4. アプリ
   - 例題一覧の「誤りを連絡」、解答画面ヘッダーの「誤りを連絡」（答え合わせ前後どちらでも可）
   - 対象（問題文／選択肢・回答／解説／その他）＋自由記述。内部に `example_id` を保存
   - `is_administrator = true` のアカウントのみ、資格選択画面右上に「管理者」→ 問い合わせ一覧
   - 管理者の「対応済にする」→ 対応内容入力 → 確認ダイアログ → 確定で報告者へアプリ内通知
   - 報告者は選択画面・メイン画面の「通知」から既読にし、該当例題を開ける

### メール通知について

追加費用なしで確実な自動メール手段が未確定のため、**今回は DB 保存 + 管理者画面 + 報告者へのアプリ内通知**。  
将来、無料枠の SMTP / 既存メール基盤が用意できたら、新規報告時に管理者へメールする Edge Function を `submitExampleContentReport` 成功後に接続する想定（コード内にコメントあり）。

## 学習分析（カテゴリ／キーワード）

1. SQL Editor で `migrations/20260813120000_cert_analysis_masters.sql` を Run  
   （カテゴリ・キーワードマスタ / `examples.category_id` / マスタ変更問い合わせ用 target）
2. Edge Function をデプロイ（Supabase CLI 未インストールなら `npx` 経由）:

```bash
cd My-app-ADS6
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy seed-cert-analysis
npx supabase functions deploy generate-example
```

（グローバルに入れている場合は `npx` なしの `supabase ...` でも可）

（`generate-example` は例題作成時にカテゴリを保存するよう更新済み）

3. **既存データの一回限りバックフィル**（画面トリガーなし）:

```bash
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_ANON_KEY=your_anon_key \
ACCESS_TOKEN=user_access_token \
node scripts/backfill-cert-analysis.mjs
```

`ACCESS_TOKEN` はログイン済みユーザーの JWT（ブラウザのセッションや Supabase ダッシュボードから取得）。  
対象ユーザーが所有する全資格にマスタを生成し、未分類例題へカテゴリを付与します。

4. アプリ
   - 資格追加時: カテゴリ／キーワードマスタを確認なしで自動生成
   - 例題作成時: カテゴリを保存
   - メイン上部「分析」: 全体／月次／週次のレーダー + キーワード進捗（A/B）
   - 実施履歴の「まとめて解く」詳細: その回のレーダー
   - カテゴリタグ: マスタ全件ダイアログ
   - 例題一覧: コンボ + フィルターボタン
   - マスタ変更は分析ダイアログから問い合わせ（管理者画面で種別表示）
