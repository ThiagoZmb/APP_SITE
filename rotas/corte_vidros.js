// Plano de corte de vidros (grava só em web_vidro_config, web_vidro_retalhos e web_vidro_planos; lê vidros, ped_orc_itens_v4 e estoque do VB).
// Regras: calculo/vidro_pecas.js (peças), calculo/vidro_otimizacao.js (chapas e retalhos), calculo/vidro_validacao.js (entradas).
// Nada aqui é dinheiro: as rotas não exigem valores.ver, então nenhum nome de campo pode casar com REGEX_VALOR (seguranca/valores.js).
// Traz parâmetros, retalhos, produtos, pré-visualização, salvar/ler/marcar/cancelar plano e liberarPlanosVidroDoPedido (usada ao cancelar/excluir pedido); conferir vem depois.
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { PADRAO, otimizarVidros } = require('../calculo/vidro_otimizacao');
const { montarPecasVidro, chaveGrupoVidro, impressaoPecasVidro, normalizar } = require('../calculo/vidro_pecas');
const { validarConfigVidros, validarRetalhoVidro } = require('../calculo/vidro_validacao');

const VER = ['corte.ver'];
const PARAMETROS = ['corte.ver', 'corte.parametros'];
const PLANEJAR = ['corte.ver', 'corte.planejar'];
const BAIXAR_ESTOQUE = ['estoque.ver', 'estoque.movimentar'];
const SITUACOES_RETALHO = ['disponivel', 'reservado', 'usado', 'descartado'];

const paraNumeroOuNull = v => (v === null || v === undefined ? null : Number(v));
const inteiroPositivo = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// candidatos a chapa: Revestimento ativo com altura e largura (ordem por nome, igual à tela)
const SQL_CANDIDATOS = "SELECT CODIGO, NOME_PRODUTO, UNIDADE, ALTURA, LARGURA, QTD_ESTOQUE FROM estoque WHERE CLASSE = 'Revestimento' AND SITUACAO = 'Ativo' AND ALTURA > 0 AND LARGURA > 0 ORDER BY NOME_PRODUTO LIMIT 3000";
const lerCandidatos = async db => (await db.execute(SQL_CANDIDATOS))[0].map(l => ({ codigo: Number(l.CODIGO), nome: l.NOME_PRODUTO, unidade: l.UNIDADE || '',
  altura: Math.round(Number(l.ALTURA)), largura: Math.round(Number(l.LARGURA)), qtdEstoque: Number(l.QTD_ESTOQUE) || 0 }));

// o nome do produto é "Vidro " + MODELO, opcionalmente seguido de complemento (" - 2400mm"); sem diferenciar caixa, acento nem espaços
const semAcento = s => normalizar(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
function candidatosDoModelo(candidatos, modelo) {
  const esperado = semAcento('Vidro ' + modelo);
  return candidatos.filter(c => { const n = semAcento(c.nome); return n === esperado || (n.startsWith(esperado) && !/[a-z0-9]/.test(n[esperado.length])); });
}

// colunas LONGTEXT com JSON (string no mysql2; objeto se um dia virar JSON)
const lerJson = (v, padrao) => { if (v === null || v === undefined || v === '') return padrao; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return padrao; } };

const auditarConn = (conn, quem, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
  [agoraLocal(), quem || '', acao, String(alvo), JSON.stringify(detalhe)]);
const liberarReservas = (conn, planoId) => conn.execute(
  "UPDATE web_vidro_retalhos SET situacao = 'disponivel', plano_reserva = NULL, atualizado_em = ? WHERE plano_reserva = ? AND situacao = 'reservado'", [agoraLocal(), planoId]);
const cancelarPlano = (conn, planoId) => conn.execute("UPDATE web_vidro_planos SET situacao = 'cancelado' WHERE id = ?", [planoId]);

