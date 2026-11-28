import { DurableObject } from 'cloudflare:workers';

const initial = {capacity:2, arena:'calcada', montagem:'roda', regra:'pontos', tempero:'nenhum'};
const options = {
  capacity:[2,3,4], arena:['calcada','terrao','quadra','praca','terreiro','paralelepipedo','quintal'],
  montagem:['roda','triangulo','meialua','cruz','fila','losango','cantos','parede'],
  regra:['pontos','caixinha','matamata','dengue','marcada','tirateima'],
  tempero:['nenhum','tabela','cantada','semdefesa']
};
const avisos = new Set(['cantada','tabela','rival']);
const faltas = new Set(['buraco','semtoque']);
const motivos = new Set(['ultima','penultima','dengue','marcadas','primeira']);
const bounded = (n,limit=4096) => Number.isFinite(n) && Math.abs(n)<=limit;
const ballId = s => typeof s==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
const cleanName = s => typeof s==='string' ? s.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,24) : '';
const allowed = new Set(['https://jogarteco.art','https://teco-gude-arcade.vercel.app','file://','null']);

function sanitizeLast(raw, members) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (!members.includes(raw.slot)) return undefined;
  if (!Number.isInteger(raw.rodada) || raw.rodada < 1 || raw.rodada > 100) return undefined;
  if (!Number.isInteger(raw.teco) || raw.teco < 1 || raw.teco > 10) return undefined;
  if (!Number.isInteger(raw.tiradas) || raw.tiradas < 0 || raw.tiradas > 32) return undefined;
  if (!Number.isInteger(raw.delta) || Math.abs(raw.delta) > 1000) return undefined;
  if (!bounded(raw.placar, 100000)) return undefined;
  if (!Number.isInteger(raw.voltaram) || raw.voltaram < 0 || raw.voltaram > 32) return undefined;
  if (!Number.isInteger(raw.devolvidas) || raw.devolvidas < 0 || raw.devolvidas > 32) return undefined;
  const bonus = Array.isArray(raw.bonus)
    ? raw.bonus.slice(0, 6).filter(s => typeof s === 'string').map(s => s.replace(/[\x00-\x1f\x7f]/g,'').slice(0, 40))
    : [];
  const aviso = avisos.has(raw.aviso) ? raw.aviso : null;
  const falta = faltas.has(raw.falta) ? raw.falta : null;
  const fimMotivo = motivos.has(raw.fimMotivo) ? raw.fimMotivo : null;
  return {
    slot: raw.slot, rodada: raw.rodada, teco: raw.teco, tiradas: raw.tiradas,
    delta: raw.delta, placar: raw.placar, bonus, aviso, falta,
    voltaram: raw.voltaram, devolvidas: raw.devolvidas,
    eliminado: !!raw.eliminado, fimMotivo, acertou: !!raw.acertou,
  };
}

