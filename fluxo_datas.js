// Lançar o mesmo movimento em várias datas (tela financeiro.html, gaveta "Novo movimento", Entrada ou Saída).
// Forma, banco, valor, situação e demais dados são os dos campos de sempre; só a data muda (ex.: 3 boletos).
// A data 1 é o campo "Data" da gaveta; as demais ficam numa lista editável. Tudo vai de uma vez a POST /fluxo/salvar_datas (tudo ou nada).
// As contas (datas sugeridas, soma, texto) são puras e testadas no Node; o resto liga a tela.
// FluxoDatas.iniciar({ $, lerNumero, moeda, hojeISO, pode, getMovimento, divisaoAtiva }) → { reiniciar, atualizarVisibilidade, ativo, caminho, montarEnvio, conferir, recalcular, rotuloSalvar }
(function (raiz) {
  'use strict';
  const MIN_DATAS = 2;
  const MAX_DATAS = 24;
  const arred = n => Math.round((Number(n) || 0) * 100) / 100;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  // "mesmo dia nos meses seguintes": a data i (0 = a base) cai no mesmo dia, i meses depois; dia 31 num mês curto vira o último dia do mês
  function sugerirData(baseISO, i) {
    if (!ISO.test(baseISO || '')) return '';
    const [a, m, d] = baseISO.split('-').map(Number);
    const total = (m - 1) + i, ano = a + Math.floor(total / 12), mes = ((total % 12) + 12) % 12;
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
  }

  // quantidade digitada -> número inteiro dentro do limite (vazio/inválido = MIN_DATAS)
  function limitarQtd(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(MAX_DATAS, Math.max(MIN_DATAS, n)) : MIN_DATAS;
  }

  // "3 lançamentos de R$ 100,00 = total R$ 300,00"
  function textoResumo(qtd, valor, fmt) {
    return `${qtd} lançamentos de ${fmt(valor)} = total ${fmt(arred(qtd * (Number(valor) || 0)))}.`;
  }
  const rotuloSalvar = qtd => `💾 Salvar ${qtd} lançamentos`;

  const api = { MIN_DATAS, MAX_DATAS, sugerirData, limitarQtd, textoResumo, rotuloSalvar };

  function iniciar(d) {
    const { $, lerNumero, moeda } = d;
    const bloco = $('bloco-datas'), ligar = $('dt-ligar'), corpo = $('dt-corpo'), qtdEl = $('dt-qtd'), lista = $('dt-lista'), resumoEl = $('dt-resumo');
    const emEdicao = () => !!$('f-id').value;
    const extras = () => [...lista.querySelectorAll('.dt-data')];
    const ativo = () => !bloco.hidden && ligar.checked && extras().length + 1 >= MIN_DATAS;
    const baseISO = () => ($('f-data').value || d.hojeISO());

    // refaz a lista para `qtd` datas: mantém as que o usuário digitou, sugere as outras a partir da data 1
    function montarLista(qtd) {
      const atuais = extras();
      const novas = qtd - 1;
      while (extras().length > novas) lista.lastElementChild.remove();
      for (let i = extras().length; i < novas; i++) {
        const li = document.createElement('div');
        li.className = 'form-group';
        li.innerHTML = '<label></label><input type="date" class="dt-data">';
        li.querySelector('input').value = sugerirData(baseISO(), i + 1);
        lista.appendChild(li);
      }
      [...lista.children].forEach((li, i) => { li.querySelector('label').textContent = `Data ${i + 2}`; });
      return atuais;
    }

    function recalcular() {
      const ligado = !bloco.hidden && ligar.checked;
      corpo.hidden = !ligado;
      if (!ligado) return;
      montarLista(limitarQtd(qtdEl.value));
      resumoEl.textContent = textoResumo(extras().length + 1, lerNumero($('f-valor').value), moeda);
      if (!d.divisaoAtiva()) $('btn-salvar').textContent = rotuloSalvar(extras().length + 1);
    }

    function reiniciar() {
      ligar.checked = false; qtdEl.value = '3'; lista.innerHTML = ''; corpo.hidden = true; resumoEl.textContent = '';
    }

    // só no Novo movimento (não ao editar) e com o tipo já escolhido
    function atualizarVisibilidade() {
      const pode = d.pode('financeiro.lancar') && !emEdicao() && !!d.getMovimento();
      bloco.hidden = !pode;
      if (!pode && ligar.checked) reiniciar();
      recalcular();
    }

    // a data 1 mudou: as datas sugeridas acompanham (as que o usuário alterou à mão ficam como estão)
    function aoMudarData1() {
      if (!ativo()) return;
      extras().forEach((el, i) => { if (el.dataset.manual !== '1') el.value = sugerirData(baseISO(), i + 1); });
    }

    function todasDatas() { return [$('f-data').value, ...extras().map(e => e.value)]; }

    function montarEnvio(comum) {
      return {
        movimento: d.getMovimento(), nome: comum.nome, pedido: comum.pedido, pdv: comum.pdv, preNota: comum.preNota, notaFiscal: comum.notaFiscal,
        observacao: comum.observacao, codClassificacao: comum.codClassificacao,
        formaPgto: $('f-forma').value.trim(), banco: $('f-banco').value.trim(), valor: lerNumero($('f-valor').value), situacao: $('f-situacao').value,
        datas: todasDatas()
      };
    }

    // devolve a mensagem do primeiro problema ou ''
    function conferir() {
      if (d.divisaoAtiva()) return 'Escolha: dividir em formas de pagamento OU lançar em várias datas, não os dois ao mesmo tempo.';
      const datas = todasDatas();
      for (let i = 0; i < datas.length; i++) if (!ISO.test(datas[i] || '')) return `Data ${i + 1}: favor inserir uma data válida!`;
      return '';
    }

    ligar.addEventListener('change', () => { recalcular(); });
    qtdEl.addEventListener('input', recalcular);
    qtdEl.addEventListener('blur', () => { qtdEl.value = String(limitarQtd(qtdEl.value)); recalcular(); });
    lista.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('dt-data')) e.target.dataset.manual = '1'; });
    $('f-data').addEventListener('input', aoMudarData1);
    $('f-data').addEventListener('change', aoMudarData1);
    ['f-valor', 'f-situacao'].forEach(id => $(id).addEventListener('input', recalcular));
    $('f-valor').addEventListener('blur', recalcular);

    return { reiniciar, atualizarVisibilidade, ativo, caminho: () => '/fluxo/salvar_datas', montarEnvio, conferir, recalcular, rotuloSalvar };
  }

  api.iniciar = iniciar;
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FluxoDatas = api;
})(typeof window !== 'undefined' ? window : globalThis);
