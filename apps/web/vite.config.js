/// <reference types="vitest" />
// Use vitest's defineConfig so the `test:` block is type-checked. It's a
// superset of vite's config — same shape for everything else.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            // Proxy API calls during dev so we don't have to deal with CORS
            // for every request — only the OAuth flow hits Google directly.
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: function (p) { return p.replace(/^\/api/, ''); },
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
    },
});
