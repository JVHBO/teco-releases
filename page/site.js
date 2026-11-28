import {gameAccount, gameAccountName} from './account.js';
import './ranking.js';
import './chat.js';
const stage = document.querySelector('#stage');
const launcher = document.querySelector('#launch');
const play = document.querySelector('#play');
const status = document.querySelector('#status');
function report(message) {
  status.hidden = !message;
  status.textContent = message;
}
let activeFrame, switching = false;
async function openGame(previous) {
  play.disabled = true;
  report('Abrindo o jogo…');
  let account;
  try {account=await gameAccount(!previous);} catch(e){play.disabled=false;switching=false;report(e.message);return;}
  const frame = document.createElement('iframe');
  frame.title = 'TECO! Bolinha de Gude Arcade';
  frame.allow = 'fullscreen; autoplay; gamepad';
  frame.allowFullscreen = true;
  frame.dataset.tecoHost = '1';
  const params = new URLSearchParams();
  if (account) params.set('conta', account);
  const nome = gameAccountName();
  if (nome) params.set('nome', nome);
  const qs = params.toString();
  frame.src = qs ? 'jogar?' + qs : 'jogar';
  if(previous) {frame.classList.add('preparing'); previous.inert=true;}
  function failed() {
    window.clearTimeout(timer);
    frame.remove();
    if(previous) previous.inert=false;
    else launcher.hidden = false;
    switching=false;
    play.disabled = false;
    report('O jogo não abriu. Confira a conexão e tente outra vez.');
    play.focus();
  }
  const timer = window.setTimeout(failed, 30000);
  frame.addEventListener('error', failed, {once:true});
  async function mostrarQuandoPronto() {
    const end = Date.now() + 25000;
    while (frame.isConnected && Date.now() < end) {
      if (frame.contentDocument?.querySelector('#first-language:not(.hidden), #first-region:not(.hidden), .screen-title [data-action="play"], .screen-options')) {
        window.clearTimeout(timer);
        const version = frame.contentDocument.querySelector('meta[name="application-version"]')?.content
          || frame.contentDocument.querySelector('.footnote')?.textContent?.match(/v\d+\.\d+\.\d+/)?.[0];
        if (version) document.querySelector('.version').textContent = version;
        launcher.hidden = true;
        stage.classList.add('playing');
        activeFrame=frame;
        frame.classList.remove('preparing');
        previous?.remove();
        switching=false;
        report('');
        const choice = frame.contentDocument.querySelector('.language-panel button:focus');
        if (choice) choice.focus();
        else frame.focus();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (frame.isConnected) failed();
  }
  stage.prepend(frame);
  void mostrarQuandoPronto();
}
play.addEventListener('click',()=>openGame(null));
window.addEventListener('message',event=>{
  if(event.origin !== location.origin || event.source !== activeFrame?.contentWindow || event.data?.type!=='teco-reload-language' || switching) return;
  switching=true;
  void openGame(activeFrame);
});
const full = document.querySelector('#full');
const exitFull = document.querySelector('#exit-full');
const isCoarse = () => window.matchMedia?.('(pointer: coarse)').matches;

function setMobileFull(on) {
  stage.classList.toggle('mobile-full', on);
  document.body.classList.toggle('is-mobile-full', on);
  if (exitFull) exitFull.hidden = !on && !document.fullscreenElement;
}

function syncFullUi() {
  const nativeOn = document.fullscreenElement === stage;
  const mobileOn = stage.classList.contains('mobile-full');
  if (exitFull) exitFull.hidden = !(nativeOn || mobileOn);
  if (!nativeOn && !mobileOn) {
    try { screen.orientation?.unlock?.(); } catch {}
  }
}

document.addEventListener('fullscreenchange', syncFullUi);

async function enterFullscreen() {
  if (document.fullscreenEnabled && typeof stage.requestFullscreen === 'function') {
    try {
      await stage.requestFullscreen();
      if (document.fullscreenElement === stage) {
        if (isCoarse()) {
          try { await screen.orientation?.lock?.('landscape'); } catch {}
        }
        syncFullUi();
        return;
      }
    } catch {
      // iOS Safari e alguns navegadores mobile bloqueiam requestFullscreen em <div>; usa modo tela cheia CSS
    }
  }
  setMobileFull(true);
}

async function leaveFullscreen() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
  }
  setMobileFull(false);
  syncFullUi();
}

full?.addEventListener('click', () => {
  if (document.fullscreenElement === stage || stage.classList.contains('mobile-full')) {
    void leaveFullscreen();
  } else {
    void enterFullscreen();
  }
});

exitFull?.addEventListener('click', () => {
  void leaveFullscreen();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stage.classList.contains('mobile-full')) void leaveFullscreen();
});
