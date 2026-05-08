// admin.js — Painel Admin GouRp
let allTickets=[], currentFilter='all', currentTicketId=null, lastMessageTime='1970-01-01T00:00:00.000Z';
let pollingInterval=null, ticketsRefreshInterval=null, confirmCallback=null, adminUser=null;
let renderedMessageIds=new Set(), openingTicket=false, rolesModalUserId=null, allRolesData=[];

async function init(){
  try{
    const d=await fetch('/api/me').then(r=>r.json());
    if(!d.isAdmin){document.getElementById('access-denied').style.display='flex';return;}
    adminUser=d.user;
    document.getElementById('admin-screen').style.display='flex';
    document.getElementById('admin-avatar').src=adminUser.avatarUrl;
    document.getElementById('admin-username').textContent=adminUser.username;
    loadTickets();
    ticketsRefreshInterval=setInterval(loadTickets,5000);
  }catch(e){document.getElementById('access-denied').style.display='flex';}
}
document.addEventListener('DOMContentLoaded',init);

async function doLogout(){await fetch('/auth/logout',{method:'POST'});window.location.href='/';}

async function loadTickets(){
  try{
    const res=await fetch('/api/admin/tickets');
    if(res.status===401){window.location.href='/';return;}
    const fresh=await res.json();
    if(currentTicketId){const c=fresh.find(t=>t.id===currentTicketId);if(c)c.unread=0;}
    allTickets=fresh; updateStats(); if(!openingTicket)filterTickets(document.getElementById('search-input').value);
  }catch(e){}
}

function updateStats(){
  document.getElementById('stat-total').textContent=allTickets.length;
  document.getElementById('stat-open').textContent=allTickets.filter(t=>t.status==='open').length;
  document.getElementById('stat-closed').textContent=allTickets.filter(t=>t.status==='closed').length;
  document.getElementById('stat-unread').textContent=allTickets.reduce((s,t)=>s+(t.unread||0),0);
}

function setFilter(filter){
  currentFilter=filter;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('filter-'+filter).classList.add('active');
  filterTickets(document.getElementById('search-input').value);
}

function filterTickets(search){
  search=search||''; let f=allTickets;
  if(currentFilter!=='all')f=f.filter(t=>t.status===currentFilter);
  if(search){const q=search.toLowerCase();f=f.filter(t=>(t.users?.username||'').toLowerCase().includes(q)||(t.subject||'').toLowerCase().includes(q)||t.id.toLowerCase().includes(q));}
  renderTicketsList(f);
}

function renderTicketsList(tickets){
  const list=document.getElementById('tickets-list');
  if(!tickets||tickets.length===0){list.innerHTML='<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.2)"><div style="font-size:32px;margin-bottom:10px">📭</div><p style="font-size:13px">Nenhum ticket encontrado</p></div>';return;}
  const existingIds=new Set();
  list.querySelectorAll('.ticket-item[id]').forEach(el=>existingIds.add(el.id.replace('ticket-item-','')));
  const newIds=new Set(tickets.map(t=>t.id));
  existingIds.forEach(id=>{if(!newIds.has(id)){const el=document.getElementById('ticket-item-'+id);if(el)el.remove();}});
  tickets.forEach((t,index)=>{
    const u=t.users||{}, av=u.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png', isActive=t.id===currentTicketId;
    const html='<div class="ticket-item-header"><img class="ticket-item-avatar" src="'+escapeHtml(av)+'" alt="" onerror="this.src=\'https://cdn.discordapp.com/embed/avatars/0.png\'"><span class="ticket-item-name">'+escapeHtml(u.username||'Usuário')+'</span><span class="ticket-item-time">'+timeAgo(t.updated_at)+'</span></div><div class="ticket-item-subject">'+escapeHtml(t.subject||'')+'</div><div class="ticket-item-footer"><span class="ticket-item-id">#'+t.id+'</span><div style="display:flex;align-items:center;gap:5px">'+(t.unread>0?'<span class="unread-badge">'+t.unread+'</span>':'')+'<span class="ticket-item-status '+(t.status==='open'?'status-open':'status-closed')+'">'+(t.status==='open'?'🟢 Aberto':'⚫ Fechado')+'</span></div></div>';
    const existing=document.getElementById('ticket-item-'+t.id);
    if(existing){existing.innerHTML=html;existing.className='ticket-item'+(isActive?' active':'');const ci=Array.from(list.children).indexOf(existing);if(ci!==index)list.insertBefore(existing,list.children[index]||null);}
    else{const div=document.createElement('div');div.className='ticket-item'+(isActive?' active':'');div.id='ticket-item-'+t.id;div.onclick=()=>openTicket(t.id);div.innerHTML=html;list.insertBefore(div,list.children[index]||null);}
  });
}

