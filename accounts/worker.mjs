const origins = new Set(['https://jogarteco.art', 'https://teco-gude-arcade.vercel.app']);
const keys = new Set(['teco-idioma', 'teco-regiao', 'teco-gude-save-v1', 'teco-colecao-v1']);
const cookieName = '__Host-teco-session';
const month = 30 * 86400;
const maxBytes = 160 * 1024;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const cookie = (token, age) => cookieName + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + age;
function json(body, status = 200, extra = {}) {
  return Response.json(body, {status, headers: {'Cache-Control':'private, no-store', 'Vary':'Cookie', ...extra}});
}
async function verifier(proof, salt) {
  const secret = await crypto.subtle.importKey('raw', encoder.encode(proof), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:100000}, secret, 256));
}
async function body(req) {
  if (!req.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('formato');
  if (Number(req.headers.get('Content-Length')) > maxBytes) throw new Error('tamanho');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('vazio');
  const decoder = new TextDecoder();
  let size = 0, text = '';
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error('tamanho'); }
    text += decoder.decode(value,{stream:true});
  }
  const data = JSON.parse(text + decoder.decode());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('formato');
  return data;
}
function validProgress(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false;
  return Object.entries(progress).every(([k,v]) => {
    if (!keys.has(k) || typeof v !== 'string') return false;
    if (k === 'teco-idioma') return ['pt','en'].includes(v);
    if (k === 'teco-regiao') return /^[a-z]{2,12}$/.test(v);
    try { return JSON.parse(v)?.v === 1; } catch { return false; }
  });
}
function profile(row) {
  return {id:row.id,name:row.name,revision:row.revision,progress:JSON.parse(row.progress)};
}
async function session(db,row,now) {
  const token = random(32);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE expires<=? LIMIT 16)').bind(now),
    db.prepare('INSERT INTO sessions(hash,player,expires) VALUES(?,?,?)').bind(await digest(token),row.id,now+month)
  ]);
  return json(profile(row),200,{'Set-Cookie':cookie(token,month)});
}
async function handle(req, env) {
  const action = new URL(req.url).pathname.split('/').pop();
  const db = env.DB, now = Math.floor(Date.now()/1000);
  if (req.method !== 'GET' && !origins.has(req.headers.get('Origin'))) return json({},403);
  if (req.method === 'POST' && ['signup','login','redeem'].includes(action)) {
    if (!(await env.AUTH_LIMIT.limit({key:req.headers.get('CF-Connecting-IP') || 'unknown'})).success) return json({},429);
    const {name,proof,code} = await body(req);
    if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return json({},400);
    if (action === 'redeem') {
      if (typeof code !== 'string' || !/^[0-9a-f]{16}$/.test(code)) return json({},400);
      const ticket = await digest(code);
      const device = await digest(proof);
      // Both operations see the same ticket. A simultaneous redemption can only win once.
      const [,used] = await db.batch([
        db.prepare('INSERT INTO devices(hash,player) SELECT ?,player FROM pairing WHERE hash=? AND expires>?').bind(device,ticket,now),
        db.prepare('DELETE FROM pairing WHERE hash=? AND expires>? RETURNING player').bind(ticket,now)
      ]);
      if (!used.results.length) return json({},401);
      return session(db,await db.prepare('SELECT * FROM players WHERE id=?').bind(used.results[0].player).first(),now);
    }
    if (typeof name !== 'string' || !/^[a-z0-9_]{3,24}$/.test(name)) return json({},400);
    let row;
    if (action === 'signup') {
      const salt = random(16);
      row = await db.prepare('INSERT INTO players(id,name,salt,verifier) VALUES(?,?,?,?) ON CONFLICT(name) DO NOTHING RETURNING *').bind(random(16),name,salt,await verifier(proof,salt)).first();
      if (!row) return json({},409);
    } else {
      row = await db.prepare('SELECT * FROM players WHERE name=?').bind(name).first();
      const hash = await verifier(proof,row?.salt ?? '00000000000000000000000000000000');
      if (!row) return json({},401);
      if (!crypto.subtle.timingSafeEqual(encoder.encode(hash),encoder.encode(row.verifier)) &&
          !await db.prepare('SELECT 1 FROM devices WHERE hash=? AND player=?').bind(await digest(proof),row.id).first()) return json({},401);
    }
    return session(db,row,now);
  }
  const token = req.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-teco-session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return json({},401);
  const hash = await digest(token);
  if (req.method === 'POST' && action === 'logout') {
    await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
    return json({},200,{'Set-Cookie':cookie('',0)});
  }
  const row = await db.prepare('SELECT p.id,p.name,p.progress,p.revision FROM sessions s JOIN players p ON s.player=p.id WHERE s.hash=? AND s.expires>?').bind(hash,now).first();
  if (!row) return json({},401);
  if (req.method === 'POST' && action === 'pair') {
    const code = random(8);
    await db.prepare('INSERT INTO pairing(player,hash,expires) VALUES(?,?,?) ON CONFLICT(player) DO UPDATE SET hash=excluded.hash,expires=excluded.expires').bind(row.id,await digest(code),now+600).run();
    return json({code});
  }
  if (req.method === 'GET' && action === 'me') return json(profile(row));
  if (req.method === 'PUT' && action === 'save') {
    const {id,revision,progress}=await body(req);
    if (id !== row.id) return json({},403);
    if (!Number.isSafeInteger(revision) || revision<0 || !validProgress(progress)) return json({},400);
    const next = await db.prepare('UPDATE players SET progress=?, revision=revision+1 WHERE id=? AND revision=? RETURNING revision').bind(JSON.stringify(progress),row.id,revision).first();
    return next ? json(next) : json({error:'conflict'},409);
  }
  return json({},404);
}
export default {async fetch(req,env) {
  try {return await handle(req,env);} catch (e) {
    if (e instanceof SyntaxError || ['formato','vazio'].includes(e.message)) return json({},400);
    if (e.message === 'tamanho') return json({},413);
    return json({},503);
  }
}};
