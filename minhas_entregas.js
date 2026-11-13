// ==========================================================================
// minhas_entregas.html — tela do MOTORISTA do módulo Entregas (celular).
// Rotas: GET /minhas_entregas?dia=, GET /minhas_entregas/:id, POST /minhas_entregas/:id/{saiu,baixa,ocorrencia},
// PUT /minhas_entregas/:id/anexo?tipo=foto|assinatura (binário). Tudo isolado por motorista no servidor.
// Aqui ficam as funções puras (testadas no Node, test/minhas_entregas_tela.test.js) e, no fim, o desenho da tela (só no navegador).
// Dado vindo da API só entra na tela por esc() ou textContent. Nenhum valor em dinheiro passa por aqui.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.MinhasEntregas = lib;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => lib.iniciar(raiz));
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';
  const C = typeof module === 'object' && module.exports ? require('./entregas_comum.js') : raiz.EntregasComum;
  const Sit = typeof module === 'object' && module.exports ? require('./situacoes.js') : raiz.Situacoes;
  const { esc, txt, dataBR, rotuloSequencia, rotuloItem } = C;

  // ============ LÓGICA PURA ============
  const ROTULO_STATUS = { agendada: 'Agendada', em_rota: 'Em rota', ocorrencia: 'Ocorrência', entregue: 'Entregue', cancelada: 'Cancelada' };
  const RESULTADOS = [
    { id: 'entregue', rotulo: 'Entregue' },
    { id: 'parcial', rotulo: 'Entrega parcial' },
    { id: 'ausente', rotulo: 'Cliente ausente' },
    { id: 'endereco_errado', rotulo: 'Endereço errado' },
    { id: 'recusa', rotulo: 'Recusa' }
  ];
  const OCORRENCIAS = ['parcial', 'ausente', 'endereco_errado', 'recusa'];
  const ORDEM_STATUS = { em_rota: 0, agendada: 1, ocorrencia: 2 };

  const rotuloStatus = s => ROTULO_STATUS[s] || String(s ?? '');
  const corStatus = s => Sit.cor('entrega', s);
  const rotuloResultado = id => (RESULTADOS.find(r => r.id === id) || {}).rotulo || String(id ?? '');

  // O cadastro pode trazer mais de um número ("2222-3333 / 99999-8888"): separa por / ; , | ou " e " e usa o primeiro trecho com 8+ dígitos.
  // Só dígitos e um + no início (o valor vai para href="tel:"; nada além disso passa); menos de 8 dígitos não é telefone.
  function telefoneLimpo(t) {
    for (const trecho of String(t ?? '').split(/[\/;,|]| e /)) {
      const s = trecho.trim();
      const digitos = s.replace(/\D/g, '');
      if (digitos.length >= 8) return (s.startsWith('+') ? '+' : '') + digitos;
    }
    return '';
  }
  // texto bruto do telefone no cartão (escapado), sempre visível, mesmo sem link de ligar
  const htmlTelefone = t => (txt(t) ? `<p class="telefone"><span class="cinza">Telefone:</span> ${esc(txt(t))}</p>` : '');
  const urlLigar = t => { const n = telefoneLimpo(t); return n ? 'tel:' + n : ''; };

  const parte = v => txt(v);
  const temEndereco = a => !!a && ['rua', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'ref'].some(c => parte(a[c]));
  function enderecoTexto(a) {
    if (!a) return '';
    const l1 = [a.rua, a.numero].map(parte).filter(Boolean).join(', ');
    return [l1, parte(a.bairro), [a.cidade, a.uf].map(parte).filter(Boolean).join('/'), parte(a.cep), parte(a.ref)].filter(Boolean).join(' · ');
  }
  // texto para a busca no mapa: sem a referência (atrapalha a busca)
  function enderecoMapa(a) {
    if (!a) return '';
    const l1 = [a.rua, a.numero].map(parte).filter(Boolean).join(', ');
    return [l1, parte(a.bairro), [a.cidade, a.uf].map(parte).filter(Boolean).join(' - '), parte(a.cep)].filter(Boolean).join(', ');
  }
  // endereço da entrega; sem ele, o do cadastro do cliente só como sugestão (origem 'cliente'); sem nenhum, origem null
  function enderecoDe(e) {
    if (e && temEndereco(e.endereco)) return { origem: 'entrega', texto: enderecoTexto(e.endereco), mapa: enderecoMapa(e.endereco) };
    if (e && temEndereco(e.enderecoCliente)) return { origem: 'cliente', texto: enderecoTexto(e.enderecoCliente), mapa: enderecoMapa(e.enderecoCliente) };
    return { origem: null, texto: '', mapa: '' };
  }
  const urlMapa = e => {
    const m = enderecoDe(e).mapa;
    return m ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(m) : '';
  };

  // ações que o servidor aceita para o motorista em cada estado (o servidor continua decidindo)
  // administrativo (2026-11-13): dá a baixa em qualquer entrega Agendada ou Em rota (o servidor grava a saída junto quando ainda Agendada);
  // "Iniciar rota" só nas dele (e.minha !== false)
  function acoesMotorista(e, administrativo = false) {
    if (!e) return [];
    if (administrativo) {
      const r = [];
      if (e.status === 'agendada' && e.minha !== false) r.push('iniciar');
      if (e.status === 'agendada' || e.status === 'em_rota') r.push('baixar');
      return r;
    }
    if (e.status === 'agendada') return ['iniciar'];
    if (e.status === 'em_rota') return ['baixar'];
    return [];
  }
  // só o resultado "Entregue" para o administrativo dando baixa em entrega de outro motorista (ocorrência é do motorista)
  const baixaSoEntregue = (e, administrativo, ehMotorista) => !!administrativo && !(e && e.minha !== false && ehMotorista);
  // texto do aviso na tela de baixa do administrativo
  function avisoBaixaAdministrativa(e) {
    if (!e) return '';
    const partes = [];
    if (e.status === 'agendada') partes.push('Esta entrega ainda não saiu: a saída será registrada junto com a baixa.');
    if (e.minha === false) partes.push(`A baixa será registrada em nome do motorista ${txt(e.motorista) || '(sem nome)'}, com o seu usuário como autor.`);
    return partes.join(' ');
  }

  // última ocorrência registrada (motivo mostrado no cartão da entrega em ocorrência)
  function motivoOcorrencia(eventos) {
    if (!Array.isArray(eventos)) return null;
    for (let i = eventos.length - 1; i >= 0; i--) {
      const v = eventos[i];
      if (v && OCORRENCIAS.includes(v.tipo)) return { tipo: v.tipo, rotulo: rotuloResultado(v.tipo), motivo: v.motivo || '' };
    }
    return null;
  }

  const hojeISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function deslocarDia(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const x = new Date(Date.UTC(a, m - 1, d + n));
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  }

  // [{ dia, atrasada, entregas }]: dias em ordem; no dia, em rota primeiro, depois agendadas, depois ocorrências; por fim o número do pedido
  function agruparCartoes(lista, hoje) {
    if (!Array.isArray(lista)) return [];
    const dias = new Map();
    for (const e of lista) {
      const dia = e.dataAgendada || '';
      if (!dias.has(dia)) dias.set(dia, []);
      dias.get(dia).push(e);
    }
    return [...dias.keys()].sort().map(dia => ({
      dia,
      atrasada: !!dia && dia < hoje,
      entregas: dias.get(dia).sort((a, b) => (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9) || a.numero - b.numero)
    }));
  }

  // quantidade máxima (inteira) selecionável de um item; a rota só aceita inteiros >= 1
  const maxInteiro = q => Math.max(1, Math.floor(Number(q) || 0));

  // f: { entregueA, temFoto, motivo, itens: [{ descricao, qtd, max }] }
  function validarBaixa(resultado, f) {
    const erros = [];
    if (!RESULTADOS.some(r => r.id === resultado)) return ['Escolha o resultado da entrega.'];
    if (resultado === 'entregue') {
      const quem = txt(f.entregueA);
      if (!quem) erros.push('Informe quem recebeu.');
      else if (quem.length > 190) erros.push('Nome de quem recebeu muito longo (máximo 190 caracteres).');
      return erros;
    }
    const motivo = txt(f.motivo);
    if (motivo.length < 3 || motivo.length > 500) erros.push('Informe o motivo (3 a 500 caracteres).');
    if (resultado === 'parcial') {
      const itens = Array.isArray(f.itens) ? f.itens : [];
      const ruim = itens.find(i => !Number.isInteger(i.qtd) || i.qtd < 0 || i.qtd > i.max);
      if (ruim) erros.push(`Quantidade inválida em "${txt(ruim.descricao)}" (de 0 a ${ruim.max}, número inteiro).`);
      else if (!itens.some(i => i.qtd > 0)) erros.push('Informe a quantidade entregue de pelo menos um item.');
    }
    return erros;
  }

  const corpoBaixa = (f, anexoIds) => ({ entregueA: txt(f.entregueA), anexoIds });
  function corpoOcorrencia(resultado, f) {
    const b = { tipo: resultado, motivo: txt(f.motivo) };
    if (resultado === 'parcial') {
      b.itensEntregues = f.itens.filter(i => i.qtd > 0).map(i => ({ descricao: txt(i.descricao).slice(0, 300), qtd: i.qtd }));
    }
    return b;
  }

  // ============ TELA (só no navegador) ============
  function iniciar(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const { getAuth, chamar } = C.criarApi(win);
    const toast = C.criarToast(doc, win);
    const estado = {
      dia: null, escopo: 'todos', lista: [], detalhes: new Map(), carregando: false, baixa: null, urlFoto: null,
      traco: { tem: false, versao: 0 }
    };

    // desabilita botões e campos durante a chamada (evita envio duplo)
    async function ocupado(fn) {
      if (estado.carregando) return;
      estado.carregando = true;
      const alvos = [...doc.querySelectorAll('main button, main input, main textarea')];
      const antes = alvos.map(b => b.disabled);
      alvos.forEach(b => { b.disabled = true; });
      try { return await fn(); } catch (err) { toast(err.message, 'erro'); } finally {
        estado.carregando = false;
        alvos.forEach((b, i) => { if (b.isConnected) b.disabled = antes[i]; });
      }
    }

    // ---------- lista ----------
    const hoje = () => hojeISO();
    function rotuloDia() {
      if (!estado.dia) return 'Hoje e atrasadas';
      return (estado.dia === hoje() ? 'Hoje · ' : '') + dataBR(estado.dia);
    }
    const selo = s => `<span class="selo ${corStatus(s)}">${esc(rotuloStatus(s))}</span>`;

    // administrativo (administrativo.ver + entregas.ver): vê as entregas de todos os motoristas e dá a baixa; "Só as minhas" volta ao padrão do motorista
    const souAdministrativo = () => !!(win.Acesso && win.Acesso.pode('administrativo.ver entregas.ver'));
    const souMotorista = () => !!(win.Acesso && win.Acesso.pode('entregas.baixar'));

    function htmlCartao(e) {
      const adm = souAdministrativo();
      const det = estado.detalhes.get(e.id);
      const end = enderecoDe(e);
      const mapa = urlMapa(e), tel = urlLigar(e.telefone);
      let enderecoHtml;
      if (end.origem === 'entrega') enderecoHtml = `<p class="endereco">${esc(end.texto)}</p>`;
      else if (end.origem === 'cliente') enderecoHtml = `<p class="endereco">${esc(end.texto)}</p><p class="aviso">Endereço do cadastro do cliente – confirme com a empresa.</p>`;
      else enderecoHtml = '<p class="endereco sem">Endereço não informado. Fale com a empresa.</p>';
      const links = (mapa ? `<a class="btn btn-secondary btn-grande" href="${esc(mapa)}" target="_blank" rel="noopener">Abrir no mapa</a>` : '') +
        (tel ? `<a class="btn btn-secondary btn-grande" href="${esc(tel)}">Ligar</a>` : '');
      let itens = '';
      if (det) {
        itens = '<h4>Itens</h4>' + (det.itens && det.itens.length
          ? `<ul class="itens">${det.itens.map(i => `<li>${esc(rotuloItem(i))} <span class="cinza">× ${esc(i.qtd)}</span>${i.observacao ? `<div class="obs-item">Obs.: ${esc(i.observacao)}</div>` : ''}</li>`).join('')}</ul>`
          : '<p class="cinza">Sem itens.</p>') + (det.observacao ? `<h4>Observação</h4><p>${esc(det.observacao)}</p>` : '');
      } else itens = `<p class="cinza">${esc(e.qtdItens)} ${e.qtdItens === 1 ? 'item' : 'itens'}</p>`;
      const oc = e.status === 'ocorrencia' && det ? motivoOcorrencia(det.eventos) : null;
      const ocHtml = e.status === 'ocorrencia'
        ? `<div class="ocorrencia"><strong>${esc(oc ? oc.rotulo : 'Ocorrência')}</strong>${oc && oc.motivo ? `<p>${esc(oc.motivo)}</p>` : ''}<p class="cinza">A equipe vai reagendar.</p></div>` : '';
      const acoes = acoesMotorista(e, adm);
      const botoes = (acoes.includes('iniciar') ? '<button type="button" class="btn btn-primary btn-grande" data-acao="iniciar" data-perm="entregas.baixar">Iniciar rota</button>' : '') +
        (acoes.includes('baixar') ? `<button type="button" class="btn btn-primary btn-grande" data-acao="baixar" data-perm="${adm ? 'administrativo.ver' : 'entregas.baixar'}">Dar baixa</button>` : '');
      // o checklist do motorista é só da própria entrega (rota própria); com o filtro "Todos" some das dos outros
      const botaoChecklist = e.minha === false ? '' : '<div class="acoes"><button type="button" class="btn btn-secondary" data-acao="checklist" data-perm="entregas.baixar">Checklist de entrega (PDF)</button></div>';
      const motoristaHtml = e.motorista !== undefined
        ? `<p class="motorista"><span class="cinza">Motorista:</span> <strong>${esc(txt(e.motorista) || 'sem nome')}</strong>${e.minha ? ' <span class="cinza">(você)</span>' : ''}</p>` : '';
      return `<article class="cartao" data-id="${esc(e.id)}">
        <div class="cartao-topo"><strong>Pedido ${esc(e.numero)}${rotuloSequencia(e) ? ` · ${esc(rotuloSequencia(e))}` : ''}</strong>${selo(e.status)}</div>
        <h3>${esc(e.cliente)}</h3>
        ${motoristaHtml}
        ${htmlTelefone(e.telefone)}
        ${enderecoHtml}
        ${e.contatoLocal ? `<p><span class="cinza">Contato no local:</span> ${esc(e.contatoLocal)}</p>` : ''}
        ${links ? `<div class="acoes">${links}</div>` : ''}
        ${itens}
        ${ocHtml}
        ${botoes ? `<div class="acoes">${botoes}</div>` : ''}
        ${botaoChecklist}
      </article>`;
    }

    function desenharLista() {
      $('dia-rotulo').textContent = rotuloDia();
      const adm = souAdministrativo();
      $('filtro-escopo').hidden = !adm;
      $('subtitulo').textContent = adm ? 'Entregas de todos os motoristas: dê a baixa no local ou em nome do motorista.' : 'Suas entregas agendadas: inicie a rota e dê baixa no local.';
      doc.querySelectorAll('[data-escopo]').forEach(b => {
        const ativo = b.getAttribute('data-escopo') === estado.escopo;
        b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        b.classList.toggle('btn-primary', ativo);
        b.classList.toggle('btn-secondary', !ativo);
      });
      const alvo = $('cartoes');
      if (!estado.lista.length) { alvo.innerHTML = '<p class="vazio">Nenhuma entrega para este dia.</p>'; return; }
      const h = hoje();
      alvo.innerHTML = agruparCartoes(estado.lista, h).map(g =>
        `<section class="dia"><h2>${g.atrasada ? 'Atrasadas · ' : g.dia === h ? 'Hoje · ' : ''}${esc(dataBR(g.dia))}</h2>${g.entregas.map(htmlCartao).join('')}</section>`).join('');
    }

    async function carregar() {
      let ok = true;
      try {
        const q = [];
        if (estado.dia) q.push('dia=' + encodeURIComponent(estado.dia));
        if (souAdministrativo() && estado.escopo === 'minhas') q.push('escopo=minhas');
        const d = await chamar('/minhas_entregas' + (q.length ? '?' + q.join('&') : ''));
        estado.lista = Array.isArray(d.entregas) ? d.entregas : [];
      } catch (err) { toast(err.message, 'erro'); estado.lista = []; ok = false; }
      estado.detalhes.clear();
      desenharLista();
      if (!ok) { $('cartoes').innerHTML = '<p class="vazio">Não foi possível carregar. Use as setas para tentar de novo.</p>'; return; }
      // itens, observação e motivo vêm do detalhe; os cartões já aparecem e são redesenhados quando chegam
      const dia = estado.dia;
      await Promise.allSettled(estado.lista.map(async e => {
        try { estado.detalhes.set(e.id, await chamar(`/minhas_entregas/${encodeURIComponent(e.id)}`)); } catch { /* o cartão fica só com o resumo */ }
      }));
      if (dia === estado.dia && !estado.baixa) desenharLista();
    }

    // ---------- iniciar rota ----------
    function iniciarRota(id) {
      return ocupado(async () => {
        try {
          await chamar(`/minhas_entregas/${encodeURIComponent(id)}/saiu`, { metodo: 'POST' });
          toast('Entrega em rota.', 'ok');
        } catch (err) {
          toast(err.message, 'erro');
          if (err.status !== 409) return;
        }
        await carregar();
      });
    }

    // ---------- baixa ----------
    const VISTAS = ['vista-lista', 'vista-baixa'];
    const mostrar = nome => VISTAS.forEach(v => { $(v).hidden = v !== nome; });
    function limparFoto() {
      if (estado.urlFoto) { win.URL.revokeObjectURL(estado.urlFoto); estado.urlFoto = null; }
      $('b-previa').hidden = true; $('b-previa').removeAttribute('src');
    }

    async function abrirBaixa(id) {
      const e = estado.lista.find(x => x.id === id);
      if (!e) return;
      let det = estado.detalhes.get(id);
      if (!det) { det = await chamar(`/minhas_entregas/${encodeURIComponent(id)}`); estado.detalhes.set(id, det); }
      const adm = souAdministrativo();
      const soEntregue = baixaSoEntregue(e, adm, souMotorista());
      estado.baixa = { entrega: e, det, resultado: null, foto: null, assinatura: null, soEntregue };
      $('b-titulo').textContent = `Pedido ${e.numero}`;
      $('b-cliente').textContent = e.cliente;
      $('b-erro').textContent = '';
      const aviso = adm ? avisoBaixaAdministrativa(e) : '';
      $('b-aviso').textContent = aviso;
      $('b-aviso').hidden = !aviso;
      $('b-escolha').hidden = false;
      $('b-form').hidden = true;
      mostrar('vista-baixa');
      if (soEntregue) escolherResultado('entregue'); // administrativo: vai direto ao formulário da entrega concluída
      win.scrollTo(0, 0);
    }

    function escolherResultado(resultado) {
      const b = estado.baixa;
      b.resultado = resultado;
      $('b-escolha').hidden = true;
      $('b-form').hidden = false;
      $('b-resultado').textContent = rotuloResultado(resultado);
      $('b-erro').textContent = '';
      $('b-sec-entregue').hidden = resultado !== 'entregue';
      $('b-sec-motivo').hidden = resultado === 'entregue';
      $('b-sec-itens').hidden = resultado !== 'parcial';
      $('b-quem').value = ''; $('b-foto').value = ''; $('b-motivo').value = '';
      limparFoto();
      b.foto = null; b.assinatura = null;
      if (resultado === 'parcial') {
        $('b-itens').innerHTML = (b.det.itens || []).map((i, k) => {
          const max = maxInteiro(i.qtd);
          return `<div class="item-parcial"><label for="b-item-${k}">${esc(i.descricao)} <span class="cinza">(de ${esc(i.qtd)})</span></label>` +
            `<input type="number" inputmode="numeric" id="b-item-${k}" min="0" max="${max}" step="1" value="0" data-item="${k}"></div>`;
        }).join('') || '<p class="cinza">O pedido não tem itens cadastrados.</p>';
      }
      if (resultado === 'entregue') prepararAssinatura();
      win.scrollTo(0, 0);
    }

    function voltarEscolha() {
      if (estado.baixa.soEntregue) { fecharBaixa(); return; } // não há escolha de resultado para o administrativo
      estado.baixa.resultado = null;
      $('b-erro').textContent = '';
      $('b-escolha').hidden = false;
      $('b-form').hidden = true;
    }
    function fecharBaixa() {
      estado.baixa = null;
      $('b-aviso').hidden = true;
      limparFoto();
      mostrar('vista-lista');
    }

    // ---------- assinatura (canvas) ----------
    function contextoAssinatura() { return $('assinatura').getContext('2d'); }
    function limparAssinatura() {
      const c = $('assinatura');
      contextoAssinatura().clearRect(0, 0, c.width, c.height);
      estado.traco = { tem: false, versao: estado.traco.versao + 1 };
      if (estado.baixa) estado.baixa.assinatura = null;
    }
    function prepararAssinatura() {
      const c = $('assinatura');
      c.width = Math.max(200, Math.round(c.clientWidth || 300));
      c.height = 180;
      const ctx = contextoAssinatura();
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      limparAssinatura();
    }
    function ligarAssinatura() {
      const c = $('assinatura');
      let desenhando = false;
      const ponto = ev => {
        const r = c.getBoundingClientRect();
        return [(ev.clientX - r.left) * (c.width / r.width), (ev.clientY - r.top) * (c.height / r.height)];
      };
      c.addEventListener('pointerdown', ev => {
        desenhando = true;
        try { c.setPointerCapture(ev.pointerId); } catch { /* sem captura: segue assim mesmo */ }
        const ctx = contextoAssinatura(), [x, y] = ponto(ev);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
        ev.preventDefault();
      });
      c.addEventListener('pointermove', ev => {
        if (!desenhando) return;
        const ctx = contextoAssinatura(), [x, y] = ponto(ev);
        ctx.lineTo(x, y); ctx.stroke();
        ev.preventDefault();
      });
      const fim = () => {
        if (!desenhando) return;
        desenhando = false;
        estado.traco = { tem: true, versao: estado.traco.versao + 1 };
      };
      c.addEventListener('pointerup', fim);
      c.addEventListener('pointercancel', fim);
      $('btn-limpar-assinatura').addEventListener('click', limparAssinatura);
    }
    // PNG sobre fundo branco (o traço é transparente no canvas)
    function assinaturaBlob() {
      const c = $('assinatura');
      const t = doc.createElement('canvas');
      t.width = c.width; t.height = c.height;
      const ctx = t.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.width, t.height);
      ctx.drawImage(c, 0, 0);
      return new Promise(r => t.toBlob(r, 'image/png'));
    }

    // ---------- envio de anexos: uma vez por arquivo/traço (a baixa que falha e é refeita não duplica o anexo) ----------
    async function enviarFoto(entregaId, arquivo) {
      const b = estado.baixa;
      if (b.foto && b.foto.arquivo === arquivo) return b.foto.id;
      const blob = await C.reduzirImagem(win, arquivo);
      const r = await chamar(`/minhas_entregas/${encodeURIComponent(entregaId)}/anexo?tipo=foto`, { metodo: 'PUT', binario: blob, mime: 'image/jpeg' });
      b.foto = { arquivo, id: r.anexoId };
      return r.anexoId;
    }
    async function enviarAssinatura(entregaId) {
      const b = estado.baixa, versao = estado.traco.versao;
      if (b.assinatura && b.assinatura.versao === versao) return b.assinatura.id;
      const blob = await assinaturaBlob();
      if (!blob || blob.size > C.LIMITE_IMAGEM) throw new Error('A assinatura ficou grande demais. Limpe e assine de novo.');
      const r = await chamar(`/minhas_entregas/${encodeURIComponent(entregaId)}/anexo?tipo=assinatura`, { metodo: 'PUT', binario: blob, mime: 'image/png' });
      b.assinatura = { versao, id: r.anexoId };
      return r.anexoId;
    }

    function lerItens() {
      return [...doc.querySelectorAll('#b-itens input[data-item]')].map(inp => {
        const k = Number(inp.getAttribute('data-item'));
        const it = estado.baixa.det.itens[k];
        return { descricao: it.descricao, qtd: inp.value === '' ? 0 : Number(inp.value), max: maxInteiro(it.qtd) };
      });
    }

    function enviarBaixa() {
      const b = estado.baixa;
      if (!b || !b.resultado) return;
      const arquivo = $('b-foto').files[0];
      const f = { entregueA: $('b-quem').value, temFoto: !!arquivo, motivo: $('b-motivo').value, itens: b.resultado === 'parcial' ? lerItens() : [] };
      const erros = validarBaixa(b.resultado, f);
      $('b-erro').textContent = erros.join(' ');
      if (erros.length) return;
      const id = b.entrega.id;
      return ocupado(async () => {
        let fase = 'anexo';
        try {
          if (b.resultado === 'entregue') {
            const ids = arquivo ? [await enviarFoto(id, arquivo)] : [];
            if (estado.traco.tem) ids.push(await enviarAssinatura(id));
            fase = 'registro';
            await chamar(`/minhas_entregas/${encodeURIComponent(id)}/baixa`, { metodo: 'POST', corpo: corpoBaixa(f, ids) });
            toast('Entrega registrada.', 'ok');
          } else {
            fase = 'registro';
            await chamar(`/minhas_entregas/${encodeURIComponent(id)}/ocorrencia`, { metodo: 'POST', corpo: corpoOcorrencia(b.resultado, f) });
            toast('Ocorrência registrada. A equipe vai reagendar.', 'ok');
          }
        } catch (err) {
          // 409 no registro: a entrega já mudou (outra tela, outro envio) -> mostra a mensagem e volta para a lista atualizada
          if (err.status === 409 && fase === 'registro') { toast(err.message + ' Já registrado.', 'erro'); fecharBaixa(); await carregar(); return; }
          throw err;
        }
        fecharBaixa();
        await carregar();
      });
    }

    // ---------- eventos ----------
    function ligar() {
      $('cartoes').addEventListener('click', ev => {
        const botao = ev.target.closest('button[data-acao]');
        const cartao = ev.target.closest('[data-id]');
        if (!botao || !cartao) return;
        const id = Number(cartao.getAttribute('data-id'));
        // folha do checklist externo desta entrega (somente leitura; o PDF vem do servidor e a aba abre já no clique)
        if (botao.getAttribute('data-acao') === 'checklist') {
          if (win.EntregaChecklist) win.EntregaChecklist.abrirPdf(win, { apiBase: C.API_BASE, loginUrl: C.LOGIN_URL, token: () => (getAuth() || {}).token || '' },
            `/minhas_entregas/${encodeURIComponent(id)}/checklist.pdf`);
          return;
        }
        if (botao.getAttribute('data-acao') === 'iniciar') iniciarRota(id);
        else ocupado(() => abrirBaixa(id));
      });
      const ir = dia => { estado.dia = dia; desenharLista(); $('cartoes').innerHTML = '<p class="vazio">Carregando…</p>'; carregar(); };
      $('btn-dia-ant').addEventListener('click', () => ir(deslocarDia(estado.dia || hoje(), -1)));
      $('btn-dia-prox').addEventListener('click', () => ir(deslocarDia(estado.dia || hoje(), 1)));
      $('btn-dia-hoje').addEventListener('click', () => ir(null));
      doc.querySelectorAll('[data-resultado]').forEach(b => b.addEventListener('click', () => escolherResultado(b.getAttribute('data-resultado'))));
      $('btn-voltar-lista').addEventListener('click', fecharBaixa);
      doc.querySelectorAll('[data-escopo]').forEach(b => b.addEventListener('click', () => {
        const novo = b.getAttribute('data-escopo');
        if (novo === estado.escopo) return;
        estado.escopo = novo;
        $('cartoes').innerHTML = '<p class="vazio">Carregando…</p>';
        carregar();
      }));
      $('btn-voltar-escolha').addEventListener('click', voltarEscolha);
      $('b-form').addEventListener('submit', ev => { ev.preventDefault(); enviarBaixa(); });
      $('b-foto').addEventListener('change', () => {
        limparFoto();
        const a = $('b-foto').files[0];
        if (a && /^image\//.test(a.type || '')) { estado.urlFoto = win.URL.createObjectURL(a); $('b-previa').src = estado.urlFoto; $('b-previa').hidden = false; }
      });
      ligarAssinatura();
    }

    // ---------- init ----------
    const auth = getAuth();
    if (!auth) { win.location.href = C.LOGIN_URL; return; }
    $('user-empresa').textContent = auth.user.empresa || 'Elegance';
    $('user-name').textContent = auth.user.nome || '';
    $('user-cargo').textContent = auth.user.cargo || '';
    $('user-avatar').textContent = (auth.user.nome || 'E').charAt(0).toUpperCase();
    if (win.Acesso && !win.Acesso.paginaLiberada()) return; // sem permissão: o layout.js já mostrou "Sem acesso"
    ligar();
    mostrar('vista-lista');
    carregar();
  }

  return { esc, baixaSoEntregue, avisoBaixaAdministrativa, RESULTADOS, rotuloStatus, corStatus, rotuloResultado, telefoneLimpo, htmlTelefone, urlLigar, enderecoTexto, enderecoDe, urlMapa, acoesMotorista,
    motivoOcorrencia, hojeISO, deslocarDia, agruparCartoes, maxInteiro, validarBaixa, corpoBaixa, corpoOcorrencia, iniciar };
});
