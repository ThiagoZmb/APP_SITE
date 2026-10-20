// ==========================================================================
// Movimentação de estoque: entrada (manual e XML da NF-e), saída, ajuste,
// histórico e estornos. Grava nas tabelas do VB do jeito que ele espera
// (nf_entrada, entrada_estoque, saida_estoque, estoque.QTD_ESTOQUE) e guarda
// o que é só da web nas tabelas web_estoque_*. Toda gravação é uma transação.
// ==========================================================================
const express = require('express');
const { lerNFe, ErroNFe } = require('./nfe_xml');

const VER = 'estoque.ver';
const MOVIMENTAR = [VER, 'estoque.movimentar'];
const MSG_MOTIVO = 'Informe o motivo (3 a 500 caracteres).';
const motivoValido = m => { const t = String(m ?? '').trim(); return t.length >= 3 && t.length <= 500 ? t : null; };
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const centavos = n => Math.round(n * 100) / 100;

// 'AAAA-MM-DD' de calendário válido → a própria data; senão null
function validarData(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}
const inteiroPositivo = v => Number.isInteger(v) && v >= 1;
class ErroUsuario extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const ehDuplicado = err => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
// deadlock ou espera de trava esgotada: o MySQL desfez a transação inteira, dá para tentar de novo
const ehConcorrencia = err => err?.errno === 1213 || err?.errno === 1205;
const TENTATIVAS = 3;