// Cancelar ou excluir um pedido: os planos de vidro ainda não conferidos são cancelados e os retalhos reservados voltam a ficar disponíveis.
// Chamada dentro da transação do pedido (rotas/ped_orc.js). Plano conferido fica como histórico. Devolve quantos planos cancelou.
async function liberarPlanosVidroDoPedido(conn, numero, quem = '', { excluindo = false } = {}) {   // excluindo: pedido APAGADO, número reaproveitado (MAX+1): o plano conferido é desligado dele (excluido_em)
  const [planos] = await conn.execute("SELECT id FROM web_vidro_planos WHERE pedido = ? AND situacao = 'gerado' FOR UPDATE", [numero]);
  for (const p of planos) {
    await liberarReservas(conn, p.id);
    await cancelarPlano(conn, p.id);
    await auditarConn(conn, quem, 'corte_vidros_plano_cancelado_com_pedido', p.id, { campos: ['situacao'], pedido: numero });
  }
  if (excluindo) await conn.execute("UPDATE web_vidro_planos SET excluido_em = ? WHERE pedido = ? AND situacao = 'conferido' AND excluido_em IS NULL", [agoraLocal(), numero]);
  return planos.length;
}

const lerConfig = async db => {
  const [[l]] = await db.execute('SELECT serra, sobra_minima FROM web_vidro_config WHERE id = 1');
  return { serra: l && l.serra !== null && l.serra !== undefined ? Number(l.serra) : PADRAO.serra,
    sobraMinima: l && l.sobra_minima !== null && l.sobra_minima !== undefined ? Number(l.sobra_minima) : PADRAO.sobraMinima };
};
const lerPedido = async (db, numero, travar = false) => {
  const [[p]] = await db.execute(`SELECT NUMERO, RAZAO_SOCIAL, SITUACAO FROM ped_orc WHERE NUMERO = ? AND TIPO = 'Pedido'${travar ? ' FOR UPDATE' : ''}`, [numero]);
  return p || null;
};
const planoAtivo = async (db, numero, travar = false) => {
  const [[p]] = await db.execute(`SELECT id, situacao, impressao_pecas, criado_por, criado_em, conferido_em FROM web_vidro_planos WHERE pedido = ? AND situacao <> 'cancelado' AND excluido_em IS NULL ORDER BY id DESC LIMIT 1${travar ? ' FOR UPDATE' : ''}`, [numero]);
  return p || null;
};

async function lerPecasVidroDoPedido(db, numero) {
  const [vidros] = await db.execute('SELECT id, MEDICAO, ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO FROM vidros WHERE NUMERO = ? ORDER BY id', [numero]);
  const [itens] = await db.execute("SELECT ITEM_PEDIDO, REVESTIMENTO, COR_REVESTIMENTO FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = 'Pedido'", [numero]);
  return { ...montarPecasVidro({ vidros, itens }), vazio: vidros.length === 0 };
}

