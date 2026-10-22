// ==========================================================================
// Formação de preços — partes B + C: do custo (parte A) ao VALOR_FIXO (aba "Formação de preço" em custos.html).
// Lê cadastro_de_produtos, cadastro_clientes, ped_orc e fluxo_de_caixa (tabelas do VB, só leitura);
// grava em web_custo_parametros, web_preco_* e web_auditoria. A ÚNICA escrita numa tabela do VB é
// UPDATE cadastro_de_produtos SET VALOR_FIXO, na gravação confirmada e no desfazer.
// ==========================================================================
const { semValores } = require('../seguranca/valores');
const { formarPreco } = require('../calculo/precos_formacao');
const { referenciaComissao, referenciaDesconto, referenciaCustoFixo } = require('../calculo/precos_referencias');
const { chaveMySQL } = require('../calculo/nomes');
const { carregarBase, lerParametros, custoDo, inicioDoPeriodo, ativo } = require('./custos');
const crypto = require('crypto');
const { agoraLocal, emTransacao, ErroUsuario } = require('./estoque_movimentos');

const LER = ['precos.ver', 'valores.ver'];
const EDITAR = ['precos.ver', 'precos.editar', 'valores.ver'];
const GRAVAR = ['precos.ver', 'precos.gravar', 'valores.ver'];
const MAX_ITENS = 500, TOLERANCIA = 0.005;
const CAMPOS_VALOR = ['custo', 'minimo', 'equilibrio', 'alvo', 'sugerido', 'atual', 'despesasMes', 'receitasMes', 'receitasSemClassificacao', 'total',
  'valorAnterior', 'valorNovo', 'precoMedio', 'referencia', 'valorFixo', 'valor', 'precoConvertido', 'custoUnitario'];
// chave em web_custo_parametros → campo da tela
const CHAVES = [['imposto_pct', 'impostoPct'], ['comissao_pct', 'comissaoPct'], ['custo_fixo_pct', 'custoFixoPct'], ['desconto_pct', 'descontoPct'], ['margem_pct', 'margemPct']];
const MESES_PADRAO = 12;
const NOMES_CAMPOS = { impostoPct: 'imposto', comissaoPct: 'comissão', custoFixoPct: 'custo fixo', descontoPct: 'desconto', margemPct: 'margem padrão' };

