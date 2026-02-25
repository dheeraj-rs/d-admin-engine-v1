import { Router, Request, Response } from 'express';
import { FileManager } from '../engine/file-manager';

export const projectRouter = Router();
const fileManager = new FileManager();

// POST /api/sandbox/project/create
// Creates or updates files in a project sandbox
projectRouter.post('/create', async (req: Request, res: Response) => {
  const { projectId, files, isMount } = req.body;
  if (!projectId || typeof files !== 'object') {
    res.status(400).json({ success: false, error: 'Missing projectId or files' });
    return;
  }
  try {
    await fileManager.createProject(projectId, files, !!isMount);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ProjectRoute] createProject error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sandbox/project/:projectId/file?path=relative/path
// Reads a single file from a project sandbox
projectRouter.get('/:projectId/file', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ success: false, error: 'Missing path query parameter' });
    return;
  }
  try {
    const content = await fileManager.readFile(projectId, filePath);
    if (content === null) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.json({ success: true, content });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sandbox/project/:projectId/dir?path=relative/path
// Lists contents of a directory in a project sandbox
projectRouter.get('/:projectId/dir', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const dirPath = (req.query.path as string) || '';
  try {
    const files = await fileManager.readdir(projectId, dirPath);
    if (files === null) {
      res.json({ success: true, exists: false, files: [] });
      return;
    }
    res.json({ success: true, exists: true, files });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
