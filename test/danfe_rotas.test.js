// Rotas do DANFE (banco simulado em test/apoio/bancoDanfe.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoDanfe, prepararDanfe, chaveCom, pdfBytes } = require('./apoio/bancoDanfe');
const { REGEX_VALOR } = require('../seguranca/valores');

const EMPRESA = '08951388000118';
const OUTRO = '11222333000181';
const nomesDeCampos = v => (Array.isArray(v) ? v.flatMap(nomesDeCampos) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...nomesDeCampos(x)]) : []);

test('danfe envio: grava, audita só chave e tamanho e é idempotente', async t => {
  const { banco, enviar } = await prepararDanfe(t);
  const chave = chaveCom({ numero: 11290 });
  const pdf = pdfBytes('conteudo secreto');
  let r = await enviar(chave, pdf);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.ok, j.ja_existia, j.substituida, j.cnpjDiferente], [true, false, false, false]);
  const d = banco.danfe[0];
  assert.deepEqual([d.chave, d.numero_nf, d.serie, d.modelo, d.cnpj_emitente, d.data_emissao_aamm, d.tamanho], [chave, 11290, 1, '55', EMPRESA, '2606', pdf.length]);
  assert.equal(d.sha256.length, 64);
  assert.equal(banco.auditoria[0].acao, 'danfe_enviado');
  assert.deepEqual(banco.auditoria[0].detalhe, { chave, tamanho: pdf.length });
  r = await enviar(chave, pdf);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ja_existia, true);
  assert.equal(banco.danfe.length, 1);
  assert.equal(banco.auditoria.length, 1);
});

test('danfe envio: PDF diferente na mesma chave substitui e audita', async t => {
  const { banco, enviar } = await prepararDanfe(t);
  const chave = chaveCom({});
  await enviar(chave, pdfBytes('um'));
  const r = await enviar(chave, pdfBytes('dois diferente'));
  const j = await r.json();
  assert.deepEqual([r.status, j.ja_existia, j.substituida], [200, true, true]);
  assert.equal(banco.danfe.length, 1);
  assert.equal(banco.danfe[0].tamanho, pdfBytes('dois diferente').length);
  assert.equal(banco.auditoria[1].acao, 'danfe_substituido');
});

test('danfe envio: recusa chave inválida, modelo 65, PDF inválido, vazio e acima de 2 MB', async t => {
  const { banco, enviar } = await prepararDanfe(t);
  const chave = chaveCom({});
  const dvErrado = chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10);
  assert.equal((await enviar(dvErrado, pdfBytes())).status, 400);
  assert.equal((await enviar('123', pdfBytes())).status, 400);
  assert.equal((await enviar(chaveCom({ modelo: '65' }), pdfBytes())).status, 400);
  assert.equal((await enviar(chave, Buffer.from('<html>nao e pdf</html>'))).status, 400);
  assert.equal((await enviar(chave, Buffer.alloc(0))).status, 400);
  assert.equal((await enviar(chave, Buffer.from('%PDF-1.4'), 'text/plain')).status, 400);
  const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2 * 1024 * 1024 + 10)]);
  assert.equal((await enviar(chave, grande)).status, 413);
  assert.equal(banco.danfe.length, 0);
});

test('danfe envio: avisa (sem recusar) quando o CNPJ difere do mais comum', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 1 }); banco.semear.danfe({ numero: 2 });
  const { enviar } = await prepararDanfe(t, { banco });
  const j = await (await enviar(chaveCom({ cnpj: OUTRO, numero: 3 }), pdfBytes('x'))).json();
  assert.deepEqual([j.ok, j.cnpjDiferente], [true, true]);
  assert.equal(banco.danfe.length, 3);
});

test('danfe envio: ER_DUP_ENTRY (envio simultâneo) vira 409', async t => {
  const banco = bancoDanfe();
  banco.estado.falharInsertDuplicado = true;
  const { enviar } = await prepararDanfe(t, { banco });
  assert.equal((await enviar(chaveCom({}), pdfBytes())).status, 409);
});

