import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(({ mode }) => {
  return {
    plugins: [angular()],
    define: {
      // safely expose the API_KEY from the build environment to the app
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
    }
  };
});