// escolhas: { chave: produtoCodigo }. planoId: reservas desse plano contam como disponíveis (é o plano que será substituído).
// Produto escolhido que não é candidato (inativo, fora da classe, inexistente) vira erro explicado do grupo.
async function calcularPlanoVidro(db, numero, escolhas = {}, planoId = 0, travar = false) {
  const base = await lerPecasVidroDoPedido(db, numero);
  const [linhas] = await db.execute(`SELECT id, produto_codigo, produto_nome, altura, largura FROM web_vidro_retalhos WHERE situacao = 'disponivel' OR (situacao = 'reservado' AND plano_reserva = ?) ORDER BY id${travar ? ' FOR UPDATE' : ''}`, [planoId || 0]);
  const retalhos = linhas.map(r => ({ id: Number(r.id), produtoCodigo: Number(r.produto_codigo), altura: Number(r.altura), largura: Number(r.largura) }));
  const candidatos = await lerCandidatos(db);
  const porCodigo = new Map(candidatos.map(c => [c.codigo, c]));
  const parametros = await lerConfig(db);

  // produto de cada grupo: o escolhido na tela ou, sem escolha, o único candidato pelo nome
  const escolhido = {};
  for (const p of base.pecas) {
    const chave = chaveGrupoVidro(p);
    if (chave in escolhido) continue;
    const doNome = candidatosDoModelo(candidatos, p.modelo);
    escolhido[chave] = escolhas[chave] !== undefined ? Number(escolhas[chave]) : (doNome.length === 1 ? doNome[0].codigo : null);
  }
  const invalidos = {};   // chave -> motivo
  const foraDaLista = Object.entries(escolhido).filter(([, cod]) => cod !== null && !porCodigo.has(cod));
  if (foraDaLista.length) {
    const cods = [...new Set(foraDaLista.map(([, cod]) => cod))];
    const [achados] = await db.execute(`SELECT CODIGO, NOME_PRODUTO, CLASSE, SITUACAO, ALTURA, LARGURA FROM estoque WHERE CODIGO IN (${cods.map(() => '?').join(',')})`, cods);
    for (const [chave, cod] of foraDaLista) {
      const e = achados.find(a => Number(a.CODIGO) === cod);
      invalidos[chave] = !e ? `Produto ${cod} não encontrado no estoque.`
        : e.SITUACAO !== 'Ativo' ? `O produto ${e.NOME_PRODUTO} está inativo no estoque; escolha outro.`
        : e.CLASSE !== 'Revestimento' ? `O produto ${e.NOME_PRODUTO} não é da classe Revestimento; escolha um vidro.`
        : `O produto ${e.NOME_PRODUTO} está sem altura ou largura no estoque; confira o cadastro.`;
    }
  }
  const chapaDe = chave => {
    const cod = escolhido[chave];
    if (cod === null || cod === undefined) return null;
    const c = porCodigo.get(cod);
    return c ? { produtoCodigo: c.codigo, produtoNome: c.nome, altura: c.altura, largura: c.largura } : { produtoCodigo: cod, produtoNome: null, altura: 0, largura: 0 };
  };
  const plano = otimizarVidros({ pecas: base.pecas, retalhos, chapaDe, parametros });
  for (const g of plano.grupos) if (invalidos[g.chave]) g.erros = [invalidos[g.chave]];
  const retalhosUsados = plano.grupos.flatMap(g => g.chapas).filter(c => c.tipo === 'retalho').map(c => c.retalhoId).sort((a, b) => a - b);
  const produtosUsados = [...new Set(plano.grupos.map(g => g.produtoCodigo).filter(c => c !== null && c !== undefined && porCodigo.has(c)))].sort((a, b) => a - b);
  return { ...base, plano, parametros, candidatos, escolhido, impressao: impressaoPecasVidro(base.pecas), retalhosUsados, produtosUsados };
}

// escolhas: objeto { chave: produtoCodigo }; null = ilegível
function validarEscolhas(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const saida = {};
  for (const [chave, cod] of Object.entries(o)) {
    const n = typeof cod === 'number' || (typeof cod === 'string' && /^\d+$/.test(cod)) ? inteiroPositivo(cod) : null;
    if (!n) return null;
    saida[chave] = n;
  }
  return saida;
}
// escolhas da query: JSON { chave: produtoCodigo }; null = ilegível
function lerEscolhas(bruto) {
  if (bruto === undefined || bruto === '') return {};
  if (typeof bruto !== 'string') return null;
  let o;
  try { o = JSON.parse(bruto); } catch { return null; }
  return validarEscolhas(o);
}

