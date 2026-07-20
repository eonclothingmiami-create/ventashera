# Hera Catalog API v1 — Knowledge Graph first

## Orden estratégico (seguir esto)

| Fase | Qué | Estado |
|------|-----|--------|
| **1** | API + relaciones + knowledge básico | ✅ |
| **2** | **Curación del grafo** (oro) | 🔄 ahora |
| **2.5** | **Product Intelligence** (ERP: sugerir → aprobar) | ✅ MVP |
| **3** | Embeddings del **documento completo** de conocimiento | ⏳ (cola lista; worker módulo `embedding`) |
| **4** | MCP thin adapter | ⏸ (existe stub; no priorizar) |

No corras a enriquecer el MCP. Primero llena el grafo.

## Product Intelligence (ERP)

Entidad por `HERA-*` que versiona copy / SEO / atributos / relaciones / knowledge **sin** alterar el alta operativa (`saveArticulo`).

```
Product (hechos)
  └── product_intelligence
        ├── product_ai_jobs      (cola por módulo)
        └── product_ai_artifacts (suggested → accepted|rejected|superseded)
```

| Módulo | Al generar | Al aprobar |
|--------|------------|------------|
| `copy` | artifact suggested | `products.name` + `products.description` |
| `seo` | artifact (meta/slug/keywords) | solo versionado (sin columnas SEO en products aún) |
| `attributes` | artifact | upsert `product_attributes` |
| `relations` | candidatos | `product_relations` con `source='ai'` (no pisa `curated`) |
| `knowledge` | `knowledge_doc` | `product_search_docs.embedding_text` + enqueue `embedding_jobs` si hash cambia |
| `embedding` | — | drena `embedding_jobs` vía OpenAI embeddings |

**UX:** modal artículo → sección **Inteligencia** (solo productos ya guardados). Botones Regenerar / Aprobar / Rechazar. No hay auto-pipeline al guardar.

**Worker:** Edge Function `product-intelligence-worker` (JWT ERP). Secreto requerido: `OPENAI_API_KEY`.

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... --project-ref niilaxdeetuzutycvdkz
```

RPCs: `enqueue_product_ai_job`, `accept_product_ai_artifact`, `reject_product_ai_artifact`, `ensure_product_intelligence`.

La Catalog API **no cambia**: sigue leyendo `products` + grafo. Intelligence alimenta esos stores tras aprobación humana.

### Centro de IA (ERP)

Página `Centro de IA` (nav **INTELIGENCIA**). Es el “Configuración → IA” operativo:

| Submódulo | Qué hace |
|-----------|----------|
| **Resumen** | Proveedor, estado, modelos, artifacts/jobs pendientes, último error (costo = — sin telemetría) |
| **Proveedores** | OpenAI conectado/no · test ping + latencia · modelos (sin API key en ERP) |
| **Activación módulos** | Gates: Copy/SEO/Attributes/Knowledge/Embedding on; Relations off por defecto |
| **Estado del catálogo** | Cobertura del activo digital |
| **Cola de revisión** | Artifacts `suggested` → Aprobar / Rechazar |
| **Jobs** | Cola + procesar siguiente |

**Arquitectura runtime:** `Worker → AiProvider → OpenAI` (extensible). Embedding exige Knowledge `accepted`. Embed model locked a familia 1536 dims.

**Brand Voice:** tabla `ai_brand_voice` (versión `active`). Copy/SEO/Attributes/Knowledge/Relations inyectan `guide_markdown` en el system prompt. UI: Centro de IA → Brand Voice. Así el tono Quiet Luxury sobrevive al cambio de proveedor.

**Playbook SKU:** Brand Voice activa → Proveedor OK → Copy → SEO → Attributes → Knowledge → Embedding (Relations cuando gates on + revisión humana).

No es un panel de ChatGPT ni de API keys.


## Source of truth

```
knowledge_nodes  +  knowledge_edges
        │
        ▼
GET /products/{ref}/knowledge   ← vista estructurada
```

Cada pieza de contenido (producto, IG, TikTok, blog, editorial, colección, foto cliente) es un **nodo** con `external_key`. Las relaciones tipadas (`appears_in`, `completes`, `belongs_to`, `mentioned_in`, `recommended_for`, …) son **edges**.

Ejemplo:

```
product:HERA-20132
  ├── completes      → product:HERA-20082 (kimono / salida)
  ├── belongs_to     → collection:cartagena
  ├── appears_in     → instagram:…
  ├── mentioned_in   → guide:…
  └── recommended_for→ collection:luna-de-miel
```

## Shape de `/products/{ref}/knowledge`

```json
{
  "product": {},
  "relationships": { "pairs_with": [], "similar": [], "collections": [] },
  "media": { "images": [], "videos": [], "customer_photos": [] },
  "social": { "instagram": [], "tiktok": [], "pinterest": [] },
  "guides": { "blog": [], "guides": [] },
  "editorial": [],
  "recommendations": [],
  "semantic": { "status": "planned" }
}
```

(`answers` se mantiene por compatibilidad temporal.)

## URLs

| Ambiente | Base |
|----------|------|
| Producción | `https://heraswimsuit.com/api/v1` |
| Edge | `https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-api-v1` |

## Curación (Fase 2)

ERP → Redes → Contenido:

1. CTA producto siempre `HERA-*`
2. Formulario “Conocimiento comercial” → IG/TT/Blog/video por ref
3. “Sincronizar editoriales” + `rebuild_knowledge_graph()`

Objetivo por SKU: blog + social + colección + editorial + kimono/similar.

## MCP (Fase 4)

Stub en `mcp-hera-catalog/` — solo llama a la API. Activar cuando el grafo esté curado.
