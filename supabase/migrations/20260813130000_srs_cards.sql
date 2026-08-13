-- SM-2 間隔反復カード（キーワード / 例題）

create table if not exists public.srs_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  certification_id uuid not null references public.certifications (id) on delete cascade,
  kind text not null,
  keyword_text text,
  keyword_back text not null default '',
  example_id uuid references public.examples (id) on delete cascade,
  ease_factor double precision not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  -- アプリは端末ローカル日付を明示セット。DB default はフォールバックのみ
  due_on date not null default (timezone('utc', now()))::date,
  last_rating text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint srs_cards_kind_check
    check (kind in ('keyword', 'example')),
  constraint srs_cards_ease_check
    check (ease_factor >= 1.3),
  constraint srs_cards_interval_check
    check (interval_days >= 0),
  constraint srs_cards_repetitions_check
    check (repetitions >= 0),
  constraint srs_cards_rating_check
    check (
      last_rating is null
      or last_rating in ('again', 'hard', 'good', 'easy')
    ),
  constraint srs_cards_payload_check
    check (
      (
        kind = 'keyword'
        and keyword_text is not null
        and char_length(trim(keyword_text)) > 0
        and example_id is null
      )
      or (
        kind = 'example'
        and example_id is not null
        and keyword_text is null
      )
    )
);

create unique index if not exists srs_cards_user_keyword_unique
  on public.srs_cards (user_id, certification_id, lower(trim(keyword_text)))
  where kind = 'keyword';

create unique index if not exists srs_cards_user_example_unique
  on public.srs_cards (user_id, example_id)
  where kind = 'example';

create index if not exists srs_cards_due_idx
  on public.srs_cards (user_id, certification_id, due_on);

create index if not exists srs_cards_example_id_idx
  on public.srs_cards (example_id)
  where example_id is not null;

comment on table public.srs_cards is
  'Anki SM-2 系の間隔反復カード。キーワードは A/B レビュー後、例題は正解後に登録';

create or replace function public.set_srs_cards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_srs_cards_updated_at on public.srs_cards;
create trigger trg_srs_cards_updated_at
  before update on public.srs_cards
  for each row
  execute function public.set_srs_cards_updated_at();

alter table public.srs_cards enable row level security;

drop policy if exists srs_cards_select_own on public.srs_cards;
create policy srs_cards_select_own
  on public.srs_cards for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists srs_cards_insert_own on public.srs_cards;
create policy srs_cards_insert_own
  on public.srs_cards for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.user_owns_certification(certification_id)
  );

drop policy if exists srs_cards_update_own on public.srs_cards;
create policy srs_cards_update_own
  on public.srs_cards for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists srs_cards_delete_own on public.srs_cards;
create policy srs_cards_delete_own
  on public.srs_cards for delete
  to authenticated
  using (auth.uid() = user_id);