function registrarCorteVidros({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);
  const idDaRota = req => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const retalhoParaJson = r => ({ id: Number(r.id), produtoCodigo: Number(r.produto_codigo), produtoNome: r.produto_nome, altura: Number(r.altura), largura: Number(r.largura),
    situacao: r.situacao, planoOrigem: paraNumeroOuNull(r.plano_origem), planoReserva: paraNumeroOuNull(r.plano_reserva), criadoEm: r.criado_em || null });

  // ---------- parâmetros: serra e sobra mínima (linha única; sem linha valem os padrões do código) ----------
  rota('get', '/corte_vidros/config', VER, async (req, res) => {
    try { res.json({ padraoDeFabrica: PADRAO, padrao: await lerConfig(pool) }); }
    catch (err) { console.error('Erro GET /corte_vidros/config:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  rota('put', '/corte_vidros/config', PARAMETROS, async (req, res) => {
    const v = validarConfigVidros(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte_vidros/config', async conn => {
      await conn.execute('INSERT INTO web_vidro_config (id, serra, sobra_minima, atualizado_em, atualizado_por) VALUES (1, ?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE serra = VALUES(serra), sobra_minima = VALUES(sobra_minima), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)',
        [d.serra, d.sobraMinima, agoraLocal(), req.acesso?.nome || '']);
      await auditar(conn, req, 'corte_vidros_config_alterada', 'padrão', { campos: ['serra', 'sobraMinima'], serra: d.serra, sobraMinima: d.sobraMinima });
      return { ok: true, serra: d.serra, sobraMinima: d.sobraMinima };
    });
    if (r) res.json(r);
  });

  // ---------- retalhos ----------
  rota('get', '/corte_vidros/retalhos', VER, async (req, res) => {
    const situacao = req.query.situacao;
    if (situacao !== undefined && situacao !== '' && !SITUACOES_RETALHO.includes(situacao)) return res.status(400).json({ error: 'Situação de retalho inválida.' });
    try {
      const colunas = 'SELECT id, produto_codigo, produto_nome, altura, largura, situacao, plano_origem, plano_reserva, criado_em FROM web_vidro_retalhos';
      const ordem = ' ORDER BY produto_nome, altura, largura, id';
      const [linhas] = situacao ? await pool.execute(`${colunas} WHERE situacao = ?${ordem}`, [situacao]) : await pool.execute(colunas + ordem);
      res.json({ retalhos: linhas.map(retalhoParaJson) });
    } catch (err) { console.error('Erro GET /corte_vidros/retalhos:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // o produto do retalho manual precisa ser um dos candidatos (vidro ativo com medida); o nome é copiado do estoque
  const produtoDoRetalho = async (conn, codigo) => {
    const p = (await lerCandidatos(conn)).find(c => c.codigo === codigo);
    if (!p) throw new ErroUsuario(400, 'Produto (vidro) não encontrado entre os vidros ativos do estoque (classe Revestimento, com altura e largura).');
    return p;
  };

  rota('post', '/corte_vidros/retalhos', PARAMETROS, async (req, res) => {
    const v = validarRetalhoVidro(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'POST /corte_vidros/retalhos', async conn => {
      const prod = await produtoDoRetalho(conn, d.produtoCodigo);
      const agora = agoraLocal();
      const [ins] = await conn.execute(
        "INSERT INTO web_vidro_retalhos (produto_codigo, produto_nome, altura, largura, situacao, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 'disponivel', ?, ?, ?)",
        [d.produtoCodigo, prod.nome, d.altura, d.largura, req.acesso?.nome || '', agora, agora]);
      await auditar(conn, req, 'corte_vidros_retalho_criado', ins.insertId, { campos: ['produto', 'altura', 'largura'], produto: d.produtoCodigo, altura: d.altura, largura: d.largura, origem: 'manual' });
      return { ok: true, id: Number(ins.insertId), ...d, produtoNome: prod.nome, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  // retalho só muda à mão enquanto está disponível (reservado/usado/descartado pertencem a um plano ou ao histórico)
  async function travarDisponivel(conn, id) {
    const [[atual]] = await conn.execute('SELECT id, situacao FROM web_vidro_retalhos WHERE id = ? FOR UPDATE', [id]);
    if (!atual) throw new ErroUsuario(404, 'Retalho não encontrado.');
    if (atual.situacao !== 'disponivel') throw new ErroUsuario(409, `Retalho ${atual.situacao}: só retalho disponível pode ser alterado.`);
  }

  rota('put', '/corte_vidros/retalhos/:id', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const v = validarRetalhoVidro(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.erro });
    const d = v.dados;
    const r = await emTransacao(pool, res, 'PUT /corte_vidros/retalhos/:id', async conn => {
      await travarDisponivel(conn, id);
      const prod = await produtoDoRetalho(conn, d.produtoCodigo);
      await conn.execute('UPDATE web_vidro_retalhos SET produto_codigo = ?, produto_nome = ?, altura = ?, largura = ?, atualizado_em = ? WHERE id = ?',
        [d.produtoCodigo, prod.nome, d.altura, d.largura, agoraLocal(), id]);
      await auditar(conn, req, 'corte_vidros_retalho_alterado', id, { campos: ['produto', 'altura', 'largura'], produto: d.produtoCodigo, altura: d.altura, largura: d.largura });
      return { ok: true, id, ...d, produtoNome: prod.nome, situacao: 'disponivel' };
    });
    if (r) res.json(r);
  });

  rota('post', '/corte_vidros/retalhos/:id/descartar', PARAMETROS, async (req, res) => {
    const id = idDaRota(req);
    if (!id) return res.status(404).json({ error: 'Retalho não encontrado.' });
    const r = await emTransacao(pool, res, 'POST /corte_vidros/retalhos/:id/descartar', async conn => {
      await travarDisponivel(conn, id);
      await conn.execute("UPDATE web_vidro_retalhos SET situacao = 'descartado', atualizado_em = ? WHERE id = ?", [agoraLocal(), id]);
      await auditar(conn, req, 'corte_vidros_retalho_descartado', id, { campos: ['situacao'] });
      return { ok: true, id, situacao: 'descartado' };
    });
    if (r) res.json(r);
  });

  // produtos do estoque para escolher a chapa de cada grupo (só candidatos; código, nome, unidade, medida e quantidade — nada de dinheiro)
  rota('get', '/corte_vidros/estoque/produtos', [...PLANEJAR, ...BAIXAR_ESTOQUE], async (req, res) => {
    try { res.json({ produtos: await lerCandidatos(pool) }); }
    catch (err) { console.error('Erro GET /corte_vidros/estoque/produtos:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // ---------- plano de corte de um pedido ----------
  const resumoPlanoSalvo = (p, desatualizado) => p && ({ id: Number(p.id), situacao: desatualizado && p.situacao === 'gerado' ? 'desatualizado' : p.situacao,
    criadoPor: p.criado_por || '', criadoEm: p.criado_em || null, conferidoEm: p.conferido_em || null });

  // pré-visualização: calcula e devolve, sem gravar nada e sem reservar retalho
  rota('get', '/corte_vidros/pedido/:numero', VER, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const escolhas = lerEscolhas(req.query.escolhas);
    if (escolhas === null) return res.status(400).json({ error: 'Escolhas de produto inválidas (esperado um JSON { chave: código do produto }).' });
    try {
      const ped = await lerPedido(pool, numero);
      if (!ped) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const ativo = await planoAtivo(pool, numero);
      const calc = await calcularPlanoVidro(pool, numero, escolhas, ativo && ativo.situacao === 'gerado' ? Number(ativo.id) : 0);
      if (calc.vazio) return res.status(404).json({ error: 'Este pedido não tem vidros.' });
      const [[cont]] = await pool.execute("SELECT COUNT(*) AS qtd, SUM(situacao = 'conferido') AS conferidos FROM web_vidro_planos WHERE pedido = ? AND excluido_em IS NULL", [numero]);
      const porGrupo = new Map();
      for (const p of calc.pecas) {
        const chave = chaveGrupoVidro(p);
        if (!porGrupo.has(chave)) porGrupo.set(chave, { chave, modelo: p.modelo, cor: p.cor, qtdPecas: 0 });
        porGrupo.get(chave).qtdPecas++;
      }
      const grupos = [...porGrupo.values()].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0)).map(g => {
        const doNome = candidatosDoModelo(calc.candidatos, g.modelo);
        return { ...g, candidatos: doNome.map(c => ({ codigo: c.codigo, nome: c.nome, altura: c.altura, largura: c.largura })), preSelecionado: doNome.length === 1 ? doNome[0].codigo : null };
      });
      res.json({
        pedido: { numero, cliente: ped.RAZAO_SOCIAL || '', situacao: ped.SITUACAO || '' },
        vazio: false, mensagem: null,
        qtdPlanosGravados: Number(cont && cont.qtd) || 0, qtdConferidos: Number(cont && cont.conferidos) || 0,
        qtdPecas: calc.pecas.length, pendencias: calc.pendencias, grupos, plano: calc.plano, impressao: calc.impressao, retalhosUsados: calc.retalhosUsados,
        planoSalvo: resumoPlanoSalvo(ativo, ativo && ativo.impressao_pecas !== calc.impressao)
      });
    } catch (err) { console.error('Erro GET /corte_vidros/pedido:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // salvar: recalcula dentro da transação com os retalhos travados; se o pedido, os retalhos ou o produto escolhido mudaram desde a pré-visualização, recusa (409)
  rota('post', '/corte_vidros/pedido/:numero/salvar', PLANEJAR, async (req, res) => {
    const numero = inteiroPositivo(req.params.numero);
    if (!numero) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const corpo = req.body || {};
    const escolhas = corpo.escolhas === undefined ? {} : validarEscolhas(corpo.escolhas);
    if (escolhas === null) return res.status(400).json({ error: 'Escolhas de produto inválidas (esperado um objeto { chave: código do produto }).' });
    const r = await emTransacao(pool, res, 'POST /corte_vidros/pedido/:numero/salvar', async conn => {
      const ped = await lerPedido(conn, numero, true);
      if (!ped) throw new ErroUsuario(404, 'Pedido não encontrado.');
      if (ped.SITUACAO === 'Cancelado') throw new ErroUsuario(409, 'Pedido cancelado não recebe plano de corte.');
      const ativo = await planoAtivo(conn, numero, true);
      if (ativo && ativo.situacao === 'conferido') throw new ErroUsuario(409, 'Este pedido já tem um plano conferido.');
      const calc = await calcularPlanoVidro(conn, numero, escolhas, ativo ? Number(ativo.id) : 0, true);
      if (!calc.pecas.length) throw new ErroUsuario(409, 'Não há peças para planejar neste pedido (veja as pendências).');
      const vistos = Array.isArray(corpo.retalhosUsados) ? corpo.retalhosUsados.map(Number).sort((a, b) => a - b) : null;
      if (corpo.impressao !== calc.impressao) throw new ErroUsuario(409, 'O pedido mudou desde a pré-visualização. Recalcule o plano.');
      if (!vistos || vistos.join(',') !== calc.retalhosUsados.join(',')) throw new ErroUsuario(409, 'Os retalhos disponíveis mudaram desde a pré-visualização. Recalcule o plano.');
      const semProduto = calc.plano.grupos.find(g => g.aguardandoProduto || g.erros.length);
      if (semProduto) {
        const nome = semProduto.modelo + (semProduto.cor ? ' / ' + semProduto.cor : '');
        throw new ErroUsuario(409, semProduto.aguardandoProduto ? `Escolha o produto (vidro) de ${nome} antes de salvar o plano.`
          : `Escolha o produto (vidro) de ${nome}: ${semProduto.erros[0]}`);
      }
      if (ativo) { await liberarReservas(conn, Number(ativo.id)); await cancelarPlano(conn, Number(ativo.id)); }
      const agora = agoraLocal(), quem = req.acesso?.nome || '';
      const resultado = { qtdPecas: calc.pecas.length, pendencias: calc.pendencias, plano: calc.plano, escolhas };
      const parametros = { serra: calc.parametros.serra, sobraMinima: calc.parametros.sobraMinima };
      const [ins] = await conn.execute('INSERT INTO web_vidro_planos (pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [numero, 'gerado', calc.impressao, JSON.stringify(parametros), JSON.stringify(resultado), '[]', quem, agora]);
      const id = Number(ins.insertId);
      for (const retalhoId of calc.retalhosUsados) {
        const [rr] = await conn.execute("UPDATE web_vidro_retalhos SET situacao = 'reservado', plano_reserva = ?, atualizado_em = ? WHERE id = ? AND situacao = 'disponivel'", [id, agora, retalhoId]);
        if (!rr.affectedRows) throw new ErroUsuario(409, 'Um retalho foi reservado por outro plano. Recalcule o plano.');
      }
      await auditarConn(conn, quem, 'corte_vidros_plano_salvo', id, { campos: ['plano'], pedido: numero, qtdPecas: calc.pecas.length, qtdChapasNovas: calc.plano.resumo.qtdChapasNovas,
        qtdRetalhosUsados: calc.plano.resumo.qtdRetalhosUsados, substituiu: ativo ? Number(ativo.id) : null });
      return { ok: true, id, pedido: numero };
    });
    if (r) res.json(r);
  });

  const COLUNAS_PLANO = 'id, pedido, situacao, impressao_pecas, parametros, resultado, progresso, criado_por, criado_em, conferido_por, conferido_em';
  async function travarPlano(conn, id) {
    const [[p]] = await conn.execute(`SELECT ${COLUNAS_PLANO} FROM web_vidro_planos WHERE id = ? FOR UPDATE`, [id]);
    if (!p) throw new ErroUsuario(404, 'Plano não encontrado.');
    return p;
  }
  const exigirGerado = p => { if (p.situacao !== 'gerado') throw new ErroUsuario(409, `Plano ${p.situacao}: só plano gerado aceita esta operação.`); };

  rota('get', '/corte_vidros/plano/:id', VER, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    try {
      const [[p]] = await pool.execute(`SELECT ${COLUNAS_PLANO} FROM web_vidro_planos WHERE id = ?`, [id]);
      if (!p) return res.status(404).json({ error: 'Plano não encontrado.' });
      let situacao = p.situacao;
      if (situacao === 'gerado') {
        const atual = await lerPecasVidroDoPedido(pool, Number(p.pedido));
        if (impressaoPecasVidro(atual.pecas) !== p.impressao_pecas) situacao = 'desatualizado';
      }
      const resultado = lerJson(p.resultado, {});
      res.json({ id: Number(p.id), pedido: Number(p.pedido), situacao, criadoPor: p.criado_por || '', criadoEm: p.criado_em || null,
        conferidoPor: p.conferido_por || '', conferidoEm: p.conferido_em || null, qtdPecas: resultado.qtdPecas || 0, pendencias: resultado.pendencias || [],
        plano: resultado.plano || { grupos: [], resumo: {} }, escolhas: resultado.escolhas || {}, cortadas: lerJson(p.progresso, []) });
    } catch (err) { console.error('Erro GET /corte_vidros/plano:', err.message); res.status(500).json({ error: 'Erro de servidor' }); }
  });

  // marcar / desmarcar uma peça como cortada (o progresso é só do plano; o estoque de retalhos só muda ao conferir)
  const MAX_MARCAS = 500;
  rota('put', '/corte_vidros/plano/:id/pecas', PLANEJAR, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    // uma marca ({grupo,chapa,peca,cortada}) ou várias de uma vez ({marcas:[...]}): a tela junta os cliques e envia em lote
    const corpo = req.body || {};
    const marcas = Array.isArray(corpo.marcas) ? corpo.marcas : [corpo];
    if (!marcas.length || marcas.length > MAX_MARCAS) return res.status(400).json({ error: 'Lista de peças inválida.' });
    const r = await emTransacao(pool, res, 'PUT /corte_vidros/plano/:id/pecas', async conn => {
      const p = await travarPlano(conn, id);
      exigirGerado(p);
      const grupos = lerJson(p.resultado, {}).plano?.grupos || [];
      let lista = lerJson(p.progresso, []);
      for (const m of marcas) {
        const { grupo, chapa, peca, cortada } = m || {};
        const g = grupos.find(x => x.chave === grupo);
        const c = g && Number.isInteger(chapa) ? g.chapas[chapa] : null;
        if (!c || !Number.isInteger(peca) || peca < 0 || peca >= c.pecas.length || typeof cortada !== 'boolean') throw new ErroUsuario(400, 'Peça inexistente no plano.');
        lista = lista.filter(x => !(x.grupo === grupo && x.chapa === chapa && x.peca === peca));
        if (cortada) lista.push({ grupo, chapa, peca });
      }
      await conn.execute("UPDATE web_vidro_planos SET progresso = ? WHERE id = ? AND situacao = 'gerado'", [JSON.stringify(lista), id]);
      return { ok: true, qtdCortadas: lista.length };
    });
    if (r) res.json(r);
  });

  rota('post', '/corte_vidros/plano/:id/cancelar', PLANEJAR, async (req, res) => {
    const id = inteiroPositivo(req.params.id);
    if (!id) return res.status(404).json({ error: 'Plano não encontrado.' });
    const r = await emTransacao(pool, res, 'POST /corte_vidros/plano/:id/cancelar', async conn => {
      const p = await travarPlano(conn, id);
      exigirGerado(p);
      await liberarReservas(conn, id);
      await cancelarPlano(conn, id);
      await auditarConn(conn, req.acesso?.nome, 'corte_vidros_plano_cancelado', id, { campos: ['situacao'], pedido: Number(p.pedido) });
      return { ok: true, id, situacao: 'cancelado' };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarCorteVidros, liberarPlanosVidroDoPedido };
