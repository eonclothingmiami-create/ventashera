# Cutover a producción — capa canónica `sale_items`

Guía operativa para activar `sale_items` en producción de forma segura, idempotente y
reversible. No toca caja, stock, ventas ni facturas: `sale_items` es una capa de
lectura/reporte que convive con el esquema actual.

Carpeta oficial del proyecto: `C:\Users\david\OneDrive\Desktop\ERP\ventashera-main\ventashera`

---

## 1. Resumen de qué cambió

- **Nueva tabla** `public.sale_items` (líneas canónicas de venta para reportes por
  fecha, hora, artículo y cliente). Migración: `supabase/migrations/20260531_sales_items_canonical_v1.sql`.
- **Escritura desde POS** (`src/js/modules/core.js` → `procesarVentaPOS`): tras guardar
  factura/venta y aplicar stock/caja, escribe las líneas en `sale_items` de forma
  **no bloqueante**. Si falla, la venta NO se cancela y queda `ventaRecord.syncError = 'sale_items'`.
- **Backfill idempotente** desde facturas (`backfillSaleItemsFromInvoices` /
  botón "POS líneas" en Tesorería → `backfillSaleItemsVentaPos`).
- **Helpers de reporte puros** sobre `state.saleItems` (`window.AppSaleItemsReports`).
- **Auditorías SQL** (solo lectura) en `supabase/audits/`.

### Correcciones aplicadas en este cutover
1. `line_key` ahora incluye `unit_price` y el **índice de línea** además de
   `invoice_id + product_id + talla`. Evita que dos líneas del mismo producto/talla en
   una misma factura (precio distinto o repetidas) se fusionen y se pierda una.
   Seguro: la tabla estaba **vacía (0 filas)**, no requiere migración de datos.
2. El backfill ahora tolera `invoices.items` como **string JSON** (antes solo array).
3. Se removió la instrumentación de debug (`#region agent log`) de `core.js`
   (no debe existir en producción). Cache-busters actualizados a `?v=20260531saleitems2`.
4. Nuevo helper `AppSaleItemsReports.excluirAnuladas(rows, facturas)` para reportes.

---

## 2. Qué tabla nueva existe

`public.sale_items` con, entre otras: `id`, `sale_id`, `invoice_id`, `invoice_number`,
`product_id`, `product_name`, `talla`, `qty`, `unit_price`, `subtotal`, `canal`,
`cliente_nombre`, `cliente_telefono`, `fecha`, `fecha_hora`, `source`, `line_key` (único),
`meta`, `created_at`, `updated_at`.

- Índice **único** por `line_key` (idempotencia).
- Índices de consulta: `sale_id`, `invoice_id`, `product_id`, `fecha`, `fecha_hora`, `cliente_telefono`.
- RLS habilitado con políticas SELECT / INSERT / UPDATE para `anon` y `authenticated`
  (mismo patrón que el resto del ERP). Sin política DELETE.

---

## 3. Qué NO cambió

- **Caja** (`tes_movimientos`): sin cambios. `sale_items` no inserta ni modifica caja.
- **Stock** (`stock_moves`, `products.stock`): sin cambios. `sale_items` no descuenta inventario.
- **Ventas** (`ventas`) y **Facturas** (`invoices`): sin cambios de esquema ni de flujo visible.
- El flujo POS visible para el usuario es idéntico; `sale_items` se escribe en segundo plano.

---

## 4. Orden exacto para aplicar en producción

1. **Backup recomendado**
   - Exportar/backup del proyecto Supabase (o al menos snapshot lógico de
     `invoices`, `ventas`, `stock_moves`, `tes_movimientos`).
   - No es estrictamente necesario para `sale_items` (tabla nueva y vacía), pero es la
     práctica segura antes de cualquier cutover.
2. **Aplicar la migración** `supabase/migrations/20260531_sales_items_canonical_v1.sql`
   (idempotente: `create table if not exists`, `create index if not exists`, `drop policy if exists`).
   - Si la tabla ya existe (como en el proyecto actual), la migración no rompe nada.
3. **Desplegar el frontend** con los cache-busters nuevos y **recargar la app** con
   refresco fuerte (Ctrl+F5) para cargar `core.js?v=20260531saleitems2`,
   `pos-repository.js?v=20260531saleitems2` y `treasury-module.js?v=20260531saleitems1`.
4. **Ejecutar el backfill**: Tesorería → botón **"POS líneas"** (`backfillSaleItemsVentaPos`).
   - Idempotente: re-ejecutarlo no duplica (clave `line_key` + `ignoreDuplicates`).
   - No toca stock, caja, ventas ni invoices. Salta facturas anuladas e ítems vacíos.
5. **Ejecutar las auditorías** (solo SELECT) y revisar resultados:
   - `supabase/audits/sales_consolidation_cleanup_audit.sql`
   - `supabase/audits/sales_duplicate_cleanup_candidates.sql`
6. **Validar con una venta de prueba** (ver checklist §5, Prueba A) y confirmar que
   stock baja una vez, caja sube una vez y `sale_items` registra la(s) línea(s).

---

