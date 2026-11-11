// Dependências do perfil (decisão do dono, 2026-11-11): a web grava nas 5 tabelas do VB perfis_permitidos, acabamentos_permitidos,
// puxadores_permitidos, revestimentos_permitidos e divisores_permitidos SOMENTE por esta rota, com auditoria. Nada de modelos_permitidos_serralheria.
// GET /produtos/:codigo/permitidos (listas atuais + opções para marcar) e PUT (troca por grupo, tudo ou nada). Permissão `produtos.dependencias`.
// A chave das tabelas é o MODELO do cadastro (codigo -> MODELO), como em GET /produtos/item. Regras: docs/regras/produtos-dependencias.md
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');

const LIMITE_ITENS = 500;
const LIMITE_TEXTO = 100;
const PERMISSAO = ['produtos.dependencias'];

// por grupo: tabela do VB, coluna do valor, SQL das opções (valores que podem ser marcados)
const ativosDe = (tabela, col) => `SELECT DISTINCT p.${col} AS v FROM ${tabela} p INNER JOIN cadastro_de_produtos c ON c.MODELO = p.${col} WHERE c.SITUACAO = 'Ativo' ORDER BY p.${col}`;
const GRUPOS = {
  tiposProduto: { tabela: 'perfis_permitidos', col: 'TIPO_PRODUTO', opcoes: 'SELECT DISTINCT TIPO_PRODUTO AS v FROM perfis_permitidos ORDER BY TIPO_PRODUTO' },
  acabamentos: { tabela: 'acabamentos_permitidos', col: 'ACABAMENTO', opcoes: 'SELECT ACABAMENTO AS v FROM acabamentos ORDER BY ACABAMENTO' },
  // sem critério de classe confiável para puxador/revestimento/divisor: opções = valores já usados na tabela que ainda são produtos ativos
  puxadores: { tabela: 'puxadores_permitidos', col: 'PUXADOR_PERMITIDO', opcoes: ativosDe('puxadores_permitidos', 'PUXADOR_PERMITIDO') },
  revestimentos: { tabela: 'revestimentos_permitidos', col: 'REVESTIMENTO_PERMITIDO', opcoes: ativosDe('revestimentos_permitidos', 'REVESTIMENTO_PERMITIDO') },
  divisores: { tabela: 'divisores_permitidos', col: 'DIVISOR', opcoes: ativosDe('divisores_permitidos', 'DIVISOR') }
};
const NOMES = Object.keys(GRUPOS);

const limpar = v => [...new Set((v || []).map(x => String(x ?? '').trim()).filter(Boolean))];

async function listaDe(exec, sql, params = []) {
  const [r] = await exec.execute(sql, params);
  return limpar(r.map(x => x.v));
}
const atuais = async (exec, modelo) => {
  const out = {};
  for (const g of NOMES) out[g] = await listaDe(exec, `SELECT ${GRUPOS[g].col} AS v FROM ${GRUPOS[g].tabela} WHERE MODELO = ? ORDER BY ${GRUPOS[g].col}`, [modelo]);
  return out;
};
const opcoesDe = async exec => {
  const out = {};
  for (const g of NOMES) out[g] = await listaDe(exec, GRUPOS[g].opcoes);
  return out;
};
const mesmoConjunto = (a, b) => a.length === b.length && a.every(x => b.some(y => y.toLowerCase() === x.toLowerCase()));

