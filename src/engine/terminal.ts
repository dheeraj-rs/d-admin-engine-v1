import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import chokidar, { FSWatcher } from 'chokidar';
import { config } from './config';
import * as os from 'os';

const IGNORED_PATHS = ['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store'];

interface TerminalMessage {
  type: 'start' | 'input' | 'resize';
  projectId?: string;
  command?: string;
  args?: string[];
  data?: string;
  cols?: number;
  rows?: number;
}

export class TerminalService {
  private process: pty.IPty | null = null;
  private socket: WebSocket;
  private watcher: FSWatcher | null = null;
  private idleTimeout: NodeJS.Timeout | null = null;
  private readonly IDLE_LIMIT_MS = 30 * 60 * 1000;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.resetIdleTimeout();
  }

  private resetIdleTimeout() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    this.idleTimeout = setTimeout(() => {
      console.log(`[Terminal] Idle timeout reached. Cleaning up processes to save RAM.`);
      this.send({ type: 'error', message: 'Terminal disconnected due to inactivity (30 minutes).' });
      this.cleanup();
    }, this.IDLE_LIMIT_MS);
  }

  private send(obj: object) {
    if (this.socket.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify(obj)); } catch (_) { }
    }
  }

  startTerminal(projectId: string, command?: string, args?: string[], cols?: number, rows?: number) {
    const baseDir = path.resolve(config.projectsDir);
    const safeProjectId = path.normalize(projectId).replace(/^(\.\.([\/\\]|$))+/, '');
    const cwd = path.resolve(baseDir, safeProjectId);

    if (!cwd.startsWith(baseDir)) {
      this.send({ type: 'error', message: 'Terminal start failed: Access denied (Path traversal).' });
      return;
    }

    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    this.cleanup();

    const shellConfigDir = path.join(__dirname, '../../shell-config');
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      HOME: process.env.HOME || '/root',
      PROMPT: '%F{cyan}~/projects%f %F{white}>%f ',
      PS1: '~/projects > ',
      RPROMPT: '',
      RPS1: '',
      // Force development mode so npm install never skips devDependencies
      // (tools like vite live in devDependencies and would be missing in production mode)
      NODE_ENV: 'development',
    };

    if (env.PATH) {
      env.PATH = `${cwd}/node_modules/.bin:${env.PATH}`;
    }

    let execCommand: string;
    let execArgs: string[];

    const isInteractive = !command || command === 'jsh' || command === '/bin/jsh';

    // Shell selection: prefer zsh on macOS, bash on Linux (Amazon Linux may not have zsh)
    let defaultShell: string;
    if (os.platform() === 'win32') {
      defaultShell = 'cmd.exe';
    } else if (os.platform() === 'darwin' && fs.existsSync('/bin/zsh')) {
      defaultShell = '/bin/zsh';
    } else if (fs.existsSync('/bin/bash')) {
      defaultShell = '/bin/bash';
    } else {
      defaultShell = process.env.SHELL || '/bin/sh';
    }

    const usingZsh = defaultShell.endsWith('zsh');

    // Only inject ZDOTDIR (custom zshrc) when actually using zsh
    if (usingZsh) {
      env.ZDOTDIR = shellConfigDir;
    }

    if (isInteractive) {
      execCommand = defaultShell;
      // Removed '--login' because on Render/AWS, login shells often
      // automatically cd to $HOME, bypassing the `cwd` we explicitly set.
      execArgs = ['-i'];
    } else {
      execCommand = defaultShell;
      execArgs = ['-c', [command, ...(args || [])].join(' ')];
    }

    try {
      this.process = pty.spawn(execCommand, execArgs, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd,
        env: env,
      });

      this.process.onData((data: string) => {
        let cleaned = data
          .split('\n')
          .filter(line => !/;\s*echo\s+"__ACTION_DONE_\d+__\$\?"/.test(line))
          .join('\n')
          .replace(/[^\r\n]*@(?:srv-|render@)[^\r\n]*[$#>]\s*/g, '');

        this.send({ type: 'output', data: cleaned });
      });

      this.process.onExit(({ exitCode }) => {
        this.send({ type: 'exit', exitCode: exitCode });
        this.process = null;
      });

      if (isInteractive) {
        this.startFileWatcher(cwd);
      }
    } catch (err: any) {
      console.error(`[Terminal] Spawn failed for ${projectId}:`, err);
      this.send({ type: 'error', message: `Terminal start failed: ${err.message}` });
    }
  }

  private startFileWatcher(projectDir: string) {
    const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

    this.watcher = chokidar.watch(projectDir, {
      ignored: (p: string) => {
        const rel = path.relative(projectDir, p);
        return IGNORED_PATHS.some(ign => rel === ign || rel.startsWith(ign + '/') || rel.includes(`/${ign}/`));
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const emit = (eventType: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', filePath: string) => {
      const rel = path.relative(projectDir, filePath).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) return;

      const key = `${eventType}:${rel}`;
      clearTimeout(debounceMap.get(key));
      debounceMap.set(key, setTimeout(() => {
        debounceMap.delete(key);

        if (eventType === 'unlink' || eventType === 'unlinkDir') {
          this.send({ type: 'file_change', eventType, path: rel });
          return;
        }

        if (eventType === 'addDir') {
          this.send({ type: 'file_change', eventType: 'addDir', path: rel });
          return;
        }

        try {
          const content = fs.readFileSync(path.join(projectDir, rel), 'utf-8');
          this.send({ type: 'file_change', eventType, path: rel, content });
        } catch {
          this.send({ type: 'file_change', eventType, path: rel, content: '' });
        }
      }, 300));
    };

    this.watcher
      .on('add', (p: string) => emit('add', p))
      .on('change', (p: string) => emit('change', p))
      .on('unlink', (p: string) => emit('unlink', p))
      .on('addDir', (p: string) => emit('addDir', p))
      .on('unlinkDir', (p: string) => emit('unlinkDir', p))
      .on('error', (error: any) => {
        console.error(`[Chokidar] Watcher error:`, error);
        this.send({ type: 'error', message: `File watcher error: ${error.message}` });
        if (this.watcher) { this.watcher.close(); this.watcher = null; }
      });
  }

  handleMessage(message: TerminalMessage) {
    this.resetIdleTimeout();
    switch (message.type) {
      case 'start':
        if (message.projectId) {
          this.startTerminal(message.projectId, message.command, message.args, message.cols, message.rows);
        }
        break;
      case 'input':
        if (message.data != null && this.process) {
          this.process.write(message.data);
        }
        break;
      case 'resize':
        if (message.cols && message.rows && this.process) {
          this.process.resize(message.cols, message.rows);
        }
        break;
    }
  }

  cleanup() {
    if (this.idleTimeout) { clearTimeout(this.idleTimeout); this.idleTimeout = null; }
    this.watcher?.close();
    this.watcher = null;
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch (_) { }
      this.process = null;
    }
  }
}
