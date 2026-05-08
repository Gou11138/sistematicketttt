let currentUser = null;
let currentTicket = null;
let lastMessageTime = '1970-01-01T00:00:00.000Z';
let pollingInterval = null;
let userDiscordRoles = []; // cargos do usuário no servidor
let renderedMessageIds = new Set(); // IDs já exibidos, evita duplicatas

// ==================== NAVBAR ====================
let currentNav = 'inicio';

function navGoTo(tab) {
  currentNav = tab;

  // Atualiza links ativos
  ['inicio','goupay','loja'].forEach(t => {
    const el = document.getElementById('nav-' + t);
    if (el) el.classList.toggle('active', t === tab);
  });

  // Esconde tudo
  const allSections = ['hero-section','features-section','main-content','footer-section','goupay-section','loja-section','discord-community-section'];
  allSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (tab === 'inicio') {
    // Volta para o estado correto da tela inicial
    if (currentTicket) {
      document.getElementById('main-content').style.display = 'block';
      document.getElementById('chat-section').style.display = 'block';
    } else {
      document.getElementById('hero-section').style.display = 'flex';
      document.getElementById('features-section').style.display = 'block';
      document.getElementById('footer-section').style.display = 'block';
    }
  } else if (tab === 'goupay') {
    document.getElementById('goupay-section').style.display = 'block';
  } else if (tab === 'loja') {
    document.getElementById('loja-section').style.display = 'block';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showNavbar(user, isAdmin) {
  const navbar = document.getElementById('top-navbar');
  if (!navbar) return;
  navbar.style.display = 'flex';
  document.getElementById('navbar-avatar').src = user.avatarUrl;
  document.getElementById('navbar-name').textContent = user.username;
  const adminLink = document.getElementById('navbar-admin-link');
  if (adminLink) adminLink.style.display = isAdmin ? 'inline-flex' : 'none';
}

// ==================== TELAS ====================
function showLoginScreen() {
  const loginEl = document.getElementById('discord-login-screen');
  if (loginEl) loginEl.style.display = 'flex';
  ['hero-section','features-section','main-content','footer-section','goupay-section','loja-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const navbar = document.getElementById('top-navbar');
  if (navbar) navbar.style.display = 'none';
}
function showHomeSection() {
  const loginEl = document.getElementById('discord-login-screen');
  if (loginEl) loginEl.style.display = 'none';
  document.getElementById('hero-section').style.display = 'flex';
  document.getElementById('features-section').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('footer-section').style.display = 'block';
  document.getElementById('chat-section').style.display = 'none';
  document.getElementById('new-ticket-section').style.display = 'none';
  if (document.getElementById('goupay-section')) document.getElementById('goupay-section').style.display = 'none';
  if (document.getElementById('loja-section')) document.getElementById('loja-section').style.display = 'none';
  if (document.getElementById('discord-community-section')) document.getElementById('discord-community-section').style.display = 'block';
  stopPolling();
  currentNav = 'inicio';
  ['inicio','goupay','loja'].forEach(t => {
    const el = document.getElementById('nav-' + t);
    if (el) el.classList.toggle('active', t === 'inicio');
  });
}
function showNewTicket() {
  document.getElementById('discord-login-screen').style.display = 'none';
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('features-section').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('new-ticket-section').style.display = 'block';
  document.getElementById('chat-section').style.display = 'none';
  document.getElementById('footer-section').style.display = 'none';
  document.getElementById('form-user-avatar').src = currentUser.avatarUrl;
  document.getElementById('form-user-name').textContent = currentUser.username;
  renderUserRoles('form-roles-container');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showChatSection(ticket, messages) {
  document.getElementById('discord-login-screen').style.display = 'none';
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('features-section').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('new-ticket-section').style.display = 'none';
  document.getElementById('chat-section').style.display = 'block';
  document.getElementById('footer-section').style.display = 'none';
  currentTicket = ticket;
  renderedMessageIds = new Set(); // limpar ao abrir novo chat
  renderTicketInfo(ticket);
  renderMessages(messages);
  renderUserRoles('chat-roles-container');
  updateChatStatus(ticket.status);
  // Definir timestamp da última mensagem
  if (messages && messages.length > 0) {
    lastMessageTime = messages[messages.length - 1].created_at;
  } else {
    lastMessageTime = new Date().toISOString();
  }
  startPolling();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function backToHome() {
  currentTicket = null;
  stopPolling();
  showHomeSection();
}
async function doLogout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.reload();
}

// ==================== POLLING ====================
let seenInterval = null;

function startPolling() {
  stopPolling();
  pollingInterval = setInterval(pollMessages, 2000);
  // Heartbeat: avisa o servidor que o cliente está vendo o ticket (a cada 30s)
  sendSeenHeartbeat();
  seenInterval = setInterval(sendSeenHeartbeat, 30 * 1000);
}
function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (seenInterval)    { clearInterval(seenInterval);    seenInterval = null; }
}
async function sendSeenHeartbeat() {
  if (!currentTicket || currentTicket.status === 'closed') return;
  try {
    await fetch(`/api/tickets/${currentTicket.id}/seen`, { method: 'POST' });
  } catch (e) { /* silencioso */ }
}
async function pollMessages() {
  if (!currentTicket) return;
  try {
    const res = await fetch(`/api/tickets/${currentTicket.id}/messages?since=${encodeURIComponent(lastMessageTime)}`);
    // Ticket foi deletado pelo admin
    if (res.status === 404) {
      stopPolling();
      currentTicket.status = 'deleted';
      document.getElementById('chat-input-area').style.display = 'none';
      document.getElementById('chat-closed-banner').style.display = 'none';
      document.getElementById('chat-header-status').textContent = '🗑️ Ticket deletado';
      // Mostrar banner de deletado
      const deletedBanner = document.getElementById('chat-deleted-banner');
      if (deletedBanner) deletedBanner.style.display = 'block';
      renderTicketInfo(currentTicket);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();

    // Atualizar status do ticket
    if (data.status && data.status !== currentTicket.status) {
      currentTicket.status = data.status;
      updateChatStatus(data.status);
      renderTicketInfo(currentTicket);
    }

    // Adicionar novas mensagens
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(m => appendMessage(m.sender, m.sender_name, m.sender_avatar, m.content, m.created_at, m.id));
      lastMessageTime = data.messages[data.messages.length - 1].created_at;
    }
  } catch (e) { /* silencioso */ }
}

// ==================== INIT ====================
async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) {
    const msgs = { discord_denied: '⚠️ Login cancelado.', auth_failed: '❌ Falha na autenticação.', db_error: '❌ Erro interno.' };
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msgs[params.get('error')] || '❌ Erro.'; el.style.display = 'block'; }
    window.history.replaceState({}, '', '/');
    showLoginScreen();
    return;
  }
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { showLoginScreen(); return; }
    const data = await res.json();
    if (!data.user) { showLoginScreen(); return; }
    currentUser = data.user;
    document.getElementById('user-avatar').src = currentUser.avatarUrl;
    document.getElementById('user-name').textContent = currentUser.username;
    if (data.isAdmin) document.getElementById('admin-link').style.display = 'inline-flex';

    // Mostra a navbar flutuante
    showNavbar(currentUser, data.isAdmin);

    // Buscar cargos do Discord em paralelo com o ticket
    const [rolesData, tr] = await Promise.all([
      fetch('/api/discord/roles').then(r => r.json()).catch(() => ({ roles: [], inGuild: false })),
      fetch('/api/my-ticket')
    ]);
    userDiscordRoles = rolesData.roles || [];

    if (!tr.ok) { showHomeSection(); return; }
    const td = await tr.json();
    if (td.ticket) { showChatSection(td.ticket, td.messages); }
    else { showHomeSection(); }
    // Mostra o widget flutuante
    showSupportWidget(currentUser, !!td.ticket);
  } catch (e) {
    console.error('Init error:', e);
    showLoginScreen();
  }
}
document.addEventListener('DOMContentLoaded', init);

