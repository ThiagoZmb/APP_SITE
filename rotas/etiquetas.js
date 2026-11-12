// Etiquetas de pedido/produção (Zebra): devolve o ZPL de um Pedido, uma etiqueta por item. Só leitura, só Pedido, sem dinheiro.
// O envio à impressora é do serviço local do PC da empresa (local/zebra.js); aqui só se monta o ZPL (calculo/etiqueta_zpl.js).
const { montarEtiquetas } = require('../calculo/etiqueta_zpl');
const { textoVB } = require('../pdf/ped_orc');

const PERMISSAO = ['pedidos.pdf'];

function registrarEtiquetas({ rota, pool, foraDosEstados }) {
  rota('get', '/etiquetas/pedido/:numero', PERMISSAO, async (req, res) => {
    const numero = String(req.params.numero ?? '').trim();
    if (!/^\d{1,10}$/.test(numero)) return res.status(400).json({ error: 'Número de pedido inválido.' });
    try {
      const [cabs] = await pool.execute("SELECT RAZAO_SOCIAL, CLIENTE_FINAL FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'", [numero]);
      if (cabs.length === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const cab = cabs[0];
      // mesma regra de /dados_pdf: só abre cliente dentro dos estados do usuário
      if ((req.acesso.estados || []).length) {
        const [est] = await pool.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [cab.RAZAO_SOCIAL]);
        if (foraDosEstados(req, res, est[0]?.ESTADO)) return;
      }
      const [itens] = await pool.execute("SELECT ITEM, QTD FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = 'Pedido' ORDER BY CAST(ITEM AS UNSIGNED)", [numero]);
      if (itens.length === 0) return res.status(404).json({ error: 'Este pedido não tem itens para etiquetar.' });
      const { zpl, quantidade } = montarEtiquetas({
        numero, cliente: cab.RAZAO_SOCIAL, clienteFinal: cab.CLIENTE_FINAL,
        itens: itens.map(it => ({ ITEM: it.ITEM, QTD: textoVB(it.QTD) }))
      });
      res.json({ zpl, quantidade });
    } catch (err) {
      console.error('Erro GET /etiquetas/pedido:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarEtiquetas };
