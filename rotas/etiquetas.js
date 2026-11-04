// Etiquetas de pedido/produção (Zebra): devolve o ZPL de um Pedido, uma etiqueta por item. Só leitura, só Pedido, sem dinheiro.
// O envio à impressora é do serviço local do PC da empresa (local/zebra.js); aqui só se monta o ZPL (calculo/etiqueta_zpl.js).
const { montarEtiquetas } = require('../calculo/etiqueta_zpl');
const { descricaoItem, textoVB, dataVB } = require('../pdf/ped_orc');

const PERMISSAO = ['pedidos.pdf'];

const agruparPor = (linhas, coluna) => {
  const m = {};
  for (const r of linhas) { const k = String(r[coluna] ?? '').trim(); (m[k] = m[k] || []).push(r); }
  return m;
};

function registrarEtiquetas({ rota, pool, foraDosEstados }) {
  rota('get', '/etiquetas/pedido/:numero', PERMISSAO, async (req, res) => {
    const numero = String(req.params.numero ?? '').trim();
    if (!/^\d{1,10}$/.test(numero)) return res.status(400).json({ error: 'Número de pedido inválido.' });
    try {
      const [cabs] = await pool.execute("SELECT RAZAO_SOCIAL, DATA_PRONTO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'", [numero]);
      if (cabs.length === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const cab = cabs[0];
      // mesma regra de /dados_pdf: só abre cliente dentro dos estados do usuário
      if ((req.acesso.estados || []).length) {
        const [est] = await pool.execute('SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [cab.RAZAO_SOCIAL]);
        if (foraDosEstados(req, res, est[0]?.ESTADO)) return;
      }
      const consulta = async tabela => (await pool.execute(`SELECT * FROM ${tabela} WHERE NUMERO = ? AND TIPO = 'Pedido'`, [numero]))[0];
      const [itens] = await pool.execute("SELECT * FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = 'Pedido' ORDER BY CAST(ITEM AS UNSIGNED)", [numero]);
      if (itens.length === 0) return res.status(404).json({ error: 'Este pedido não tem itens para etiquetar.' });
      const g = {
        v4: agruparPor(await consulta('ped_orc_itens_v4'), 'ITEM_PEDIDO'),
        complementos: agruparPor(await consulta('ped_orc_complementos'), 'ITEM_PEDIDO'),
        serralheria: agruparPor(await consulta('ped_orc_serralheria'), 'ITEM_PEDIDO'),
        compSerralheria: agruparPor(await consulta('ped_orc_serralheria_complementos'), 'ITEM_PEDIDO'),
        furos: agruparPor(await consulta('furacao_pedidos_orcamentos'), 'ITEM')
      };
      const { zpl, quantidade } = montarEtiquetas({
        numero, cliente: cab.RAZAO_SOCIAL, dataEntrega: dataVB(cab.DATA_PRONTO),
        itens: itens.map(it => {
          const id = String(it.ITEM ?? '').trim();
          const linhas = descricaoItem(textoVB(it.TIPO_PRODUTO), {
            v4: g.v4[id], complementos: g.complementos[id], serralheria: g.serralheria[id], compSerralheria: g.compSerralheria[id], furos: g.furos[id]
          });
          return { ITEM: it.ITEM, QTD: textoVB(it.QTD), descricao: linhas.map(l => l.texto).join(' '), v4: g.v4[id] || [] };
        })
      });
      res.json({ zpl, quantidade });
    } catch (err) {
      console.error('Erro GET /etiquetas/pedido:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarEtiquetas };
