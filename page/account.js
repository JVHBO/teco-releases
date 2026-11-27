const button = document.querySelector('#account');
const panel = document.querySelector('#account-panel');
const form = document.querySelector('#credentials');
const message = document.querySelector('#account-msg');
const conflictPanel = document.querySelector('#resolve-save');
const hint = 'teco:login';
const keys = ['teco-gude-save-v1','teco-colecao-v1','teco-idioma','teco-regiao'];
let player, conflict, checkpoint, saving, timer, signup = false;
const prefix = id => id ? 'teco:conta:' + id + ':' : '';
const read = id => Object.fromEntries(keys.map(k => [k,localStorage.getItem(prefix(id)+k)]).filter(([,v]) => v !== null));
const same = (a,b) => keys.every(k => a?.[k] === b?.[k]);
function apply(id,values) {
  for (const k of keys) {
    if (values[k] == null) localStorage.removeItem(prefix(id)+k);
    else localStorage.setItem(prefix(id)+k,values[k]);
  }
}
function mark(revision,progress) {
  checkpoint = {revision,progress};
  localStorage.setItem(prefix(player.id)+'sync',JSON.stringify(checkpoint));
}
async function request(action, method='GET', data, keepalive=false) {
  const response = await fetch('/conta/'+action,{method,cache:'no-store',credentials:'same-origin',
    headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined,keepalive,
    signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(new Error('Conta indisponível'),{status:response.status});
  return response.json();
}
async function proof(name,password) {
  const enc = new TextEncoder();
  const source = await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode('TECO-login-v1/'+name),iterations:600000},source,256);
  return Array.from(new Uint8Array(bits),b => b.toString(16).padStart(2,'0')).join('');
}
function setConflict(remote) {
  conflict = remote;
  conflictPanel.hidden = !remote;
  if (remote) {
    button.textContent = 'Revisar progresso';
    message.textContent = 'As duas versões foram mantidas.';
  }
}
function attach(remote) {
  player = {id:remote.id,name:remote.name};
  localStorage.setItem(hint,remote.id);
  try { checkpoint = JSON.parse(localStorage.getItem(prefix(player.id)+'sync')); } catch { checkpoint=null; }
  const local = read(player.id);
  form.hidden=true;
  document.querySelector('#connected').hidden=false;
  button.textContent=remote.name;
  document.querySelector('#player-info').textContent='Jogando como '+remote.name;
  const unsynced = checkpoint ? !same(local,checkpoint.progress) : Object.keys(local).length > 0;
  if (unsynced && checkpoint?.revision !== remote.revision && !same(local,remote.progress)) {
    setConflict(remote); return;
  }
  if (!checkpoint || same(local,checkpoint.progress) || same(local,remote.progress)) {
    apply(player.id,remote.progress); mark(remote.revision,remote.progress);
  }
}
function failure(e) {
  message.textContent = e.status===413 ? 'O progresso excedeu o limite de sincronização. A cópia local está salva.' :
    e.status===429 ? 'Muitas tentativas. Aguarde um minuto.' :
    e.status===401 ? 'Confira o nome e a senha ou entre novamente.' :
    e.status===409 ? 'Esse nome de jogador já está em uso.' : 'Falha de conexão. Seu progresso local está salvo. Tente novamente.';
  if (player) button.textContent = 'Revisar conta';
}
async function sync() {
  if (saving) return saving;
  if (!player || conflict) return;
  const local=read(player.id);
  if (same(local,checkpoint.progress)) return;
  saving = (async () => {
    try {
      const next=await request('save','PUT',{id:player.id,revision:checkpoint.revision,progress:local});
      mark(next.revision,local); button.textContent=player.name; message.textContent='Progresso sincronizado.';
    } catch(e) {
      if(e.status===409) {
        const remote=await request('me');
        if(remote.id!==player.id) throw new Error('Outra sessão');
        if(same(remote.progress,local)) mark(remote.revision,local); else setConflict(remote);
      } else { failure(e); throw e; }
    }
  })();
  try {await saving;} finally {saving=null;}
  if (!conflict && !same(read(player.id),local)) return sync();
}
const hintId = (() => { try {return localStorage.getItem(hint);} catch {return null;} })();
let unavailable = false;
async function restore() {
  if (!hintId) return;
  try { attach(await request('me')); await sync(); }
  catch(e) {
    if (e.status === 401) localStorage.removeItem(hint);
    else {unavailable=true; failure(e);}
  }
}
export const ready = restore();
export async function gameAccount(starting) {
  await ready;
  if(unavailable) throw Error('A conta está offline. Recarregue para tentar novamente.');
  if (starting && player && !conflict) {
    await sync();
    if (!conflict) {
      const remote = await request('me');
      if (remote.id !== player.id) throw Error('A sessão mudou. Recarregue para abrir a conta atual.');
      attach(remote);
    }
  }
  if(conflict) { panel.showModal(); throw Error('Escolha qual progresso usar antes de jogar.'); }
  return player?.id ?? '';
}
function schedule() { clearTimeout(timer); timer=setTimeout(()=>sync().catch(()=>{}),350); }
window.addEventListener('storage',e=>{
  if(e.key===hint && e.newValue!==player?.id) {location.reload();return;}
  if(player && keys.some(k=>e.key===prefix(player.id)+k)) schedule();
});
window.addEventListener('online',()=>{if(unavailable) location.reload(); else schedule();});
document.addEventListener('visibilitychange',()=>{if(document.hidden) sync().catch(()=>{});});
button.onclick=async()=>{await ready;panel.showModal();};
function mode(create) {
  signup=create;
  document.querySelector('#submit-account').textContent=create?'Criar conta':'Entrar';
  document.querySelector('#toggle-signup').textContent=create?'Já tenho conta':'Criar conta';
  document.querySelector('#signup-hint').hidden=!create;
  document.querySelector('#import-guest').hidden=!create || !Object.keys(read('')).length;
  form.elements.password.minLength=create?10:1;
  form.elements.password.autocomplete=create?'new-password':'current-password';
  message.textContent='';
}
document.querySelector('#toggle-signup').onclick=()=>mode(!signup);
form.onsubmit=async e=>{
  e.preventDefault();
  const submit=document.querySelector('#submit-account'); if(submit.disabled)return;
  submit.disabled=true;
  const name=form.elements.player.value.trim().toLowerCase();
  const create=signup;
  const guest=create && form.elements.importGuest.checked ? read('') : {};
  try {
    const remote=await request(create?'signup':'login','POST',{name,proof:await proof(name,form.elements.password.value)});
    form.elements.password.value='';
    attach(remote);
    if(create && Object.keys(guest).length){apply(remote.id,guest);await sync();}
    if(!conflict) location.reload();
  } catch(e) {failure(e);} finally {submit.disabled=false;}
};
document.querySelector('#sync-now').onclick=async()=>{
  try {
    await sync();
    if(!conflict) {
      const remote=await request('me');
      if(remote.id!==player.id) {location.reload();return;}
      if(remote.revision!==checkpoint.revision) {location.reload();return;}
      message.textContent='Progresso sincronizado.';
    }
  } catch(e){failure(e);}
};
document.querySelector('#logout').onclick=async()=>{
  try {
    await sync(); if(conflict)return;
    await request('logout','POST'); localStorage.removeItem(hint); location.reload();
  } catch(e){failure(e);}
};
async function resolve(useLocal) {
  if(!conflict || !player)return;
  try {
    const local=read(player.id), remote=conflict;
    localStorage.setItem(prefix(player.id)+'recovery',JSON.stringify(useLocal?remote.progress:local));
    if(!useLocal) apply(player.id,remote.progress);
    mark(remote.revision,remote.progress);setConflict(null);
    if(useLocal) await sync();
    if(!conflict)location.reload();
  } catch(e){failure(e);}
}
document.querySelector('#use-local').onclick=()=>resolve(true);
document.querySelector('#use-cloud').onclick=()=>resolve(false);
