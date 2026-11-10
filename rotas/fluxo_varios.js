// Recebimento dividido em várias formas de pagamento, numa operação só (tabela do VB `fluxo_de_caixa`).
// POST /fluxo/salvar_varios (financeiro.lancar + valores.ver): grava todas as linhas ou nenhuma; opcionalmente marca o pedido como Recebido
//   (precisa de clientes.receber, a mesma permissão do /clientes/receber).
// POST /fluxo/dividir (financeiro.lancar + valores.ver): divide um movimento JÁ EXISTENTE (Editar movimento), Entrada ou Saída: a 1ª parcela atualiza o
//   registro, as demais viram registros novos; tudo ou nada.
// GET  /fluxo/pedido_resumo?numero= (financeiro.ver + valores.ver): total do pedido, já recebido e quanto falta (só leitura).
// Nenhuma linha é sobrescrita: o ID novo vem de MAX(ID)+1 travado na transação e o INSERT é simples (colisão = erro, nunca overwrite).
const { ErroUsuario, emTransacao } = require('./transacao');
const { validarDivisao, validarDivisaoEdicao, numeroUnicoDoPedido, saldoDoPedido } = require('../calculo/fluxo_varios');

const ESCREVER = ['financeiro.lancar', 'valores.ver'];
const LER = ['financeiro.ver', 'valores.ver'];

