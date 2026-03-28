-- =============================================================================
-- Auditoría Supabase — alineación RLS, tablas, RPC, seguridad
-- Ejecutar en: Dashboard → SQL Editor (o: supabase db query --linked -f ...)
-- Revisa resultados con filas: cada sección debe devolver 0 filas en un proyecto sano
-- para ERP con clave anon en navegador (salvo que solo uséis JWT authenticated).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CRÍTICO: RLS activado pero SIN ninguna política → PostgREST 403 / sin filas
-- -----------------------------------------------------------------------------
SELECT n.nspname AS schema,
       c.relname AS table_name,
       'RLS sin políticas' AS issue
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relispartition
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = n.nspname
      AND p.tablename = c.relname
  )
ORDER BY c.relname;

-- -----------------------------------------------------------------------------
-- 2) RLS activado: políticas no cubren rol ANON (ERP con publishable key en browser)
--    Si usáis solo usuarios logueados, podéis ignorar filas de esta consulta.
--    "anon_ok" = existe al menos una política aplicable a anon o al pseudo-rol public.
-- -----------------------------------------------------------------------------
WITH rls_tables AS (
  SELECT c.relname AS tname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relispartition
    AND c.relrowsecurity
),
policy_cover AS (
  SELECT p.tablename,
         bool_or(
           EXISTS (
             SELECT 1
             FROM unnest(p.roles) AS role_name
             WHERE role_name IN ('anon', 'public')
           )
         ) AS anon_ok
  FROM pg_policies p
  WHERE p.schemaname = 'public'
  GROUP BY p.tablename
)
SELECT r.tname AS table_name,
       'RLS sin política para anon/public' AS issue
FROM rls_tables r
LEFT JOIN policy_cover pc ON pc.tablename = r.tname
WHERE pc.tablename IS NULL
   OR COALESCE(pc.anon_ok, false) = false
ORDER BY r.tname;

-- -----------------------------------------------------------------------------
-- 3) Tablas que el ERP referencia y NO existen en public (revisar typos / migraciones)
--    Lista alineada con ventashera-main (from / rpc).
-- -----------------------------------------------------------------------------
WITH expected (t) AS (
  VALUES
    ('products'), ('product_media'), ('employees'), ('ventas'), ('ventas_catalogo'),
    ('cajas'), ('tes_movimientos'), ('nom_nominas'), ('nom_ausencias'), ('nom_anticipos'),
    ('inv_ajustes'), ('inv_ajustes_lotes'), ('inv_traslados'), ('bodegas'),
    ('state_config'), ('proveedores'), ('invoices'), ('tes_abonos_prov'),
    ('tes_compromisos_prov'), ('product_sizes'), ('product_colors'), ('sizes'), ('colors'),
    ('tes_cxp_movimientos'), ('tes_devoluciones_prov'), ('tes_ajustes_unidades_prov'),
    ('stock_moves'), ('nom_conceptos_cfg'), ('tes_libro_proveedor'), ('tes_cierres_caja'),
    ('customers'), ('legacy_docs'),
    ('cfg_categorias'), ('cfg_secciones'), ('cfg_transportadoras'), ('cfg_metodos_pago'),
    ('cfg_tarifas'), ('cfg_impuestos')
)
SELECT e.t AS missing_table,
       'Tabla referenciada por app y ausente en public' AS issue
FROM expected e
LEFT JOIN information_schema.tables i
  ON i.table_schema = 'public' AND i.table_name = e.t
WHERE i.table_name IS NULL
ORDER BY e.t;

-- -----------------------------------------------------------------------------
-- 4) RPC que el ERP llama y que NO existen en public
-- -----------------------------------------------------------------------------
WITH expected (fname) AS (
  VALUES
    ('delete_product_full'),
    ('apply_pos_sale_stock_lines'),
    ('tes_abono_proveedor_aplicar')
),
in_public AS (
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)
SELECT e.fname AS missing_function,
       'RPC ausente' AS issue
FROM expected e
LEFT JOIN in_public f ON f.proname = e.fname
WHERE f.proname IS NULL
ORDER BY e.fname;

-- -----------------------------------------------------------------------------
-- 5) Funciones SECURITY DEFINER en public sin search_path fijado (riesgo search_path hijacking)
--    Ideal: SET search_path = public en el cuerpo o via proconfig.
-- -----------------------------------------------------------------------------
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       'SECURITY DEFINER sin search_path en proconfig' AS issue
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef = true
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg(x)
    WHERE cfg.x LIKE 'search_path=%'
  )
ORDER BY p.proname;

-- -----------------------------------------------------------------------------
-- 6) Tablas public SIN primary key (PostgREST/upsert y orden inconsistentes)
-- -----------------------------------------------------------------------------
SELECT c.relname AS table_name,
       'Sin PRIMARY KEY' AS issue
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relispartition
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.oid
      AND i.indisprimary
  )
ORDER BY c.relname;

-- -----------------------------------------------------------------------------
-- 7) FKs: columnas referenciadas sin índice en la tabla hija (rendimiento en JOIN/DELETE)
-- -----------------------------------------------------------------------------
SELECT tc.table_name AS child_table,
       kcu.column_name AS fk_column,
       ccu.table_name AS parent_table,
       'FK sin índice en columna hija' AS issue
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'foreign key'
  AND tc.table_schema = 'public'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_indexes pi
    WHERE pi.schemaname = 'public'
      AND pi.tablename = tc.table_name
      AND pi.indexdef ILIKE '%' || kcu.column_name || '%'
  )
ORDER BY tc.table_name, kcu.column_name;

-- -----------------------------------------------------------------------------
-- 8) Filas huérfanas (FK roto) — solo si las FK no tienen ON DELETE restrict mal aplicado
--    Ejemplo genérico: descomenta y ajusta tablas críticas.
-- -----------------------------------------------------------------------------
-- SELECT sm.id, sm.product_id, 'stock_moves.product_id sin products' AS issue
-- FROM public.stock_moves sm
-- LEFT JOIN public.products p ON p.id = sm.product_id
-- WHERE p.id IS NULL
-- LIMIT 100;

-- -----------------------------------------------------------------------------
-- 9) Resumen: RLS on/off por tabla (vista rápida)
-- -----------------------------------------------------------------------------
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relispartition
ORDER BY c.relrowsecurity DESC, c.relname;

-- -----------------------------------------------------------------------------
-- 10) Políticas duplicadas (mismo cmd + roles + tabla) — limpieza opcional
-- -----------------------------------------------------------------------------
SELECT schemaname, tablename, cmd, roles, count(*) AS n
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY schemaname, tablename, cmd, roles
HAVING count(*) > 1
ORDER BY n DESC, tablename;
