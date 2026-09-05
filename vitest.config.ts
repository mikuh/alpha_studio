import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Admin tests and Testing Library must share React's act() state, even
  // when admin-web has installed its own React dependency tree.
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