test('danfe: sem permissão responde 403 em todas as rotas', async t => {
  const banco = bancoDanfe();
  const chave = banco.semear.danfe({}).chave;
  banco.semear.pedido({});
  const { chamar, enviar } = await prepararDanfe(t, { perfil: 'Sem acesso', banco });
  assert.equal((await enviar(chave, pdfBytes())).status, 403);
  assert.equal((await chamar('/danfe/existentes', 'POST', { chaves: [chave] })).status, 403);
  assert.equal((await chamar('/danfe/pedido/100')).status, 403);
  assert.equal((await chamar(`/danfe/${chave}/pdf`)).status, 403);
  assert.equal((await chamar('/danfe/lista')).status, 403);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave, pedido: 100 })).status, 403);
  assert.equal((await chamar('/danfe/vinculo', 'DELETE', { chave, pedido: 100 })).status, 403);
});

test('danfe: quem só tem danfe.ver abre, mas não envia, lista nem vincula', async t => {
  const banco = bancoDanfe();
  const chave = banco.semear.danfe({}).chave;
  banco.semear.pedido({}); banco.semear.fluxo({});
  const { chamar, enviar } = await prepararDanfe(t, { perfil: 'Só ver', banco });
  assert.equal((await chamar('/danfe/pedido/100')).status, 200);
  assert.equal((await chamar(`/danfe/${chave}/pdf`)).status, 200);
  assert.equal((await enviar(chaveCom({ numero: 5 }), pdfBytes())).status, 403);
  assert.equal((await chamar('/danfe/lista')).status, 403);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave, pedido: 100 })).status, 403);
});

test('danfe existentes: devolve só as chaves que já estão no banco', async t => {
  const banco = bancoDanfe();
  const a = banco.semear.danfe({ numero: 1 }).chave;
  const b = chaveCom({ numero: 2 });
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/existentes', 'POST', { chaves: [a, b, 'lixo'] })).json();
  assert.deepEqual(j.existentes, [a]);
  assert.deepEqual((await (await chamar('/danfe/existentes', 'POST', { chaves: [] })).json()).existentes, []);
  assert.equal((await chamar('/danfe/existentes', 'POST', { chaves: 'x' })).status, 400);
  assert.equal((await chamar('/danfe/existentes', 'POST', { chaves: Array(501).fill(a) })).status, 400);
});

test('danfe pedido: ligação automática pelo financeiro (nota da empresa, modelo 55)', async t => {
  const banco = bancoDanfe();
  const nf = banco.semear.danfe({ numero: 11290 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '011290' });
  const { chamar } = await prepararDanfe(t, { banco, perfil: 'Só ver' });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.equal(j.notas.length, 1);
  assert.deepEqual([j.notas[0].chave, j.notas[0].numeroNf, j.notas[0].serie, j.notas[0].origem], [nf.chave, 11290, 1, 'financeiro']);
  assert.deepEqual(j.semArquivo, []);
});

test('danfe pedido: nota composta "8862/8887" e semArquivo para o que não foi enviado', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 8862 }); banco.semear.danfe({ numero: 8887 }); banco.semear.danfe({ numero: 9999 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '8862/8887' });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '7777, 8862' });
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas.map(n => n.numeroNf), [8862, 8887]);
  assert.deepEqual(j.semArquivo, [7777]);
});

test('danfe pedido: CNPJ de outro emitente não liga automaticamente', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 50 }); banco.semear.danfe({ numero: 51 }); // empresa = a mais comum
  banco.semear.danfe({ numero: 11290, cnpj: OUTRO });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas, []);
  assert.deepEqual(j.semArquivo, [11290]);
});

test('danfe pedido: EMPRESA_CNPJ da variável de ambiente manda sobre o mais comum', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 50 }); banco.semear.danfe({ numero: 51 });
  banco.semear.danfe({ numero: 11290, cnpj: OUTRO });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  process.env.EMPRESA_CNPJ = '11.222.333/0001-81';
  t.after(() => { delete process.env.EMPRESA_CNPJ; });
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas.map(n => n.numeroNf), [11290]);
});

test('danfe pedido: nota modelo diferente de 55 não liga automaticamente', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 11290 });
  banco.estado.danfe[0].modelo = '65'; // dado antigo/estranho no banco
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  const { chamar } = await prepararDanfe(t, { banco });
  assert.deepEqual((await (await chamar('/danfe/pedido/100')).json()).notas, []);
});

