-- DROP seguro de legacy_docs: respaldo completo + eliminación.
-- El ERP ya no lee ni escribe esta tabla.

create table if not exists public.backup_legacy_docs_20260816 as
table public.legacy_docs;

comment on table public.backup_legacy_docs_20260816 is
  'Respaldo de legacy_docs antes del DROP 2026-08-16. Solo archivo; no usar en runtime.';

drop table if exists public.legacy_docs;