const duasCasas = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const numeroOuNulo = v => v === null ? null : Number(v);
// mesmo valor (dentro da tolerância) e mesma nulidade
const mesmoValor = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCIA);
const reais = v => (v === null ? 'vazio' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctValido = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 99.999;

async function lerParametrosPreco(db) {
  const [rows] = await db.execute('SELECT chave, valor FROM web_custo_parametros');
  const p = Object.fromEntries(CHAVES.map(([, campo]) => [campo, null]));
  p.referenciaMeses = MESES_PADRAO;
  for (const r of rows) {
    const campo = CHAVES.find(([k]) => k === r.chave)?.[1];
    const n = Number(r.valor);
    if (campo && String(r.valor).trim() !== '' && pctValido(n)) p[campo] = n;
    if (r.chave === 'referencia_meses' && Number.isInteger(n) && n >= 1 && n <= 36) p.referenciaMeses = n;
  }
  return p;
}

// premissas, margens e referências: poucas consultas, nenhuma por material
async function carregarPrecos(db) {
  const parametros = await lerParametrosPreco(db);
  const [encargos] = await db.execute('SELECT id, nome, pct, ativo FROM web_preco_encargos ORDER BY id');
  const [margensRows] = await db.execute('SELECT escopo, chave, margem_pct FROM web_preco_margens ORDER BY escopo, chave');
  const desde = inicioDoPeriodo(parametros.referenciaMeses);
  const [clientes] = await db.execute(
    `SELECT COMISSAO, DESCONTO, TIPO_DESCONTO FROM cadastro_clientes
     WHERE RAZAO_SOCIAL IN (SELECT RAZAO_SOCIAL FROM ped_orc WHERE TIPO = 'Pedido' AND DATA >= ?)`, [desde]);
  const [grupos] = await db.execute(
    `SELECT c.id AS classificacaoId, CONCAT_WS(' › ', NULLIF(c.CLASSE1, ''), NULLIF(c.CLASSE2, ''), NULLIF(c.CLASSE3, '')) AS nome,
            c.COMPORTAMENTO, c.ENTRA_DRE, f.SITUACAO, SUM(f.VALOR) AS total
     FROM fluxo_de_caixa f LEFT JOIN fluxo_de_caixa_classificacao c ON c.id = f.COD_CLASSIFICACAO
     WHERE f.SITUACAO IN ('Pago', 'Recebido') AND f.DATA >= ?
     GROUP BY c.id, c.CLASSE1, c.CLASSE2, c.CLASSE3, c.COMPORTAMENTO, c.ENTRA_DRE, f.SITUACAO`, [desde]);
  const margens = {
    padrao: parametros.margemPct,
    classes: margensRows.filter(m => m.escopo === 'classe').map(m => ({ classe: m.chave, pct: Number(m.margem_pct) })),
    materiais: margensRows.filter(m => m.escopo === 'material').map(m => ({ codigo: Number(m.chave), pct: Number(m.margem_pct) }))
  };
  const desconto = referenciaDesconto(clientes);
  return {
    parametros,
    encargos: encargos.map(e => ({ id: Number(e.id), nome: e.nome, pct: Number(e.pct), ativo: !!Number(e.ativo) })),
    margens,
    referencias: {
      comissao: referenciaComissao(clientes),
      desconto,
      custoFixo: referenciaCustoFixo(grupos.map(g => ({ ...g, classificacaoId: g.classificacaoId === null ? null : Number(g.classificacaoId), total: Number(g.total) || 0 })),
        parametros.referenciaMeses)
    },
    descontoMax: desconto.maior
  };
}

// o formato que formarPreco espera
const margensParaCalculo = m => ({
  padrao: m.padrao,
  classes: new Map(m.classes.map(c => [chaveMySQL(c.classe), c.pct])),
  materiais: new Map(m.materiais.map(x => [x.codigo, x.pct]))
});

// custo (parte A) + preço de um material
function precoDo(base, precos, custosParam, material) {
  const custoInfo = custoDo(base, material, inicioDoPeriodo(custosParam.periodoMeses), custosParam.divergenciaPct);
  const preco = formarPreco({ custoInfo, material, parametros: precos.parametros, encargos: precos.encargos,
    margens: margensParaCalculo(precos.margens), descontoMax: precos.descontoMax });
  return { custoInfo, preco };
}

function registrarPrecosFormacao({ rota, pool }) {
  const falha = (res, nome, err) => { console.error(`Erro ${nome}:`, err.message); res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/precos/formacao', LER, async (req, res) => {
    try {
      const custosParam = await lerParametros(pool);
      const base = await carregarBase(pool);
      const precos = await carregarPrecos(pool);
      const materiais = base.materiais.filter(ativo).map(m => {
        const { custoInfo, preco } = precoDo(base, precos, custosParam, m);
        return { codigo: Number(m.CODIGO), modelo: m.MODELO, classe: m.CLASSE || '', unidade: custoInfo.unidade, ativo: true,
          valorFixo: m.VALOR_FIXO === null ? null : Number(m.VALOR_FIXO), ...preco };
      });
      const resumo = { total: materiais.length, comPreco: materiais.filter(m => m.sugerido !== null).length,
        semPreco: materiais.filter(m => m.sugerido === null).length, comAviso: materiais.filter(m => m.avisos.length).length };
      const { descontoMax, ...resto } = precos;
      res.json(semValores(req, { ...resto, resumo, materiais }, CAMPOS_VALOR));
    } catch (err) { falha(res, 'GET /precos/formacao', err); }
  });

  rota('get', '/precos/formacao/:codigo', LER, async (req, res) => {
    try {
      const codigo = Number(req.params.codigo);
      const custosParam = await lerParametros(pool);
      const base = await carregarBase(pool);
      const m = base.materiais.find(x => Number(x.CODIGO) === codigo);
      if (!m) return res.status(404).json({ error: 'Material não encontrado.' });
      const precos = await carregarPrecos(pool);
      const { custoInfo, preco } = precoDo(base, precos, custosParam, m);
      const [hist] = await pool.execute(
        'SELECT id, valor_anterior, valor_novo, gravado_em, gravado_por, desfeito_em, desfeito_por FROM web_preco_historico WHERE material_codigo = ? ORDER BY id DESC LIMIT 20',
        [codigo]);
      const ultimoId = hist.filter(h => !h.desfeito_em).reduce((mx, h) => Math.max(mx, Number(h.id)), 0);
      const historico = hist.map(h => ({ id: Number(h.id), valorAnterior: h.valor_anterior === null ? null : Number(h.valor_anterior), valorNovo: Number(h.valor_novo),
        gravadoEm: h.gravado_em, gravadoPor: h.gravado_por, desfeitoEm: h.desfeito_em, desfeitoPor: h.desfeito_por, ultimo: Number(h.id) === ultimoId }));
      res.json(semValores(req, {
        material: { codigo, modelo: m.MODELO, classe: m.CLASSE || '', unidade: custoInfo.unidade, ativo: ativo(m) },
        custo: { situacao: custoInfo.situacao, motivos: custoInfo.motivos, passos: custoInfo.passos, ultimaCompra: custoInfo.ultimaCompra },
        preco, descontoMax: precos.descontoMax, historico
      }, CAMPOS_VALOR));
    } catch (err) { falha(res, 'GET /precos/formacao/:codigo', err); }
  });

  const auditar = (req, acao, alvo, detalhe) => pool.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || req.usuario?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);
  const quem = req => req.acesso?.nome || '';

  // campo ausente fica como está; null apaga a premissa (volta a "não definido")
  rota('put', '/precos/parametros', EDITAR, async (req, res) => {
    try {
      const b = req.body || {};
      for (const campo of Object.keys(NOMES_CAMPOS))
        if (b[campo] !== undefined && b[campo] !== null && !pctValido(b[campo]))
          return res.status(400).json({ error: `Percentual de ${NOMES_CAMPOS[campo]} inválido: use de 0% a 99,999%.` });
      if (b.referenciaMeses !== undefined && !(Number.isInteger(b.referenciaMeses) && b.referenciaMeses >= 1 && b.referenciaMeses <= 36))
        return res.status(400).json({ error: 'Período das referências: de 1 a 36 meses.' });
      const antes = await lerParametrosPreco(pool);
      for (const [chave, campo] of CHAVES) {
        if (b[campo] === undefined) continue;
        if (b[campo] === null) await pool.execute('DELETE FROM web_custo_parametros WHERE chave = ?', [chave]);
        else await pool.execute('INSERT INTO web_custo_parametros (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [chave, String(b[campo])]);
      }
      if (b.referenciaMeses !== undefined)
        await pool.execute('INSERT INTO web_custo_parametros (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', ['referencia_meses', String(b.referenciaMeses)]);
      const depois = await lerParametrosPreco(pool);
      await auditar(req, 'preco_parametros_alterados', '', { antes, depois });
      res.json({ ok: true, parametros: depois });
    } catch (err) { falha(res, 'PUT /precos/parametros', err); }
  });

  const nomeEncargo = v => (typeof v === 'string' && v.trim() && v.trim().length <= 60 ? v.trim() : null);

  rota('post', '/precos/encargos', EDITAR, async (req, res) => {
    try {
      const b = req.body || {}, nome = nomeEncargo(b.nome);
      if (!nome) return res.status(400).json({ error: 'Nome do encargo: obrigatório, até 60 caracteres.' });
      if (!pctValido(b.pct)) return res.status(400).json({ error: 'Percentual do encargo: de 0% a 99,999%.' });
      const [r] = await pool.execute('INSERT INTO web_preco_encargos (nome, pct, ativo, atualizado_em, atualizado_por) VALUES (?, ?, 1, ?, ?)',
        [nome, b.pct, agoraLocal(), quem(req)]);
      await auditar(req, 'preco_encargo_criado', r.insertId, { nome, pct: b.pct });
      res.status(201).json({ id: r.insertId });
    } catch (err) { falha(res, 'POST /precos/encargos', err); }
  });

  rota('put', '/precos/encargos/:id', EDITAR, async (req, res) => {
    try {
      const b = req.body || {}, id = Number(req.params.id);
      if (b.nome !== undefined && !nomeEncargo(b.nome)) return res.status(400).json({ error: 'Nome do encargo: obrigatório, até 60 caracteres.' });
      if (b.pct !== undefined && !pctValido(b.pct)) return res.status(400).json({ error: 'Percentual do encargo: de 0% a 99,999%.' });
      const [rows] = await pool.execute('SELECT id, nome, pct, ativo FROM web_preco_encargos WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Encargo não encontrado.' });
      const e = rows[0];
      const novo = { nome: b.nome !== undefined ? nomeEncargo(b.nome) : e.nome, pct: b.pct !== undefined ? b.pct : Number(e.pct),
        ativo: b.ativo !== undefined ? (b.ativo ? 1 : 0) : Number(e.ativo) };
      await pool.execute('UPDATE web_preco_encargos SET nome = ?, pct = ?, ativo = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
        [novo.nome, novo.pct, novo.ativo, agoraLocal(), quem(req), id]);
      await auditar(req, 'preco_encargo_alterado', id, { antes: { nome: e.nome, pct: Number(e.pct), ativo: !!Number(e.ativo) }, depois: { ...novo, ativo: !!novo.ativo } });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /precos/encargos/:id', err); }
  });

  rota('delete', '/precos/encargos/:id', EDITAR, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [rows] = await pool.execute('SELECT id, nome, pct, ativo FROM web_preco_encargos WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Encargo não encontrado.' });
      await pool.execute('DELETE FROM web_preco_encargos WHERE id = ?', [id]);
      await auditar(req, 'preco_encargo_excluido', id, { nome: rows[0].nome, pct: Number(rows[0].pct) });
      res.json({ ok: true });
    } catch (err) { falha(res, 'DELETE /precos/encargos/:id', err); }
  });

  // margem por classe (texto como está no cadastro) ou por material; null remove
  rota('put', '/precos/margens', EDITAR, async (req, res) => {
    try {
      const b = req.body || {};
      if (!['classe', 'material'].includes(b.escopo)) return res.status(400).json({ error: 'Escopo da margem: classe ou material.' });
      if (b.margemPct !== null && !pctValido(b.margemPct)) return res.status(400).json({ error: 'Margem: de 0% a 99,999%.' });
      let chave;
      if (b.escopo === 'classe') {
        const [rows] = await pool.execute('SELECT DISTINCT CLASSE FROM cadastro_de_produtos');
        chave = rows.map(r => r.CLASSE).find(c => c && chaveMySQL(c) === chaveMySQL(b.chave)) || null;
        if (!chave) return res.status(400).json({ error: 'Classe não encontrada no cadastro de produtos.' });
      } else {
        const codigo = Number(b.chave);
        const [rows] = Number.isInteger(codigo) ? await pool.execute('SELECT CODIGO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [codigo]) : [[]];
        if (!rows.length) return res.status(400).json({ error: 'Material não encontrado no cadastro de produtos.' });
        chave = String(codigo);
      }
      if (b.margemPct === null) await pool.execute('DELETE FROM web_preco_margens WHERE escopo = ? AND chave = ?', [b.escopo, chave]);
      else await pool.execute(`INSERT INTO web_preco_margens (escopo, chave, margem_pct, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE margem_pct = VALUES(margem_pct), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
        [b.escopo, chave, b.margemPct, agoraLocal(), quem(req)]);
      await auditar(req, 'preco_margem_alterada', `${b.escopo}:${chave}`, { margemPct: b.margemPct });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /precos/margens', err); }
  });

  // grava o VALOR_FIXO confirmado na tela; tudo ou nada; recusa se o valor mudou desde a leitura
  rota('post', '/precos/gravar', GRAVAR, async (req, res) => {
    const itens = req.body?.itens;
    if (!Array.isArray(itens) || !itens.length || itens.length > MAX_ITENS)
      return res.status(400).json({ error: `Selecione de 1 a ${MAX_ITENS} materiais para gravar.` });
    for (const i of itens) {
      if (!Number.isInteger(i?.codigo)) return res.status(400).json({ error: 'Código de material inválido.' });
      if (!duasCasas(i.valorNovo) || !(i.valorNovo > 0)) return res.status(400).json({ error: `Valor novo inválido no material ${i.codigo}: maior que zero e com até 2 casas.` });
      if (i.valorEsperado !== null && !(typeof i.valorEsperado === 'number' && Number.isFinite(i.valorEsperado)))
        return res.status(400).json({ error: `Valor atual inválido no material ${i.codigo}.` });
    }
    const codigos = itens.map(i => i.codigo);
    if (new Set(codigos).size !== codigos.length) return res.status(400).json({ error: 'Material repetido na gravação.' });
    let base, precos, custosParam;
    try {
      custosParam = await lerParametros(pool);
      base = await carregarBase(pool);
      precos = await carregarPrecos(pool);
    } catch (err) { return falha(res, 'POST /precos/gravar', err); }
    const lote = crypto.randomUUID();
    const quando = agoraLocal();
    const feito = await emTransacao(pool, res, 'POST /precos/gravar', async conn => {
      const [rows] = await conn.execute(`SELECT CODIGO, VALOR_FIXO FROM cadastro_de_produtos WHERE CODIGO IN (${codigos.map(() => '?').join(',')}) FOR UPDATE`, codigos);
      const atuais = new Map(rows.map(r => [Number(r.CODIGO), numeroOuNulo(r.VALOR_FIXO)]));
      const faltando = codigos.filter(c => !atuais.has(c));
      if (faltando.length) throw new ErroUsuario(400, `Material não encontrado: ${faltando.join(', ')}.`);
      const conflitos = itens.filter(i => !mesmoValor(atuais.get(i.codigo), i.valorEsperado)).map(i => ({ codigo: i.codigo, atual: atuais.get(i.codigo) }));
      if (conflitos.length) throw new ErroUsuario(409, 'O preço de alguns materiais mudou desde que você abriu a tela. Recarregue para ver os valores atuais.', { conflitos });
      for (const i of itens) {
        const material = base.materiais.find(m => Number(m.CODIGO) === i.codigo);
        const calc = material ? precoDo(base, precos, custosParam, material) : null;
        const p = calc?.preco;
        const memoria = { sugerido: p?.sugerido ?? null, valorNovo: i.valorNovo, custo: p?.custo ?? null, situacaoCusto: calc?.custoInfo.situacao ?? null,
          parametros: precos.parametros, encargos: precos.encargos.filter(e => e.ativo), margem: p?.M === null || !p ? null : { pct: p.M, origem: p.origemMargem },
          minimo: p?.minimo ?? null, equilibrio: p?.equilibrio ?? null, alvo: p?.alvo ?? null };
        await conn.execute('UPDATE cadastro_de_produtos SET VALOR_FIXO = ? WHERE CODIGO = ?', [i.valorNovo, i.codigo]);
        await conn.execute(`INSERT INTO web_preco_historico (lote, material_codigo, valor_anterior, valor_novo, custo, memoria, gravado_em, gravado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [lote, i.codigo, atuais.get(i.codigo), i.valorNovo, memoria.custo, JSON.stringify(memoria), quando, quem(req)]);
        await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
          [quando, quem(req), 'preco_gravado', String(i.codigo), JSON.stringify({ lote, de: atuais.get(i.codigo), para: i.valorNovo })]);
      }
      return { lote, gravados: itens.length };
    });
    if (feito) res.json(feito);
  });

  // volta ao valor anterior: só a última gravação não desfeita do material, e só se ninguém mudou o valor depois
  rota('post', '/precos/desfazer/:id', GRAVAR, async (req, res) => {
    const id = Number(req.params.id);
    const feito = await emTransacao(pool, res, 'POST /precos/desfazer', async conn => {
      const [hs] = await conn.execute('SELECT id, material_codigo, valor_anterior, valor_novo, desfeito_em FROM web_preco_historico WHERE id = ? FOR UPDATE', [id]);
      if (!hs.length) throw new ErroUsuario(404, 'Gravação não encontrada.');
      const h = hs[0], codigo = Number(h.material_codigo);
      const [[u]] = await conn.execute('SELECT MAX(id) AS ultimo FROM web_preco_historico WHERE material_codigo = ? AND desfeito_em IS NULL', [codigo]);
      if (h.desfeito_em || Number(u?.ultimo) !== id) throw new ErroUsuario(409, 'Só a última gravação deste material pode ser desfeita.');
      const [rows] = await conn.execute('SELECT CODIGO, VALOR_FIXO FROM cadastro_de_produtos WHERE CODIGO IN (?) FOR UPDATE', [codigo]);
      if (!rows.length) throw new ErroUsuario(404, 'Material não encontrado.');
      const atual = numeroOuNulo(rows[0].VALOR_FIXO), anterior = numeroOuNulo(h.valor_anterior);
      if (!mesmoValor(atual, Number(h.valor_novo))) throw new ErroUsuario(409, `O valor mudou para ${reais(atual)} depois da gravação; nada foi desfeito.`);
      const quando = agoraLocal();
      await conn.execute('UPDATE cadastro_de_produtos SET VALOR_FIXO = ? WHERE CODIGO = ?', [anterior, codigo]);
      await conn.execute('UPDATE web_preco_historico SET desfeito_em = ?, desfeito_por = ? WHERE id = ?', [quando, quem(req), id]);
      await conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
        [quando, quem(req), 'preco_desfeito', String(codigo), JSON.stringify({ historico: id, de: atual, para: anterior })]);
      return { codigo, valorRestaurado: anterior };
    });
    if (feito) res.json(feito);
  });
}

module.exports = { registrarPrecosFormacao, lerParametrosPreco, carregarPrecos, precoDo, CHAVES, pctValido };
