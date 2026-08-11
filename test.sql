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