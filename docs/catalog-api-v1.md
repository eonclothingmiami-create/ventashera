# Hera Catalog API v1 — Knowledge Graph first

## Orden estratégico (seguir esto)

| Fase | Qué | Estado |
|------|-----|--------|
| **1** | API + relaciones + knowledge básico | ✅ |
| **2** | **Curación del grafo** (oro) | 🔄 ahora |
| **3** | Embeddings del **documento completo** de conocimiento | ⏳ |
| **4** | MCP thin adapter | ⏸ (existe stub; no priorizar) |

No corras a enriquecer el MCP. Primero llena el grafo.

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
