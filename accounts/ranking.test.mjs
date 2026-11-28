import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker, { extractStats } from './worker.mjs';

/** Adaptador fiel de Cloudflare D1 sobre node:sqlite em memória. */
function makeD1() {
  const sql = new DatabaseSync(':memory:');
  const wrapStmt = (query, params = []) => ({
    bind(...args) {
      return wrapStmt(query, args);
    },
    async first() {
      const stmt = sql.prepare(query);
      return stmt.get(...params) ?? null;
    },
    async all() {
      const stmt = sql.prepare(query);
      return { results: stmt.all(...params) };
    },
    async run() {
      const stmt = sql.prepare(query);
      const r = stmt.run(...params);
      return { success: true, meta: r };
    },
  });
  return {
    sql,
    prepare(query) {
      return wrapStmt(query);
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) {
        if (/^\s*(SELECT|.*RETURNING)/i.test(s._q ?? '')) out.push(await s.all());
        else {
          try {
            out.push(await s.all());
          } catch {
            out.push(await s.run());
          }
        }
      }
      return out;
    },
  };
}

function makeEnv(db) {
  return {
    DB: db,
    AUTH_LIMIT: { async limit() { return { success: true }; } },
  };
}

const ORIGIN = 'https://jogarteco.art';
const proofOf = (ch) => ch.repeat(64);

test('extractStats extrai grana, total de bolinhas e únicas com sanitização segura', () => {
  const s = extractStats({
    'teco-colecao-v1': JSON.stringify({
      v: 1,
      grana: 1250.9,
      itens: { comum: 12, dourada: 3, pingo: 1, quebrada: -4, invalida: 'abc' },
    }),
  });
  assert.deepEqual(s, { cash: 1250, marbles: 16, unique: 3 });
  assert.deepEqual(extractStats({}), { cash: 0, marbles: 0, unique: 0 });
  assert.deepEqual(extractStats({ 'teco-colecao-v1': '{invalido' }), { cash: 0, marbles: 0, unique: 0 });
});

test('Worker de contas: signup, save, backfill de antigos e GET /conta/ranking por dinheiro, bolinhas e únicas', async () => {
  const db = makeD1();
  // Cria schema inicial SEM a tabela leaderboard para testar auto-criação + backfill!
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').split('CREATE TABLE IF NOT EXISTS leaderboard')[0];
  db.sql.exec(schema);

  // Insere um jogador legado antes da tabela leaderboard existir
  db.sql.prepare('INSERT INTO players(id,name,salt,verifier,revision,progress) VALUES(?,?,?,?,?,?)').run(
    'legacy1',
    'veterano',
    '00'.repeat(16),
    '11'.repeat(32),
    2,
    JSON.stringify({
      'teco-colecao-v1': JSON.stringify({ v: 1, grana: 800, itens: { azulzinha: 40, leiteira: 10 } }),
    }),
  );

  const env = makeEnv(db);

  // 1. Signup jogador A (rico em dinheiro, poucas bolinhas)
  const signupA = await worker.fetch(
    new Request(`${ORIGIN}/conta/signup`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'rico_da_rua', proof: proofOf('a') }),
    }),
    env,
  );
  assert.equal(signupA.status, 200);
  const cookieA = signupA.headers.get('Set-Cookie').split(';')[0];
  const profA = await signupA.json();

  // Save progresso de A
  const saveA = await worker.fetch(
    new Request(`${ORIGIN}/conta/save`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        id: profA.id,
        revision: profA.revision,
        progress: {
          'teco-colecao-v1': JSON.stringify({ v: 1, grana: 5000, itens: { azulzinha: 5, dourada: 2 } }),
        },
      }),
    }),
    env,
  );
  assert.equal(saveA.status, 200);

  // 2. Signup jogador B (menos dinheiro, coleção com mais bolinhas únicas)
  const signupB = await worker.fetch(
    new Request(`${ORIGIN}/conta/signup`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'colecionador', proof: proofOf('b') }),
    }),
    env,
  );
  assert.equal(signupB.status, 200);
  const cookieB = signupB.headers.get('Set-Cookie').split(';')[0];
  const profB = await signupB.json();

  await worker.fetch(
    new Request(`${ORIGIN}/conta/save`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        id: profB.id,
        revision: profB.revision,
        progress: {
          'teco-colecao-v1': JSON.stringify({
            v: 1,
            grana: 1200,
            itens: { a: 3, b: 3, c: 3, d: 3, e: 3, f: 3 },
          }),
        },
      }),
    }),
    env,
  );

  // 3. Ranking por DINHEIRO (padrão): rico_da_rua ($5000) > colecionador ($1200) > veterano ($800 - backfilled!)
  const rCash = await (await worker.fetch(new Request(`${ORIGIN}/conta/ranking?by=cash`, { headers: { Cookie: cookieB } }), env)).json();
  assert.equal(rCash.by, 'cash');
  assert.equal(rCash.totalPlayers, 3);
  assert.deepEqual(rCash.items.map((x) => x.name), ['rico_da_rua', 'colecionador', 'veterano']);
  assert.equal(rCash.me.name, 'colecionador');
  assert.equal(rCash.me.rank, 2);

  // 4. Ranking por TOTAL DE BOLINHAS: veterano (50) > colecionador (18) > rico_da_rua (7)
  const rMarbles = await (await worker.fetch(new Request(`${ORIGIN}/conta/ranking?by=marbles`), env)).json();
  assert.equal(rMarbles.by, 'marbles');
  assert.deepEqual(rMarbles.items.map((x) => x.name), ['veterano', 'colecionador', 'rico_da_rua']);
  assert.equal(rMarbles.me, null);

  // 5. Ranking por ÚNICAS: colecionador (6) > veterano (2, 50 bolinhas) > rico_da_rua (2, 7 bolinhas)
  const rUnique = await (await worker.fetch(new Request(`${ORIGIN}/conta/ranking?by=unique`, { headers: { Cookie: cookieA } }), env)).json();
  assert.equal(rUnique.by, 'unique');
  assert.deepEqual(rUnique.items.map((x) => x.name), ['colecionador', 'veterano', 'rico_da_rua']);
  assert.equal(rUnique.me.rank, 3);
});
