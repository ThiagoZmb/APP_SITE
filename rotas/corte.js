// Plano de corte de perfis (grava só em web_corte_config, web_retalhos e web_corte_planos; lê perfis e ped_orc_itens_v4 do pedido).
// Regras: calculo/corte_pecas.js (peças), calculo/corte_otimizacao.js (varas e retalhos), calculo/corte_validacao.js (entradas).
// Nada aqui é dinheiro: as rotas não exigem valores.ver, então nenhum nome de campo pode casar com REGEX_VALOR (seguranca/valores.js).
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { PADRAO, resolverParametros, otimizar } = require('../calculo/corte_otimizacao');
const { montarPecas, impressaoPecas } = require('../calculo/corte_pecas');
const { validarConfig, validarRetalho, validarConferencia } = require('../calculo/corte_validacao');
const { travarProdutos, conferirSaldo, gravarSaidas } = require('./estoque_saida');   // mesma saída de estoque de POST /estoque/saida

const VER = ['corte.ver'];
const PARAMETROS = ['corte.ver', 'corte.parametros'];
const PLANEJAR = ['corte.ver', 'corte.planejar'];
const BAIXAR_ESTOQUE = ['estoque.ver', 'estoque.movimentar'];   // a baixa das varas novas exige também a permissão de dar saída no estoque
const SITUACOES_RETALHO = ['disponivel', 'reservado', 'usado', 'descartado'];

const paraNumeroOuNull = v => (v === null || v === undefined ? null : Number(v));
const inteiroPositivo = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// colunas LONGTEXT com JSON (string no mysql2; objeto se um dia virar JSON)
const lerJson = (v, padrao) => { if (v === null || v === undefined || v === '') return padrao; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return padrao; } };

const auditarConn = (conn, quem, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
  [agoraLocal(), quem || '', acao, String(alvo), JSON.stringify(detalhe)]);

const liberarReservas = (conn, planoId) => conn.execute(
  "UPDATE web_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = ? WHERE plano_reserva = ? AND situacao = 'reservado'", [agoraLocal(), planoId]);
const cancelarPlano = (conn, planoId) => conn.execute("UPDATE web_corte_planos SET situacao = 'cancelado' WHERE id = ?", [planoId]);

// Cancelar ou excluir um pedido: os planos ainda não conferidos são cancelados e os retalhos reservados voltam a ficar disponíveis.
// Chamada dentro da transação do pedido (rotas/ped_orc.js). Plano conferido fica como histórico. Devolve quantos planos cancelou.
async function liberarPlanosDoPedido(conn, numero, quem = '', { excluindo = false } = {}) {   // excluindo: pedido APAGADO, número reaproveitado (MAX+1): o plano conferido é desligado dele (excluido_em); exclusão feita direto no VB não passa por aqui
  const [planos] = await conn.execute("SELECT id FROM web_corte_planos WHERE pedido = ? AND situacao = 'gerado' FOR UPDATE", [numero]);
  for (const p of planos) {
    await liberarReservas(conn, p.id);
    await cancelarPlano(conn, p.id);
    await auditarConn(conn, quem, 'corte_plano_cancelado_com_pedido', p.id, { campos: ['situacao'], pedido: numero });
  }
  if (excluindo) await conn.execute("UPDATE web_corte_planos SET excluido_em = ? WHERE pedido = ? AND situacao = 'conferido' AND excluido_em IS NULL", [agoraLocal(), numero]);
  return planos.length;
}

const lerPedido = async (db, numero, travar = false) => {
  const [[p]] = await db.execute(`SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'${travar ? ' FOR UPDATE' : ''}`, [numero]);
  return p || null;
};
const lerConfig = async db => (await db.execute('SELECT perfil, comprimento_vara, serra, sobra_minima FROM web_corte_config ORDER BY perfil'))[0];
const planoAtivo = async (db, numero, travar = false) => {
  const [[p]] = await db.execute(`SELECT id, situacao, impressao_pecas, criado_por, criado_em, conferido_em FROM web_corte_planos WHERE pedido = ? AND situacao <> 'cancelado' AND excluido_em IS NULL ORDER BY id DESC LIMIT 1${travar ? ' FOR UPDATE' : ''}`, [numero]);
  return p || null;
};