async function openTicket(ticketId){
  if(openingTicket||ticketId===currentTicketId)return;
  openingTicket=true; const previousId=currentTicketId; currentTicketId=ticketId; stopPolling();
  document.querySelectorAll('.ticket-item').forEach(el=>el.classList.remove('active'));
  const item=document.getElementById('ticket-item-'+ticketId); if(item)item.classList.add('active');
  document.getElementById('chat-empty').style.display='none';
  document.getElementById('chat-content').style.display='flex';
  try{
    const{ticket,messages}=await fetch('/api/admin/tickets/'+ticketId).then(r=>r.json());
    if(currentTicketId!==ticketId){openingTicket=false;return;}
    renderedMessageIds=new Set();
    const u=ticket.users||{};
    document.getElementById('chat-client-avatar').src=u.avatar_url||'https://cdn.discordapp.com/embed/avatars/0.png';
    document.getElementById('chat-client-name').textContent=u.username||'Usuário';
    document.getElementById('chat-ticket-info').textContent='#'+ticket.id+' — '+(ticket.subject||'');
    ticket._userId=ticket.user_id; ticket._username=u.username||'Usuário';
    renderChatActions(ticket);
    renderAdminMessages(messages);
    renderAdminRoles(ticket.discord_roles||[]);
    updateAdminInput(ticket.status);
    lastMessageTime=messages&&messages.length>0?messages[messages.length-1].created_at:new Date().toISOString();
    startPolling(ticketId);
    const t=allTickets.find(x=>x.id===ticketId);
    if(t){t.unread=0;updateStats();const itemEl=document.getElementById('ticket-item-'+ticketId);if(itemEl){const badge=itemEl.querySelector('.unread-badge');if(badge)badge.remove();}}
    fetch('/api/admin/tickets/'+ticketId+'/read',{method:'PATCH'}).catch(()=>{});
  }catch(e){showToast('Erro ao carregar ticket.','error');currentTicketId=previousId;}
  finally{openingTicket=false;}
}

function startPolling(ticketId){stopPolling();pollingInterval=setInterval(()=>pollMessages(ticketId),2000);}
function stopPolling(){if(pollingInterval){clearInterval(pollingInterval);pollingInterval=null;}}

async function pollMessages(ticketId){
  if(!ticketId)return;
  try{
    const data=await fetch('/api/admin/tickets/'+ticketId+'/messages?since='+encodeURIComponent(lastMessageTime)).then(r=>r.json());
    if(data.messages&&data.messages.length>0){
      data.messages.forEach(m=>appendAdminMessage(m.sender,m.sender_name,m.sender_avatar,m.content,m.created_at,m.id));
      lastMessageTime=data.messages[data.messages.length-1].created_at;
      fetch('/api/admin/tickets/'+ticketId+'/read',{method:'PATCH'}).catch(()=>{});
      const t=allTickets.find(x=>x.id===ticketId); if(t){t.unread=0;updateStats();}
    }
    if(data.status&&data.status!==(allTickets.find(t=>t.id===ticketId)?.status)){
      const t=allTickets.find(x=>x.id===ticketId);
      if(t){t.status=data.status;updateStats();updateAdminInput(data.status);renderChatActions({id:ticketId,status:data.status,_userId:t.user_id||'',_username:document.getElementById('chat-client-name').textContent});}
    }
  }catch(e){}
}

