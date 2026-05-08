require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./supabase');

const app = express();

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID      = '1404819091805704202';

// ADMIN_DISCORD_ID é lido sempre do env em runtime — nunca cacheado em variável
// Isso garante que qualquer tentativa de manipular a sessão seja revalidada
function getAdminId() {
  return process.env.ADMIN_DISCORD_ID;
}

// ==================== RATE LIMITING ====================
// Rate limiting em memória — funciona por instância (adequado para Vercel)
const rateLimitMap = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    rateLimitMap.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
    }
    next();
  };
}

// SESSION_SECRET e ENCRYPTION_KEY — falha explícita se não configurados em produção
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'mude-isso-para-uma-string-secreta-longa') {
  console.error('❌ FATAL: SESSION_SECRET não configurado ou usando valor padrão. Configure no .env antes de iniciar.');
  process.exit(1);
}
if (!process.env.ADMIN_DISCORD_ID) {
  console.error('❌ FATAL: ADMIN_DISCORD_ID não configurado. Configure no .env antes de iniciar.');
  process.exit(1);
}

const ENCRYPTION_KEY = crypto.scryptSync(
  process.env.SESSION_SECRET,
  'ticket-salt-v1', 32
);

// ==================== CRYPTO ====================
function encrypt(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + enc.toString('hex');
  } catch { return text; }
}

function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;
  try {
    const [ivHex, encHex] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return text; }
}

function s(str, max = 2000) {
  if (!str) return '';
  return String(str).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().substring(0, max);
}

// ==================== MIDDLEWARES ====================
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Security headers em todas as respostas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Bloqueia acesso direto ao admin.html — use a rota /admin no lugar
  if (req.path === '/admin.html') {
    return res.status(403).send('Acesso negado.');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieSession({
  name: 'sid',
  keys: [process.env.SESSION_SECRET, process.env.SESSION_SECRET + '_v2'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}));

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Não autenticado.' });
}

// requireAdmin revalida o ID do admin contra o .env em TODA requisição
// Isso impede que sessões manipuladas ou antigas concedam acesso admin
function requireAdmin(req, res, next) {
  const adminId = getAdminId();
  if (!adminId) return res.status(500).json({ error: 'Configuração inválida.' });
  if (!req.session?.user) return res.status(401).json({ error: 'Não autenticado.' });
  // Dupla verificação: flag de sessão E ID real do usuário contra o env
  if (!req.session.isAdmin || req.session.user.id !== adminId) {
    if (req.session.isAdmin && req.session.user.id !== adminId) {
      req.session = null; // invalida sessão forjada
      console.warn(`⚠️  ALERTA DE SEGURANÇA: Tentativa de acesso admin com ID inválido: ${req.session?.user?.id} | IP: ${req.ip}`);
    }
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  next();
}
function avatarUrl(id, hash) {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${parseInt(id) % 5}.png`;
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`;
}

// ==================== DISCORD OAUTH ====================
app.get('/auth/discord', rateLimit(60 * 1000, 10), (req, res) => {
  // Sem state CSRF — o proxy da Square Cloud não preserva sessão entre redirects
  res.redirect(`https://discord.com/api/oauth2/authorize?` + new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code', scope: 'identify email'
  }));
});

