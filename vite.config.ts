import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      angular({
        tsconfig: path.resolve(__dirname, 'tsconfig.app.json'),
      }),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
    }
  };
});