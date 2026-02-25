import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const jiraTarget = env.VITE_JIRA_BASE_URL;

  return {
    plugins: [react()],
    server: jiraTarget
      ? {
          proxy: {
            '/jira': {
              target: jiraTarget,
              changeOrigin: true,
              secure: false,
              rewrite: (path) => path.replace(/^\/jira/, '')
            }
          }
        }
      : undefined
  };
});