// ==================== CARGOS DO DISCORD ====================
function renderUserRoles(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Mostrar/esconder labels associados
  if (containerId === 'form-roles-container') {
    const label = document.getElementById('form-roles-label');
    if (label) label.style.display = (!userDiscordRoles || userDiscordRoles.length === 0) ? 'none' : 'block';
  }
  if (containerId === 'chat-roles-container') {
    const wrapper = document.getElementById('chat-roles-wrapper');
    if (wrapper) wrapper.style.display = (!userDiscordRoles || userDiscordRoles.length === 0) ? 'none' : 'block';
  }

  if (!userDiscordRoles || userDiscordRoles.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = userDiscordRoles.map(role => {
    const color = role.color && role.color !== '#000000' ? role.color : '#5865F2';
    return `<span class="role-badge" style="background:${color}22;border-color:${color}66;color:${color}">
      <span class="role-dot" style="background:${color}"></span>${escapeHtml(role.name)}
    </span>`;
  }).join('');
}

// ==================== CRIAR TICKET ====================
async function createTicket() {
  const subject = document.getElementById('ticket-subject').value.trim();
  const message = document.getElementById('ticket-message').value.trim();
  if (!subject || !message) { showAlert('form-alert', 'error', '⚠️ Preencha todos os campos.'); return; }
  const btn = document.getElementById('create-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando...';
  try {
    const data = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, message }) }).then(r => r.json());
    if (data.success) {
      const d = await fetch(`/api/tickets/${data.ticketId}`).then(r => r.json());
      showChatSection(d.ticket, d.messages);
      showToast('🎫 Ticket criado!', 'success');
    } else if (data.ticketId) {
      const d = await fetch(`/api/tickets/${data.ticketId}`).then(r => r.json());
      showChatSection(d.ticket, d.messages);
    } else {
      showAlert('form-alert', 'error', '❌ ' + (data.error || 'Erro.'));
    }
  } catch (e) { showAlert('form-alert', 'error', '❌ Erro de conexão.'); }
  btn.disabled = false; btn.innerHTML = '🚀 Enviar Ticket';
}

