import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Let the official React plugin handle JSX transformation.
// Custom esbuild loader/include settings can prevent JSX from being transformed.
export default defineConfig({
  plugins: [react()],
  build: {
    // Windows denies writes to the existing dist/assets path in this workspace.
    // Publish into a fresh, app-owned output directory instead of touching it.
    outDir: '.hstaff-build',
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
