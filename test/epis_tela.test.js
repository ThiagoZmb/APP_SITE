// Tela de EPIs (epis.html + epis.js): funções puras, escape, CSV e conferência do HTML, menu e PAGINAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../epis.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MAL = '<img src=x onerror=alert(1)>';
const entrega = (x = {}) => ({ id: 1, funcionarioCodigo: 1, funcionarioNome: 'Ana', data: '2026-11-20', observacao: '', criadoPor: 'Caio', cancelada: null,
  itens: [{ epiId: 1, nome: 'Luva', ca: '12345', quantidade: 2 }], fotos: [], ...x });

test('filtros do histórico: funcionário, EPI, período, "Sem foto" e busca', () => {
  const l = [entrega(), entrega({ id: 2, funcionarioCodigo: 2, funcionarioNome: 'Bruno', data: '2026-09-01', fotos: [{ id: 9 }], itens: [{ epiId: 2, nome: 'Óculos', ca: '999', quantidade: 1 }] }),
    entrega({ id: 3, observacao: 'desgaste', cancelada: { motivo: 'erro' } })];
  const f = x => E.filtrarEntregas(l, x, '2026-11-27').map(e => e.id);
  assert.deepEqual(f({}), [1, 2, 3]);
  assert.deepEqual(f({ funcionario: '2' }), [2]);
  assert.deepEqual(f({ epi: '2' }), [2]);
  assert.deepEqual(f({ dias: 30 }), [1, 3]);
  assert.deepEqual(f({ semFoto: true }), [1]); // cancelada não cobra foto
  assert.deepEqual(f({ busca: 'óculos' }), [2]);
  assert.deepEqual(f({ busca: '999' }), [2]);
  assert.deepEqual(f({ busca: 'DESGASTE' }), [3]);
  assert.deepEqual(f({ busca: '20/11' }), [1, 3]);
});

test('CSV: uma linha por EPI, com ; e BOM, fórmulas neutralizadas e aspas dobradas; filtro de EPI vale para as linhas', () => {
  const l = [entrega({ funcionarioNome: '=HYPERLINK("x")', observacao: '+1', itens: [{ epiId: 1, nome: '@a', ca: '1', quantidade: 2 }, { epiId: 2, nome: '-b "c"', ca: '2', quantidade: 1 }], fotos: [{ id: 1 }] }),
    entrega({ id: 2, observacao: '\tx', cancelada: { motivo: 'm' } })];
  const csv = E.csvHistorico(l);
  assert.ok(csv.startsWith('﻿'));
  const linhas = csv.slice(1).split('\r\n');
  assert.equal(linhas[0], '"Data";"Funcionário";"EPI";"C.A.";"Qtd";"Observação";"Situação";"Foto"');
  assert.equal(linhas.length, 4);
  assert.equal(linhas[1], '"20/11/2026";"\'=HYPERLINK(""x"")";"\'@a";"1";"2";"\'+1";"Entregue";"Sim"');
  assert.match(linhas[2], /"'-b ""c"""/);
  assert.match(linhas[3], /"'\tx";"Cancelada: m";"Não"$/);
  assert.equal(E.csvHistorico(l, '2').slice(1).split('\r\n').length, 2);
});

test('texto do banco é escapado em todas as listas', () => {
  const hist = E.htmlHistorico([entrega({ funcionarioNome: MAL, observacao: MAL, criadoPor: MAL, itens: [{ epiId: 1, nome: MAL, ca: MAL, quantidade: 1 }], cancelada: { motivo: MAL, por: MAL } })], { registrar: true, gerir: true });
  const est = E.htmlEstoque([{ id: 1, nome: MAL, ca: MAL, minimo: 0, ativo: true, qtdEstoque: 1, baixo: false, duraDias: null }], { gerir: true });
  const res = E.htmlResumo({ qtdUnidades: 1, qtdUltimos30: 1, qtdFuncionarios: 1, baixos: [MAL], porMes: [{ mes: '2026-11', qtd: 1 }], porFuncionario: [{ nome: MAL, qtd: 1 }], porEpi: [{ nome: MAL, qtd: 1 }], estoque: [{ nome: MAL, qtd: 0, baixo: true }] });
  for (const h of [hist, est, res]) { assert.ok(!h.includes('<img'), h); assert.ok(h.includes('&lt;img')); }
});

