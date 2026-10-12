# LoreForge

Turn wikis and websites into structured JSON APIs. Point it at a MediaWiki site (any Fandom wiki, independent wikis, Wikipedia) or a plain website, and it ingests pages, structures them with an LLM, stores them in MongoDB, and serves them over a clean REST API. It can also generate trivia questions from the ingested lore.

Local-first, open source (MIT). No accounts, no billing, no telemetry.

## Quickstart (Docker)

```bash
cp .env.example .env
# put your DeepSeek key in .env (only needed for ingesting/generating)
docker compose up -d --build
```

The API is live at `http://localhost:3000`. Health check: `GET /health`.

## Quickstart (bare metal)

Needs Node 22+ and MongoDB 7+.

```bash
cp .env.example .env
npm install
npm start
```

## Ingesting a source

Sources live in `config/sources.json`. Each one names a **site adapter**:

```json
{
  "dungeon_crawler_carl": {
    "adapter": "mediawiki",
    "display_name": "Dungeon Crawler Carl",
    "wiki_api_url": "https://dungeon-crawler-carl.fandom.com/api.php",
    "categories": { "characters": "Category:Characters" }
  },
  "my_blog": {
    "adapter": "html",
    "display_name": "My Blog",
    "categories": { "characters": "articles" },
    "sitemap": "https://example.com/sitemap.xml"
  }
}
```

Run the full pipeline (ingest + JSON export snapshot + 100 trivia questions):

```bash
node src/factory.js dungeon_crawler_carl
```

Or just ingest:

```bash
node src/services/ingest.js dungeon_crawler_carl        # whole source
node src/services/ingest.js dungeon_crawler_carl items  # one entity type
```

Already-ingested pages are skipped, so re-runs are cheap. If a MediaWiki category comes back empty, the pipeline asks the LLM for alternative category names and auto-patches `sources.json`.

## Site adapters

| Adapter     | What it ingests                                   |
|-------------|---------------------------------------------------|
| `mediawiki` | Any MediaWiki API (Fandom, independent wikis). Folder-diving category scan, pagination, page images. |
| `html`      | Ordinary websites. Give it `urls` or a `sitemap`; it extracts title, main text, and social image. |

To add a new site type, create a module in `src/adapters/` exporting `name`, `listItems(source, entityType)`, and `fetchItem(source, item)`, then register it in `src/adapters/index.js`. See `src/adapters/html.js` for the simplest example. Example configs live in `config/sources.example.json`.

## API reference

Base URL: `/api/v1`. If `API_KEY` is set, send it as the `x-api-key` header.

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/health` | Service status (unauthenticated) |
| GET | `/api/v1/meta/sources` | Source keys currently in the DB |
| GET | `/api/v1/search?q=donut&fandom=dungeon_crawler_carl` | Cross-entity search (`entityType`, `limit` optional) |
| GET | `/api/v1/:source/trivia/random` | Random trivia question, options shuffled |
| GET | `/api/v1/:source/:entityType?limit=50&page=1` | Paginated listing |
| GET | `/api/v1/:source/:entityType/:name` | Exact name lookup, case-insensitive |

Entity types: `characters`, `items`, `spells`, `locations`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/loreforge` | MongoDB |
| `API_KEY` | _(empty)_ | If set, required as `x-api-key`; empty = open |
| `DEEPSEEK_API_KEY` | _(empty)_ | Required for ingestion/trivia |
| `DEEPSEEK_MODEL` | `deepseek-chat` | LLM model |
| `MAX_TEXT_CHARS` | `12000` | Per-page text cap before LLM calls |
| `RATE_LIMIT_PER_MINUTE` | `100` | In-memory rate limit |

## Maintenance

```bash
npm test            # smoke test against a running server
npm run stats       # document counts per collection
npm run backup      # mongodump with 7-day rotation (needs mongodump installed)
node src/scripts/migrate-db.js   # one-time legacy index cleanup
```

## Respect the sources

This tool hits other people's websites. The MediaWiki adapter uses the official API (not HTML scraping). Keep request volumes sane, respect `robots.txt` for the HTML adapter, and check a wiki's terms before republishing its content. Wiki text is typically CC BY-SA; the JSON you generate from it inherits that share-alike obligation.

## License

MIT. See [LICENSE](LICENSE).
