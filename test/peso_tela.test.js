// Peso na tela de orçamentos: lógica pura de peso_tela.js e conferência do HTML estático (o peso aparece SÓ em orcamentos.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../peso_tela.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const porta = (mudar = {}) => ({ frente: 'Porta de giro', qtd: 2, altura: 2000, largura: 500, furos: { lista: [], lados: [] }, detalhes: { perfil: 'P' },
  valor: 100, valorTela: 100, descricao: 'x', obs: 'y', historico: '+10', acessorios: [{ nome: 'A' }], ...mudar });

test('formatarKg: vírgula e 2 casas; vazio para nulo', () => {
  assert.equal(P.formatarKg(12.3456), '12,35 kg');
  assert.equal(P.formatarKg(0.5), '0,50 kg');
  assert.equal(P.formatarKg(null), '');
  assert.equal(P.formatarKg(undefined), '');
  assert.equal(P.formatarKg(NaN), '');
});

test('prepararConsulta: só os campos do peso (sem preço, descrição ou histórico), travados ficam de fora', () => {
  const lista = [porta(), { travado: true, frente: 'Serralheria', qtd: 1, valor: 5 }, { frente: 'Serralheria', qtd: 3, valor: 9, pecas: [1, 2, 3] }, porta({ frente: 'Porta de Correr' })];
  const c = P.prepararConsulta(lista);
  assert.deepEqual(c.indices, [0, 2, 3]);
  assert.deepEqual(Object.keys(c.corpo), ['itens']);
  assert.deepEqual(Object.keys(c.corpo.itens[0]).sort(), ['altura', 'detalhes', 'frente', 'furos', 'largura', 'qtd']);
  assert.deepEqual(c.corpo.itens[1], { frente: 'Serralheria', qtd: 3 });
  assert.ok(!JSON.stringify(c.corpo).includes('valor'));
  assert.equal(c.longo, false);
  assert.equal(P.prepararConsulta(Array(101).fill(porta())).longo, true);
  assert.equal(P.chaveDe(c.corpo), P.chaveDe(P.prepararConsulta(lista.map(x => ({ ...x, valor: 1, historico: '' }))).corpo)); // preço não muda a chave
});

test('resultadosDaLista: realinha com os índices, travado sem peso, total parcial com porta travada', () => {
  const lista = [porta(), { travado: true, frente: 'Porta de giro', qtd: 1 }, { frente: 'Avulso', qtd: 1 }];
  const c = P.prepararConsulta(lista);
  const resp = { itens: [{ pesoPorUnidadeKg: 5, pesoKg: 10, parcial: false, pendencias: [] }, { pesoKg: null, parcial: false, pendencias: null, motivo: 'sem cálculo de peso para este tipo' }],
    pesoDocumentoKg: 10, parcial: false };
  const r = P.resultadosDaLista(lista, c.indices, resp);
  assert.equal(r[0].kg, 10);
  assert.equal(r[1].kg, null);
  assert.match(r[1].motivo, /bloqueado/);
  assert.equal(r[2].kg, null);
  assert.match(r[2].motivo, /sem cálculo/);
  assert.deepEqual(P.totalDoDocumento(lista, resp), { kg: 10, parcial: true }); // item travado de porta fora do total
  assert.deepEqual(P.totalDoDocumento([porta()], resp), { kg: 10, parcial: false });
  assert.equal(P.totalDoDocumento([porta()], { pesoDocumentoKg: null, parcial: false }), null);
  assert.equal(P.totalDoDocumento([porta()], null), null);
  assert.deepEqual(P.resultadosDaLista(lista, c.indices, null).map(x => x.kg), [null, null, null]); // falha de rede: nada aparece
});

test('rotuloItem e rotuloTotal: parcial com tooltip, sem peso = traço', () => {
  assert.deepEqual(P.rotuloItem({ kg: 12.5, parcial: false }), { texto: '12,50 kg', titulo: '', parcial: false });
  const parcial = P.rotuloItem({ kg: 3, parcial: true, pendencias: [{ tipo: 'vidro', produto: 'Vidro 4mm', motivo: 'Peso não cadastrado.' }] });
  assert.equal(parcial.texto, '3,00 kg parcial');
  assert.match(parcial.titulo, /Vidro 4mm: Peso não cadastrado\./);
  assert.equal(P.rotuloItem({ kg: 0, parcial: true, pendencias: [] }).texto, 'sem peso cadastrado');
  assert.deepEqual(P.rotuloItem({ kg: null, motivo: 'sem cálculo de peso para este tipo' }), { texto: '—', titulo: 'sem cálculo de peso para este tipo', parcial: false });
  assert.equal(P.rotuloTotal({ kg: 30.996, parcial: false }), '31,00 kg');
  assert.equal(P.rotuloTotal({ kg: 30.996, parcial: true }), '31,00 kg (parcial)');
  assert.equal(P.rotuloTotal(null), '');
});

