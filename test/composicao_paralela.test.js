// Cada ida ao banco custa ~190 ms entre o Render e o HostGator (medido em 2026-11-09): consultas independentes têm que
// sair JUNTAS, não uma depois da outra. Aqui: as 4 leituras da composição saem em paralelo e o resultado não muda.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarComposicao } = require('../calculo/composicao_documentos');

// pool falso que mede quantas consultas estão em andamento ao mesmo tempo
function poolMedidor(respostas) {
  const estado = { emAndamento: 0, maximo: 0, chamadas: [] };
  return {
    estado,
    async execute(sql, params) {
      estado.chamadas.push(sql); estado.emAndamento += 1; estado.maximo = Math.max(estado.maximo, estado.emAndamento);
      await new Promise(r => setTimeout(r, 15));
      estado.emAndamento -= 1;
      for (const [re, linhas] of respostas) if (re.test(sql)) return [linhas, []];
      return [[], []];
    }
  };
}

test('carregarComposicao: as 4 leituras saem juntas (máximo de 4 em andamento) e o resultado é o mesmo', async () => {
  const pool = poolMedidor([
    [/FROM ped_orc_itens_v4/, [{ NUMERO: 10, ITEM: 1, ITEM_PEDIDO: 1, PERFIL: 'P1', ACABAMENTO_PERFIL: 'Anodizado', REVESTIMENTO: '' }]],
    [/FROM vidros/, [{ NUMERO: 10, ITEM: 1 }]],
    [/FROM ped_orc_serralheria/, [{ NUMERO: 11 }]],
    [/FROM ped_orc_lista_itens/, [{ NUMERO: 10, TIPO_PRODUTO: 'Portas' }, { NUMERO: 11, TIPO_PRODUTO: 'Metalons' }]]
  ]);
  const mapa = await carregarComposicao(pool, 'Pedido');
  assert.equal(pool.estado.chamadas.length, 4);
  assert.equal(pool.estado.maximo, 4, 'as 4 consultas independentes não podem esperar umas pelas outras');
  assert.ok(mapa instanceof Map);
  assert.ok(mapa.has(10) || mapa.has(11), 'a composição continua sendo montada com os dados lidos');
});

test('carregarComposicao: se uma das leituras falha, o erro sobe (quem chama decide: a lista sai sem ícones)', async () => {
  const pool = { async execute(sql) { if (/FROM vidros/.test(sql)) throw new Error('banco caiu'); return [[], []]; } };
  await assert.rejects(carregarComposicao(pool, 'Pedido'), /banco caiu/);
});

test('index.js: /dados_lista busca a lista e a composição juntas; o pool mantém as conexões quentes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /Promise\.all\(\[\s*pool\.execute\(sql, \[tipo, \.\.\.est\.params\]\),\s*composicaoDosDocumentos\(tipo\)\s*\]\)/);
  // idleTimeout padrão do mysql2 = 60 s: depois de 1 min parado, a próxima requisição pagava uma conexão nova (~1 s a 190 ms de ida e volta)
  assert.match(src, /idleTimeout: \d/);
  assert.match(src, /enableKeepAlive: true/);
});
