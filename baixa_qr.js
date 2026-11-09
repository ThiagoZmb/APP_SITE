// ==========================================================================
// baixa_qr.html — baixa de estoque lendo o QR da etiqueta com a câmera do celular.
// Rotas: GET /estoque/por_codigo/:codigo (item) e POST /estoque/saida (a saída de estoque de sempre, com chave de repetição).
// Aqui ficam as funções puras (testadas no Node, test/baixa_qr_tela.test.js) e, no fim, o desenho da tela e o laço da câmera
// (só no navegador; a câmera e o jsQR reais não são testáveis no Node).
// Dado vindo da API só entra na tela por textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.BaixaQr = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : (typeof self !== 'undefined' ? self : this).EntregasComum;

  // ============ LÓGICA PURA ============
  const MSG_REPETIDA = 'Esta baixa já foi registrada. Confira no histórico antes de repetir.';
  const MSG_SEM_CONEXAO = 'Sem conexão. Tente de novo.';

  // quantidade entre 1 e o saldo inteiro (no mínimo 1)
  function ajustarQtd(qtd, delta, saldo) {
    const max = Math.max(1, Math.floor(Number(saldo) || 0));
    const n = Math.floor(Number(qtd) || 1) + Math.floor(Number(delta) || 0);
    return Math.min(max, Math.max(1, n));
  }

  // chave de repetição do lançamento (o servidor recusa a mesma chave com 409); até 64 caracteres
  function novaChave() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && typeof c.randomUUID === 'function') return 'qr-' + c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return 'qr-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }

  const dataLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const corpoDaBaixa = (item, qtd, chave, hoje) => ({ chave, data: hoje, itens: [{ produtoCodigo: item.codigo, qtd }] });

  function mensagemDeErro(status, corpo) {
    const erro = corpo && corpo.error;
    if (status === 404) return 'Item não encontrado.';
    if (status === 403) return 'Sem permissão para dar baixa.';
    if (status === 409 && erro === 'Este lançamento já foi gravado.') return MSG_REPETIDA;
    return erro || 'Erro de servidor.';
  }

  // mesmo critério do servidor (calculo/estoque_qr.js): 1 a 20 caracteres, sem controle
  function codigoOk(t) {
    return typeof t === 'string' && t.length >= 1 && t.length <= 20 && !/[\u0000-\u001f\u007f]/.test(t);
  }

  // texto do QR no quadro da câmera ou null; jsQR é injetado (nos testes, falso)
  function lerQr(imagem, jsQR) {
    const r = jsQR(imagem.data, imagem.width, imagem.height, { inversionAttempts: 'dontInvert' });
    return r && typeof r.data === 'string' && r.data ? r.data : null;
  }

  const valor = v => typeof v === 'function' ? v() : v;

  // api(caminho, opcoes) -> Promise<{ ok, status, corpo }>; opcoes = { metodo, corpo }
  function criarFluxo({ api, hoje, chave }) {
    const gerarChave = chave || novaChave;
    const estado = { fase: 'lendo', item: null, qtd: 1, chave: null, mensagem: '', depois: null };
    let consultando = false;

    const falhar = (fase, status, corpo) => { estado.fase = fase; estado.mensagem = mensagemDeErro(status, corpo); };

    async function lerCodigo(texto) {
      if (consultando || estado.fase === 'cartao' || estado.fase === 'gravando') return;
      const codigo = typeof texto === 'string' ? texto.trim() : '';
      estado.item = null; estado.depois = null; estado.qtd = 1; estado.chave = null; estado.mensagem = '';
      if (!codigoOk(codigo)) { estado.fase = 'erro'; estado.mensagem = 'Código inválido.'; return; }
      consultando = true;
      try {
        let r;
        try { r = await api('/estoque/por_codigo/' + encodeURIComponent(codigo)); } catch { r = { ok: false, status: 0, corpo: { error: MSG_SEM_CONEXAO } }; }
        if (!r.ok) return falhar('erro', r.status, r.corpo);
        estado.item = r.corpo;
        estado.qtd = 1;
        estado.chave = gerarChave();   // a mesma chave vale para toda tentativa deste cartão
        estado.fase = 'cartao';
      } finally { consultando = false; }
    }

    function mudarQtd(delta) {
      if (estado.fase !== 'cartao' || !estado.item) return;
      estado.qtd = ajustarQtd(estado.qtd, delta, estado.item.qtd);
    }

    async function confirmar() {
      if (estado.fase !== 'cartao') return;   // 'gravando' = já há um envio em andamento
      estado.fase = 'gravando';
      estado.mensagem = '';
      let r;
      try {
        r = await api('/estoque/saida', { metodo: 'POST', corpo: corpoDaBaixa(estado.item, estado.qtd, estado.chave, valor(hoje)) });
      } catch { r = { ok: false, status: 0, corpo: { error: MSG_SEM_CONEXAO } }; }
      if (!r.ok) return falhar('cartao', r.status, r.corpo);
      const linha = r.corpo && Array.isArray(r.corpo.itens) ? r.corpo.itens[0] : null;
      estado.depois = linha ? linha.depois : null;
      estado.fase = 'feito';
    }

    function cancelar() {
      if (estado.fase === 'gravando') return;
      estado.fase = 'lendo'; estado.item = null; estado.qtd = 1; estado.chave = null; estado.mensagem = ''; estado.depois = null;
    }

    return { estado, lerCodigo, mudarQtd, confirmar, cancelar };
  }

  // ============ NAVEGADOR ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);

    // adapta chamar (que lança erro) ao formato { ok, status, corpo } do fluxo
    const api = async (caminho, opcoes) => {
      try {
        return { ok: true, status: 200, corpo: await chamar(caminho, opcoes) };
      } catch (err) {
        return { ok: false, status: err.status || 0, corpo: { error: err.message } };
      }
    };
    const fluxo = criarFluxo({ api, hoje: () => dataLocal(new Date()) });
    const e = fluxo.estado;

    // ---------- desenho ----------
    const fases = { lendo: 'vista-leitura', erro: 'vista-leitura', cartao: 'vista-cartao', gravando: 'vista-cartao', feito: 'vista-feito' };
    function desenhar() {
      const alvo = fases[e.fase];
      ['vista-leitura', 'vista-cartao', 'vista-feito'].forEach(v => { $(v).hidden = v !== alvo; });
      const erroLeitura = e.fase === 'erro';
      $('msg-leitura').textContent = erroLeitura ? e.mensagem : '';
      $('btn-tentar-outra').hidden = !erroLeitura;
      if (alvo === 'vista-cartao' && e.item) {
        $('c-nome').textContent = e.item.nome;
        $('c-saldo').textContent = `Saldo no estoque: ${e.item.qtd} ${e.item.unidade}`;
        $('c-qtd').textContent = String(e.qtd);
        $('c-unidade').textContent = e.item.unidade;
        $('msg-cartao').textContent = e.mensagem;
        const gravando = e.fase === 'gravando';
        ['btn-menos', 'btn-mais', 'btn-baixa', 'btn-cancelar'].forEach(id => { $(id).disabled = gravando; });
        $('btn-baixa').textContent = gravando ? 'Gravando…' : 'Dar baixa';
      }
      if (alvo === 'vista-feito') {
        $('f-nome').textContent = e.item ? e.item.nome : '';
        $('f-saldo').textContent = e.depois === null ? 'Baixa registrada.' : `Saldo agora: ${e.depois} ${e.item ? e.item.unidade : ''}`;
      }
      if (e.fase === 'lendo') camera.retomar(); else camera.pausar();   // erro: leitura pausada até "Ler outro"
      win.scrollTo && win.scrollTo(0, 0);
    }

    async function lerEDesenhar(texto) {
      await fluxo.lerCodigo(texto);
      desenhar();
    }

    // ---------- câmera (jsQR) ----------
    const camera = (function () {
      const video = $('video'), quadro = $('quadro');
      let stream = null, varrendo = false, quer = false;
      const nav = win.navigator || {};
      const possivel = !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && win.isSecureContext !== false && typeof win.jsQR === 'function');

      function semCamera(motivo) {
        quer = false;
        $('area-camera').hidden = true;
        $('msg-camera').textContent = motivo + ' Digite o código da etiqueta.';
        $('msg-camera').hidden = false;
      }
      function parar() {
        varrendo = false;
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        if (video) video.srcObject = null;
      }
      function laco() {
        if (!varrendo || !stream) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const esc = Math.min(1, 640 / video.videoWidth);
          quadro.width = Math.round(video.videoWidth * esc);
          quadro.height = Math.round(video.videoHeight * esc);
          const ctx = quadro.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, quadro.width, quadro.height);
          const texto = lerQr(ctx.getImageData(0, 0, quadro.width, quadro.height), win.jsQR);
          if (texto) {
            varrendo = false;   // pausa ao ler; desenhar() retoma se a fase voltar a 'lendo'
            lerEDesenhar(texto);
            return;
          }
        }
        win.requestAnimationFrame(laco);
      }
      async function ligar() {
        if (!possivel) { semCamera(win.isSecureContext === false ? 'A câmera só funciona em conexão segura (HTTPS).' : 'Câmera indisponível neste aparelho.'); return; }
        if (stream) return;
        try {
          stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        } catch { semCamera('Não foi possível usar a câmera (sem permissão ou sem câmera).'); return; }
        if (!quer || doc.visibilityState === 'hidden') { parar(); return; }
        video.srcObject = stream;
        try { await video.play(); } catch { /* o laço espera o vídeo ficar pronto */ }
        varrendo = true;
        win.requestAnimationFrame(laco);
      }
      return {
        retomar() { quer = true; if (!possivel) { ligar(); return; } if (stream && !varrendo) { varrendo = true; win.requestAnimationFrame(laco); } else if (!stream) ligar(); },
        pausar() { varrendo = false; },
        desligar() { quer = false; parar(); },
        religar() { quer = true; if (e.fase === 'lendo') ligar(); }
      };
    })();

    // ---------- eventos ----------
    $('form-codigo').addEventListener('submit', ev => {
      ev.preventDefault();
      const campo = $('codigo-manual');
      const texto = campo.value;
      campo.value = '';
      lerEDesenhar(texto);
    });
    $('btn-mais').addEventListener('click', () => { fluxo.mudarQtd(1); desenhar(); });
    $('btn-menos').addEventListener('click', () => { fluxo.mudarQtd(-1); desenhar(); });
    $('btn-baixa').addEventListener('click', () => {
      const p = fluxo.confirmar();   // a fase vira 'gravando' na hora: um segundo toque é ignorado
      desenhar();
      p.then(desenhar);
    });
    ['btn-cancelar', 'btn-tentar-outra', 'btn-proximo'].forEach(id => $(id).addEventListener('click', () => { fluxo.cancelar(); desenhar(); }));

    // desliga as faixas do vídeo ao sair da página ou ocultar a aba
    win.addEventListener('pagehide', () => camera.desligar());
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') camera.desligar(); else camera.religar(); });

    // ---------- sair e link para o sistema ----------
    $('btn-sair').addEventListener('click', () => {
      try {
        const a = JSON.parse(win.localStorage.getItem('auth') || 'null');
        if (a && a.token) win.fetch(C.API_BASE + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + a.token }, keepalive: true }).catch(() => {});
      } catch { /* a saída segue */ }
      camera.desligar();
      win.localStorage.removeItem('auth');
      win.location.href = C.LOGIN_URL;
    });
    const outra = win.Acesso && win.Acesso.primeiraPagina ? win.Acesso.primeiraPagina() : null;
    if (outra && outra !== 'baixa_qr.html') { $('link-sistema').setAttribute('href', outra); $('link-sistema').hidden = false; }

    desenhar();
  }

  return { ajustarQtd, novaChave, dataLocal, corpoDaBaixa, mensagemDeErro, criarFluxo, lerQr, iniciar };
});
