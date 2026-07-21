# LinkHub 🗄️

LinkHub is a self-hosted, privacy-first, AI-powered bookmark manager and web archiver. It automatically scrapes bookmarked links in the background, extracts their core readable text, generates local vector embeddings, and routes them into semantic folders. 

All scraped archives (HTML dumps, screenshots, and PDFs) are encrypted client-side in the browser before upload, ensuring that the server never gains access to your private credentials or data.

---

## Zero-Knowledge Security Model

LinkHub utilizes a dual-key derivation structure based on your Master Password.

```
                  ┌──────────────────────────────┐
                  │       Master Password        │
                  └──────────────┬───────────────┘
                                 │
                         PBKDF2 (100k iter)
                                 │
                  ┌──────────────┴───────────────┐
                  │       512-bit Seed Key       │
                  └──────┬───────────────┬───────┘
                         │               │
                 [First 256 bits]  [Last 256 bits]
                         │               │
                         ▼               ▼
                 ┌──────────────┐┌──────────────┐
                 │  Encryption  ││Auth Password │
                 │  Key (Client)││ (To Server)  │
                 └──────┬───────┘└──────┬───────┘
                        │               │
             Used in-browser to         Sent to server to authenticate.
             encrypt/decrypt media      Bcrypt-hashed again on the server.
             (Server never sees this)   Server never learns Master Password.
```

1. **Client-Side Derivation**: When you sign in or sign up, your Master Password is run through PBKDF2 (100,000 iterations) with your email address as the salt to derive a 512-bit key.
2. **Authentication Key**: The second 256 bits of the derived key is used as your password hash sent to the server. The server stores this in PostgreSQL using standard Bcrypt hashing.
3. **Data Encryption Key**: The first 256 bits of the derived key is kept in-memory (`sessionStorage`) on your device. This key is used to encrypt files (`AES-256-GCM`) before sending them to the backend, and decrypts them in the browser when previewing. The server never receives this key.

---

## Key Architectural Features

- **Asynchronous Scraping Worker**: Handles link ingestion via a Redis queue. Built in Go using `chromedp` (headless Chrome) to capture screenshots, compile print-to-PDFs, and download raw HTML pages.
- **Content Extraction & Summarization**: Parse pages using `go-readability` to extract clean text. Summarizes and generates tags using local LLMs (via Ollama), with a local word-frequency NLP parser fallback if Ollama is offline.
- **Dynamic Centroid Folder Routing**: Automatically matches new bookmarks against existing category centroids via Cosine Distance (`<=>`) in PostgreSQL using `pgvector`.
- **Automatic Folder Coordinates**: Database triggers automatically recalculate folder centroids whenever bookmarks are added, updated, or deleted.

---

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── crypto/      # Cryptographic helpers (AES-256-GCM)
│   │   ├── db/          # Postgres database pooling and migrations
│   │   ├── s3/          # MinIO / S3 storage integrations
│   │   ├── server/      # Go Gin API Server and endpoints
│   │   └── worker/      # Go Chromedp & Ollama ingestion worker
│   ├── main.go          # Go entrypoint compiling the backend
│   └── schema.sql       # PostgreSQL database schema & triggers
├── frontend/
│   ├── src/             # Vite + React + TypeScript web app
│   └── package.json     # Frontend configuration
├── docker-compose.yml   # Multi-container local environment configuration
└── package.json         # Root scripts to orchestrate local dev
```

---

## Quick Start

LinkHub is designed to run in a containerized environment. 

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Docker** and **Docker Compose**
- **Node.js** (v18+) *[Optional: For host-level development]*

### 2. Up & Running (Docker Compose)
Run the following command at the project root to start the database, storage, Ollama, backend API, and React frontend:
```bash
docker compose up --build
```

This command builds and launches:
* **PostgreSQL + pgvector**: Port `5432` (Metadata & Vector DB)
* **Redis**: Port `6379` (BullMQ Queue Broker)
* **MinIO Object Store**: Port `9000` (Console on `9001`)
* **Ollama LLM Engine**: Port `11434` (Semantic processing)
* **Go Backend API**: Port `5000`
* **React Frontend**: Port `80`

Open your browser and navigate to **`http://localhost`** to start managing your links.

---

## Local Development Setup

If you prefer to run services on your host machine for development:

### 1. Spin up Core Databases & Storage
Start the background services (PostgreSQL, Redis, MinIO) in detached mode:
```bash
npm run db:up
```

### 2. Run the Backend API & Ingestion Worker
You can compile and run the Go backend:
```bash
cd backend
go run main.go
```
*(Make sure to run `go mod tidy` first to download Go dependencies).*

### 3. Run the React Frontend
In a new terminal window, start the Vite development server:
```bash
cd frontend
npm install
npm run dev
```
The frontend will be available at **`http://localhost:5173`** and will automatically proxy API calls to the backend on port `5000`.

---

## Pipeline Diagnostics

To verify that the underlying vector extraction and cryptography layers run correctly on your machine, you can run the diagnostic pipeline test:

```bash
cd backend
npm install
node test-pipeline.js
```
This script tests:
1. **AES-256-GCM Symmetrical Encryption**: Verifies encrypting, tag-appending, and decrypting buffer arrays in Node.
2. **Transformers.js Vector Generation**: Downloads the local ONNX embedding model tokenizing text to verify 384-dimensional vector correctness.
