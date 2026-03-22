# Meta Commerce — integración paso a paso (PC local, un solo usuario)

**Para copiar y pegar en el símbolo del sistema (cmd.exe) de Windows**, usa el archivo plano:  
**[`META_GUIA_CMD_COMPLETA.txt`](./META_GUIA_CMD_COMPLETA.txt)**

Objetivo: ir validando cada capa sin mezclar con Mercado Libre. Si en algún momento pegaste un token en un chat, **genera uno nuevo** y úsalo solo en Supabase.

---

## Fase 1 — Desplegar la Edge Function

Necesitas el **Supabase CLI** o desplegar desde el panel de Supabase (si tu flujo lo permite).

### Opción A: CLI (recomendado)

En la raíz del repo (donde está `supabase/functions/`):

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy meta-commerce-sync --no-verify-jwt
```

`TU_PROJECT_REF` está en Supabase → **Project Settings** → **General** → *Reference ID*.

### Opción B: Sin CLI

Si ya despliegas otras funciones (p. ej. `mercadolibre-sync-product`) con otro método, repite el mismo proceso para la carpeta `supabase/functions/meta-commerce-sync`.

Comprueba en **Supabase Dashboard** → **Edge Functions** que exista **`meta-commerce-sync`** y anota la URL:

`https://<ref>.supabase.co/functions/v1/meta-commerce-sync`

---

## Fase 2 — Secrets mínimos (Dashboard)

**Supabase** → **Project Settings** → **Edge Functions** → **Secrets** (o **Secrets** del proyecto).

| Secret | Valor (primera prueba) |
|--------|-------------------------|
| `META_DRY_RUN` | `true` |
| `META_CATALOG_ID` | *(puede estar vacío en dry run; si la función exige algo, pon el ID real cuando lo tengas)* |

Con **`META_DRY_RUN=true`** la función **no llama a Meta**: solo lee `products` / `product_media` y devuelve el **payload** que enviaría. Así validas Supabase + producto sin romper nada en Facebook.

Opcional ya:

| Secret | Descripción |
|--------|-------------|
| `META_PRODUCT_BASE_URL` | URL pública base de la ficha (para el campo `link` del feed) |
| `META_DEFAULT_BRAND` | Marca por defecto |

**No** hace falta `META_ACCESS_TOKEN` para dry run (la función responde en modo prueba si faltan token/catálogo).

---

## Fase 3 — Probar la función sin abrir el ERP

Sustituye `TU_REF`, `TU_ANON_KEY` y un `productId` real de tu tabla `products`:

```bash
curl -s -X POST "https://TU_REF.supabase.co/functions/v1/meta-commerce-sync" ^
  -H "apikey: TU_ANON_KEY" ^
  -H "Authorization: Bearer TU_ANON_KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"productId\":\"UUID_DEL_PRODUCTO\"}"
```

En PowerShell puedes usar `` ` `` para saltos de línea o un solo `-d`.

Respuesta esperada (`dryRun: true`): JSON con `payload`, `retailerId`, `message`. Si ves **error de producto no encontrado**, el UUID no coincide con `products.id`.

---

## Fase 4 — Token y catálogo reales (Meta)

1. En **Commerce Manager** / **Business Manager**, copia el **ID del catálogo** (solo números).
2. Genera un **access token** con permisos de catálogo (`catalog_management`, y si aplica `business_management`). Guárdalo **solo** en Supabase.

Secrets:

| Secret | Valor |
|--------|--------|
| `META_ACCESS_TOKEN` | *(token nuevo, no reutilices uno expuesto)* |
| `META_CATALOG_ID` | ID del catálogo |
| `META_DRY_RUN` | `false` o borrar el secret |

Vuelve a desplegar la función **solo si** cambiaste código; los secrets se aplican sin redeploy.

Repite el **curl** de la Fase 3. Si Meta rechaza el body, la respuesta incluye `meta` con el detalle — ajústalo según el mensaje (campos obligatorios, `link`/`image_link`, etc.).

---

## Fase 5 — ERP (VentasHera)

1. `index.html` ya carga `meta-commerce.js` y `AppRepository` tiene tu `SUPABASE_URL` + anon key (como siempre).
2. Abre un artículo con **Visible en catálogo web** y marca **Sincronizar con Meta…** al guardar.
3. Revisa el toast y la consola (`[Meta Commerce]`).

Orden respecto a ML: primero Mercado Libre, luego Meta (cada uno aislado; ver `INTEGRACIONES_CANALES.md`).

---

## Si algo falla

| Síntoma | Qué revisar |
|---------|-------------|
| 404 función | Deploy o URL incorrecta |
| Producto no encontrado | `productId` = `products.id` en Supabase |
| Meta 400/403 | Permisos del token, ID de catálogo, `link`/`image_link` públicos |
| Siempre dry run | `META_DRY_RUN` o falta token/catálogo |

Documentación ampliada: [META_COMMERCE_MANAGER.md](./META_COMMERCE_MANAGER.md) · [INTEGRACIONES_CANALES.md](./INTEGRACIONES_CANALES.md).
