import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 代理到 NestJS 后端
    proxy: {
      '/api': {
        target: 'http://localhost:3888',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 上传/AI 生成的媒体走 /files/... 静态路由，需要转发到 API（不 rewrite）。
      '/files': {
        target: 'http://localhost:3888',
        changeOrigin: true,
      },
    },
  },
});
