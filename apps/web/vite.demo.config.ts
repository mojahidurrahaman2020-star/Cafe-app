// Builds the browser-only ONLINE DEMO (sample data, no server) that is published as a web
// page so the owner can try the app on any device. Not used for the café installation.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_ONLINE_DEMO': JSON.stringify('1') },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/demo/main-demo.tsx',
      output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' },
    },
  },
});
