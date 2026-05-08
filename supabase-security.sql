-- =============================================
-- SEGURANÇA EXTRA NO SUPABASE
-- Execute no SQL Editor após o schema inicial
-- =============================================

-- 1. Garantir que RLS está desabilitado (usamos service key server-side)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

-- 2. Revogar acesso público (anon key não acessa nada diretamente)
REVOKE ALL ON users FROM anon;
REVOKE ALL ON tickets FROM anon;
REVOKE ALL ON messages FROM anon;
REVOKE ALL ON users FROM authenticated;
REVOKE ALL ON tickets FROM authenticated;
REVOKE ALL ON messages FROM authenticated;

-- 3. Apenas o service_role (usado pelo servidor) tem acesso
GRANT ALL ON users TO service_role;
GRANT ALL ON tickets TO service_role;
GRANT ALL ON messages TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 4. Comentários documentando colunas criptografadas
COMMENT ON COLUMN users.email IS 'AES-256-CBC encrypted';
COMMENT ON COLUMN tickets.subject IS 'AES-256-CBC encrypted';
COMMENT ON COLUMN messages.content IS 'AES-256-CBC encrypted';

-- 5. Índice para busca por user_id (performance)
CREATE INDEX IF NOT EXISTS idx_tickets_user_status ON tickets(user_id, status);