function registrarProdutosDependencias({ rota, pool }) {
  const codigoDe = req => { const t = String(req.params.codigo); return /^\d{1,9}$/.test(t) && Number(t) > 0 ? Number(t) : null; };
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, String(alvo), JSON.stringify(detalhe)]);

  rota('get', '/produtos/:codigo/permitidos', PERMISSAO, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    try {
      const [[prod]] = await pool.execute('SELECT CODIGO, MODELO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
      const modelo = String(prod.MODELO || '').trim();
      const [permitidos, opcoes] = await Promise.all([atuais(pool, modelo), opcoesDe(pool)]);
      res.json({ codigo, modelo, permitidos, opcoes });
    } catch (err) {
      console.error('Erro GET /produtos/:codigo/permitidos:', err.code, err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('put', '/produtos/:codigo/permitidos', PERMISSAO, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).json({ error: 'Envie o corpo em JSON.' });
    const enviados = NOMES.filter(g => corpo[g] !== undefined);
    if (!enviados.length) return res.status(400).json({ error: 'Envie ao menos um grupo: ' + NOMES.join(', ') + '.' });
    const novos = {};
    for (const g of enviados) {
      const v = corpo[g];
      if (!Array.isArray(v)) return res.status(400).json({ error: `"${g}" deve ser uma lista de textos.` });
      if (v.length > LIMITE_ITENS) return res.status(400).json({ error: `"${g}" aceita no máximo ${LIMITE_ITENS} itens.` });
      if (v.some(x => typeof x !== 'string' || x.trim().length > LIMITE_TEXTO)) return res.status(400).json({ error: `"${g}" só aceita textos de até ${LIMITE_TEXTO} caracteres.` });
      novos[g] = limpar(v);
    }
    const cv = corpo.confirmarVazio;
    const confirmou = g => cv === true || (cv && typeof cv === 'object' && cv[g] === true);
    const semConfirmar = enviados.filter(g => !novos[g].length && !confirmou(g));
    if (semConfirmar.length) return res.status(400).json({ error: 'Esvaziar a lista exige confirmarVazio: true.', gruposVazios: semConfirmar });

    const r = await emTransacao(pool, res, 'PUT /produtos/:codigo/permitidos', async conn => {
      const [[prod]] = await conn.execute('SELECT CODIGO, MODELO FROM cadastro_de_produtos WHERE CODIGO = ? FOR UPDATE', [codigo]);
      if (!prod) throw new ErroUsuario(404, 'Produto não encontrado.');
      const modelo = String(prod.MODELO || '').trim();
      if (!modelo) throw new ErroUsuario(422, 'O produto não tem modelo cadastrado.');
      const antes = await atuais(conn, modelo);
      const opcoes = await opcoesDe(conn);
      // valor válido = existe nas opções (sem diferenciar maiúsculas, como o MySQL) ou já está marcado neste perfil; grava a grafia canônica
      const invalidos = {};
      const finais = {};
      for (const g of enviados) {
        const validos = [...opcoes[g], ...antes[g]];
        finais[g] = [];
        for (const v of novos[g]) {
          const achado = validos.find(x => x.toLowerCase() === v.toLowerCase());
          if (!achado) (invalidos[g] = invalidos[g] || []).push(v);
          else if (!finais[g].some(x => x.toLowerCase() === achado.toLowerCase())) finais[g].push(achado);
        }
      }
      if (Object.keys(invalidos).length) throw new ErroUsuario(400, 'Há valores que não existem nas opções disponíveis.', { invalidos });
      const mudou = {};
      for (const g of enviados) {
        if (mesmoConjunto(antes[g], finais[g])) continue;
        const { tabela, col } = GRUPOS[g];
        await conn.execute(`DELETE FROM ${tabela} WHERE MODELO = ?`, [modelo]);
        for (const v of finais[g]) await conn.execute(`INSERT INTO ${tabela} (MODELO, ${col}) VALUES (?, ?)`, [modelo, v]);
        mudou[g] = { antes: antes[g], depois: finais[g] };
      }
      if (Object.keys(mudou).length) await auditar(conn, req, 'produto_dependencias_gravadas', codigo, { codigo, modelo, grupos: mudou });
      const depois = { ...antes };
      for (const g of enviados) depois[g] = finais[g];
      return { ok: true, codigo, modelo, alterados: Object.keys(mudou), permitidos: depois };
    });
    if (r) res.json(r);
  });
}

module.exports = { registrarProdutosDependencias, GRUPOS };
