const WebSocket = require('ws');
const ws = new WebSocket('wss://d-admin-engine-v1.onrender.com/ws');

ws.on('open', () => {
  console.log('Connected to WS!');
  ws.send(JSON.stringify({ type: 'command', command: 'echo "Hello from WS"' }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  setTimeout(() => ws.close(), 1000);
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
});

ws.on('close', () => {
  console.log('Disconnected');
});
