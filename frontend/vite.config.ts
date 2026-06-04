import { defineConfig, type Logger } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function silentLogger(): Logger {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    warnOnce: noop,
    errorOnce: noop,
    clearScreen: noop,
    hasErrorLogged: () => false,
    hasWarned: false,
    printUrls: noop,
    outputOptions: {},
    close: noop,
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: 'localhost',
    customLogger: silentLogger(),
    proxy: {
      '/hls': 'http://localhost:5174',
      '/events': 'http://localhost:5174',
      '/channels': 'http://localhost:5174',
      '/health': 'http://localhost:5174',
      '/api': 'http://localhost:5174',  // playback log etc.
      '/mock': 'http://localhost:5174', // P0-3 review-demo injector
    },
  },
});
