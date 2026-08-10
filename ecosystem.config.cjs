module.exports = {
  apps: [
    {
      name: "pgvitals-collector",
      cwd: "/opt/pgvitals",
      script: "apps/collector/dist/index.js",
      node_args: "--env-file=apps/collector/.env",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/var/log/pgvitals/collector-error.log",
      out_file: "/var/log/pgvitals/collector-out.log",
      merge_logs: true,
    },
    {
      name: "pgvitals-web",
      cwd: "/opt/pgvitals/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/var/log/pgvitals/web-error.log",
      out_file: "/var/log/pgvitals/web-out.log",
      merge_logs: true,
    },
  ],
};
