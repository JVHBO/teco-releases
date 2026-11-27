// O CDN compartilha o renderer entre jogadores. Só a última release estável do TECO é consultada.
const release = 'https://github.com/JVHBO/teco-releases/releases/latest/download/TECO-jogar.html';
const limit = 3_900_000;
export default async function jogar(req,res) {
  if (!['GET','HEAD'].includes(req.method)) return res.setHeader('Allow','GET, HEAD').status(405).end();
  try {
    const asset = await fetch(release,{signal:AbortSignal.timeout(12000)});
    const length = Number(asset.headers.get('content-length'));
    if (!asset.ok || !length || length > limit) throw Error('Release indisponível');
    const body = Buffer.from(await asset.arrayBuffer());
    if (body.length !== length || !body.subarray(0,60).toString('utf8').toLowerCase().includes('<!doctype html>')) throw Error('Renderer inválido');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
    res.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=60, stale-while-revalidate=120, stale-if-error=86400');
    return res.status(200).end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(503).end('O jogo está temporariamente indisponível.');
  }
}