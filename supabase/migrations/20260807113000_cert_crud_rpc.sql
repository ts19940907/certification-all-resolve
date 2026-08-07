-- 資格CRUD用 RPC（原子的な作成 + ユーザー行の保証）

create or replace function public.ensure_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.users (id, name, mail_address)
  values (
    v_uid,
    coalesce(nullif(split_part(v_email, '@', 1), ''), 'user'),
    v_email
  )
  on conflict (id) do update
    set mail_address = excluded.mail_address;
end;
$$;

revoke all on function public.ensure_current_user() from public;
grant execute on function public.ensure_current_user() to authenticated;

create or replace function public.create_certification(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_name);
  v_cert_id uuid;
  v_uc_id uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  if v_name is null or v_name = '' then
    raise exception '資格名を入力してください';
  end if;

  perform public.ensure_current_user();

  if exists (
    select 1
    from public.user_certifications uc
    join public.certifications c on c.id = uc.certification_id
    where uc.user_id = v_uid
      and c.name = v_name
  ) then
    raise exception '同じ名前の資格がすでにあります（アーカイブ含む）'
      using errcode = '23505';
  end if;

  insert into public.certifications (name)
  values (v_name)
  returning id into v_cert_id;

  insert into public.user_certifications (certification_id, user_id, is_archive)
  values (v_cert_id, v_uid, false)
  returning id into v_uc_id;

  return jsonb_build_object(
    'id', v_cert_id,
    'userCertificationId', v_uc_id,
    'name', v_name,
    'isArchive', false
  );
end;
$$;

revoke all on function public.create_certification(text) from public;
grant execute on function public.create_certification(text) to authenticated;