async function lerPecasDoPedido(db, numero) {
  const [perfis] = await db.execute('SELECT id, ITEM, QTD_PORTAS, PERFIL, QTD_ALTURA, TAM_ALTURA, QTD_LARGURA, TAM_LARGURA, PUXADOR, QTD_PUXADOR, TAM_PUXADOR FROM perfis WHERE NUMERO = ? ORDER BY id', [numero]);
  const [itens] = await db.execute("SELECT ITEM_PEDIDO, ITEM, QTD, PERFIL, ACABAMENTO_PERFIL, COR_PERFIL, PUXADOR, ACABAMENTO_PUXADOR, COR_PUXADOR, DIVISOR, ACABAMENTO_DIVISOR, COR_DIVISOR, QTD_HORIZONTAL, QTD_VERTICAL, TAM_DIV_HORIZONTAL, TAM_DIV_VERTICAL, ALTURA, LARGURA FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = 'Pedido' ORDER BY ITEM_PEDIDO, ITEM", [numero]);
  return { ...montarPecas({ perfis, itens }), vazio: perfis.length === 0 };
}

// planoId: reservas desse plano contam como disponíveis (é o plano que será substituído)
async function calcularPlano(db, numero, planoId, travar = false) {
  const base = await lerPecasDoPedido(db, numero);
  const [linhas] = await db.execute(`SELECT id, perfil, acabamento, cor, comprimento FROM web_retalhos WHERE situacao = 'disponivel' OR (situacao = 'reservado' AND plano_reserva = ?) ORDER BY id${travar ? ' FOR UPDATE' : ''}`, [planoId || 0]);
  const retalhos = linhas.map(r => ({ id: Number(r.id), perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: Number(r.comprimento) }));
  const config = await lerConfig(db);
  const plano = otimizar({ pecas: base.pecas, retalhos, parametrosDe: perfil => resolverParametros(config, perfil) });
  const retalhosUsados = plano.grupos.flatMap(g => g.barras).filter(b => b.tipo === 'retalho').map(b => b.retalhoId).sort((a, b) => a - b);
  return { ...base, plano, config, impressao: impressaoPecas(base.pecas), retalhosUsados };
}

