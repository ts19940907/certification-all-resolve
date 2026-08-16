-- 本番試験として保存されていた旧履歴（kind=example_batch）を exam に正規化
-- まとめて解くの上限は 25 問のため、それより多い件数は試験とみなす

update public.histories
set
  kind = 'exam',
  title = '本番試験 — ' || (detail->>'total') || '問'
where kind = 'example_batch'
  and (detail->>'total') ~ '^[0-9]+$'
  and (detail->>'total')::int > 25;
