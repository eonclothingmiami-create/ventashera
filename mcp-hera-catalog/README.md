# Hera Catalog MCP

Adaptador **fino** sobre Catalog API v1. No contiene reglas de negocio ni SQL.

## Instalar

```bash
cd mcp-hera-catalog
npm install
```

## Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "hera-catalog": {
      "command": "node",
      "args": [
        "C:/Users/david/OneDrive/Desktop/ERP/ventashera-main/ventashera/mcp-hera-catalog/src/index.js"
      ],
      "env": {
        "HERA_CATALOG_API_BASE": "https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-api-v1"
      }
    }
  }
}
```

## Tools

| Tool | API |
|------|-----|
| `capabilities` | `GET /capabilities` |
| `resolve_product` | `GET /resolve?id=` |
| `search_products` | `POST /search` |
| `get_product` | `GET /products/{ref}` |
| `get_product_knowledge` | `GET /products/{ref}/knowledge` |
| `get_related_products` | `GET /products/{ref}/related` |
| `list_collections` | `GET /collections` |
| `get_collection` | `GET /collections/{slug}` |

## Probar

```bash
npx @modelcontextprotocol/inspector node ./src/index.js
```
