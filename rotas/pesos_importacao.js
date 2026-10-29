// Importação única das estimativas de peso (docs/pesos_estimados_perfis.json) para web_pesos.
// POST /admin/importar_pesos com a chave no cabeçalho x-admin-key (nunca na URL), como /admin/importar_notas.
// Por padrão SÓ SIMULA (relatório, nada gravado). Para gravar: { "simular": false }. Transação única, idempotente.
// Nunca sobrescreve: peso já cadastrado (qualquer origem) fica intacto e aparece como "já cadastrado".
const fs = require('node:fs');
const path = require('node:path');
const { emTransacao, agoraLocal } = require('./transacao');
const { ORIGEM_IMPORTADA, planejarImportacaoPesos } = require('../calculo/pesos_importacao');

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'docs', 'pesos_estimados_perfis.json');
const POR = 'importação das estimativas';

function registrarImportacaoPesos({ publica, pool, arquivo = ARQUIVO_PADRAO }) {
  publica('post', '/admin/importar_pesos', async (req, res) => {
    const chave = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Acesso negado' });
    const simular = req.body?.simular !== false;
    let estimativas;
    try { estimativas = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
    catch (err) { console.error('Erro /admin/importar_pesos (arquivo):', err.message); return res.status(500).json({ error: 'Não foi possível ler o arquivo de estimativas.' }); }

    const relatorioDe = plano => ({
      simulacao: simular, qtdInserir: plano.inserir.length, qtdIgnorar: plano.ignorar.length,
      inserir: plano.inserir.map(p => ({ tipo: p.tipo, produto: p.produto, unidadePeso: p.unidadePeso, kgPorUnidade: p.kgPorUnidade, confianca: p.confianca })),
      ignorar: plano.ignorar
    });

    if (simular) {
      try {
        const [existentes] = await pool.execute('SELECT tipo, produto FROM web_pesos');
        return res.json(relatorioDe(planejarImportacaoPesos({ estimativas, existentes })));
      } catch (err) {
        console.error('Erro /admin/importar_pesos:', err.message);
        return res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
      }
    }

    const r = await emTransacao(pool, res, 'POST /admin/importar_pesos', async conn => {
      // dentro da transação, com as linhas travadas: duas execuções ao mesmo tempo não duplicam nem sobrescrevem
      const [existentes] = await conn.execute('SELECT tipo, produto FROM web_pesos FOR UPDATE');
      const plano = planejarImportacaoPesos({ estimativas, existentes });
      const quando = agoraLocal();
      for (const p of plano.inserir) {
        await conn.execute(
          'INSERT INTO web_pesos (tipo, produto, unidade_peso, valor, origem, confianca, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [p.tipo, p.produto, p.unidadePeso, p.kgPorUnidade, ORIGEM_IMPORTADA, p.confianca, POR, quando]);
      }
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [quando, 'sistema', 'pesos_importados', '', JSON.stringify({ qtdImportados: plano.inserir.length, qtdIgnorados: plano.ignorar.length })]);
      return relatorioDe(plano);
    });
    if (r) res.json({ ...r, simulacao: false, qtdImportados: r.qtdInserir });
  });
}

module.exports = { registrarImportacaoPesos };
