module.exports = {
  apps: [
    {
      name: 'pgvitals-collector',
      cwd: '/opt/pgvitals',
      script: 'pnpm',
      args: '--filter @pgvitals/collector start',
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
      cwd: '/opt/pgvitals',
      script: 'pnpm',
      args: '--filter @pgvitals/web start',
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