function registrarCorte({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);
  const idDaRota = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const retalhoParaJson = r => ({ id: Number(r.id), perfil: r.perfil, acabamento: r.acabamento, cor: r.cor, comprimento: Number(r.comprimento),
    situacao: r.situacao, planoOrigem: paraNumeroOuNull(r.plano_origem), planoReserva: paraNumeroOuNull(r.plano_reserva), criadoEm: r.criado_em || null });

  // ---------- parâmetros: vara, serra e sobra mínima ----------
  rota('get', '/corte/config', VER, async (req, res) => {
    try {
      const [linhas] = await pool.execute('SELECT perfil, comprimento_vara, serra, sobra_minima FROM web_corte_config ORDER BY perfil');
      res.json({
        padraoDeFabrica: PADRAO,
        padrao: resolverParametros(linhas, ''),
        excecoes: linhas.filter(l => l.perfil).map(l => ({ perfil: l.perfil, comprimentoVara: paraNumeroOuNull(l.comprimento_vara),
          serra: paraNumeroOuNull(l.serra), sobraMinima: paraNumeroOuNull(l.sobra_minima) }))
      });
    } catch (err) { console.error('Erro GET /corte/config:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  rota('put', '/corte/config', PARAMETROS, async (req, res) => {
    const v = validarConfig(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte/config', async conn => {
      const [[atual]] = await conn.execute('SELECT id FROM web_corte_config WHERE perfil = ? FOR UPDATE', [d.perfil]);
      const agora = agoraLocal(), quem = req.acesso?.nome || '';
      if (atual) {
        await conn.execute('UPDATE web_corte_config SET comprimento_vara = ?, serra = ?, sobra_minima = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
          [d.comprimentoVara, d.serra, d.sobraMinima, agora, quem, atual.id]);
      } else {
        await conn.execute('INSERT INTO web_corte_config (perfil, comprimento_vara, serra, sobra_minima, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?, ?)',
          [d.perfil, d.comprimentoVara, d.serra, d.sobraMinima, agora, quem]);
      }
      await auditar(conn, req, 'corte_config_alterada', d.perfil || '(padrão)',
        { campos: ['comprimentoVara', 'serra', 'sobraMinima'], comprimentoVara: d.comprimentoVara, serra: d.serra, sobraMinima: d.sobraMinima });
      return { ok: true, perfil: d.perfil, comprimentoVara: d.comprimentoVara, serra: d.serra, sobraMinima: d.sobraMinima, criado: !atual };
    });
    if (r) res.json(r);
  });

  // ---------- retalhos ----------
  rota('get', '/corte/retalhos', VER, async (req, res) => {
    const situacao = req.query.situacao;
    if (situacao !== undefined && situacao !== '' && !SITUACOES_RETALHO.includes(situacao)) return res.status(400).json({ error: 'Situação de retalho inválida.' });
    try {
      const colunas = 'SELECT id, perfil, acabamento, cor, comprimento, situacao, plano_origem, plano_reserva, criado_em FROM web_retalhos';
      const ordem = ' ORDER BY perfil, acabamento, cor, comprimento, id';
      const [linhas] = situacao ? await pool.execute(`${colunas} WHERE situacao = ?${ordem}`, [situacao]) : await pool.execute(colunas + ordem);
      res.json({ retalhos: linhas.map(retalhoParaJson) });
    } catch (err) { console.error('Erro GET /corte/retalhos:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  rota('post', '/corte/retalhos', PARAMETROS, async (req, res) => {
    const v = validarRetalho(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'POST /corte/retalhos', async conn => {
      const agora = agoraLocal();
      const [ins] = await conn.execute(
        "INSERT INTO web_retalhos (perfil, acabamento, cor, comprimento, situacao, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'disponivel', ?, ?, ?)",
        [d.perfil, d.acabamento, d.cor, d.comprimento, req.acesso?.nome || '', agora, agora]);
      await auditar(conn, req, 'corte_retalho_criado', ins.insertId, { campos: ['perfil', 'acabamento', 'cor', 'comprimento'], comprimento: d.comprimento, origem: 'manual' });
      return { ok: true, id: Number(ins.insertId), ...d, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  // retalho só muda à mão enquanto está disponível (reservado/usado/descartado pertencem a um plano ou ao histórico)
  async function travarDisponivel(conn, id) {
    const [[atual]] = await conn.execute('SELECT id, situacao FROM web_retalhos WHERE id = ? FOR UPDATE', [id]);
    if (!atual) throw new ErroUsuario(404, 'Retalho não encontrado.');
    if (atual.situacao !== 'disponivel') throw new ErroUsuario(409, `Retalho ${atual.situacao}: só retalho disponível pode ser alterado.`);
  }

  rota('put', '/corte/retalhos/:id', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const v = validarRetalho(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte/retalhos/:id', async conn => {
      await travarDisponivel(conn, id);
      await conn.execute('UPDATE web_retalhos SET perfil = ?, acabamento = ?, cor = ?, comprimento = ?, atualizado_em = ? WHERE id = ?',
        [d.perfil, d.acabamento, d.cor, d.comprimento, agoraLocal(), id]);
      await auditar(conn, req, 'corte_retalho_alterado', id, { campos: ['perfil', 'acabamento', 'cor', 'comprimento'], comprimento: d.comprimento });
      return { ok: true, id, ...d, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  rota('post', '/corte/retalhos/:id/descartar', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const r = await emTransacao(pool, res, 'POST /corte/retalhos/:id/descartar', async conn => {
      await travarDisponivel(conn, id);
      await conn.execute("UPDATE web_retalhos SET situacao = 'descartado', atualizado_em = ? WHERE id = ?", [agoraLocal(), id]);
      await auditar(conn, req, 'corte_retalho_descartado', id, { campos: ['situacao'] });
      return { ok: true, id, situacao: 'descartado' };
    });
    if (r) res.json(r);
  });

  // produtos do estoque para escolher na baixa das varas novas (só ativos; código, nome, unidade e quantidade — nada de dinheiro)
  rota('get', '/corte/estoque/produtos', [...PLANEJAR, ...BAIXAR_ESTOQUE], async (req, res) => {
    try {
      const [linhas] = await pool.execute("SELECT CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE FROM estoque WHERE SITUACAO = 'Ativo' ORDER BY NOME_PRODUTO LIMIT 3000");
      res.json({ produtos: linhas.map(l => ({ codigo: Number(l.CODIGO), nome: l.NOME_PRODUTO, unidade: l.UNIDADE || '', qtdEstoque: Number(l.QTD_ESTOQUE) || 0 })) });
    } catch (err) { console.error('Erro GET /corte/estoque/produtos:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // Baixa no estoque das varas NOVAS do plano (retalho não está em `estoque`): uma baixa por grupo, com o produto escolhido na tela.
  // Roda dentro da transação de confirmar; qualquer falha desfaz tudo. Devolve a lista [{ produto, qtd }] para a auditoria.
  async function baixarVarasNovas(conn, req, plano, corpo) {
    const comVaras = plano.grupos.map(g => ({ g, varas: g.barras.filter(b => b.tipo === 'vara').length })).filter(x => x.varas > 0);
    if (!comVaras.length) return [];
    const permissoes = (req.acesso && req.acesso.permissoes) || new Set();
    if (!BAIXAR_ESTOQUE.every(c => permissoes.has(c))) throw new ErroUsuario(403, 'Este plano usa varas novas: dar baixa no estoque exige a permissão de dar saída no estoque.');
    const rotulo = g => `${g.perfil} (${g.acabamento || 'sem acabamento'} / ${g.cor || 'sem cor'})`;
    if (!Array.isArray(corpo.baixas)) throw new ErroUsuario(400, 'Informe o produto do estoque de cada perfil com varas novas (baixas).');
    const porChave = new Map();
    for (const b of corpo.baixas) {
      const chave = b && typeof b.chave === 'string' ? b.chave : null;
      if (!chave || !comVaras.some(x => x.g.chave === chave)) throw new ErroUsuario(400, `Baixa informada para um grupo desconhecido ou sem varas novas: ${chave === null ? '(sem chave)' : chave}.`);
      if (porChave.has(chave)) throw new ErroUsuario(400, 'Grupo informado mais de uma vez nas baixas.');
      const codigo = inteiroPositivo(b.produtoCodigo);
      if (!codigo) throw new ErroUsuario(400, 'Produto do estoque inválido na baixa.');
      porChave.set(chave, codigo);
    }
    for (const { g } of comVaras) if (!porChave.has(g.chave)) throw new ErroUsuario(400, `Falta escolher o produto do estoque para ${rotulo(g)}.`);
    const codigos = [...porChave.values()];
    if (new Set(codigos).size !== codigos.length) throw new ErroUsuario(400, 'O mesmo produto do estoque foi escolhido para mais de um grupo. Escolha um produto por grupo.');
    const produtos = await travarProdutos(conn, codigos);
    const itens = comVaras.map(({ g, varas }) => {
      const prod = produtos.get(porChave.get(g.chave));
      if (!prod) throw new ErroUsuario(400, `Produto do estoque de ${rotulo(g)} não encontrado.`);
      conferirSaldo(prod, varas);
      return { p: prod, qtd: varas };
    });
    await gravarSaidas(conn, itens, { quando: agoraLocal(), usuario: (req.user && req.user.nome) || req.acesso?.nome || '' });
    return itens.map(i => ({ produto: i.p.NOME_PRODUTO, qtd: i.qtd }));
  }

  // ---------- plano de corte de um pedido ----------
  const resumoPlanoSalvo = (p, desatualizado) => p && ({ id: Number(p.id), situacao: desatualizado && p.situacao === 'gerado' ? 'desatualizado' : p.situacao,
    criadoPor: p.criado_por || '', criadoEm: p.criado_em || null, conferidoEm: p.conferido_em || null });

  // pré-visualização: calcula e devolve, sem gravar nada e sem reservar retalho
  rota('get', '/corte/pedido/:numero', VER, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    try {
      const ped = await lerPedido(pool, numero);
      if (!ped) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const ativo = await planoAtivo(pool, numero);
      const calc = await calcularPlano(pool, numero, ativo && ativo.situacao === 'gerado' ? Number(ativo.id) : 0);
      const [[cont]] = await pool.execute("SELECT COUNT(*) AS qtd, SUM(situacao = 'conferido') AS conferidos FROM web_corte_planos WHERE pedido = ? AND excluido_em IS NULL", [numero]);
      res.json({
        pedido: { numero, cliente: ped.RAZAO_SOCIAL || '', situacao: ped.SITUACAO || '' },
        vazio: calc.vazio,
        mensagem: calc.vazio ? 'Este pedido não tem perfis gravados (pedido antigo ou sem portas de alumínio): não há o que cortar.' : null,
        qtdPlanosGravados: Number(cont && cont.qtd) || 0, qtdConferidos: Number(cont && cont.conferidos) || 0,
        qtdPecas: calc.pecas.length, pendencias: calc.pendencias, plano: calc.plano, impressao: calc.impressao, retalhosUsados: calc.retalhosUsados,
        planoSalvo: resumoPlanoSalvo(ativo, ativo && ativo.impressao_pecas !== calc.impressao)
      });
    } catch (err) { console.error('Erro GET /corte/pedido:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // salvar: recalcula dentro da transação com os retalhos travados; se o pedido ou os retalhos mudaram desde a pré-visualização, recusa (409)
  rota('post', '/corte/pedido/:numero/salvar', PLANEJAR, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const corpo = req.body || {};
    const r = await emTransacao(pool, res, 'POST /corte/pedido/:numero/salvar', async conn => {
      const ped = await lerPedido(conn, numero, true);
      if (!ped) throw new ErroUsuario(404, 'Pedido não encontrado.');
      if (ped.SITUACAO === 'Cancelado') throw new ErroUsuario(409, 'Pedido cancelado não recebe plano de corte.');
      const ativo = await planoAtivo(conn, numero, true);
      if (ativo && ativo.situacao === 'conferido') throw new ErroUsuario(409, 'Este pedido já tem um plano conferido.');
      const calc = await calcularPlano(conn, numero, ativo ? Number(ativo.id) : 0, true);
      if (!calc.pecas.length) throw new ErroUsuario(409, 'Não há peças para planejar neste pedido (veja as pendências).');
      const vistos = Array.isArray(corpo.retalhosUsados) ? corpo.retalhosUsados.map(Number).sort((a, b) => a - b) : null;
      if (corpo.impressao !== calc.impressao) throw new ErroUsuario(409, 'O pedido mudou desde a pré-visualização. Recalcule o plano.');
      if (!vistos || vistos.join(',') !== calc.retalhosUsados.join(',')) throw new ErroUsuario(409, 'Os retalhos disponíveis mudaram desde a pré-visualização. Recalcule o plano.');
      if (ativo) { await liberarReservas(conn, Number(ativo.id)); await cancelarPlano(conn, Number(ativo.id)); }
      const agora = agoraLocal(), quem = req.acesso?.nome || '';
      const resultado = { qtdPecas: calc.pecas.length, pendencias: calc.pendencias, plano: calc.plano };
      const parametros = calc.config.map(l => ({ perfil: l.perfil, comprimento_vara: paraNumeroOuNull(l.comprimento_vara), serra: paraNumeroOuNull(l.serra), sobra_minima: paraNumeroOuNull(l.sobra_minima) }));
      const [ins] = await conn.execute('INSERT INTO web_corte_planos (pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [numero, 'gerado', calc.impressao, JSON.stringify(parametros), JSON.stringify(resultado), '[]', quem, agora]);
      const id = Number(ins.insertId);
      for (const retalhoId of calc.retalhosUsados) {
        const [rr] = await conn.execute("UPDATE web_retalhos SET situacao = 'reservado', plano_reserva = ?, atualizado_em = ? WHERE id = ? AND situacao = 'disponivel'", [id, agora, retalhoId]);
        if (!rr.affectedRows) throw new ErroUsuario(409, 'Um retalho foi reservado por outro plano. Recalcule o plano.');
      }
      await auditarConn(conn, quem, 'corte_plano_salvo', id, { campos: ['plano'], pedido: numero, qtdPecas: calc.pecas.length, qtdVarasNovas: calc.plano.resumo.qtdVarasNovas,
        qtdRetalhosUsados: calc.plano.resumo.qtdRetalhosUsados, substituiu: ativo ? Number(ativo.id) : null });
      return { ok: true, id, pedido: numero };
    });
    if (r) res.json(r);
  });

  async function travarPlano(conn, id) {
    const [[p]] = await conn.execute('SELECT id, pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em, conferido_por, conferido_em FROM web_corte_planos WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw new ErroUsuario(404, 'Plano não encontrado.');
    return p;
  }
  const exigirGerado = p => { if (p.situacao !== 'gerado') throw new ErroUsuario(409, `Plano ${p.situacao}: só plano gerado aceita esta operação.`); };

  rota('get', '/corte/plano/:id', VER, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    try {
      const [[p]] = await pool.execute('SELECT id, pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em, conferido_por, conferido_em FROM web_corte_planos WHERE id = ?', [id]);
      if (!p) return res.status(404).json({ error: 'Plano não encontrado.' });
      let situacao = p.situacao;
      if (situacao === 'gerado') {
        const atual = await lerPecasDoPedido(pool, Number(p.pedido));
        if (impressaoPecas(atual.pecas) !== p.impressao_pecas) situacao = 'desatualizado';
      }
      const resultado = lerJson(p.resultado, {});
      res.json({ id: Number(p.id), pedido: Number(p.pedido), situacao, criadoPor: p.criado_por || '', criadoEm: p.criado_em || null,
        conferidoPor: p.conferido_por || '', conferidoEm: p.conferido_em || null, qtdPecas: resultado.qtdPecas || 0, pendencias: resultado.pendencias || [],
        plano: resultado.plano || { grupos: [], erros: [], resumo: {} }, cortadas: lerJson(p.progresso, []) });
    } catch (err) { console.error('Erro GET /corte/plano:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // marcar / desmarcar uma peça como cortada (o progresso é só do plano; o estoque de retalhos só muda ao confirmar)
  const MAX_MARCAS = 500;
  rota('put', '/corte/plano/:id/pecas', PLANEJAR, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    // uma marca ({grupo,barra,peca,cortada}) ou várias de uma vez ({marcas:[...]}): a tela junta os cliques e envia em lote
    const corpo = req.body || {};
    const marcas = Array.isArray(corpo.marcas) ? corpo.marcas : [corpo];
    if (!marcas.length || marcas.length > MAX_MARCAS) return res.status(400).json({ error: 'Lista de peças inválida.' });
    const r = await emTransacao(pool, res, 'PUT /corte/plano/:id/pecas', async conn => {
      const p = await travarPlano(conn, id);
      exigirGerado(p);
      const grupos = lerJson(p.resultado, {}).plano?.grupos || [];
      let lista = lerJson(p.progresso, []);
      for (const m of marcas) {
        const { grupo, barra, peca, cortada } = m || {};
        const g = grupos.find(x => x.chave === grupo);
        const b = g && Number.isInteger(barra) ? g.barras[barra] : null;
        if (!b || !Number.isInteger(peca) || peca < 0 || peca >= b.pecas.length || typeof cortada !== 'boolean') throw new ErroUsuario(400, 'Peça inexistente no plano.');
        lista = lista.filter(x => !(x.grupo === grupo && x.barra === barra && x.peca === peca));
        if (cortada) lista.push({ grupo, barra, peca });
      }
      await conn.execute("UPDATE web_corte_planos SET progresso = ? WHERE id = ? AND situacao = 'gerado'", [JSON.stringify(lista), id]);
      return { ok: true, qtdCortadas: lista.length };
    });
    if (r) res.json(r);
  });

  // confirmar o corte real: varas novas baixam do estoque (corpo.baixas); retalhos usados → usado; não usados → disponível; sobras conferidas → retalhos novos; plano → conferido
  rota('post', '/corte/plano/:id/confirmar', PLANEJAR, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    const corpo = req.body || {};
    const r = await emTransacao(pool, res, 'POST /corte/plano/:id/confirmar', async conn => {
      const p = await travarPlano(conn, id);
      exigirGerado(p);
      const plano = lerJson(p.resultado, {}).plano || { grupos: [] };
      const conf = validarConferencia(corpo, plano);
      if (!conf.ok) throw new ErroUsuario(400, conf.erro);
      const config = lerJson(p.parametros, []);
      const idsDoPlano = plano.grupos.flatMap(g => g.barras).filter(b => b.tipo === 'retalho').map(b => b.retalhoId);
      const naoUsados = Array.isArray(corpo.retalhosNaoUsados) ? corpo.retalhosNaoUsados.map(Number) : [];
      if (naoUsados.some(x => !idsDoPlano.includes(x))) throw new ErroUsuario(400, 'Retalho informado como não usado não pertence a este plano.');
      const grupoDe = chave => plano.grupos.find(g => g.chave === chave);
      for (const s of conf.sobras) {
        const g = grupoDe(s.grupo), b = g.barras[s.barra];
        if (s.destino !== 'guardar' || (b.tipo === 'retalho' && naoUsados.includes(b.retalhoId))) continue;
        const minima = resolverParametros(config, g.perfil).sobraMinima;
        if (s.medidaReal < minima) throw new ErroUsuario(400, `Sobra de ${s.medidaReal} mm abaixo da mínima (${minima} mm) do perfil ${g.perfil}: descarte.`);
      }
      const agora = agoraLocal(), quem = req.acesso?.nome || '';
      const baixadas = await baixarVarasNovas(conn, req, plano, corpo);
      let usados = 0, novos = 0, descartadas = 0;
      for (const g of plano.grupos) for (const b of g.barras) {
        if (b.tipo !== 'retalho') continue;
        const livre = naoUsados.includes(b.retalhoId);
        const [rr] = livre
          ? await conn.execute("UPDATE web_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = ? WHERE id = ? AND situacao = 'reservado' AND plano_reserva = ?", [agora, b.retalhoId, id])
          : await conn.execute("UPDATE web_retalhos SET situacao = 'usado', atualizado_em = ? WHERE id = ? AND situacao = 'reservado' AND plano_reserva = ?", [agora, b.retalhoId, id]);
        if (!rr.affectedRows) throw new ErroUsuario(409, `O retalho ${b.retalhoId} não está mais reservado para este plano.`);
        if (!livre) usados++;
      }
      for (const s of conf.sobras) {
        const g = grupoDe(s.grupo), b = g.barras[s.barra];
        if (b.tipo === 'retalho' && naoUsados.includes(b.retalhoId)) continue;
        if (s.destino === 'guardar') {
          await conn.execute("INSERT INTO web_retalhos (perfil, acabamento, cor, comprimento, situacao, plano_origem, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'disponivel', ?, ?, ?, ?)",
            [g.perfil, g.acabamento, g.cor, s.medidaReal, id, quem, agora, agora]);
          novos++;
        } else if (b.sobra > 0) descartadas++;
      }
      const [pl] = await conn.execute("UPDATE web_corte_planos SET situacao = 'conferido', conferido_por = ?, conferido_em = ? WHERE id = ? AND situacao = 'gerado'", [quem, agora, id]);
      if (!pl.affectedRows) throw new ErroUsuario(409, 'O plano já foi conferido.');
      await auditarConn(conn, quem, 'corte_plano_conferido', id, { campos: ['plano', 'retalhos'], pedido: Number(p.pedido), qtdRetalhosUsados: usados, qtdRetalhosNovos: novos, qtdSobrasDescartadas: descartadas });
      if (baixadas.length) await auditarConn(conn, quem, 'corte_baixa_estoque', id, { campos: ['estoque'], pedido: Number(p.pedido), itens: baixadas });
      return { ok: true, id, situacao: 'conferido', qtdRetalhosUsados: usados, qtdRetalhosNovos: novos, baixas: baixadas };
    });
    if (r) res.json(r);
  });

  // Excluir TODOS os dados de plano do pedido (gerado, cancelado ou conferido). Não exige que o pedido ainda exista: é também a saída
  // para plano órfão de pedido apagado direto no VB. Retalho reservado volta a ficar disponível; o material físico de plano CONFERIDO
  // não volta (retalho usado continua usado, sobra guardada continua no estoque), só perde a ligação com o plano apagado.
  // Plano conferido exige confirmação reforçada (incluirConferidos) e a permissão corte.parametros.
  rota('delete', '/corte/pedido/:numero', PLANEJAR, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const corpo = req.body || {};
    const r = await emTransacao(pool, res, 'DELETE /corte/pedido/:numero', async conn => {
      const [planos] = await conn.execute('SELECT id, situacao FROM web_corte_planos WHERE pedido = ? AND excluido_em IS NULL ORDER BY id FOR UPDATE', [numero]);
      if (!planos.length) throw new ErroUsuario(404, 'Não há dados de plano de corte para este pedido.');
      const conferidos = planos.filter(p => p.situacao === 'conferido').length;
      if (conferidos) {
        if (corpo.incluirConferidos !== true) throw new ErroUsuario(409, 'Este pedido tem plano conferido (corte já confirmado). Confirme a exclusão do histórico para continuar.', { exigeConfirmacaoConferido: true });
        if (!(req.acesso && req.acesso.permissoes && req.acesso.permissoes.has('corte.parametros'))) throw new ErroUsuario(403, 'Só quem tem a permissão de parâmetros do corte pode excluir um plano já conferido.');
      }
      let liberados = 0;
      for (const p of planos) {
        const [lib] = await liberarReservas(conn, p.id);
        liberados += Number(lib && lib.affectedRows) || 0;
        await conn.execute('UPDATE web_retalhos SET plano_origem = NULL WHERE plano_origem = ?', [p.id]);
        await conn.execute('UPDATE web_retalhos SET plano_reserva = NULL WHERE plano_reserva = ?', [p.id]);
        await conn.execute('DELETE FROM web_corte_planos WHERE id = ?', [p.id]);
      }
      await auditarConn(conn, req.acesso?.nome, 'corte_dados_pedido_excluidos', numero,
        { campos: ['planos', 'retalhos'], pedido: numero, planos: planos.map(p => Number(p.id)), qtdPlanos: planos.length, qtdConferidos: conferidos, qtdRetalhosLiberados: liberados });
      return { ok: true, pedido: numero, qtdPlanos: planos.length, qtdConferidos: conferidos, qtdRetalhosLiberados: liberados };
    });
    if (r) res.json(r);
  });

  rota('post', '/corte/plano/:id/cancelar', PLANEJAR, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    const r = await emTransacao(pool, res, 'POST /corte/plano/:id/cancelar', async conn => {
      const p = await travarPlano(conn, id);
      exigirGerado(p);
      await liberarReservas(conn, id);
      await cancelarPlano(conn, id);
      await auditarConn(conn, req.acesso?.nome, 'corte_plano_cancelado', id, { campos: ['situacao'], pedido: Number(p.pedido) });
      return { ok: true, id, situacao: 'cancelado' };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarCorte, liberarPlanosDoPedido };
