// "Ver desenho" do menu do botão direito do Pedido: abre o PDF do desenho (SketchUp) que está na pasta de rede da empresa.
// Só o serviço local do PC (127.0.0.1:3917, local/desenhos.js) enxerga essa pasta: a tela pergunta a ele quais arquivos existem para o
// número do pedido (GET /desenhos?numero=) e abre o escolhido numa aba (GET /desenhos/arquivo?nome=). Com mais de um arquivo (22125(1).pdf,
// 22125(2).pdf...) abre uma janela para escolher, o mais recente primeiro. Sem o serviço local não há plano B: o servidor da API não alcança a pasta.
// DesenhoPedido.ver(numero)
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';
  const SEM_SERVICO = 'Não consegui falar com o serviço local deste PC (porta 3917), que é quem enxerga a pasta dos desenhos. Abra o sistema no PC da empresa com o serviço ligado.';

  const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
  const urlArquivo = nome => `${LOCAL}/desenhos/arquivo?nome=${encodeURIComponent(nome)}`;
  const dataBR = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  async function listar(numero) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    let r;
    try { r = await fetch(`${LOCAL}/desenhos?numero=${encodeURIComponent(numero)}`, { signal: ctl.signal }); }
    catch { throw new Error(SEM_SERVICO); }
    finally { clearTimeout(t); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Erro ${r.status} no serviço local.`);
    return Array.isArray(d.arquivos) ? d.arquivos : [];
  }

  // janela de escolha (vários arquivos); fecha com Esc, clique fora ou "Fechar"
  function escolher(numero, arquivos) {
    const fundo = el('div', 'dp-fundo');
    const caixa = el('div', 'dp-caixa');
    caixa.setAttribute('role', 'dialog'); caixa.setAttribute('aria-modal', 'true'); caixa.setAttribute('aria-labelledby', 'dsn-titulo');
    caixa.style.maxWidth = '460px';
    const titulo = el('div', 'dp-titulo', 'Ver desenho'); titulo.id = 'dsn-titulo';
    const sub = el('div', 'dp-sub', `Pedido nº ${numero} · ${arquivos.length} desenhos encontrados (o mais recente primeiro).`);
    const lista = el('div'); lista.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto';
    const fechar = () => { document.removeEventListener('keydown', aoTecla, true); fundo.remove(); };
    const aoTecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    for (const a of arquivos) {
      const b = el('button', 'btn btn-secondary'); b.type = 'button'; b.style.cssText = 'text-align:left;display:block;width:100%';
      b.append(el('span', '', a.nome), el('small', '', dataBR(a.modificado) ? '  ·  ' + dataBR(a.modificado) : ''));
      b.addEventListener('click', () => { window.open(urlArquivo(a.nome), '_blank', 'noopener'); fechar(); });
      lista.append(b);
    }
    const acoes = el('div', 'dp-acoes');
    const fecha = el('button', 'btn btn-secondary', 'Fechar'); fecha.type = 'button'; fecha.addEventListener('click', fechar);
    acoes.append(fecha);
    caixa.append(titulo, sub, lista, acoes); fundo.append(caixa);
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });
    document.addEventListener('keydown', aoTecla, true);
    document.body.append(fundo);
    (lista.querySelector('button') || fecha).focus();
  }

  async function ver(numero) {
    const n = String(numero ?? '').trim();
    if (!/^\d{1,9}$/.test(n)) { alert('Número de pedido inválido.'); return; }
    try {
      const arquivos = await listar(n);
      if (!arquivos.length) { alert(`Não há desenho do pedido nº ${n} na pasta "Para conferir PDF".`); return; }
      if (arquivos.length === 1) { window.open(urlArquivo(arquivos[0].nome), '_blank', 'noopener'); return; }
      escolher(n, arquivos);
    } catch (err) { alert(err.message); }
  }

  window.DesenhoPedido = { ver, SEM_SERVICO };
})();
