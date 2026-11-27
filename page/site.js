import {gameAccount} from './account.js';
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
  frame.src = account ? 'jogar?conta='+encodeURIComponent(account) : 'jogar';
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
if (!document.fullscreenEnabled) full.hidden = true;
full.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {report('Este navegador não conseguiu abrir a tela cheia.');}
});
const gallery = document.querySelector('#gallery');
for (const button of document.querySelectorAll('[data-arena]')) {
  button.addEventListener('click', () => {
    const name = button.querySelector('strong').textContent;
    const image = document.querySelector('#large');
    image.src = button.querySelector('img').src;
    image.alt = 'Arena ' + name + ' no TECO!';
    document.querySelector('#caption').textContent = name;
    gallery.showModal();
  });
}
gallery.addEventListener('click', event => {
  if (event.target === gallery) gallery.close();
});
