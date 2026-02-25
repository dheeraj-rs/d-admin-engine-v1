import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import { parse } from 'url';

import { TerminalService } from './engine/terminal';
import { FileManager } from './engine/file-manager';
import { config } from './engine/config';
import { projectRouter } from './routes/project';

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

// File/Project API routes
app.use('/api/sandbox/project', projectRouter);

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url || '', true);
  if (pathname === '/api/sandbox/ws') {
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
});