app.get('/auth/discord/callback', rateLimit(60 * 1000, 10), async (req, res) => {
  const { code, error } = req.query;
  if (error || !code || typeof code !== 'string' || code.length > 512) return res.redirect('/?error=discord_denied');
  try {
    const tok = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const u = (await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.data.access_token}` } })).data;

    // Valida que o ID retornado pelo Discord é numérico (snowflake)
    if (!u.id || !/^\d{17,20}$/.test(u.id)) return res.redirect('/?error=auth_failed');

    const av = avatarUrl(u.id, u.avatar);
    await supabase.from('users').upsert({ id: u.id, username: s(u.username, 100), discriminator: u.discriminator || '0', avatar: u.avatar, avatar_url: av, email: encrypt(u.email), updated_at: new Date().toISOString() }, { onConflict: 'id' });
    req.session.user = { id: u.id, username: s(u.username, 100), avatar: u.avatar, avatarUrl: av };

    // isAdmin só é true se o ID bater exatamente com o ADMIN_DISCORD_ID do env
    req.session.isAdmin = (u.id === getAdminId());

    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect('/');
    });
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.post('/auth/logout', requireAuth, (req, res) => {
  req.session = null; // cookie-session: anula o cookie
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.json({ user: null, isAdmin: false });
  // Revalida isAdmin em tempo real contra o env
  const isAdmin = !!(req.session.isAdmin && req.session.user.id === getAdminId());
  res.json({ user: req.session.user, isAdmin });
});

// ==================== TICKETS ====================
app.post('/api/tickets', requireAuth, rateLimit(60 * 1000, 5), async (req, res) => {
  const subject = s(req.body.subject, 200);
  const message = s(req.body.message, 2000);
  const user = req.session.user;
  if (!subject || !message) return res.status(400).json({ error: 'Preencha todos os campos.' });
  const { data: ex } = await supabase.from('tickets').select('id').eq('user_id', user.id).eq('status', 'open').maybeSingle();
  if (ex) return res.status(400).json({ error: 'Você já tem um ticket aberto.', ticketId: ex.id });
  const id = uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();

  // Buscar cargos do Discord ao criar o ticket
  let discordRoles = [];
  let inGuild = false;
  if (DISCORD_BOT_TOKEN) {
    try {
      const memberRes = await axios.get(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${user.id}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
      const memberRoleIds = memberRes.data.roles || [];
      inGuild = true;
      if (memberRoleIds.length > 0) {
        const rolesRes = await axios.get(
          `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/roles`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        );
        discordRoles = rolesRes.data
          .filter(r => memberRoleIds.includes(r.id) && r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null, position: r.position }))
          .sort((a, b) => b.position - a.position);
      }
    } catch (err) {
      if (err.response?.status !== 404) console.error('Erro ao buscar cargos no ticket:', err.response?.data || err.message);
    }
  }

  await supabase.from('tickets').insert({
    id, user_id: user.id, subject: encrypt(subject),
    discord_roles: discordRoles.length > 0 ? JSON.stringify(discordRoles) : null,
    in_guild: inGuild
  });
  await supabase.from('messages').insert({ ticket_id: id, sender: 'client', sender_name: user.username, sender_avatar: user.avatarUrl, content: encrypt(message) });
  res.json({ success: true, ticketId: id });
});

app.get('/api/my-ticket', requireAuth, async (req, res) => {
  const { data: ticket } = await supabase.from('tickets').select('*').eq('user_id', req.session.user.id).eq('status', 'open').maybeSingle();
  if (!ticket) return res.json({ ticket: null });
  const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
  res.json({ ticket: { ...ticket, subject: decrypt(ticket.subject) }, messages: (msgs || []).map(m => ({ ...m, content: decrypt(m.content) })) });
});

app.get('/api/tickets/:id', requireAuth, async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const { data: ticket } = await supabase.from('tickets').select('*, users(id, username, avatar_url)').eq('id', ticketId).single();
  if (!ticket) return res.status(404).json({ error: 'Não encontrado.' });
  if (ticket.user_id !== req.session.user.id && !req.session.isAdmin) return res.status(403).json({ error: 'Acesso negado.' });
  const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
  res.json({ ticket: { ...ticket, subject: decrypt(ticket.subject) }, messages: (msgs || []).map(m => ({ ...m, content: decrypt(m.content) })) });
});

// ==================== MENSAGENS (POLLING) ====================
// Cliente busca mensagens novas desde um timestamp
app.get('/api/tickets/:id/messages', requireAuth, async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const since = req.query.since || '1970-01-01T00:00:00.000Z';

  const { data: ticket } = await supabase.from('tickets').select('user_id, status').eq('id', ticketId).single();
  if (!ticket) return res.status(404).json({ error: 'Não encontrado.' });
  if (ticket.user_id !== req.session.user.id && !req.session.isAdmin) return res.status(403).json({ error: 'Acesso negado.' });

  const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).gt('created_at', since).order('created_at', { ascending: true });
  res.json({ messages: (msgs || []).map(m => ({ ...m, content: decrypt(m.content) })), status: ticket.status });
});

// Cliente envia mensagem via HTTP POST
app.post('/api/tickets/:id/messages', requireAuth, rateLimit(60 * 1000, 30), async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const content = s(req.body.content, 2000);
  const user = req.session.user;
  if (!content) return res.status(400).json({ error: 'Mensagem vazia.' });

  const { data: ticket } = await supabase.from('tickets').select('user_id, status').eq('id', ticketId).single();
  if (!ticket) return res.status(404).json({ error: 'Não encontrado.' });
  if (ticket.status === 'closed') return res.status(400).json({ error: 'Ticket encerrado.' });
  if (ticket.user_id !== user.id) return res.status(403).json({ error: 'Acesso negado.' });

  const { data: msg, error } = await supabase.from('messages').insert({
    ticket_id: ticketId, sender: 'client',
    sender_name: user.username, sender_avatar: user.avatarUrl,
    content: encrypt(content)
  }).select().single();

  if (error) return res.status(500).json({ error: 'Erro ao enviar.' });
  await supabase.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId);
  res.json({ success: true, message: { ...msg, content } });
});

// Admin envia mensagem via HTTP POST
app.post('/api/admin/tickets/:id/messages', requireAdmin, rateLimit(60 * 1000, 60), async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const content = s(req.body.content, 2000);
  const user = req.session.user;
  if (!content) return res.status(400).json({ error: 'Mensagem vazia.' });

  const { data: ticket } = await supabase.from('tickets').select('status').eq('id', ticketId).single();
  if (!ticket) return res.status(404).json({ error: 'Não encontrado.' });
  if (ticket.status === 'closed') return res.status(400).json({ error: 'Ticket encerrado.' });

  const { data: msg, error } = await supabase.from('messages').insert({
    ticket_id: ticketId, sender: 'admin',
    sender_name: user.username, sender_avatar: user.avatarUrl,
    content: encrypt(content)
  }).select().single();

  if (error) return res.status(500).json({ error: 'Erro ao enviar.' });
  await supabase.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId);
  res.json({ success: true, message: { ...msg, content } });
});

// Admin busca mensagens novas
app.get('/api/admin/tickets/:id/messages', requireAdmin, async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const since = req.query.since || '1970-01-01T00:00:00.000Z';
  const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).gt('created_at', since).order('created_at', { ascending: true });
  const { data: ticket } = await supabase.from('tickets').select('status').eq('id', ticketId).single();
  res.json({ messages: (msgs || []).map(m => ({ ...m, content: decrypt(m.content) })), status: ticket?.status });
});

// ==================== ADMIN TICKETS ====================
app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
  const status = req.query.status;
  let query = supabase.from('tickets').select('*, users(id, username, avatar_url)').order('updated_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);
  const { data: tickets, error } = await query;
  if (error) return res.status(500).json({ error: 'Erro.' });
  const result = await Promise.all((tickets || []).map(async (t) => {
    // Contar mensagens do cliente enviadas APÓS o último read do admin
    let unreadQuery = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('ticket_id', t.id).eq('sender', 'client');
    if (t.admin_read_at) unreadQuery = unreadQuery.gt('created_at', t.admin_read_at);
    const { count } = await unreadQuery;
    return { ...t, subject: decrypt(t.subject), unread: count || 0 };
  }));
  res.json(result);
});

app.get('/api/admin/tickets/:id', requireAdmin, async (req, res) => {
  const ticketId = s(req.params.id, 20).toUpperCase();
  const { data: ticket } = await supabase.from('tickets').select('*, users(*)').eq('id', ticketId).single();
  if (!ticket) return res.status(404).json({ error: 'Não encontrado.' });
  const { data: msgs } = await supabase.from('messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });

  // Parsear cargos salvos no ticket
  let discordRoles = [];
  if (ticket.discord_roles) {
    try { discordRoles = JSON.parse(ticket.discord_roles); } catch {}
  }

  res.json({
    ticket: {
      ...ticket,
      subject: decrypt(ticket.subject),
      discord_roles: discordRoles,
      users: ticket.users ? { ...ticket.users, email: ticket.users.email ? decrypt(ticket.users.email) : null } : null
    },
    messages: (msgs || []).map(m => ({ ...m, content: decrypt(m.content) }))
  });
});

app.patch('/api/admin/tickets/:id/close', requireAdmin, async (req, res) => {
  const id = s(req.params.id, 20).toUpperCase();
  await supabase.from('tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', id);
  res.json({ success: true });
});

app.patch('/api/admin/tickets/:id/reopen', requireAdmin, async (req, res) => {
  const id = s(req.params.id, 20).toUpperCase();
  await supabase.from('tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', id);
  res.json({ success: true });
});

app.delete('/api/admin/tickets/:id', requireAdmin, async (req, res) => {
  const id = s(req.params.id, 20).toUpperCase();
  await supabase.from('messages').delete().eq('ticket_id', id);
  await supabase.from('tickets').delete().eq('id', id);
  res.json({ success: true });
});

// Admin marca ticket como lido (zera unread)
app.patch('/api/admin/tickets/:id/read', requireAdmin, async (req, res) => {
  const id = s(req.params.id, 20).toUpperCase();
  await supabase.from('tickets').update({ admin_read_at: new Date().toISOString() }).eq('id', id);
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => res.json({ isAdmin: !!req.session?.isAdmin }));

// Rota protegida para o painel admin — verifica sessão no servidor antes de servir o HTML
app.get('/admin', (req, res) => {
  const adminId = getAdminId();
  if (!req.session?.user || !req.session?.isAdmin || req.session.user.id !== adminId) {
    return res.redirect('/?error=acesso_negado');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== CARGOS DO DISCORD ====================

// Rota admin: busca cargos de qualquer membro pelo userId (para o modal de cargos)
app.get('/api/admin/members/:userId/roles', requireAdmin, rateLimit(60 * 1000, 30), async (req, res) => {
  const userId = s(req.params.userId, 30);
  if (!DISCORD_BOT_TOKEN) return res.json({ roles: [], inGuild: false, error: 'Bot token não configurado.' });
  try {
    const memberRes = await axios.get(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const member = memberRes.data;
    const memberRoleIds = member.roles || [];

    const rolesRes = await axios.get(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const allRoles = rolesRes.data;

    const userRoles = allRoles
      .filter(r => r.name !== '@everyone')
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        position: r.position,
        hasRole: memberRoleIds.includes(r.id),
        manageable: !r.managed && r.name !== '@everyone'
      }))
      .sort((a, b) => b.position - a.position);

    res.json({ roles: userRoles, inGuild: true });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({ roles: [], inGuild: false });
    }
    console.error('Erro ao buscar cargos do membro:', err.response?.data || err.message);
    res.json({ roles: [], inGuild: false, error: 'Erro ao buscar cargos.' });
  }
});

// Rota admin: adicionar cargo a um membro
app.put('/api/admin/members/:userId/roles/:roleId', requireAdmin, rateLimit(60 * 1000, 20), async (req, res) => {
  const userId = s(req.params.userId, 30);
  const roleId = s(req.params.roleId, 30);
  // Valida formato snowflake do Discord para evitar injeção
  if (!/^\d{17,20}$/.test(userId) || !/^\d{17,20}$/.test(roleId)) {
    return res.status(400).json({ error: 'IDs inválidos.' });
  }
  if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token não configurado.' });
  try {
    await axios.put(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
      {},
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao adicionar cargo:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Erro ao adicionar cargo.' });
  }
});

// Rota admin: remover cargo de um membro
app.delete('/api/admin/members/:userId/roles/:roleId', requireAdmin, rateLimit(60 * 1000, 20), async (req, res) => {
  const userId = s(req.params.userId, 30);
  const roleId = s(req.params.roleId, 30);
  // Valida formato snowflake do Discord para evitar injeção
  if (!/^\d{17,20}$/.test(userId) || !/^\d{17,20}$/.test(roleId)) {
    return res.status(400).json({ error: 'IDs inválidos.' });
  }
  if (!DISCORD_BOT_TOKEN) return res.status(400).json({ error: 'Bot token não configurado.' });
  try {
    await axios.delete(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao remover cargo:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Erro ao remover cargo.' });
  }
});

app.get('/api/discord/roles', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  if (!DISCORD_BOT_TOKEN) return res.json({ roles: [], inGuild: false, error: 'Bot token não configurado.' });
  try {
    // Buscar o membro no servidor
    const memberRes = await axios.get(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const member = memberRes.data;
    const memberRoleIds = member.roles || [];

    if (memberRoleIds.length === 0) return res.json({ roles: [], inGuild: true });

    // Buscar todos os cargos do servidor para pegar nome e cor
    const rolesRes = await axios.get(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const allRoles = rolesRes.data;

    // Filtrar apenas os cargos que o membro tem, excluindo @everyone
    const userRoles = allRoles
      .filter(r => memberRoleIds.includes(r.id) && r.name !== '@everyone')
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
        position: r.position
      }))
      .sort((a, b) => b.position - a.position); // mais alto primeiro

    res.json({ roles: userRoles, inGuild: true });
  } catch (err) {
    if (err.response?.status === 404) {
      // Usuário não está no servidor
      return res.json({ roles: [], inGuild: false });
    }
    console.error('Erro ao buscar cargos:', err.response?.data || err.message);
    res.json({ roles: [], inGuild: false, error: 'Erro ao buscar cargos.' });
  }
});

// ==================== START ====================
// Bloqueia qualquer rota /api/* não definida — evita exploração de endpoints
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado.' });
});

// Exporta para Vercel (serverless) e também inicia localmente se executado direto
module.exports = app;

if (require.main === module) {
  const http = require('http');
  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`\n🚀 Servidor na porta ${PORT}`);
    console.log(`🔐 Admin ID configurado: ${getAdminId() ? 'SIM' : 'NÃO'}\n`);
  });
}
