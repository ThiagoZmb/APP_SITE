// Cópia única das notas do VB (nf_entrada e nf_saida) para web_notas_fiscais, para a web poder deixar de depender do VB.
// POST /admin/importar_notas com a chave no cabeçalho x-admin-key (nunca na URL), como /migrar_senhas.
// Por padrão SÓ SIMULA: devolve o relatório e não grava. Para gravar, o corpo precisa ter { "simular": false }.
// Lê as tabelas do VB sem alterá-las; a gravação é uma transação só e pode rodar de novo sem duplicar.
const { emTransacao, agoraLocal } = require('./transacao');
const { planejarImportacao } = require('../calculo/notas_importacao');

const LIMITE_RELATORIO = 200;
const LOTE = 100;

function registrarImportacaoNotas({ publica, pool }) {
  publica('post', '/admin/importar_notas', async (req, res) => {
    const chave = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Acesso negado' });
    const simular = req.body?.simular !== false;
    let plano;
    try {
      const [entradas] = await pool.execute('SELECT * FROM nf_entrada');
      const [saidas] = await pool.execute('SELECT * FROM nf_saida');
      const [fornecedores] = await pool.execute('SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores');
      const [clientes] = await pool.execute('SELECT CODIGO, RAZAO_SOCIAL FROM cadastro_clientes');
      const [existentes] = await pool.execute('SELECT tipo, serie, numero, contraparte_codigo FROM web_notas_fiscais');
      plano = planejarImportacao({ entradas, saidas, fornecedores, clientes, existentes });
    } catch (err) {
      console.error('Erro /admin/importar_notas:', err.message);
      return res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
    }
    const relatorio = {
      simulacao: simular,
      qtdEntrariam: plano.entram.length, qtdJaImportadas: plano.qtdJaImportadas, qtdValorZero: plano.qtdValorZero,
      qtdIgnoradas: plano.ignoradas.length, qtdSemCadastro: plano.semCadastro.length,
      ignoradas: plano.ignoradas.slice(0, LIMITE_RELATORIO), semCadastro: plano.semCadastro.slice(0, LIMITE_RELATORIO),
      relatorioCortado: plano.ignoradas.length > LIMITE_RELATORIO || plano.semCadastro.length > LIMITE_RELATORIO
    };
    if (simular) return res.json(relatorio);

    const r = await emTransacao(pool, res, 'POST /admin/importar_notas', async conn => {
      const quando = agoraLocal();
      for (let i = 0; i < plano.entram.length; i += LOTE) {
        const lote = plano.entram.slice(i, i + LOTE);
        await conn.execute(
          `INSERT INTO web_notas_fiscais (tipo, numero, serie, data_emissao, contraparte_codigo, contraparte_nome, valor_total, observacao, situacao, criado_por, criado_em) VALUES ${lote.map(() => "(?, ?, ?, ?, ?, ?, ?, NULL, 'ativa', ?, ?)").join(', ')}`,
          lote.flatMap(n => [n.tipo, n.numero, n.serie, n.dataEmissao, n.contraparteCodigo, n.contraparteNome, n.valorTotal, 'importação do VB', quando]));
      }
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [quando, 'sistema', 'notas_importadas_vb', '', JSON.stringify({ qtdImportadas: plano.entram.length, qtdIgnoradas: plano.ignoradas.length, qtdSemCadastro: plano.semCadastro.length })]);
      return { qtdImportadas: plano.entram.length };
    });
    if (r) res.json({ ...relatorio, ...r });
  });
}

module.exports = { registrarImportacaoNotas };