// ==================== CHAT ====================
function renderTicketInfo(ticket) {
  document.getElementById('ticket-info-bar').innerHTML = `
    <div class="ticket-info-item"><span class="ticket-info-label">ID</span><span class="ticket-info-value" style="font-family:monospace">#${ticket.id}</span></div>
    <div class="ticket-info-item"><span class="ticket-info-label">Assunto</span><span class="ticket-info-value">${escapeHtml(ticket.subject)}</span></div>
    <div class="ticket-info-item"><span class="ticket-info-label">Status</span><span class="badge ${ticket.status === 'open' ? 'badge-open' : 'badge-closed'}">${ticket.status === 'open' ? '🟢 Aberto' : '🔴 Encerrado'}</span></div>
    <div class="ticket-info-item"><span class="ticket-info-label">Aberto em</span><span class="ticket-info-value">${formatDate(ticket.created_at)}</span></div>`;
}
function renderMessages(messages) {
  const c = document.getElementById('chat-messages');
  if (!messages || messages.length === 0) {
    c.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><h3>Aguardando resposta</h3><p>Nossa equipe responderá em breve!</p></div>`;
    return;
  }
  c.innerHTML = '';
  renderedMessageIds = new Set();
  messages.forEach(m => appendMessage(m.sender, m.sender_name, m.sender_avatar, m.content, m.created_at, m.id));
  scrollToBottom();
}
function appendMessage(sender, senderName, senderAvatar, content, time, id) {
  // Evitar duplicatas pelo ID da mensagem
  if (id !== undefined && id !== null) {
    if (renderedMessageIds.has(id)) return;
    renderedMessageIds.add(id);
  }
  const c = document.getElementById('chat-messages');
  const empty = c.querySelector('.empty-state');
  if (empty) empty.remove();
  const isClient = sender === 'client';
  const def = 'https://cdn.discordapp.com/embed/avatars/0.png';
  const av = senderAvatar || (isClient ? (currentUser?.avatarUrl || def) : def);
  const div = document.createElement('div');
  div.className = `message ${isClient ? 'client' : 'admin'}`;
  div.innerHTML = `<img class="message-avatar" src="${escapeHtml(av)}" alt="" onerror="this.src='${def}'"><div><div class="message-bubble">${escapeHtml(content)}</div><div class="message-time">${escapeHtml(senderName)} · ${formatTime(time)}</div></div>`;
  c.appendChild(div);
  scrollToBottom();
}
function updateChatStatus(status) {
  document.getElementById('chat-input-area').style.display = status === 'closed' ? 'none' : 'flex';
  document.getElementById('chat-closed-banner').style.display = status === 'closed' ? 'block' : 'none';
  document.getElementById('chat-header-status').textContent = status === 'closed' ? '🔴 Ticket encerrado' : '🟢 Online — respondendo tickets';
}

// ==================== ENVIAR MENSAGEM ====================
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !currentTicket || !currentUser) return;
  if (currentTicket.status === 'closed') return;
  input.value = ''; input.style.height = 'auto';

  try {
    const res = await fetch(`/api/tickets/${currentTicket.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.message) {
      // Mostrar a mensagem enviada
      appendMessage('client', currentUser.username, currentUser.avatarUrl, content, data.message.created_at, data.message.id);
      // Atualizar lastMessageTime para não duplicar no polling
      lastMessageTime = data.message.created_at;
    }
  } catch (e) { showToast('Erro ao enviar mensagem.', 'error'); }
}
function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function notifyTyping() {} // sem socket, não há typing indicator
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

