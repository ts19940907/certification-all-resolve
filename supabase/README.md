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

条件付き生成のAPI接続は未実装（UIの形式選択のみ先行）。

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
