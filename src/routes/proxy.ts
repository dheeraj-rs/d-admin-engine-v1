import { Router, type Request, type Response, type NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'http';
import zlib from 'zlib';

export const proxyRouter = Router();

// /proxy/:port/path...
proxyRouter.use('/:port', (req: Request, res: Response, next: NextFunction) => {
    const port = Number(req.params.port);
    if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).send('Invalid port number');
    }

    // Forward to 127.0.0.1:port on the internal container
    const proxy = createProxyMiddleware({
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
        logger: console,
        selfHandleResponse: true,
        pathRewrite: (path, req: any) => {
            // Strip the base /proxy/port mount prefix and preserve the exact remaining path payload
            // For raw HTTP requests, use originalUrl. Fallback to path for safety.
            const urlToRewrite = req.originalUrl || path || '';
            return urlToRewrite.replace(new RegExp(`^/proxy/${port}`), '') || '/';
        },
        on: {
            proxyRes: (proxyRes: IncomingMessage, req: Request, res: Response) => {
                const contentType = proxyRes.headers['content-type'] || '';
                const isHtml = contentType.includes('text/html');

                if (!isHtml) {
                    // Non-HTML: pipe straight through
                    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                    proxyRes.pipe(res, { end: true });
                    return;
                }

                // HTML: buffer, decode, rewrite absolute asset paths → relative
                const chunks: Buffer[] = [];
                proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
                proxyRes.on('end', () => {
                    const raw = Buffer.concat(chunks);
                    const encoding = proxyRes.headers['content-encoding'];

                    const decode = (buf: Buffer): Promise<Buffer> => {
                        if (encoding === 'gzip') return new Promise((r, j) => zlib.gunzip(buf, (e, d) => e ? j(e) : r(d)));
                        if (encoding === 'br') return new Promise((r, j) => zlib.brotliDecompress(buf, (e, d) => e ? j(e) : r(d)));
                        if (encoding === 'deflate') return new Promise((r, j) => zlib.inflate(buf, (e, d) => e ? j(e) : r(d)));
                        return Promise.resolve(buf);
                    };

                    decode(raw).then((decoded) => {
                        let html = decoded.toString('utf-8');

                        const proxyBase = `/proxy/${port}/`;

                        // Rewrite absolute paths (src="/assets", href="/src/main.tsx")
                        // into proxy base paths (src="/proxy/5174/assets") so they don't break on Vercel
                        html = html
                            // Double quotes
                            .replace(/(src|href|action)="\/(?!\/)([^"]*)"/gi, `$1="${proxyBase}$2"`)
                            // Single quotes
                            .replace(/(src|href|action)='\/(?!\/)([^']*)'/gi, `$1='${proxyBase}$2'`)
                            // url() imports in CSS/Style blocks
                            .replace(/url\(\s*["']?\/(?!\/)([^"'\)\s]*)["']?\s*\)/gi, `url(${proxyBase}$1)`);

                        const responseHeaders: Record<string, string | string[]> = {};
                        for (const [key, val] of Object.entries(proxyRes.headers)) {
                            if (key.toLowerCase() === 'content-encoding') continue; // we decoded it
                            if (key.toLowerCase() === 'content-length') continue;    // length changed
                            if (val !== undefined) responseHeaders[key] = val as string | string[];
                        }
                        responseHeaders['content-type'] = 'text/html; charset=utf-8';

                        res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                        res.end(html, 'utf-8');
                    }).catch(() => {
                        // Decode failed — pipe raw
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        res.end(raw);
                    });
                });
            },
            error: (err: Error, req: Request, res: any) => {
                console.error(`[Proxy] Error on port ${port}:`, err.message);

                // If it's a websocket upgrade, res is a Socket, which doesn't have headersSent or writeHead
                if (res.destroy && !res.writeHead) {
                    return res.destroy();
                }

                if (!res.headersSent) {
                    res.writeHead(502, {
                        'Content-Type': 'text/html',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta http-equiv="refresh" content="2">
                            <style>
                                body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #000; color: #fff; }
                                .loader { border: 3px solid #333; border-top: 3px solid #3b82f6; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin-bottom: 16px; }
                                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                            </style>
                        </head>
                        <body>
                            <div class="loader"></div>
                            <h3>Starting Development Server...</h3>
                            <p style="color: #888;">Waiting for port ${port} to be ready. Auto-refreshing...</p>
                        </body>
                        </html>
                    `);
                }
            }
        }
    });

    return proxy(req, res, next);
});

