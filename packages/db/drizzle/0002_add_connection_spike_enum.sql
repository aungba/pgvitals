-- Add 'connection_spike' to the alert_type enum
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'connection_spike';
