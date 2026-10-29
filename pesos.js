// ==========================================================================
// pesos.html — cadastro de peso por produto (tabela da web web_pesos).
// Rotas: GET /pesos, GET /pesos/produtos?tipo=, PUT /pesos, DELETE /pesos/:id.
// Funções puras testadas no Node (test/pesos_tela.test.js); o desenho da tela fica no fim (só no navegador).
// Dado vindo da API só entra na tela por esc() ou value/textContent. Peso não é dinheiro: não depende de valores.ver.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Pesos = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const { esc, txt } = C;

  const ROTULO_TIPO = { perfil: 'Perfil / divisor', puxador: 'Puxador', vidro: 'Vidro', acessorio: 'Acessório' };
  const ROTULO_UNIDADE = { kg_m: 'kg/m', kg_m2_mm: 'kg/m²/mm', kg_un: 'kg/un' };
  const ROTULO_CONFIANCA = { alta: 'alta', media: 'média', baixa: 'baixa' };
  // unidades por tipo (o servidor decide; esta cópia só serve de padrão antes da lista chegar)
  const UNIDADES_PADRAO = { perfil: ['kg_m'], puxador: ['kg_m'], vidro: ['kg_m2_mm'], acessorio: ['kg_un', 'kg_m'] };
  const ORIGENS_ESCOLHA = ['pesado', 'fornecedor', 'manual'];

  // "1.500" (milhar ou decimal?) é ambíguo e recusado, como no servidor
  const numero = v => /^\d+([.,]\d+)?$/.test(txt(v)) && !/^\d{1,3}(\.\d{3})+$/.test(txt(v)) ? Number(txt(v).replace(',', '.')) : NaN;
  const paraTela = n => String(n ?? '').replace('.', ',');   // o brasileiro lê e digita a vírgula
  const rotuloUnidade = u => ROTULO_UNIDADE[u] || txt(u);

  // selo da origem: o valor estimado pelo desenho aparece como "estimado" (com a confiança); os demais pelo nome
  function seloOrigem(origem, confianca) {
    if (origem === 'estimado_desenho') return { texto: 'estimado' + (ROTULO_CONFIANCA[confianca] ? ' (' + ROTULO_CONFIANCA[confianca] + ')' : ''), classe: 'estimado' };
    if (origem === 'pesado') return { texto: 'pesado', classe: 'ok' };
    if (origem === 'fornecedor') return { texto: 'fornecedor', classe: 'info' };
    return { texto: 'manual', classe: 'neutro' };
  }

  // espelha as regras do servidor (o servidor continua decidindo)
  function validarForm(f) {
    const erros = [];
    if (!txt(f.tipo)) erros.push('Escolha o tipo.');
    if (!txt(f.produto)) erros.push('Informe o produto.');
    if (!txt(f.unidadePeso)) erros.push('Escolha a unidade do peso.');
    const n = numero(f.kgPorUnidade);
    if (!(n > 0)) erros.push('Informe o peso (número maior que zero, com vírgula ou ponto).');
    return erros;
  }
  // Origem a gravar. Estimativa só fica como estimativa se a pessoa NÃO mudou o valor nem a unidade
  // (salvar sem mexer não pode virar "pesado"); mexeu no valor = vale o seletor "Origem do valor" (padrão pesado).
  function origemParaSalvar(f, atual) {
    if (atual && atual.origem === 'estimado_desenho' && numero(f.kgPorUnidade) === Number(atual.kgPorUnidade) && txt(f.unidadePeso) === atual.unidadePeso)
      return { origem: 'estimado_desenho', confianca: txt(atual.confianca) };
    return { origem: ORIGENS_ESCOLHA.includes(txt(f.origem)) ? txt(f.origem) : 'pesado', confianca: '' };
  }
  function corpoSalvar(f, atual) {
    return { tipo: txt(f.tipo), produto: txt(f.produto), unidadePeso: txt(f.unidadePeso), kgPorUnidade: txt(f.kgPorUnidade), ...origemParaSalvar(f, atual) };
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const estado = { lista: [], tipo: '', busca: '', atual: null, ocupado: false, temporizador: null, unidadesPorTipo: UNIDADES_PADRAO, tipos: Object.keys(ROTULO_TIPO) };
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const podeEditar = () => !!(win.Acesso && win.Acesso.pode('pesos.editar'));
    const opcoes = (el, itens, rotulo) => { el.innerHTML = itens.map(i => `<option value="${esc(i)}">${esc(rotulo(i))}</option>`).join(''); };

    async function carregar() {
      const q = new win.URLSearchParams();
      if (estado.tipo) q.set('tipo', estado.tipo);
      if (estado.busca) q.set('q', estado.busca);
      try {
        const d = await chamar('/pesos' + (q.toString() ? '?' + q : ''));
        if (Array.isArray(d.tipos)) estado.tipos = d.tipos;
        if (d.unidadesPorTipo) estado.unidadesPorTipo = d.unidadesPorTipo;
        estado.lista = Array.isArray(d.pesos) ? d.pesos : [];
        if (!$('filtro-tipo').options[1]) {
          $('filtro-tipo').innerHTML = '<option value="">Todos os tipos</option>' + estado.tipos.map(t => `<option value="${esc(t)}">${esc(ROTULO_TIPO[t] || t)}</option>`).join('');
          opcoes($('p-tipo'), estado.tipos, t => ROTULO_TIPO[t] || t);
        }
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; }
      desenharLista();
    }
    function desenharLista() {
      const alvo = $('lista');
      $('qtd').textContent = estado.lista.length ? `${estado.lista.length} registro(s)` : '';
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhum peso cadastrado.</p>'; return; }
      alvo.innerHTML = '<table><thead><tr><th>Tipo</th><th>Produto</th><th class="num">Peso</th><th>Origem</th></tr></thead><tbody>' +
        estado.lista.map(p => {
          const s = seloOrigem(p.origem, p.confianca);
          return `<tr data-id="${esc(p.id)}"${estado.atual && estado.atual.id === p.id ? ' class="selecionado"' : ''}>` +
            `<td>${esc(ROTULO_TIPO[p.tipo] || p.tipo)}</td><td><b>${esc(p.produto)}</b></td>` +
            `<td class="num">${esc(paraTela(p.kgPorUnidade))} <span class="cinza">${esc(rotuloUnidade(p.unidadePeso))}</span></td>` +
            `<td><span class="selo ${esc(s.classe)}">${esc(s.texto)}</span></td></tr>`;
        }).join('') + '</tbody></table>';
    }

    // ---------- formulário ----------
    function unidadesDoTipo(tipo) { return estado.unidadesPorTipo[tipo] || UNIDADES_PADRAO[tipo] || []; }
    function atualizarUnidades(escolhida) {
      const us = unidadesDoTipo($('p-tipo').value);
      opcoes($('p-unidade'), us, rotuloUnidade);
      if (escolhida && us.includes(escolhida)) $('p-unidade').value = escolhida;
    }
    async function atualizarSugestoes() {
      const tipo = $('p-tipo').value;
      $('p-produtos').innerHTML = '';
      if (estado.atual || !tipo) return;
      try {
        const d = await chamar('/pesos/produtos?tipo=' + encodeURIComponent(tipo));
        if ($('p-tipo').value !== tipo || estado.atual) return;   // a pessoa mudou de tipo/registro enquanto carregava
        $('p-produtos').innerHTML = (d.produtos || []).filter(p => !p.cadastrado).map(p => `<option value="${esc(p.nome)}"></option>`).join('');
      } catch (err) { toast(err.message, 'erro'); }
    }
    function travarForm() {
      const ok = podeEditar();
      doc.querySelectorAll('#form input, #form select').forEach(el => { el.disabled = !ok; });
      // tipo e produto são a chave do cadastro: ao editar não mudam (para outro produto, cadastre um novo)
      if (estado.atual) { $('p-tipo').disabled = true; $('p-produto').disabled = true; }
      $('btn-excluir').hidden = !ok || !estado.atual;
    }
    function mostrarForm(p) {
      estado.atual = p;
      $('vazio-painel').hidden = true; $('form').hidden = false;
      $('titulo-form').textContent = p ? p.produto : 'Novo peso';
      $('p-tipo').value = p ? p.tipo : (estado.tipo || estado.tipos[0]);
      atualizarUnidades(p ? p.unidadePeso : '');
      $('p-produto').value = p ? p.produto : '';
      $('p-valor').value = p ? paraTela(p.kgPorUnidade) : '';
      $('p-origem').value = p && ORIGENS_ESCOLHA.includes(p.origem) ? p.origem : 'pesado';
      const aviso = $('aviso-estimado');
      if (p && p.origem === 'estimado_desenho') {
        aviso.hidden = false;
        aviso.textContent = 'Valor estimado pelo desenho técnico' + (ROTULO_CONFIANCA[p.confianca] ? ` (confiança ${ROTULO_CONFIANCA[p.confianca]})` : '') + '. Ao digitar um valor novo, ele passa a valer como a origem escolhida abaixo.';
      } else { aviso.hidden = true; aviso.textContent = ''; }
      $('erro-form').textContent = '';
      travarForm();
      atualizarSugestoes();
      desenharLista();
    }
    function abrir(id) {
      const p = estado.lista.find(x => String(x.id) === String(id));
      if (p) mostrarForm(p);
    }
    const lerForm = () => ({ tipo: $('p-tipo').value, produto: $('p-produto').value, unidadePeso: $('p-unidade').value, kgPorUnidade: $('p-valor').value, origem: $('p-origem').value });

    async function salvar(ev) {
      ev.preventDefault();
      if (estado.ocupado) return;
      const f = lerForm();
      const erros = validarForm(f);
      $('erro-form').textContent = erros.join(' ');
      if (erros.length) return;
      estado.ocupado = true; $('btn-salvar').disabled = true;
      try {
        const r = await chamar('/pesos', { metodo: 'PUT', corpo: corpoSalvar(f, estado.atual) });
        toast(r.criado ? 'Peso cadastrado.' : 'Peso atualizado.', 'ok');
        await carregar();
        abrir(r.id);
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; $('btn-salvar').disabled = false; }
    }
    async function excluir() {
      if (!estado.atual || estado.ocupado) return;
      if (!win.confirm(`Tem certeza que deseja excluir o peso de "${estado.atual.produto}"?`)) return;
      estado.ocupado = true;
      try {
        await chamar('/pesos/' + encodeURIComponent(estado.atual.id), { metodo: 'DELETE' });
        toast('Peso excluído.', 'ok');
        estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false;
        await carregar();
      } catch (err) { $('erro-form').textContent = err.message; }
      finally { estado.ocupado = false; }
    }

    // ---------- eventos ----------
    $('lista').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) abrir(tr.getAttribute('data-id')); });
    $('busca').addEventListener('input', ev => {
      estado.busca = ev.target.value.trim();
      win.clearTimeout(estado.temporizador);
      estado.temporizador = win.setTimeout(carregar, 250);
    });
    $('filtro-tipo').addEventListener('change', ev => { estado.tipo = ev.target.value; carregar(); });
    $('p-tipo').addEventListener('change', () => { atualizarUnidades(''); atualizarSugestoes(); });
    $('btn-novo').addEventListener('click', () => mostrarForm(null));
    $('form').addEventListener('submit', salvar);
    $('btn-excluir').addEventListener('click', excluir);
    $('btn-cancelar').addEventListener('click', () => { estado.atual = null; $('form').hidden = true; $('vazio-painel').hidden = false; desenharLista(); });
    carregar();
  }

  return { ROTULO_TIPO, ROTULO_UNIDADE, ORIGENS_ESCOLHA, numero, paraTela, rotuloUnidade, seloOrigem, validarForm, origemParaSalvar, corpoSalvar, iniciar };
});
