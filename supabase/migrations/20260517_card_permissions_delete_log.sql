-- Migration: Add card visibility, soft-delete, and delete log
-- Run this in Supabase SQL Editor

-- 1. Add visibility fields to cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES auth.users(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS visible_to uuid[] DEFAULT '{}';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- 2. Create delete_log table for admin audit trail
CREATE TABLE IF NOT EXISTS delete_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  card_id uuid NOT NULL,
  card_snapshot jsonb NOT NULL,          -- full card data at time of deletion
  deleted_by uuid NOT NULL REFERENCES auth.users(id),
  deleted_by_name text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz DEFAULT NULL,
  restored_by uuid REFERENCES auth.users(id),
  admin_comment text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. RLS for delete_log (admin-only read, system write)
ALTER TABLE delete_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delete_log_org_read" ON delete_log
  FOR SELECT USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "delete_log_org_insert" ON delete_log
  FOR INSERT WITH CHECK (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "delete_log_org_update" ON delete_log
  FOR UPDATE USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- 4. Index for faster queries
CREATE INDEX IF NOT EXISTS idx_cards_deleted_at ON cards(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_is_hidden ON cards(is_hidden) WHERE is_hidden = true;
CREATE INDEX IF NOT EXISTS idx_delete_log_org ON delete_log(org_id, deleted_at DESC);
