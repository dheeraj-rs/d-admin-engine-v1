import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './engine/config';
import { projectRouter } from './routes/project';
import { proxyRouter } from './routes/proxy';

const app = express();

app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Health check (Render, Railway, AWS EB etc. ping this)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// File/Project API routes — mounted at /project to match the frontend adapter
app.use('/project', projectRouter);

// Proxy route for Vite Dev Servers
app.use('/proxy', proxyRouter);

export default app;
