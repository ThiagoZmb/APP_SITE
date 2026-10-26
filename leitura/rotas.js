// ==========================================================================
// Leitura de projeto técnico em PDF pela web (tela de orçamentos, botão "📄 Ler projeto (PDF)").
//
//   GET    /leitura_pdf/disponivel        → { disponivel } (há chave da API no servidor?)
//   POST   /leitura_pdf                   corpo = o PDF (Content-Type application/pdf, até 25 MB)
//                                         → 202 { id, paginas } — a leitura roda em segundo plano
//   GET    /leitura_pdf/:id               → andamento; quando pronta, a conferência (valores, pendências, itens)
//   POST   /leitura_pdf/:id/confirmar     decisões da pessoa (confirmar, rejeitar com motivo, informar, escolher candidato)
//   DELETE /leitura_pdf/:id               cancela (interrompe a chamada à API) e descarta
//
// Permissão: a mesma de montar orçamento (orcamentos.criar + valores.ver). Sem permissão nova.
// Tarefas ficam só em memória, com dono (usuário) e prazo; tarefa de outro usuário responde 404.
// Se o servidor reiniciar, as tarefas somem (a tela pede para enviar o PDF de novo).
// O PDF nunca vai para disco nem para log; a referência é descartada assim que a API responde.
// Custo: 10 leituras por hora por usuário, 1 leitura por vez por usuário, poucas ao mesmo tempo no servidor,
// e cada leitura fica registrada em web_auditoria (quem, arquivo, páginas, tokens de entrada/saída, resultado).
// Regras de leitura, validação, verificação cruzada, mapeamento e confirmação: skill engenharia-projetos-tecnicos
// (scripts/lib/servico.mjs), carregada por import dinâmico. Nada disso é duplicado aqui.
// ==========================================================================
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { examinarPdf } = require('./pdf');
const { MODELO_PADRAO, MENSAGENS, ErroLeitura, criarClienteSdk, lerComClaude } = require('./claude');
const { montarConferencia } = require('./conferencia');

const PERMISSAO = ['orcamentos.criar', 'valores.ver'];
const CAMINHO_SERVICO = path.join(__dirname, '..', '.claude', 'skills', 'engenharia-projetos-tecnicos', 'scripts', 'lib', 'servico.mjs');
const PADRAO = {
  limiteBytes: 25 * 1024 * 1024,
  maxPaginas: 60,
  leiturasPorHora: 10,
  maxAtivasServidor: 3,
  ttlMs: 30 * 60 * 1000,          // tarefa terminada fica disponível por 30 min
  tempoMaximoMs: 15 * 60 * 1000,  // leitura que passar disso é interrompida
  tentativas: 2,                  // 1 leitura + 1 correção se a resposta vier fora do formato
};
const ETAPAS = { enviando: 'Enviando…', lendo: 'Lendo o desenho…', corrigindo: 'Lendo de novo (a primeira resposta veio fora do formato)…', validando: 'Validando…' };
const LIMITES_DECISAO = { ids: 3000, texto: 200 };

let servicoPromessa = null;
const carregarServico = () => (servicoPromessa ??= import(pathToFileURL(CAMINHO_SERVICO).href).catch(e => { servicoPromessa = null; throw e; }));

const nomeArquivo = bruto => {
  let t = '';
  try { t = decodeURIComponent(String(bruto || '')); } catch { t = String(bruto || ''); }
  t = t.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>"]/g, '').trim().slice(0, 120);
  return t || 'projeto.pdf';
};
const modeloConfigurado = () => { const m = String(process.env.ANTHROPIC_MODEL || '').trim(); return /^[a-z0-9][a-z0-9.-]{2,80}$/.test(m) ? m : MODELO_PADRAO; };
// mensagens do núcleo citam as opções da linha de comando; na tela viram os nomes dos botões
const mensagemParaTela = m => String(m || '').replace(/--ids/g, 'Confirmar').replace(/--rejeitar/g, 'Rejeitar').replace(/--informar/g, 'Informar')
  .replace(/--resolver/g, 'Escolher').replace(/--nota/g, 'motivo').replace(/ \(--rejeitar [^)]*\)/g, '').slice(0, 400);

