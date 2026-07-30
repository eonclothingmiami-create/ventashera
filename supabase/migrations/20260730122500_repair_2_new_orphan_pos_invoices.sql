-- Repara dos ventas creadas desde una pestaña antigua todavía abierta después
-- de la primera reparación. El dinero no se modifica: solo se enlaza.

create temporary table _repair2 on commit drop as
select
  s.invoice_id::uuid invoice_id,
  min(s.invoice_number) old_number,
  s.fecha,
  sum(s.subtotal) total,
  min(s.created_at) created_at,
  min(s.canal) canal,
  min(nullif(s.cliente_nombre, '')) cliente_nombre,
  min(nullif(s.cliente_telefono, '')) cliente_telefono,
  null::text new_number
from public.sale_items s
left join public.invoices i on i.id::text=s.invoice_id
where i.id is null and s.source='pos' and s.fecha=current_date
group by s.invoice_id, s.fecha;

create temporary table _repair2_money on commit drop as
select r.invoice_id, t.id movement_id, t.valor, t.metodo
from _repair2 r
join public.tes_movimientos t
  on t.invoice_id is null
 and t.fecha=r.fecha
 and t.concepto ilike '%'||r.old_number||'%'
 and abs(extract(epoch from(t.created_at-r.created_at)))<10;

do $$
declare v_count integer; v_total numeric; v_money integer; v_money_total numeric;
begin
  select count(*),coalesce(sum(total),0) into v_count,v_total from _repair2;
  select count(*),coalesce(sum(valor),0) into v_money,v_money_total from _repair2_money;
  if v_count<>2 or v_total<>160000 or v_money<>2 or v_money_total<>160000 then
    raise exception 'repair2 guard failed: invoices %/% money %/%',
      v_count,v_total,v_money,v_money_total;
  end if;
end $$;

do $$
declare r record; v_counter bigint;
begin
  for r in select invoice_id from _repair2 order by created_at,invoice_id loop
    v_counter:=public.increment_erp_consecutivo('factura');
    update _repair2
       set new_number='POS-'||lpad(v_counter::text,5,'0')
     where invoice_id=r.invoice_id;
  end loop;
end $$;

insert into public._bak_pos_orphan_repair_20260730(
  invoice_id,old_invoice_number,repaired_invoice_number,payload
)
select r.invoice_id,r.old_number,r.new_number,
  jsonb_build_object(
    'reason','stale_browser_duplicate_number_after_initial_repair',
    'sale_items',(select jsonb_agg(to_jsonb(s)) from public.sale_items s where s.invoice_id=r.invoice_id::text),
    'money_movements',(select jsonb_agg(to_jsonb(t)) from _repair2_money m join public.tes_movimientos t on t.id=m.movement_id where m.invoice_id=r.invoice_id),
    'stock_moves',(select coalesce(jsonb_agg(to_jsonb(sm)),'[]'::jsonb) from public.stock_moves sm where sm.documento_id=r.invoice_id)
  )
from _repair2 r
on conflict(invoice_id) do nothing;

insert into public.invoices(
  id,number,customer_name,customer_phone,total,created_at,subtotal,iva,flete,
  fecha,canal,metodo_pago,estado,tipo,items,es_separado,tipo_pago
)
select
  r.invoice_id,r.new_number,r.cliente_nombre,r.cliente_telefono,r.total,
  r.created_at,r.total,0,0,r.fecha,coalesce(nullif(r.canal,''),'vitrina'),
  coalesce((select min(nullif(m.metodo,'')) from _repair2_money m where m.invoice_id=r.invoice_id),'efectivo'),
  'pagada','pos',
  (select jsonb_agg(jsonb_build_object(
    'articuloId',s.product_id,'nombre',s.product_name,'talla',coalesce(s.talla,''),
    'qty',s.qty,'cantidad',s.qty,'precio',s.unit_price,'price',s.unit_price
  ) order by s.created_at,s.id) from public.sale_items s where s.invoice_id=r.invoice_id::text),
  false,'contado'
from _repair2 r;

insert into public.ventas(
  id,fecha,canal,valor,cliente,telefono,liquidado,es_separado,estado_entrega,
  referencia,metodo_pago,archived,tipo_pago,es_contraentrega,
  stock_products_pending,invoice_id
)
select
  r.invoice_id::text,r.fecha,coalesce(nullif(r.canal,''),'vitrina'),r.total,
  coalesce(r.cliente_nombre,''),coalesce(r.cliente_telefono,''),true,false,
  'Pendiente',r.new_number,
  coalesce((select min(nullif(m.metodo,'')) from _repair2_money m where m.invoice_id=r.invoice_id),'efectivo'),
  false,'contado',false,'[]'::jsonb,r.invoice_id
from _repair2 r
on conflict(id) do update
set invoice_id=excluded.invoice_id,referencia=excluded.referencia;

update public.sale_items s
set invoice_number=r.new_number,updated_at=now()
from _repair2 r
where s.invoice_id=r.invoice_id::text;

update public.stock_moves sm
set referencia=r.new_number
from _repair2 r
where sm.documento_id=r.invoice_id;

update public.tes_movimientos t
set invoice_id=r.invoice_id,
    concepto=replace(t.concepto,r.old_number,r.new_number)
from _repair2_money m
join _repair2 r on r.invoice_id=m.invoice_id
where t.id=m.movement_id;

do $$
declare v_orphans integer; v_invoice_total numeric; v_money_total numeric;
begin
  select count(distinct s.invoice_id) into v_orphans
  from public.sale_items s
  left join public.invoices i on i.id::text=s.invoice_id
  where i.id is null and s.source='pos' and s.fecha=current_date;

  select coalesce(sum(total) filter(where estado<>'anulada'),0)
    into v_invoice_total from public.invoices where fecha=current_date;
  select coalesce(sum(valor),0) into v_money_total
    from public.tes_movimientos
   where fecha=current_date and tipo='ingreso' and categoria='venta_pos';

  if v_orphans<>0 or v_invoice_total<>v_money_total then
    raise exception 'repair2 verification failed: orphans %, totals %/%',
      v_orphans,v_invoice_total,v_money_total;
  end if;
end $$;
