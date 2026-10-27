// Tela do plano de corte: lógica pura e conferência do HTML/layout estáticos (a captura real no navegador não tem teste automático).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../corte.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const barra = (o = {}) => ({ tipo: 'vara', retalhoId: null, comprimento: 6000, sobra: 997, destinoSobra: 'guardar',
  pecas: [{ tamanho: 2100, item: 1, origem: 'porta-altura' }, { tamanho: 900, item: 1, origem: 'porta-largura' }], ...o });

test('formatação: mm com milhar, percentual com vírgula, "—" para ausente', () => {
  assert.match(T.mm(6000), /^6\.000 mm$/);
  assert.equal(T.mm(null), '—');
  assert.equal(T.pctTxt(83.3), '83,3%');
  assert.equal(T.pctTxt(undefined), '—');
  assert.equal(T.larguraPct(1500, 6000), 25);
  assert.equal(T.larguraPct(1, 0), 0);
  assert.equal(T.larguraPct(7000, 6000), 100);   // nunca passa de 100%
});

test('rótulos de origem e de situação do plano', () => {
  assert.equal(T.rotuloOrigem('porta-altura'), 'Altura');
  assert.equal(T.rotuloOrigem('puxador'), 'Puxador');
  assert.equal(T.rotuloOrigem('xyz'), 'xyz');
  assert.match(T.rotuloSituacao('desatualizado'), /pedido mudou/i);
  assert.match(T.rotuloSituacao('gerado'), /aguardando corte/i);
});

test('barra: peças proporcionais, sobra rotulada, peça cortada marcada, tudo escapado', () => {
  const html = T.htmlBarra('P100|Anodizado|Natural', barra({ pecas: [{ tamanho: 3000, item: 1, origem: 'puxador' }] }), 0, { cortadas: new Set([T.chaveCortada('P100|Anodizado|Natural', 0, 0)]) });
  assert.match(html, /width:50%/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Vara nova/);
  assert.match(html, /Sobra/);
  const retalho = T.htmlBarra('G', barra({ tipo: 'retalho', retalhoId: 7, comprimento: 2200, sobra: 97, destinoSobra: 'descartar' }), 2, {});
  assert.match(retalho, /Retalho nº 7/);
  assert.match(retalho, /descartar/i);
  const mau = T.htmlBarra('<img src=x onerror=alert(1)>', barra(), 0, {});
  assert.doesNotMatch(mau, /<img/);
});

test('resumo, pendências e erros: texto explicado e escapado', () => {
  const r = T.htmlResumo({ qtdVarasNovas: 2, qtdRetalhosUsados: 1, aproveitamentoPct: 83.3, sobraSomaMm: 1200 });
  assert.match(r, /2/); assert.match(r, /83,3%/); assert.match(r, /1\.200 mm/);
  assert.equal(T.htmlPendencias([]), '');
  const p = T.htmlPendencias([{ item: 3, perfil: '<b>P</b>', motivo: 'Perfil sem cor' }]);
  assert.match(p, /Item 3/); assert.doesNotMatch(p, /<b>P<\/b>/); assert.match(p, /&lt;b&gt;P/);
  assert.match(T.htmlErros([{ peca: { tamanho: 7000, perfil: 'P', item: 1 }, motivo: 'Peça maior que a vara' }]), /7\.000 mm/);
});

test('corpos de envio: salvar leva impressão e retalhos; conferência leva sobras e retalhos não usados', () => {
  assert.deepEqual(T.corpoSalvar({ impressao: 'abc', retalhosUsados: [7], outro: 1 }), { impressao: 'abc', retalhosUsados: [7] });
  const linhas = [{ grupo: 'G', barra: 0, destino: 'guardar', medida: '990' }, { grupo: 'G', barra: 1, destino: 'descartar', medida: '' }];
  assert.deepEqual(T.corpoConferencia(linhas, [7]), {
    sobras: [{ grupo: 'G', barra: 0, destino: 'guardar', medidaReal: 990 }, { grupo: 'G', barra: 1, destino: 'descartar' }], retalhosNaoUsados: [7] });
});

test('conferência na tela recusa medida maior que a sobra, zero e texto, como o servidor', () => {
  const plano = { grupos: [{ chave: 'G', barras: [barra({ sobra: 997 })] }] };
  assert.deepEqual(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'guardar', medida: '990' }], plano), []);
  for (const medida of ['998', '0', 'abc', '', '12,5']) assert.equal(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'guardar', medida }], plano).length, 1, medida);
  assert.deepEqual(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'descartar', medida: '' }], plano), []);
});

test('lista de retalhos: ações só com permissão e só para retalho disponível', () => {
  const lista = [{ id: 1, perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 1500, situacao: 'disponivel', planoOrigem: null, planoReserva: null },
    { id: 2, perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 800, situacao: 'reservado', planoOrigem: null, planoReserva: 9 }];
  const com = T.htmlRetalhos(lista, true), sem = T.htmlRetalhos(lista, false);
  assert.equal((com.match(/data-acao="descartar"/g) || []).length, 1);
  assert.doesNotMatch(sem, /data-acao=/);
  assert.match(T.htmlRetalhos([], true), /Nenhum retalho/);
});

test('HTML: todo id usado pelo JS existe, CSP presente, scripts carregados', () => {
  const html = ler('corte.html'), js = ler('corte.js');
  const usados = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(usados.length > 15);
  for (const id of new Set(usados)) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" em corte.html`);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<script src="entregas_comum\.js/);
  assert.match(html, /<script src="corte\.js/);
  assert.match(html, /<script src="layout\.js/);
});

test('menu: Plano de corte no layout e no botão direito dos pedidos', () => {
  const layout = ler('layout.js');
  assert.match(layout, /href: 'corte\.html'/);
  assert.match(layout, /'corte\.html': \['corte\.ver'\]/);
  const painel = ler('painel_inicial.html');
  assert.match(painel, /add\('corte\.ver'[^\n]*Plano de corte[^\n]*corte\.html\?numero=/);
});
