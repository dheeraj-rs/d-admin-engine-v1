# D-Admin Engine 🚀

A standalone, self-contained WebSocket + REST API backend for the **D-Admin AI Website Builder**.

This server powers:
- 🖥️ **Interactive Terminals** (via `node-pty` + WebSockets)
- 📁 **File System Management** (create / read / list project files)
- 🔄 **Real-time File Watching** (syncs changes back to the UI)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Start in development mode
npm run dev

# 4. Build for production
npm run build && npm start
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port to listen on | `3001` |
| `HOST` | Host to bind to | `0.0.0.0` |
| `NODE_ENV` | Environment | `development` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (e.g. your Vercel URL) | `*` (all) |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/sandbox/project/create` | Create or update project files |
| `GET` | `/api/sandbox/project/:id/file?path=` | Read a file |
| `GET` | `/api/sandbox/project/:id/dir?path=` | List a directory |
| `WS` | `/api/sandbox/ws` | WebSocket terminal connection |

---

## Deploy for Free

### Render.com (Recommended)
1. Push this repository to GitHub.
2. Go to [render.com](https://render.com) → New → Web Service.
3. Connect your GitHub repo — Render auto-detects `render.yaml`.
4. Click **Deploy**.
5. Copy the Render URL (e.g. `https://d-admin-engine.onrender.com`).
6. Add to your Vercel project:
   - `NEXT_PUBLIC_CODE_RUNNER_API_URL` = `https://d-admin-engine.onrender.com`
   - `NEXT_PUBLIC_CODE_RUNNER_WS_URL` = `wss://d-admin-engine.onrender.com`

### Railway / Fly.io
Both support `Dockerfile` or `npm start` — just deploy the same way.

---

## Project Structure

```
d-admin-engine/
├── src/
│   ├── server.ts          # Main Express + WebSocket server
│   ├── engine/
│   │   ├── config.ts      # Environment config
│   │   ├── file-manager.ts# File system operations
│   │   └── terminal.ts    # PTY terminal service
│   └── routes/
│       └── project.ts     # REST API routes
├── shell-config/          # Custom zsh config for the terminal
├── render.yaml            # Render deployment blueprint
├── .env.example           # Environment variable template
├── package.json
└── tsconfig.json
```
