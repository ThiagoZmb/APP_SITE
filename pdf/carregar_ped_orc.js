// Carregamento dos dados do PDF do pedido/orçamento (usado por GET /dados_pdf e pelo portal do cliente).
// Dividido em cabeçalho e corpo para que quem chama confira os estados do usuário entre os dois.
const { carimboItens } = require('../calculo/leitura_vb');
const { validarPng } = require('../calculo/png');

async function carregarCabecalhoPedOrc(pool, numero, tipo) {
  const [cabs] = await pool.execute(
    `SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL,
              SUB_TOTAL, TOTAL, DESCONTO
       FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
  return cabs.length === 0 ? null : cabs[0];
}

async function carregarCorpoPedOrc(pool, { numero, tipo, cab, producao }) {
  const [itens] = await pool.execute(
    `SELECT * FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
  const [v4] = await pool.execute(
    `SELECT * FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
  const [serr] = await pool.execute(
    `SELECT * FROM ped_orc_serralheria WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
  const [comps] = await pool.execute(
    `SELECT * FROM ped_orc_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
  const [compSerr] = await pool.execute(
    `SELECT * FROM ped_orc_serralheria_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
  const [furos] = await pool.execute(
    `SELECT * FROM furacao_pedidos_orcamentos WHERE NUMERO = ? AND TIPO = ? ORDER BY id`, [numero, tipo]);
  let medicao = '';
  if (producao) {
    const [med] = await pool.execute('SELECT MEDICAO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [cab.RAZAO_SOCIAL]);
    medicao = med[0]?.MEDICAO ?? '';
  }
  // desenhos das portas guardados na configuração: só valem se o carimbo ainda bate com os itens de agora (o VB pode ter mudado o documento);
  // qualquer erro ao lê-los deixa a coluna Imagem vazia, nunca derruba o PDF
  let desenhos = {};
  try {
    const [guardados] = await pool.execute('SELECT item, png, carimbo FROM web_item_desenhos WHERE tipo = ? AND numero = ?', [tipo, numero]);
    const carimbo = carimboItens({ lista: itens, itensV4: v4, furacao: furos });
    // só entra imagem que ainda vale (carimbo) e que decodifica direito: PNG corrompido derrubaria o processo dentro do pdfkit
    for (const d of guardados) if (d.carimbo === carimbo && validarPng(d.png).ok) desenhos[Number(d.item)] = d.png;
  } catch { desenhos = {}; }
  return { itens, v4, serr, comps, compSerr, furos, medicao, desenhos };
}

module.exports = { carregarCabecalhoPedOrc, carregarCorpoPedOrc };
