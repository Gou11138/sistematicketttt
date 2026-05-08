-- =============================================
-- SCHEMA DO SISTEMA DE TICKETS
-- Execute este SQL no Supabase SQL Editor
-- =============================================

-- Tabela de usuários (autenticados via Discord)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- Discord user ID
  username TEXT NOT NULL,                 -- Nome de usuário Discord
  discriminator TEXT DEFAULT '0',         -- Discriminador (#0000)
  avatar TEXT,                            -- Hash do avatar Discord
  avatar_url TEXT,                        -- URL completa do avatar
  email TEXT,                             -- Email do Discord
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de tickets
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  discord_roles JSONB,                    -- Cargos do Discord do usuário no momento da abertura
  in_guild BOOLEAN DEFAULT FALSE,         -- Se o usuário está no servidor Discord
  admin_read_at TIMESTAMPTZ,              -- Última vez que o admin leu o ticket (para calcular unread)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de mensagens
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('client', 'admin')),
  sender_name TEXT NOT NULL,
  sender_avatar TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (Row Level Security) - desabilitar para uso server-side com service key
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