test('histórico: selo "Assinado ✓" ou "Sem foto", botões conforme permissão; cancelada não recebe foto nem cancela', () => {
  const semFoto = E.htmlHistorico([entrega()], { registrar: true, gerir: true });
  assert.match(semFoto, /Sem foto/);
  assert.match(semFoto, /data-ac="fotografar"/);
  assert.match(semFoto, /data-ac="anexar"/);
  assert.match(semFoto, /data-ac="cancelar"/);
  assert.ok(!semFoto.includes('data-ac="fotos"'));
  const com = E.htmlHistorico([entrega({ fotos: [{ id: 1 }] })], { registrar: false, gerir: false });
  assert.match(com, /Assinado ✓/);
  assert.match(com, /data-ac="fotos"/);
  assert.ok(!/data-ac="(fotografar|anexar|cancelar)"/.test(com));
  const canc = E.htmlHistorico([entrega({ cancelada: { motivo: 'x', por: 'y' }, fotos: [{ id: 1 }] })], { registrar: true, gerir: true });
  assert.match(canc, /Cancelada/);
  assert.match(canc, /data-ac="fotos"/);
  assert.ok(!/data-ac="(fotografar|anexar|cancelar)"/.test(canc));
});

test('estoque: "Dura (est.)", baixo e controles de gestão só com a permissão', () => {
  const epis = [{ id: 1, nome: 'Luva', ca: '1', minimo: 5, ativo: true, qtdEstoque: 2, baixo: true, duraDias: 12 }, { id: 2, nome: 'Bota', ca: '2', minimo: 0, ativo: true, qtdEstoque: 3, baixo: false, duraDias: null }];
  const h = E.htmlEstoque(epis, { gerir: true });
  assert.match(h, /Dura \(est\.\)/);
  assert.match(h, /12 dias/);
  assert.match(h, /—/);
  assert.match(h, /baixo/);
  assert.match(h, /data-ac="entrada"/);
  assert.ok(!/data-ac=/.test(E.htmlEstoque(epis, { gerir: false })));
});

test('chave de envio: a mesma enquanto o conteúdo não muda (reenvio não duplica) e nova depois do sucesso', () => {
  let n = 0;
  const k = E.criarChaves(() => 'chave-' + (++n));
  assert.equal(k.de('a'), 'chave-1');
  assert.equal(k.de('a'), 'chave-1');
  assert.equal(k.de('b'), 'chave-2');
  k.usar('a');
  assert.equal(k.de('a'), 'chave-3');
});

test('epis.html: tema por último, CSP sem script inline, abas na ordem, Resumo administrativo e atrás do olho', () => {
  const h = ler('epis.html');
  assert.match(h, /script-src 'self';/);
  assert.match(h, /img-src 'self' data: blob:/);
  assert.ok(![...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].some(m => m[1].trim()), 'sem script inline');
  assert.ok(!/\son[a-z]+=/i.test(h), 'sem manipulador inline');
  assert.ok(h.lastIndexOf('rel="stylesheet"') === h.indexOf('rel="stylesheet" href="tema.css'), 'tema.css por último');
  assert.match(h, /<script src="olho_resumos\.js\?v=\d+"><\/script>/);
  assert.deepEqual([...h.matchAll(/data-aba="(\w+)"/g)].map(m => m[1]), ['registrar', 'historico', 'estoque', 'resumo']);
  assert.match(h, /data-aba="resumo"[^>]*data-perm="administrativo\.ver"[^>]*data-resumo/);
  assert.match(h, /id="aba-resumo"[^>]*data-perm="administrativo\.ver"[^>]*data-resumo/);
  assert.match(h, /data-aba="registrar"[^>]*data-perm="epi\.registrar"/);
  for (const s of ['layout.js', 'entregas_comum.js', 'camera_captura.js', 'situacoes.js', 'epis.js']) assert.ok(h.includes(s), s);
});

test('epis.js: o Resumo só é pedido ao abrir a aba; nada de armazenamento nem de rota de funcionários completa', () => {
  const js = ler('epis.js');
  assert.equal((js.match(/chamar\('\/epis\/resumo'\)/g) || []).length, 1);
  assert.ok(!/localStorage|sessionStorage|chamar\('\/funcionarios/.test(js));
  assert.ok(!/\.innerHTML\s*=\s*[^;]*\berr\.message/.test(js));
});

test('menu: "EPIs" logo abaixo de Funcionários, com a página protegida por epi.ver; piloto removido', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'funcionarios\.html'[^\n]*\n\s*\{ href: 'epis\.html', texto: 'EPIs'/);
  assert.match(l, /'epis\.html': \['epi\.ver'\]/);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'epi.html')));
});
