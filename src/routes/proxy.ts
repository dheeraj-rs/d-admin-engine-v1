import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export const proxyRouter = Router();

// /proxy/:port/path...
proxyRouter.use('/:port', (req, res, next) => {
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
        pathRewrite: (path, req) => {
            // Remove /proxy/port from the path forwarded to the target
            return path.replace(`/proxy/${port}`, '');
        },
        on: {
            error: (err, req, res) => {
                console.error(`[Proxy] Error on port ${port}:`, err.message);
                if ('headersSent' in res && !res.headersSent) {
                    (res as any).status(502).send('Bad Gateway: Proxy target is not running.');
                }
            }
        }
    });

    return proxy(req, res, next);
});