function registrarLeituraPdf({ rota, pool, opcoes = {} }) {
  const cfg = { ...PADRAO, ...opcoes };
  const lerChave = opcoes.lerChave || (() => String(process.env.ANTHROPIC_API_KEY || '').trim());
  const obterCliente = opcoes.obterCliente || criarClienteSdk;
  const agora = opcoes.agora || (() => Date.now());
  const tarefas = new Map();

  // ---------- tarefas em memória ----------
  const terminada = t => ['pronto', 'erro', 'cancelada'].includes(t.estado);
  function limpar() {
    for (const [id, t] of tarefas) if (terminada(t) && agora() - t.atualizadaEm > cfg.ttlMs) tarefas.delete(id);
  }
  const ativas = () => [...tarefas.values()].filter(t => !terminada(t));
  const doDono = (req, res) => {
    limpar();
    const t = tarefas.get(String(req.params.id));
    if (!t || t.dono !== String(req.user.id)) { res.status(404).json({ error: 'Leitura não encontrada (pode ter expirado ou o servidor reiniciou). Envie o PDF de novo.' }); return null; }
    return t;
  };
  const mudar = (t, estado, extra = {}) => Object.assign(t, { estado, etapa: ETAPAS[estado] || '', atualizadaEm: agora() }, extra);

  async function auditar(t, resultado) {
    const detalhe = {
      paginas: t.paginas, bytes: t.bytes, modelo: t.modelo, tentativas: t.tentativas,
      tokensEntrada: t.uso.entrada, tokensSaida: t.uso.saida, resultado,
      itens: t.docBase ? t.docBase.itens.length : 0, duracaoMs: agora() - t.criadaEm,
    };
    try {
      await pool.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
        [String(t.quem).slice(0, 100), 'leitura_pdf', t.arquivo.slice(0, 100), JSON.stringify(detalhe)]);
    } catch (e) { console.error('[leitura_pdf] não foi possível gravar a auditoria:', e.message); }
  }

  // ---------- leitura em segundo plano ----------
  async function executar(t, pdf, chave) {
    let pdfBase64 = pdf.toString('base64');
    pdf = null; // só a cópia em base64 segue viva, até a API responder
    const controle = t.controle;
    const prazo = setTimeout(() => controle.abort('tempo'), cfg.tempoMaximoMs);
    prazo.unref?.();
    try {
      const servico = await carregarServico();
      const mapa = servico.carregarMapa('portas-aluminio');
      const sistema = servico.textoSistema(mapa);
      const esquema = servico.esquemaLeitura(mapa);
      const cliente = obterCliente(chave);
      let errosAnteriores = null;
      for (let tentativa = 1; tentativa <= cfg.tentativas; tentativa++) {
        mudar(t, tentativa === 1 ? 'lendo' : 'corrigindo');
        t.tentativas = tentativa;
        let r;
        try {
          r = await lerComClaude({ cliente, modelo: t.modelo, sistema, esquema, pdfBase64, paginas: t.paginas, errosAnteriores, sinal: controle.signal });
        } catch (e) {
          if (e.uso) { t.uso.entrada += e.uso.entrada; t.uso.saida += e.uso.saida; }
          throw e;
        }
        t.uso.entrada += r.uso.entrada; t.uso.saida += r.uso.saida;
        if (controle.signal.aborted) throw new ErroLeitura(controle.signal.reason === 'tempo' ? 'tempo' : 'cancelada', MENSAGENS[controle.signal.reason === 'tempo' ? 'tempo' : 'cancelada']);
        mudar(t, 'validando');
        const p = r.json === null ? { ok: false, erros: ['a resposta não é um JSON válido'] }
          : servico.processarLeitura(r.json, { arquivo: t.arquivo, sha256: t.sha256, paginas: t.paginas, mapa });
        if (p.ok) {
          const a = servico.avaliar(p.doc, mapa);
          if (!a.ok) throw new ErroLeitura('formato', MENSAGENS.formato);
          pdfBase64 = null;
          mudar(t, 'pronto', { docBase: p.doc, extras: p.extras, mapa, conferencia: montarConferencia({ docVerificado: a.docVerificado, saida: a.saida, mapa, extras: p.extras }) });
          break;
        }
        errosAnteriores = p.erros;
        if (tentativa === cfg.tentativas) throw new ErroLeitura('formato', `${MENSAGENS.formato} Tente de novo; se repetir, lance os itens à mão.`);
      }
    } catch (e) {
      const err = e instanceof ErroLeitura ? e : new ErroLeitura('interno', 'Erro interno ao ler o PDF.');
      if (!(e instanceof ErroLeitura)) console.error('[leitura_pdf] erro interno:', e?.message);
      mudar(t, err.codigo === 'cancelada' ? 'cancelada' : 'erro', { erro: { codigo: err.codigo, mensagem: err.message } });
    } finally {
      clearTimeout(prazo);
      pdfBase64 = null;
      t.controle = null;
      await auditar(t, t.estado === 'pronto' ? 'ok' : t.estado === 'cancelada' ? 'cancelada' : `erro:${t.erro?.codigo}`);
    }
  }

  const respostaTarefa = t => ({
    id: t.id, estado: t.estado, etapa: t.etapa, arquivo: t.arquivo, paginas: t.paginas,
    ...(t.erro ? { erro: t.erro } : {}),
    ...(t.estado === 'pronto' ? { conferencia: t.conferencia, avisos: t.avisos || [] } : {}),
  });

  // ---------- rotas ----------
  const porUsuario = rateLimit({
    windowMs: 60 * 60 * 1000, limit: cfg.leiturasPorHora, standardHeaders: true, legacyHeaders: false,
    skipFailedRequests: true,   // PDF recusado (inválido, grande, sem chave) não gasta a cota
    keyGenerator: req => `u:${req.user.id}`,
    handler: (req, res) => res.status(429).json({ error: `Limite de ${cfg.leiturasPorHora} leituras de PDF por hora atingido. Tente mais tarde.` }),
  });
  const exigeChave = (req, res, next) => (lerChave() ? next() : res.status(503).json({ error: MENSAGENS.nao_configurada, codigo: 'nao_configurada' }));
  const umaPorVez = (req, res, next) => {
    limpar();
    if (ativas().some(t => t.dono === String(req.user.id))) return res.status(409).json({ error: 'Você já tem uma leitura em andamento. Espere terminar ou cancele.' });
    if (ativas().length >= cfg.maxAtivasServidor) return res.status(503).json({ error: 'Muitas leituras em andamento no servidor. Tente em alguns minutos.' });
    next();
  };
  const parser = express.raw({ type: 'application/pdf', limit: cfg.limiteBytes });
  const corpoPdf = (req, res, next) => parser(req, res, err => {
    if (!err) return next();
    if (err.type === 'entity.too.large') return res.status(413).json({ error: `PDF grande demais. O máximo é ${Math.round(cfg.limiteBytes / 1024 / 1024)} MB.` });
    return res.status(400).json({ error: 'Não foi possível receber o arquivo.' });
  });

  rota('get', '/leitura_pdf/disponivel', PERMISSAO, (req, res) => {
    res.json({ disponivel: !!lerChave(), maxMb: Math.round(cfg.limiteBytes / 1024 / 1024), maxPaginas: cfg.maxPaginas, ...(lerChave() ? {} : { mensagem: MENSAGENS.nao_configurada }) });
  });

  rota('post', '/leitura_pdf', PERMISSAO, exigeChave, porUsuario, umaPorVez, corpoPdf, (req, res) => {
    const pdf = Buffer.isBuffer(req.body) ? req.body : null;
    req.body = null;
    if (!pdf || !pdf.length) return res.status(415).json({ error: 'Envie o arquivo PDF (Content-Type: application/pdf).' });
    const exame = examinarPdf(pdf, { maxPaginas: cfg.maxPaginas });
    if (!exame.ok) return res.status(400).json({ error: exame.erro });
    const chave = lerChave();
    if (!chave) return res.status(503).json({ error: MENSAGENS.nao_configurada, codigo: 'nao_configurada' });
    const id = crypto.randomUUID();
    const t = {
      id, dono: String(req.user.id), quem: req.acesso?.nome || req.user.nome || String(req.user.id),
      arquivo: nomeArquivo(req.get('x-arquivo-nome')), paginas: exame.paginas, sha256: exame.sha256, bytes: pdf.length,
      modelo: modeloConfigurado(), controle: new AbortController(), uso: { entrada: 0, saida: 0 }, tentativas: 0,
      criadaEm: agora(), atualizadaEm: agora(), estado: 'enviando', etapa: ETAPAS.enviando,
    };
    tarefas.set(id, t);
    res.status(202).json({ id, paginas: t.paginas, arquivo: t.arquivo });
    t.execucao = executar(t, pdf, chave);
  });

  rota('get', '/leitura_pdf/:id', PERMISSAO, (req, res) => {
    const t = doDono(req, res);
    if (t) res.json(respostaTarefa(t));
  });

  rota('delete', '/leitura_pdf/:id', PERMISSAO, (req, res) => {
    const t = doDono(req, res);
    if (!t) return;
    if (t.controle) t.controle.abort('cancelada');
    tarefas.delete(t.id);
    res.json({ ok: true });
  });

  rota('post', '/leitura_pdf/:id/confirmar', PERMISSAO, async (req, res) => {
    const t = doDono(req, res);
    if (!t) return;
    if (t.estado !== 'pronto') return res.status(409).json({ error: 'A leitura ainda não terminou.' });
    const d = lerDecisoes(req.body);
    if (d.erro) return res.status(400).json({ error: d.erro });
    let servico;
    try { servico = await carregarServico(); } catch { return res.status(503).json({ error: 'Leitura de PDF indisponível no servidor.' }); }
    let r, a;
    try {
      r = servico.aplicarDecisoes(t.docBase, d.decisoes, { por: String(req.acesso?.nome || req.user.nome || req.user.id), em: new Date(agora()).toISOString() });
      a = servico.avaliar(r.doc, t.mapa);
      if (!a.ok) throw new Error(a.erros[0]);
    } catch (e) {
      return res.status(400).json({ error: `Nada foi alterado: ${mensagemParaTela(e.message)}` });
    }
    t.docBase = r.doc;
    t.conferencia = montarConferencia({ docVerificado: a.docVerificado, saida: a.saida, mapa: t.mapa, extras: t.extras });
    t.avisos = r.avisos.map(mensagemParaTela);
    t.atualizadaEm = agora();
    try {
      await pool.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (NOW(), ?, ?, ?, ?)',
        [String(t.quem).slice(0, 100), 'leitura_pdf_conferir', t.arquivo.slice(0, 100), JSON.stringify({
          confirmados: d.decisoes.confirmar.length, rejeitados: d.decisoes.rejeitar.length, informados: d.decisoes.informar.length,
          resolvidos: d.decisoes.resolver.length, importaveis: t.conferencia.qtdImportaveis })]);
    } catch (e) { console.error('[leitura_pdf] não foi possível gravar a auditoria:', e.message); }
    res.json(respostaTarefa(t));
  });

  return { tarefas, limpar };
}

