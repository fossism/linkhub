# LinkHub — Complete Project Guide (Beginner Friendly)

> Read this file if you know nothing about the project. By the end you will
> understand what LinkHub is, how every piece works, why each technology was
> chosen, every API endpoint, and how to run and extend it.

---

## 1. What is LinkHub?

**One sentence:** LinkHub is a self-hosted, privacy-first bookmark manager that
automatically reads your saved links, understands what they are about with a
local AI, files them into folders by itself, and keeps encrypted visual backups
(screenshot, PDF, HTML) of every page.

**The problem it solves:** Browsers give you either bookmarks (manual folders,
you must organize everything yourself) or 50–70 open tabs (chaos, memory hog,
lost on restart). LinkHub's goal is a third option: **dump all your open tabs
in one place in one click, have them auto-categorized, search them by meaning
later, and restore them when needed** — without trusting a cloud company with
your data.

The browser extension (repo root: `manifest.json`, `popup.*`, `sidepanel.*`,
`background.js`, `common.js`, `crypto.js`) is the main client: one-click
window save, right-click save, folder restore, and the dashboard embedded as
a side panel. See `README.md`, `TESTING.md`, `LEARN.md`, `PUBLISH.md`.

---

## 2. Big-Picture Architecture

```
[Extension popup / side panel / dashboard :5173]
        │ REST + JWT (ingest, search, restore)      │ encrypted blobs (base64)
        ▼                                           │
[Go API :5000 (Gin)] ──LPUSH job──▶ [Redis :6380] ─┘
   │ SQL                                │ BRPOP
   ▼                                    ▼
[Postgres+pgvector :5433]   [Go worker: chromedp → readability → Ollama/fallbacks → centroid route → AES-GCM → MinIO :9000]
```

Six services (see `docker-compose.yml`): `db`, `redis`, `minio`, `ollama`,
`backend` (Go), `frontend` (nginx + React). The Go binary runs API + worker
loop together (`backend/main.go`).

---

## 3. Tech Stack — What Each Piece Does and Why

- **Go + Gin** (`backend/`): one ~29 MB binary, fast, goroutine concurrency
  for bulk ingest. Libs: `gin`, `chromedp` (headless Chrome screenshots/PDF),
  `go-readability` (article text), `pgx/v5` (Postgres pool),
  `minio-go` (S3 uploads), `redis/go-redis` (queue), `jwt`, `bcrypt`.
- **Postgres + pgvector** (`backend/schema.sql`): users, integer-PK folders
  with `centroid_vector vector(384)`, bookmarks with `raw_text_vector`,
  tags, encrypted-asset metadata. A trigger recomputes folder centroids
  (`avg(vector)`) on every bookmark change. Cosine search via `<=>`.
- **Redis**: buffer between instant API (`LPUSH`) and slow scraping (`BRPOP`).
- **Worker** (`backend/src/worker/worker.go`): scrape → extract → embed
  (Ollama `all-minilm`, dummy vector if offline) → route to nearest folder
  (threshold 0.25) or create via LLM/keyword fallback → summarize/tag
  (Ollama `llama3`, local fallbacks) → AES-256-GCM + MinIO upload.
- **MinIO**: self-hosted S3 for ciphertext blobs only.
  NOTE (2026-09): upstream MinIO builds are archived; `docker-compose.yml`
  uses the `quay.io` mirror, and SELinux hosts need the `:Z` volume flag.
- **Ollama** (`:11434`): local LLM, fully optional — every call has a local
  fallback, verified working with Ollama absent.
- **Frontend** (`frontend/`, Vite + React + TS + Tailwind): auth gate,
  folders/tags sidebar, keyword + semantic search, encrypted archive viewer.
  `/api` proxied to `:5000` in dev and nginx in prod.
- **Zero-knowledge**: PBKDF2-100k(master password, salt) → 512 bits;
  first half = encryption key (never leaves device), second half = auth key
  (bcrypt-hashed server-side). See `frontend/src/crypto.ts`, `extension/crypto.js`.

---

## 4. How It Works — Step by Step

1. **Register/Login:** browser fetches salt → derives keys locally → sends
   only the auth half → server bcrypts/compares → JWT (7 days).
2. **Save (extension or dashboard):** `POST /api/bookmarks/ingest {url}` +
   `X-Encryption-Key` → stub row + Redis job → `202`. Worker scrapes,
   enriches, categorizes, encrypt-archives. UI refresh shows the finished card.
3. **Search:** keyword (`ILIKE` + filters) or semantic (query embedding →
   `ORDER BY vector <=> query`, similarity badge).
4. **View archive:** `GET /api/bookmarks/:id/assets/:type` returns base64
   ciphertext + IV → decrypted in browser → screenshot/PDF/reader view.
5. **Restore (extension):** list folder bookmarks → `chrome.tabs.create`
   (30-tab cap). **Delete:** row + MinIO objects, centroids re-averaged.

