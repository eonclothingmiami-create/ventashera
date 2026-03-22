# Meta Commerce Manager (Facebook Shops / Instagram Shopping)

Integración **ERP → catálogo Meta** mediante la Edge Function `meta-commerce-sync`. **No comparte** código ni secrets con Mercado Libre; ver [INTEGRACIONES_CANALES.md](./INTEGRACIONES_CANALES.md).

## Qué hace

- Toma un producto de `public.products` (+ `product_media` para imagen).
- Envía un **batch** al catálogo con **Marketing API**: `POST /{META_CATALOG_ID}/items_batch` (`item_type=PRODUCT_ITEM`).
- **UPDATE** en Meta equivale a crear/actualizar el ítem (`allow_upsert`).

## Requisitos en Meta

1. **Meta Business Suite** / **Business Manager** con el negocio y el activo **Catálogo**.
2. **Commerce Manager** (o configuración de tienda) usando ese catálogo para Facebook Shops / Instagram Shopping.
3. Una **app** de Meta (developers.facebook.com) con **Marketing API** si aplica a tu flujo de tokens.
4. Un **token de acceso** con permisos sobre el catálogo, por ejemplo:
   - `catalog_management`
   - `business_management` (según cómo esté asignado el usuario del sistema al catálogo)

   Lo habitual es un **usuario del sistema** (System User) del Business con token de larga duración, o un token generado en **Business Settings → Users → System users** con acceso al catálogo.

5. El **ID del catálogo** (`META_CATALOG_ID`): en Commerce Manager o en la URL/API del catálogo (solo el número).

## Secrets en Supabase

| Variable | Obligatorio | Descripción |
|----------|-------------|-------------|
| `META_ACCESS_TOKEN` | Sí* | Token con acceso al catálogo |
| `META_CATALOG_ID` | Sí* | ID del Product Catalog |
| `META_PRODUCT_BASE_URL` | Recomendado | URL pública del detalle del producto (ej. `https://tutienda.com/producto?ref=`). Se concatena el `ref` o `?id=` según la función |
| `META_CURRENCY` | No | Por defecto `COP` |
| `META_DEFAULT_BRAND` | No | Marca por defecto en el feed |
| `META_GRAPH_VERSION` | No | Por defecto `v21.0` |
| `META_DRY_RUN` | No | `true` = no llama a Meta, solo devuelve payload |

\*Si faltan token o catálogo, la función responde `dryRun: true` con el payload para pruebas.

También deben existir `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (automáticos en Edge Functions).

## Deploy

```bash
supabase functions deploy meta-commerce-sync --no-verify-jwt
```

(Ajusta `--no-verify-jwt` según tu política; el front usa anon key como en ML.)

## Front (VentasHera)

- Script: `src/js/integrations/meta-commerce.js`
- Opcional en `index.html`: `window.META_COMMERCE_SYNC_ENDPOINT = ''` (vacío = derivado de Supabase).
- En el modal de artículo: **“Sincronizar con Meta (Facebook / Instagram)”** al guardar, si el producto queda visible en catálogo web.

## Guía práctica (PC local, paso a paso)

Ver **[META_SETUP_PASO_A_PASO.md](./META_SETUP_PASO_A_PASO.md)** (deploy, secrets, curl de prueba, luego ERP).

## Limitaciones del MVP

- Un ítem por producto ERP (`retailer_id` = `ref` o `id`).
- Variaciones (tallas/colores) como ítems separados: no implementado; Meta puede usar feeds más avanzados.
- Órdenes, mensajes y pagos: fuera de alcance (solo catálogo).
- Si Meta exige **link** e **image_link** públicos, configura `META_PRODUCT_BASE_URL` y sube imágenes accesibles por URL.

## Referencias oficiales

- [Marketing API — Product Catalog](https://developers.facebook.com/docs/marketing-api/catalog)
- [Items batch](https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/)
- [Commerce Manager](https://www.facebook.com/business/help/commerce-manager)
