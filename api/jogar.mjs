// O CDN compartilha o renderer entre jogadores. Só a última release estável do TECO é consultada.
const releases = 'https://github.com/JVHBO/teco-releases/releases/';
const release = releases+'latest/download/TECO-jogar.html';
// Esta é a primeira versão que mantém o save da conta separado do visitante.
const firstProfileRelease = releases+'download/v0.6.6/TECO-jogar.html';
const limit = 3_900_000;
async function renderer(url,signal) {
  const asset = await fetch(url,{signal});
  const length = Number(asset.headers.get('content-length'));
  if (!asset.ok || !length || length > limit) throw Error('Release indisponível');
  const body = Buffer.from(await asset.arrayBuffer());
  if (body.length !== length || !body.subarray(0,60).toString('utf8').toLowerCase().includes('<!doctype html>')) throw Error('Renderer inválido');
  return body;
}
export default async function jogar(req,res) {
  if (!['GET','HEAD'].includes(req.method)) return res.setHeader('Allow','GET, HEAD').status(405).end();
  try {
    const signal = AbortSignal.timeout(12000);
    let body = await renderer(release,signal);
    const offset = body.indexOf('<meta name="application-version"');
    const tag = offset < 0 ? null : body.toString('ascii',offset,offset+100).match(/content="v(\d+)\.(\d+)\.(\d+)">/);
    if (!tag) throw Error('Versão do jogo ausente');
    const [major,minor,patch] = tag.slice(1).map(Number);
    if (major === 0 && (minor < 6 || (minor === 6 && patch < 6))) body = await renderer(firstProfileRelease,signal);
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
