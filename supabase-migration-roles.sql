-- =============================================
-- MIGRAÇÃO: Adicionar cargos do Discord nos tickets
-- Execute este SQL no Supabase SQL Editor
-- (apenas se você já tinha o banco criado antes)
-- =============================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS discord_roles JSONB,
  ADD COLUMN IF NOT EXISTS in_guild BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_read_at TIMESTAMPTZ;
