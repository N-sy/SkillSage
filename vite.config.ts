
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      angular({
        tsconfig: './tsconfig.app.json',
      }),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
    }
  };
});
