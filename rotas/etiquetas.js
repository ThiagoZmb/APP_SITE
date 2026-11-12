// Etiquetas de pedido/produção (Zebra): devolve o ZPL de um Pedido, uma etiqueta por item. Só leitura, só Pedido, sem dinheiro.
// O envio à impressora é do serviço local do PC da empresa (local/zebra.js); aqui só se monta o ZPL (calculo/etiqueta_zpl.js).
// GET  /etiquetas/pedido/:numero         ZPL padrão (qtd do item, sem medidas, sem destino)
// GET  /etiquetas/pedido/:numero/itens   dados para a janela de edição (itens, medidas sugeridas, UF sugerida do cliente)
// POST /etiquetas/pedido/:numero         ZPL com os ajustes da janela ({ itens: [{ item, qtd, medidas, incluirMedidas, uf }], uf }); nada é gravado
const { montarEtiquetas } = require('../calculo/etiqueta_zpl');
const { validarEdicao, normalizarUf, sugerirMedidas } = require('../calculo/etiqueta_edicao');
const { textoVB } = require('../pdf/ped_orc');

const PERMISSAO = ['pedidos.pdf'];
const SQL_CABECALHO = "SELECT RAZAO_SOCIAL, CLIENTE_FINAL FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'";
const SQL_ITENS = "SELECT ITEM, QTD, DESCRICAO FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = 'Pedido' ORDER BY CAST(ITEM AS UNSIGNED)";
const SQL_MEDIDAS = "SELECT ITEM_PEDIDO, ALTURA, LARGURA FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = 'Pedido'";
const SQL_ESTADO = 'SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1';

function registrarEtiquetas({ rota, pool, foraDosEstados }) {
  // Carrega o pedido e confere acesso. Já responde (404/403/400) e devolve null quando não dá para seguir.
  // opcoes.sugestoes: também lê o estado do cliente e as medidas (só a janela de edição precisa).
  async function carregar(req, res, { sugestoes = false } = {}) {
    const numero = String(req.params.numero ?? '').trim();
    if (!/^\d{1,10}$/.test(numero)) { res.status(400).json({ error: 'Número de pedido inválido.' }); return null; }
    const [cabs] = await pool.execute(SQL_CABECALHO, [numero]);
    if (cabs.length === 0) { res.status(404).json({ error: 'Pedido não encontrado.' }); return null; }
    const cab = cabs[0];
    const restrito = (req.acesso.estados || []).length > 0;
    const [est, [itens], medidas] = await Promise.all([
      restrito || sugestoes ? pool.execute(SQL_ESTADO, [cab.RAZAO_SOCIAL]).then(x => x[0]) : [],
      pool.execute(SQL_ITENS, [numero]),
      sugestoes ? pool.execute(SQL_MEDIDAS, [numero]).then(x => x[0]).catch(err => { console.warn('Etiquetas: medidas indisponíveis:', err.message); return []; }) : []
    ]);
    // mesma regra de /dados_pdf: só abre cliente dentro dos estados do usuário
    if (restrito && foraDosEstados(req, res, est[0]?.ESTADO)) return null;
    if (itens.length === 0) { res.status(404).json({ error: 'Este pedido não tem itens para etiquetar.' }); return null; }
    return { numero, cab, itens, medidas, estadoCliente: est[0]?.ESTADO };
  }

  function responder(res, dados, edicao) {
    const { numero, cab, itens } = dados;
    const { zpl, quantidade } = montarEtiquetas({
      numero, cliente: cab.RAZAO_SOCIAL, clienteFinal: cab.CLIENTE_FINAL, uf: edicao.uf,
      itens: itens.map(it => {
        const e = edicao.porItem.get(String(it.ITEM));
        return { ITEM: it.ITEM, QTD: e?.qtd !== undefined ? String(e.qtd) : textoVB(it.QTD), MEDIDAS: e?.medidas, UF: e?.uf };
      })
    });
    res.json({ zpl, quantidade });
  }

  const falhou = (res, rotulo) => err => {
    console.error(`Erro ${rotulo}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  rota('get', '/etiquetas/pedido/:numero', PERMISSAO, async (req, res) => {
    try {
      const dados = await carregar(req, res);
      if (dados) responder(res, dados, { uf: '', porItem: new Map() });
    } catch (err) { falhou(res, 'GET /etiquetas/pedido')(err); }
  });

  rota('get', '/etiquetas/pedido/:numero/itens', PERMISSAO, async (req, res) => {
    try {
      const dados = await carregar(req, res, { sugestoes: true });
      if (!dados) return;
      const porItem = new Map();
      for (const l of dados.medidas) {
        const k = String(l.ITEM_PEDIDO);
        if (!porItem.has(k)) porItem.set(k, []);
        porItem.get(k).push(l);
      }
      res.json({
        numero: dados.numero,
        // a UF do cadastro só vira sugestão se for uma das 27 siglas; o resto fica vazio (nada inventado)
        ufSugerida: normalizarUf(typeof dados.estadoCliente === 'string' ? dados.estadoCliente : '') || '',
        itens: dados.itens.map(it => ({
          item: String(it.ITEM),
          qtd: textoVB(it.QTD),
          descricao: String(textoVB(it.DESCRICAO) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          medidasSugeridas: sugerirMedidas(porItem.get(String(it.ITEM)))
        }))
      });
    } catch (err) { falhou(res, 'GET /etiquetas/pedido/:numero/itens')(err); }
  });

  rota('post', '/etiquetas/pedido/:numero', PERMISSAO, async (req, res) => {
    try {
      const dados = await carregar(req, res);
      if (!dados) return;
      const v = validarEdicao(req.body, dados.itens.map(it => String(it.ITEM)));
      if (!v.ok) return res.status(400).json({ error: v.erro });
      responder(res, dados, v);
    } catch (err) { falhou(res, 'POST /etiquetas/pedido')(err); }
  });
}

module.exports = { registrarEtiquetas };
