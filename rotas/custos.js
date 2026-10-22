// ==========================================================================
// Formação de preços — parte A: custos dos materiais (custos.html).
// Lê cadastro_de_produtos, estoque e entrada_estoque (tabelas do VB, só leitura);
// grava apenas em web_custo_material, web_custo_ligacoes, web_custo_parametros e web_auditoria.
// ==========================================================================
const { semValores } = require('../seguranca/valores');
const { calcularCusto } = require('../calculo/custos');
const { unidadeDaClasse, sugerirLigacoes, sugerirFator, fraseFator } = require('../calculo/custos_sugestao');
const { chaveMySQL } = require('../calculo/nomes');
const { hojeLocal, agoraLocal, emTransacao, ErroUsuario } = require('./estoque_movimentos');

const LER = ['precos.ver', 'valores.ver'];
const EDITAR = ['precos.ver', 'precos.editar', 'valores.ver'];
const PADRAO = { periodoMeses: 6, divergenciaPct: 15 };
const CAMPOS_VALOR = ['custoInformado', 'parcela', 'custo', 'precoMedio', 'referencia', 'valorFixo', 'valor', 'precoConvertido', 'custoUnitario', 'valorEstoque'];
const ativo = m => /^ativo$/i.test(String(m.SITUACAO || '').trim());
const inteiroEntre = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// data AAAA-MM-DD de "meses" atrás (a partir de hoje em Brasília)
function inicioDoPeriodo(meses) {
  const [a, m, d] = hojeLocal().split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m - 1 - meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 - meses, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}

async function lerParametros(db) {
  const [rows] = await db.execute('SELECT chave, valor FROM web_custo_parametros');
  const p = { ...PADRAO };
  for (const r of rows) {
    if (r.chave === 'periodo_meses') p.periodoMeses = inteiroEntre(r.valor, 1, 36) ?? PADRAO.periodoMeses;
    if (r.chave === 'divergencia_pct') p.divergenciaPct = inteiroEntre(r.valor, 1, 100) ?? PADRAO.divergenciaPct;
  }
  return p;
}

// tudo de uma vez: poucas consultas agrupadas, nunca uma por material
async function carregarBase(db) {
  const [materiais] = await db.execute('SELECT CODIGO, MODELO, CLASSE, VALOR_FIXO, SITUACAO FROM cadastro_de_produtos ORDER BY MODELO');
  const [itensLista] = await db.execute('SELECT CODIGO, NOME_PRODUTO, FORNECEDOR, UNIDADE, VALOR, IPI, FRETE, PERDA, TAMANHO, ALTURA, LARGURA, SITUACAO FROM estoque');
  const [ligacoes] = await db.execute('SELECT id, material_codigo, estoque_codigo, fator, confirmado_em, confirmado_por, componente_id, quantidade FROM web_custo_ligacoes ORDER BY id');
  const [comps] = await db.execute('SELECT id, material_codigo, nome, participacao_pct, quantidade, custo_informado, informado_em, informado_por, ordem FROM web_custo_componentes ORDER BY material_codigo, ordem, id');
  const [configs] = await db.execute('SELECT material_codigo, unidade_venda, sem_compra FROM web_custo_material');
  const itens = new Map(itensLista.map(i => [Number(i.CODIGO), i]));
  const ligPorMaterial = new Map();
  for (const l of ligacoes) {
    const k = Number(l.material_codigo);
    if (!ligPorMaterial.has(k)) ligPorMaterial.set(k, []);
    ligPorMaterial.get(k).push(l);
  }
  const configPorMaterial = new Map(configs.map(c => [Number(c.material_codigo), { unidadeVenda: c.unidade_venda || null, semCompra: !!Number(c.sem_compra) }]));
  // compras de todos os itens ligados (todas as datas: a última compra conhecida também conta)
  const nomes = [...new Set(ligacoes.map(l => itens.get(Number(l.estoque_codigo))?.NOME_PRODUTO).filter(Boolean))];
  let compras = [];
  if (nomes.length) [compras] = await db.execute(
    `SELECT NOTA_FISCAL, DATA, FABRICANTE, NOME_PRODUTO, QTD, VALOR_UNITARIO FROM entrada_estoque WHERE NOME_PRODUTO IN (${nomes.map(() => '?').join(',')}) ORDER BY DATA, id`, nomes);
  const comprasPorNome = new Map();
  for (const c of compras) {
    const k = chaveMySQL(c.NOME_PRODUTO);
    if (!comprasPorNome.has(k)) comprasPorNome.set(k, []);
    comprasPorNome.get(k).push(c);
  }
  const compPorMaterial = new Map();
  for (const c of comps) {
    const k = Number(c.material_codigo);
    if (!compPorMaterial.has(k)) compPorMaterial.set(k, []);
    compPorMaterial.get(k).push(c);
  }
  return { materiais, itensLista, itens, ligPorMaterial, configPorMaterial, comprasPorNome, compPorMaterial };
}

function custoDo(base, material, desde, divergenciaPct) {
  const ligacoes = base.ligPorMaterial.get(Number(material.CODIGO)) || [];
  const chaves = [...new Set(ligacoes.map(l => base.itens.get(Number(l.estoque_codigo))).filter(Boolean).map(i => chaveMySQL(i.NOME_PRODUTO)))];
  const compras = chaves.flatMap(k => base.comprasPorNome.get(k) || []);
  return calcularCusto({ material, config: base.configPorMaterial.get(Number(material.CODIGO)) || null, ligacoes, itens: base.itens, compras, desde, divergenciaPct,
    componentes: base.compPorMaterial.get(Number(material.CODIGO)) || [] });
}

const unidadeDo = (base, m) => base.configPorMaterial.get(Number(m.CODIGO))?.unidadeVenda || unidadeDaClasse(m.CLASSE);

const semComponente = l => l.componente_id === null || l.componente_id === undefined;
// componentes do material com as ligações de cada um (o grupo sem componente vira o principal, 100%); [] = material simples
function componentesParaTela(base, m, unidade, calculados = []) {
  const comps = base.compPorMaterial.get(Number(m.CODIGO)) || [];
  if (!comps.length) return [];
  const ligs = base.ligPorMaterial.get(Number(m.CODIGO)) || [];
  const grupos = [...(ligs.some(semComponente) ? [{ id: null, nome: null, quantidade: 1, ordem: -1 }] : []), ...comps];
  return grupos.map(g => {
    const calc = calculados.find(c => c.id === (g.id === null ? null : Number(g.id))) || {};
    const informado = g.custo_informado !== null && g.custo_informado !== undefined;
    return { custo: calc.custo ?? null, parcela: calc.parcela ?? null, situacao: calc.situacao ?? null, motivos: calc.motivos || [],
      itens: calc.itens || [], custoInformado: informado ? Number(g.custo_informado) : null, informadoEm: informado ? g.informado_em : null, informadoPor: informado ? g.informado_por : null,
      id: g.id === null ? null : Number(g.id), nome: g.nome ?? null, quantidade: g.quantidade !== null && g.quantidade !== undefined ? Number(g.quantidade) : Number(g.participacao_pct ?? 100) / 100, ordem: Number(g.ordem),
      ligacoes: ligs.filter(l => (g.id === null ? semComponente(l) : Number(l.componente_id) === Number(g.id))).map(l => ligacaoParaTela(base, l, unidade)) };
  });
}

function ligacaoParaTela(base, l, unidade) {
  const item = base.itens.get(Number(l.estoque_codigo));
  const fator = Number(l.fator);
  return { id: Number(l.id), estoqueCodigo: Number(l.estoque_codigo), existe: !!item, nome: item ? item.NOME_PRODUTO : null, fornecedor: item?.FORNECEDOR ?? null,
    unidadeCompra: item?.UNIDADE ?? null, fator, frase: item ? fraseFator(item.UNIDADE, fator, unidade) : null,
    valorEstoque: item ? Number(item.VALOR) || 0 : null, confirmadoEm: l.confirmado_em, confirmadoPor: l.confirmado_por,
    quantidade: l.quantidade === null || l.quantidade === undefined ? 1 : Number(l.quantidade) };
}

