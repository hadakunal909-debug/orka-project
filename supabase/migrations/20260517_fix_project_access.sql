-- Fix: Create missing project_access table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS project_access (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

ALTER TABLE project_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_access_org" ON project_access
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid())
  );