// ==================== HELPERS ====================
function scrollToBottom() { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }
function escapeHtml(t) { if (!t) return ''; const d = document.createElement('div'); d.appendChild(document.createTextNode(t)); return d.innerHTML; }
function formatDate(d) { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function formatTime(d) { return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function showAlert(id, type, msg) { const el = document.getElementById(id); if (!el) return; el.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:0">${msg}</div>`; setTimeout(() => el.innerHTML = '', 5000); }
function showToast(message, type = 'default') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div'); t.className = `toast ${type}`;
  t.innerHTML = `<span>${{success:'✅',error:'❌',warning:'⚠️'}[type]||'💬'}</span> ${message}`;
  c.appendChild(t); setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 4000);
}

// ==================== WIDGET FLUTUANTE ====================
let widgetOpen = false;
let widgetScreen = 'home'; // 'home' | 'chat' | 'form'
let widgetPolling = null;
let widgetLastTime = '1970-01-01T00:00:00.000Z';
let widgetRenderedIds = new Set();

function showSupportWidget(user, hasTicket) {
  const btn = document.getElementById('support-widget-btn');
  if (!btn) return;
  btn.style.display = 'flex';
  const greeting = document.getElementById('widget-greeting');
  if (greeting) greeting.textContent = `Olá, ${user.username}! 👋`;

  // Atualiza botões conforme estado do ticket
  const btnChat = document.getElementById('widget-btn-chat');
  const btnNew  = document.getElementById('widget-btn-new');
  if (hasTicket) {
    if (btnChat) btnChat.style.display = 'flex';
    if (btnNew)  btnNew.style.display  = 'none';
  } else {
    if (btnChat) btnChat.style.display = 'none';
    if (btnNew)  btnNew.style.display  = 'flex';
  }
}

function toggleWidget() {
  widgetOpen = !widgetOpen;
  const panel = document.getElementById('support-widget-panel');
  const icon  = document.getElementById('widget-icon');
  if (!panel) return;
  if (widgetOpen) {
    panel.style.display = 'flex';
    if (icon) icon.textContent = '✕';
    // Se já tem ticket aberto, vai direto pro chat
    if (currentTicket) {
      widgetOpenChat();
    } else {
      widgetGoHome();
    }
  } else {
    panel.style.display = 'none';
    if (icon) icon.textContent = '💬';
    widgetStopPolling();
  }
}

function widgetGoHome() {
  widgetScreen = 'home';
  document.getElementById('widget-home').style.display  = 'flex';
  document.getElementById('widget-chat').style.display  = 'none';
  document.getElementById('widget-form').style.display  = 'none';
  widgetStopPolling();
}

function widgetOpenChat() {
  if (!currentTicket) { widgetOpenForm(); return; }
  widgetScreen = 'chat';
  document.getElementById('widget-home').style.display  = 'none';
  document.getElementById('widget-chat').style.display  = 'flex';
  document.getElementById('widget-form').style.display  = 'none';

  // Renderiza mensagens existentes
  widgetRenderedIds = new Set();
  const msgs = document.getElementById('widget-messages');
  if (msgs) msgs.innerHTML = '';
  // Busca mensagens atuais
  fetch(`/api/tickets/${currentTicket.id}/messages?since=1970-01-01T00:00:00.000Z`)
    .then(r => r.json())
    .then(data => {
      if (data.messages) {
        data.messages.forEach(m => widgetAppendMessage(m));
        if (data.messages.length > 0)
          widgetLastTime = data.messages[data.messages.length - 1].created_at;
      }
      widgetUpdateStatus(currentTicket.status);
    }).catch(() => {});

  widgetStartPolling();
}

function widgetOpenForm() {
  widgetScreen = 'form';
  document.getElementById('widget-home').style.display  = 'none';
  document.getElementById('widget-chat').style.display  = 'none';
  document.getElementById('widget-form').style.display  = 'flex';
  document.getElementById('widget-form-alert').innerHTML = '';
}

function widgetAppendMessage(m) {
  if (widgetRenderedIds.has(m.id)) return;
  widgetRenderedIds.add(m.id);
  const container = document.getElementById('widget-messages');
  if (!container) return;
  const isClient = m.sender === 'client';
  const def = 'https://cdn.discordapp.com/embed/avatars/0.png';
  const av  = m.sender_avatar || def;
  const div = document.createElement('div');
  div.className = `message ${isClient ? 'client' : 'admin'}`;
  div.style.cssText = 'max-width:88%';
  div.innerHTML = `<img class="message-avatar" src="${escapeHtml(av)}" alt="" onerror="this.src='${def}'" style="width:26px;height:26px;">
    <div><div class="message-bubble" style="font-size:13px;">${escapeHtml(m.content)}</div>
    <div class="message-time">${escapeHtml(m.sender_name)} · ${formatTime(m.created_at)}</div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function widgetUpdateStatus(status) {
  const inputArea   = document.getElementById('widget-input-area');
  const closedBanner = document.getElementById('widget-closed-banner');
  const headerStatus = document.getElementById('widget-header-status');
  if (inputArea)    inputArea.style.display    = status === 'closed' ? 'none' : 'flex';
  if (closedBanner) closedBanner.style.display = status === 'closed' ? 'block' : 'none';
  if (headerStatus) headerStatus.textContent   = status === 'closed' ? '🔴 Ticket encerrado' : '🟢 Online — respondendo tickets';
}

function widgetStartPolling() {
  widgetStopPolling();
  widgetPolling = setInterval(async () => {
    if (!currentTicket || widgetScreen !== 'chat') return;
    try {
      const res  = await fetch(`/api/tickets/${currentTicket.id}/messages?since=${encodeURIComponent(widgetLastTime)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => widgetAppendMessage(m));
        widgetLastTime = data.messages[data.messages.length - 1].created_at;
        // Badge de notificação se painel fechado
        if (!widgetOpen) {
          const badge = document.getElementById('widget-badge');
          if (badge) badge.style.display = 'block';
        }
      }
      if (data.status) widgetUpdateStatus(data.status);
    } catch {}
  }, 2500);
}

