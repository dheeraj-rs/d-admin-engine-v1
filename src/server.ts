import 'dotenv/config';
import { WebSocketServer } from 'ws';
import http from 'http';

import { TerminalService } from './engine/terminal';
import { FileManager } from './engine/file-manager';
import { config } from './engine/config';
import app from './app';

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const hostname = config.host;
const port = Number(config.port);

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
