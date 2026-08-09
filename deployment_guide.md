# PG Vitals — Ubuntu VM Deployment Guide (Step by Step)

> **Target:** Ubuntu 22.04 / 24.04 LTS on a VPS (DigitalOcean, AWS EC2, Hetzner, Linode, etc.)
> **Minimum specs:** 2 vCPU, 4 GB RAM, 40 GB SSD
> **Last updated:** 2026-08-05

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Provision the VM](#2-provision-the-vm)
3. [Initial Server Setup](#3-initial-server-setup)
4. [Install Docker & Docker Compose](#4-install-docker--docker-compose) *(skip if bare metal)*
5. [Install Node.js & pnpm](#5-install-nodejs--pnpm)
6. [Clone the Repository](#6-clone-the-repository)
7. [Generate Secrets](#7-generate-secrets)
8. [Configure Environment Variables](#8-configure-environment-variables)
9. [Start Infrastructure (TimescaleDB + Redis)](#9-start-infrastructure-timescaledb--redis)
10. [Run Database Migrations](#10-run-database-migrations)
11. [Build for Production](#11-build-for-production)
12. [Run Tests](#12-run-tests)
13. [Set Up Process Manager (PM2)](#13-set-up-process-manager-pm2)
14. [Configure Nginx Reverse Proxy](#14-configure-nginx-reverse-proxy)
15. [Enable HTTPS with Let's Encrypt](#15-enable-https-with-lets-encrypt)
16. [Configure Firewall (UFW)](#16-configure-firewall-ufw)
17. [Verify the Deployment](#17-verify-the-deployment)
18. [Set Up Automated Backups](#18-set-up-automated-backups)
19. [Set Up Log Rotation](#19-set-up-log-rotation)
20. [Updating PG Vitals](#20-updating-pg-vitals)
21. [Troubleshooting](#21-troubleshooting)

> [!NOTE]
> This guide offers two infrastructure paths: **Docker** (easier setup) or **Bare Metal** (better performance, no Docker dependency). Choose one — the rest of the guide works the same either way.

---

## 1. Architecture Overview

```
Internet
    │
    ▼ (port 443 HTTPS)
┌──────────────────────┐
│  Nginx Reverse Proxy │
│  (SSL termination)   │
└──────┬───────┬───────┘
       │       │
       ▼       ▼
   :3000    :3001
┌────────┐ ┌──────────┐     ┌──────────────────┐
│ Next.js│ │ Collector│────▶│  TimescaleDB     │
│  (Web) │ │ (Fastify)│     │  (port 5432)     │
└────────┘ │          │────▶│                  │
           └──────────┘     └──────────────────┘
                │
                ▼
           ┌──────────┐
           │  Redis   │
           │ (port    │
           │  6379)   │
           └──────────┘
```

| Component | Docker Path | Bare Metal Path | Port |
|-----------|-------------|-----------------|------|
| TimescaleDB | Docker container | System service (`postgresql`) | 5432 (localhost only) |
| Redis | Docker container | System service (`redis-server`) | 6379 (localhost only) |
| Collector API | PM2 managed Node.js | PM2 managed Node.js | 3001 (localhost only) |
| Web Dashboard | PM2 managed Node.js | PM2 managed Node.js | 3000 (localhost only) |
| Nginx | System service | System service | 80/443 (public) |

---

## 2. Provision the VM

Create an Ubuntu VM with your preferred cloud provider. Required:

- **OS:** Ubuntu 22.04 LTS or 24.04 LTS
- **vCPU:** 2+ cores
- **RAM:** 4 GB minimum (8 GB recommended for 10+ monitored databases)
- **Storage:** 40 GB SSD minimum
- **Network:** Public IPv4 address
- **DNS:** Point your domains to the VM's IP address:
  - `pgvitals.example.com` → VM IP (web dashboard)
  - `api.pgvitals.example.com` → VM IP (collector API)

> [!NOTE]
> You can use a single domain with path-based routing instead of subdomains. This guide uses subdomains for clarity.

### 2.1 Sizing Guide

Choose a VM size based on how many PostgreSQL databases you'll monitor:

| | **Small** (1–5 DBs) | **Medium** (5–20 DBs) | **Large** (20–50 DBs) |
|---|---|---|---|
| **vCPU** | 2 | 4 | 8 |
| **RAM** | 4 GB | 8 GB | 16 GB |
| **Disk** | 40 GB SSD | 80 GB SSD | 160 GB SSD |

#### Where the resources go

| Component | RAM | CPU | Disk |
|-----------|-----|-----|------|
| **TimescaleDB** | 1–4 GB (shared_buffers) | Low–moderate | Grows ~50–200 MB/DB/month |
| **Redis** | 50–256 MB | Minimal | < 100 MB |
| **Collector (Node.js)** | 100–300 MB | Spikes every 10s poll | Logs only |
| **Web (Next.js)** | 100–200 MB | On page requests | ~200 MB build cache |
| **Nginx + OS** | ~500 MB | Minimal | ~5 GB |

#### Disk growth by retention tier

| Tier | Retention | Disk per DB/month |
|------|-----------|-------------------|
| Free | 1 day | ~5 MB (auto-purged) |
| Pro | 30 days | ~150 MB |
| Team | 90 days | ~400 MB |

**Example:** 10 databases on Pro plan ≈ 1.5 GB/month. An 80 GB disk gives you 3+ years before needing expansion.

#### Cloud provider pricing (approximate)

| Provider | Small (2c/4GB) | Medium (4c/8GB) |
|----------|---------------|-----------------|
| **Hetzner** | €7/mo | €14/mo |
| **DigitalOcean** | $24/mo | $48/mo |
| **Linode** | $24/mo | $48/mo |
| **AWS EC2** (t3.medium/large) | $30/mo | $60/mo |

> [!TIP]
> Start with the **Small** tier. PG Vitals is lightweight — you can always resize the VM later. TimescaleDB is the main resource consumer.

---

## 3. Initial Server Setup & Dedicated Deployment User

SSH into your VM as root/sudo user and run:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git build-essential ca-certificates gnupg lsb-release ufw

# 3.1 Create a Dedicated Deployment User ('pgvitals')
sudo adduser pgvitals --disabled-password --gecos ""
sudo usermod -aG sudo pgvitals

# 3.2 Configure Deployment Directory and Ownership
sudo mkdir -p /opt/pgvitals /var/log/pgvitals
sudo chown -R pgvitals:pgvitals /opt/pgvitals /var/log/pgvitals

# 3.3 Configure SSH & GitHub Deploy Key (Switch to pgvitals user)
sudo su - pgvitals

mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys

# Generate SSH Deploy Key for GitHub access
ssh-keygen -t ed25519 -C "deploy@pgvitals-server" -N "" -f ~/.ssh/id_ed25519

# Display public key to register in GitHub (Repository -> Settings -> Deploy keys)
cat ~/.ssh/id_ed25519.pub

# Set system timezone
sudo timedatectl set-timezone UTC
```

> [!IMPORTANT]
> **Dedicated User Best Practice**: Running application processes, PM2, and deployment builds under the `pgvitals` user ensures application execution follows principle of least privilege rather than running as `root`.

---

## 4. Install Docker & Docker Compose

> [!TIP]
> **Bare metal path?** Skip this entire section and go directly to [Step 5](#5-install-nodejs--pnpm).

```bash
# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group (no sudo needed for docker commands)
sudo usermod -aG docker $USER

# Apply group change (or log out and back in)
newgrp docker

# Verify installation
docker --version
docker compose version
```

---

## 5. Install Node.js & pnpm

```bash
# Install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js
node --version   # Should be >= 20.x

# Enable corepack and install pnpm
sudo corepack enable
corepack prepare pnpm@latest --activate

# Verify pnpm
pnpm --version
```

---

## 6. Clone the Repository

```bash
# Clone to /opt/pgvitals
sudo mkdir -p /opt/pgvitals
sudo chown $USER:$USER /opt/pgvitals

git clone https://github.com/aungba/pgvitals.git /opt/pgvitals
cd /opt/pgvitals
```

---

## 7. Generate Secrets

Generate secure values that you'll use in the next step:

```bash
# Generate 64-char hex encryption key (for AES-256-GCM)
echo "ENCRYPTION_KEY:"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate a strong PostgreSQL password
echo "POSTGRES_PASSWORD:"
openssl rand -base64 24

# Generate a strong Redis password
echo "REDIS_PASSWORD:"
openssl rand -base64 24
```

> [!CAUTION]
> **Save these values securely.** The `ENCRYPTION_KEY` is used to encrypt all monitored database connection strings. If lost, you'll need to re-register every database.

---

## 8. Configure Environment Variables

Create the production environment file:

```bash
cd /opt/pgvitals
cp .env.example .env
```

Edit `.env` with your actual values:

```bash
nano .env
```

Set the following values (replace placeholders):

```env
# ==============================
# PG Vitals — Production Config
# ==============================

# TimescaleDB (application database)
DATABASE_URL=postgresql://pgvitals:YOUR_POSTGRES_PASSWORD@localhost:5432/pgvitals

# Redis (BullMQ job queue)
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@localhost:6379

# Collector
COLLECTOR_PORT=3001
POLLING_INTERVAL_MS=10000
DASHBOARD_BASE_URL=https://pgvitals.example.com
NODE_ENV=production

# Web App
NEXT_PUBLIC_API_URL=https://api.pgvitals.example.com

# Encryption key (paste the 64-char hex from step 7)
ENCRYPTION_KEY=paste_your_64_char_hex_key_here

# Clerk Auth (leave empty to skip auth — NOT recommended for production)
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=

# Stripe Billing (leave empty to disable billing features)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
STRIPE_TEAM_PRICE_ID=
```

Copy the `.env` file to where each app needs it:

```bash
cp .env apps/collector/.env
cp .env packages/db/.env
```

---

## 9. Start Infrastructure (TimescaleDB + Redis)

Choose **one** of the two options below.

### Option A: Docker (recommended for quick setup)

Create a production Docker Compose file:

```bash
cat > /opt/pgvitals/docker-compose.prod.yml << 'EOF'
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    container_name: pgvitals-timescaledb
    restart: always
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: pgvitals
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: pgvitals
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pgvitals"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 2G

  redis:
    image: redis:7-alpine
    container_name: pgvitals-redis
    restart: always
    ports:
      - "127.0.0.1:6379:6379"
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
  redisdata:
EOF
```

Create a `.env.docker` file for Docker Compose:

```bash
cat > /opt/pgvitals/.env.docker << EOF
POSTGRES_PASSWORD=YOUR_POSTGRES_PASSWORD
REDIS_PASSWORD=YOUR_REDIS_PASSWORD
EOF
```

Start the services:

```bash
cd /opt/pgvitals
docker compose -f docker-compose.prod.yml --env-file .env.docker up -d

# Verify both are healthy
docker compose -f docker-compose.prod.yml ps
```

Expected output:
```
NAME                    STATUS                   PORTS
pgvitals-timescaledb    running (healthy)        127.0.0.1:5432->5432/tcp
pgvitals-redis          running (healthy)        127.0.0.1:6379->6379/tcp
```

> **Done — skip to [Step 10](#10-run-database-migrations).**

---

### Option B: Bare Metal (no Docker)

#### 9B.1 Install TimescaleDB

```bash
# Add PostgreSQL 16 repository
sudo apt install -y gnupg postgresql-common apt-transport-https
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y

# Add TimescaleDB repository
echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -cs) main" | \
  sudo tee /etc/apt/sources.list.d/timescaledb.list
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | \
  sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg

# Install TimescaleDB for PostgreSQL 16
sudo apt update
sudo apt install -y timescaledb-2-postgresql-16

# Run the TimescaleDB tuner (auto-configures postgresql.conf)
sudo timescaledb-tune --yes --quiet

# Restart PostgreSQL to apply config
sudo systemctl restart postgresql
sudo systemctl enable postgresql
```

#### 9B.2 Create the PG Vitals Database & User

```bash
# Switch to postgres user and create the database
sudo -u postgres psql << 'SQL'
-- Create the pgvitals user with a strong password
CREATE USER pgvitals WITH PASSWORD 'YOUR_POSTGRES_PASSWORD';

-- Create the database
CREATE DATABASE pgvitals OWNER pgvitals;

-- Connect to it and enable TimescaleDB
\c pgvitals
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Grant full privileges to the pgvitals user
GRANT ALL PRIVILEGES ON DATABASE pgvitals TO pgvitals;
GRANT ALL PRIVILEGES ON SCHEMA public TO pgvitals;
SQL
```

#### 9B.3 Harden PostgreSQL

Edit `/etc/postgresql/16/main/postgresql.conf`:

```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
```

Key settings to verify/change:

```ini
# Listen only on localhost (default — verify it's set)
listen_addresses = 'localhost'

# Performance tuning (timescaledb-tune should have set these)
shared_buffers = 1GB              # 25% of RAM
effective_cache_size = 3GB        # 75% of RAM
work_mem = 32MB
maintenance_work_mem = 256MB
```

Edit `/etc/postgresql/16/main/pg_hba.conf` to use password auth:

```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Ensure this line exists for local TCP connections:

```
# TYPE  DATABASE  USER      ADDRESS       METHOD
host    pgvitals  pgvitals  127.0.0.1/32  scram-sha-256
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

Verify the connection:

```bash
psql "postgresql://pgvitals:YOUR_POSTGRES_PASSWORD@localhost:5432/pgvitals" -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"
```

Expected output:
```
   extname
-------------
 timescaledb
```

#### 9B.4 Install Redis

```bash
# Install Redis from official Ubuntu repos
sudo apt install -y redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
```

Set these values in `redis.conf`:

```ini
# Bind to localhost only
bind 127.0.0.1 ::1

# Set a password
requirepass YOUR_REDIS_PASSWORD

# Memory limit
maxmemory 256mb
maxmemory-policy allkeys-lru

# Persistence (RDB snapshots)
save 900 1
save 300 10
save 60 10000

# Run as a daemon
daemonize yes
supervised systemd
```

Restart and enable Redis:

```bash
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

Verify Redis:

```bash
redis-cli -a YOUR_REDIS_PASSWORD ping
# Expected: PONG
```

> [!IMPORTANT]
> Both TimescaleDB and Redis are bound to `127.0.0.1` — they are NOT accessible from the internet. Only the Nginx reverse proxy will be publicly exposed.

---

## 10. Run Database Migrations

```bash
cd /opt/pgvitals

# Install all dependencies
pnpm install --frozen-lockfile

# Run Drizzle migrations + create TimescaleDB hypertables
pnpm db:migrate
```

Expected output:
```
Running migrations...
Migrations applied successfully
Creating hypertables...
Done
```

---

## 11. Build for Production

```bash
cd /opt/pgvitals

# Build the collector (TypeScript → JavaScript)
pnpm --filter @pgvitals/collector build

# Build the web app (Next.js production build)
pnpm --filter @pgvitals/web build
```

The build produces:
- `apps/collector/dist/` — Compiled collector JavaScript
- `apps/web/.next/` — Next.js optimized production bundle

---

## 12. Run Tests

Verify everything is working before going live:

```bash
cd /opt/pgvitals
pnpm test
```

Expected output:
```
 ✓ apps/collector/tests/encryption.test.ts (11 tests)
 ✓ apps/collector/tests/redact-query.test.ts (18 tests)
 ✓ apps/collector/tests/cost-model.test.ts (10 tests)
 ✓ apps/collector/tests/fingerprint.test.ts (23 tests)
 ✓ apps/collector/tests/safe-query.test.ts (18 tests)

 Test Files  5 passed (5)
      Tests  80 passed (80)
```

---

## 13. Set Up Process Manager (PM2)

PM2 keeps the Node.js processes running and restarts them on crash or reboot.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Create PM2 ecosystem config
cat > /opt/pgvitals/ecosystem.config.cjs << 'EOF'
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
      script: "node_modules/.bin/next",
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
EOF

# Create log directory
sudo mkdir -p /var/log/pgvitals
sudo chown $USER:$USER /var/log/pgvitals

# Start both services
cd /opt/pgvitals
pm2 start ecosystem.config.cjs

# Verify they're running
pm2 status
```

Expected output:
```
┌─────┬───────────────────────┬─────────────┬──────┬───────┬──────────┐
│ id  │ name                  │ mode        │ ↺    │ status│ cpu      │
├─────┼───────────────────────┼─────────────┼──────┼───────┼──────────┤
│ 0   │ pgvitals-collector    │ fork        │ 0    │ online│ 0%       │
│ 1   │ pgvitals-web          │ fork        │ 0    │ online│ 0%       │
└─────┴───────────────────────┴─────────────┴──────┴───────┴──────────┘
```

```bash
# Save the process list so PM2 restarts them on reboot
pm2 save

# Generate and install the startup script
pm2 startup systemd
# PM2 will print a command — copy and run it. Example:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pgvitals --hp /home/pgvitals
```

---

## 14. Configure Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt install -y nginx

# Create the site config
sudo tee /etc/nginx/sites-available/pgvitals << 'NGINX'
# ==============================
# PG Vitals — Web Dashboard
# ==============================
server {
    listen 80;
    server_name pgvitals.example.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

# ==============================
# PG Vitals — Collector API
# ==============================
server {
    listen 80;
    server_name api.pgvitals.example.com;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Max request body size (for EXPLAIN captures, etc.)
    client_max_body_size 2M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CORS is handled by the Fastify app — don't add it here
    }

    # Health check (no auth)
    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
        access_log off;
    }
}
NGINX

# Enable the site
sudo ln -sf /etc/nginx/sites-available/pgvitals /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t && sudo systemctl reload nginx
```

---

## 15. Enable HTTPS with Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificates (will auto-configure Nginx)
sudo certbot --nginx \
  -d pgvitals.example.com \
  -d api.pgvitals.example.com \
  --non-interactive \
  --agree-tos \
  -m your-email@example.com

# Verify auto-renewal is set up
sudo certbot renew --dry-run
```

After this, Nginx will automatically redirect HTTP → HTTPS and serve your app over TLS.

---

## 16. Configure Firewall (UFW)

```bash
# Allow SSH, HTTP, HTTPS only
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'

# Enable the firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

Expected output:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80,443/tcp (Nginx Full)    ALLOW       Anywhere
```

> [!IMPORTANT]
> Ports 5432 (TimescaleDB) and 6379 (Redis) are NOT in the firewall rules — they are only accessible from localhost.

---

## 17. Verify the Deployment

Run these checks to confirm everything is working:

```bash
# 1. Check infrastructure
# Docker path:
docker compose -f /opt/pgvitals/docker-compose.prod.yml ps
# Bare metal path:
sudo systemctl status postgresql redis-server

# 2. Check PM2 processes
pm2 status

# 3. Check collector health
curl -s http://localhost:3001/health
# Expected: {"status":"ok"}

# 4. Check web app
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# Expected: 200

# 5. Check Nginx is proxying correctly
curl -s -o /dev/null -w "%{http_code}" https://pgvitals.example.com
# Expected: 200

# 6. Check API through Nginx
curl -s https://api.pgvitals.example.com/health
# Expected: {"status":"ok"}

# 7. Check SSL certificate
echo | openssl s_client -connect pgvitals.example.com:443 -servername pgvitals.example.com 2>/dev/null | head -5
```

---

## 18. Set Up Automated Backups

```bash
# Create backup directory
sudo mkdir -p /opt/pgvitals-backups
sudo chown $USER:$USER /opt/pgvitals-backups

# Create backup script
cat > /opt/pgvitals/backup.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/pgvitals-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/pgvitals_${TIMESTAMP}.sql.gz"
KEEP_DAYS=14

# Dump TimescaleDB
# Docker path:
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' | grep -q pgvitals-timescaledb; then
    docker exec pgvitals-timescaledb pg_dump -U pgvitals pgvitals | gzip > "$BACKUP_FILE"
else
    # Bare metal path:
    sudo -u postgres pg_dump pgvitals | gzip > "$BACKUP_FILE"
fi

# Remove backups older than $KEEP_DAYS days
find "$BACKUP_DIR" -name "pgvitals_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "[$(date)] Backup created: $BACKUP_FILE ($(du -sh $BACKUP_FILE | cut -f1))"
SCRIPT

chmod +x /opt/pgvitals/backup.sh

# Test the backup
/opt/pgvitals/backup.sh

# Add to cron — daily at 2 AM UTC
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/pgvitals/backup.sh >> /var/log/pgvitals/backup.log 2>&1") | crontab -
```

**To restore from a backup:**

```bash
# Stop the collector first
pm2 stop pgvitals-collector

# Docker path:
gunzip -c /opt/pgvitals-backups/pgvitals_20260805_020000.sql.gz | \
  docker exec -i pgvitals-timescaledb psql -U pgvitals -d pgvitals

# Bare metal path:
gunzip -c /opt/pgvitals-backups/pgvitals_20260805_020000.sql.gz | \
  sudo -u postgres psql -d pgvitals

# Restart collector
pm2 start pgvitals-collector
```

---

## 19. Set Up Log Rotation

```bash
sudo tee /etc/logrotate.d/pgvitals << 'EOF'
/var/log/pgvitals/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 pgvitals pgvitals
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

---

## 20. Updating PG Vitals

When a new version is available:

```bash
cd /opt/pgvitals

# 1. Pull latest code
git pull origin main

# 2. Install new dependencies (if any)
pnpm install --frozen-lockfile

# 3. Run new migrations (if any)
pnpm db:migrate

# 4. Rebuild both apps
pnpm --filter @pgvitals/collector build
pnpm --filter @pgvitals/web build

# 5. Run tests
pnpm test

# 6. Restart services (zero-downtime for web)
pm2 restart pgvitals-collector
pm2 restart pgvitals-web

# 7. Verify health
curl -s http://localhost:3001/health
pm2 status
```

---

## 21. Troubleshooting

### Common Issues

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Collector won't start | `pm2 logs pgvitals-collector --lines 50` | Check `DATABASE_URL` and `REDIS_URL` in `.env` |
| Web shows "API unavailable" | `curl http://localhost:3001/health` | Ensure collector is running and `NEXT_PUBLIC_API_URL` is correct |
| DB connection refused (Docker) | `docker ps` — check timescaledb status | `docker compose -f docker-compose.prod.yml restart timescaledb` |
| DB connection refused (bare metal) | `sudo systemctl status postgresql` | `sudo systemctl restart postgresql` |
| Redis connection refused (Docker) | `docker logs pgvitals-redis` | Check `REDIS_PASSWORD` matches in `.env` and `.env.docker` |
| Redis connection refused (bare metal) | `sudo systemctl status redis-server` | Check password in `/etc/redis/redis.conf` matches `.env` |
| Nginx 502 Bad Gateway | `pm2 status` — app may be down | Restart: `pm2 restart all` |
| SSL certificate expired | `sudo certbot renew` | Check cron: `systemctl list-timers \| grep certbot` |
| High memory usage | `pm2 monit` | PM2 auto-restarts at 512MB; check for leaks |
| Migrations fail | Check `packages/db/.env` exists | `cp .env packages/db/.env && pnpm db:migrate` |

### Useful Commands

```bash
# View real-time logs
pm2 logs --lines 100

# Monitor CPU/memory
pm2 monit

# Check disk usage
df -h

# ---- Docker path ----
docker stats
docker exec pgvitals-timescaledb psql -U pgvitals -c "SELECT pg_size_pretty(pg_database_size('pgvitals'));"
docker exec pgvitals-redis redis-cli -a YOUR_REDIS_PASSWORD INFO memory | grep used_memory_human

# ---- Bare metal path ----
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('pgvitals'));"
redis-cli -a YOUR_REDIS_PASSWORD INFO memory | grep used_memory_human
sudo systemctl status postgresql redis-server

# Restart everything
pm2 restart all
# Docker: docker compose -f /opt/pgvitals/docker-compose.prod.yml restart
# Bare metal: sudo systemctl restart postgresql redis-server
```

### Health Check Script

Save this as `/opt/pgvitals/healthcheck.sh` for monitoring:

```bash
#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

check() {
    local name=$1 cmd=$2
    if eval "$cmd" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name"
    else
        echo -e "  ${RED}✗${NC} $name"
        FAILED=1
    fi
}

FAILED=0
echo "PG Vitals Health Check"
echo "======================"

check "TimescaleDB" "pg_isready -h localhost -U pgvitals"
check "Redis" "redis-cli -a \$REDIS_PASSWORD ping"
check "Collector API" "curl -sf http://localhost:3001/health"
check "Web Dashboard" "curl -sf -o /dev/null http://localhost:3000"
check "Nginx" "sudo nginx -t"

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC}"
else
    echo -e "${RED}Some checks failed — investigate above.${NC}"
    exit 1
fi
```

```bash
chmod +x /opt/pgvitals/healthcheck.sh
```

---

## Quick Reference Card

```
Project location:    /opt/pgvitals
Logs:                /var/log/pgvitals/
Backups:             /opt/pgvitals-backups/
PM2 config:          /opt/pgvitals/ecosystem.config.cjs
Docker Compose:      /opt/pgvitals/docker-compose.prod.yml  (Docker path only)
Nginx config:        /etc/nginx/sites-available/pgvitals
PostgreSQL config:   /etc/postgresql/16/main/              (bare metal only)
Redis config:        /etc/redis/redis.conf                 (bare metal only)
Environment:         /opt/pgvitals/.env

Start all:           pm2 start ecosystem.config.cjs
Stop all:            pm2 stop all
Restart all:         pm2 restart all
View logs:           pm2 logs
Run migrations:      cd /opt/pgvitals && pnpm db:migrate
Run tests:           cd /opt/pgvitals && pnpm test
Backup now:          /opt/pgvitals/backup.sh
Health check:        /opt/pgvitals/healthcheck.sh
```