test('danfe pedido: vínculo manual vem primeiro e não duplica a mesma chave', async t => {
  const banco = bancoDanfe();
  const auto = banco.semear.danfe({ numero: 11290 });
  const manual = banco.semear.danfe({ numero: 500 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  banco.semear.vinculo(manual.chave, 100);
  banco.semear.vinculo(auto.chave, 100); // também ligada à mão: aparece uma vez só, como manual
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas.map(n => [n.numeroNf, n.origem]), [[500, 'manual'], [11290, 'manual']]);
  assert.deepEqual(j.semArquivo, []);
});

test('danfe pedido: manual aparece antes da automática', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 11290 });
  const manual = banco.semear.danfe({ numero: 500 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  banco.semear.vinculo(manual.chave, 100);
  const { chamar } = await prepararDanfe(t, { banco });
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas.map(n => [n.numeroNf, n.origem]), [[500, 'manual'], [11290, 'financeiro']]);
});

test('danfe pedido: só vale TIPO Pedido (orçamento de mesmo número é 404; lançamento de outro pedido não conta)', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 11290 });
  banco.semear.pedido({ NUMERO: 200, TIPO: 'Orçamento' });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '200', NOTA_FISCAL: '11290' });
  const { chamar } = await prepararDanfe(t, { banco });
  assert.equal((await chamar('/danfe/pedido/200')).status, 404);
  assert.equal((await chamar('/danfe/pedido/abc')).status, 404);
  assert.deepEqual((await (await chamar('/danfe/pedido/100')).json()).notas, []);
});

test('danfe pedido: estados restritos (403 para cliente de outro estado)', async t => {
  const banco = bancoDanfe();
  banco.semear.danfe({ numero: 11290 });
  banco.semear.pedido({ NUMERO: 100, RAZAO_SOCIAL: 'Construtora Alfa' }); // RJ
  banco.semear.pedido({ NUMERO: 101, RAZAO_SOCIAL: 'Obras Beta' }); // SP
  banco.semear.fluxo({ PEDIDO: '100' }); banco.semear.fluxo({ PEDIDO: '101' });
  const { chamar } = await prepararDanfe(t, { banco, perfil: 'Só ver', estados: ['RJ'] });
  assert.equal((await chamar('/danfe/pedido/100')).status, 200);
  assert.equal((await chamar('/danfe/pedido/101')).status, 403);
});

