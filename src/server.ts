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
    // Terminal WebSocket
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
    return;
  }

  // Vite HMR WebSocket: /proxy/:port/...
  // Instead of destroying it, we open a raw TCP tunnel to the local Vite process.
  const proxyWsMatch = pathname.match(/^\/proxy\/(\d+)(\/.*)?$/);
  if (proxyWsMatch) {
    const targetPort = Number(proxyWsMatch[1]);
    if (!isNaN(targetPort) && targetPort > 0 && targetPort <= 65535) {
      const net = require('net');
      const targetSocket = net.connect(targetPort, '127.0.0.1', () => {
        // Rewrite the upgrade request path before forwarding (strip /proxy/:port prefix)
        const viteWsPath = (proxyWsMatch[2] || '/') + (url.search || '');
        const rewrittenRequest = request.rawHeaders
          .reduce<string[]>((acc, val, i) => {
            if (i % 2 === 0) acc.push(`${val}: `);
            else acc[acc.length - 1] += val;
            return acc;
          }, [])
          .join('\r\n');
        const firstLine = `GET ${viteWsPath} HTTP/${request.httpVersion}\r\n`;
        const rawUpgrade = `${firstLine}${rewrittenRequest}\r\n\r\n`;
        targetSocket.write(rawUpgrade);
        if (head && head.length) targetSocket.write(head);
        targetSocket.pipe(socket);
        socket.pipe(targetSocket);
      });
      targetSocket.on('error', (err: Error) => {
        console.error(`[WS Tunnel] Error connecting to Vite port ${targetPort}:`, err.message);
        socket.destroy();
      });
      socket.on('error', () => targetSocket.destroy());
      return;
    }
  }

  // All other upgrade requests rejected
  socket.destroy();
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
