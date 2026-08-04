import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows'
      ? 'chrome105'
      : process.env.TAURI_PLATFORM
        ? 'safari13'
        : 'es2020',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('pdfjs-dist')) return 'pdf';
          if (id.includes('@xterm')) return 'terminal';
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast') || id.includes('hast') || id.includes('unified')) return 'markdown';
          if (id.includes('lightweight-charts') || id.includes('d3-')) return 'charts';
          if (/node_modules\/(react|react-dom|scheduler|zustand|lucide-react)\//.test(id)) return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
});
