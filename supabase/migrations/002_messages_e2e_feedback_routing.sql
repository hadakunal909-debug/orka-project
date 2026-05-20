-- ============================================================
-- Migration 002 — Messages, E2E encryption, Feedback routing,
--                 User profile fields (job_title, manager, last_seen)
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

-- ── User profile extensions ────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title       text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id      uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at    timestamptz;
-- JWK public key used for ECDH E2E encryption of DMs
ALTER TABLE users ADD COLUMN IF NOT EXISTS e2e_public_key  text;

CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);

-- ── Messages table ─────────────────────────────────────────
-- Drop first so a partial previous run doesn't leave a column-incomplete table.
DROP TABLE IF EXISTS messages CASCADE;
CREATE TABLE messages (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES projects(id) ON DELETE CASCADE,
  card_id      uuid        REFERENCES cards(id) ON DELETE CASCADE,
  -- For DMs: the recipient user; NULL for project/card messages
  recipient_id uuid        REFERENCES users(id) ON DELETE SET NULL,
  author_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  -- Plaintext for project/card messages; AES-GCM ciphertext (base64) for DMs
  content      text        NOT NULL,
  is_encrypted boolean     NOT NULL DEFAULT false,
  mentions     uuid[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX idx_messages_org         ON messages(org_id);
CREATE INDEX idx_messages_project     ON messages(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_messages_card        ON messages(card_id)    WHERE card_id IS NOT NULL;
CREATE INDEX idx_messages_dm          ON messages(recipient_id, author_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX idx_messages_created     ON messages(created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop policies first so the script is re-runnable
DROP POLICY IF EXISTS "messages_read_org"    ON messages;
DROP POLICY IF EXISTS "messages_read_dm"     ON messages;
DROP POLICY IF EXISTS "messages_insert_org"  ON messages;

-- Org members can read project/card messages in their org
CREATE POLICY "messages_read_org" ON messages
  FOR SELECT USING (
    org_id = current_user_org()
    AND recipient_id IS NULL   -- project or card thread
  );

-- DM participants can read their own DMs
CREATE POLICY "messages_read_dm" ON messages
  FOR SELECT USING (
    recipient_id IS NOT NULL
    AND (author_id = auth.uid() OR recipient_id = auth.uid())
  );

-- Org members can insert messages in their org
CREATE POLICY "messages_insert_org" ON messages
  FOR INSERT WITH CHECK (
    org_id = current_user_org()
    AND author_id = auth.uid()
  );

-- ── Feedback routing extensions ────────────────────────────
ALTER TABLE feedback_log ADD COLUMN IF NOT EXISTS assigned_to_id  uuid        REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE feedback_log ADD COLUMN IF NOT EXISTS response         text;
ALTER TABLE feedback_log ADD COLUMN IF NOT EXISTS responded_at     timestamptz;
-- 'open' = no one assigned | 'pending_response' = waiting on assignee
-- | 'responded' = assignee wrote back, originator can resolve
-- | 'resolved' = closed
ALTER TABLE feedback_log ADD COLUMN IF NOT EXISTS status           text        NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS idx_feedback_assigned ON feedback_log(assigned_to_id) WHERE assigned_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_status   ON feedback_log(status);

-- ── Project members view ───────────────────────────────────
-- Convenience view: project → its team members (via teams.id)
CREATE OR REPLACE VIEW project_members AS
  SELECT
    p.id    AS project_id,
    p.org_id,
    tm.user_id,
    tm.role AS member_role,
    u.name,
    u.email,
    u.avatar_url,
    u.job_title,
    u.department_id
  FROM projects p
  JOIN teams t         ON t.id = p.team_id
  JOIN team_members tm ON tm.team_id = t.id
  JOIN users u         ON u.id = tm.user_id;

-- ── Helper: update last_seen_at ────────────────────────────
CREATE OR REPLACE FUNCTION touch_last_seen(p_user_id uuid)
RETURNS void AS $$
  UPDATE users SET last_seen_at = now() WHERE id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;
