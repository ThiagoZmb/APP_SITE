// Livro de regras na tela de orçamentos: lógica pura de regras_tela.js e conferência do HTML estático (tela NÃO testada em navegador real).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../regras_tela.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8').replace(/\r\n/g, '\n');
const corpoDe = (nome) => {
  const ini = html.indexOf(nome);
  assert.ok(ini >= 0, nome + ' existe');
  const prox = html.indexOf('\n        function ', ini + 10);
  const prox2 = html.indexOf('\n        const ', ini + 10);
  return html.slice(ini, Math.min(...[prox, prox2].filter(n => n > 0)));
};

test('soDigitos (R10): corta na PRIMEIRA vírgula/ponto e descarta o resto (nunca vira número 10x maior); letra/sinal/espaço só são tirados', () => {
  assert.equal(R.soDigitos('2100,5'), '2100');
  assert.equal(R.soDigitos('150.5'), '150');
  assert.equal(R.soDigitos('1.234'), '1', 'ponto de milhar também corta: a pessoa vê o aviso e corrige');
  assert.equal(R.soDigitos('12,5'), '12');
  assert.equal(R.soDigitos('abc12'), '12');
  assert.equal(R.soDigitos(''), '');
  assert.equal(R.soDigitos('12 a 3'), '123', 'colar "12 a 3": sem vírgula/ponto, só os não dígitos saem');
  assert.equal(R.soDigitos('-3'), '3');
  assert.equal(R.soDigitos('1.200 mm'), '1');
  assert.equal(R.soDigitos('abc'), '');
  assert.equal(R.soDigitos(null), '');
  assert.equal(R.soDigitos(40), '40');
});

test('camposComNaoDigito: texto cru com decimal/sinal/letra aponta o campo; vazio e dígitos passam', () => {
  const r = R.camposComNaoDigito([
    { rotulo: 'Altura', valor: '2000,5' }, { rotulo: 'Largura', valor: '800' }, { rotulo: 'Quantidade', valor: '' },
    { rotulo: 'Soldas', valor: '-1' }, { rotulo: 'Transpasse', valor: '1e3' }, { rotulo: 'Furo 1', valor: ' 100 ' }, { rotulo: 'Prof', valor: '2.0' }]);
  assert.deepEqual(r, ['Altura', 'Soldas', 'Transpasse', 'Prof']);
  assert.deepEqual(R.camposComNaoDigito(null), []);
  assert.match(R.textoNaoInteiro(['Altura', 'Soldas']), /Altura, Soldas/);
});

test('avaliar: bloqueia para tudo sem perguntar; confirma/avisa perguntam e gravam os códigos aceitos', () => {
  const perguntas = [];
  const sim = t => { perguntas.push(t); return true; };
  const b = R.avaliar([{ codigo: 'a', nivel: 'bloqueia', mensagem: 'M1' }, { codigo: 'b', nivel: 'confirma', mensagem: 'M2' }, { codigo: 'c', nivel: 'bloqueia', mensagem: 'M3' }], sim);
  assert.deepEqual(b, { ok: false, bloqueios: ['M1', 'M3'], confirmacoes: [] });
  assert.equal(perguntas.length, 0);

  const ok = R.avaliar([{ codigo: 'x', nivel: 'confirma', mensagem: 'Medida pequena' }, { codigo: 'y', nivel: 'avisa', mensagem: 'Atenção' }], sim);
  assert.deepEqual(ok, { ok: true, bloqueios: [], confirmacoes: ['x', 'y'] });
  assert.equal(perguntas.length, 2);
  assert.match(perguntas[0], /Medida pequena/);
  assert.match(perguntas[0], /OK = continuar assim · Cancelar = corrigir/);

  const nao = R.avaliar([{ codigo: 'x', nivel: 'confirma', mensagem: 'm' }, { codigo: 'y', nivel: 'avisa', mensagem: 'n' }], () => false);
  assert.deepEqual(nao, { ok: false, bloqueios: [], confirmacoes: [] });
  assert.deepEqual(R.avaliar([], sim), { ok: true, bloqueios: [], confirmacoes: [] });
  assert.deepEqual(R.avaliar(undefined, sim), { ok: true, bloqueios: [], confirmacoes: [] });
});

