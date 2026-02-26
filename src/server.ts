import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';

import { TerminalService } from './engine/terminal';
import { FileManager } from './engine/file-manager';
import { config } from './engine/config';
import { projectRouter } from './routes/project';
import { proxyRouter } from './routes/proxy';

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const hostname = config.host;
const port = Number(config.port);

const app = express();

app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Health check (Render, Railway, etc. ping this)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// File/Project API routes — mounted at /project to match the frontend adapter
// (adapter calls BACKEND_URL + "/project/create", etc.)
app.use('/project', projectRouter);

// Proxy route for Vite Dev Servers
app.use('/proxy', proxyRouter);

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const pathname = url.pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  const terminalService = new TerminalService(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      terminalService.handleMessage(data);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    terminalService.cleanup();
  });
});

// Hourly storage cleanup
const fileManager = new FileManager();
setInterval(() => {
  fileManager.cleanupOldProjects(24);
}, 1000 * 60 * 60);

server.listen(port, hostname, () => {
  console.log(`> D-Admin Engine ready on http://${hostname}:${port}`);
  console.log(`  WS endpoint: ws://${hostname}:${port}/ws`);
  console.log(`  API endpoint: http://${hostname}:${port}/project`);
});

// Graceful shutdown (AWS EB sends SIGTERM on deploy/stop)
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
  // Force exit after 10 seconds if connections don't close
  setTimeout(() => process.exit(1), 10000);
});