function registrarFluxoVarios({ rota, pool }) {
  // quanto já entrou como Recebido para esse pedido (só linhas cujo campo PEDIDO é exatamente esse número)
  async function recebidoDoPedido(db, numero) {
    const [[r]] = await db.execute(
      "SELECT COALESCE(SUM(VALOR), 0) AS soma FROM fluxo_de_caixa WHERE TRIM(PEDIDO) = ? AND SITUACAO = 'Recebido' AND COALESCE(RAZAO_SOCIAL, '') <> ''",
      [String(numero)]);
    return Number(r?.soma) || 0;
  }

  rota('get', '/fluxo/pedido_resumo', LER, async (req, res) => {
    const numero = numeroUnicoDoPedido(req.query.numero);
    if (numero === null) return res.status(400).json({ error: 'Informe um único número de pedido.' });
    try {
      const [[p]] = await pool.execute("SELECT TOTAL, FINANCEIRO, SITUACAO FROM ped_orc WHERE TIPO = 'Pedido' AND NUMERO = ?", [numero]);
      if (!p) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const recebido = await recebidoDoPedido(pool, numero);
      res.json({ numero, ...saldoDoPedido(p.TOTAL, recebido), financeiro: p.FINANCEIRO || '', situacao: p.SITUACAO || '' });
    } catch (err) {
      console.error('Erro GET /fluxo/pedido_resumo:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // ID novo por MAX(ID)+1 travado na transação; INSERT simples (colisão = 409, nunca sobrescreve)
  async function inserirLinhas(conn, ids, comum, linhas, movimento) {
    const [[mx]] = await conn.execute('SELECT MAX(ID) AS m FROM fluxo_de_caixa FOR UPDATE');
    let id = (parseInt(mx?.m, 10) || 0);
    const fabricante = movimento === 'Saída' ? comum.nome : null, social = movimento === 'Saída' ? null : comum.nome;
    for (const l of linhas) {
      id += 1;
      try {
        await conn.execute(
          `INSERT INTO fluxo_de_caixa (ID, DATA, RAZAO_FABRICANTE, RAZAO_SOCIAL, PEDIDO, PDV, PRE_NOTA_FISCAL, NOTA_FISCAL, FORMA_PGTO,
             BANCO, SITUACAO, VALOR, OBSERVACAO_GERAL, COD_CLASSIFICACAO)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, l.data, fabricante, social, comum.pedido, comum.pdv, comum.preNota, comum.notaFiscal,
           l.formaPgto, l.banco, l.situacao, l.valor, comum.observacao, comum.classificacao]);
      } catch (err) {
        if (err && err.errno === 1062) throw new ErroUsuario(409, 'Outro lançamento foi gravado ao mesmo tempo. Nada foi salvo; tente de novo.');
        throw err;
      }
      ids.push(id);
    }
  }

  rota('post', '/fluxo/dividir', ESCREVER, async (req, res) => {
    const v = validarDivisaoEdicao(req.body);
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const r = await emTransacao(pool, res, 'POST /fluxo/dividir', async conn => {
      const [[atual]] = await conn.execute('SELECT ID, RAZAO_SOCIAL, RAZAO_FABRICANTE FROM fluxo_de_caixa WHERE ID = ? FOR UPDATE', [v.id]);
      if (!atual) throw new ErroUsuario(404, 'Registro não encontrado.');
      // o tipo não muda por aqui: Entrada tem cliente (RAZAO_SOCIAL), Saída tem fornecedor (RAZAO_FABRICANTE)
      const ehEntrada = String(atual.RAZAO_SOCIAL ?? '').trim() !== '', ehSaida = String(atual.RAZAO_FABRICANTE ?? '').trim() !== '';
      if ((v.movimento === 'Entrada' && ehSaida && !ehEntrada) || (v.movimento === 'Saída' && ehEntrada && !ehSaida)) {
        throw new ErroUsuario(409, 'O tipo do movimento (Entrada ou Saída) não pode mudar ao dividir.');
      }
      const [primeira, ...demais] = v.linhas;
      const fabricante = v.movimento === 'Saída' ? v.comum.nome : null, social = v.movimento === 'Saída' ? null : v.comum.nome;
      await conn.execute(
        `UPDATE fluxo_de_caixa SET DATA = ?, RAZAO_FABRICANTE = ?, RAZAO_SOCIAL = ?, PEDIDO = ?, PDV = ?, PRE_NOTA_FISCAL = ?, NOTA_FISCAL = ?, FORMA_PGTO = ?,
           BANCO = ?, SITUACAO = ?, VALOR = ?, OBSERVACAO_GERAL = ?, COD_CLASSIFICACAO = ? WHERE ID = ?`,
        [primeira.data, fabricante, social, v.comum.pedido, v.comum.pdv, v.comum.preNota, v.comum.notaFiscal, primeira.formaPgto,
         primeira.banco, primeira.situacao, primeira.valor, v.comum.observacao, v.comum.classificacao, v.id]);
      const ids = [];
      await inserirLinhas(conn, ids, v.comum, demais, v.movimento);
      return { ok: true, id: v.id, ids, mensagem: `Registro dividido em ${v.linhas.length} parcelas com sucesso!` };
    });
    if (r) res.json(r);
  });

  rota('post', '/fluxo/salvar_varios', ESCREVER, async (req, res) => {
    const v = validarDivisao(req.body);
    if (!v.ok) return res.status(400).json({ error: v.erro });
    if (v.quitar !== null && !(req.acesso && req.acesso.permissoes && req.acesso.permissoes.has('clientes.receber'))) {
      return res.status(403).json({ error: 'Só quem tem a permissão de receber do cliente pode marcar o pedido como Recebido.' });
    }
    const r = await emTransacao(pool, res, 'POST /fluxo/salvar_varios', async conn => {
      if (v.quitar !== null) {
        const [[p]] = await conn.execute("SELECT NUMERO FROM ped_orc WHERE TIPO = 'Pedido' AND NUMERO = ? FOR UPDATE", [v.quitar]);
        if (!p) throw new ErroUsuario(404, 'Pedido não encontrado.');
      }
      const [[mx]] = await conn.execute('SELECT MAX(ID) AS m FROM fluxo_de_caixa FOR UPDATE');
      let id = (parseInt(mx?.m, 10) || 0);
      const ids = [];
      for (const l of v.linhas) {
        id += 1;
        try {
          await conn.execute(
            `INSERT INTO fluxo_de_caixa (ID, DATA, RAZAO_FABRICANTE, RAZAO_SOCIAL, PEDIDO, PDV, PRE_NOTA_FISCAL, NOTA_FISCAL, FORMA_PGTO,
               BANCO, SITUACAO, VALOR, OBSERVACAO_GERAL, COD_CLASSIFICACAO)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, l.data, null, v.comum.nome, v.comum.pedido, v.comum.pdv, v.comum.preNota, v.comum.notaFiscal,
             l.formaPgto, l.banco, l.situacao, l.valor, v.comum.observacao, v.comum.classificacao]);
        } catch (err) {
          if (err && err.errno === 1062) throw new ErroUsuario(409, 'Outro lançamento foi gravado ao mesmo tempo. Nada foi salvo; tente de novo.');
          throw err;
        }
        ids.push(id);
      }
      let quitado = false;
      if (v.quitar !== null) {
        await conn.execute("UPDATE ped_orc SET FINANCEIRO = 'Recebido' WHERE TIPO = 'Pedido' AND NUMERO = ?", [v.quitar]);
        quitado = true;
      }
      return { ok: true, ids, quitado, mensagem: `${ids.length} recebimentos salvos com sucesso!` + (quitado ? ` Pedido ${v.quitar} marcado como Recebido.` : '') };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarFluxoVarios };
