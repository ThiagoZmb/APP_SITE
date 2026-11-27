// ==========================================================================
// epis.html — EPIs: registrar entrega, histórico (com a foto da ficha assinada), estoque e resumo.
// Rotas: /epis, /epis/funcionarios, /epis/entregas (+ cancelar e foto), /epis/:id (+ entrada) e /epis/resumo.
// Quem decide permissões e estoque é o servidor. Dado vindo da API só entra na tela por esc() ou value/textContent.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.Epis = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const SIT = typeof module === 'object' && module.exports ? require('./situacoes.js') : raiz.Situacoes;
  const { esc, txt, dataBR, dataHoraBR } = C;
  const MAX_FOTOS = 6;

  const diasAtras = (hoje, dias) => { const d = new Date(hoje + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); };
  const hojeLocal = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  function filtrarEntregas(lista, f, hoje) {
    const busca = txt(f.busca).toLowerCase();
    const desde = Number(f.dias) ? diasAtras(hoje, Number(f.dias)) : null;
    return lista.filter(e => (!f.funcionario || String(e.funcionarioCodigo) === String(f.funcionario))
      && (!f.epi || e.itens.some(i => String(i.epiId) === String(f.epi)))
      && (!desde || e.data >= desde)
      && (!f.semFoto || (!e.cancelada && !e.fotos.length))
      && (!busca || [e.funcionarioNome, e.observacao, dataBR(e.data), e.cancelada ? e.cancelada.motivo : '', ...e.itens.map(i => i.nome + ' ' + i.ca)].join(' ').toLowerCase().includes(busca)));
  }

  // CSV como no piloto: ; e BOM; texto que começaria uma fórmula na planilha ganha um apóstrofo na frente
  const celula = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function csvHistorico(lista, epiId) {
    const linhas = [['Data', 'Funcionário', 'EPI', 'C.A.', 'Qtd', 'Observação', 'Situação', 'Foto']];
    for (const e of lista) for (const i of e.itens) {
      if (epiId && String(i.epiId) !== String(epiId)) continue;
      linhas.push([dataBR(e.data), e.funcionarioNome, i.nome, i.ca, i.quantidade, e.observacao, e.cancelada ? 'Cancelada: ' + (e.cancelada.motivo || '') : 'Entregue', e.fotos.length ? 'Sim' : 'Não']);
    }
    return '﻿' + linhas.map(l => l.map(celula).join(';')).join('\r\n');
  }

  const botao = (ac, id, texto, cls = 'btn-secondary') => `<button type="button" class="btn ${cls} btn-mini" data-ac="${ac}" data-id="${esc(id)}">${texto}</button>`;
  const htmlItens = itens => itens.map(i => `<div><b>${esc(i.quantidade)}×</b> ${esc(i.nome)} <span class="cinza">C.A. ${esc(i.ca)}</span></div>`).join('');

  function htmlHistorico(lista, { registrar, gerir }) {
    if (!lista.length) return '<p class="vazio">Nenhuma entrega encontrada.</p>';
    return '<table><thead><tr><th>Data</th><th>Funcionário</th><th>EPIs</th><th>Observação</th><th>Assinatura</th><th>Ações</th></tr></thead><tbody>' + lista.map(e => {
      const n = e.fotos.length;
      const situacao = (e.cancelada ? '<span class="selo neutro">Cancelada</span> ' : '')
        + (n ? '<span class="selo ok">Assinado ✓</span>' : e.cancelada ? '<span class="cinza">sem foto</span>' : '<span class="selo aviso">Sem foto</span>');
      const acoes = (n ? botao('fotos', e.id, `Ver fotos (${n})`) : '')
        + (!e.cancelada && registrar && n < MAX_FOTOS ? botao('fotografar', e.id, 'Fotografar') + botao('anexar', e.id, 'Anexar') : '')
        + (!e.cancelada && gerir ? botao('cancelar', e.id, 'Cancelar', 'btn-perigo') : '');
      return `<tr${e.cancelada ? ' class="inativo"' : ''}><td data-rot="Data">${esc(dataBR(e.data))}</td><td class="quebra" data-rot="Funcionário"><b>${esc(e.funcionarioNome)}</b><div class="cinza">por ${esc(e.criadoPor)}</div></td>`
        + `<td class="quebra" data-rot="EPIs">${htmlItens(e.itens)}</td><td class="quebra"${e.observacao || e.cancelada ? ' data-rot="Observação"' : ''}>${esc(e.observacao)}${e.cancelada ? `<div class="motivo">Cancelada por ${esc(e.cancelada.por)}: ${esc(e.cancelada.motivo)}</div>` : ''}</td>`
        + `<td data-rot="Assinatura">${situacao}</td><td class="quebra"><div class="botoes">${acoes}</div></td></tr>`;
    }).join('') + '</tbody></table>';
  }

  function htmlEstoque(epis, { gerir }) {
    if (!epis.length) return '<p class="vazio">Nenhum EPI cadastrado.</p>';
    return `<table><thead><tr><th>EPI</th><th>C.A.</th><th class="num">Em estoque</th><th class="num">Mínimo</th><th class="num">Dura (est.)</th>${gerir ? '<th>Entrada</th><th></th>' : ''}</tr></thead><tbody>` + epis.map(e =>
      `<tr${e.ativo ? '' : ' class="inativo"'}><td class="quebra" data-rot="EPI">${esc(e.nome)}${e.ativo ? '' : ' ' + SIT.selo('cadastro', 'Inativo')}</td><td data-rot="C.A.">${esc(e.ca)}</td>`
      + `<td class="num" data-rot="Em estoque"><b${e.baixo ? ' class="baixo"' : ''}>${esc(e.qtdEstoque)}</b>${e.baixo ? ' <span class="selo aviso">baixo</span>' : ''}</td><td class="num" data-rot="Mínimo">${esc(e.minimo)}</td>`
      + `<td class="num" data-rot="Dura (est.)">${e.duraDias === null ? '—' : esc(e.duraDias) + ' dias'}</td>`
      + (gerir ? `<td>${e.ativo ? `<span class="entrada-epi"><input type="number" min="1" step="1" inputmode="numeric" class="campo curto" id="in-${esc(e.id)}" placeholder="Qtd" aria-label="Quantidade da entrada de ${esc(e.nome)}">${botao('entrada', e.id, '+ Entrada')}</span>` : ''}</td>`
        + `<td><div class="botoes">${botao('editar', e.id, 'Editar')}${botao('ativo', e.id, e.ativo ? 'Desativar' : 'Reativar')}</div></td>` : '')
      + '</tr>').join('') + '</tbody></table>';
  }

  function htmlResumo(r) {
    const cartao = (n, rotulo, cls = '') => `<div class="cartao"><span>${rotulo}</span><b class="${cls}">${esc(n)}</b></div>`;
    const barras = (linhas, vazio) => {
      const max = Math.max(1, ...linhas.map(l => l.qtd));
      return linhas.length ? linhas.map(l => `<div class="hb"><span class="hb-nome" title="${esc(l.nome)}">${esc(l.nome)}</span><div class="hb-trilho"><i${l.baixo ? ' class="baixo"' : ''} style="width:${Math.max(0, Number(l.qtd) / max * 100)}%"></i></div><b>${esc(l.qtd)}</b></div>`).join('') : `<p class="cinza">${vazio}</p>`;
    };
    const maxMes = Math.max(1, ...r.porMes.map(m => m.qtd));
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `<div class="cartoes">${cartao(r.qtdUnidades, 'Unidades entregues (total)')}${cartao(r.qtdUltimos30, 'Unidades nos últimos 30 dias')}${cartao(r.qtdFuncionarios, 'Funcionários ativos')}${cartao(r.baixos.length, 'EPIs com estoque baixo', r.baixos.length ? 'baixo' : '')}</div>`
      + (r.baixos.length ? `<p class="aviso-pendente"><b>Atenção:</b> estoque no mínimo ou abaixo em ${r.baixos.map(esc).join(', ')}.</p>` : '')
      + `<h3>Entregas por mês (unidades, últimos 6 meses)</h3><div class="vb">${r.porMes.map(m => `<div><b>${esc(m.qtd)}</b><i style="height:${m.qtd / maxMes * 120}px"></i><span>${MESES[Number(m.mes.slice(5)) - 1]}</span></div>`).join('')}</div>`
      + `<h3>Por funcionário (top 6)</h3>${barras(r.porFuncionario, 'Sem entregas ainda.')}`
      + `<h3>Por EPI (top 6)</h3>${barras(r.porEpi, 'Sem entregas ainda.')}`
      + `<h3>Estoque atual por EPI (amarelo = no mínimo ou abaixo)</h3>${barras(r.estoque, 'Cadastre os EPIs na aba Estoque.')}`;
  }

  // chave de idempotência por conteúdo: reenviar o mesmo conteúdo (rede caiu) repete a chave; depois do sucesso, `usar` a descarta
  function criarChaves(nova) {
    const m = new Map();
    return {
      de(conteudo) { if (!m.has(conteudo)) m.set(conteudo, nova()); return m.get(conteudo); },
      usar(conteudo) { m.delete(conteudo); }
    };
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const pode = p => !!(win.Acesso && win.Acesso.pode(p));
    const Camera = win.CameraCaptura;
    const chaves = criarChaves(() => Camera.novaChave(win));
    const estado = { epis: [], entregas: [], funcionarios: [], aba: pode('epi.registrar') ? 'registrar' : 'historico', ocupado: false, resumoVelho: true, urls: [] };

    // ---------- carga ----------
    async function carregar() {
      estado.resumoVelho = true;
      try {
        const [a, b] = await Promise.all([chamar('/epis'), chamar('/epis/entregas')]);
        estado.epis = a.epis || []; estado.entregas = b.entregas || [];
      } catch (err) { toast(err.message, 'erro'); }
      desenhar();
    }
    async function carregarFuncionarios() {
      if (!pode('epi.registrar')) return;
      try { estado.funcionarios = (await chamar('/epis/funcionarios')).funcionarios || []; } catch (err) { toast(err.message, 'erro'); }
      const s = $('r-funcionario'), antes = s.value;
      s.innerHTML = '<option value="">Escolha o funcionário</option>' + estado.funcionarios.map(f => `<option value="${esc(f.codigo)}">${esc(f.nome)}</option>`).join('');
      s.value = antes;
    }
    async function carregarResumo() {
      estado.resumoVelho = false;
      try { $('resumo-corpo').innerHTML = htmlResumo(await chamar('/epis/resumo')); }
      catch (err) { estado.resumoVelho = true; $('resumo-corpo').innerHTML = '<p class="vazio">Não foi possível carregar o resumo.</p>'; toast(err.message, 'erro'); }
    }

    // ---------- desenho ----------
    const permissoes = () => ({ registrar: pode('epi.registrar'), gerir: pode('epi.gerir') });
    function desenhar() {
      const baixos = estado.epis.filter(e => e.baixo).length;
      $('qtd-baixo').textContent = baixos || '';
      $('qtd-baixo').hidden = !baixos;
      doc.querySelectorAll('select[data-epi]').forEach(preencherEpis);
      desenharUltimas();
      desenharFiltros();
      desenharHistorico();
      desenharEstoque();
      if (estado.aba === 'resumo' && estado.resumoVelho) carregarResumo();
    }
    function abrirAba(aba) {
      estado.aba = aba;
      doc.querySelectorAll('[data-aba]').forEach(b => { const on = b.dataset.aba === aba; b.classList.toggle('ativa', on); b.setAttribute('aria-selected', String(on)); });
      for (const nome of ['registrar', 'historico', 'estoque', 'resumo']) $('aba-' + nome).hidden = nome !== aba;
      if (aba === 'resumo' && estado.resumoVelho) carregarResumo();
    }
    function preencherEpis(s) {
      const antes = s.value;
      s.innerHTML = '<option value="">Escolha o EPI</option>' + estado.epis.filter(e => e.ativo)
        .map(e => `<option value="${esc(e.id)}">${esc(e.nome)} – C.A. ${esc(e.ca)} (estoque: ${esc(e.qtdEstoque)})</option>`).join('');
      s.value = antes;
    }
    function novaLinha() {
      const li = doc.createElement('div');
      li.className = 'epi-linha';
      li.innerHTML = '<select class="campo" data-epi aria-label="EPI"></select><input class="campo" type="number" min="1" step="1" value="1" inputmode="numeric" data-qtd aria-label="Quantidade">'
        + '<button type="button" class="btn btn-secondary btn-mini" data-tirar aria-label="Tirar esta linha">✕</button>';
      $('r-itens').appendChild(li);
      preencherEpis(li.querySelector('select'));
    }
    function desenharUltimas() {
      $('r-ultimas').innerHTML = htmlHistorico(estado.entregas.slice().sort((a, b) => b.id - a.id).slice(0, 8), permissoes());
    }
    function desenharFiltros() {
      const opcoes = (id, todos, mapa) => {
        const s = $(id), antes = s.value;
        s.innerHTML = `<option value="">${todos}</option>` + [...mapa].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
        s.value = antes;
      };
      opcoes('h-funcionario', 'Todos os funcionários', new Map(estado.entregas.map(e => [e.funcionarioCodigo, e.funcionarioNome])));
      opcoes('h-epi', 'Todos os EPIs', new Map(estado.entregas.flatMap(e => e.itens.map(i => [i.epiId, i.nome]))));
    }
    const filtradas = () => filtrarEntregas(estado.entregas, { funcionario: $('h-funcionario').value, epi: $('h-epi').value, dias: Number($('h-periodo').value),
      semFoto: $('h-semfoto').checked, busca: $('h-busca').value }, hojeLocal());
    function desenharHistorico() {
      const l = filtradas();
      $('h-qtd').textContent = `${l.length} entrega(s)`;
      $('h-lista').innerHTML = htmlHistorico(l, permissoes());
    }
    function desenharEstoque() {
      const busca = $('e-busca').value.trim().toLowerCase();
      // o que já foi digitado nas entradas não se perde ao redesenhar
      const digitado = new Map([...$('e-lista').querySelectorAll('input[id^="in-"]')].map(i => [i.id, i.value]));
      $('e-lista').innerHTML = htmlEstoque(estado.epis.filter(e => !busca || (e.nome + ' ' + e.ca).toLowerCase().includes(busca)), permissoes());
      for (const [id, v] of digitado) { const el = $(id); if (el) el.value = v; }
    }

    // um envio por vez (clique duplo não registra duas vezes)
    async function ocupado(fn) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      try { await fn(); } catch (err) { toast(err.message, 'erro'); }
      finally { estado.ocupado = false; }
    }

    // ---------- fotos ----------
    const lerImagem = arquivo => new Promise((ok, falha) => {
      const url = win.URL.createObjectURL(arquivo), i = new win.Image();
      i.onload = () => { win.URL.revokeObjectURL(url); ok(i); };
      i.onerror = () => { win.URL.revokeObjectURL(url); falha(new Error('Não foi possível ler a imagem.')); };
      i.src = url;
    });
    const enviarBlob = (id, blob, chave) => chamar(`/epis/entregas/${encodeURIComponent(id)}/foto?chave=${encodeURIComponent(chave)}`, { metodo: 'PUT', binario: blob, mime: 'image/jpeg' });
    // reduz no aparelho (JPEG até 1 MB) e envia, uma de cada vez; o mesmo arquivo reenviado após falha repete a chave
    async function enviarArquivos(id, arquivos) {
      let enviadas = 0;
      const erros = [];
      for (const arquivo of arquivos) {
        try {
          if (!/^image\//.test(arquivo.type || '')) throw new Error('Escolha uma imagem (foto).');
          const img = await lerImagem(arquivo);
          const blob = await Camera.reduzirParaCaber(img.naturalWidth, img.naturalHeight, (l, a, q) => new Promise(ok => {
            const c = doc.createElement('canvas'); c.width = l; c.height = a;
            const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, l, a); g.drawImage(img, 0, 0, l, a); // PNG transparente não vira preto
            c.toBlob(ok, 'image/jpeg', q);
          }));
          const conteudo = ['foto', id, arquivo.name, arquivo.size, arquivo.lastModified].join('|');
          await enviarBlob(id, blob, chaves.de(conteudo));
          chaves.usar(conteudo);
          enviadas++;
        } catch (err) { erros.push(`${arquivo.name || 'Foto'}: ${err.message}`); }
      }
      return { enviadas, erros };
    }
    function fotografar(id) {
      const e = estado.entregas.find(x => String(x.id) === String(id));
      if (!e || !Camera) return;
      Camera.capturar(win, {
        titulo: `Ficha assinada · ${e.funcionarioNome}`,
        enviar: (blob, chave) => enviarBlob(e.id, blob, chave),
        aoFechar: qtd => { if (qtd) { toast('Foto registrada.', 'ok'); carregar(); } }
      });
    }
    let anexarEm = null;
    function anexar(id) { anexarEm = id; $('arquivo-foto').value = ''; $('arquivo-foto').click(); }
    async function aoEscolherArquivos() {
      const id = anexarEm, arquivos = [...$('arquivo-foto').files];
      if (!id || !arquivos.length) return;
      await ocupado(async () => {
        const r = await enviarArquivos(id, arquivos);
        if (r.enviadas) toast(r.enviadas === 1 ? 'Foto registrada.' : `${r.enviadas} fotos registradas.`, 'ok');
        for (const m of r.erros) toast(m, 'erro');
        await carregar();
      });
    }

    function soltarUrls() { for (const u of estado.urls) win.URL.revokeObjectURL(u); estado.urls = []; }
    function verFotos(id) {
      const e = estado.entregas.find(x => String(x.id) === String(id));
      if (!e) return;
      soltarUrls();
      $('fotos-titulo').textContent = `${e.funcionarioNome} · ${dataBR(e.data)}`;
      const caixa = $('fotos-corpo');
      caixa.textContent = '';
      e.fotos.forEach((f, i) => {
        const figura = doc.createElement('figure');
        const img = doc.createElement('img');
        img.alt = `Foto ${i + 1} da ficha assinada`;
        const legenda = doc.createElement('figcaption');
        legenda.textContent = 'Carregando…';
        figura.append(img, legenda);
        if (pode('epi.gerir')) {
          const b = doc.createElement('button');
          b.type = 'button'; b.className = 'btn btn-perigo btn-mini'; b.textContent = 'Remover foto errada';
          b.addEventListener('click', () => {
            if (!win.confirm('Remover esta foto? Ela deixa de aparecer (o arquivo fica guardado e a ação é registrada).')) return;
            ocupado(async () => {
              await chamar(`/epis/entregas/${encodeURIComponent(e.id)}/foto/${encodeURIComponent(f.id)}`, { metodo: 'DELETE' });
              toast('Foto removida.', 'ok');
              $('dlg-fotos').close();
              await carregar();
            });
          });
          figura.appendChild(b);
        }
        caixa.appendChild(figura);
        // a foto só sai com o token no cabeçalho: baixa como blob e mostra por object URL
        chamar(`/epis/entregas/${encodeURIComponent(e.id)}/foto/${encodeURIComponent(f.id)}`, { blob: true }).then(blob => {
          const url = win.URL.createObjectURL(blob);
          estado.urls.push(url);
          img.src = url;
          legenda.textContent = `Foto ${i + 1} de ${e.fotos.length}`;
        }, err => { legenda.textContent = err.message; });
      });
      $('dlg-fotos').showModal();
    }

    // ---------- ações ----------
    async function registrar(ev) {
      ev.preventDefault();
      const itens = [...$('r-itens').querySelectorAll('.epi-linha')].map(l => ({ epiId: l.querySelector('select').value, quantidade: l.querySelector('[data-qtd]').value }));
      const corpo = { funcionarioCodigo: $('r-funcionario').value, data: $('r-data').value, observacao: $('r-obs').value.trim(), itens };
      const erro = !corpo.funcionarioCodigo ? 'Escolha o funcionário.' : !itens.length || itens.some(i => !i.epiId) ? 'Escolha o EPI em todas as linhas.'
        : itens.some(i => !/^[1-9]\d*$/.test(i.quantidade)) ? 'Quantidade inválida: use um número inteiro de 1 em diante.' : corpo.data > hojeLocal() ? 'A data da entrega não pode ser futura.' : '';
      $('r-erro').textContent = erro;
      if (erro) return;
      const arquivos = [...$('r-fotos').files].slice(0, MAX_FOTOS);
      await ocupado(async () => {
        $('r-salvar').disabled = true;
        try {
          const conteudo = 'entrega|' + JSON.stringify(corpo);
          const r = await chamar('/epis/entregas', { metodo: 'POST', corpo: { ...corpo, chave: chaves.de(conteudo) } });
          chaves.usar(conteudo);
          toast(r.repetido ? 'Essa entrega já tinha sido registrada.' : 'Entrega registrada.', 'ok');
          $('form-entrega').reset();
          $('r-data').value = hojeLocal();
          $('r-itens').textContent = '';
          novaLinha();
          if (arquivos.length) {
            const f = await enviarArquivos(r.entregaId, arquivos);
            if (f.erros.length) toast('A entrega foi registrada, mas há foto não enviada. Anexe pelo Histórico. ' + f.erros.join(' '), 'erro');
          }
        } catch (err) { $('r-erro').textContent = err.message; }
        finally { $('r-salvar').disabled = false; }
        await carregar();
      });
    }

    function darEntrada(id) {
      const campo = $('in-' + id), qtd = campo ? campo.value : '';
      if (!/^[1-9]\d*$/.test(qtd)) { toast('Informe a quantidade da entrada (número inteiro).', 'erro'); return; }
      ocupado(async () => {
        const conteudo = `entrada|${id}|${qtd}`;
        await chamar(`/epis/${encodeURIComponent(id)}/entrada`, { metodo: 'POST', corpo: { quantidade: qtd, chave: chaves.de(conteudo) } });
        chaves.usar(conteudo);
        campo.value = '';
        toast('Entrada registrada.', 'ok');
        await carregar();
      });
    }
    function novoEpi(ev) {
      ev.preventDefault();
      ocupado(async () => {
        await chamar('/epis', { metodo: 'POST', corpo: { nome: $('n-nome').value.trim(), ca: $('n-ca').value.trim(), estoqueInicial: $('n-inicial').value, minimo: $('n-minimo').value } });
        toast('EPI cadastrado.', 'ok');
        $('form-epi').reset();
        await carregar();
      });
    }
    let editando = null;
    function editar(id) {
      editando = estado.epis.find(x => String(x.id) === String(id));
      if (!editando) return;
      $('ed-nome').value = editando.nome; $('ed-ca').value = editando.ca; $('ed-minimo').value = editando.minimo; $('ed-erro').textContent = '';
      $('dlg-editar').showModal();
    }
    function salvarEdicao(ev) {
      ev.preventDefault();
      ocupado(async () => {
        try {
          await chamar(`/epis/${encodeURIComponent(editando.id)}`, { metodo: 'PUT', corpo: { nome: $('ed-nome').value.trim(), ca: $('ed-ca').value.trim(), minimo: $('ed-minimo').value } });
        } catch (err) { $('ed-erro').textContent = err.message; return; }
        $('dlg-editar').close();
        toast('EPI atualizado.', 'ok');
        await carregar();
      });
    }
    function alternarAtivo(id) {
      const e = estado.epis.find(x => String(x.id) === String(id));
      if (!e || (e.ativo && !win.confirm(`Desativar "${e.nome}"? Ele sai das novas entregas; o histórico fica.`))) return;
      ocupado(async () => {
        await chamar(`/epis/${encodeURIComponent(e.id)}`, { metodo: 'PUT', corpo: { nome: e.nome, ca: e.ca, minimo: e.minimo, ativo: !e.ativo } });
        toast(e.ativo ? 'EPI desativado.' : 'EPI reativado.', 'ok');
        await carregar();
      });
    }
    let cancelando = null;
    function cancelar(id) {
      cancelando = estado.entregas.find(x => String(x.id) === String(id));
      if (!cancelando) return;
      $('c-quem').textContent = `${cancelando.funcionarioNome} · ${dataBR(cancelando.data)} (registrada em ${dataHoraBR(cancelando.criadoEm)})`;
      $('c-motivo').value = ''; $('c-erro').textContent = '';
      $('dlg-cancelar').showModal();
    }
    function confirmarCancelamento(ev) {
      ev.preventDefault();
      const motivo = $('c-motivo').value.trim();
      if (!motivo) { $('c-erro').textContent = 'Informe o motivo do cancelamento.'; return; }
      ocupado(async () => {
        try { await chamar(`/epis/entregas/${encodeURIComponent(cancelando.id)}/cancelar`, { metodo: 'POST', corpo: { motivo } }); }
        catch (err) { $('c-erro').textContent = err.message; return; }
        $('dlg-cancelar').close();
        toast('Entrega cancelada. As unidades voltaram ao estoque.', 'ok');
        await carregar();
      });
    }
    function exportar() {
      const a = doc.createElement('a');
      a.href = win.URL.createObjectURL(new win.Blob([csvHistorico(filtradas(), $('h-epi').value)], { type: 'text/csv;charset=utf-8' }));
      a.download = 'historico-epis.csv';
      doc.body.appendChild(a); a.click(); a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(a.href), 1000);
    }

    // ---------- eventos ----------
    const ACOES = { fotos: verFotos, fotografar, anexar, cancelar, entrada: darEntrada, editar, ativo: alternarAtivo };
    doc.querySelector('main').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.aba) abrirAba(b.dataset.aba);
      else if (b.dataset.ac && ACOES[b.dataset.ac]) ACOES[b.dataset.ac](b.dataset.id);
      else if (b.hasAttribute('data-tirar') && $('r-itens').children.length > 1) b.parentElement.remove();
    });
    doc.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    $('dlg-fotos').addEventListener('close', soltarUrls);
    $('form-entrega').addEventListener('submit', registrar);
    $('r-mais').addEventListener('click', novaLinha);
    $('form-epi').addEventListener('submit', novoEpi);
    $('form-editar').addEventListener('submit', salvarEdicao);
    $('form-cancelar').addEventListener('submit', confirmarCancelamento);
    $('arquivo-foto').addEventListener('change', aoEscolherArquivos);
    for (const id of ['h-funcionario', 'h-epi', 'h-periodo', 'h-semfoto']) $(id).addEventListener('change', desenharHistorico);
    $('h-busca').addEventListener('input', desenharHistorico);
    $('h-csv').addEventListener('click', exportar);
    $('e-busca').addEventListener('input', desenharEstoque);
    // o Resumo fica atrás do olho: ao fechar o olho a aba some, então volta para a primeira
    if (win.OlhoResumos) win.OlhoResumos.aoMudar(visivel => { if (!visivel && estado.aba === 'resumo') abrirAba(pode('epi.registrar') ? 'registrar' : 'historico'); });

    $('r-data').value = hojeLocal();
    $('r-data').max = hojeLocal();
    novaLinha();
    abrirAba(estado.aba);
    carregarFuncionarios();
    carregar();
  }

  return { filtrarEntregas, csvHistorico, htmlHistorico, htmlEstoque, htmlResumo, criarChaves, iniciar };
});
