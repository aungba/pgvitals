test

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE USER test WITH PASSWORD 'XJwdkv6mxeVhFoI';

GRANT CONNECT ON DATABASE your_database_name TO test;
GRANT pg_read_all_stats TO test;
GRANT pg_read_all_data TO test;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE USER test WITH PASSWORD 'XJwdkv6mxeVhFoI';

GRANT CONNECT ON DATABASE sms TO test;
GRANT pg_read_all_stats TO test;
GRANT pg_read_all_data TO test;

ALTER ROLE test CONNECTION LIMIT 5;

postgresql://test:XJwdkv6mxeVhFoI@sms-gw.cwvunjmtpwvb.ap-southeast-1.rds.amazonaws.com:5432/sms?sslmode=require
postgresql://grx_user:CSHt7ZH9xpPQbzvcv4Krmu7oAPTilFs6@dpg-d861bqvdl75s739bcecg-a.singapore-postgres.render.com/grxdb?sslmode=require


node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY:
02fd61ad42e9275b92a5dafd551e7fae72b595c9bde8bcbe1f6970d693e5e01b
root@sandbox:/home/ubuntu# 
root@sandbox:/home/ubuntu# echo "POSTGRES_PASSWORD:"
openssl rand -base64 24
POSTGRES_PASSWORD:
8l3x/xb6J9e7nP/rNFapLsP/i/xFg/9W
root@sandbox:/home/ubuntu# 
root@sandbox:/home/ubuntu# echo "REDIS_PASSWORD:"
openssl rand -base64 24
REDIS_PASSWORD:
VJCdFK2G5XPFYBcNKmgnx6XNsjNMb4iv


redis-cli -a VJCdFK2G5XPFYBcNKmgnx6XNsjNMb4iv ping


sudo -u postgres psql << 'SQL'
-- Create the pgvitals user with a strong password
CREATE USER pgvitals WITH PASSWORD '8l3x/xb6J9e7nP/rNFapLsP/i/xFg/9W';
-- Create the database
CREATE DATABASE pgvitals OWNER pgvitals;

-- Connect to it and enable TimescaleDB
\c pgvitals
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Grant full privileges to the pgvitals user
GRANT ALL PRIVILEGES ON DATABASE pgvitals TO pgvitals;
GRANT ALL PRIVILEGES ON SCHEMA public TO pgvitals;
SQL


psql "postgresql://pgvitals:8l3x/xb6J9e7nP/rNFapLsP/i/xFg/9W@localhost:5432/pgvitals" -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"
psql "host=localhost port=5432 dbname=pgvitals user=pgvitals password='8l3x/xb6J9e7nP/rNFapLsP/i/xFg/9W'" -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"




cat > /opt/pgvitals/.env << 'EOF'
# ==============================
# PG Vitals — Production Config
# ==============================

# TimescaleDB (application database)
DATABASE_URL=postgresql://pgvitals:8l3x%2Fxb6J9e7nP%2FrNFapLsP%2Fi%2FxFg%2F9W@localhost:5432/pgvitals

# Redis (BullMQ job queue)
REDIS_URL=redis://:VJCdFK2G5XPFYBcNKmgnx6XNsjNMb4iv@localhost:6379

# Collector
COLLECTOR_PORT=3001
POLLING_INTERVAL_MS=10000
DASHBOARD_BASE_URL=https://pgva.eastasia.cloudapp.azure.com
NODE_ENV=production

# Web App (same domain — Nginx routes /api/ to the collector)
NEXT_PUBLIC_API_URL=https://pgva.eastasia.cloudapp.azure.com

# Encryption key (paste the 64-char hex from step 7)
ENCRYPTION_KEY=02fd61ad42e9275b92a5dafd551e7fae72b595c9bde8bcbe1f6970d693e5e01b

# Clerk Auth (leave empty to skip auth — NOT recommended for production)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_aGVhbHRoeS10cmVlZnJvZy05My5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_m0f6ESjsN1sJt7YTTlDfz7kqsyT8fiTWkTn8zoBYGX

# Stripe Billing (leave empty to disable billing features)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
STRIPE_TEAM_PRICE_ID=
EOF