function renderAdminRoles(roles){
  const wrapper=document.getElementById('admin-roles-wrapper');
  if(!wrapper)return;
  // Filtra apenas os cargos que o usuário realmente tem (quando vem do ticket, todos já são os cargos dele)
  const activeRoles=(roles||[]).filter(function(r){return r.hasRole===undefined||r.hasRole===true;});
  if(!activeRoles||activeRoles.length===0){wrapper.style.display='none';return;}
  wrapper.style.display='flex';
  wrapper.innerHTML='<span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;margin-right:6px;flex-shrink:0;">🏷️ Cargos:</span><div style="display:flex;flex-wrap:wrap;gap:5px;">'+
    activeRoles.map(function(role){
      const color=role.color&&role.color!=='#000000'?role.color:'#5865F2';
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:'+color+'22;border:1px solid '+color+'66;color:'+color+';white-space:nowrap;"><span style="width:6px;height:6px;border-radius:50%;background:'+color+';flex-shrink:0;"></span>'+escapeHtml(role.name)+'</span>';
    }).join('')+'</div>';
}

function renderChatActions(ticket){
  const actions=document.getElementById('chat-actions');
  actions.innerHTML='';
  const rolesBtn=document.createElement('button');
  rolesBtn.className='admin-chat-btn btn-manage-roles';
  rolesBtn.textContent='🏷️ Cargos';
  rolesBtn.onclick=function(){openRolesModal(ticket._userId||'',ticket._username||'Usuário');};
  actions.appendChild(rolesBtn);
  if(ticket.status==='open'){
    const closeBtn=document.createElement('button');closeBtn.className='admin-chat-btn btn-close-ticket';closeBtn.textContent='🔒 Fechar';closeBtn.onclick=function(){confirmCloseTicket(ticket.id);};actions.appendChild(closeBtn);
  }else{
    const reopenBtn=document.createElement('button');reopenBtn.className='admin-chat-btn btn-reopen-ticket';reopenBtn.textContent='🔓 Reabrir';reopenBtn.onclick=function(){reopenTicket(ticket.id);};actions.appendChild(reopenBtn);
  }
  const deleteBtn=document.createElement('button');deleteBtn.className='admin-chat-btn btn-delete-ticket';deleteBtn.textContent='🗑️';deleteBtn.onclick=function(){confirmDeleteTicket(ticket.id);};actions.appendChild(deleteBtn);
}

function renderAdminMessages(messages){
  const c=document.getElementById('admin-messages');
  if(!messages||messages.length===0){c.innerHTML='<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.15)"><div style="font-size:32px;margin-bottom:10px">💬</div><p style="font-size:13px">Nenhuma mensagem ainda</p></div>';return;}
  c.innerHTML=''; renderedMessageIds=new Set();
  messages.forEach(m=>appendAdminMessage(m.sender,m.sender_name,m.sender_avatar,m.content,m.created_at,m.id));
  scrollAdminToBottom();
}

function appendAdminMessage(sender,senderName,senderAvatar,content,time,id){
  if(id!==undefined&&id!==null){if(renderedMessageIds.has(id))return;renderedMessageIds.add(id);}
  const c=document.getElementById('admin-messages');
  const empty=c.querySelector('div[style*="text-align:center"]'); if(empty)empty.remove();
  const isAdmin=sender==='admin', def='https://cdn.discordapp.com/embed/avatars/0.png';
  const div=document.createElement('div'); div.className='admin-message '+(isAdmin?'from-admin':'from-client');
  div.innerHTML='<img class="admin-message-avatar" src="'+escapeHtml(senderAvatar||def)+'" alt="" onerror="this.src=\''+def+'\'"><div><div class="admin-message-bubble">'+escapeHtml(content)+'</div><div class="admin-message-meta">'+escapeHtml(senderName)+' · '+formatTime(time)+'</div></div>';
  c.appendChild(div); scrollAdminToBottom();
}

function updateAdminInput(status){
  document.getElementById('admin-input-area').style.display=status==='closed'?'none':'flex';
  document.getElementById('admin-closed-banner').style.display=status==='closed'?'block':'none';
}