function sanitizeEliminated(raw, members) {
  if (!Array.isArray(raw)) return undefined;
  const set = new Set();
  for (const s of raw) if (members.includes(s)) set.add(s);
  return [...set].sort((a,b) => a - b);
}

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
  findHost(sockets=this.sockets()){return sockets.find(s=>s.deserializeAttachment().isHost) ?? sockets.find(s=>s.deserializeAttachment().slot===0);}
  roster(sockets=this.sockets()){
    const items=sockets.map(s=>s.deserializeAttachment()).sort((a,b)=>a.slot-b.slot);
    const members=items.map(x=>x.slot);
    const names={};
    for(const x of items) if(x.name) names[x.slot]=x.name;
    return {members,names};
  }
  lobby(host,notice=''){
    const h=host.deserializeAttachment();
    const {members,names}=this.roster();
    this.sendAll({t:'lobby',code:h.code,host:h.slot,settings:h.settings,members,names,notice});
  }
  roomUpdate(host,notice=''){
    const h=host.deserializeAttachment();
    const {members,names}=this.roster();
    const rematch=(h.rematch??[]).filter(s=>members.includes(s));
    if(rematch.length!==(h.rematch??[]).length){h.rematch=rematch;host.serializeAttachment(h);}
    this.sendAll({t:'room-update',code:h.code,host:h.slot,phase:h.phase,members,names,rematch,notice});
  }
  fetch(req){
    const [,role,code]=new URL(req.url).pathname.split('/');
    const sockets=this.sockets();
    const host=this.findHost(sockets);
    const h=host?.deserializeAttachment();
    if(role==='host' && sockets.length) return new Response(null,{status:409});
    if(role==='join'){
      if(!host)return reject('missing');
      if(h.phase!=='lobby')return reject('playing');
      if(sockets.length>=h.settings.capacity)return reject('full');
    }
    const slots=sockets.map(s=>s.deserializeAttachment().slot);
    const slot=role==='host'?0:[0,1,2,3].find(n=>!slots.includes(n));
    if(slot===undefined)return reject('full');
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const att=role==='host'
      ? {slot,isHost:true,code,settings:{...initial},phase:'lobby',seq:0,active:-1,rematch:[],name:''}
      : {slot,isHost:false,name:''};
    server.serializeAttachment(att);
    server.send(JSON.stringify({t:'joined',slot,host:(host?h.slot:slot)}));
    this.lobby(host??server);
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,raw){
    if(typeof raw!=='string'||raw.length>16384){ws.close(1009,'size');return;}
    const sockets=this.sockets(), host=this.findHost(sockets);
    if(!host){ws.close(4001,'closed');return;}
    const member=ws.deserializeAttachment(), now=Date.now();
    if(!member.since || now-member.since>=10000){member.since=now;member.count=0;}
    if(++member.count>90){ws.close(1008,'rate');return;}
    ws.serializeAttachment(member);
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    const h=host.deserializeAttachment(), owner=!!member.isHost;
    const {members,names}=this.roster(sockets);
    if(m.t==='hello'){
      const n=cleanName(m.name);
      if(n && n!==member.name){
        member.name=n;
        ws.serializeAttachment(member);
        if(h.phase==='lobby') this.lobby(host);
        else this.roomUpdate(host);
      }
      return;
    }
    if(m.t==='setting' && owner && h.phase==='lobby' && Object.hasOwn(options,m.key) && options[m.key].includes(m.value)){
      if(m.key==='capacity' && m.value<members.length)return;
      if(m.key==='tempero' && m.value==='semdefesa' && h.settings.regra==='caixinha')return;
      h.settings[m.key]=m.value;
      if(h.settings.regra==='caixinha' && h.settings.tempero==='semdefesa') h.settings.tempero='nenhum';
      host.serializeAttachment(h);this.lobby(host);
    }else if(m.t==='start' && owner && (h.phase==='lobby' || h.phase==='done') && members.length>=2){
      if(!Array.isArray(m.balls)||m.balls.length<2||m.balls.length>32||!m.balls.every(b=>b&&ballId(b.uid)&&ballId(b.defId)&&bounded(b.x)&&bounded(b.z)&&
         (b.marca==null||(Number.isInteger(b.marca)&&b.marca>=0&&b.marca<members.length)))||new Set(m.balls.map(b=>b.uid)).size!==m.balls.length)return;
      h.phase='turn';h.active=-1;h.seq=0;h.rematch=[];host.serializeAttachment(h);
      this.sendAll({t:'start',host:h.slot,members,names,settings:h.settings,balls:m.balls.map(({uid,defId,x,z,marca})=>({uid,defId,x,z,marca}))});
    }else if(m.t==='turn' && owner && h.phase==='turn' && members.includes(m.slot)){
      if(!Array.isArray(m.board)||m.board.length>32||!m.board.every(p=>Array.isArray(p)&&p.length===3&&ballId(p[0])&&bounded(p[1])&&bounded(p[2])))return;
      if(!Array.isArray(m.scores)||m.scores.length!==members.length||!m.scores.every(n=>bounded(n,100000)))return;
      if(!bounded(m.x)||!bounded(m.z)||!Number.isInteger(m.round)||m.round<1||m.round>100)return;
      h.active=m.slot;h.phase='aim';h.seq++;host.serializeAttachment(h);
      const streak=Number.isInteger(m.streak) && m.streak>=0 && m.streak<=100 ? m.streak : 0;
      const eliminated=sanitizeEliminated(m.eliminated, members);
      const last=sanitizeLast(m.last, members);
      this.sendAll({t:'turn',seq:h.seq,slot:m.slot,board:m.board,scores:m.scores,x:m.x,z:m.z,round:m.round,streak,fromRing:!!m.fromRing,
        ...(eliminated?{eliminated}:{}), ...(last?{last}:{})});
    }else if(m.t==='shot' && h.phase==='aim' && member.slot===h.active && m.seq===h.seq){
      if(!bounded(m.aim,100)||!bounded(m.x)||!bounded(m.z)||!bounded(m.spin,1)||!bounded(m.power,1)||m.power<0.02)return;
      const cantada = m.cantada === null ? null : ballId(m.cantada) ? m.cantada : undefined;
      h.phase='turn';host.serializeAttachment(h);
      this.sendAll({t:'shot',seq:h.seq,aim:m.aim,x:m.x,z:m.z,spin:m.spin,power:m.power,...(cantada!==undefined?{cantada}:{})});
    }else if(m.t==='finish' && owner && h.phase==='turn' && (m.winner===null||members.includes(m.winner)) &&
      Array.isArray(m.scores)&&m.scores.length===members.length&&m.scores.every(n=>bounded(n,100000))){
      h.phase='done';h.rematch=[];host.serializeAttachment(h);
      const reason=motivos.has(m.reason)?m.reason:null;
      const eliminated=sanitizeEliminated(m.eliminated, members);
      const last=sanitizeLast(m.last, members);
      this.sendAll({t:'finish',host:h.slot,members,names,scores:m.scores,winner:m.winner,rematch:[],
        ...(reason?{reason}:{}), ...(eliminated?{eliminated}:{}), ...(last?{last}:{})});
    }else if(m.t==='rematch' && h.phase==='done'){
      const set=new Set((h.rematch??[]).filter(s=>members.includes(s)));
      if(m.ready===false) set.delete(member.slot);
      else set.add(member.slot);
      h.rematch=[...set].sort((a,b)=>a-b);
      host.serializeAttachment(h);
      this.roomUpdate(host);
    }else if(m.t==='again' && owner && h.phase==='done'){
      h.phase='lobby';h.rematch=[];host.serializeAttachment(h);this.lobby(host);
    }
  }
  webSocketClose(ws){
    const leaving=ws.deserializeAttachment();
    try{ws.close(1000);}catch{}
    const others=this.sockets().filter(s=>s!==ws);
    if(!others.length) return;
    let host=this.findHost(others);
    let notice='left';
    if(!host && leaving?.isHost){
      // Migra o papel de anfitrião para o próximo jogador da sala em vez de derrubar a sala.
      const next=others.slice().sort((a,b)=>a.deserializeAttachment().slot-b.deserializeAttachment().slot)[0];
      const nextAtt=next.deserializeAttachment();
      const keptPhase = leaving.phase === 'done' ? 'done' : 'lobby';
      const remainingSlots = others.map(s=>s.deserializeAttachment().slot);
      const nextCapacity = Math.max(leaving.settings?.capacity ?? 2, remainingSlots.length);
      next.serializeAttachment({
        ...nextAtt,
        isHost:true,
        code:leaving.code,
        settings:{...(leaving.settings ?? initial), capacity: Math.min(4, nextCapacity)},
        phase:keptPhase,
        seq:0,
        active:-1,
        rematch:(leaving.rematch ?? []).filter(s=>remainingSlots.includes(s)),
      });
      host=next;
      notice='host-left';
    }
    if(!host) return;
    const h=host.deserializeAttachment();
    if(h.phase==='done'){
      // Mantém quem ficou na tela de resultado com opção de continuar na sala ou revanche.
      this.roomUpdate(host, notice);
      return;
    }
    h.phase='lobby';
    h.active=-1;
    h.rematch=[];
    host.serializeAttachment(h);
    this.lobby(host, notice);
  }
  webSocketError(ws){this.webSocketClose(ws);}
}
