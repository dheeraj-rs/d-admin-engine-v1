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
        ws: true,
        logger: console,
        selfHandleResponse: true,
        pathRewrite: (path) => {
            // Remove /proxy/port from the path forwarded to the target
            return path.replace(`/proxy/${port}`, '') || '/';
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

                        // Rewrite absolute paths like src="/assets/ → src="./assets/
                        // and href="/assets/ → href="./assets/ so they resolve through the proxy
                        html = html
                            .replace(/(src|href)="\/assets\//g, '$1="./assets/')
                            .replace(/(src|href)='\/assets\//g, "$1='./assets/")
                            .replace(/url\(["']?\/assets\//g, "url(./assets/");

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
            error: (err: Error, req: Request, res: Response) => {
                console.error(`[Proxy] Error on port ${port}:`, err.message);
                if (!res.headersSent) {
                    (res as any).status(502).send('Bad Gateway: Proxy target is not running.');
                }
            }
        }
    });

    return proxy(req, res, next);
});