async function sendAdminMessage(){
  const input=document.getElementById('admin-input'), content=input.value.trim();
  if(!content||!currentTicketId||!adminUser)return;
  input.value=''; input.style.height='auto';
  try{
    const res=await fetch('/api/admin/tickets/'+currentTicketId+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});
    const data=await res.json();
    if(data.message){appendAdminMessage('admin',adminUser.username,adminUser.avatarUrl,content,data.message.created_at,data.message.id);lastMessageTime=data.message.created_at;}
  }catch(e){showToast('Erro ao enviar.','error');}
}
function handleAdminKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAdminMessage();}}
function notifyAdminTyping(){}
function autoResizeAdmin(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

function confirmCloseTicket(id){showConfirm('🔒','Fechar Ticket','O cliente não poderá mais enviar mensagens.','danger',()=>closeTicket(id));}
async function closeTicket(id){
  await fetch('/api/admin/tickets/'+id+'/close',{method:'PATCH'});
  const t=allTickets.find(x=>x.id===id); if(t)t.status='closed'; updateStats();
  if(currentTicketId===id){updateAdminInput('closed');renderChatActions({id:id,status:'closed',_userId:t?t.user_id:'',_username:document.getElementById('chat-client-name').textContent});}
  showToast('🔒 Ticket fechado!','success');
}
async function reopenTicket(id){
  await fetch('/api/admin/tickets/'+id+'/reopen',{method:'PATCH'});
  const t=allTickets.find(x=>x.id===id); if(t)t.status='open'; updateStats();
  if(currentTicketId===id){updateAdminInput('open');renderChatActions({id:id,status:'open',_userId:t?t.user_id:'',_username:document.getElementById('chat-client-name').textContent});}
  showToast('🟢 Ticket reaberto!','success');
}
function confirmDeleteTicket(id){showConfirm('🗑️','Deletar Ticket','Todas as mensagens serão apagadas.','danger',()=>deleteTicket(id));}
async function deleteTicket(id){
  await fetch('/api/admin/tickets/'+id,{method:'DELETE'});
  allTickets=allTickets.filter(t=>t.id!==id);
  const el=document.getElementById('ticket-item-'+id); if(el)el.remove(); updateStats();
  if(currentTicketId===id){currentTicketId=null;stopPolling();document.getElementById('chat-content').style.display='none';document.getElementById('chat-empty').style.display='flex';}
  showToast('🗑️ Ticket deletado.','warning');
}

function showConfirm(icon,title,message,type,callback){
  document.getElementById('confirm-icon').textContent=icon;
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-message').textContent=message;
  const btn=document.getElementById('confirm-action-btn');
  btn.style.background=type==='danger'?'rgba(239,68,68,0.25)':'rgba(34,197,94,0.25)';
  btn.style.color=type==='danger'?'#FCA5A5':'#4ADE80';
  btn.style.border=type==='danger'?'1px solid rgba(239,68,68,0.4)':'1px solid rgba(34,197,94,0.4)';
  confirmCallback=callback; document.getElementById('confirm-overlay').classList.add('active');
}
function closeConfirm(){document.getElementById('confirm-overlay').classList.remove('active');confirmCallback=null;}

document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('confirm-action-btn').addEventListener('click',function(){if(confirmCallback)confirmCallback();closeConfirm();});
  document.getElementById('confirm-overlay').addEventListener('click',function(e){if(e.target===document.getElementById('confirm-overlay'))closeConfirm();});
  document.getElementById('roles-modal-overlay').addEventListener('click',function(e){if(e.target===document.getElementById('roles-modal-overlay'))closeRolesModal();});
});

function openRolesModal(userId,username){
  if(!userId){showToast('❌ ID do usuário não encontrado.','error');return;}
  rolesModalUserId=userId;
  document.getElementById('roles-modal-username').textContent=username||'Usuário';
  document.getElementById('roles-search-input').value='';
  document.getElementById('roles-modal-list').innerHTML='<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.2);"><p style="font-size:13px;">Carregando cargos...</p></div>';
  document.getElementById('roles-modal-overlay').classList.add('active');
  loadMemberRoles(userId);
}
function closeRolesModal(){document.getElementById('roles-modal-overlay').classList.remove('active');rolesModalUserId=null;allRolesData=[];}

