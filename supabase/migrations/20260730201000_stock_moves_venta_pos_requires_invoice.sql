-- Cierra el último hueco por donde una pestaña vieja deja inventario sin venta.
--
-- 20260730143000 ya blindó sale_items (FK a invoices) y los ingresos de caja POS
-- (invoice_id obligatorio), pero stock_moves quedó libre: el camino secuencial antiguo
-- podía descontar inventario aunque el insert en invoices se hubiera rechazado por número
-- duplicado. Así se perdieron las ventas de $123.000 y $18.000 del 2026-07-30, que no
-- aparecían en Factura, Consolidado ni Trazabilidad porque solo existían como movimiento
-- de inventario.
--
-- Con estas reglas la base rechaza la escritura parcial en vez de aceptarla, y el POS
-- muestra el error en pantalla en vez de dar la venta por registrada:
--   1. stock_moves tipo venta_pos exige un documento_id que exista en invoices.
--   2. los ingresos de caja venta_pos exigen que la factura exista, no solo que el id venga.
--
-- Solo aplican a filas nuevas. Las 354 líneas venta_pos de mar–jul 2026 cuyo documento_id
-- apunta a ventas anteriores a la unificación con invoices se conservan intactas.
--
-- Orden interno de create_pos_sale_v2_impl: invoices → stock_moves → tes_movimientos →
-- sale_items, así que la venta POS normal pasa ambas reglas dentro de su transacción.

create or replace function public.stock_moves_requires_invoice()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'venta_pos' then
    if new.documento_id is null then
      raise exception 'Movimiento de venta sin documento: no se puede descontar inventario sin factura.';
    end if;
    if not exists (select 1 from public.invoices where id = new.documento_id) then
      raise exception 'La factura % no existe: la venta no quedó registrada. Recarga el ERP (Ctrl+Shift+R) y repite la venta.', new.documento_id
        using hint = 'Suele pasar con una pestaña vieja que numera facturas desde el consecutivo local en vez del contador del servidor.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists stock_moves_requires_invoice_trg on public.stock_moves;

create trigger stock_moves_requires_invoice_trg
  before insert on public.stock_moves
  for each row execute function public.stock_moves_requires_invoice();

create or replace function public.tes_movimientos_venta_pos_requires_invoice()
returns trigger
language plpgsql
as $$
begin
  if new.categoria = 'venta_pos' and new.tipo = 'ingreso' then
    if new.invoice_id is null then
      raise exception 'Ingreso de venta POS sin factura: no se puede registrar dinero sin la factura.';
    end if;
    if not exists (select 1 from public.invoices where id = new.invoice_id) then
      raise exception 'La factura % no existe: el ingreso de caja no se registra.', new.invoice_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tes_movimientos_venta_pos_requires_invoice_trg on public.tes_movimientos;

create trigger tes_movimientos_venta_pos_requires_invoice_trg
  before insert on public.tes_movimientos
  for each row execute function public.tes_movimientos_venta_pos_requires_invoice();
