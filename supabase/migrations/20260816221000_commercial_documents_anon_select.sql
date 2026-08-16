-- El ERP lee commercial_documents con la clave anon (loadState).
-- create_commercial_document_v1 es SECURITY DEFINER (escribe OK),
-- pero sin política SELECT para anon la lista queda vacía tras guardar.

alter table public.commercial_documents enable row level security;

drop policy if exists commercial_documents_anon_select on public.commercial_documents;
create policy commercial_documents_anon_select
  on public.commercial_documents
  for select
  to anon
  using (true);

grant select on public.commercial_documents to anon;
