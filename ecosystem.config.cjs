module.exports = {
  apps: [
    {
      name: 'pgvitals-collector',
      cwd: './',
      script: 'apps/collector/src/index.ts',
      interpreter: './node_modules/.bin/tsx',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'pgvitals-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
