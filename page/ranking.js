import { gameAccountName, localPlayerStats, openAccountModal, ready } from './account.js';

const bodyEl = document.querySelector('#ranking-body');
const meEl = document.querySelector('#ranking-me');
const podiumEl = document.querySelector('#ranking-podium');
const footEl = document.querySelector('#ranking-foot');
const refreshBtn = document.querySelector('#ranking-refresh');
const tabs = Array.from(document.querySelectorAll('[data-rank-by]'));
const headCols = Array.from(document.querySelectorAll('.ranking-table th[data-col]'));

const fmt = new Intl.NumberFormat('pt-BR');
const money = (n) => '$' + fmt.format(Math.max(0, Math.floor(Number(n) || 0)));
const num = (n) => fmt.format(Math.max(0, Math.floor(Number(n) || 0)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

let currentBy = 'cash';
let loading = false;

function metricLabel(by, item) {
  if (by === 'marbles') return `${num(item.marbles)} bolinhas`;
  if (by === 'unique') return `${num(item.unique)} únicas`;
  return money(item.cash);
}

function updateActiveCol() {
  tabs.forEach((b) => {
    const on = b.dataset.rankBy === currentBy;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  headCols.forEach((th) => th.classList.toggle('col-active', th.dataset.col === currentBy));
}

function renderMe(me, totalPlayers) {
  const name = gameAccountName();
  if (!name) {
    const local = localPlayerStats();
    const extra = local.cash || local.marbles
      ? ` Você já tem <strong>${money(local.cash)}</strong> e <strong>${num(local.marbles)}</strong> bolinhas salvas neste navegador.`
      : '';
    meEl.innerHTML = `<div class="rme-guest">
      <div><strong>Entre no Ranking Global!</strong><span>Defina um username para aparecer na tabela e sincronizar seu progresso.${extra}</span></div>
      <button type="button" id="ranking-set-user" class="ranking-cta">Definir username</button>
    </div>`;
    meEl.querySelector('#ranking-set-user')?.addEventListener('click', () => openAccountModal());
    return;
  }
  const posTxt = me ? `#${num(me.rank)} de ${num(totalPlayers)}` : 'Sincronizando…';
  const cash = me ? me.cash : localPlayerStats().cash;
  const marbles = me ? me.marbles : localPlayerStats().marbles;
  const unique = me ? me.unique : localPlayerStats().unique;
  meEl.innerHTML = `<div class="rme-logged">
    <div class="rme-id"><span class="rme-pos">${esc(posTxt)}</span><strong>@${esc(name)}</strong></div>
    <div class="rme-stats">
      <span class="${currentBy === 'cash' ? 'hi' : ''}">Dinheiro: <b>${money(cash)}</b></span>
      <span class="${currentBy === 'marbles' ? 'hi' : ''}">Bolinhas: <b>${num(marbles)}</b></span>
      <span class="${currentBy === 'unique' ? 'hi' : ''}">Únicas: <b>${num(unique)}</b></span>
    </div>
  </div>`;
}

function renderPodium(items) {
  const top3 = items.slice(0, 3);
  if (!top3.length) {
    podiumEl.hidden = true;
    podiumEl.innerHTML = '';
    return;
  }
  const medals = ['1º', '2º', '3º'];
  const cls = ['gold', 'silver', 'bronze'];
  podiumEl.hidden = false;
  podiumEl.innerHTML = top3.map((it, idx) => `
    <div class="podium-card ${cls[idx]}">
      <span class="podium-rank">${medals[idx]}</span>
      <strong class="podium-name">@${esc(it.name)}</strong>
      <b class="podium-val">${esc(metricLabel(currentBy, it))}</b>
      <small>${money(it.cash)} · ${num(it.marbles)} bolinhas · ${num(it.unique)} únicas</small>
    </div>
  `).join('');
}

function renderTable(data) {
  const myName = gameAccountName().toLowerCase();
  const items = Array.isArray(data.items) ? data.items : [];
  renderMe(data.me ?? null, data.totalPlayers ?? items.length);
  renderPodium(items);
  if (!items.length) {
    bodyEl.innerHTML = '<tr><td colspan="5" class="ranking-empty">Nenhum jogador no ranking ainda — defina seu username e seja o 1º!</td></tr>';
  } else {
    bodyEl.innerHTML = items.map((it) => {
      const isMe = myName && it.name.toLowerCase() === myName;
      const badge = it.rank === 1 ? '🥇' : it.rank === 2 ? '🥈' : it.rank === 3 ? '🥉' : `#${it.rank}`;
      return `<tr class="${isMe ? 'is-me' : ''}">
        <td class="col-pos">${badge}</td>
        <td class="col-user"><strong>@${esc(it.name)}</strong>${isMe ? '<span class="me-tag">você</span>' : ''}</td>
        <td class="col-num${currentBy === 'cash' ? ' col-active' : ''}">${money(it.cash)}</td>
        <td class="col-num${currentBy === 'marbles' ? ' col-active' : ''}">${num(it.marbles)}</td>
        <td class="col-num${currentBy === 'unique' ? ' col-active' : ''}">${num(it.unique)}</td>
      </tr>`;
    }).join('');
  }
  const ordNome = currentBy === 'marbles' ? 'total de bolinhas' : currentBy === 'unique' ? 'coleção única' : 'dinheiro no cofre ($)';
  footEl.textContent = `${num(data.totalPlayers ?? items.length)} jogador${(data.totalPlayers ?? items.length) === 1 ? '' : 'es'} no ranking · ordenado por ${ordNome}.`;
}

export async function loadRanking(by = currentBy) {
  if (!bodyEl) return;
  currentBy = by;
  updateActiveCol();
  if (loading) return;
  loading = true;
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const res = await fetch('/conta/ranking?by=' + encodeURIComponent(currentBy) + '&limit=50', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderTable(data);
  } catch {
    renderMe(null, 0);
    podiumEl.hidden = true;
    bodyEl.innerHTML = '<tr><td colspan="5" class="ranking-empty">Ranking temporariamente indisponível. Tente atualizar em instantes.</td></tr>';
    footEl.textContent = 'O ranking atualiza automaticamente quando sua conta sincroniza.';
  } finally {
    loading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.rankBy || 'cash';
    if (next === currentBy) return;
    void loadRanking(next);
  });
});
refreshBtn?.addEventListener('click', () => { void loadRanking(currentBy); });
window.addEventListener('teco:account-changed', () => { void loadRanking(currentBy); });

ready.finally(() => { void loadRanking(currentBy); });
