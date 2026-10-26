// Funções puras da janela "Ler projeto (PDF)" (leitura_pdf.js) e a entrega ao fluxo de importação que já existe.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const LP = require('../leitura_pdf.js');
const Imp = require('../importar_itens.js');
const { montarConferencia } = require('../leitura/conferencia');

const SERVICO = pathToFileURL(path.join(__dirname, '..', '.claude', 'skills', 'engenharia-projetos-tecnicos', 'scripts', 'lib', 'servico.mjs')).href;
const lido = (texto, extra = {}) => ({ texto, pagina: 1, trecho: `t ${texto}`, confianca: 0.7, unidadeSeNumero: 'nao_se_aplica', motivoUnidade: '', candidatos: [], ...extra });
const porta = id => ({ id, categoria: 'porta_aluminio', legenda: 'PORTA', quantidade: lido('1'), valores: [
  { campo: 'altura', ...lido('2000', { unidadeSeNumero: 'mm' }) }, { campo: 'largura', ...lido('500 mm') }, { campo: 'tipoFrente', ...lido('porta_giro') },
  { campo: 'perfil', ...lido('Perfil P') }, { campo: 'acabamentoPerfil', ...lido('Anodizado') }] });
const IDS = id => ['qtd', 'altura', 'largura', 'tipoFrente', 'perfil', 'acabamentoPerfil'].map(c => `${id}.${c}`);

async function conferencia(decisoes) {
  const s = await import(SERVICO);
  const mapa = s.carregarMapa();
  const p = s.processarLeitura({ itens: [porta('P1'), porta('P2')], contagens: [], cotas: [], textoSuspeito: [], observacoes: '' }, { arquivo: 'a.pdf', paginas: 1, mapa });
  const doc = decisoes ? s.aplicarDecisoes(p.doc, decisoes, { por: 'Ana', em: '2026-10-26T10:00:00Z' }).doc : p.doc;
  const a = s.avaliar(doc, mapa);
  return montarConferencia({ docVerificado: a.docVerificado, saida: a.saida, mapa, extras: p.extras });
}

test('validarArquivo: extensão, vazio e tamanho', () => {
  assert.equal(LP.validarArquivo({ name: 'a.pdf', size: 10, type: 'application/pdf' }), null);
  assert.match(LP.validarArquivo({ name: 'a.docx', size: 10, type: '' }), /PDF/);
  assert.match(LP.validarArquivo({ name: 'a.pdf', size: 0 }), /vazio/);
  assert.match(LP.validarArquivo({ name: 'a.pdf', size: 30 * 1024 * 1024 }), /grande demais/);
  assert.match(LP.validarArquivo(null), /Nenhum/);
});

test('textoAndamento: etapas, erro e tempo decorrido', () => {
  assert.equal(LP.textoAndamento({ estado: 'lendo', etapa: 'Lendo o desenho…' }, 75), 'Lendo o desenho… (1:15)');
  assert.equal(LP.textoAndamento({ estado: 'erro', erro: { mensagem: 'Limite atingido.' } }), 'Limite atingido.');
  assert.equal(LP.textoAndamento(null, 0), 'Enviando… (0:00)');
});

test('acompanhar: consulta até terminar, tolera falha de rede passageira, para quando a janela fecha', async () => {
  const estados = [{ estado: 'lendo' }, 'falha', { estado: 'validando' }, { estado: 'pronto', conferencia: {} }];
  const vistos = [];
  const api = async () => { const x = estados.shift(); if (x === 'falha') throw Object.assign(new Error('rede'), { status: 0 }); return x; };
  const t = await LP.acompanhar('id 1', { api, aoMudar: x => vistos.push(x.estado), esperar: async () => {} });
  assert.equal(t.estado, 'pronto');
  assert.deepEqual(vistos, ['lendo', 'validando', 'pronto']);
  await assert.rejects(LP.acompanhar('x', { api: async () => { throw Object.assign(new Error('expirou'), { status: 404 }); }, esperar: async () => {} }), /expirou/);
  let parar = false;
  const r = await LP.acompanhar('x', { api: async () => { parar = true; return { estado: 'lendo' }; }, deveParar: () => parar, esperar: async () => {} });
  assert.equal(r, null);
  let relogio = 0;
  await assert.rejects(LP.acompanhar('x', { api: async () => ({ estado: 'lendo' }), esperar: async () => { relogio += 1000; }, agora: () => relogio, maxMs: 3000 }), /demorando demais/);
});

