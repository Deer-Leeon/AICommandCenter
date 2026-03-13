module.exports = {
  apps: [
    {
      name: 'nexus-backend',
      cwd: './backend',
      script: 'node',
      args: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      log_file: './logs/backend.log',
      error_file: './logs/backend-error.log',
    },
    {
      name: 'nexus-frontend',
      cwd: './frontend',
      script: 'npx',
      args: 'vite preview --port 4173 --host',
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      log_file: './logs/frontend.log',
      error_file: './logs/frontend-error.log',
    },
  ],
};