// Roda `trabalho(conn)` numa transação; ErroUsuario vira a resposta com a mensagem, outros erros viram 500.
// Em deadlock (por exemplo, o VB gravando ao mesmo tempo) a transação é refeita do zero, até 3 vezes.
async function emTransacao(pool, res, rotaNome, trabalho) {
  for (let tentativa = 1; ; tentativa++) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const resultado = await trabalho(conn);
      await conn.commit();
      return resultado;
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      if (ehConcorrencia(err) && tentativa < TENTATIVAS) continue;
      if (err instanceof ErroUsuario) res.status(err.status).json({ error: err.message });
      else { console.error(`Erro ${rotaNome}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); }
      return undefined;
    } finally {
      if (conn) conn.release();
    }
  }
}

// hora de Brasília (o servidor no Render roda em UTC; o VB grava a hora local)
const horaLocal = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
const agoraLocal = () => `${hojeLocal()} ${horaLocal()}`; // gravado nas tabelas web_ no lugar de NOW() (o MySQL pode estar em outro fuso)
const hojeLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // AAAA-MM-DD
const LIMITE_LINHA_SAIDA = 127; // saida_estoque.QTD é tinyint

// Reserva a chave do lançamento (identificador gerado pela tela) gravando-a já no início da transação.
// INSERT direto em vez de SELECT … FOR UPDATE: a chave repetida vira 409 e não há trava de intervalo
// (que faria dois lançamentos simultâneos travarem um ao outro).
async function reservarChave(conn, { chave, tipo, quem, referencia }) {
  try {
    await conn.execute(`INSERT INTO web_estoque_lancamentos (chave, tipo, quando, quem, referencia) VALUES (?, '${tipo}', ?, ?, ?)`,
      [chave, agoraLocal(), quem, referencia]);
  } catch (err) {
    if (ehDuplicado(err)) throw new ErroUsuario(409, 'Este lançamento já foi gravado.');
    throw err;
  }
}

// trava e devolve os produtos pedidos, indexados pelo código
async function travarProdutos(conn, codigos) {
  const unicos = [...new Set(codigos.map(Number))];
  const [linhas] = await conn.execute(
    `SELECT CODIGO, NOME_PRODUTO, QTD_ESTOQUE, VALOR, CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR
     FROM estoque WHERE CODIGO IN (${unicos.map(() => '?').join(', ')}) FOR UPDATE`, unicos);
  return new Map(linhas.map(l => [Number(l.CODIGO), l]));
}

// trava e devolve os produtos pelo nome (entrada_estoque e saida_estoque guardam o nome, não o código)
async function travarPorNome(conn, nomes) {
  const unicos = [...new Set(nomes)];
  const [linhas] = await conn.execute(
    `SELECT CODIGO, NOME_PRODUTO, QTD_ESTOQUE FROM estoque WHERE NOME_PRODUTO IN (${unicos.map(() => '?').join(', ')}) FOR UPDATE`, unicos);
  return new Map(linhas.map(l => [l.NOME_PRODUTO, l]));
}
// soma as quantidades por produto, na ordem em que aparecem
function somarPorProduto(linhas) {
  const soma = new Map();
  for (const l of linhas) soma.set(l.NOME_PRODUTO, (soma.get(l.NOME_PRODUTO) || 0) + (Number(l.QTD) || 0));
  return soma;
}
const NAO_ENCONTRADO = 'Movimento não encontrado (talvez já desfeito).';

function registrarEstoqueMovimentos({ rota, pool }) {
  const falha = (res, rotaNome, err) => {
    console.error(`Erro ${rotaNome}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // produtos para escolher (regra do VB: ativos, ou inativos que ainda têm estoque)
  rota('get', '/estoque/mov/produtos', [VER, { algum: ['estoque.movimentar', 'estoque.ajustar'] }], async (req, res) => {
    const busca = String(req.query.busca || '').trim().slice(0, 100);
    try {
      const [linhas] = await pool.execute(
        `SELECT CODIGO, NOME_PRODUTO, UNIDADE, QTD_ESTOQUE, SITUACAO, COD_FORNECEDOR, FORNECEDOR, VALOR
         FROM estoque WHERE (SITUACAO = 'Ativo' OR (SITUACAO = 'Inativo' AND QTD_ESTOQUE <> 0))
           AND (NOME_PRODUTO LIKE ? OR CODIGO = ?)
         ORDER BY NOME_PRODUTO LIMIT 50`, [`%${busca}%`, parseInt(busca, 10) || 0]);
      const verValores = req.acesso.permissoes.has('valores.ver');
      res.json(linhas.map(l => ({
        codigo: l.CODIGO, produto: l.NOME_PRODUTO, unidade: l.UNIDADE || '', qtd: Number(l.QTD_ESTOQUE) || 0, situacao: l.SITUACAO || '',
        codFornecedor: l.COD_FORNECEDOR || '', fornecedor: l.FORNECEDOR || '',
        ...(verValores ? { valor: Number(l.VALOR) || 0 } : {})
      })));
    } catch (err) { falha(res, 'GET /estoque/mov/produtos', err); }
  });

  rota('get', '/estoque/mov/fornecedores', MOVIMENTAR, async (req, res) => {
    try {
      const [linhas] = await pool.execute('SELECT RAZAO_FABRICANTE, CNPJ FROM cadastro_fornecedores ORDER BY RAZAO_FABRICANTE');
      res.json(linhas.map(l => ({ razao: l.RAZAO_FABRICANTE, cnpj: l.CNPJ || '' })));
    } catch (err) { falha(res, 'GET /estoque/mov/fornecedores', err); }
  });

  // ----- importação do XML da NF-e: devolve a nota pré-preenchida, nada é gravado -----
  // O XML vem como corpo application/xml (o JSON global do index.js é limitado a 100 kb).
  const corpoXml = express.text({ type: ['application/xml', 'text/xml'], limit: '1mb' });
  // qualquer erro ao ler o corpo responde JSON (nunca a página de erro do Express, que mostra detalhes do servidor)
  const erroCorpo = (err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo grande demais (máximo 1 MB).' });
    const status = err.status || err.statusCode;
    if (status >= 400 && status < 500) return res.status(status).json({ error: status === 415 ? 'Formato de arquivo não suportado.' : 'Arquivo inválido.' });
    next(err);
  };
  rota('post', '/estoque/entrada/xml', MOVIMENTAR, corpoXml, async (req, res) => {
    let nota;
    try { nota = lerNFe(typeof req.body === 'string' ? req.body : ''); }
    catch (err) {
      if (err instanceof ErroNFe) return res.status(400).json({ error: err.message });
      return falha(res, 'POST /estoque/entrada/xml', err);
    }
    try {
      const [forns] = await pool.execute('SELECT RAZAO_FABRICANTE, CNPJ FROM cadastro_fornecedores ORDER BY RAZAO_FABRICANTE');
      const achado = nota.emitente.cnpj && forns.find(f => String(f.CNPJ || '').replace(/\D/g, '') === nota.emitente.cnpj);
      const fornecedor = achado ? achado.RAZAO_FABRICANTE : null;
      const [jaLancada] = await pool.execute('SELECT NUMERO FROM nf_entrada WHERE NUMERO = ? LIMIT 1', [nota.numero]);
      // produto do item: 1º a ligação gravada pela web, 2º o código do fabricante no cadastro do VB
      const ligacoes = new Map(), doCadastro = new Map();
      if (fornecedor) {
        const [lig] = await pool.execute(
          `SELECT l.cod_fabricante, l.fator, e.CODIGO, e.NOME_PRODUTO, e.UNIDADE
           FROM web_estoque_ligacoes l JOIN estoque e ON e.CODIGO = l.produto_codigo WHERE l.fornecedor = ?`, [fornecedor]);
        for (const l of lig) ligacoes.set(l.cod_fabricante, l);
        const [cad] = await pool.execute(
          "SELECT CODIGO, NOME_PRODUTO, UNIDADE, COD_FORNECEDOR FROM estoque WHERE FORNECEDOR = ? AND COD_FORNECEDOR <> ''", [fornecedor]);
        for (const c of cad) if (!doCadastro.has(c.COD_FORNECEDOR)) doCadastro.set(c.COD_FORNECEDOR, c);
      }
      const produto = l => ({ codigo: l.CODIGO, nome: l.NOME_PRODUTO, unidade: l.UNIDADE || '' });
      const verValores = req.acesso.permissoes.has('valores.ver');
      const itens = nota.itens.map(it => {
        const lig = ligacoes.get(it.codFabricante), cad = doCadastro.get(it.codFabricante);
        const base = lig ? { produto: produto(lig), fator: Number(lig.fator) || 1, origem: 'ligacao' }
          : cad ? { produto: produto(cad), fator: 1, origem: 'cadastro' } : { produto: null, fator: 1, origem: null };
        const { unitarioNota, totalNota, ...semValor } = it;
        return { ...(verValores ? it : semValor), ...base };
      });
      res.json({ numero: nota.numero, data: nota.data, emitente: nota.emitente, fornecedor, notaJaLancada: jaLancada.length > 0, itens,
        ...(verValores ? { totalNota: nota.totalNota } : {}) });
    } catch (err) { falha(res, 'POST /estoque/entrada/xml', err); }
  }, erroCorpo);

  // ----- entrada por nota fiscal (frm_Entrada_Estoque + frm_Confirmação_Entrada) -----
  rota('post', '/estoque/entrada', MOVIMENTAR, async (req, res) => {
    const b = req.body || {};
    const numero = txt(b.numero, 190);
    const data = validarData(b.data);
    const fornecedor = txt(b.fornecedor, 190);
    const itens = Array.isArray(b.itens) ? b.itens : [];
    const verValores = req.acesso.permissoes.has('valores.ver');
    const erro = (status, msg) => res.status(status).json({ error: msg });
    if (!numero) return erro(400, 'Favor inserir o número da nota fiscal!');
    if (!data) return erro(400, 'Data inválida!');
    try {
      if (!fornecedor || !(await pool.execute('SELECT RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = ? LIMIT 1', [fornecedor]))[0].length)
        return erro(400, 'Favor escolher um fornecedor!');
    } catch (err) { return falha(res, 'POST /estoque/entrada', err); }
    if (!itens.length) return erro(400, 'Favor inserir pelo menos um produto!');
    for (const [i, it] of itens.entries()) {
      if (!inteiroPositivo(it?.qtd)) return erro(400, `Item ${i + 1}: quantidade precisa ser um número inteiro maior que zero.`);
      if (verValores && [it.unitario, it.total].some(v => v !== undefined && !(Number(v) >= 0))) return erro(400, `Item ${i + 1}: valor inválido.`);
    }

    const resultado = await emTransacao(pool, res, 'POST /estoque/entrada', async conn => {
      const produtos = await travarProdutos(conn, itens.map(it => it.produtoCodigo));
      itens.forEach((it, i) => { if (!produtos.has(Number(it.produtoCodigo))) throw new ErroUsuario(400, `Item ${i + 1}: produto não encontrado no estoque.`); });
      // valores: com valores.ver, os da nota; sem, os do cadastro (o estoquista nunca informa preço)
      const linhas = itens.map((it, i) => {
        const p = produtos.get(Number(it.produtoCodigo));
        const unitario = verValores && it.unitario !== undefined ? Number(it.unitario) : Number(p.VALOR) || 0;
        const total = verValores && it.total !== undefined ? Number(it.total) : centavos(unitario * it.qtd);
        return { it, p, item: parseInt(it.item, 10) || i + 1, unitario, total };
      });
      const totalNota = centavos(linhas.reduce((s, l) => s + l.total, 0));
      // nota repetida: o INSERT recusa (a chave da nf_entrada é só NUMERO) e a mensagem diz de qual fornecedor ela é
      try {
        await conn.execute('INSERT INTO nf_entrada (NUMERO, RAZAO_FABRICANTE, DATA, VALOR_TOTAL) VALUES (?, ?, ?, ?)', [numero, fornecedor, data, totalNota]);
      } catch (err) {
        if (!ehDuplicado(err)) throw err;
        const [[dona]] = await conn.execute('SELECT RAZAO_FABRICANTE FROM nf_entrada WHERE NUMERO = ? LIMIT 1', [numero]);
        if (!dona || dona.RAZAO_FABRICANTE === fornecedor) throw new ErroUsuario(409, 'Esta nota fiscal já foi inserida !');
        throw new ErroUsuario(409, `Já existe a nota ${numero} lançada para o fornecedor ${dona.RAZAO_FABRICANTE}.`);
      }
      for (const l of linhas) {
        await conn.execute(
          `INSERT INTO entrada_estoque (NOTA_FISCAL, DATA, FABRICANTE, ITEM, NOME_PRODUTO, NOME_PRODUTO_FABRICANTE, QTD, VALOR_UNITARIO, VALOR_TOTAL, OBSERVACAO)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [numero, data, fornecedor, l.item, l.p.NOME_PRODUTO, txt(l.it.nomeFabricante, 190) || l.p.NOME_PRODUTO_FORNECEDOR || '', l.it.qtd, l.unitario, l.total, txt(l.it.observacao, 2000)]);
      }
      // quantidades: uma atualização por produto, com a soma das linhas
      const soma = new Map();
      for (const l of linhas) soma.set(l.p.CODIGO, (soma.get(l.p.CODIGO) || 0) + l.it.qtd);
      const resumo = [];
      for (const [codigo, qtd] of soma) {
        await conn.execute("UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE + ?, AGUARDANDO = '' WHERE CODIGO = ?", [qtd, codigo]);
        const p = produtos.get(codigo);
        resumo.push({ produto: p.NOME_PRODUTO, antes: Number(p.QTD_ESTOQUE) || 0, depois: (Number(p.QTD_ESTOQUE) || 0) + qtd });
      }
      // ligação "item do fabricante → produto do estoque" para a próxima nota
      for (const { it, p } of linhas) {
        const cod = txt(it.codFabricante, 60);
        if (!cod) continue;
        const fator = Number(it.fator) > 0 ? Number(it.fator) : 1;
        await conn.execute(
          `INSERT INTO web_estoque_ligacoes (fornecedor, cod_fabricante, nome_fabricante, produto_codigo, fator, atualizado_em, atualizado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE nome_fabricante = VALUES(nome_fabricante), produto_codigo = VALUES(produto_codigo), fator = VALUES(fator),
             atualizado_em = VALUES(atualizado_em), atualizado_por = VALUES(atualizado_por)`,
          [fornecedor, cod, txt(it.nomeFabricante, 190), p.CODIGO, fator, agoraLocal(), req.user.nome]);
      }
      return resumo;
    });
    if (resultado) res.status(201).json({ itens: resultado });
  });

  // ----- saída (frm_Saida_Estoque) -----
  rota('post', '/estoque/saida', MOVIMENTAR, async (req, res) => {
    const b = req.body || {};
    const chave = txt(b.chave, 65);
    const data = validarData(b.data);
    const itens = Array.isArray(b.itens) ? b.itens : [];
    const erro = msg => res.status(400).json({ error: msg });
    if (!chave || chave.length > 64) return erro('Lançamento sem identificação. Atualize a página e tente de novo.');
    if (!data) return erro('Data inválida!');
    if (!itens.length) return erro('Favor inserir pelo menos um produto!');
    for (const [i, it] of itens.entries()) {
      if (!inteiroPositivo(it?.qtd)) return erro(`Item ${i + 1}: quantidade precisa ser um número inteiro maior que zero.`);
    }

    const resultado = await emTransacao(pool, res, 'POST /estoque/saida', async conn => {
      const quando = `${data} ${horaLocal()}`; // a mesma em todas as linhas: é assim que o lançamento se reagrupa
      await reservarChave(conn, { chave, tipo: 'saida', quem: req.user.nome, referencia: quando });
      const produtos = await travarProdutos(conn, itens.map(it => it.produtoCodigo));
      const vistos = new Set();
      itens.forEach((it, i) => {
        const p = produtos.get(Number(it.produtoCodigo));
        if (!p) throw new ErroUsuario(400, `Item ${i + 1}: produto não encontrado no estoque.`);
        if (vistos.has(p.CODIGO)) throw new ErroUsuario(400, `O produto '${p.NOME_PRODUTO}' já foi inserido !`);
        vistos.add(p.CODIGO);
        const atual = Number(p.QTD_ESTOQUE) || 0;
        if (atual - it.qtd < 0) throw new ErroUsuario(400, `A quantidade do item '${p.NOME_PRODUTO}' é menor que 0! (estoque: ${atual}, saída: ${it.qtd})`);
      });
      const resumo = [];
      for (const it of itens) {
        const p = produtos.get(Number(it.produtoCodigo));
        for (let resta = it.qtd; resta > 0; resta -= LIMITE_LINHA_SAIDA) {
          await conn.execute(
            `INSERT INTO saida_estoque (CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO, STATUS)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            [p.CODIGO_BARRA || '', p.FORNECEDOR || '', p.NOME_PRODUTO_FORNECEDOR || '', p.NOME_PRODUTO, quando, Math.min(resta, LIMITE_LINHA_SAIDA), req.user.nome]);
        }
        await conn.execute('UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE - ? WHERE CODIGO = ?', [it.qtd, p.CODIGO]);
        const antes = Number(p.QTD_ESTOQUE) || 0;
        resumo.push({ produto: p.NOME_PRODUTO, antes, depois: antes - it.qtd });
      }
      return resumo;
    });
    if (resultado) res.status(201).json({ itens: resultado });
  });

  // ----- histórico: entradas por nota, saídas por lançamento, ajustes e estornos -----
  const TIPOS = ['entrada', 'saida', 'ajuste', 'estorno'];
  const LIMITE_GRUPOS = 200;
  rota('get', '/estoque/historico', [VER, { algum: ['estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar'] }], async (req, res) => {
    const q = req.query;
    const ate = q.ate === undefined || q.ate === '' ? hojeLocal() : validarData(q.ate);
    const de = q.de === undefined || q.de === '' ? (ate && new Date(Date.parse(ate) - 30 * 864e5).toISOString().slice(0, 10)) : validarData(q.de);
    if (!de || !ate || de > ate) return res.status(400).json({ error: 'Data inválida!' });
    if ((Date.parse(ate) - Date.parse(de)) / 864e5 > 366) return res.status(400).json({ error: 'Período máximo: 366 dias.' });
    const tipo = TIPOS.includes(q.tipo) ? q.tipo : '';
    const produto = String(q.produto || '').trim().toLowerCase();
    const nota = String(q.nota || '').trim();
    const usuario = String(q.usuario || '').trim().toLowerCase();
    const verValores = req.acesso.permissoes.has('valores.ver');
    const podeDesfazer = req.acesso.permissoes.has('estoque.desfazer');
    const ini = `${de} 00:00:00`, fim = `${ate} 23:59:59`;
    const quer = t => (!tipo || tipo === t) && (!nota || t === 'entrada') && (!usuario || t !== 'entrada');
    try {
      const grupos = [];
      if (quer('entrada')) {
        const [linhas] = await pool.execute(
          `SELECT NOTA_FISCAL, FABRICANTE, DATA, ITEM, NOME_PRODUTO, QTD, VALOR_UNITARIO, VALOR_TOTAL
           FROM entrada_estoque WHERE DATA BETWEEN ? AND ? ORDER BY DATA DESC, NOTA_FISCAL, ITEM`, [ini, fim]);
        const porNota = new Map();
        for (const l of linhas) {
          if (nota && String(l.NOTA_FISCAL) !== nota) continue;
          const k = `${l.NOTA_FISCAL}\u0000${l.FABRICANTE}`;
          if (!porNota.has(k)) porNota.set(k, { tipo: 'entrada', quando: `${String(l.DATA).slice(0, 10)} 00:00:00`, quem: '',
            referencia: `NF ${l.NOTA_FISCAL} · ${l.FABRICANTE}`, nota: String(l.NOTA_FISCAL), fornecedor: l.FABRICANTE, itens: [], podeDesfazer });
          porNota.get(k).itens.push({ produto: l.NOME_PRODUTO, qtd: Number(l.QTD) || 0,
            ...(verValores ? { unitario: Number(l.VALOR_UNITARIO) || 0, total: Number(l.VALOR_TOTAL) || 0 } : {}) });
        }
        grupos.push(...porNota.values());
      }
      if (quer('saida')) {
        const [linhas] = await pool.execute(
          'SELECT DATA, USUARIO, NOME_PRODUTO, QTD FROM saida_estoque WHERE DATA BETWEEN ? AND ? ORDER BY DATA DESC, ID', [ini, fim]);
        const porLancamento = new Map();
        for (const l of linhas) {
          const k = `${l.DATA}\u0000${l.USUARIO ?? ''}`;
          if (!porLancamento.has(k)) porLancamento.set(k, { tipo: 'saida', quando: String(l.DATA), quem: l.USUARIO || '', referencia: 'Saída de estoque',
            data: String(l.DATA), usuario: l.USUARIO || '', itens: [], podeDesfazer });
          const g = porLancamento.get(k);
          // as linhas de 127 do mesmo produto voltam a ser um item só
          const it = g.itens.find(i => i.produto === l.NOME_PRODUTO);
          if (it) it.qtd += Number(l.QTD) || 0; else g.itens.push({ produto: l.NOME_PRODUTO, qtd: Number(l.QTD) || 0 });
        }
        grupos.push(...porLancamento.values());
      }
      if (quer('ajuste')) {
        const [linhas] = await pool.execute(
          'SELECT id, quando, quem, nome_produto, qtd_antes, qtd_depois, motivo FROM web_estoque_ajustes WHERE quando BETWEEN ? AND ? ORDER BY quando DESC', [ini, fim]);
        for (const l of linhas) grupos.push({ tipo: 'ajuste', quando: String(l.quando), quem: l.quem, referencia: l.nome_produto, motivo: l.motivo,
          itens: [{ produto: l.nome_produto, qtd: Math.abs(Number(l.qtd_depois) - Number(l.qtd_antes)), antes: Number(l.qtd_antes), depois: Number(l.qtd_depois) }],
          podeDesfazer: false });
      }
      if (quer('estorno')) {
        const [linhas] = await pool.execute(
          'SELECT id, quando, quem, tipo, referencia, motivo, dados FROM web_estoque_estornos WHERE quando BETWEEN ? AND ? ORDER BY quando DESC', [ini, fim]);
        for (const l of linhas) {
          let resumo = [];
          try { resumo = JSON.parse(l.dados || '{}').resumo || []; } catch { /* registro antigo sem resumo */ }
          grupos.push({ tipo: 'estorno', quando: String(l.quando), quem: l.quem, referencia: `${l.tipo === 'entrada' ? 'Entrada' : 'Saída'} desfeita · ${l.referencia}`,
            motivo: l.motivo, itens: resumo.map(r => ({ produto: r.produto, qtd: Math.abs(Number(r.depois) - Number(r.antes)), antes: Number(r.antes), depois: Number(r.depois) })),
            podeDesfazer: false });
        }
      }
      const filtrados = grupos
        .filter(g => !produto || g.itens.some(i => String(i.produto).toLowerCase().includes(produto)))
        .filter(g => !usuario || String(g.quem).toLowerCase().includes(usuario))
        .sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
      res.json(filtrados.slice(0, LIMITE_GRUPOS));
    } catch (err) { falha(res, 'GET /estoque/historico', err); }
  });

  // ----- desfazer: apaga das tabelas do VB, devolve as quantidades e guarda a cópia em web_estoque_estornos -----
  const DESFAZER = [VER, 'estoque.desfazer'];
  const gravarEstorno = (conn, req, tipo, referencia, motivo, dados) => conn.execute(
    `INSERT INTO web_estoque_estornos (quando, quem, tipo, referencia, motivo, dados) VALUES (?, ?, '${tipo}', ?, ?, ?)`,
    [agoraLocal(), req.user.nome, referencia.slice(0, 255), motivo, JSON.stringify(dados)]);

  rota('post', '/estoque/entrada/desfazer', DESFAZER, async (req, res) => {
    const b = req.body || {};
    const numero = txt(b.numero, 190), fornecedor = txt(b.fornecedor, 190), motivo = motivoValido(b.motivo);
    if (!motivo) return res.status(400).json({ error: MSG_MOTIVO });
    if (!numero || !fornecedor) return res.status(404).json({ error: NAO_ENCONTRADO });
    const resultado = await emTransacao(pool, res, 'POST /estoque/entrada/desfazer', async conn => {
      // mesma ordem de travas da entrada (estoque primeiro, depois as linhas), para as duas não travarem uma à outra
      const [nomes] = await conn.execute('SELECT DISTINCT NOME_PRODUTO FROM entrada_estoque WHERE NOTA_FISCAL = ? AND FABRICANTE = ?', [numero, fornecedor]);
      if (!nomes.length) throw new ErroUsuario(404, NAO_ENCONTRADO);
      const produtos = await travarPorNome(conn, nomes.map(n => n.NOME_PRODUTO));
      const [linhas] = await conn.execute(
        `SELECT id, NOTA_FISCAL, DATA, FABRICANTE, ITEM, NOME_PRODUTO, NOME_PRODUTO_FABRICANTE, QTD, VALOR_UNITARIO, VALOR_TOTAL, OBSERVACAO
         FROM entrada_estoque WHERE NOTA_FISCAL = ? AND FABRICANTE = ? FOR UPDATE`, [numero, fornecedor]);
      if (!linhas.length) throw new ErroUsuario(404, NAO_ENCONTRADO);
      const [[nf]] = await conn.execute(
        'SELECT NUMERO, RAZAO_FABRICANTE, DATA, VALOR_TOTAL FROM nf_entrada WHERE NUMERO = ? AND RAZAO_FABRICANTE = ? FOR UPDATE', [numero, fornecedor]);
      const soma = somarPorProduto(linhas);
      const resumo = [];
      for (const [nome, qtd] of soma) {
        const p = produtos.get(nome);
        if (!p) throw new ErroUsuario(409, `Não dá para desfazer: o produto '${nome}' não existe mais no estoque.`);
        const atual = Number(p.QTD_ESTOQUE) || 0;
        if (atual - qtd < 0) throw new ErroUsuario(409, `Não dá para desfazer: o estoque de '${nome}' já foi usado (atual ${atual}, entrada ${qtd}). Corrija pelo Ajuste.`);
        resumo.push({ codigo: p.CODIGO, produto: nome, antes: atual, depois: atual - qtd, qtd });
      }
      for (const r of resumo) await conn.execute('UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE - ? WHERE CODIGO = ?', [r.qtd, r.codigo]);
      await conn.execute('DELETE FROM entrada_estoque WHERE NOTA_FISCAL = ? AND FABRICANTE = ?', [numero, fornecedor]);
      await conn.execute('DELETE FROM nf_entrada WHERE NUMERO = ? AND RAZAO_FABRICANTE = ?', [numero, fornecedor]);
      const saidaResumo = resumo.map(({ produto, antes, depois }) => ({ produto, antes, depois }));
      await gravarEstorno(conn, req, 'entrada', `${numero} · ${fornecedor}`, motivo, { nota: nf || null, linhas, resumo: saidaResumo });
      return saidaResumo;
    });
    if (resultado) res.json({ itens: resultado });
  });

  rota('post', '/estoque/saida/desfazer', DESFAZER, async (req, res) => {
    const b = req.body || {};
    const data = String(b.data ?? '').trim(), usuario = txt(b.usuario, 190), motivo = motivoValido(b.motivo);
    if (!motivo) return res.status(400).json({ error: MSG_MOTIVO });
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(data)) return res.status(404).json({ error: NAO_ENCONTRADO });
    const resultado = await emTransacao(pool, res, 'POST /estoque/saida/desfazer', async conn => {
      // saídas antigas do VB podem ter USUARIO nulo: usuario '' encontra essas. Estoque travado antes das linhas.
      const [nomes] = await conn.execute(
        "SELECT DISTINCT NOME_PRODUTO FROM saida_estoque WHERE DATA = ? AND (USUARIO = ? OR (? = '' AND USUARIO IS NULL))", [data, usuario, usuario]);
      if (!nomes.length) throw new ErroUsuario(404, NAO_ENCONTRADO);
      const produtos = await travarPorNome(conn, nomes.map(n => n.NOME_PRODUTO));
      const [linhas] = await conn.execute(
        `SELECT ID, CODIGO_BARRA, FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, DATA, QTD, USUARIO, STATUS
         FROM saida_estoque WHERE DATA = ? AND (USUARIO = ? OR (? = '' AND USUARIO IS NULL)) FOR UPDATE`, [data, usuario, usuario]);
      if (!linhas.length) throw new ErroUsuario(404, NAO_ENCONTRADO);
      const soma = somarPorProduto(linhas);
      const resumo = [];
      for (const [nome, qtd] of soma) {
        const p = produtos.get(nome);
        if (!p) throw new ErroUsuario(409, `Não dá para desfazer: o produto '${nome}' não existe mais no estoque.`);
        const atual = Number(p.QTD_ESTOQUE) || 0;
        await conn.execute('UPDATE estoque SET QTD_ESTOQUE = QTD_ESTOQUE + ? WHERE CODIGO = ?', [qtd, p.CODIGO]);
        resumo.push({ produto: nome, antes: atual, depois: atual + qtd });
      }
      const ids = linhas.map(l => l.ID);
      await conn.execute(`DELETE FROM saida_estoque WHERE ID IN (${ids.map(() => '?').join(', ')})`, ids);
      await gravarEstorno(conn, req, 'saida', `${data} · ${usuario || '(sem usuário)'}`, motivo, { linhas, resumo });
      return resumo;
    });
    if (resultado) res.json({ itens: resultado });
  });

  // ----- ajuste de inventário: a quantidade contada substitui a do sistema -----
  rota('post', '/estoque/ajuste', [VER, 'estoque.ajustar'], async (req, res) => {
    const b = req.body || {};
    const chave = txt(b.chave, 65);
    const qtd = typeof b.qtdContada === 'number' ? b.qtdContada : NaN;
    const motivo = motivoValido(b.motivo);
    const erro = msg => res.status(400).json({ error: msg });
    if (!chave || chave.length > 64) return erro('Lançamento sem identificação. Atualize a página e tente de novo.');
    if (!motivo) return erro(MSG_MOTIVO);
    if (!Number.isFinite(qtd) || qtd < 0) return erro('Quantidade contada inválida.');

    const resultado = await emTransacao(pool, res, 'POST /estoque/ajuste', async conn => {
      await reservarChave(conn, { chave, tipo: 'ajuste', quem: req.user.nome, referencia: String(parseInt(b.produtoCodigo, 10) || '') });
      const p = (await travarProdutos(conn, [b.produtoCodigo])).get(Number(b.produtoCodigo));
      if (!p) throw new ErroUsuario(404, 'Produto não encontrado.');
      const antes = Number(p.QTD_ESTOQUE) || 0;
      await conn.execute('UPDATE estoque SET QTD_ESTOQUE = ? WHERE CODIGO = ?', [qtd, p.CODIGO]);
      await conn.execute(
        'INSERT INTO web_estoque_ajustes (quando, quem, produto_codigo, nome_produto, qtd_antes, qtd_depois, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [agoraLocal(), req.user.nome, p.CODIGO, p.NOME_PRODUTO, antes, qtd, motivo]);
      return [{ produto: p.NOME_PRODUTO, antes, depois: qtd }];
    });
    if (resultado) res.status(201).json({ itens: resultado });
  });
}

module.exports = { registrarEstoqueMovimentos, validarData };
