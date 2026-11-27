const stage = document.querySelector('#stage');
const launcher = document.querySelector('#launch');
const play = document.querySelector('#play');
const status = document.querySelector('#status');
function report(message) {
  status.hidden = !message;
  status.textContent = message;
}
play.addEventListener('click', () => {
  play.disabled = true;
  report('Abrindo o jogo…');
  const frame = document.createElement('iframe');
  frame.title = 'TECO! Bolinha de Gude Arcade';
  frame.allow = 'fullscreen; autoplay; gamepad';
  frame.allowFullscreen = true;
  frame.src = 'game/index.html?v=__RELEASE__';
  function failed() {
    window.clearTimeout(timer);
    frame.remove();
    launcher.hidden = false;
    play.disabled = false;
    report('O jogo não abriu. Confira a conexão e tente outra vez.');
    play.focus();
  }
  const timer = window.setTimeout(failed, 30000);
  frame.addEventListener('error', failed, {once:true});
  frame.addEventListener('load', async () => {
    const end = Date.now() + 25000;
    while (frame.isConnected && Date.now() < end) {
      if (frame.contentDocument?.querySelector('.screen-title [data-action="play"]')) {
        window.clearTimeout(timer);
        launcher.hidden = true;
        report('');
        frame.focus();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (frame.isConnected) failed();
  }, {once:true});
  stage.prepend(frame);
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