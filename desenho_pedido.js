// "Ver desenho" do menu do botão direito do Pedido: abre o PDF do desenho (SketchUp) que está na pasta de rede da empresa.
// Só o serviço local do PC (127.0.0.1:3917, local/desenhos.js) enxerga essa pasta: a tela pergunta a ele quais arquivos existem para o
// número do pedido (GET /desenhos?numero=) e abre UMA aba: o PDF, se houver um só, ou a página /desenhos/ver com todos os desenhos
// empilhados (22125(1).pdf, 22125(2).pdf...). Uma aba só porque o navegador bloqueia a segunda aba aberta pelo mesmo clique.
// Sem o serviço local não há plano B: o servidor da API não alcança a pasta.
// DesenhoPedido.ver(numero)
(function () {
  'use strict';
  const LOCAL = 'http://127.0.0.1:3917';
  const SEM_SERVICO = 'Não consegui falar com o serviço local deste PC (porta 3917), que é quem enxerga a pasta dos desenhos. Abra o sistema no PC da empresa com o serviço ligado.';

  const urlArquivo = nome => `${LOCAL}/desenhos/arquivo?nome=${encodeURIComponent(nome)}`;
  const urlTodos = numero => `${LOCAL}/desenhos/ver?numero=${encodeURIComponent(numero)}`;

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

  async function ver(numero) {
    const n = String(numero ?? '').trim();
    if (!/^\d{1,9}$/.test(n)) { alert('Número de pedido inválido.'); return; }
    try {
      const arquivos = await listar(n);
      if (!arquivos.length) { alert(`Não há desenho do pedido nº ${n} na pasta "Para conferir PDF".`); return; }
      window.open(arquivos.length === 1 ? urlArquivo(arquivos[0].nome) : urlTodos(n), '_blank', 'noopener');
    } catch (err) { alert(err.message); }
  }

  window.DesenhoPedido = { ver, SEM_SERVICO };
})();
