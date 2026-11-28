import { gameAccountName, openAccountModal, ready } from './account.js';

const sideTabs = Array.from(document.querySelectorAll('[data-side-tab]'));
const panelChat = document.querySelector('#panel-chat');
const panelArenas = document.querySelector('#panel-arenas');
const listEl = document.querySelector('#chat-list');
const formEl = document.querySelector('#chat-form');
const inputEl = document.querySelector('#chat-input');
const sendBtn = document.querySelector('#chat-send');
const guestEl = document.querySelector('#chat-guest');
const setUserBtn = document.querySelector('#chat-set-user');
const statusEl = document.querySelector('#chat-status');
const feedbackEl = document.querySelector('#chat-feedback');
const countEl = document.querySelector('#chat-count');

const MAX_LEN = 220;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const palette = ['#1d6f5f', '#b45309', '#1d4ed8', '#9d174d', '#6d28d9', '#0f766e', '#b91c1c', '#3f6212'];

function colorOf(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function fmtTime(sec) {
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Destaca códigos de sala de 6 dígitos como botões clicáveis para copiar. */
function formatText(raw) {
  return esc(raw).replace(/\b(\d{6})\b/g, '<button type="button" class="chat-code" data-copy-code="$1" title="Copiar código da sala">$1</button>');
}

// Alternância entre Chat da Roda e As 7 arenas no painel lateral
sideTabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.sideTab;
    sideTabs.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (panelChat) panelChat.hidden = tab !== 'chat';
    if (panelArenas) panelArenas.hidden = tab !== 'arenas';
  });
});

let lastId = 0;
let polling = false;
let pollTimer = 0;
const seen = new Set();

function nearBottom() {
  if (!listEl) return true;
  return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 64;
}

function setFeedback(msg, isError = false) {
  if (!feedbackEl) return;
  feedbackEl.textContent = msg;
  feedbackEl.classList.toggle('is-error', isError);
}

function syncAuthUi() {
  if (!formEl || !guestEl) return;
  const name = gameAccountName();
  const logged = !!name;
  formEl.hidden = !logged;
  guestEl.hidden = logged;
  if (countEl) countEl.hidden = !logged;
  if (logged && inputEl) inputEl.placeholder = `Conversar como @${name}…`;
}

function appendMessages(msgs, replace = false) {
  if (!listEl) return;
  const stick = replace || nearBottom();
  if (replace) {
    seen.clear();
    lastId = 0;
    listEl.innerHTML = '';
  }
  const myName = gameAccountName().toLowerCase();
  const frag = document.createDocumentFragment();
  let added = 0;
  for (const m of msgs) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.id > lastId) lastId = m.id;
    const isMe = myName && String(m.name).toLowerCase() === myName;
    const item = document.createElement('li');
    item.className = 'chat-msg' + (isMe ? ' is-me' : '');
    item.innerHTML = `<div class="chat-msg-top"><strong style="color:${colorOf(String(m.name))}">@${esc(m.name)}</strong><time>${fmtTime(m.created)}</time></div><p>${formatText(m.text ?? m.body ?? '')}</p>`;
    frag.appendChild(item);
    added++;
  }
  if (added > 0) {
    const empty = listEl.querySelector('.chat-empty');
    if (empty) empty.remove();
    listEl.appendChild(frag);
    while (listEl.children.length > 120) listEl.firstElementChild?.remove();
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  } else if (replace && !listEl.children.length) {
    listEl.innerHTML = '<li class="chat-empty">Nenhuma mensagem ainda. Mande um oi ou compartilhe o código da sua sala!</li>';
  }
}

async function fetchChat(initial = false) {
  if (!listEl || polling) return;
  polling = true;
  try {
    const qs = !initial && lastId > 0 ? `?since=${lastId}&limit=50` : '?limit=60';
    const res = await fetch('/conta/chat' + qs, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data.items) ? data.items : Array.isArray(data.messages) ? data.messages : [];
    appendMessages(list, initial);
    if (statusEl) {
      statusEl.textContent = 'Ao vivo';
      statusEl.classList.add('online');
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Reconectando…';
      statusEl.classList.remove('online');
    }
    if (initial && !listEl.children.length) {
      listEl.innerHTML = '<li class="chat-empty">Chat temporariamente indisponível.</li>';
    }
  } finally {
    polling = false;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = window.setTimeout(async () => {
    await fetchChat(false);
    schedulePoll();
  }, 3500);
}

listEl?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy-code]');
  if (!btn) return;
  const code = btn.dataset.copyCode;
  try {
    await navigator.clipboard.writeText(code);
    setFeedback(`Código ${code} copiado!`);
    setTimeout(() => setFeedback(''), 2500);
  } catch {
    setFeedback(`Código da sala: ${code}`);
  }
});

setUserBtn?.addEventListener('click', () => openAccountModal());

inputEl?.addEventListener('input', () => {
  if (countEl) countEl.textContent = `${inputEl.value.length}/${MAX_LEN}`;
});

formEl?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!inputEl || !sendBtn || sendBtn.disabled) return;
  const text = inputEl.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  setFeedback('');
  try {
    const res = await fetch('/conta/chat', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401) {
      setFeedback('Entre com seu username para mandar mensagem.', true);
      openAccountModal();
      return;
    }
    if (res.status === 429) {
      setFeedback('Calma! Aguarde 2 segundos entre mensagens.', true);
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const item = data.item ?? data.message;
    if (item) appendMessages([item], false);
    inputEl.value = '';
    if (countEl) countEl.textContent = `0/${MAX_LEN}`;
    inputEl.focus();
  } catch {
    setFeedback('Não foi possível enviar agora. Tente novamente.', true);
  } finally {
    sendBtn.disabled = false;
  }
});

window.addEventListener('teco:account-changed', () => {
  syncAuthUi();
  void fetchChat(true);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void fetchChat(false);
    schedulePoll();
  } else {
    clearTimeout(pollTimer);
  }
});

ready.finally(async () => {
  syncAuthUi();
  await fetchChat(true);
  schedulePoll();
});
