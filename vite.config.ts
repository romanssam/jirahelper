import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const jiraTarget = env.VITE_JIRA_BASE_URL;
  const gitlabTarget = env.VITE_GITLAB_BASE_URL;
  const proxy = {
    ...(jiraTarget
      ? {
          '/jira': {
            target: jiraTarget,
            changeOrigin: true,
            secure: false,
            rewrite: (path: string) => path.replace(/^\/jira/, '')
          }
        }
      : {}),
    ...(gitlabTarget
      ? {
          '/gitlab': {
            target: gitlabTarget,
            changeOrigin: true,
            secure: false,
            rewrite: (path: string) => path.replace(/^\/gitlab/, '')
          }
        }
      : {})
  };

  return {
    plugins: [react()],
    server: Object.keys(proxy).length
      ? {
          proxy
        }
      : undefined
  };
});