test('tela: regras_tela.js é carregado e consultarRegras chama a rota com token e trata 401', () => {
  assert.match(html, /<script src="regras_tela\.js/);
  const c = corpoDe('async function consultarRegras');
  assert.ok(c.includes('/regras/verificar_item'));
  assert.ok(c.includes("'Authorization': 'Bearer ' + getToken()"));
  assert.ok(c.includes('RegrasTela.decidirConsulta'), 'a decisão vem da função pura testada abaixo');
  assert.ok(c.includes('d.login') && c.includes('LOGIN_URL'), '401 vai para o login');
  assert.ok(c.includes('catch { resposta = { rede: true }; }'), 'falha de rede vira resposta { rede: true }');
  assert.ok(c.includes('return { ok: d.ok, confirmacoes: d.confirmacoes }'));
});

const sim = () => true;
const nao = () => false;
test('decidirConsulta: rede, 401, 403, 500 e corpo sem array regras = NÃO adicionar, com a mensagem certa', () => {
  const rede = R.decidirConsulta({ rede: true }, sim);
  assert.deepEqual([rede.ok, rede.confirmacoes, rede.login], [false, [], false]);
  assert.match(rede.mensagem, /Sem conexão.*NÃO foi adicionado/);
  const l401 = R.decidirConsulta({ status: 401, json: {} }, sim);
  assert.deepEqual([l401.ok, l401.login, l401.mensagem], [false, true, '']);
  const l403 = R.decidirConsulta({ status: 403, json: { error: 'Sem permissão.' } }, sim);
  assert.equal(l403.ok, false);
  assert.match(l403.mensagem, /Sem permissão para conferir as regras.*Sem permissão\..*NÃO foi adicionado/);
  const l500 = R.decidirConsulta({ status: 500, json: {} }, sim);
  assert.equal(l500.ok, false);
  assert.match(l500.mensagem, /Não foi possível conferir as regras.*\(HTTP 500\).*NÃO foi adicionado/);
  for (const resp of [{ status: 200, json: {} }, { status: 200, json: { regras: 'x' } }, { status: 200, json: null }, undefined]) {
    const d = R.decidirConsulta(resp, sim);
    assert.equal(d.ok, false, JSON.stringify(resp));
    assert.deepEqual(d.confirmacoes, []);
  }
  let perguntou = 0; // falha de HTTP nunca chega a perguntar, mesmo com regras no corpo
  R.decidirConsulta({ status: 500, json: { regras: [{ codigo: 'x', nivel: 'confirma', mensagem: 'm' }] } }, () => { perguntou++; return true; });
  assert.equal(perguntou, 0);
});

test('decidirConsulta: bloqueia = não adicionar listando TODAS as mensagens; sem pergunta', () => {
  let perguntou = 0;
  const d = R.decidirConsulta({ status: 200, json: { regras: [
    { codigo: 'a', nivel: 'bloqueia', mensagem: 'Erro A' }, { codigo: 'b', nivel: 'confirma', mensagem: 'Conf B' }, { codigo: 'c', nivel: 'bloqueia', mensagem: 'Erro C' }] } },
  () => { perguntou++; return true; });
  assert.equal(d.ok, false);
  assert.deepEqual(d.confirmacoes, []);
  assert.ok(d.mensagem.includes('Erro A') && d.mensagem.includes('Erro C') && !d.mensagem.includes('Conf B'));
  assert.equal(perguntou, 0);
});

test('decidirConsulta: confirma/avisa — aceitar adiciona com os códigos; recusar não adiciona; sem regras adiciona direto', () => {
  const resp = { status: 200, json: { regras: [{ codigo: 'x', nivel: 'confirma', mensagem: 'M1' }, { codigo: 'y', nivel: 'avisa', mensagem: 'M2' }] } };
  const aceito = R.decidirConsulta(resp, sim);
  assert.deepEqual([aceito.ok, aceito.confirmacoes, aceito.mensagem], [true, ['x', 'y'], '']);
  const recusado = R.decidirConsulta(resp, nao);
  assert.deepEqual([recusado.ok, recusado.confirmacoes], [false, []]);
  const segundaRecusa = R.decidirConsulta(resp, t => !t.includes('M2'));
  assert.deepEqual([segundaRecusa.ok, segundaRecusa.confirmacoes], [false, []]);
  assert.deepEqual(R.decidirConsulta({ status: 200, json: { regras: [] } }, nao), { ok: true, confirmacoes: [], mensagem: '', login: false });
});

test('comConfirmacoes: só os códigos aceitos agora, nunca os do item antigo (edição pede de novo)', () => {
  const antigo = { frente: 'Porta de giro', confirmacoes: ['sem_revestimento'] };
  assert.deepEqual(R.comConfirmacoes(antigo, []).confirmacoes, []);
  assert.deepEqual(R.comConfirmacoes(antigo, ['medida_pequena']).confirmacoes, ['medida_pequena']);
  assert.deepEqual(R.comConfirmacoes(antigo, undefined).confirmacoes, []);
  assert.deepEqual(antigo.confirmacoes, ['sem_revestimento'], 'não muda o item recebido');
  assert.equal(R.comConfirmacoes(antigo, []).frente, 'Porta de giro');
});

test('complemento: o change do campo normaliza para inteiro >= 1, sem 0,01 nem vírgula', () => {
  assert.ok(html.includes('c.qtd = Math.max(1, parseInt(inp.value, 10) || 1);'));
  assert.ok(!html.includes('Math.max(0.01'));
  const cp = html.match(/<input[^>]*class="cp-qtd"[^>]*>/)[0];
  assert.ok(!/min=|step=/.test(cp), cp);
});

test('adicionarItem: consulta o livro depois das checagens locais e do coletarForm, antes do push; erro não adiciona', () => {
  const a = corpoDe('async function adicionarItem');
  const iCheck = a.indexOf('temClienteSelecionado()');
  const iCru = a.indexOf('textoCruNaoInteiro');
  const iColeta = a.indexOf('coletarForm()');
  const iValor = a.indexOf('item.valor <= 0');
  const iConsulta = a.indexOf('await consultarRegras(item)');
  const iPush = a.indexOf('RegrasTela.colocarNaLista(itens, item, antigo)');
  const iEdit = iPush;
  assert.ok(iCheck >= 0 && iCru > iCheck && iColeta > iCru, 'texto cru conferido antes do coletarForm');
  assert.ok(iValor > iColeta && iConsulta > iValor, 'consulta depois das checagens locais');
  assert.ok(iConsulta < iPush && iConsulta < iEdit, 'consulta antes de adicionar/atualizar');
  assert.match(a, /if \(!regras\.ok\) return;/);
  assert.ok(a.includes('RegrasTela.comConfirmacoes(item, regras.confirmacoes)'), 'códigos aceitos agora vão em item.confirmacoes (função testada)');
  assert.ok(a.includes('consultandoRegras'), 'trava de clique duplo');
  // preserva o resto do fluxo
  assert.ok(a.includes('definirDesenho(item, desenho)'));
  assert.ok(a.includes('AuditoriaCalculo.valorAoAtualizar'));
});

test('salvar: confirmacoes de cada item viajam no corpo do POST /ped_orc/salvar', () => {
  assert.match(html, /itens: itens\.map\(it => \(\{[^]*?confirmacoes: Array\.isArray\(it\.confirmacoes\) \? it\.confirmacoes : \[\]/);
});

test('campos de tamanho e quantidade: texto numérico com data-inteiro; dinheiro e % de desconto continuam number', () => {
  const inteiros = ['f-transpasse', 'f-qtd', 'f-altura', 'f-largura', 'f-altura-serr', 'f-qtd-a', 'f-largura-serr', 'f-qtd-l', 'f-profundidade', 'f-qtd-p',
    'f-soldas', 'f-tamanho-pux', 'f-div-h', 'f-div-v', 'f-av-alt', 'f-av-larg'];
  for (const id of inteiros) {
    const m = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m, id + ' existe');
    assert.ok(/type="text"/.test(m[0]) && /inputmode="numeric"/.test(m[0]) && /data-inteiro/.test(m[0]), id + ' texto numérico com filtro: ' + m[0]);
  }
  for (const id of ['desconto', 'avl-pct']) {
    const m = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m && /type="number"/.test(m[0]) && !/data-inteiro/.test(m[0]), id + ' não mudou');
  }
  // linhas criadas por script: furos, largura de cada porta de correr, quantidade de acessório e de complemento
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro[^>]*>(?:<span>mm<\/span>)/);
  assert.match(html, /Porta \$\{i \+ 1\}<input type="text" inputmode="numeric" data-inteiro/);
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro class="cp-qtd"/);
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro class="ac-qtd"/);
});

