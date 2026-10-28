// Rota administrativa que copia nf_entrada / nf_saida do VB para web_notas_fiscais.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoNotas, prepararNotas } = require('./apoio/bancoNotas');

process.env.ADMIN_KEY = 'chave-de-teste';
const importar = (chamar, corpo, chave = 'chave-de-teste') => fetch(chamar.url + '/admin/importar_notas', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(chave ? { 'x-admin-key': chave } : {}) }, body: JSON.stringify(corpo ?? {}) });

async function cenario(t) {
  const banco = bancoNotas();
  banco.estado.nfEntrada.push({ NUMERO: '000123', RAZAO_FABRICANTE: 'Alumínios Brasil', DATA: '2026-10-10 00:00:00', VALOR_TOTAL: 1500.5 },
    { NUMERO: '124', RAZAO_FABRICANTE: 'Fantasma', DATA: '2026-10-11', VALOR_TOTAL: 10 }, { NUMERO: 'x-1', RAZAO_FABRICANTE: 'Alumínios Brasil', DATA: '2026-10-11', VALOR_TOTAL: 10 });
  banco.estado.nfSaida.push({ NUMERO: 77, RAZAO_SOCIAL: 'Construtora Alfa', DATA: '2026-10-12', VALOR: 900 });
  const { chamar, url } = await prepararNotas(t, { banco });
  chamar.url = url;
  return { banco, chamar };
}

test('importar notas: sem a chave de admin dá 403 e nada é lido nem gravado', async t => {
  const { banco, chamar } = await cenario(t);
  assert.equal((await importar(chamar, { simular: false }, null)).status, 403);
  assert.equal((await importar(chamar, { simular: false }, 'errada')).status, 403);
  assert.equal(banco.notas.length, 0);
});

test('importar notas: por padrão só simula (relatório, nada gravado)', async t => {
  const { banco, chamar } = await cenario(t);
  const r = await importar(chamar, {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.simulacao, true);
  assert.deepEqual([j.qtdEntrariam, j.qtdIgnoradas, j.qtdSemCadastro, j.qtdJaImportadas], [3, 1, 1, 0]);
  assert.deepEqual(j.ignoradas, [{ tipo: 'entrada', numero: 'x-1', motivo: 'número inválido' }]);
  assert.deepEqual(j.semCadastro, [{ tipo: 'entrada', numero: '124', nome: 'Fantasma' }]);
  assert.equal(banco.notas.length, 0);
  assert.equal(banco.auditoria.length, 0);
});

test('importar notas: simular:false grava, audita só contagens e rodar de novo não duplica', async t => {
  const { banco, chamar } = await cenario(t);
  let j = await (await importar(chamar, { simular: false })).json();
  assert.deepEqual([j.simulacao, j.qtdImportadas], [false, 3]);
  assert.equal(banco.notas.length, 3);
  const n = banco.notas.find(x => x.numero === '123');
  assert.deepEqual([n.tipo, n.serie, n.chave, n.data_emissao, n.contraparte_codigo, n.contraparte_nome, Number(n.valor_total), n.situacao, n.criado_por],
    ['entrada', '1', null, '2026-10-10', 1, 'Alumínios Brasil', 1500.5, 'ativa', 'importação do VB']);
  assert.ok(banco.notas.every(x => x.observacao === null), 'a observação das notas importadas fica em branco');
  assert.equal(banco.notas.find(x => x.numero === '124').contraparte_codigo, 0);
  assert.equal(banco.notas.find(x => x.tipo === 'saida').contraparte_codigo, 1);
  const a = banco.auditoria.at(-1);
  assert.equal(a.acao, 'notas_importadas_vb');
  assert.deepEqual(a.detalhe, { qtdImportadas: 3, qtdIgnoradas: 1, qtdSemCadastro: 1 });
  j = await (await importar(chamar, { simular: false })).json();
  assert.deepEqual([j.qtdImportadas, j.qtdJaImportadas], [0, 3]);
  assert.equal(banco.notas.length, 3);
});

test('importar notas: erro ao ler as tabelas do VB vira 500 sem gravar nada', async t => {
  const { banco, chamar } = await cenario(t);
  banco.estado.falharLeituraNf = true;
  assert.equal((await importar(chamar, { simular: false })).status, 500);
  assert.equal(banco.notas.length, 0);
});