test('decisões: validação, desfazer, confirmar todos sem sobrescrever e corpo do POST ("corrigir" = rejeitar + informar)', () => {
  const inf = { id: 'P1.altura', estado: 'inferido', acoes: ['confirmar', 'rejeitar'] };
  const aus = { id: 'P1.puxador', estado: 'ausente', acoes: ['informar'] };
  const conf = { id: 'P1.cor', estado: 'conflitante', acoes: ['resolver'], candidatos: [{ id: 'P1.cor.c1', valor: 'Preto' }] };
  assert.equal(LP.validarDecisao(inf, { tipo: 'confirmar' }), null);
  assert.match(LP.validarDecisao(inf, { tipo: 'rejeitar', motivo: ' ' }), /motivo/);
  assert.match(LP.validarDecisao(inf, { tipo: 'corrigir', motivo: 'x', valor: '' }), /valor correto/);
  assert.match(LP.validarDecisao(aus, { tipo: 'confirmar' }), /Só valor inferido/);
  assert.equal(LP.validarDecisao(aus, { tipo: 'informar', valor: 'Puxador X' }), null);
  assert.match(LP.validarDecisao(conf, { tipo: 'resolver', candidato: 'outro' }), /Escolha/);
  let d = LP.decidir({}, 'P1.altura', { tipo: 'corrigir', motivo: ' é 2073 ', valor: ' 2073 ' });
  d = LP.decidir(d, 'P1.puxador', { tipo: 'informar', valor: 'Puxador X' });
  d = LP.decidir(d, 'P1.cor', { tipo: 'resolver', candidato: 'P1.cor.c1' });
  d = LP.confirmarTodosDoItem(d, { valores: [inf, { id: 'P1.largura', estado: 'inferido', acoes: ['confirmar'] }, aus] });
  assert.equal(d['P1.altura'].tipo, 'corrigir', 'confirmar todos não sobrescreve decisão já tomada');
  assert.deepEqual(LP.corpoDecisoes(d), {
    confirmar: ['P1.largura'], rejeitar: [{ id: 'P1.altura', motivo: 'é 2073' }],
    informar: [{ id: 'P1.altura', valor: '2073' }, { id: 'P1.puxador', valor: 'Puxador X' }], resolver: [{ conflitante: 'P1.cor', candidato: 'P1.cor.c1' }],
  });
  assert.equal(LP.qtdDecisoes(LP.decidir(d, 'P1.cor', null)), 3);
  assert.equal(LP.textoDecisao(d['P1.cor'], conf), '✓ vale Preto');
});

test('descreverLinha e situação do item', () => {
  const d = LP.descreverLinha({ estado: 'inferido', valor: '2063', unidade: 'mm', confianca: 0.8, pagina: 4, trecho: 'cota 206,3' });
  assert.deepEqual(d, { estado: 'Inferido — conferir', valor: '2063 mm', detalhes: 'confiança 80% · pág. 4', trecho: 'cota 206,3' });
  assert.equal(LP.descreverLinha({ estado: 'ausente', valor: '', unidade: '', pagina: null, trecho: '' }).valor, '—');
  assert.equal(LP.situacaoItem({ importavel: false, faltaDecidir: 3 }).classe, 'pendente');
  assert.equal(LP.situacaoItem({ foraDoEscopo: true }).classe, 'fora');
});

test('ponta a ponta: só o item conferido entra na importação; o não conferido fica de fora com o motivo', async () => {
  const antes = await conferencia(null);
  assert.equal(antes.qtdImportaveis, 0);
  assert.equal(LP.resumo(antes, {}).podeImportar, false);
  const r = LP.resumo(antes, { 'P1.altura': { tipo: 'confirmar' } });
  assert.equal(r.podeAplicar, true);
  assert.match(r.dica, /não aplicada/);

  const c = await conferencia({ confirmar: IDS('P1') });
  assert.equal(c.qtdImportaveis, 1);
  assert.equal(LP.resumo(c, {}).textoImportar, 'Importar 1 item(ns)');
  const dados = LP.saidaParaImportar(c);
  const tri = Imp.triar(dados, { itensNaLista: 0 });
  assert.equal(tri.erro, undefined);
  assert.deepEqual(tri.aceitos.map(a => a.idItem), ['P1']);
  assert.equal(tri.aceitos[0].item.altura, 2000);
  const fora = tri.recusados.find(x => x.idItem === 'P2');
  assert.ok(fora.motivos.some(m => /não conferidos/.test(m)));
  assert.equal(c.saida.itens.find(i => i.idItem === 'P2').pendencias.some(p => /conferencia-web/.test(p.id)), false, 'a conferência original não muda');
});

test('item pronto pela skill, mas com valor opcional inferido não conferido, não é importável', async () => {
  const s = await import(SERVICO);
  const mapa = s.carregarMapa();
  const l = { itens: [{ ...porta('P1'), valores: [...porta('P1').valores, { campo: 'corPerfil', ...lido('Preto') }] }], contagens: [], cotas: [], textoSuspeito: [], observacoes: '' };
  const p = s.processarLeitura(l, { arquivo: 'a.pdf', paginas: 1, mapa });
  const doc = s.aplicarDecisoes(p.doc, { confirmar: IDS('P1') }, { por: 'Ana', em: '2026-10-26T10:00:00Z' }).doc;
  const a = s.avaliar(doc, mapa);
  const c = montarConferencia({ docVerificado: a.docVerificado, saida: a.saida, mapa, extras: p.extras });
  assert.equal(a.saida.itens[0].prontoParaLancar, true);
  assert.equal(c.itens[0].importavel, false);
  assert.equal(c.itens[0].faltaDecidir, 1);
});
