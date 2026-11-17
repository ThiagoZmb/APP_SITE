// ==========================================================================
// Captura de foto ao vivo pela câmera do aparelho (celular/tablet) e envio na hora. Usada pela "Foto do checklist assinado" em
// minhas_entregas.html e entregas.html. Abre a câmera de verdade com getUserMedia (câmera traseira) num painel de tela cheia:
// prévia ao vivo -> "Tirar foto" -> "Usar esta foto" / "Tirar outra" -> envio imediato -> "Registrado às HH:MM".
// Sem getUserMedia (contexto não seguro, navegador antigo) ou com a câmera negada/ocupada, cai para <input capture="environment">.
// Parte pura (planos de redução, máquina de estados, mensagens, chave) testada no Node; a parte de tela usa só `win`/`doc` recebidos.
// Nenhuma geolocalização; a foto fica só na memória (Blob) até ser enviada; os tracks da câmera são SEMPRE parados.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.CameraCaptura = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITE_BYTES = 1000 * 1000;           // o servidor aceita 1 MiB; ficamos abaixo (igual a EntregasComum.LIMITE_IMAGEM)
  const LADOS_MAX = [2000, 1600, 1200, 900, 600]; // maior lado da foto, do mais nítido ao mais leve
  const QUALIDADES = [0.85, 0.72, 0.6, 0.5];

  // câmera traseira, resolução ideal alta o bastante para ler uma folha A4 (o aparelho escolhe a mais próxima)
  const RESTRICOES = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } };

  // escala sem ampliar: devolve largura/altura inteiras cujo maior lado é no máximo `max`
  function escala(larg, alt, max) {
    const l = Math.max(1, Number(larg) || 1), a = Math.max(1, Number(alt) || 1);
    const f = Math.min(1, max / Math.max(l, a));
    return { largura: Math.max(1, Math.round(l * f)), altura: Math.max(1, Math.round(a * f)) };
  }
  // tentativas (lado, qualidade) na ordem de preferência; lados maiores que a própria imagem são pulados (sem repetir a mesma escala)
  function planoReducao(larg, alt) {
    const vistos = new Set(), plano = [];
    for (const max of LADOS_MAX) {
      const { largura, altura } = escala(larg, alt, max);
      const k = largura + 'x' + altura;
      if (vistos.has(k)) continue;
      vistos.add(k);
      for (const q of QUALIDADES) plano.push({ largura, altura, qualidade: q });
    }
    return plano;
  }
  // `codificar(largura, altura, qualidade)` devolve Promise<Blob|null>; pára na primeira que cabe em `limite`
  async function reduzirParaCaber(larg, alt, codificar, limite = LIMITE_BYTES) {
    for (const t of planoReducao(larg, alt)) {
      const blob = await codificar(t.largura, t.altura, t.qualidade);
      if (blob && blob.size > 0 && blob.size <= limite) return blob;
    }
    throw new Error('A foto continua grande demais. Tire outra mais de perto da folha.');
  }

  const suportaCamera = win => {
    const nav = win && win.navigator;
    return !!(win && win.isSecureContext !== false && nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
  };
  // para TODOS os tracks (a luz da câmera apaga); tolera stream nulo e track que já terminou
  function pararStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return 0;
    let n = 0;
    for (const t of stream.getTracks()) { try { t.stop(); n++; } catch { /* já parado */ } }
    return n;
  }
  function mensagemErroCamera(err) {
    const nome = err && err.name;
    if (nome === 'NotAllowedError' || nome === 'PermissionDeniedError' || nome === 'SecurityError')
      return 'O acesso à câmera foi negado. Permita a câmera para este site nas configurações do navegador (cadeado ao lado do endereço) e tente de novo. Enquanto isso, você pode usar a câmera do aparelho pelo botão abaixo.';
    if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError' || nome === 'OverconstrainedError')
      return 'Não encontrei uma câmera neste aparelho. Use a câmera do aparelho pelo botão abaixo.';
    if (nome === 'NotReadableError' || nome === 'TrackStartError' || nome === 'AbortError')
      return 'A câmera está em uso por outro aplicativo ou não pôde ser aberta. Feche o outro aplicativo e tente de novo, ou use a câmera do aparelho pelo botão abaixo.';
    return 'Não foi possível abrir a câmera ao vivo aqui. Use a câmera do aparelho pelo botão abaixo.';
  }
  const SEM_CAMERA_AO_VIVO = 'A câmera ao vivo não está disponível neste navegador (precisa de conexão segura https). Use a câmera do aparelho pelo botão abaixo.';

  // chave de idempotência por foto (o servidor aceita 8 a 64 letras, números e hífen)
  function novaChave(win) {
    const c = win && win.crypto;
    try {
      if (c && typeof c.randomUUID === 'function') return c.randomUUID();
      if (c && typeof c.getRandomValues === 'function') return Array.from(c.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    } catch { /* cai para o aleatório simples */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  }
  const doisDig = n => String(n).padStart(2, '0');
  const horaHHMM = (d = new Date()) => `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`;
  const agoraTexto = (d = new Date()) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())} ${doisDig(d.getHours())}:${doisDig(d.getMinutes())}:${doisDig(d.getSeconds())}`;
  // erro de rede/servidor (vale tentar de novo com a MESMA chave) x recusa definitiva do servidor (400/403/404/409/413...)
  const podeTentarDeNovo = err => { const s = err && err.status; return !s || s >= 500 || s === 408 || s === 429; };

  // ---------- máquina de estados ----------
  // abrindo -> previa | semcamera; previa -> capturada | encerrada; capturada -> enviando | previa(tirar outra) | encerrada;
  // enviando -> registrada | falhou; falhou -> enviando(tentar de novo) | descartada(voltar à prévia) | encerrada; registrada -> previa(outra foto) | encerrada
  const TRANSICOES = {
    abrindo: { prontaAoVivo: 'previa', sempreCamera: 'semcamera', cancelar: 'encerrada' },
    semcamera: { escolheu: 'capturada', ao_vivo: 'abrindo', cancelar: 'encerrada' },
    previa: { capturou: 'capturada', cancelar: 'encerrada', falhouCamera: 'semcamera' },
    capturada: { enviar: 'enviando', outra: 'previa', outraArquivo: 'semcamera', cancelar: 'encerrada' },
    enviando: { ok: 'registrada', erro: 'falhou' },
    falhou: { enviar: 'enviando', descartar: 'previa', descartarArquivo: 'semcamera', cancelar: 'encerrada' },
    registrada: { outra: 'previa', outraArquivo: 'semcamera', concluir: 'encerrada', cancelar: 'encerrada' },
    encerrada: {}
  };
  function criarMaquina(inicial = 'abrindo') {
    let atual = inicial;
    return {
      get estado() { return atual; },
      pode: ev => !!TRANSICOES[atual][ev],
      // evento inválido no estado atual é ignorado (clique duplo/atrasado nunca pula etapa): devolve false
      enviar(ev) { const prox = TRANSICOES[atual][ev]; if (!prox) return false; atual = prox; return true; }
    };
  }

  // ---------- tela ----------
  const TEXTOS = {
    abrindo: 'Abrindo a câmera…', previa: 'Enquadre a folha inteira, bem iluminada, e toque em Tirar foto.',
    capturada: 'Confira se a folha está legível e com a assinatura visível.', enviando: 'Enviando…', semcamera: ''
  };

  // opcoes: { titulo, enviar(blob, chave) -> Promise<resposta>, aoRegistrar(resposta, blob), aoFechar(qtdRegistradas), fallbackInput }
  function capturar(win, opcoes) {
    const doc = win.document;
    const o = Object.assign({ titulo: 'Foto do checklist assinado' }, opcoes);
    const maq = criarMaquina();
    let stream = null, blob = null, chave = null, urlPrevia = null, registradas = 0, fechado = false, origemArquivo = false;

    const el = (tag, cls, texto) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; };
    const raizEl = el('div', 'cc-fundo');
    raizEl.setAttribute('role', 'dialog'); raizEl.setAttribute('aria-modal', 'true'); raizEl.setAttribute('aria-label', o.titulo);
    const topo = el('div', 'cc-topo');
    const titulo = el('strong', 'cc-titulo', o.titulo);
    const btnFechar = el('button', 'btn btn-secondary cc-fechar', 'Cancelar'); btnFechar.type = 'button';
    topo.append(titulo, btnFechar);
    const palco = el('div', 'cc-palco');
    const video = el('video', 'cc-video');
    video.setAttribute('playsinline', ''); video.setAttribute('autoplay', ''); video.setAttribute('muted', ''); video.muted = true; video.playsInline = true;
    const img = el('img', 'cc-previa'); img.alt = 'Foto tirada, para conferir'; img.hidden = true;
    palco.append(video, img);
    const msg = el('p', 'cc-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    const barra = el('div', 'cc-barra');
    raizEl.append(topo, palco, msg, barra);

    const botao = (texto, cls, fn) => { const b = el('button', 'btn cc-btn ' + cls, texto); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const entrada = doc.createElement('input'); entrada.type = 'file'; entrada.accept = 'image/*'; entrada.setAttribute('capture', 'environment'); entrada.hidden = true;
    raizEl.appendChild(entrada);

    function soltarPrevia() { if (urlPrevia) { win.URL.revokeObjectURL(urlPrevia); urlPrevia = null; } }
    function pararCamera() { pararStream(stream); stream = null; try { video.srcObject = null; } catch { /* sem srcObject */ } }

    function desenhar(aviso, erro) {
      const s = maq.estado;
      barra.textContent = '';
      video.hidden = !(s === 'previa' || s === 'abrindo');
      img.hidden = !(blob && (s === 'capturada' || s === 'enviando' || s === 'falhou' || s === 'registrada'));
      palco.classList.toggle('cc-sem-imagem', video.hidden && img.hidden);
      msg.className = 'cc-msg' + (erro ? ' cc-erro' : '');
      msg.textContent = aviso || TEXTOS[s] || '';
      btnFechar.disabled = s === 'enviando';
      if (s === 'previa') barra.append(botao('Tirar foto', 'btn-primary cc-grande', tirarFoto));
      if (s === 'semcamera') barra.append(botao('Abrir a câmera do aparelho', 'btn-primary cc-grande', () => entrada.click()),
        ...(suportaCamera(win) ? [botao('Tentar a câmera ao vivo de novo', 'btn-secondary cc-grande', abrirAoVivo)] : []));
      if (s === 'capturada') barra.append(botao('Usar esta foto', 'btn-primary cc-grande', enviar), botao('Tirar outra', 'btn-secondary cc-grande', outra));
      if (s === 'enviando') { const b = botao('Enviando…', 'btn-primary cc-grande', () => {}); b.disabled = true; barra.append(b); }
      if (s === 'falhou') barra.append(botao('Tentar enviar de novo', 'btn-primary cc-grande', enviar), botao('Descartar e tirar outra', 'btn-secondary cc-grande', descartar));
      if (s === 'registrada') barra.append(botao('Tirar outra foto', 'btn-secondary cc-grande', outra), botao('Concluir', 'btn-primary cc-grande', () => encerrar('concluir')));
      const foco = barra.querySelector('button:not([disabled])');
      if (foco && s !== 'enviando') foco.focus({ preventScroll: true });
    }

    async function abrirAoVivo() {
      if (maq.estado === 'semcamera') maq.enviar('ao_vivo');
      if (maq.estado !== 'abrindo') return;
      desenhar();
      if (!suportaCamera(win)) { maq.enviar('sempreCamera'); desenhar(SEM_CAMERA_AO_VIVO); return; }
      try {
        const s = await win.navigator.mediaDevices.getUserMedia(RESTRICOES);
        if (fechado) { pararStream(s); return; } // cancelou enquanto o aparelho pedia permissão
        stream = s;
        video.srcObject = s;
        try { await video.play(); } catch { /* o autoplay já inicia no iOS com playsinline+muted */ }
        if (fechado) return;
        maq.enviar('prontaAoVivo');
        desenhar();
      } catch (err) {
        if (fechado) return;
        pararCamera();
        maq.enviar('sempreCamera');
        desenhar(mensagemErroCamera(err), true);
      }
    }

    function tirarFoto() {
      if (maq.estado !== 'previa' || !stream) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { desenhar('A câmera ainda não está pronta. Aguarde um instante e toque de novo.', true); return; }
      const fonte = win.document.createElement('canvas');
      fonte.width = w; fonte.height = h;
      fonte.getContext('2d').drawImage(video, 0, 0, w, h);
      pararCamera(); // a câmera apaga assim que a foto é tirada
      codificarCanvas(fonte, w, h).then(b => { if (!fechado) mostrarFoto(b, 'capturou', false); }, err => { if (!fechado) abrirAoVivoDeNovo(err.message); });
    }
    function codificarCanvas(fonte, w, h) {
      return reduzirParaCaber(w, h, (l, a, q) => new Promise(ok => {
        const c = doc.createElement('canvas'); c.width = l; c.height = a;
        c.getContext('2d').drawImage(fonte, 0, 0, l, a);
        c.toBlob(ok, 'image/jpeg', q);
      }));
    }
    function mostrarFoto(b, evento, deArquivo) {
      blob = b; chave = novaChave(win); origemArquivo = deArquivo;
      soltarPrevia(); urlPrevia = win.URL.createObjectURL(b); img.src = urlPrevia;
      maq.enviar(evento);
      desenhar();
    }
    // foto escolhida pelo seletor do aparelho (câmera nativa): mesma redução e mesma conferência
    async function aoEscolherArquivo() {
      const arq = entrada.files && entrada.files[0];
      entrada.value = '';
      if (!arq || fechado) return;
      if (!/^image\//.test(arq.type || '')) { desenhar('Escolha uma imagem (foto).', true); return; }
      try {
        const bmp = await lerImagem(arq);
        const b = await reduzirParaCaber(bmp.largura, bmp.altura, (l, a, q) => new Promise(ok => {
          const c = doc.createElement('canvas'); c.width = l; c.height = a;
          c.getContext('2d').drawImage(bmp.imagem, 0, 0, l, a);
          c.toBlob(ok, 'image/jpeg', q);
        }));
        if (!fechado) mostrarFoto(b, 'escolheu', true);
      } catch (err) { if (!fechado) desenhar(err.message || 'Não foi possível ler a foto.', true); }
    }
    function lerImagem(arq) {
      return new Promise((ok, falha) => {
        const url = win.URL.createObjectURL(arq), i = new win.Image();
        i.onload = () => { win.URL.revokeObjectURL(url); ok({ imagem: i, largura: i.naturalWidth, altura: i.naturalHeight }); };
        i.onerror = () => { win.URL.revokeObjectURL(url); falha(new Error('Não foi possível ler a imagem.')); };
        i.src = url;
      });
    }

    async function enviar() {
      if (!blob || !maq.enviar('enviar')) return;
      desenhar();
      try {
        const r = await o.enviar(blob, chave);
        registradas++;
        maq.enviar('ok');
        if (o.aoRegistrar) { try { o.aoRegistrar(r, blob); } catch { /* a tela de trás não pode derrubar o painel */ } }
        const hora = horaHHMM();
        desenhar(`Registrado às ${hora}. ${registradas === 1 ? '1 foto enviada' : registradas + ' fotos enviadas'} agora.`);
        msg.classList.add('cc-ok');
        blob = null; chave = null; // a foto já está no servidor; a prévia continua só para conferência
      } catch (err) {
        maq.enviar('erro');
        const tenta = podeTentarDeNovo(err);
        desenhar(tenta
          ? `${err.message} A foto continua guardada aqui, não se perdeu. Toque em Tentar enviar de novo (não duplica: se ela já tiver chegado, o servidor reconhece).`
          : err.message, true);
        if (!tenta) { barra.textContent = ''; barra.append(botao('Descartar e tirar outra', 'btn-primary cc-grande', descartar)); }
      }
    }
    function outra() {
      blob = null; chave = null; soltarPrevia(); img.removeAttribute('src');
      if (origemArquivo || !suportaCamera(win)) { maq.enviar('outraArquivo'); desenhar(); return; }
      maq.enviar('outra'); abrirAoVivoDeNovo();
    }
    function descartar() {
      blob = null; chave = null; soltarPrevia(); img.removeAttribute('src');
      if (origemArquivo || !suportaCamera(win)) { maq.enviar('descartarArquivo'); desenhar(); return; }
      maq.enviar('descartar'); abrirAoVivoDeNovo();
    }
    // estado "previa" sem stream (a câmera foi parada ao tirar a foto): abre a câmera de novo
    async function abrirAoVivoDeNovo(aviso) {
      desenhar(aviso || 'Abrindo a câmera…', !!aviso);
      try {
        const s = await win.navigator.mediaDevices.getUserMedia(RESTRICOES);
        if (fechado) { pararStream(s); return; }
        stream = s; video.srcObject = s;
        try { await video.play(); } catch { /* ok */ }
        desenhar(aviso, !!aviso);
      } catch (err) {
        if (fechado) return;
        pararCamera();
        if (maq.estado === 'previa') maq.enviar('falhouCamera');
        desenhar(mensagemErroCamera(err), true);
      }
    }

    function encerrar(ev) {
      if (fechado) return;
      if (maq.estado === 'enviando') return; // não fecha no meio do envio
      maq.enviar(ev);
      fechado = true;
      pararCamera(); soltarPrevia();
      win.removeEventListener('pagehide', aoSairDaPagina);
      doc.removeEventListener('keydown', aoTecla);
      raizEl.remove();
      blob = null;
      if (o.aoFechar) { try { o.aoFechar(registradas); } catch { /* ignora */ } }
    }
    const aoSairDaPagina = () => { pararCamera(); };
    const aoTecla = ev => { if (ev.key === 'Escape') encerrar('cancelar'); };

    btnFechar.addEventListener('click', () => encerrar('cancelar'));
    entrada.addEventListener('change', aoEscolherArquivo);
    win.addEventListener('pagehide', aoSairDaPagina);
    doc.addEventListener('keydown', aoTecla);
    doc.body.appendChild(raizEl);

    // sem getUserMedia: o seletor do aparelho abre já neste clique (o clique original ainda vale como gesto do usuário)
    if (!suportaCamera(win)) {
      maq.enviar('sempreCamera');
      desenhar(SEM_CAMERA_AO_VIVO);
      try { entrada.click(); } catch { /* o botão da tela faz o mesmo */ }
    } else {
      abrirAoVivo(); // a máquina já nasce em "abrindo"
    }

    return { fechar: () => encerrar('cancelar'), get estado() { return maq.estado; } };
  }

  // Pergunta "Deseja já dar a baixa nesta entrega?" depois da foto do checklist (2026-11-17). Nunca dá a baixa sozinha:
  // "Sim" só chama aoSim (a tela abre o formulário de baixa de sempre); "Agora não" (ou Esc) só fecha.
  function perguntarBaixa(win, opcoes) {
    const doc = win.document;
    const o = Object.assign({ pergunta: 'Deseja já dar a baixa nesta entrega?', aoSim: () => {} }, opcoes);
    const el = (tag, cls, texto) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; };
    const fundo = el('div', 'cc-pergunta-fundo');
    const caixa = el('div', 'cc-pergunta');
    caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-labelledby', 'cc-pergunta-titulo');
    const t = el('p', 'cc-pergunta-titulo', o.pergunta); t.id = 'cc-pergunta-titulo';
    const dica = el('p', 'cc-pergunta-dica', 'A foto do checklist já foi enviada. A baixa é um passo à parte e só acontece se você confirmar.');
    const barra = el('div', 'cc-pergunta-barra');
    const fechar = () => { doc.removeEventListener('keydown', aoTecla); fundo.remove(); };
    const aoTecla = ev => { if (ev.key === 'Escape') fechar(); };
    const sim = el('button', 'btn btn-primary cc-grande cc-pergunta-sim', 'Sim, dar a baixa'); sim.type = 'button';
    const nao = el('button', 'btn btn-secondary cc-grande cc-pergunta-nao', 'Agora não'); nao.type = 'button';
    sim.addEventListener('click', () => { fechar(); try { o.aoSim(); } catch { /* a tela de trás não derruba a pergunta */ } });
    nao.addEventListener('click', fechar);
    barra.append(sim, nao);
    caixa.append(t, dica, barra);
    fundo.appendChild(caixa);
    doc.addEventListener('keydown', aoTecla);
    doc.body.appendChild(fundo);
    sim.focus({ preventScroll: true });
    return { fechar };
  }

  return { LIMITE_BYTES, LADOS_MAX, QUALIDADES, RESTRICOES, escala, planoReducao, reduzirParaCaber, suportaCamera, pararStream,
    mensagemErroCamera, novaChave, horaHHMM, agoraTexto, podeTentarDeNovo, criarMaquina, TRANSICOES, capturar, perguntarBaixa };
});