---

## 5. API Reference

Auth: `Authorization: Bearer <JWT>` (all but the first three).

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/auth/salt?email=` | real or fake salt (anti-enumeration) |
| POST | `/api/auth/register` | `{email, passwordHash, masterKeySalt}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, passwordHash}` → `{token, user}` |
| GET | `/api/auth/me` | profile |
| GET/POST | `/api/categories` | list (+counts) / create `{name, description}` |
| GET | `/api/tags` | list |
| GET | `/api/bookmarks?categoryId&tagId&isFavorite&q&semantic` | keyword or vector search |
| POST | `/api/bookmarks/ingest` | `{url}` + `X-Encryption-Key` → `202` |
| PATCH | `/api/bookmarks/:id/favorite` | toggle star |
| DELETE | `/api/bookmarks/:id` | row + MinIO objects |
| GET | `/api/bookmarks/:id/assets` | metadata list |
| GET | `/api/bookmarks/:id/assets/:type` | `{encryptedData, initializationVector, checksum}` |

---

## 6. Run It

### 6.1 Full stack (needs Docker/Podman Compose)

```bash
docker compose up --build   # open http://localhost
# PG :5432, Redis :6379, MinIO :9000/:9001, Ollama :11434, API :5000, Web :80
```

### 6.2 Local dev without compose (verified 2026-09-21)

```bash
# 1. Postgres+pgvector (host port 5433 to dodge any system PG on 5432)
podman run -d --name linkhub-db -e POSTGRES_USER=linkhub \
  -e POSTGRES_PASSWORD=linkhub_password -e POSTGRES_DB=linkhub \
  -p 5433:5432 docker.io/pgvector/pgvector:pg15

# 2. Own Redis on 6380
redis-server --port 6380 --daemonize yes --save '' --appendonly no

# 3. MinIO via quay mirror (SELinux hosts: keep the :Z flag)
mkdir -p minio_data && chmod a+rwX minio_data
podman run -d --name linkhub-minio -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadminpassword -p 9000:9000 -p 9001:9001 \
  -v ./minio_data:/data:Z quay.io/minio/minio:latest \
  server /data --console-address ":9001"

# 4. Backend (Ollama optional)
cd backend && go build -o /tmp/linkhub-main main.go
PORT=5000 DATABASE_URL=postgres://linkhub:linkhub_password@localhost:5433/linkhub \
REDIS_URL=redis://localhost:6380 MINIO_ENDPOINT=localhost MINIO_PORT=9000 \
MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadminpassword MINIO_USE_SSL=false \
OLLAMA_URL=http://localhost:11434 /tmp/linkhub-main &

# 5. Frontend  →  http://localhost:5173
cd frontend && npm install && npm run dev
```

**Verified live:** register `201`, login `200`, ingest `202` → processed
(title, summary, folder, tags, 3 MinIO assets) with no Ollama; API stays up.

### 6.3 Troubleshooting: "JSON.parse: unexpected end of data"

Means the frontend can't reach the backend (empty proxy 500 → `res.json()`
throws). Start the backend (§6.2). `Auth.tsx` now shows
"Cannot reach the LinkHub server…" instead (`readJsonBody` helper).

### 6.4 Fixes baked into this tree

1. `go.mod`: dead `go-readability` pin → `v0.0.0-20251205110129-5db1dc9836f0`.
2. Redis import `go-redis` → `redis/go-redis` (old path deleted upstream).
3. Removed unused `io` import (compile error).
4. `schema.sql`: UUID → SERIAL integer PKs (schema/code mismatch broke all DB calls).
5. Worker crash fix: RE2 has no lookbehind — `(?<=[.!?])` panicked and killed
   the whole server on every ingest. Hand-rolled `splitSentences()` +
   `recover()` guard per job.
6. `docker-compose.yml`: minio image → `quay.io` mirror (upstream archived).
7. Root `package.json`: backend script runs `go run main.go` (was a deleted npm script).

---

## 7. Roadmap (50–70 tabs, lightweight + fast)

- Bulk `POST /api/sessions/intake` (extension currently loops single ingest).
- `lite` profile: in-process queue (drop Redis), local-disk blobs (drop MinIO),
  embedded MiniLM ONNX (Ollama opt-in), SQLite+sqlite-vec single-file mode.
- Publish: follow `PUBLISH.md` (zip → test → listing → review).
- Before public release: require `JWT_SECRET`, tighten `CORS *`.

## 8. Project Map

```
manifest.json, popup.*, sidepanel.*        extension (main client)
background.js, common.js, crypto.js        extension logic
backend/main.go                            API + worker entry
backend/schema.sql                         tables + centroid trigger
backend/src/{db,s3,crypto,server,worker}/  pools, storage, AES, routes, ingest
frontend/src/                              React app (also embedded in side panel)
docker-compose.yml                         6-service recipe
README/TESTING/LEARN/PUBLISH.md            extension docs
```
