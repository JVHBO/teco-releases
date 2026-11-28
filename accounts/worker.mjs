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
let leaderboardReady = false;
function json(body, status = 200, extra = {}) {
  return Response.json(body, {status, headers: {'Cache-Control':'private, no-store', 'Vary':'Cookie', ...extra}});
}
function extractStats(progress) {
  const raw = typeof progress === 'string'
    ? (() => { try { return JSON.parse(progress); } catch { return null; } })()
    : progress;
  const colRaw = raw && typeof raw === 'object' ? raw['teco-colecao-v1'] : null;
  if (typeof colRaw !== 'string') return { cash: 0, marbles: 0, unique: 0 };
  let col;
  try { col = JSON.parse(colRaw); } catch { return { cash: 0, marbles: 0, unique: 0 }; }
  if (!col || typeof col !== 'object') return { cash: 0, marbles: 0, unique: 0 };
  const grana = Number(col.grana);
  const cash = Number.isFinite(grana) && grana > 0 ? Math.min(999_999_999, Math.floor(grana)) : 0;
  let marbles = 0;
  let unique = 0;
  if (col.itens && typeof col.itens === 'object' && !Array.isArray(col.itens)) {
    for (const [k, v] of Object.entries(col.itens)) {
      if (typeof k !== 'string' || !k || k.length > 64) continue;
      const q = Number(v);
      if (Number.isInteger(q) && q > 0) {
        marbles += Math.min(99_999, q);
        unique++;
      }
    }
  }
  return { cash, marbles: Math.min(9_999_999, marbles), unique: Math.min(10_000, unique) };
}
async function ensureLeaderboard(db) {
  if (leaderboardReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS leaderboard (
      player TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cash INTEGER NOT NULL DEFAULT 0,
      marbles INTEGER NOT NULL DEFAULT 0,
      unique_marbles INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS leaderboard_cash ON leaderboard(cash DESC, marbles DESC, name ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS leaderboard_marbles ON leaderboard(marbles DESC, cash DESC, name ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS leaderboard_unique ON leaderboard(unique_marbles DESC, marbles DESC, cash DESC, name ASC)'),
  ]);
  leaderboardReady = true;
}
async function upsertLeaderboard(db, id, name, progress, now) {
  await ensureLeaderboard(db);
  const s = extractStats(progress);
  await db.prepare(
    'INSERT INTO leaderboard(player,name,cash,marbles,unique_marbles,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(player) DO UPDATE SET name=excluded.name,cash=excluded.cash,marbles=excluded.marbles,unique_marbles=excluded.unique_marbles,updated=excluded.updated'
  ).bind(id, name, s.cash, s.marbles, s.unique, now).run();
}
async function backfillLeaderboard(db, now) {
  await ensureLeaderboard(db);
  const missing = await db.prepare(
    'SELECT p.id, p.name, p.progress FROM players p LEFT JOIN leaderboard l ON l.player=p.id WHERE l.player IS NULL LIMIT 200'
  ).all();
  const rows = missing?.results ?? [];
  if (!rows.length) return;
  const stmts = rows.map(r => {
    const s = extractStats(r.progress);
    return db.prepare(
      'INSERT OR REPLACE INTO leaderboard(player,name,cash,marbles,unique_marbles,updated) VALUES(?,?,?,?,?,?)'
    ).bind(r.id, r.name, s.cash, s.marbles, s.unique, now);
  });
  await db.batch(stmts);
}
function rankingOrder(param) {
  const p = (param || '').toLowerCase();
  if (p === 'marbles' || p === 'bolinhas') {
    return {
      by: 'marbles',
      orderSql: 'marbles DESC, cash DESC, unique_marbles DESC, name ASC',
      aheadSql: '(marbles > ?) OR (marbles = ? AND cash > ?) OR (marbles = ? AND cash = ? AND unique_marbles > ?) OR (marbles = ? AND cash = ? AND unique_marbles = ? AND name < ?)',
      aheadBind: m => [m.marbles, m.marbles, m.cash, m.marbles, m.cash, m.unique_marbles, m.marbles, m.cash, m.unique_marbles, m.name],
    };
  }
  if (p === 'unique' || p === 'unicas') {
    return {
      by: 'unique',
      orderSql: 'unique_marbles DESC, marbles DESC, cash DESC, name ASC',
      aheadSql: '(unique_marbles > ?) OR (unique_marbles = ? AND marbles > ?) OR (unique_marbles = ? AND marbles = ? AND cash > ?) OR (unique_marbles = ? AND marbles = ? AND cash = ? AND name < ?)',
      aheadBind: m => [m.unique_marbles, m.unique_marbles, m.marbles, m.unique_marbles, m.marbles, m.cash, m.unique_marbles, m.marbles, m.cash, m.name],
    };
  }
  return {
    by: 'cash',
    orderSql: 'cash DESC, marbles DESC, unique_marbles DESC, name ASC',
    aheadSql: '(cash > ?) OR (cash = ? AND marbles > ?) OR (cash = ? AND marbles = ? AND unique_marbles > ?) OR (cash = ? AND marbles = ? AND unique_marbles = ? AND name < ?)',
    aheadBind: m => [m.cash, m.cash, m.marbles, m.cash, m.marbles, m.unique_marbles, m.cash, m.marbles, m.unique_marbles, m.name],
  };
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
  const url = new URL(req.url);
  const action = url.pathname.split('/').pop();
  const db = env.DB, now = Math.floor(Date.now()/1000);
  if (req.method !== 'GET' && !origins.has(req.headers.get('Origin'))) return json({},403);
  if (req.method === 'GET' && action === 'ranking') {
    await backfillLeaderboard(db, now);
    const ord = rankingOrder(url.searchParams.get('by') || url.searchParams.get('por'));
    const rawLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 50;
    const [topRes, countRes] = await db.batch([
      db.prepare(`SELECT player, name, cash, marbles, unique_marbles FROM leaderboard ORDER BY ${ord.orderSql} LIMIT ?`).bind(limit),
      db.prepare('SELECT COUNT(*) AS total FROM leaderboard'),
    ]);
    const items = (topRes?.results ?? []).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      cash: r.cash,
      marbles: r.marbles,
      unique: r.unique_marbles,
    }));
    const totalPlayers = Number(countRes?.results?.[0]?.total ?? items.length);
    let me = null;
    const token = req.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-teco-session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) {
      const hash = await digest(token);
      const sess = await db.prepare('SELECT p.id, p.name, p.progress FROM sessions s JOIN players p ON s.player=p.id WHERE s.hash=? AND s.expires>?').bind(hash, now).first();
      if (sess) {
        let mine = await db.prepare('SELECT player, name, cash, marbles, unique_marbles FROM leaderboard WHERE player=?').bind(sess.id).first();
        if (!mine) {
          await upsertLeaderboard(db, sess.id, sess.name, sess.progress, now);
          mine = await db.prepare('SELECT player, name, cash, marbles, unique_marbles FROM leaderboard WHERE player=?').bind(sess.id).first();
        }
        if (mine) {
          const ahead = await db.prepare(`SELECT COUNT(*) AS n FROM leaderboard WHERE ${ord.aheadSql}`).bind(...ord.aheadBind(mine)).first();
          me = {
            rank: Number(ahead?.n ?? 0) + 1,
            name: mine.name,
            cash: mine.cash,
            marbles: mine.marbles,
            unique: mine.unique_marbles,
          };
        }
      }
    }
    return json(
      { by: ord.by, totalPlayers, items, me },
      200,
      token ? {} : { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' },
    );
  }
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
      await upsertLeaderboard(db, row.id, row.name, row.progress, now);
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
    if (!next) return json({error:'conflict'},409);
    await upsertLeaderboard(db, row.id, row.name, progress, now);
    return json(next);
  }
  return json({},404);
}
export { extractStats, rankingOrder };
export default {async fetch(req,env) {
  try {return await handle(req,env);} catch (e) {
    if (e instanceof SyntaxError || ['formato','vazio'].includes(e.message)) return json({},400);
    if (e.message === 'tamanho') return json({},413);
    return json({},503);
  }
}};
