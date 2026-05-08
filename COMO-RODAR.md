# 🚀 Como Rodar o Sistema de Tickets

## 1. Instalar o Node.js

Acesse: https://nodejs.org/
Baixe a versão **LTS** (recomendada) e instale normalmente.

Após instalar, abra o terminal e verifique:
```
node --version
npm --version
```

---

## 2. Instalar as dependências

Abra o terminal **dentro da pasta `ticket-system`** e rode:
```
npm install
```

---

## 3. Iniciar o servidor

```
npm start
```

Você verá no terminal:
```
🚀 Servidor rodando em http://localhost:3000
📋 Painel Admin: http://localhost:3000/admin.html
👤 Login: admin / admin123
```

---

## 4. Acessar o sistema

| Página | URL |
|--------|-----|
| 🌐 Site do cliente | http://localhost:3000 |
| 🔐 Painel Admin | http://localhost:3000/admin.html |

**Login do Admin:**
- Usuário: `admin`
- Senha: `admin123`

> ⚠️ Altere a senha no arquivo `server.js` na linha `const ADMIN_PASSWORD = 'admin123';`

---

## 5. Como usar

### Cliente:
1. Acessa o site
2. Clica em "Abrir Ticket de Suporte"
3. Preenche nome, e-mail, assunto e mensagem
4. Recebe um **ID único** do ticket
5. Conversa em tempo real no chat

### Admin:
1. Acessa `/admin.html`
2. Faz login com usuário e senha
3. Vê todos os tickets na barra lateral
4. Clica em um ticket para abrir o chat
5. Responde, fecha ou deleta tickets

---

## Estrutura de arquivos

```
ticket-system/
├── server.js          ← Servidor principal
├── database.js        ← Configuração do banco de dados
├── package.json       ← Dependências
├── tickets.db         ← Banco de dados (criado automaticamente)
└── public/
    ├── index.html     ← Página do cliente
    ← admin.html      ← Painel do administrador
    ├── css/
    │   └── style.css  ← Estilos globais
    └── js/
        ├── client.js  ← Lógica do cliente
        └── admin.js   ← Lógica do admin
```
