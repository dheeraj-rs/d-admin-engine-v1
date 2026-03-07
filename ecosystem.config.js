module.exports = {
    apps: [
        {
            name: 'd-admin-engine',
            script: './dist/server.js',
            instances: 1,
            autorestart: true,
            watch: false,
            // Restart automatically if the process exceeds 500MB RAM
            // (npm installs can temporarily spike memory)
            max_memory_restart: '500M',
            // Restart after 1 second to avoid instant-crash loops
            restart_delay: 1000,
            // Maximum restart retries — use a high number so PM2 never gives up
            max_restarts: 50,
            // Node.js flags: increase heap limit to 512MB on the t2/t3 micro
            node_args: '--max-old-space-size=512',
            env: {
                NODE_ENV: 'production',
                PORT: '3001',
            },
            // Log files — tail these to debug crashes
            out_file: './logs/out.log',
            error_file: './logs/error.log',
            merge_logs: true,
            time: true,
        },
    ],
};