function registrarCustos({ rota, pool }) {
  const falha = (res, nome, err) => { console.error(`Erro ${nome}:`, err.message); res.status(500).json({ error: 'Erro de servidor' }); };

  rota('get', '/custos/materiais', LER, async (req, res) => {
    try {
      const parametros = await lerParametros(pool);
      if (req.query.meses !== undefined) parametros.periodoMeses = inteiroEntre(req.query.meses, 1, 36) ?? parametros.periodoMeses;
      const base = await carregarBase(pool);
      const desde = inicioDoPeriodo(parametros.periodoMeses);
      const materiais = base.materiais.map(m => {
        const c = custoDo(base, m, desde, parametros.divergenciaPct);
        return { codigo: Number(m.CODIGO), modelo: m.MODELO, classe: m.CLASSE || '', unidade: c.unidade, situacao: c.situacao, motivos: c.motivos,
          custo: c.custo, precoMedio: c.precoMedio, ultimaCompra: c.ultimaCompra, qtdCompras: c.qtdCompras, referencia: c.referencia,
          divergencia: c.divergencia, divergente: c.divergente, informado: c.informado, usaCadastro: c.usaCadastro, valorFixo: m.VALOR_FIXO === null ? null : Number(m.VALOR_FIXO), ativo: ativo(m),
          percentuais: (base.ligPorMaterial.get(Number(m.CODIGO)) || []).map(l => base.itens.get(Number(l.estoque_codigo)))
            .filter(Boolean).map(i => ({ ipi: i.IPI, frete: i.FRETE, perda: i.PERDA })) };
      });
      const ativos = materiais.filter(m => m.ativo);
      const conta = s => ativos.filter(m => m.situacao === s).length;
      const resumo = { total: ativos.length, confiavel: conta('confiavel'), desatualizado: conta('desatualizado'), faltando: conta('faltando'),
        semCompra: conta('sem_compra'), divergentes: ativos.filter(m => m.divergente).length };
      res.json({ parametros, desde, resumo, materiais: semValores(req, materiais, CAMPOS_VALOR) });
    } catch (err) { falha(res, 'GET /custos/materiais', err); }
  });

  rota('get', '/custos/materiais/:codigo', LER, async (req, res) => {
    try {
      const parametros = await lerParametros(pool);
      if (req.query.meses !== undefined) parametros.periodoMeses = inteiroEntre(req.query.meses, 1, 36) ?? parametros.periodoMeses;
      const base = await carregarBase(pool);
      const m = base.materiais.find(x => Number(x.CODIGO) === Number(req.params.codigo));
      if (!m) return res.status(404).json({ error: 'Material não encontrado.' });
      const c = custoDo(base, m, inicioDoPeriodo(parametros.periodoMeses), parametros.divergenciaPct);
      const ligacoes = (base.ligPorMaterial.get(Number(m.CODIGO)) || []).map(l => ligacaoParaTela(base, l, c.unidade));
      res.json(semValores(req, { codigo: Number(m.CODIGO), modelo: m.MODELO, classe: m.CLASSE || '', valorFixo: Number(m.VALOR_FIXO) || null, ativo: ativo(m),
        parametros, ligacoes, ...c, componentes: componentesParaTela(base, m, c.unidade, c.componentes) }, CAMPOS_VALOR));
    } catch (err) { falha(res, 'GET /custos/materiais/:codigo', err); }
  });

  rota('get', '/custos/ligacoes', LER, async (req, res) => {
    try {
      const base = await carregarBase(pool);
      const situacao = ['revisar', 'confirmadas', 'sem_compra'].includes(req.query.situacao) ? req.query.situacao : 'revisar';
      const lista = [];
      for (const m of base.materiais.filter(ativo)) {
        const cod = Number(m.CODIGO), unidade = unidadeDo(base, m);
        const semCompra = !!base.configPorMaterial.get(cod)?.semCompra, ligs = base.ligPorMaterial.get(cod) || [];
        const temComp = (base.compPorMaterial.get(cod) || []).length > 0;
        const comum = { codigo: cod, modelo: m.MODELO, classe: m.CLASSE || '', unidade };
        if (situacao === 'sem_compra' && semCompra) lista.push(comum);
        else if (situacao === 'confirmadas' && !semCompra && (ligs.length || temComp))
          lista.push({ ...comum, ligacoes: ligs.map(l => ligacaoParaTela(base, l, unidade)), componentes: componentesParaTela(base, m, unidade) });
        else if (situacao === 'revisar' && !semCompra && !ligs.length && !temComp) {
          lista.push({ ...comum, sugestoes: sugerirLigacoes(m, base.itensLista).map(s => {
            const fatorSugerido = sugerirFator(unidade, s.estoque);
            return { estoqueCodigo: Number(s.estoque.CODIGO), nome: s.estoque.NOME_PRODUTO, fornecedor: s.estoque.FORNECEDOR, unidadeCompra: s.estoque.UNIDADE,
              forca: s.forca, semelhanca: Math.round(s.semelhanca * 100) / 100, fatorSugerido,
              frase: fatorSugerido ? fraseFator(s.estoque.UNIDADE, fatorSugerido, unidade) : null };
          }) });
        }
      }
      res.json(lista);
    } catch (err) { falha(res, 'GET /custos/ligacoes', err); }
  });

  const auditar = (req, acao, alvo, detalhe) => pool.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || req.usuario?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);

  rota('post', '/custos/ligacoes', EDITAR, async (req, res) => {
    try {
      const b = req.body || {};
      const materialCodigo = Number(b.materialCodigo), estoqueCodigo = Number(b.estoqueCodigo), fator = Number(b.fator);
      if (!(fator > 0 && fator <= 10000)) return res.status(400).json({ error: 'Fator inválido: informe quantas unidades de venda há em 1 unidade de compra (maior que 0 e até 10.000).' });
      const [mat] = await pool.execute('SELECT CODIGO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [materialCodigo]);
      if (!mat.length) return res.status(400).json({ error: 'Material de venda não encontrado.' });
      const [item] = await pool.execute('SELECT CODIGO FROM estoque WHERE CODIGO = ? LIMIT 1', [estoqueCodigo]);
      if (!item.length) return res.status(400).json({ error: 'Item de estoque não encontrado.' });
      const componenteId = b.componenteId === undefined || b.componenteId === null ? null : Number(b.componenteId);
      const quantidade = b.quantidade === undefined ? 1 : b.quantidade;
      if (!(typeof quantidade === 'number' && Number.isFinite(quantidade) && quantidade > 0 && quantidade <= 10000))
        return res.status(400).json({ error: 'Quantidade do item: maior que 0 e até 10.000 (por 1 unidade de venda do produto).' });
      if (componenteId !== null) {
        const [comp] = Number.isInteger(componenteId) ? await pool.execute('SELECT id, material_codigo, custo_informado FROM web_custo_componentes WHERE id = ?', [componenteId]) : [[]];
        if (!comp.length || Number(comp[0].material_codigo) !== materialCodigo) return res.status(400).json({ error: 'Componente não encontrado neste material.' });
        if (comp[0].custo_informado !== null && comp[0].custo_informado !== undefined)
          return res.status(400).json({ error: 'Este componente tem custo informado: volte a usar itens do estoque antes de ligar um item.' });
      }
      let r;
      try {
        [r] = await pool.execute('INSERT INTO web_custo_ligacoes (material_codigo, estoque_codigo, fator, confirmado_em, confirmado_por, componente_id, quantidade) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [materialCodigo, estoqueCodigo, fator, agoraLocal(), req.acesso?.nome || '', componenteId, quantidade]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este item de compra já está ligado a este material.' });
        throw err;
      }
      await auditar(req, 'custo_ligacao_confirmada', materialCodigo, { estoqueCodigo, fator, componenteId });
      res.status(201).json({ id: r.insertId });
    } catch (err) { falha(res, 'POST /custos/ligacoes', err); }
  });

  // quantidade do item dentro do componente (por 1 unidade de venda do produto)
  rota('put', '/custos/ligacoes/:id', EDITAR, async (req, res) => {
    try {
      const id = Number(req.params.id), q = (req.body || {}).quantidade;
      if (!(typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= 10000))
        return res.status(400).json({ error: 'Quantidade do item: maior que 0 e até 10.000 (por 1 unidade de venda do produto).' });
      const [atual] = await pool.execute('SELECT id, material_codigo, estoque_codigo, fator, componente_id, quantidade FROM web_custo_ligacoes WHERE id = ?', [id]);
      const lig = atual.find(l => Number(l.id) === id);
      if (!lig) return res.status(404).json({ error: 'Ligação não encontrada.' });
      await pool.execute('UPDATE web_custo_ligacoes SET quantidade = ? WHERE id = ?', [q, id]);
      await auditar(req, 'custo_ligacao_alterada', lig.material_codigo, { id, estoqueCodigo: Number(lig.estoque_codigo),
        antes: lig.quantidade === null || lig.quantidade === undefined ? 1 : Number(lig.quantidade), depois: q });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /custos/ligacoes/:id', err); }
  });

  rota('delete', '/custos/ligacoes/:id', EDITAR, async (req, res) => {
    try {
      const [atual] = await pool.execute('SELECT id, material_codigo, estoque_codigo, fator, componente_id FROM web_custo_ligacoes WHERE id = ?', [Number(req.params.id)]);
      const lig = atual.find(l => Number(l.id) === Number(req.params.id));
      if (!lig) return res.status(404).json({ error: 'Ligação não encontrada.' });
      await pool.execute('DELETE FROM web_custo_ligacoes WHERE id = ?', [Number(lig.id)]);
      await auditar(req, 'custo_ligacao_desfeita', lig.material_codigo, { estoqueCodigo: Number(lig.estoque_codigo), fator: Number(lig.fator), componenteId: lig.componente_id ?? null });
      // componente que ficou sem item sai junto (não sobra componente vazio por engano)
      if (!semComponente(lig)) {
        const [[c] = []] = await pool.execute('SELECT COUNT(*) AS n FROM web_custo_ligacoes WHERE componente_id = ?', [Number(lig.componente_id)]);
        if (!Number(c?.n)) {
          await pool.execute('DELETE FROM web_custo_componentes WHERE id = ?', [Number(lig.componente_id)]);
          await auditar(req, 'custo_componente_excluido', lig.material_codigo, { id: Number(lig.componente_id), motivo: 'último item desfeito' });
        }
      }
      res.json({ ok: true });
    } catch (err) { falha(res, 'DELETE /custos/ligacoes/:id', err); }
  });

  // ---- composição: material = Σ quantidade × componente (quantidade na unidade de venda) ----
  const qtdComponente = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10000 ? v : null);
  const nomeComponente = v => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const auditarConn = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);
  const ERRO_QTD = 'Quantidade: maior que 0 e até 10.000 (na unidade de venda do produto).';
  // custo informado (sem estoque): R$ por unidade de venda; null = usar itens do estoque
  const valorInformado = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000000 ? v : null);
  const ERRO_INFORMADO = 'Custo informado: valor em R$ por unidade de venda, maior que 0 e até 1.000.000.';

  rota('post', '/custos/componentes', EDITAR, async (req, res) => {
    const b = req.body || {}, materialCodigo = Number(b.materialCodigo);
    const qtd = b.quantidade === undefined ? 1 : qtdComponente(b.quantidade), nome = nomeComponente(b.nome);
    if (qtd === null) return res.status(400).json({ error: ERRO_QTD });
    const informado = b.custoInformado === undefined || b.custoInformado === null ? null : valorInformado(b.custoInformado);
    if (b.custoInformado !== undefined && b.custoInformado !== null && informado === null) return res.status(400).json({ error: ERRO_INFORMADO });
    if (nome && nome.length > 60) return res.status(400).json({ error: 'Nome do componente: até 60 caracteres.' });
    const feito = await emTransacao(pool, res, 'POST /custos/componentes', async conn => {
      const [mat] = await conn.execute('SELECT CODIGO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [materialCodigo]);
      if (!mat.length) throw new ErroUsuario(404, 'Material de venda não encontrado.');
      const [comps] = await conn.execute('SELECT id, material_codigo, ordem FROM web_custo_componentes WHERE material_codigo = ?', [materialCodigo]);
      const doMaterial = comps.filter(c => Number(c.material_codigo) === materialCodigo);
      let ordem = doMaterial.reduce((mx, c) => Math.max(mx, Number(c.ordem)), -1) + 1;
      // primeira composição: o que já estava ligado vira o componente principal (100%) e continua valendo
      const [ligs] = await conn.execute('SELECT id, material_codigo, componente_id FROM web_custo_ligacoes WHERE material_codigo = ?', [materialCodigo]);
      if (ligs.some(l => Number(l.material_codigo) === materialCodigo && semComponente(l))) {
        const [p] = await conn.execute(`INSERT INTO web_custo_componentes (material_codigo, nome, quantidade, custo_informado, informado_em, informado_por, ordem, atualizado_em, atualizado_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [materialCodigo, null, 1, null, null, null, ordem++, agoraLocal(), req.acesso?.nome || '']);
        await conn.execute('UPDATE web_custo_ligacoes SET componente_id = ? WHERE material_codigo = ? AND componente_id IS NULL', [p.insertId, materialCodigo]);
        await auditarConn(conn, req, 'custo_componente_criado', materialCodigo, { id: p.insertId, nome: null, quantidade: 1, motivo: 'ligações existentes' });
      }
      const quem = req.acesso?.nome || '', agora = agoraLocal();
      const [r] = await conn.execute(`INSERT INTO web_custo_componentes (material_codigo, nome, quantidade, custo_informado, informado_em, informado_por, ordem, atualizado_em, atualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [materialCodigo, nome, qtd, informado, informado === null ? null : agora, informado === null ? null : quem, ordem, agora, quem]);
      await auditarConn(conn, req, 'custo_componente_criado', materialCodigo, { id: r.insertId, nome, quantidade: qtd, custoInformado: informado });
      return { id: r.insertId };
    });
    if (feito) res.status(201).json(feito);
  });

  rota('put', '/custos/componentes/:id', EDITAR, async (req, res) => {
    try {
      const b = req.body || {}, id = Number(req.params.id);
      if (b.quantidade !== undefined && qtdComponente(b.quantidade) === null) return res.status(400).json({ error: ERRO_QTD });
      const nome = nomeComponente(b.nome);
      if (nome && nome.length > 60) return res.status(400).json({ error: 'Nome do componente: até 60 caracteres.' });
      if (b.custoInformado !== undefined && b.custoInformado !== null && valorInformado(b.custoInformado) === null) return res.status(400).json({ error: ERRO_INFORMADO });
      const [rows] = await pool.execute('SELECT id, material_codigo, nome, participacao_pct, quantidade, custo_informado, informado_em, informado_por FROM web_custo_componentes WHERE id = ?', [id]);
      const c = rows.find(x => Number(x.id) === id);
      if (!c) return res.status(404).json({ error: 'Componente não encontrado.' });
      const qtdAtual = c.quantidade !== null && c.quantidade !== undefined ? Number(c.quantidade) : Number(c.participacao_pct ?? 100) / 100;
      if (b.custoInformado !== undefined && b.custoInformado !== null) {
        // um componente vale OU pelos itens do estoque OU pelo custo informado, nunca pelos dois
        const [[l] = []] = await pool.execute('SELECT COUNT(*) AS n FROM web_custo_ligacoes WHERE componente_id = ?', [id]);
        if (Number(l?.n)) return res.status(409).json({ error: 'Este componente tem itens do estoque ligados: desfaça os itens antes de informar o custo.' });
      }
      const quem = req.acesso?.nome || '', agora = agoraLocal();
      const informadoAtual = c.custo_informado === null || c.custo_informado === undefined ? null : Number(c.custo_informado);
      const novo = { nome: b.nome !== undefined ? nome : c.nome, quantidade: b.quantidade !== undefined ? b.quantidade : qtdAtual,
        custoInformado: b.custoInformado !== undefined ? b.custoInformado : informadoAtual };
      const mudouInformado = b.custoInformado !== undefined && b.custoInformado !== informadoAtual;
      const informadoEm = novo.custoInformado === null ? null : (mudouInformado ? agora : c.informado_em);
      const informadoPor = novo.custoInformado === null ? null : (mudouInformado ? quem : c.informado_por);
      await pool.execute(`UPDATE web_custo_componentes SET nome = ?, quantidade = ?, custo_informado = ?, informado_em = ?, informado_por = ?, atualizado_em = ?, atualizado_por = ?
        WHERE id = ?`, [novo.nome, novo.quantidade, novo.custoInformado, informadoEm, informadoPor, agora, quem, id]);
      await auditar(req, 'custo_componente_alterado', c.material_codigo, { id, antes: { nome: c.nome, quantidade: qtdAtual, custoInformado: informadoAtual }, depois: novo });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /custos/componentes/:id', err); }
  });

  rota('delete', '/custos/componentes/:id', EDITAR, async (req, res) => {
    const id = Number(req.params.id);
    const feito = await emTransacao(pool, res, 'DELETE /custos/componentes/:id', async conn => {
      const [rows] = await conn.execute('SELECT id, material_codigo, nome, quantidade FROM web_custo_componentes WHERE id = ?', [id]);
      const c = rows.find(x => Number(x.id) === id);
      if (!c) throw new ErroUsuario(404, 'Componente não encontrado.');
      await conn.execute('DELETE FROM web_custo_ligacoes WHERE componente_id = ?', [id]);
      await conn.execute('DELETE FROM web_custo_componentes WHERE id = ?', [id]);
      await auditarConn(conn, req, 'custo_componente_excluido', c.material_codigo, { id, nome: c.nome, quantidade: c.quantidade === null ? null : Number(c.quantidade) });
      return { ok: true };
    });
    if (feito) res.json(feito);
  });

  rota('put', '/custos/material/:codigo', EDITAR, async (req, res) => {
    try {
      const b = req.body || {}, codigo = Number(req.params.codigo);
      if (b.unidadeVenda !== undefined && b.unidadeVenda !== null && !['m', 'm2', 'un'].includes(b.unidadeVenda))
        return res.status(400).json({ error: 'Unidade de venda inválida (m, m² ou unidade).' });
      const [mat] = await pool.execute('SELECT CODIGO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!mat.length) return res.status(404).json({ error: 'Material de venda não encontrado.' });
      if (b.unidadeVenda !== undefined) {
        // o fator foi confirmado para a unidade atual: trocar a unidade com ligações daria um custo inventado
        const [ligs] = await pool.execute('SELECT id FROM web_custo_ligacoes WHERE material_codigo = ? LIMIT 1', [codigo]);
        if (ligs.length) return res.status(409).json({ error: 'Este material tem ligações confirmadas para a unidade atual: desfaça as ligações antes de trocar a unidade de venda.' });
      }
      const [atual] = await pool.execute('SELECT material_codigo, unidade_venda, sem_compra FROM web_custo_material WHERE material_codigo = ?', [codigo]);
      const c = atual.find(x => Number(x.material_codigo) === codigo) || { unidade_venda: null, sem_compra: 0 };
      const unidade = b.unidadeVenda !== undefined ? b.unidadeVenda : c.unidade_venda;
      const semCompra = b.semCompra !== undefined ? (b.semCompra ? 1 : 0) : Number(c.sem_compra) || 0;
      await pool.execute(`INSERT INTO web_custo_material (material_codigo, unidade_venda, sem_compra, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE unidade_venda = VALUES(unidade_venda), sem_compra = VALUES(sem_compra), atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
        [codigo, unidade, semCompra, agoraLocal(), req.acesso?.nome || '']);
      await auditar(req, 'custo_material_alterado', codigo, { unidadeVenda: unidade, semCompra: !!semCompra });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /custos/material/:codigo', err); }
  });

  rota('put', '/custos/parametros', EDITAR, async (req, res) => {
    try {
      const b = req.body || {};
      const meses = inteiroEntre(b.periodoMeses, 1, 36), pct = inteiroEntre(b.divergenciaPct, 1, 100);
      if (meses === null) return res.status(400).json({ error: 'Período da média: de 1 a 36 meses.' });
      if (pct === null) return res.status(400).json({ error: 'Alerta de divergência: de 1% a 100%.' });
      for (const [chave, valor] of [['periodo_meses', meses], ['divergencia_pct', pct]])
        await pool.execute('INSERT INTO web_custo_parametros (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [chave, String(valor)]);
      await auditar(req, 'custo_parametros_alterados', '', { periodoMeses: meses, divergenciaPct: pct });
      res.json({ ok: true });
    } catch (err) { falha(res, 'PUT /custos/parametros', err); }
  });

  rota('get', '/custos/estoque', LER, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 100);
      const [rows] = await pool.execute('SELECT CODIGO, NOME_PRODUTO, FORNECEDOR, UNIDADE, TAMANHO, ALTURA, LARGURA FROM estoque WHERE NOME_PRODUTO LIKE ? ORDER BY NOME_PRODUTO LIMIT 30', [`%${q}%`]);
      res.json(rows.map(i => ({ codigo: Number(i.CODIGO), nome: i.NOME_PRODUTO, fornecedor: i.FORNECEDOR, unidade: i.UNIDADE,
        tamanho: Number(i.TAMANHO) || 0, altura: Number(i.ALTURA) || 0, largura: Number(i.LARGURA) || 0 })));
    } catch (err) { falha(res, 'GET /custos/estoque', err); }
  });
}

module.exports = { registrarCustos, inicioDoPeriodo, EDITAR, agoraLocal, carregarBase, lerParametros, custoDo, ativo };
