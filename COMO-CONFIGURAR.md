# 🚀 Guia de Configuração Completo

## 1. Supabase — Banco de Dados

1. Acesse https://supabase.com e crie uma conta
2. Crie um novo projeto
3. Vá em **SQL Editor** e cole o conteúdo do arquivo `supabase-schema.sql` e execute
4. Vá em **Project Settings → API** e copie:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_KEY`

---

## 2. Discord — Aplicação OAuth

1. Acesse https://discord.com/developers/applications
2. Clique em **New Application** e dê um nome
3. Vá em **OAuth2 → General**
4. Copie o **Client ID** → `DISCORD_CLIENT_ID`
5. Clique em **Reset Secret** e copie → `DISCORD_CLIENT_SECRET`
6. Em **Redirects**, adicione:
   ```
   https://SEU_DOMINIO.squareweb.app/auth/discord/callback
   ```
   (Para testes locais, adicione também: `http://localhost:3000/auth/discord/callback`)

### Pegar seu Discord ID (para ser admin):
- No Discord, vá em Configurações → Avançado → Ative "Modo Desenvolvedor"
- Clique com botão direito no seu perfil → "Copiar ID"
- Cole em `ADMIN_DISCORD_ID`

---

## 3. Square Cloud — Deploy

1. Acesse https://squarecloud.app e crie uma conta
2. Instale a CLI: `npm install -g @squarecloud/cli`
3. Faça login: `squarecloud login`
4. Na pasta `ticket-system`, faça o deploy: `squarecloud upload`
5. Após o deploy, configure as variáveis de ambiente no painel da Square Cloud:
   - Vá em seu app → **Environment Variables**
   - Adicione todas as variáveis do `.env.example`

---

## 4. Variáveis de Ambiente

Configure estas variáveis no painel da Square Cloud:

| Variável | Descrição |
|----------|-----------|
| `PORT` | `80` (Square Cloud usa porta 80) |
| `SESSION_SECRET` | String aleatória longa (ex: `abc123xyz...`) |
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave anon do Supabase |
| `SUPABASE_SERVICE_KEY` | Chave service_role do Supabase |
| `DISCORD_CLIENT_ID` | ID da aplicação Discord |
| `DISCORD_CLIENT_SECRET` | Secret da aplicação Discord |
| `DISCORD_REDIRECT_URI` | `https://SEU_DOMINIO.squareweb.app/auth/discord/callback` |
| `ADMIN_DISCORD_ID` | Seu ID do Discord |
| `APP_URL` | `https://SEU_DOMINIO.squareweb.app` |

---

## 5. Teste Local

1. Copie `.env.example` para `.env` e preencha
2. Para testes locais, use `DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback`
3. Instale dependências: `npm install`
4. Inicie: `node server.js`
5. Acesse: `http://localhost:3000`

---

## Como funciona o sistema

### Cliente:
1. Entra no site → tela de login Discord
2. Clica "Entrar com Discord" → autoriza
3. Volta ao site já logado com avatar e nome
4. Se não tiver ticket aberto → pode criar um
5. Se já tiver ticket aberto → vai direto pro chat
6. **Limite de 1 ticket aberto por vez** (automático)

### Admin (você):
1. Acessa `/admin.html`
2. Como seu Discord ID está em `ADMIN_DISCORD_ID`, você já entra direto
3. Vê todos os tickets com avatar dos usuários
4. Responde, fecha, reabre ou deleta tickets
