# LinkHub 🗄️

LinkHub is a self-hosted, privacy-first, AI-powered link ingestion and auto-categorization database. It runs completely locally in a containerized environment (Docker Compose) and utilizes local vector embedding models and a hybrid zero-knowledge encryption architecture.

## Key Features

1. **Zero-Knowledge Asset Vault**: Scraped page dumps, screenshots, and print PDFs are encrypted *on the fly* inside Node.js memory using your browser-derived `AES-256-GCM` key before being saved to MinIO. The server never stores your decryption credentials.
2. **Local AI Vector Classifier**: Automatically generates a 384-dimensional semantic embedding for bookmarks using a locally cached `@xenova/transformers` ONNX model (`all-MiniLM-L6-v2`).
3. **pgvector Centroid Matching**: Automatically matches new bookmarks against existing category centroids via Cosine Distance (`<=>`) in PostgreSQL. Triggers dynamically recalculate folder coordinates as bookmarks are categorized.
4. **Ollama Integration with Auto-Fallback**: Utilizes local LLMs (e.g. Llama 3 or Mistral) for generating summaries and tags. Automatically falls back to local rule-based NLP parser logic if Ollama is offline.
5. **Mobile PWA Integration**: Serves as a native "Share Target" in Android/iOS share trays to easily catalog links directly from standard mobile browsers.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          INGESTION CLIENTS                             │
│       ┌───────────────┐               ┌──────────────────────┐         │
│       │  Browser App  │               │   Mobile PWA Share   │         │
└───────┴───────┬───────┴───────────────┴──────────┬───────────┴─────────┘
                │                                  │
                ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT-SIDE PROCESSING                          │
│  - Derive AES-GCM-256 keys locally via PBKDF2 from Master Password.    │
│  - Store session keys purely in browser memory/sessionStorage.         │
│  - Decrypt binary media files in-browser during preview.               │
└────────────────────────┬───────────────────────────────────────────────┘
                         │
        HTTPS Requests (Includes ephemeral X-Encryption-Key header)
                         │
                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API & QUEUE WORKER                      │
│  ┌──────────────────────────────────┐  ┌────────────────────────────┐  │
│  │        Express Controller        │  │     BullMQ Worker Queue    │  │
│  │     (Saves Ingestion Job)        │  │  (Async Playwright Scrapes)│  │
│  └──────────────────────────────────┘  └─────────────┬──────────────┘  │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      STORAGE & COMPUTE ENGINES                         │
│  ┌───────────────────────────┐ ┌────────────────────────────────────┐  │
│  │   PostgreSQL + pgvector   │ │      Local ONNX Embeddings         │  │
│  │  (Saves vectors/centroids)│ │        (Transformers.js)           │  │
│  └───────────────────────────┘ └────────────────────────────────────┘  │
│  ┌───────────────────────────┐ ┌────────────────────────────────────┐  │
│  │        Redis Broker       │ │         MinIO Object Storage       │  │
│  │      (BullMQ Broker)      │ │      (Holds Encrypted Assets)      │  │
│  └───────────────────────────┘ └────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start (Docker Compose)

The entire environment (Database, Redis, MinIO S3, Ollama, API Backend, and React Frontend) can be initialized in a single command.

### 1. Requirements
Ensure you have the following installed:
- Docker Engine & Compose
- Node.js (v18+) - optional, for running local diagnostics

### 2. Startup
Run the following in the root directory:
```bash
docker compose up --build
```
This builds and starts:
- **PostgreSQL Database** on port `5432`
- **Redis Queue Broker** on port `6379`
- **MinIO Object Store** on port `9000` (Console on `9001`)
- **Ollama LLM Engine** on port `11434`
- **LinkHub Backend API** on port `5000`
- **LinkHub React Frontend** (Reverse Nginx Proxy) on port `80`

Open your web browser and navigate to **`http://localhost`** (or `http://localhost:5173` in development mode) to start using LinkHub.

---

## Local Development Setup

If you prefer to run the Node and Vite engines on your host machine for development:

1. Start background database & storage services:
   ```bash
   npm run db:up
   ```
2. Install root and service dependencies:
   ```bash
   npm install
   npm run install --prefix backend
   npm run install --prefix frontend
   ```
3. Start development servers concurrently:
   ```bash
   npm run dev
   ```
The frontend is available at `http://localhost:5173` and automatically proxies API calls to `http://localhost:5000`.

---

## Diagnostic Pipeline Testing

We have built a standalone diagnostics script to verify core modules (embeddings, database schemas, and cryptography operations) operate correctly on your host:

```bash
cd backend
npm install
node test-pipeline.js
```

This verifies:
1. **AES-256-GCM Symmetrical Wrapper**: Tests key generation, byte-array encryption, and byte-appended authentication tag parsing.
2. **Transformers.js ONNX Extractor**: Tests downloading the model locally, tokenizing a sentence, and generating 384-dimensional vectors offline.

---

## Production Deployment

### 1. Reverse Proxy & SSL (Production Domain)
When deploying to a public server or VPS:
- Modify `docker-compose.yml` to remove host port exposures for databases (`db`, `redis`, `minio`) to restrict access solely within the Docker subnet.
- Configure Let's Encrypt SSL certificates. We recommend placing **Nginx Proxy Manager** or **Traefik** in front of the `frontend` container (port `80`) to handle SSL termination.

### 2. Persistent Volume Backups
Ensure these Docker volume directories are regularly backed up:
- `pgdata`: Holds metadata, folder structures, and vector indexes.
- `miniodata`: Holds all encrypted screenshot images, printable PDFs, and readable source HTML dump archives.
