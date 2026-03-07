import fs from 'fs-extra';
import path from 'path';
import { config } from './config';

export class FileManager {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(config.projectsDir);
    fs.ensureDirSync(this.baseDir);
  }

  private getSecurePath(projectId: string, relPath: string = ''): string {
    const safeProjectId = path.normalize(projectId).replace(/^(\.\.([\/\\]|$))+/, '');
    const fullPath = path.resolve(this.baseDir, safeProjectId, relPath);
    if (!fullPath.startsWith(this.baseDir)) {
      throw new Error('Access denied: Path traversal detected.');
    }
    return fullPath;
  }

  async createProject(projectId: string, files: Record<string, string>, isMount: boolean = false) {
    const projectPath = this.getSecurePath(projectId);

    // Auto-cleanup: enforce single-project storage on the server
    try {
      const allProjects = await fs.readdir(this.baseDir);
      for (const dirName of allProjects) {
        if (dirName !== path.basename(projectPath)) {
          const oldProjectPath = path.join(this.baseDir, dirName);
          await fs.remove(oldProjectPath);
          console.log(`[Storage] Cleaned up old project: ${dirName}`);
        }
      }
    } catch (err) {
      console.error('[Storage] Error during project cleanup:', err);
    }

    if (isMount) {
      await fs.emptyDir(projectPath);
    } else {
      await fs.ensureDir(projectPath);
    }
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = this.getSecurePath(projectId, filePath);
      await fs.outputFile(fullPath, content);
    }
  }

  async readFile(projectId: string, filePath: string): Promise<string | null> {
    const fullPath = this.getSecurePath(projectId, filePath);
    if (await fs.pathExists(fullPath)) {
      const stat = await fs.stat(fullPath);
      if (stat.size > 5 * 1024 * 1024) {
        throw new Error('File is too large to read into memory (max 5MB limit).');
      }
      return await fs.readFile(fullPath, 'utf-8');
    }
    return null;
  }

  async readdir(projectId: string, dirPath: string): Promise<string[] | null> {
    const fullPath = this.getSecurePath(projectId, dirPath);
    if (await fs.pathExists(fullPath)) {
      return await fs.readdir(fullPath);
    }
    return null;
  }

  async cleanupOldProjects(maxAgeHours: number = 24) {
    try {
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      const projects = await fs.readdir(this.baseDir);
      let deletedCount = 0;
      for (const projectDir of projects) {
        const fullPath = path.join(this.baseDir, projectDir);
        try {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory() && (now - stats.mtimeMs) > maxAgeMs) {
            await fs.remove(fullPath);
            deletedCount++;
          }
        } catch (err) { }
      }
      if (deletedCount > 0) {
        console.log(`[Storage] Reclaimed disk space by deleting ${deletedCount} abandoned sandboxes.`);
      }
    } catch (error) {
      console.error('[Storage] Failed to run automated cleanup:', error);
    }
  }
}
