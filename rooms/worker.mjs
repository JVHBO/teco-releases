import { DurableObject } from 'cloudflare:workers';

const initial = {capacity:2, arena:'calcada', montagem:'roda', regra:'pontos', tempero:'nenhum'};
const options = {
  capacity:[2,3,4], arena:['calcada','terrao','quadra','praca','terreiro','paralelepipedo','quintal'],
  montagem:['roda','triangulo','meialua','cruz','fila','losango','cantos','parede'],
  regra:['pontos','caixinha','matamata','dengue','marcada','tirateima'],
  tempero:['nenhum','tabela','cantada','semdefesa']
};
const bounded = (n,limit=4096) => Number.isFinite(n) && Math.abs(n)<=limit;
const ballId = s => typeof s==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
const allowed = new Set(['https://jogarteco.art','https://teco-gude-arcade.vercel.app','file://','null']);
function reject(reason) {
  const [client,server] = Object.values(new WebSocketPair());
  server.accept(); server.close(4000,reason);
  return new Response(null,{status:101,webSocket:client});
}
export default {async fetch(req,env) {
  if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response('TECO PvP',{status:426});
  const url=new URL(req.url);
  if(!allowed.has(req.headers.get('Origin')) || !/^\/v1\/(create|[0-9]{6})$/.test(url.pathname)) return new Response(null,{status:403});
  if(!(await env.OPEN_LIMIT.limit({key:req.headers.get('CF-Connecting-IP')||'unknown'})).success) return reject('rate');
  const create=url.pathname.endsWith('/create');
  for(let i=0;i<(create?3:1);i++){
    const code=create?String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000):url.pathname.slice(-6);
    const dest=new URL('/'+(create?'host':'join')+'/'+code,'https://room.internal');
    const response=await env.ROOMS.getByName(code).fetch(new Request(dest,req));
    if(response.status!==409 || !create) return response;
  }
  return reject('busy');
}};

export class GameRoom extends DurableObject {
  sockets(){return this.ctx.getWebSockets().filter(s=>s.readyState===1);}
  sendAll(msg){const text=JSON.stringify(msg);for(const s of this.sockets())s.send(text);}
  lobby(host,notice=''){
    const h=host.deserializeAttachment();
    const members=this.sockets().map(s=>s.deserializeAttachment().slot).sort((a,b)=>a-b);
    this.sendAll({t:'lobby',code:h.code,settings:h.settings,members,notice});
  }
  fetch(req){
    const [,role,code]=new URL(req.url).pathname.split('/');
    const sockets=this.sockets();
    const host=sockets.find(s=>s.deserializeAttachment().slot===0);
    const h=host?.deserializeAttachment();
    if(role==='host' && sockets.length) return new Response(null,{status:409});
    if(role==='join'){
      if(!host)return reject('missing');
      if(h.phase!=='lobby')return reject('playing');
      if(sockets.length>=h.settings.capacity)return reject('full');
    }
    const slots=sockets.map(s=>s.deserializeAttachment().slot);
    const slot=role==='host'?0:[1,2,3].find(n=>!slots.includes(n));
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(slot===0?{slot,code,settings:{...initial},phase:'lobby',seq:0,active:-1}:{slot});
    server.send(JSON.stringify({t:'joined',slot}));
    this.lobby(host??server);
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,raw){
    if(typeof raw!=='string'||raw.length>12288){ws.close(1009,'size');return;}
    const sockets=this.sockets(), host=sockets.find(s=>s.deserializeAttachment().slot===0);
    if(!host){ws.close(4001,'closed');return;}
    const member=ws.deserializeAttachment(), now=Date.now();
    if(!member.since || now-member.since>=10000){member.since=now;member.count=0;}
    if(++member.count>90){ws.close(1008,'rate');return;}
    ws.serializeAttachment(member);
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    const h=host.deserializeAttachment(), owner=member.slot===0;
    const members=sockets.map(s=>s.deserializeAttachment().slot).sort((a,b)=>a-b);
    if(m.t==='setting' && owner && h.phase==='lobby' && Object.hasOwn(options,m.key) && options[m.key].includes(m.value)){
      if(m.key==='capacity' && m.value<members.length)return;
      h.settings[m.key]=m.value;host.serializeAttachment(h);this.lobby(host);
    }else if(m.t==='start' && owner && h.phase==='lobby' && members.length>=2){
      if(!Array.isArray(m.balls)||m.balls.length<2||m.balls.length>32||!m.balls.every(b=>b&&ballId(b.uid)&&ballId(b.defId)&&bounded(b.x)&&bounded(b.z)&&
         (b.marca==null||(Number.isInteger(b.marca)&&b.marca>=0&&b.marca<members.length)))||new Set(m.balls.map(b=>b.uid)).size!==m.balls.length)return;
      h.phase='turn';h.active=-1;h.seq=0;host.serializeAttachment(h);
      this.sendAll({t:'start',members,settings:h.settings,balls:m.balls.map(({uid,defId,x,z,marca})=>({uid,defId,x,z,marca}))});
    }else if(m.t==='turn' && owner && h.phase==='turn' && members.includes(m.slot)){
      if(!Array.isArray(m.board)||m.board.length>32||!m.board.every(p=>Array.isArray(p)&&p.length===3&&ballId(p[0])&&bounded(p[1])&&bounded(p[2])))return;
      if(!Array.isArray(m.scores)||m.scores.length!==members.length||!m.scores.every(n=>bounded(n,100000)))return;
      if(!bounded(m.x)||!bounded(m.z)||!Number.isInteger(m.round)||m.round<1||m.round>100)return;
      h.active=m.slot;h.phase='aim';h.seq++;host.serializeAttachment(h);
      const streak=Number.isInteger(m.streak) && m.streak>=0 && m.streak<=100 ? m.streak : 0;
      this.sendAll({t:'turn',seq:h.seq,slot:m.slot,board:m.board,scores:m.scores,x:m.x,z:m.z,round:m.round,streak,fromRing:!!m.fromRing});
    }else if(m.t==='shot' && h.phase==='aim' && member.slot===h.active && m.seq===h.seq){
      if(!bounded(m.aim,100)||!bounded(m.x)||!bounded(m.z)||!bounded(m.spin,1)||!bounded(m.power,1)||m.power<0.02)return;
      h.phase='turn';host.serializeAttachment(h);
      this.sendAll({t:'shot',seq:h.seq,aim:m.aim,x:m.x,z:m.z,spin:m.spin,power:m.power});
    }else if(m.t==='finish' && owner && h.phase==='turn' && (m.winner===null||members.includes(m.winner)) &&
      Array.isArray(m.scores)&&m.scores.length===members.length&&m.scores.every(n=>bounded(n,100000))){
      h.phase='done';host.serializeAttachment(h);this.sendAll({t:'finish',scores:m.scores,winner:m.winner});
    }else if(m.t==='again' && owner && h.phase==='done'){
      h.phase='lobby';host.serializeAttachment(h);this.lobby(host);
    }
  }
  webSocketClose(ws){
    const {slot}=ws.deserializeAttachment();
    try{ws.close(1000);}catch{}
    const others=this.sockets().filter(s=>s!==ws);
    if(slot===0){for(const s of others)s.close(4001,'closed');return;}
    const host=others.find(s=>s.deserializeAttachment().slot===0);
    if(host){const h=host.deserializeAttachment();h.phase='lobby';host.serializeAttachment(h);this.lobby(host,'left');}
  }
  webSocketError(ws){this.webSocketClose(ws);}
}
