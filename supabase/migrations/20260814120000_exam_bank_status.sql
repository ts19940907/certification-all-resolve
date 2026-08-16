-- 共有試験バンク生成状態

alter table public.certifications
  add column if not exists exam_bank_status text not null default 'none';

alter table public.certifications
  drop constraint if exists certifications_exam_bank_status_check;

alter table public.certifications
  add constraint certifications_exam_bank_status_check
  check (
    exam_bank_status in (
      'none',
      'generating',
      'pilot_ready',
      'ready',
      'failed'
    )
  );

alter table public.certifications
  add column if not exists exam_bank_message text;

comment on column public.certifications.exam_bank_status is
  '共有試験バンクの状態: none / generating / pilot_ready / ready / failed';
comment on column public.certifications.exam_bank_message is
  '生成中・失敗時のメッセージ';