## 5. Checklist de validación manual (Pruebas A–G)

> Para verificar `sale_items` en BD usar (solo lectura):
> `select * from public.sale_items where invoice_number = 'POS-XXXXX' order by fecha_hora;`

- **Prueba A — Venta vitrina simple (1 artículo)**
  - [ ] Aparece en Facturas.
  - [ ] Aparece en Historial.
  - [ ] Descarga el PDF.
  - [ ] Stock baja **una** vez.
  - [ ] Caja sube **una** vez.
  - [ ] `sale_items` tiene **1** línea.
- **Prueba B — Venta con 2 artículos**
  - [ ] `sale_items` tiene **2** líneas.
- **Prueba C — Mismo artículo, tallas distintas**
  - [ ] `sale_items` tiene **líneas separadas** (una por talla).
- **Prueba D — Mismo artículo, misma talla, precio distinto**
  - [ ] `sale_items` conserva **ambas** líneas (ya corregido: `line_key` incluye
        `unit_price` e índice de línea). No debe perderse ninguna.
- **Prueba E — Contraentrega**
  - [ ] Al liquidar, la caja **no se duplica** (un solo ingreso por la venta).
- **Prueba F — Anulación POS**
  - [ ] Stock revierte correctamente.
  - [ ] Caja revierte correctamente.
  - [ ] La factura queda **anulada**.
  - [ ] **Limitación documentada:** `sale_items` NO se borra ni se compensa al anular.
        Los reportes sobre `state.saleItems` **deben excluir** facturas anuladas usando
        `window.AppSaleItemsReports.excluirAnuladas(rows, state.facturas)`. Si no se filtra,
        una venta anulada seguiría contando en reportes basados en `sale_items`.
- **Prueba G — Backfill dos veces**
  - [ ] Ejecutar "POS líneas" una vez (anota el total insertado).
  - [ ] Ejecutarlo de nuevo: el conteo de la segunda corrida debe ser **0 nuevas**
        ("sale_items ya estaba al día"). Confirma idempotencia.

---

## 6. Rollback conceptual

`sale_items` es aditivo; revertirlo no requiere tocar datos críticos.

- **Dejar de usar `sale_items`**: simplemente no leer de `state.saleItems` en reportes
  y/o no llamar al backfill. La escritura desde POS es no bloqueante: si se desea,
  puede desactivarse el bloque `persistSaleItems` sin afectar la venta.
- **No tocar** `ventas`, `invoices`, `tes_movimientos` ni `stock_moves`: son la fuente
  de verdad y no dependen de `sale_items`.
- **No borrar `sale_items`** salvo decisión futura explícita. Si algún día se decide
  limpiar duplicados, hacerlo con la plantilla reversible (backup + columna `archived`)
  de `supabase/audits/sales_duplicate_cleanup_candidates.sql` (hoy comentada y no ejecutable).

---

## 7. Riesgos restantes

1. **Idempotencia de `line_key` por posición**: la clave incluye el índice de línea.
   Es estable mientras `invoices.items` no se reordene tras la venta (el flujo actual no
   lo reordena). Si en el futuro se editan facturas reordenando ítems, podrían generarse
   líneas adicionales en `sale_items` (nunca afecta caja/stock/facturas).
2. **Reporte de anuladas**: requiere filtrar con `excluirAnuladas` (ver Prueba F). No es
   automático.
3. **`syncError = 'sale_items'` no se persiste ni reintenta por venta**: si la escritura
   POS de `sale_items` falla, la venta queda intacta pero la marca es solo en memoria. La
   vía de recuperación es re-ejecutar el backfill "POS líneas" (idempotente).
4. **Colisión de consecutivos POS (tema SEPARADO, no de este cutover)**: el número
   `POS-####` se genera con un contador local no atómico (`getNextConsec`), lo que puede
   reusar números entre sesiones/dispositivos. No afecta a `sale_items` (la `line_key`
   usa el UUID de la factura, no el número), pero contamina referencias por número en
   `ventas`/`stock_moves`/`tes_movimientos`. Pendiente de un workstream aparte
   (numeración atómica en servidor).
5. **Migraciones de compras/proveedores faltantes en el repo (Fase 8)**: las tablas
   `compras`, `compra_items`, `proveedor_cxp_movimientos`, `proveedor_abonos`,
   `proveedor_abono_aplicaciones`, `proveedor_notas_credito` **existen en producción**
   pero **no tienen archivo de migración** en `supabase/migrations/` (solo está la de
   `sale_items`). Riesgo de **reproducibilidad**: no se puede reconstruir el esquema
   completo desde el repo. No es bloqueante para el cutover de `sale_items`, pero se
   recomienda versionar esas migraciones (dump del DDL actual) cuando se pueda.

---

## 8. Veredicto

- **Listo para producción:** SÍ, una vez aplicadas las correcciones de este cutover
  (ya incluidas en el código) y completadas las Pruebas A–G en §5.
- **Sin riesgo de duplicar caja ni stock:** `sale_items` no los toca.
- **Pendientes (no bloqueantes):** numeración atómica de consecutivos POS y versionar
  las migraciones de compras/proveedores.