function widgetStopPolling() {
  if (widgetPolling) { clearInterval(widgetPolling); widgetPolling = null; }
}

async function widgetSendMessage() {
  const input = document.getElementById('widget-input');
  const content = input?.value.trim();
  if (!content || !currentTicket) return;
  if (currentTicket.status === 'closed') return;
  input.value = ''; input.style.height = 'auto';
  try {
    const res  = await fetch(`/api/tickets/${currentTicket.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.message) {
      widgetAppendMessage(data.message);
      widgetLastTime = data.message.created_at;
      // Sincroniza com o polling principal
      lastMessageTime = data.message.created_at;
    }
  } catch { showToast('Erro ao enviar.', 'error'); }
}

async function widgetCreateTicket() {
  const subject = document.getElementById('widget-subject')?.value.trim();
  const message = document.getElementById('widget-message')?.value.trim();
  const alertEl = document.getElementById('widget-form-alert');
  if (!subject || !message) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error" style="font-size:13px;padding:10px 14px;">⚠️ Preencha todos os campos.</div>';
    return;
  }
  const btn = document.getElementById('widget-create-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando...';
  try {
    const res  = await fetch('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, message })
    });
    const data = await res.json();
    if (data.success || data.ticketId) {
      const td = await fetch(`/api/tickets/${data.ticketId}`).then(r => r.json());
      currentTicket = td.ticket;
      // Atualiza botões do widget
      const btnChat = document.getElementById('widget-btn-chat');
      const btnNew  = document.getElementById('widget-btn-new');
      if (btnChat) btnChat.style.display = 'flex';
      if (btnNew)  btnNew.style.display  = 'none';
      showToast('🎫 Ticket criado!', 'success');
      widgetLastTime = '1970-01-01T00:00:00.000Z';
      widgetOpenChat();
    } else {
      if (alertEl) alertEl.innerHTML = `<div class="alert alert-error" style="font-size:13px;padding:10px 14px;">❌ ${escapeHtml(data.error || 'Erro.')}</div>`;
    }
  } catch {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-error" style="font-size:13px;padding:10px 14px;">❌ Erro de conexão.</div>';
  }
  btn.disabled = false; btn.innerHTML = '🚀 Enviar Ticket';
}
