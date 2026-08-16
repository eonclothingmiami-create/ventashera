-- Congela legacy_docs: el ERP ya no escribe ahí (docs atómicos).
-- Se conserva la tabla y sus filas históricas; se revocan escrituras al cliente.

revoke insert, update, delete on public.legacy_docs from anon, authenticated;

comment on table public.legacy_docs is
  'ARCHIVO histórico. No usar para altas nuevas. COT/OV migraron a commercial_documents; FAC/NC/… usan RPC atómicos.';