test('danfe pdf: devolve o PDF com cabeçalhos certos; chave inválida ou inexistente = 404', async t => {
  const banco = bancoDanfe();
  const pdf = pdfBytes('meu danfe');
  const d = banco.semear.danfe({ numero: 11290, pdf });
  const { chamar } = await prepararDanfe(t, { banco });
  const r = await chamar(`/danfe/${d.chave}/pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('content-disposition'), 'inline; filename="NF-11290.pdf"');
  assert.match(r.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf);
  assert.equal((await chamar('/danfe/123/pdf')).status, 404);
  assert.equal((await chamar(`/danfe/${chaveCom({ numero: 1 })}/pdf`)).status, 404);
});

test('danfe pdf: com estados restritos só abre nota ligada a pedido visível', async t => {
  const banco = bancoDanfe();
  const rj = banco.semear.danfe({ numero: 11290 });       // ligada pelo financeiro ao pedido do RJ
  const sp = banco.semear.danfe({ numero: 22222 });       // ligada à mão ao pedido de SP
  const solta = banco.semear.danfe({ numero: 33333 });    // sem pedido
  banco.semear.pedido({ NUMERO: 100, RAZAO_SOCIAL: 'Construtora Alfa' });
  banco.semear.pedido({ NUMERO: 101, RAZAO_SOCIAL: 'Obras Beta' });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '11290' });
  banco.semear.vinculo(sp.chave, 101);
  const a = await prepararDanfe(t, { banco, perfil: 'Só ver', estados: ['RJ'] });
  assert.equal((await a.chamar(`/danfe/${rj.chave}/pdf`)).status, 200);
  assert.equal((await a.chamar(`/danfe/${sp.chave}/pdf`)).status, 403);
  assert.equal((await a.chamar(`/danfe/${solta.chave}/pdf`)).status, 403);
});

test('danfe pdf: administração com estados restritos abre qualquer nota', async t => {
  const banco = bancoDanfe();
  const solta = banco.semear.danfe({ numero: 33333 });
  const { chamar } = await prepararDanfe(t, { banco, perfil: 'Administrador', estados: ['RJ'] });
  assert.equal((await chamar(`/danfe/${solta.chave}/pdf`)).status, 200);
});

test('danfe vínculo: vincular, repetir, listar e desvincular (audita; só a linha manual)', async t => {
  const banco = bancoDanfe();
  const n = banco.semear.danfe({ numero: 500 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.fluxo({ PEDIDO: '100', NOTA_FISCAL: '500' });
  const { chamar } = await prepararDanfe(t, { banco });
  let r = await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: '100' });
  assert.deepEqual([r.status, (await r.json()).ja_existia], [200, false]);
  r = await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: 100 });
  assert.equal((await r.json()).ja_existia, true);
  assert.equal(banco.vinculos.length, 1);
  assert.deepEqual(banco.auditoria.map(a => a.acao), ['danfe_vinculado']);
  const lista = await (await chamar('/danfe/lista?q=500')).json();
  assert.deepEqual([lista.notas.length, lista.notas[0].numeroNf, lista.notas[0].pedidos], [1, 500, [100]]);
  r = await chamar('/danfe/vinculo', 'DELETE', { chave: n.chave, pedido: 100 });
  assert.equal(r.status, 200);
  assert.equal(banco.vinculos.length, 0);
  assert.equal(banco.auditoria[1].acao, 'danfe_desvinculado');
  assert.equal((await chamar('/danfe/vinculo', 'DELETE', { chave: n.chave, pedido: 100 })).status, 404);
  const j = await (await chamar('/danfe/pedido/100')).json();
  assert.deepEqual(j.notas.map(x => x.origem), ['financeiro']); // a automática continua valendo
});

test('danfe vínculo: nota não enviada, pedido inexistente, orçamento e dados inválidos', async t => {
  const banco = bancoDanfe();
  const n = banco.semear.danfe({ numero: 500 });
  banco.semear.pedido({ NUMERO: 100 });
  banco.semear.pedido({ NUMERO: 300, TIPO: 'Orçamento' });
  const { chamar } = await prepararDanfe(t, { banco });
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave: chaveCom({ numero: 1 }), pedido: 100 })).status, 404);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: 999 })).status, 404);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: 300 })).status, 404);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave: 'x', pedido: 100 })).status, 400);
  assert.equal((await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: 'abc' })).status, 400);
  assert.equal(banco.vinculos.length, 0);
});

test('danfe lista: busca por número ou chave, limite e texto sem dígitos', async t => {
  const banco = bancoDanfe();
  const a = banco.semear.danfe({ numero: 111, enviado_em: '2026-10-01 10:00:00' });
  banco.semear.danfe({ numero: 222, enviado_em: '2026-10-02 10:00:00' });
  const { chamar } = await prepararDanfe(t, { banco });
  let j = await (await chamar('/danfe/lista')).json();
  assert.deepEqual(j.notas.map(n => n.numeroNf), [222, 111]);
  j = await (await chamar('/danfe/lista?q=111')).json();
  assert.deepEqual(j.notas.map(n => n.numeroNf), [111]);
  j = await (await chamar('/danfe/lista?q=' + a.chave)).json();
  assert.deepEqual(j.notas.map(n => n.numeroNf), [111]);
  j = await (await chamar('/danfe/lista?limite=1')).json();
  assert.deepEqual([j.notas.length, j.limitada], [1, true]);
  assert.deepEqual((await (await chamar('/danfe/lista?q=abc')).json()).notas, []);
});

test('danfe: nenhum nome de campo das respostas casa com REGEX_VALOR e o PDF nunca vai em JSON', async t => {
  const banco = bancoDanfe();
  const n = banco.semear.danfe({ numero: 11290 });
  banco.semear.pedido({ NUMERO: 100 }); banco.semear.fluxo({});
  banco.semear.vinculo(n.chave, 100);
  const { chamar, enviar } = await prepararDanfe(t, { banco });
  const respostas = [
    await (await chamar('/danfe/pedido/100')).json(), await (await chamar('/danfe/lista')).json(),
    await (await chamar('/danfe/existentes', 'POST', { chaves: [n.chave] })).json(),
    await (await chamar('/danfe/vinculo', 'POST', { chave: n.chave, pedido: 100 })).json(),
    await (await enviar(chaveCom({ numero: 9 }), pdfBytes('z'))).json()
  ];
  for (const campo of nomesDeCampos(respostas)) assert.ok(!REGEX_VALOR.test(campo), 'campo com nome de dinheiro: ' + campo);
  assert.ok(!JSON.stringify(respostas).includes('%PDF'));
});

test('danfe: o servidor sobe com as rotas novas (registro.verificar)', () => {
  const { registro } = require('../index.js');
  assert.doesNotThrow(() => registro.verificar());
});
