// Auditoria do cálculo (painel lateral de orcamentos.html; docs/regras/auditoria-calculo.md):
// (1) o rastro NUNCA muda o resultado do motor (porta, serralheria, avulso, acessórios);
// (2) a rota só devolve o rastro com `auditoria: true` E a chave `administrativo.ver`;
// (3) funções puras do painel; (4) a tela não grava valor de cálculo antigo nem troca o valor salvo em silêncio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calcularPrecoItem, precoComAcessorios, precoSerralheria, novoRastro, leitorRegistrado } = require('../calculo/precos');
const Aud = require('../auditoria_calculo.js');

// cadastro em memória com os números REAIS do Orçamento 21440 (lidos do banco em 2026-11-11, só SELECT)
const PRODUTOS = {
  '3445': { codigo: 98, modelo: '3445', valorFixo: 132, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' },
  '8015': { codigo: 550, modelo: '8015', valorFixo: 76.83, descontoVidro: 2, descontoPerfilPux: 2, tipoPuxador: 'Sobreposto' },
  'Pintado Sólido (Extra Clear) 4mm': { codigo: 2147, modelo: 'Pintado Sólido (Extra Clear) 4mm', valorFixo: 800.61, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' },
  'Divisor D': { codigo: 5, modelo: 'Divisor D', valorFixo: 40, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: '' },
  'Puxador E': { codigo: 6, modelo: 'Puxador E', valorFixo: 50, descontoVidro: 0, descontoPerfilPux: 0, tipoPuxador: 'Embutido' },
  'Dobradiça': { codigo: 7, modelo: 'Dobradiça', valorFixo: 20 },
  'Trilho': { codigo: 8, modelo: 'Trilho', valorFixo: 119.83 },
  'Metalon 20': { codigo: 9, modelo: 'Metalon 20', valorFixo: 30 },
  'Serviço corte': { codigo: 10, modelo: 'Serviço corte', valorFixo: 25 }
};
const ACAB = { 'Pintura Sólida Alumínio': 30, 'Preto': 10 };
const leitor = {
  produto: async n => PRODUTOS[n] || null,
  taxaAcabamento: async n => ACAB[String(n || '').trim()] || 0,
  fixoSerralheria: async n => (n === 'Grade' ? 15 : 0),
  valorSolda: async () => 2,
  componentesSerralheria: async () => [{ id: 11, tipo: 'Fechadura', descricao: 'Fechadura tetra', unidade: 'UN', valorUnitario: 10 },
    { id: 12, tipo: 'Pintura', descricao: 'Pintura', unidade: 'M2', valorUnitario: 25.5 }]
};
const ED = { isFixo: true, desconto: 26 }; // Ed Marcenaria: "Desconto fixo", 26%
const item3 = mudar => ({ frente: 'Porta de giro', altura: 580, largura: 800, qtd: 3, perfil: '3445', acabPerfil: 'Pintura Sólida Alumínio',
  puxador: '8015', acabPuxador: 'Pintura Sólida Alumínio', tipoPuxador: 'Sobreposto Total', tamanhoPuxador: '800',
  revestimento: 'Pintado Sólido (Extra Clear) 4mm', divisor: '', qtdDivH: 0, qtdDivV: 0, percentuais: '',
  posicaoPuxador: 'Topo Total', posicoesFolhas: ['Topo Total', 'Topo Total', 'Topo Total'], ...mudar });

test('Orçamento 21440 item 3: 684,50 = as 3 folhas com puxador; 664,79 = uma folha SEM posição do puxador (causa da divergência)', async () => {
  const todas = await calcularPrecoItem(item3(), ED, leitor);
  assert.deepEqual([todas.unitario, todas.total], [684.5, 2053.5]);
  const umaSem = await calcularPrecoItem(item3({ posicoesFolhas: ['Topo Total', 'Topo Total', ''] }), ED, leitor);
  assert.deepEqual([umaSem.unitario, umaSem.total], [664.79, 1994.37]); // exatamente o que ficou gravado
  // a folha sem posição: perfil 2,76 m × 171,60 + vidro 0,464 m² × 800,61, sem puxador → 845,10 × 0,74 = 625,37
  const sem = await calcularPrecoItem(item3({ qtd: 1, posicoesFolhas: [''], posicaoPuxador: '' }), ED, leitor);
  assert.equal(sem.unitario, 625.37);
  assert.equal(Math.round((2 * 684.5 + 625.37) * 100) / 100, 1994.37);
});

test('itens 1, 2, 4 e 5 do Orçamento 21440 batem com o cadastro de hoje (só o item 3 diverge)', async () => {
  const um = (a, l, qtd) => calcularPrecoItem(item3({ altura: a, largura: l, qtd, tamanhoPuxador: String(l), posicoesFolhas: Array(qtd).fill('Topo Total') }), ED, leitor);
  assert.equal((await um(840, 350, 6)).unitario, 502.27);
  assert.equal((await um(900, 350, 2)).unitario, 529.95);
  assert.equal((await um(670, 200, 2)).unitario, 315.14); // puxador abaixo do mínimo: R$ 20
  assert.equal((await um(670, 400, 1)).unitario, 460.09);
});

// entradas variadas: cada caminho do motor (grupos por folha, larguras diferentes, divisor, embutido, sem cliente, %)
const PORTAS = [
  item3(),
  item3({ posicoesFolhas: ['Topo Total', 'Topo Total', ''] }),
  item3({ posicoesFolhas: ['Topo Total', 'Lateral Esquerda Total', 'Topo Total'] }),
  { ...item3(), frente: 'Porta de Correr', qtd: 2, largurasFolhas: [700, 900], posicoesFolhas: ['Lateral Direita Superior', 'Lateral Esquerda Superior'], tipoPuxador: 'Sobreposto', tamanhoPuxador: '300' },
  item3({ divisor: 'Divisor D', qtdDivH: 2, qtdDivV: 1, percentuais: '+10;-5' }),
  item3({ puxador: 'Puxador E', tipoPuxador: '', posicoesFolhas: ['Lateral Direita Centro'], qtd: 1, tamanhoPuxador: '150' }),
  item3({ puxador: '', tipoPuxador: '', posicoesFolhas: [] })
];

test('rastro não muda o resultado: portas (com e sem acessórios), para cliente fixo, comum e sem cliente', async () => {
  for (const cliente of [ED, { isFixo: false, desconto: 12 }, null]) {
    for (const e of PORTAS) {
      const sem = await calcularPrecoItem(e, cliente, leitor);
      const aud = novoRastro();
      const com = await calcularPrecoItem(e, cliente, leitorRegistrado(leitor, aud), aud);
      assert.deepEqual(com, sem);
      assert.ok(aud.passos.length > 3 && aud.leituras.length > 0);
      const acess = [{ nome: 'Dobradiça', qtd: 4, tamanho: 0, origem: 'MANUAL' }, { nome: 'Trilho', qtd: 1, tamanho: 800, origem: 'SISTEMA DE CORRER' }];
      const semA = await precoComAcessorios(e, cliente, leitor, acess);
      const audA = novoRastro();
      const comA = await precoComAcessorios(e, cliente, leitorRegistrado(leitor, audA), acess, audA);
      assert.deepEqual(comA, semA);
      assert.ok(audA.passos.some(p => p.etapa === 'acessorio') && audA.passos.some(p => p.etapa === 'final_acessorios'));
    }
  }
});

test('rastro não muda o resultado: serralheria (peças, solda, acabamento, fixo, complementos) e avulso (todas as categorias)', async () => {
  const serr = { frente: 'Serralheria', produto: 'Grade', qtd: 2, percentuais: '', pecas: [
    { produto: 'Grade', material: 'Metalon 20', acabamento: 'Preto', altura: 1000, largura: 500, profundidade: 0, soldas: 4, qtd: 2, qtdAltura: 2, qtdLargura: 3 },
    { produto: 'Grade', material: 'Metalon 20', acabamento: '', altura: 300, largura: 0, profundidade: 0, soldas: 0, qtd: 1 }] };
  const comps = [{ id: 11, qtd: 2 }, { id: 12, qtd: 1.5 }];
  for (const cliente of [ED, null]) {
    for (const c of [comps, []]) {
      const sem = await precoSerralheria(serr, cliente, leitor, c);
      const aud = novoRastro();
      const com = await precoSerralheria(serr, cliente, leitorRegistrado(leitor, aud), c, aud);
      assert.deepEqual(com, sem);
      assert.equal(aud.passos.filter(p => p.etapa === 'peca').length, 2);
      assert.ok(aud.passos.find(p => p.etapa === 'peca').passos.some(p => p.etapa === 'solda'));
    }
  }
  const avulsos = [
    { frente: 'Avulso', categoria: 'Perfil', produto: '3445', acabamento: 'Pintura Sólida Alumínio', altura: 6000, qtd: 3 },
    { frente: 'Avulso', categoria: 'Revestimento', produto: 'Pintado Sólido (Extra Clear) 4mm', altura: 1000, largura: 500, qtd: 1, percentuais: '+10' },
    { frente: 'Avulso', categoria: 'Serviço', produto: 'Serviço corte', qtd: 2 }];
  for (const cliente of [ED, { isFixo: false, desconto: 12 }, null]) {
    for (const e of avulsos) {
      const sem = await calcularPrecoItem(e, cliente, leitor);
      const aud = novoRastro();
      assert.deepEqual(await calcularPrecoItem(e, cliente, leitorRegistrado(leitor, aud), aud), sem);
      assert.ok(aud.passos.some(p => p.etapa === 'final'));
    }
  }
});

test('rastro da porta: grupos por folha, puxador sem posição marcado, leituras com CODIGO e VALOR_FIXO', async () => {
  const aud = novoRastro();
  await calcularPrecoItem(item3({ posicoesFolhas: ['Topo Total', 'Topo Total', ''] }), ED, leitorRegistrado(leitor, aud), aud);
  const folhas = aud.passos.find(p => p.etapa === 'folhas');
  assert.equal(folhas.posVaria, true);
  assert.deepEqual(folhas.posicoesFolhas, ['Topo Total', 'Topo Total', '']);
  const grupos = aud.passos.filter(p => p.etapa === 'grupo');
  assert.deepEqual(grupos.map(g => [g.qtd, g.unitarioGrupo]), [[2, 684.5], [1, 625.37]]);
  const pux = grupos[1].passos.find(p => p.etapa === 'puxador');
  assert.equal(pux.qtdPux, 0);
  assert.match(pux.formula, /SEM posição/);
  const final = aud.passos[aud.passos.length - 1];
  assert.deepEqual([final.etapa, final.unitario, final.total], ['final', 664.79, 1994.37]);
  const perfil = aud.leituras.find(l => l.fonte === 'produto' && l.chave === '3445');
  assert.equal(perfil.resultado.codigo, 98);
  assert.equal(perfil.resultado.valorFixo, 132);
  assert.ok(aud.leituras.some(l => l.fonte === 'taxaAcabamento' && l.resultado === 30));
});

// ---------- rota ----------
const { prepararPedOrc } = require('./apoio/bancoPedOrc');
const corpoPorta = { frente: 'Porta de giro', clienteCodigo: 7, altura: 1000, largura: 500, qtd: 2, perfil: 'Perfil P', revestimento: 'Vidro V', debug: true };

test('/calcular_preco: rastro só com auditoria:true E administrativo.ver; valores iguais com e sem rastro', async t => {
  const { chamar } = await prepararPedOrc(t);
  const sem = await (await chamar('/calcular_preco', 'POST', corpoPorta)).json();
  assert.equal('auditoria' in sem, false);
  const r = await chamar('/calcular_preco', 'POST', { ...corpoPorta, auditoria: true });
  assert.equal(r.status, 200);
  const com = await r.json();
  assert.deepEqual([com.unitario, com.total, com.diag], [sem.unitario, sem.total, sem.diag]);
  assert.equal(com.auditoria.versao, 1);
  assert.equal(com.auditoria.cliente.encontrado, true);
  assert.ok(com.auditoria.passos.some(p => p.etapa === 'perimetro'));
  assert.ok(com.auditoria.leituras.some(l => l.fonte === 'produto' && l.chave === 'Perfil P' && l.resultado.valorFixo === 100));
  // auditoria precisa ser exatamente true
  assert.equal('auditoria' in await (await chamar('/calcular_preco', 'POST', { ...corpoPorta, auditoria: 'sim' })).json(), false);
  // serralheria e avulso também
  const serr = await (await chamar('/calcular_preco', 'POST', { frente: 'Serralheria', clienteCodigo: 7, produto: 'Grade', qtd: 1, auditoria: true,
    pecas: [{ produto: 'Grade', material: 'Metalon 20', altura: 1000, largura: 0, profundidade: 0, soldas: 2, qtd: 1 }], complementos: [{ id: 11, qtd: 1 }] })).json();
  assert.ok(serr.auditoria.passos.some(p => p.etapa === 'complemento'));
  const av = await (await chamar('/calcular_preco', 'POST', { frente: 'Avulso', clienteCodigo: 7, categoria: 'Serviço', produto: 'Serviço corte', qtd: 1, auditoria: true })).json();
  assert.ok(av.auditoria.passos.some(p => p.etapa === 'categoria'));
});

test('/calcular_preco: sem administrativo.ver (Vendedor, "só valores") o pedido de auditoria é ignorado', async t => {
  for (const perfil of ['Vendedor', 'Monta sem salvar']) {
    const { chamar } = await prepararPedOrc(t, { perfil });
    const r = await chamar('/calcular_preco', 'POST', { ...corpoPorta, auditoria: true });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal('auditoria' in j, false, perfil);
    assert.ok(j.unitario > 0);
  }
});

// ---------- funções puras do painel ----------
test('painel: diferenças de entrada flagram a folha sem posição ("" é diferente de "Topo Total")', () => {
  const antes = { altura: '580', posicoesFolhas: ['Topo Total', 'Topo Total', ''], debug: true };
  const depois = { altura: '580', posicoesFolhas: ['Topo Total', 'Topo Total', 'Topo Total'], auditoria: true };
  assert.deepEqual(Aud.diferencas(antes, depois), [{ campo: 'posicoesFolhas[2]', antes: '', depois: 'Topo Total' }]);
  assert.deepEqual(Aud.diferencas(depois, depois), []);
  assert.deepEqual(Aud.diferencas({ a: [1] }, { a: [1, 2] }), [{ campo: 'a[1]', antes: undefined, depois: 2 }]);
  assert.deepEqual(Aud.achatar({ x: [], y: { z: 1 } }), { x: '[]', 'y.z': 1 });
});

test('painel: comparação salvo x recalculado e base salva sem a % da lista', () => {
  assert.deepEqual(Aud.compararSalvo(664.79, 684.5), { salvo: 664.79, recalculado: 684.5, diferenca: 19.71, difere: true });
  assert.equal(Aud.compararSalvo(684.5, 684.5).difere, false);
  assert.equal(Aud.compararSalvo(null, 10), null);
  const fator = h => (h === '+10' ? 1.1 : 1);
  assert.equal(Aud.baseSalvaDoItem({ valor: 110, historico: '+10' }, fator), 100);
  assert.equal(Aud.baseSalvaDoItem({ valor: 110, valorBase: 99, historico: '+10' }, fator), 99);
});

test('painel: relatório em texto traz gatilho, mudanças, leituras e passos', () => {
  const reg = { id: 3, hora: '10:00:00.000', origem: 'motor (Porta de giro)', estado: 'aplicado', erro: '', gatilho: 'desenho: puxador da folha 3 em "Topo Total"',
    payload: { altura: 580, posicoesFolhas: ['Topo Total'] }, resposta: { unitario: 684.5, total: 2053.5 }, campo: { antes: '664.79', depois: '684.50' },
    mudancas: [{ campo: 'posicoesFolhas[2]', antes: '', depois: 'Topo Total' }], edicao: null,
    auditoria: { cliente: { encontrado: true, razaoSocial: 'X', codigo: 70, desconto: 26, isFixo: true },
      leituras: [{ fonte: 'produto', chave: '3445', resultado: { codigo: 98, valorFixo: 132, descontoVidro: 0, tipoPuxador: '', descontoPerfilPux: 0 } }, { fonte: 'taxaAcabamento', chave: 'P', resultado: 30 }],
      passos: [{ etapa: 'perfil', titulo: 'Perfil 3445', formula: '2,76 m × 171,6', resultado: 473.616 }, { etapa: 'grupo', titulo: 'Grupo', passos: [{ etapa: 'final', titulo: 'R', unitario: 1, total: 1 }] }] } };
  const t = Aud.relatorioTexto(reg, { valorCampo: '684.50', valorGravado: 684.5, historico: '' });
  for (const trecho of ['#3', 'Disparado por: desenho', 'posicoesFolhas[2]: "" → Topo Total', 'CODIGO 98, VALOR_FIXO 132', 'taxaAcabamento(P): 30%', '1. Perfil 3445: 2,76 m × 171,6 = 473.616', '  1. R', 'antes 664.79 → depois 684.50'])
    assert.ok(t.includes(trecho), trecho + '\n' + t);
});

// ---------- tela (conferência estática) ----------
test('orcamentos.html: resposta antiga descartada, Adicionar/Atualizar travado com cálculo pendente, aviso na edição, painel só com a chave', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(h, /const meu = \+\+seqPreco;/);
  assert.match(h, /if \(meu !== seqPreco\) \{ if \(aud\) aud\.fim\(reg, \{ estado: 'descartado'/);
  assert.match(h, /btn\.disabled = !\(v > 0\) \|\| precoPendente;/);
  assert.match(h, /if \(precoPendente\) \{ alert\(/);
  assert.match(h, /clearTimeout\(timerPreco\); seqPreco\+\+; definirPrecoPendente\(false\);/); // limparForm
  assert.match(h, /id="aviso-recalculo"/);
  assert.match(h, /conferirRecalculoEdicao\(d\.unitario\)/);
  assert.match(h, /aud && aud\.pedir\(\) \? \{ auditoria: true \}/);
  assert.match(h, /<script src="auditoria_calculo\.js\?v=\d+"><\/script>/);
  assert.match(h, /<link rel="stylesheet" href="auditoria_calculo\.css\?v=\d+">/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'auditoria_calculo.js'), 'utf8');
  assert.match(js, /raiz\.Acesso\.pode\('administrativo\.ver'\)/);
  assert.match(js, /setAttribute\('data-perm', 'administrativo\.ver'\)/);
  assert.match(js, /try \{ return raiz\.localStorage\.getItem/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'auditoria_calculo.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.aud-gaveta \{[^}]*background: var\(--bg\)/);
  assert.match(css, /\.aud-tabela th \{[^}]*position: sticky/);
});

// ---------- decisões do dono de 2026-11-11 ----------
const { criarLeitor, ErroCadastro } = require('../calculo/precos');
const { criarPoolFalso } = require('./apoio/poolFalso');

test('leitor: falha REAL do banco em acabamento/solda/produto vira ErroCadastro (nunca 0); registro inexistente continua 0', async () => {
  const falha = () => { throw Object.assign(new Error('conexão perdida'), { code: 'PROTOCOL_CONNECTION_LOST' }); };
  const quebrado = criarLeitor(criarPoolFalso([[/./, falha]]));
  for (const [nome, chamada] of [['acabamentos', () => quebrado.taxaAcabamento('Preto')], ['solda', () => quebrado.valorSolda()],
    ['produtos', () => quebrado.produto('3445')], ['serralheria_produtos', () => quebrado.fixoSerralheria('Grade')],
    ['complementos da serralheria', () => quebrado.componentesSerralheria('Grade')]])
    await assert.rejects(chamada(), e => e instanceof ErroCadastro && e.origem === nome && e.codigoBanco === 'PROTOCOL_CONNECTION_LOST', nome);
  const vazio = criarLeitor(criarPoolFalso([]));
  assert.equal(await vazio.taxaAcabamento('Não existe'), 0);
  assert.equal(await vazio.valorSolda(), 0);
  // o motor para (não calcula com taxa 0)
  const l = { ...leitor, taxaAcabamento: () => quebrado.taxaAcabamento('x') };
  await assert.rejects(calcularPrecoItem(item3(), ED, l), ErroCadastro);
});

test('/calcular_preco: erro ao ler o cadastro = 503 "erro_cadastro" (distinto do 400 de item sem preço)', async t => {
  const { chamar } = await prepararPedOrc(t);
  const { pool } = require('../index.js');
  const orig = pool.execute;
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (/FROM acabamentos/.test(sql)) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    return orig.call(pool, sql, params);
  });
  const r = await chamar('/calcular_preco', 'POST', { ...corpoPorta, acabPerfil: 'Anodizado' });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Não foi possível calcular: erro ao ler o cadastro.', codigo: 'erro_cadastro' });
  const semPreco = await chamar('/calcular_preco', 'POST', { ...corpoPorta, perfil: 'NÃO EXISTE' });
  assert.equal(semPreco.status, 400);
});

test('Atualizar item: valor salvo intacto não recebe a % da lista de novo; valor recalculado recebe uma vez', () => {
  const fator = h => (h === '+10' ? 1.1 : 1);
  const antigo = { valor: 110, valorBase: 100, historico: '+10' };
  // abriu e não mexeu: o campo tem 110 (com a %): grava 110, não 121
  assert.deepEqual(Aud.valorAoAtualizar({ valorCampo: 110, editando: true, campoTemSalvo: true, antigo, fatorHistorico: fator }), { valor: 110, valorBase: 100, historico: '+10' });
  // item lido do banco sem base guardada: usa a base salva calculada
  assert.equal(Aud.valorAoAtualizar({ valorCampo: 110, editando: true, campoTemSalvo: true, antigo: { valor: 110, historico: '+10' }, baseSalva: 100, fatorHistorico: fator }).valorBase, 100);
  // mexeu e o motor devolveu a base 105: grava 115,50
  assert.deepEqual(Aud.valorAoAtualizar({ valorCampo: 105, editando: true, campoTemSalvo: false, antigo, fatorHistorico: fator }), { valor: 115.5, valorBase: 105, historico: '+10' });
  // item novo: sem %
  assert.deepEqual(Aud.valorAoAtualizar({ valorCampo: 684.5, editando: false, campoTemSalvo: false, antigo: null, fatorHistorico: fator }), { valor: 684.5, valorBase: 684.5, historico: '' });
});

test('orcamentos.html: item salvo aberto mostra o valor do banco sem recalcular; recálculo só ao mexer ou em "Recalcular valor"; avisos do salvar e do erro de cadastro', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(h, /if \(edicaoPreco && edicaoPreco\.manter\) return; \/\/ item salvo recém-aberto/);
  assert.match(h, /comparacao: null, manter: true, campoTemSalvo: false \};/);
  assert.match(h, /set\('f-valor', item\.valor\);\s*\n\s*if \(edicaoPreco\) edicaoPreco\.campoTemSalvo = true;/);
  assert.match(h, /if \(!e\.isTrusted \|\| !el \|\| !el\.closest \|\| el\.id === 'f-obs'\) return;/);
  assert.match(h, /id="btn-recalcular" type="button" hidden/);
  assert.match(h, /AuditoriaCalculo\.valorAoAtualizar\(\{ valorCampo: item\.valor/);
  assert.match(h, /e\.message === 'Erro HTTP: 503' \? 'Não foi possível calcular: erro ao ler o cadastro/);
  assert.match(h, /json\.avisos && json\.avisos\.precoDivergente/);
  assert.match(h, /AuditoriaCalculo\.definirSimulador\(/);
  // na abertura, o valor do banco não pode ser trocado: preencherForm só chama o cálculo, que sai cedo com `manter`
  assert.match(h, /if \(ehCorrer\(\)\) atualizarSistemaCorrer\(\); else calcularPrecoAutomatico\(\);/);
});
