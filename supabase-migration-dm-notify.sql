-- =============================================
-- MIGRAÇÃO: Sistema de Notificação por DM
-- Execute este SQL no Supabase SQL Editor
-- =============================================

-- Adiciona colunas de controle de notificação na tabela tickets
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS client_last_seen_at TIMESTAMPTZ,   -- Última vez que o cliente estava na página do ticket
  ADD COLUMN IF NOT EXISTS client_notified_at  TIMESTAMPTZ;   -- Última vez que enviamos DM de aviso ao cliente

-- Índice para a query do job de notificação (busca tickets abertos com mensagens não lidas)
CREATE INDEX IF NOT EXISTS idx_tickets_notify
  ON tickets(status, client_last_seen_at, client_notified_at)
  WHERE status = 'open';
