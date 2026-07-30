insert into public.erp_consecutivos(clave,valor,updated_at)
select 'cotizacion',
       coalesce(max((regexp_match(number,'([0-9]+)'))[1]::integer),0),
       now()
from public.commercial_documents where document_type='quotation'
on conflict (clave) do update
set valor=greatest(public.erp_consecutivos.valor,excluded.valor),updated_at=now();

insert into public.erp_consecutivos(clave,valor,updated_at)
select 'orden',
       coalesce(max((regexp_match(number,'([0-9]+)'))[1]::integer),0),
       now()
from public.commercial_documents where document_type='sales_order'
on conflict (clave) do update
set valor=greatest(public.erp_consecutivos.valor,excluded.valor),updated_at=now();

insert into public.erp_consecutivos(clave,valor,updated_at)
select 'prefactura',
       coalesce(max((regexp_match(number,'([0-9]+)'))[1]::integer),0),
       now()
from public.commercial_documents where document_type='proforma'
on conflict (clave) do update
set valor=greatest(public.erp_consecutivos.valor,excluded.valor),updated_at=now();