// corpo do /confirmar → { decisoes } | { erro }
function lerDecisoes(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { erro: 'Corpo inválido.' };
  const txt = v => (typeof v === 'string' && v.trim() && v.length <= LIMITES_DECISAO.texto ? v.trim() : null);
  const lista = v => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const confirmar = lista(b.confirmar), rejeitar = lista(b.rejeitar), informar = lista(b.informar), resolver = lista(b.resolver);
  if (!confirmar || !rejeitar || !informar || !resolver) return { erro: 'Decisões em formato inválido.' };
  if (confirmar.length + rejeitar.length + informar.length + resolver.length > LIMITES_DECISAO.ids) return { erro: 'Decisões demais numa só vez.' };
  if (confirmar.some(id => !txt(id))) return { erro: 'Identificador de valor inválido.' };
  if (rejeitar.some(r => !r || !txt(r.id))) return { erro: 'Identificador de valor inválido.' };
  if (rejeitar.some(r => !txt(r.motivo))) return { erro: 'Informe o motivo de cada rejeição.' };
  if (informar.some(i => !i || !txt(i.id) || !txt(i.valor))) return { erro: 'Informe o valor de cada campo a informar.' };
  if (resolver.some(r => !r || !txt(r.conflitante) || !txt(r.candidato))) return { erro: 'Escolha o candidato de cada conflito.' };
  const decisoes = {
    confirmar: confirmar.map(txt), rejeitar: rejeitar.map(r => ({ id: txt(r.id), motivo: txt(r.motivo) })),
    informar: informar.map(i => ({ id: txt(i.id), valor: txt(i.valor) })), resolver: resolver.map(r => ({ conflitante: txt(r.conflitante), candidato: txt(r.candidato) })),
  };
  if (!decisoes.confirmar.length && !decisoes.rejeitar.length && !decisoes.informar.length && !decisoes.resolver.length) return { erro: 'Nenhuma decisão enviada.' };
  return { decisoes };
}

module.exports = { registrarLeituraPdf, lerDecisoes, nomeArquivo, PADRAO };