test('filtro de dígitos: um ouvinte de input em fase de captura limpa os campos data-inteiro (digitar e colar)', () => {
  assert.match(html, /document\.addEventListener\('input', [^]*?\[data-inteiro\][^]*?RegrasTela\.filtrarInteiro[^]*?, true\)/);
});

test('nada na tela depende de type=number nos campos trocados', () => {
  assert.ok(!/valueAsNumber|\.stepUp|\.stepDown/.test(html));
  assert.ok(!/input\[type=["']?number/.test(html));
});

test('conferência do texto cru cobre os campos estáticos e as linhas dinâmicas, também ao inserir peça', () => {
  const f = corpoDe('function textoCruNaoInteiro');
  for (const id of ['f-altura', 'f-qtd', 'f-tamanho-pux', 'f-div-h', 'f-av-alt', 'f-soldas']) assert.ok(f.includes(id) || html.includes(`['${id}'`), id);
  assert.ok(f.includes('#pnl-furacoes input') && f.includes('.ac-qtd') && f.includes('.cp-qtd') && f.includes('#correr-larguras input'));
  assert.ok(corpoDe('async function inserirPecaSerr').includes('textoCruNaoInteiro'));
});

test('filtrarInteiro (I2): mantém o PRIMEIRO separador e descarta o que vem depois (digitar tecla a tecla nunca vira 21005)', () => {
  const casos = [['2100,5', '2100,'], ['2100,', '2100,'], ['150.5', '150.'], ['1.234,5', '1.'], [',5', ','], ['12 a 3', '123'], ['', ''], ['abc', ''], ['2100', '2100']];
  for (const [entrada, saida] of casos) assert.equal(R.filtrarInteiro(entrada).valor, saida, JSON.stringify(entrada));
  // digitar 2100,5 tecla a tecla: o campo nunca chega a 21005
  let campo = '';
  for (const tecla of '2100,5') campo = R.filtrarInteiro(campo + tecla).valor;
  assert.equal(campo, '2100,');
  assert.equal(R.filtrarInteiro('2100,').removeu, false);
  assert.equal(R.filtrarInteiro('2100,').decimal, true);
  assert.equal(R.filtrarInteiro('2100,5').removeu, true);
  assert.equal(R.filtrarInteiro('2100').decimal, false);
  assert.equal(R.filtrarInteiro('21a').removeu, true);
});

test('textoFiltroInteiro (I2): avisa o que fazer quando há separador; letras têm aviso próprio; nada a avisar = vazio', () => {
  assert.equal(R.textoFiltroInteiro(R.filtrarInteiro('2100')), '');
  assert.match(R.textoFiltroInteiro(R.filtrarInteiro('2100,')), /apague a vírgula\/ponto/);
  assert.match(R.textoFiltroInteiro(R.filtrarInteiro('2100,5')), /apague a vírgula\/ponto/);
  assert.match(R.textoFiltroInteiro(R.filtrarInteiro('21a')), /letras, sinais e espaços/);
});

test('campo com o separador mantido (2100,) é recusado pela conferência do texto cru até apagar a vírgula', () => {
  const mantido = R.filtrarInteiro('2100,5').valor;
  assert.deepEqual(R.camposComNaoDigito([{ rotulo: 'Altura', valor: mantido }]), ['Altura']);
  assert.deepEqual(R.camposComNaoDigito([{ rotulo: 'Altura', valor: R.filtrarInteiro('2100').valor }]), []);
  assert.match(R.textoNaoInteiro(['Altura']), /Só números inteiros \(sem vírgula, ponto, sinal ou letra\) em: Altura/);
});

test('filtro de dígitos (R10): mostra um aviso não bloqueante (toast no #toasts, classes do tema) quando algo foi removido', () => {
  const ouvinte = html.match(/document\.addEventListener\('input', [^]*?, true\);/)[0];
  assert.ok(ouvinte.includes('RegrasTela.filtrarInteiro(el.value)'));
  assert.ok(ouvinte.includes('RegrasTela.textoFiltroInteiro'));
  assert.ok(ouvinte.includes('avisoRapido('));
  assert.ok(/<div id="toasts" aria-live="polite"><\/div>/.test(html));
  const f = corpoDe('function avisoRapido');
  assert.ok(f.includes("'toast info'") && f.includes('textContent') && !f.includes('innerHTML') && !/style\./.test(f));
});

test('origemNoCorpo (C1/R9): sem conversão vai a origem; na conversão, intacto/só % viram conversaoDe + desenhoDe; editado/novo vão sem nada', () => {
  const o = { item: 3, estado: 'intacto' };
  assert.deepEqual(R.origemNoCorpo({ origem: o }, false), { origem: o });
  assert.deepEqual(R.origemNoCorpo({ origem: o }, true), { conversaoDe: { item: 3, estado: 'intacto' }, desenhoDe: 3 });
  assert.deepEqual(R.origemNoCorpo({ origem: { item: 2, estado: 'so_pct' } }, true), { conversaoDe: { item: 2, estado: 'so_pct' }, desenhoDe: 2 });
  assert.deepEqual(R.origemNoCorpo({ origem: { item: 2, estado: 'editado' } }, true), {});
  assert.deepEqual(R.origemNoCorpo({}, true), {});
  assert.deepEqual(R.origemNoCorpo({}, false), {});
});

test('salvar (C1/R9): a conversão manda origemConversao com a impressão digital e os campos de origem vêm de RegrasTela.origemNoCorpo', () => {
  const g = corpoDe('async function gravar');
  assert.ok(g.includes("...(converte && docAberto.impressao ? { origemConversao: { tipo: docAberto.tipo, numero: docAberto.numero, impressao: docAberto.impressao } } : {})"));
  assert.ok(g.includes('...RegrasTela.origemNoCorpo(it, converte)'));
  assert.ok(!g.includes("['intacto', 'so_pct'].includes(it.origem.estado) ? { desenhoDe"), 'desenhoDe agora sai de origemNoCorpo');
});

test('colocarNaLista (I1): usa o item em edição capturado ANTES da consulta, nunca o índice lido depois', () => {
  const a = { n: 'A', origem: { item: 1, estado: 'intacto' } }, b = { n: 'B', origem: { item: 2, estado: 'intacto' } };
  const lista = [a, b];
  const novoA = { n: 'A2' };
  assert.equal(R.colocarNaLista(lista, novoA, a), true);
  assert.deepEqual(lista.map(x => x.n), ['A2', 'B']);
  assert.deepEqual(novoA.origem, { item: 1, estado: 'editado' }, 'origem do A, não do B');
  const l2 = [b, a];   // a lista mudou de ordem durante a consulta
  const novo2 = { n: 'A3' };
  R.colocarNaLista(l2, novo2, a);
  assert.deepEqual(l2.map(x => x.n), ['B', 'A3']);
  const l3 = [b];      // o item em edição saiu da lista: nada muda
  assert.equal(R.colocarNaLista(l3, { n: 'X' }, a), false);
  assert.deepEqual(l3.map(x => x.n), ['B']);
  const l4 = [b];
  assert.equal(R.colocarNaLista(l4, { n: 'N' }, null), true);
  assert.deepEqual(l4.map(x => x.n), ['B', 'N']);
});

test('adicionarItem (I1): índice em edição e desenho capturados ANTES do await; lista travada durante a consulta', () => {
  const a = corpoDe('async function adicionarItem');
  const iAwait = a.indexOf('await consultarRegras(item)');
  const iAntigo = a.indexOf('const antigo = editandoIndex >= 0 ? itens[editandoIndex] : null;');
  const iDesenho = a.indexOf('const desenho = capturarDesenho();');
  assert.ok(iAntigo >= 0 && iAntigo < iAwait, 'item em edição capturado antes');
  assert.ok(iDesenho >= 0 && iDesenho < iAwait, 'desenho capturado antes');
  const depois = a.slice(iAwait);
  assert.ok(!depois.includes('capturarDesenho()') && !depois.includes('itens[editandoIndex]'), 'nada lido do estado da tela depois do await');
  assert.ok(depois.includes('RegrasTela.colocarNaLista(itens, item, antigo)'));
  for (const f of ['function editarItem', 'function copiarItem', 'function removerItem']) assert.ok(corpoDe(f).includes('if (consultandoRegras) return;'), f);
});
