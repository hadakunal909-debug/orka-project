-- Add job_title to users table
-- Run this in Supabase SQL Editor after schema.sql

alter table users add column if not exists job_title text;