async function loadMemberRoles(userId){
  try{
    const res=await fetch('/api/admin/members/'+userId+'/roles');
    const data=await res.json();
    if(!data.inGuild){document.getElementById('roles-modal-list').innerHTML='<div class="roles-not-in-guild">⚠️ Este usuário não está no servidor Discord.</div>';return;}
    allRolesData=data.roles||[]; renderRolesList(allRolesData);
  }catch(e){document.getElementById('roles-modal-list').innerHTML='<div class="roles-not-in-guild">❌ Erro ao carregar cargos.</div>';}
}

function renderRolesList(roles){
  const list=document.getElementById('roles-modal-list');
  if(!roles||roles.length===0){list.innerHTML='<div class="roles-not-in-guild">Nenhum cargo encontrado.</div>';return;}
  list.innerHTML='';
  roles.forEach(function(role){
    const color=role.color&&role.color!=='#000000'?role.color:'#5865F2';
    const notManageable=!role.manageable;
    const row=document.createElement('div'); row.className='role-row'+(notManageable?' not-manageable':'');
    if(!notManageable)row.onclick=function(){toggleRole(role.id,role.hasRole);};
    const dot=document.createElement('span'); dot.className='role-row-dot'; dot.style.background=color;
    const name=document.createElement('span'); name.className='role-row-name'; name.textContent=role.name;
    row.appendChild(dot); row.appendChild(name);
    if(notManageable){const lock=document.createElement('span');lock.style.cssText='font-size:10px;color:rgba(255,255,255,0.2);';lock.textContent='🔒';row.appendChild(lock);}
    else{const toggle=document.createElement('button');toggle.className='role-row-toggle '+(role.hasRole?'on':'off');toggle.id='toggle-'+role.id;toggle.onclick=function(e){e.stopPropagation();toggleRole(role.id,role.hasRole);};row.appendChild(toggle);}
    list.appendChild(row);
  });
}

function filterRolesList(search){
  const q=(search||'').toLowerCase();
  renderRolesList(q?allRolesData.filter(function(r){return r.name.toLowerCase().includes(q);}):allRolesData);
}

async function toggleRole(roleId,currentlyHas){
  if(!rolesModalUserId)return;
  const toggle=document.getElementById('toggle-'+roleId); if(toggle)toggle.classList.add('loading');
  try{
    const res=await fetch('/api/admin/members/'+rolesModalUserId+'/roles/'+roleId,{method:currentlyHas?'DELETE':'PUT'});
    const data=await res.json();
    if(data.success){
      const role=allRolesData.find(function(r){return r.id===roleId;}); if(role)role.hasRole=!currentlyHas;
      if(toggle){toggle.classList.remove('loading',currentlyHas?'on':'off');toggle.classList.add(currentlyHas?'off':'on');toggle.onclick=function(e){e.stopPropagation();toggleRole(roleId,!currentlyHas);};const row=toggle.closest('.role-row');if(row)row.onclick=function(){toggleRole(roleId,!currentlyHas);};}
      showToast(currentlyHas?'🏷️ Cargo removido!':'🏷️ Cargo adicionado!','success');
    }else{if(toggle)toggle.classList.remove('loading');showToast('❌ '+(data.error||'Erro ao alterar cargo.'),'error');}
  }catch(e){if(toggle)toggle.classList.remove('loading');showToast('❌ Erro de conexão.','error');}
}

function scrollAdminToBottom(){const c=document.getElementById('admin-messages');if(c)c.scrollTop=c.scrollHeight;}
function escapeHtml(t){if(!t)return'';const d=document.createElement('div');d.appendChild(document.createTextNode(t));return d.innerHTML;}
function formatTime(d){return new Date(d).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
function timeAgo(d){const diff=Date.now()-new Date(d).getTime(),mins=Math.floor(diff/60000);if(mins<1)return'agora';if(mins<60)return mins+'m';const hrs=Math.floor(mins/60);if(hrs<24)return hrs+'h';return Math.floor(hrs/24)+'d';}
function showToast(message,type){
  type=type||'default'; const c=document.getElementById('toast-container');
  const t=document.createElement('div'); t.className='toast '+type;
  const icons={success:'✅',error:'❌',warning:'⚠️'};
  t.innerHTML='<span>'+(icons[type]||'💬')+'</span> '+message;
  c.appendChild(t); setTimeout(function(){t.classList.add('removing');setTimeout(function(){t.remove();},300);},4000);
}
