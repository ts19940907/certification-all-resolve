/**
 * 既存資格のカテゴリ／キーワードマスタ生成 + 未分類例題へのカテゴリ付与
 *
 * 画面トリガーは置きません。Cursor／ターミナルから一度だけ実行します。
 *
 * 事前準備:
 * 1. SQL Editor で migrations/20260813120000_cert_analysis_masters.sql を Run
 * 2. supabase functions deploy seed-cert-analysis
 * 3. アプリにログインできるアカウントの access_token を用意
 *
 * 実行例:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... ACCESS_TOKEN=... node scripts/backfill-cert-analysis.mjs
 */

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const anon = process.env.SUPABASE_ANON_KEY;
const token = process.env.ACCESS_TOKEN;

if (!url || !anon || !token) {
  console.error(
    'SUPABASE_URL / SUPABASE_ANON_KEY / ACCESS_TOKEN を環境変数で渡してください。',
  );
  process.exit(1);
}

const res = await fetch(`${url}/functions/v1/seed-cert-analysis`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    apikey: anon,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ mode: 'backfill_owned' }),
});

const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);