test('itemDoFormulario: só porta com perfil, altura e largura', () => {
  const f = { frente: 'Porta de giro', qtd: 1, altura: 2000, largura: 500, furos: { lista: [], lados: [] }, detalhes: { perfil: 'P' } };
  assert.ok(P.itemDoFormulario(f));
  assert.equal(P.itemDoFormulario({ ...f, altura: 0 }), null);
  assert.equal(P.itemDoFormulario({ ...f, detalhes: { perfil: '' } }), null);
  assert.equal(P.itemDoFormulario({ ...f, frente: 'Serralheria' }), null);
  assert.equal(P.itemDoFormulario(null), null);
});

test('orcamentos.html: elementos do peso (item em montagem, lista, total), script e consulta', () => {
  const h = ler('orcamentos.html');
  for (const trecho of ['id="grupo-peso-item"', 'id="f-peso-item"', 'id="grupo-peso-doc"', 'id="tot-peso"', 'class="peso-item"', 'data-peso="${i}"',
    '<script src="peso_tela.js', '/peso/itens', 'cachePeso', 'seqPesoLista', 'seqPesoForm', 'atualizarPesoLista()', 'atualizarPesoForm()'])
    assert.ok(h.includes(trecho), trecho);
  // a falha da consulta só esconde o peso
  assert.match(h, /catch \{ \/\* sem peso agora/);
  // CSP continua cobrindo o backend
  assert.match(h, /connect-src 'self' https:\/\/elegance-backend-hrho\.onrender\.com/);
});

test('o salvar não envia peso; a consulta de peso é a única chamada /peso/', () => {
  const h = ler('orcamentos.html');
  const ini = h.indexOf('const corpo = {\n                modo, tipo');
  const fim = h.indexOf("fetch(`${API_BASE}/ped_orc/salvar`");
  assert.ok(ini > 0 && fim > ini);
  assert.ok(!/peso/i.test(h.slice(ini, fim)), 'o corpo do salvar não pode mencionar peso');
  assert.equal(h.split("${API_BASE}/peso/itens").length - 1, 1);
  // o peso nunca é guardado no item (rascunho/JSON)
  assert.ok(!/it\.peso|item\.peso/.test(h));
});

test('PDF, gravação e outras telas não ganharam peso', () => {
  for (const f of ['pdf/ped_orc.js', 'calculo/leitura_vb.js', 'painel_inicial.html', 'entregas.html', 'corte.html', 'financeiro.html']) {
    const c = ler(f);
    assert.ok(!/calculo\/peso|peso_tela|\/peso\/itens|pesoKg|web_pesos|\bkg\b/i.test(c), f);
  }
  // /dados_pdf e /dados_pdf_vidros (index.js): nenhuma menção a peso dentro dos handlers
  const idx = ler('index.js');
  const a = idx.indexOf("registro.rota('get', '/dados_pdf'"), b = idx.indexOf("registro.rota('get', '/dados_pdf_vidros'");
  const fim = idx.indexOf('registro.rota(', b + 40);
  assert.ok(a > 0 && b > a && fim > b);
  assert.ok(!/peso/i.test(idx.slice(a, fim)));
  // a gravação do pedido só ganhou a extração de gruposDoItem: nada de peso gravado
  const ped = ler('rotas/ped_orc.js');
  assert.ok(!/web_pesos|pesoKg|bPESOb/.test(ped));
});

test('peso do item em montagem é escrito no desenho só na tela (nunca no modo limpo que vai para o PDF)', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.match(h, /if \(!limpo && pesoFormTexto\) \{[^}]*cota\('Peso: ' \+ pesoFormTexto/);
  assert.match(h, /let pesoFormTexto = '';/);
  assert.ok(h.indexOf("let pesoFormTexto") < h.indexOf("function desenharVisualizacao"), 'declarado antes do desenho');
});
