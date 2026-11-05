// Foto do produto: a web grava em cadastro_de_produtos.IMAGEM (a mesma coluna que as telas de portas/perfis do VB leem).
// Decisão do dono (2026-11-05): o banco real não tinha a coluna; a web a cria na subida. É a ÚNICA alteração de tabela do VB
// feita pela web: só ADD COLUMN, nula (os produtos sem foto continuam válidos), idempotente, sem apagar nem mudar dado.
async function garantirColunaImagemProduto(pool) {
  const [[c]] = await pool.execute(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cadastro_de_produtos' AND COLUMN_NAME = 'IMAGEM'");
  if (Number(c?.n)) return { feito: false };
  await pool.execute('ALTER TABLE cadastro_de_produtos ADD COLUMN IMAGEM LONGBLOB NULL');
  return { feito: true };
}

module.exports = { garantirColunaImagemProduto };
