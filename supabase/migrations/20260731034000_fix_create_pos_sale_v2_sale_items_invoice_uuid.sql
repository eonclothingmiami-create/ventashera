-- sale_items.invoice_id es uuid desde 20260730143000, pero create_pos_sale_v2_impl
-- seguía insertando v_invoice_id::text. Eso abortaba toda la transacción POS
-- (factura + venta + stock + caja) y dejaba cero ventas nuevas.
--
-- Fix: invoice_id se inserta como uuid; sale_id sigue siendo text.

create or replace function public.create_pos_sale_v2_impl(p_request jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_operation_id uuid; v_invoice_id uuid; v_hash text; v_existing public.pos_operations%rowtype;
  v_invoice jsonb := coalesce(p_request->'invoice', '{}'::jsonb); v_sale jsonb := coalesce(p_request->'sale', '{}'::jsonb);
  v_lines jsonb := coalesce(p_request->'lines', '[]'::jsonb); v_cash jsonb := coalesce(p_request->'cash', '{}'::jsonb);
  v_cash_lines jsonb := coalesce(p_request->'cash'->'movements', '[]'::jsonb); v_number text; v_counter bigint; v_date date;
  v_subtotal numeric; v_declared_subtotal numeric; v_iva numeric; v_flete numeric; v_total numeric; v_cash_total numeric;
  v_caja_id text; v_session_id text; v_caja public.cajas%rowtype; v_saldos jsonb; v_cash_delta numeric := 0;
  v_line jsonb; v_payment jsonb; v_product record; v_qty integer; v_price numeric; v_product_id uuid; v_move_id uuid;
  v_cash_move_id text; v_bucket text; v_amount numeric; v_response jsonb; v_items jsonb;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated', 'service_role') then raise exception 'create_pos_sale_v2: authentication required' using errcode = '42501'; end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then raise exception 'create_pos_sale_v2: invalid request'; end if;
  begin v_operation_id := (p_request->>'operation_id')::uuid; v_invoice_id := (v_invoice->>'id')::uuid;
  exception when others then raise exception 'create_pos_sale_v2: operation_id and invoice.id must be UUID'; end;
  if coalesce(v_sale->>'id', '') <> v_invoice_id::text or coalesce(v_sale->>'invoice_id', '') <> v_invoice_id::text then raise exception 'create_pos_sale_v2: invoice/sale identifiers differ'; end if;
  v_hash := md5(p_request::text);
  select * into v_existing from public.pos_operations where operation_id = v_operation_id for update;
  if found then if v_existing.request_hash <> v_hash or v_existing.kind <> 'sale' then raise exception 'create_pos_sale_v2: operation_id conflict'; end if; return v_existing.response; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'create_pos_sale_v2: at least one line is required'; end if;
  if jsonb_typeof(v_cash_lines) <> 'array' or jsonb_array_length(v_cash_lines) = 0 then raise exception 'create_pos_sale_v2: cash movements are required'; end if;
  select coalesce(sum((line->>'qty')::integer * (line->>'unit_price')::numeric), 0) into v_subtotal
  from jsonb_array_elements(v_lines) line where (line->>'qty') ~ '^[0-9]+$' and (line->>'unit_price') ~ '^[0-9]+([.][0-9]+)?$';
  if exists (select 1 from jsonb_array_elements(v_lines) line where coalesce(line->>'product_id', '') = '' or coalesce(line->>'qty', '') !~ '^[1-9][0-9]*$' or coalesce(line->>'unit_price', '') !~ '^[0-9]+([.][0-9]+)?$') then raise exception 'create_pos_sale_v2: invalid product, quantity or price'; end if;
  v_declared_subtotal := coalesce((v_invoice->>'subtotal')::numeric, 0); v_iva := greatest(coalesce((v_invoice->>'iva')::numeric, 0), 0); v_flete := greatest(coalesce((v_invoice->>'flete')::numeric, 0), 0); v_total := coalesce((v_invoice->>'total')::numeric, 0);
  if abs(v_subtotal - v_declared_subtotal) > 0.01 or abs((v_subtotal + v_iva + v_flete) - v_total) > 0.01 or v_total <= 0 then raise exception 'create_pos_sale_v2: totals do not reconcile'; end if;
  select coalesce(sum((payment->>'value')::numeric), 0) into v_cash_total from jsonb_array_elements(v_cash_lines) payment where coalesce(payment->>'value', '') ~ '^[0-9]+([.][0-9]+)?$';
  if exists (select 1 from jsonb_array_elements(v_cash_lines) payment where coalesce(payment->>'value', '') !~ '^[0-9]+([.][0-9]+)?$' or (payment->>'value')::numeric <= 0 or coalesce(payment->>'bucket', '') not in ('efectivo','transferencia','addi','contraentrega','tarjeta','digital','otro')) or abs(v_cash_total - v_total) > 0.01 then raise exception 'create_pos_sale_v2: cash movements do not reconcile'; end if;
  v_caja_id := nullif(v_cash->>'caja_id', ''); v_session_id := nullif(v_cash->>'session_id', '');
  if v_caja_id is null then raise exception 'create_pos_sale_v2: caja_id required'; end if;
  select * into v_caja from public.cajas where id = v_caja_id for update;
  if not found or v_caja.estado <> 'abierta' then raise exception 'create_pos_sale_v2: cash register is not open'; end if;
  if v_caja.sesion_activa_id is not null and v_session_id is distinct from v_caja.sesion_activa_id then raise exception 'create_pos_sale_v2: cash session mismatch'; end if;
  for v_product in select (line->>'product_id')::uuid as product_id, sum((line->>'qty')::integer)::integer as qty from jsonb_array_elements(v_lines) line group by (line->>'product_id')::uuid order by (line->>'product_id')::uuid loop
    perform 1 from public.products where id = v_product.product_id and stock >= v_product.qty for update;
    if not found then raise exception 'create_pos_sale_v2: insufficient stock for %', v_product.product_id; end if;
  end loop;
  insert into public.pos_operations(operation_id, kind, invoice_id, request_hash, created_by) values (v_operation_id, 'sale', v_invoice_id, v_hash, auth.uid());
  v_counter := public.increment_erp_consecutivo('factura'); v_number := 'POS-' || lpad(v_counter::text, 5, '0'); v_date := coalesce(nullif(v_invoice->>'fecha', '')::date, current_date);
  v_items := (select jsonb_agg(jsonb_build_object('articuloId', line->>'product_id','nombre',coalesce(line->>'name',''),'talla',coalesce(line->>'size',''),'qty',(line->>'qty')::integer,'cantidad',(line->>'qty')::integer,'precio',(line->>'unit_price')::numeric,'price',(line->>'unit_price')::numeric) order by ord) from jsonb_array_elements(v_lines) with ordinality as x(line, ord));
  insert into public.invoices(id,number,customer_name,customer_phone,total,subtotal,iva,flete,fecha,canal,metodo_pago,estado,tipo,guia,empresa,transportadora,ciudad,es_separado,tipo_pago,items,direccion,cedula_cliente,comprobante)
  values (v_invoice_id,v_number,nullif(v_invoice->>'customer_name',''),nullif(v_invoice->>'customer_phone',''),v_total,v_subtotal,v_iva,v_flete,v_date,coalesce(nullif(v_invoice->>'canal',''),'vitrina'),coalesce(nullif(v_invoice->>'metodo_pago',''),'efectivo'),'pagada','pos',coalesce(v_invoice->>'guia',''),coalesce(v_invoice->>'empresa',''),coalesce(v_invoice->>'transportadora',''),coalesce(v_invoice->>'ciudad',''),coalesce((v_invoice->>'es_separado')::boolean,false),coalesce(nullif(v_invoice->>'tipo_pago',''),'contado'),v_items,nullif(v_invoice->>'direccion',''),nullif(v_invoice->>'cedula_cliente',''),nullif(v_invoice->>'comprobante',''));
  insert into public.ventas(id,fecha,canal,valor,cliente,telefono,guia,empresa,transportadora,ciudad,liquidado,fecha_liquidacion,es_separado,estado_entrega,referencia,metodo_pago,archived,tipo_pago,es_contraentrega,fecha_hora_entrega,direccion,cedula_cliente,comprobante,stock_products_pending,invoice_id)
  values (v_invoice_id::text,v_date,coalesce(nullif(v_sale->>'canal',''),'vitrina'),v_total,coalesce(v_sale->>'cliente',''),coalesce(v_sale->>'telefono',''),coalesce(v_sale->>'guia',''),coalesce(v_sale->>'empresa',''),coalesce(v_sale->>'transportadora',''),coalesce(v_sale->>'ciudad',''),coalesce((v_sale->>'liquidado')::boolean,false),nullif(v_sale->>'fecha_liquidacion','')::date,coalesce((v_sale->>'es_separado')::boolean,false),coalesce(nullif(v_sale->>'estado_entrega',''),'Pendiente'),v_number,coalesce(nullif(v_sale->>'metodo_pago',''),'efectivo'),false,coalesce(nullif(v_sale->>'tipo_pago',''),'contado'),coalesce((v_sale->>'es_contraentrega')::boolean,false),null,nullif(v_sale->>'direccion',''),nullif(v_sale->>'cedula_cliente',''),nullif(v_sale->>'comprobante',''),'[]'::jsonb,v_invoice_id);
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_product_id := (v_line->>'product_id')::uuid; v_qty := (v_line->>'qty')::integer; v_price := (v_line->>'unit_price')::numeric; v_move_id := coalesce(nullif(v_line->>'move_id','')::uuid, gen_random_uuid());
    update public.products set stock = stock - v_qty, updated_at = now() where id = v_product_id;
    insert into public.stock_moves(id,product_id,qty,cantidad,reason,tipo,bodega_id,referencia,documento_id,fecha,nota) values (v_move_id,v_product_id,-v_qty,-v_qty,'venta_pos','venta_pos',coalesce(nullif(v_line->>'bodega_id',''),'bodega_main'),v_number,v_invoice_id,now(),coalesce(nullif(v_line->>'note',''),'Venta POS · ' || coalesce(v_line->>'name','Ítem')));
  end loop;
  v_saldos := coalesce(v_caja.saldos_metodo, '{}'::jsonb);
  for v_payment in select value from jsonb_array_elements(v_cash_lines) loop
    v_amount := (v_payment->>'value')::numeric; v_bucket := v_payment->>'bucket'; v_cash_move_id := coalesce(nullif(v_payment->>'id',''), gen_random_uuid()::text);
    v_saldos := jsonb_set(v_saldos,array[v_bucket],to_jsonb(coalesce((v_saldos->>v_bucket)::numeric,0)+v_amount),true);
    if v_bucket='efectivo' then v_cash_delta:=v_cash_delta+v_amount; end if;
    insert into public.tes_movimientos(id,caja_id,tipo,valor,concepto,fecha,metodo,sesion_id,categoria,bucket,invoice_id,operation_id) values (v_cash_move_id,v_caja_id,'ingreso',v_amount,coalesce(nullif(v_payment->>'concept',''),'Venta POS '||v_number),v_date,coalesce(nullif(v_payment->>'method',''),v_bucket),v_session_id,'venta_pos',v_bucket,v_invoice_id,v_operation_id);
  end loop;
  update public.cajas set saldos_metodo=v_saldos,saldo=coalesce(saldo,0)+v_cash_delta where id=v_caja_id;
  insert into public.sale_items(sale_id,invoice_id,invoice_number,product_id,product_ref,product_name,talla,qty,unit_price,subtotal,canal,cliente_nombre,cliente_telefono,fecha,fecha_hora,source,line_key,meta)
  select v_invoice_id::text,v_invoice_id,v_number,line->>'product_id',p.ref,coalesce(nullif(line->>'name',''),p.name),nullif(line->>'size',''),(line->>'qty')::numeric,(line->>'unit_price')::numeric,(line->>'qty')::numeric*(line->>'unit_price')::numeric,coalesce(nullif(v_invoice->>'canal',''),'vitrina'),nullif(v_invoice->>'customer_name',''),nullif(v_invoice->>'customer_phone',''),v_date,now(),'pos',lower(concat_ws('|',v_invoice_id::text,line->>'product_id',coalesce(line->>'size',''),line->>'unit_price',(ord-1)::text)),jsonb_build_object('operation_id',v_operation_id)
  from jsonb_array_elements(v_lines) with ordinality as x(line,ord) join public.products p on p.id=(line->>'product_id')::uuid on conflict (line_key) do nothing;
  v_response := jsonb_build_object('ok',true,'operation_id',v_operation_id,'invoice_id',v_invoice_id,'invoice_number',v_number,'cash_manual_required',false,'stocks',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'stock',p.stock)),'[]'::jsonb) from public.products p where p.id in (select (line->>'product_id')::uuid from jsonb_array_elements(v_lines) line)),'cash',jsonb_build_object('id',v_caja_id,'saldo',coalesce(v_caja.saldo,0)+v_cash_delta,'saldos_metodo',v_saldos));
  update public.pos_operations set response=v_response where operation_id=v_operation_id; return v_response;
end; $function$;

grant execute on function public.create_pos_sale_v2_impl(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_pos_sale_v2(jsonb) to anon, authenticated, service_role;
