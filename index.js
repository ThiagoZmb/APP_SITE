const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const { criarAcesso } = require('./seguranca/acesso');
const { criarRegistro } = require('./seguranca/rotas');
const { redeDeValores, semValores, preservarValores, podeVerValores } = require('./seguranca/valores');
const { filtroEstados } = require('./seguranca/acesso');
const { instalarTabelas, migrarAcessos, garantirAdministrador, acrescentarPermissoesEstoque, acrescentarPermissoesPedOrc } = require('./seguranca/instalacao');
const { registrarAdmin } = require('./rotas/admin');
const { registrarEstoqueMovimentos } = require('./rotas/estoque_movimentos');
const { registrarEstoqueAnalises } = require('./rotas/estoque_analises');
const { criarLeitor, lerCliente, calcularPrecoItem, precoComAcessorios, ErroPreco } = require('./calculo/precos');
const { registrarPedOrc } = require('./rotas/ped_orc');

const app = express();
// Render fica atrás de proxy: sem isto, req.ip seria o IP do proxy e o limite de login
// valeria para todos os usuários juntos. TRUST_PROXY_HOPS permite ajustar sem mudar código.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
const PORT = process.env.PORT || 3000;

// ================= VALIDAÇÃO DE AMBIENTE =================
const JWT_SECRET = process.env.JWT_SECRET;
// nos testes automáticos o banco é simulado, então só o JWT_SECRET é obrigatório
const OBRIGATORIAS = process.env.NODE_ENV === 'test' ? [] : ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
const faltando = OBRIGATORIAS.filter(k => !process.env[k]);
if (!JWT_SECRET || faltando.length > 0) {
  console.error('FATAL: variáveis de ambiente ausentes:', [...faltando, ...(JWT_SECRET ? [] : ['JWT_SECRET'])]);
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  dateStrings: true,
  multipleStatements: false
});

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    const origemLocal = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
    if (!origin || origin === 'https://thiagozmb.github.io' || origemLocal.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origem não permitida pelo CORS'));
  }
}));
app.use(express.json({ limit: '100kb' }));

// ================= RATE LIMIT =================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ================= JWT + ACESSO =================
// O token só identifica o usuário (v: 2). Perfil, permissões, estados e se está
// ativo vêm do banco a cada requisição (cache de 60 s, limpo pela administração).
const acesso = criarAcesso({ pool });

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.CODIGO, nome: usuario.NOME, v: 2 },
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'elegance-api' }
  );
}
const resumoAcesso = a => ({ perfil: a.perfil, permissoes: [...a.permissoes], estados: a.estados });

async function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { issuer: 'elegance-api' });
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
  if (payload.v !== 2) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  try {
    req.acesso = await acesso.carregar(payload.id);
  } catch (err) {
    console.error('Erro ao carregar acesso:', err.message);
    return res.status(500).json({ error: 'Erro de servidor' });
  }
  if (!req.acesso || !req.acesso.ativo) return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.' });
  req.user = { id: payload.id, nome: req.acesso.nome, cargo: req.acesso.cargo };
  next();
}
const registro = criarRegistro(app, { autenticado: [autenticar, redeDeValores] });
// Estados (região) do usuário decidem o filtro — o navegador não consegue ampliar.
// Sem restrição, o ?estado= da tela ainda pode filtrar; com restrição, só os estados dele.
function condicaoEstado(req, coluna) {
  const f = filtroEstados(req, coluna);
  if (f.sql) return f;
  const pedido = String(req.query?.estado || '').trim().toUpperCase();
  return pedido ? { sql: `${coluna} = ?`, params: [pedido] } : { sql: '', params: [] };
}
// cliente fora dos estados do usuário → 403 (true = bloqueado e resposta já enviada)
function foraDosEstados(req, res, estadoDoCliente) {
  const estados = req.acesso?.estados || [];
  if (!estados.length || estados.includes(String(estadoDoCliente || '').trim().toUpperCase())) return false;
  res.status(403).json({ error: 'Acesso restrito' });
  return true;
}
const JOIN_CLIENTE = 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL';

// Gravação em cliente: o cliente atual — e, ao salvar, o estado novo — precisam estar nos estados do usuário.
function clienteNosEstados({ verificarEstadoNovo = false } = {}) {
  return async (req, res, next) => {
    if (!(req.acesso?.estados || []).length) return next();
    try {
      const codigo = parseInt(req.body?.codigo, 10) || 0;
      const [r] = codigo ? await pool.execute('SELECT ESTADO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [codigo]) : [[]];
      if (r.length && foraDosEstados(req, res, r[0].ESTADO)) return;
      if (verificarEstadoNovo && foraDosEstados(req, res, req.body?.estado)) return;
      next();
    } catch (err) {
      console.error('Erro ao conferir o estado do cliente:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  };
}

// Gravação sem `valores.ver`: os campos de valor vêm do banco, nunca da tela.
// Registro novo: com `mensagemNovo` é recusado (403); sem ela, os valores entram zerados.
//   mapa = { campoDoCorpo: 'COLUNA_NO_BANCO' }
function preservarDoBanco({ sql, chave, mapa, mensagemNovo }) {
  const campos = Object.keys(mapa);
  return async (req, res, next) => {
    if (podeVerValores(req)) return next();
    try {
      const corpo = req.body || {};
      const id = chave(corpo);
      const [linhas] = id ? await pool.execute(sql, [id]) : [[]];
      if (!linhas.length) {
        if (mensagemNovo) return res.status(403).json({ error: mensagemNovo });
        req.body = preservarValores(req, corpo, Object.fromEntries(campos.map(c => [c, 0])), campos);
      } else {
        req.body = preservarValores(req, corpo, Object.fromEntries(campos.map(c => [c, linhas[0][mapa[c]]])), campos);
      }
      next();
    } catch (err) {
      console.error('Erro ao preservar valores:', err.message);
      res.status(500).json({ error: 'Erro de servidor' });
    }
  };
}

// ================= LOGIN =================
registro.publica('post', '/login', loginLimiter, async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password || username.length > 100 || password.length > 200) {
    return res.status(400).json({ success: false, message: 'Usuário ou senha inválidos.' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT CODIGO, NOME, RAZAO_SOCIAL, CARGO, SENHA FROM cliente_usuarios WHERE NOME = ? LIMIT 1',
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
    }
    const user = rows[0];
    console.log(`[login] ip=${req.ip} saltos_proxy=${String(req.headers['x-forwarded-for'] || '').split(',').filter(Boolean).length}`);
    const senhaOk = await bcrypt.compare(password, user.SENHA);
    if (!senhaOk) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
    }
    const a = await acesso.carregar(user.CODIGO);
    if (!a || !a.ativo) {
      return res.status(403).json({ success: false, message: 'Acesso à web não liberado. Fale com o administrador.' });
    }
    res.json({
      success: true,
      token: gerarToken(user),
      user: { nome: user.NOME, empresa: user.RAZAO_SOCIAL, cargo: user.CARGO },
      acesso: resumoAcesso(a)
    });
  } catch (err) {
    console.error('Erro no login:', err.message);
    res.status(500).json({ success: false, message: 'Erro de servidor.' });
  }
});

// ================= VERIFICAÇÃO DE SESSÃO =================
registro.rota('get', '/auth/verify', [], (req, res) => {
  res.json({ valid: true, user: { nome: req.user.nome, cargo: req.user.cargo }, acesso: resumoAcesso(req.acesso) });
});

// Datas de pronto/entrega: a coluna pode ser DATE/DATETIME ou texto "dd/mm/aaaa" (herança do VB).
// DATE_FORMAT em texto "dd/mm/aaaa" gera datas absurdas, então normalizamos aqui.
function dataBRSegura(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  // ano < 1900 = data vazia (o VB grava 01/01/0001, o DateTime.MinValue do .NET)
  if (m) return Number(m[1]) < 1900 ? '' : `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return Number(m[3]) < 1900 ? '' : `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return '';
}
const comDatasSeguras = rows => rows.map(r => ({ ...r, prontoEm: dataBRSegura(r.prontoEm), dataEntrega: dataBRSegura(r.dataEntrega) }));

// ================= LISTA ÚNICA (Pedido ou Orçamento) =================
registro.rota('get', '/dados_lista', ['pedidos.ver'], async (req, res) => {
  try {
    const tipo = req.query.tipo === 'Orçamento' ? 'Orçamento' : 'Pedido';
    const est = condicaoEstado(req, 'c.ESTADO');
    const sql = `
      SELECT 
        p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
        DATE_FORMAT(p.DATA, '%d/%m/%Y') as data,
        CAST(p.DATA_PRONTO AS CHAR) as prontoEm,
        p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao,
        p.FINANCEIRO as financeiro,
        CAST(p.DATA_ENTREGA AS CHAR) as dataEntrega
      FROM ped_orc p
      ${est.sql ? JOIN_CLIENTE : ''}
      WHERE p.TIPO = ? ${est.sql ? 'AND ' + est.sql : ''}
      ORDER BY p.NUMERO DESC`;
    const [rows] = await pool.execute(sql, [tipo, ...est.params]);
    res.json(semValores(req, comDatasSeguras(rows), ['valor']));
  } catch (err) {
    console.error('Erro /dados_lista:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Mantidos por compatibilidade
registro.rota('get', '/dados_pedidos', ['pedidos.ver'], async (req, res) => {
  try {
    const est = condicaoEstado(req, 'c.ESTADO');
    const where = est.sql ? `${JOIN_CLIENTE} WHERE ${est.sql} AND p.TIPO='Pedido'` : `WHERE p.TIPO='Pedido'`;
    const [rows] = await pool.execute(`
      SELECT p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
             DATE_FORMAT(p.DATA, '%d/%m/%Y') as data, CAST(p.DATA_PRONTO AS CHAR) as prontoEm,
             p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao, p.FINANCEIRO as financeiro,
             CAST(p.DATA_ENTREGA AS CHAR) as dataEntrega
      FROM ped_orc p ${where} ORDER BY NUMERO DESC`, est.params);
    res.json(semValores(req, comDatasSeguras(rows), ['valor']));
  } catch (err) {
    console.error('Erro /dados_pedidos:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

registro.rota('get', '/dados_pedidos_rj', ['pedidos.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
             DATE_FORMAT(p.DATA, '%d/%m/%Y') as data, CAST(p.DATA_PRONTO AS CHAR) as prontoEm,
             p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao, p.FINANCEIRO as financeiro,
             CAST(p.DATA_ENTREGA AS CHAR) as dataEntrega
      FROM ped_orc p
      ${JOIN_CLIENTE}
      WHERE c.ESTADO = 'RJ' AND p.TIPO='Pedido' ${filtroEstados(req, 'c.ESTADO').sql ? 'AND ' + filtroEstados(req, 'c.ESTADO').sql : ''}
      ORDER BY p.DATA DESC`, filtroEstados(req, 'c.ESTADO').params);
    res.json(semValores(req, comDatasSeguras(rows), ['valor']));
  } catch (err) {
    console.error('Erro /dados_pedidos_rj:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= CLIENTES =================
registro.rota('get', '/dados_clientes', [{ algum: ['clientes.ver', 'pedidos.ver', 'orcamentos.criar', 'paineis.ver'] }], async (req, res) => {
  try {
    const est = condicaoEstado(req, 'ESTADO');
    const sql = `
      SELECT CODIGO as codigo, RAZAO_SOCIAL as razaoSocial, FANTASIA as fantasia,
             TIPO as tipo, CNPJ_CPF as cnpjCpf, IE_RG as ieRg,
             CEP as cep, ENDERECO as endereco, NUMERO as numero,
             BAIRRO as bairro, CIDADE as cidade, ESTADO as estado,
             SITUACAO as situacao, CONDICAO as condicao,
             CREDITO as credito, DESCONTO as desconto,
             OBSERVACAO as observacao, CONTATO as contato,
             TELEFONE as telefone, EMAIL as email, REPRESENTANTE as representante
      FROM cadastro_clientes ${est.sql ? 'WHERE ' + est.sql : ''}
      ORDER BY RAZAO_SOCIAL ASC`;
    const [rows] = await pool.execute(sql, est.params);
    res.json(semValores(req, rows, ['credito', 'desconto']));
  } catch (err) {
    console.error('Erro /dados_clientes:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= RANKINGS DOS ÚLTIMOS 12 MESES (só pedidos) =================
// filtro comum: pedidos dos últimos 12 meses, nos estados do usuário; opcional por cliente
function filtroPedidos12m(req) {
  const est = condicaoEstado(req, 'c.ESTADO');
  const cliente = req.query.cliente ? String(req.query.cliente) : null;
  const where = ["p.TIPO = 'Pedido'", 'p.DATA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)'];
  const params = [];
  if (est.sql) { where.push(est.sql); params.push(...est.params); }
  if (cliente) { where.push('p.RAZAO_SOCIAL = ?'); params.push(cliente); }
  return { join: est.sql ? JOIN_CLIENTE : '', where: where.join(' AND '), params };
}

// Tipos de produto mais vendidos (itens dos pedidos)
registro.rota('get', '/ranking_produtos', [{ algum: ['paineis.ver', 'pedidos.ver', 'clientes.ver'] }], async (req, res) => {
  try {
    const f = filtroPedidos12m(req);
    const [rows] = await pool.execute(
      `SELECT COALESCE(NULLIF(TRIM(i.TIPO_PRODUTO), ''), 'Sem tipo') AS nome,
              SUM(i.TOTAL) AS valor, SUM(i.QTD) AS qtd, COUNT(DISTINCT p.NUMERO) AS pedidos
       FROM ped_orc_lista_itens i
       INNER JOIN ped_orc p ON p.NUMERO = i.NUMERO AND p.TIPO = i.TIPO
       ${f.join}
       WHERE ${f.where}
       GROUP BY nome`, f.params);
    res.json(semValores(req, rows.map(r => ({ nome: r.nome, valor: numEstq(r.valor), qtd: numEstq(r.qtd), pedidos: Number(r.pedidos) || 0 })), ['valor']));
  } catch (err) {
    console.error('Erro /ranking_produtos:', err.message);
    res.status(500).json({ error: 'Erro ao calcular os produtos mais vendidos', detalhe: err.code || err.message });
  }
});

// Clientes que mais compraram
registro.rota('get', '/ranking_clientes', [{ algum: ['paineis.ver', 'pedidos.ver', 'clientes.ver'] }], async (req, res) => {
  try {
    const f = filtroPedidos12m(req);
    const [rows] = await pool.execute(
      `SELECT p.RAZAO_SOCIAL AS nome, SUM(p.TOTAL) AS valor, COUNT(*) AS pedidos, MAX(p.DATA) AS ultimo
       FROM ped_orc p ${f.join}
       WHERE ${f.where}
       GROUP BY p.RAZAO_SOCIAL`, f.params);
    res.json(semValores(req, rows.map(r => ({ nome: r.nome || '—', valor: numEstq(r.valor), pedidos: Number(r.pedidos) || 0, ultimo: dataBRSegura(r.ultimo) })), ['valor']));
  } catch (err) {
    console.error('Erro /ranking_clientes:', err.message);
    res.status(500).json({ error: 'Erro ao calcular os clientes que mais compraram', detalhe: err.code || err.message });
  }
});

// ================= CADASTRO DE CLIENTES — fiel ao frm_Clientes.vb (equipe interna) =================
const CLASSES_CLIENTE = ['Arquiteto', 'Cliente Final', 'Esquadria', 'Loja Planejados', 'Marcenaria', 'Marmoraria', 'Representante', 'Vidraçaria'];
const listaSimples = async (sql, params = []) => {
  try { const [r] = await pool.execute(sql, params); return r.map(x => x.v).filter(v => v != null && String(v).trim() !== ''); }
  catch { return []; }
};
async function razaoDoCodigo(codigo) {
  const [r] = await pool.execute('SELECT RAZAO_SOCIAL FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [codigo]);
  return r.length ? r[0].RAZAO_SOCIAL : null;
}
// razão social do cliente, já respondendo 404/403 quando não existe ou está fora dos estados do usuário
async function razaoPermitida(req, res, codigo) {
  const [r] = await pool.execute('SELECT RAZAO_SOCIAL, ESTADO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [codigo]);
  if (!r.length) { res.status(404).json({ error: 'Cliente não encontrado' }); return null; }
  if (foraDosEstados(req, res, r[0].ESTADO)) return null;
  return r[0].RAZAO_SOCIAL;
}

// Combos do cadastro + próximo código (Contar_Registros)
registro.rota('get', '/clientes/opcoes', ['clientes.ver'], async (req, res) => {
  const [[mx]] = await pool.execute('SELECT MAX(CODIGO) AS m FROM cadastro_clientes').catch(() => [[{ m: 0 }]]);
  res.json({
    proximoCodigo: (parseInt(mx.m, 10) || 0) + 1,
    classes: CLASSES_CLIENTE,
    estados: await listaSimples('SELECT DISTINCT ESTADO AS v FROM cidades ORDER BY ESTADO'),
    representantes: await listaSimples('SELECT REPRESENTANTE AS v FROM representantes ORDER BY REPRESENTANTE'),
    condicoes: await listaSimples("SELECT DISTINCT CONDICAO AS v FROM cadastro_clientes WHERE CONDICAO <> '' ORDER BY CONDICAO")
  });
});
// Cascata Estado → Cidade → Bairro
registro.rota('get', '/clientes/cidades', ['clientes.ver'], async (req, res) => {
  res.json(await listaSimples('SELECT CIDADE AS v FROM cidades WHERE ESTADO = ? ORDER BY CIDADE ASC', [txtEstq(req.query.estado, 10)]));
});
registro.rota('get', '/clientes/bairros', ['clientes.ver'], async (req, res) => {
  res.json(await listaSimples('SELECT BAIRRO AS v FROM bairros WHERE CIDADE = ? ORDER BY BAIRRO ASC', [txtEstq(req.query.cidade, 120)]));
});
// cmb_Representante_SelectedIndexChanged: comissão do representante
registro.rota('get', '/clientes/comissao', ['clientes.ver'], async (req, res) => {
  try {
    const [r] = await pool.execute('SELECT COMISSAO FROM representantes WHERE REPRESENTANTE = ? LIMIT 1', [txtEstq(req.query.representante)]);
    res.json(semValores(req, { comissao: r.length ? numEstq(r[0].COMISSAO) : null }, ['comissao']));
  } catch { res.json({ comissao: null }); }
});

// cmb_Cliente_SelectedIndexChanged: ficha completa
registro.rota('get', '/clientes/item/:codigo', ['clientes.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [req.params.codigo]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    const r = rows[0];
    if (foraDosEstados(req, res, r.ESTADO)) return;
    const t = k => (r[k] == null ? '' : String(r[k]));
    res.json(semValores(req, {
      codigo: r.CODIGO, tipo: t('TIPO'), razaoSocial: t('RAZAO_SOCIAL'), fantasia: t('FANTASIA'), cnpjCpf: t('CNPJ_CPF'), ieRg: t('IE_RG'),
      endereco: t('ENDERECO'), numero: t('NUMERO'), cep: t('CEP'), bairro: t('BAIRRO'), cidade: t('CIDADE'), estado: t('ESTADO'),
      complemento: t('COMPLEMENTO'), telefone: t('TELEFONE'), contato: t('CONTATO'), email: t('EMAIL'), classe: t('CLASSE'),
      desconto: numEstq(r.DESCONTO), descontoAdicional: numEstq(r.DESCONTO_ADICIONAL), condicao: t('CONDICAO'), medicao: t('MEDICAO'),
      credito: numEstq(r.CREDITO), observacao: t('OBSERVACAO'), comissao: numEstq(r.COMISSAO), representante: t('REPRESENTANTE'),
      fretePortas: numEstq(r.FRETE_PORTAS), freteMetalon: numEstq(r.FRETE_METALON),
      tipoDesconto: t('TIPO_DESCONTO'), situacao: t('SITUACAO'), permissao: t('PERMISSAO')
    }, ['desconto', 'descontoAdicional', 'credito', 'comissao', 'fretePortas', 'freteMetalon']));
  } catch (err) {
    console.error('Erro /clientes/item:', err.message);
    res.status(500).json({ error: 'Erro ao carregar o cliente', detalhe: err.code || err.message });
  }
});

// Salvar: INSERT se o código não existe, senão UPDATE (campos * obrigatórios da tela)
registro.rota('post', '/clientes/salvar', ['clientes.editar'], clienteNosEstados({ verificarEstadoNovo: true }), preservarDoBanco({
  sql: 'SELECT DESCONTO, DESCONTO_ADICIONAL, COMISSAO, FRETE_PORTAS, FRETE_METALON FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1',
  chave: b => parseInt(b.codigo, 10) || 0,
  mapa: { desconto: 'DESCONTO', descontoAdicional: 'DESCONTO_ADICIONAL', comissao: 'COMISSAO', fretePortas: 'FRETE_PORTAS', freteMetalon: 'FRETE_METALON' }
}), async (req, res) => {
  const b = req.body || {};
  const erro = msg => res.status(400).json({ error: msg });
  const d = {
    razao: txtEstq(b.razaoSocial), classe: txtEstq(b.classe, 60), medicao: txtEstq(b.medicao, 60), telefone: txtEstq(b.telefone, 60)
  };
  if (!d.razao) return erro('Favor inserir a Razão Social!');
  if (!d.classe) return erro('Favor escolher a Classe do cliente!');
  if (!d.medicao) return erro('Favor escolher o Tipo de Medição!');
  if (!d.telefone) return erro('Favor inserir o Telefone!');
  const codigo = parseInt(b.codigo, 10) || 0;
  if (!codigo) return erro('Código do cliente inválido.');
  try {
    // Razão Social identifica o cliente nos pedidos e no fluxo de caixa: não pode repetir
    const [dup] = await pool.execute('SELECT CODIGO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? AND CODIGO <> ? LIMIT 1', [d.razao, codigo]);
    if (dup.length) return erro('Já existe outro cliente com esta Razão Social!');
    const campos = {
      TIPO: txtEstq(b.tipo, 30), RAZAO_SOCIAL: d.razao, FANTASIA: txtEstq(b.fantasia), CNPJ_CPF: txtEstq(b.cnpjCpf, 30), IE_RG: txtEstq(b.ieRg, 30),
      ENDERECO: txtEstq(b.endereco), NUMERO: txtEstq(b.numero, 20), CEP: txtEstq(b.cep, 12), BAIRRO: txtEstq(b.bairro, 120),
      CIDADE: txtEstq(b.cidade, 120), ESTADO: txtEstq(b.estado, 4), COMPLEMENTO: txtEstq(b.complemento, 500), TELEFONE: d.telefone,
      CONTATO: txtEstq(b.contato, 120), EMAIL: txtEstq(b.email, 160), CLASSE: d.classe, DESCONTO: numEstq(b.desconto),
      DESCONTO_ADICIONAL: numEstq(b.descontoAdicional), CONDICAO: txtEstq(b.condicao, 120), MEDICAO: d.medicao,
      OBSERVACAO: txtEstq(b.observacao, 2000), COMISSAO: numEstq(b.comissao), REPRESENTANTE: txtEstq(b.representante, 120),
      FRETE_PORTAS: numEstq(b.fretePortas), FRETE_METALON: numEstq(b.freteMetalon),
      TIPO_DESCONTO: ['Desconto progressivo', 'Desconto fixo'].includes(b.tipoDesconto) ? b.tipoDesconto : '',
      SITUACAO: b.situacao === 'Inativo' ? 'Inativo' : 'Ativo'
    };
    const cols = Object.keys(campos), vals = Object.values(campos);
    const [ex] = await pool.execute('SELECT CODIGO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [codigo]);
    if (ex.length) {
      await pool.execute(`UPDATE cadastro_clientes SET ${cols.map(c => c + ' = ?').join(', ')} WHERE CODIGO = ?`, [...vals, codigo]);
      return res.json({ ok: true, codigo, mensagem: 'Cliente atualizado com sucesso!' });
    }
    await pool.execute(
      `INSERT INTO cadastro_clientes (CODIGO, ${cols.join(', ')}, CREDITO, PERMISSAO) VALUES (?, ${cols.map(() => '?').join(', ')}, 0, 'Liberado')`,
      [codigo, ...vals]);
    res.json({ ok: true, codigo, mensagem: 'Cliente cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro /clientes/salvar:', err.code, err.message);
    res.status(500).json({ error: err.code === 'ER_DUP_ENTRY' ? 'Este código já existe!' : 'Erro ao salvar o cliente.', detalhe: err.code || err.message });
  }
});

// btn_Crédito: soma o valor ao crédito existente
registro.rota('post', '/clientes/credito', ['clientes.credito', 'valores.ver'], clienteNosEstados(), async (req, res) => {
  const codigo = parseInt(req.body?.codigo, 10) || 0;
  const valor = numEstq(req.body?.valor);
  if (!codigo) return res.status(400).json({ error: 'Favor escolher um cliente!' });
  if (!(valor > 0)) return res.status(400).json({ error: 'Nenhum valor foi adicionado!' });
  try {
    await pool.execute('UPDATE cadastro_clientes SET CREDITO = COALESCE(CREDITO, 0) + ? WHERE CODIGO = ?', [valor, codigo]);
    const [[r]] = await pool.execute('SELECT CREDITO FROM cadastro_clientes WHERE CODIGO = ?', [codigo]);
    res.json({ ok: true, credito: numEstq(r?.CREDITO) });
  } catch (err) {
    console.error('Erro /clientes/credito:', err.message);
    res.status(500).json({ error: 'Erro ao registrar o crédito' });
  }
});

// btn_Bloquear: alterna Bloqueado / Liberado
registro.rota('post', '/clientes/permissao', ['clientes.permissao'], clienteNosEstados(), async (req, res) => {
  const codigo = parseInt(req.body?.codigo, 10) || 0;
  try {
    const [[r]] = await pool.execute('SELECT PERMISSAO FROM cadastro_clientes WHERE CODIGO = ?', [codigo]);
    if (!r) return res.status(404).json({ error: 'Selecione um cliente primeiro!' });
    const nova = String(r.PERMISSAO) === 'Bloqueado' ? 'Liberado' : 'Bloqueado';
    await pool.execute('UPDATE cadastro_clientes SET PERMISSAO = ? WHERE CODIGO = ?', [nova, codigo]);
    res.json({ ok: true, permissao: nova });
  } catch (err) {
    console.error('Erro /clientes/permissao:', err.message);
    res.status(500).json({ error: 'Erro ao alterar a permissão' });
  }
});

// Aba Financeiro: pedidos e fluxo de caixa (em aberto ou todos) + Carregar_Resumo
registro.rota('get', '/clientes/financeiro/:codigo', ['clientes.receber', 'valores.ver'], async (req, res) => {
  try {
    const razao = await razaoPermitida(req, res, req.params.codigo);
    if (!razao) return;
    const todos = req.query.todos === '1';
    const [pedidos] = await pool.execute(
      `SELECT NUMERO, CLIENTE_FINAL, DATE_FORMAT(DATA, '%Y-%m-%d') AS DATA, CAST(DATA_PRONTO AS CHAR) AS DATA_PRONTO, TOTAL, OBS_GERAL, SITUACAO, FINANCEIRO
       FROM ped_orc WHERE RAZAO_SOCIAL = ? AND TIPO = 'Pedido'
       ${todos ? '' : "AND SITUACAO IN ('Em Produção', 'Pronto', 'Entregue', 'Retirado') AND FINANCEIRO IN ('A Receber', 'Atrasado', 'Protestado')"}
       ORDER BY NUMERO DESC`, [razao]);
    const [fluxo] = await pool.execute(
      `SELECT ID, DATE_FORMAT(DATA, '%Y-%m-%d') AS DATA, PEDIDO, NOTA_FISCAL, VALOR, OBSERVACAO_GERAL, SITUACAO
       FROM fluxo_de_caixa WHERE RAZAO_SOCIAL = ? ${todos ? '' : "AND SITUACAO IN ('A Receber', 'Atrasado', 'Protestado')"}
       ORDER BY DATA DESC`, [razao]);
    const [[res1]] = await pool.execute(
      `SELECT SUM(IF(SITUACAO IN ('A Receber', 'Atrasado', 'Protestado'), VALOR, 0)) AS receber,
              SUM(IF(SITUACAO IN ('Atrasado', 'Protestado'), VALOR, 0)) AS atrasado
       FROM fluxo_de_caixa WHERE RAZAO_SOCIAL = ?`, [razao]);
    const [[res2]] = await pool.execute(
      `SELECT SUM(IF(SITUACAO <> 'Cancelado' AND FINANCEIRO IN ('A Receber', 'Atrasado'), TOTAL, 0)) AS receber
       FROM ped_orc WHERE RAZAO_SOCIAL = ? AND TIPO = 'Pedido'`, [razao]);
    const [[cli]] = await pool.execute('SELECT CREDITO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [razao]);
    const receberFluxo = numEstq(res1.receber), receberPedidos = numEstq(res2.receber), credito = numEstq(cli?.CREDITO);
    res.json({
      pedidos: pedidos.map(p => ({ numero: p.NUMERO, clienteFinal: p.CLIENTE_FINAL || '', data: p.DATA, entrega: dataBRSegura(p.DATA_PRONTO),
        valor: numEstq(p.TOTAL), observacao: p.OBS_GERAL || '', situacao: p.SITUACAO || '', financeiro: p.FINANCEIRO || '' })),
      fluxo: fluxo.map(f => ({ id: f.ID, data: f.DATA, pedido: f.PEDIDO ?? '', notaFiscal: f.NOTA_FISCAL ?? '', valor: numEstq(f.VALOR),
        observacao: f.OBSERVACAO_GERAL || '', situacao: f.SITUACAO || '' })),
      resumo: { receberFluxo, receberPedidos, credito, atrasado: numEstq(res1.atrasado), saldoDevedor: receberFluxo + receberPedidos - credito }
    });
  } catch (err) {
    console.error('Erro /clientes/financeiro:', err.message);
    res.status(500).json({ error: 'Erro ao carregar o financeiro do cliente', detalhe: err.code || err.message });
  }
});

// btn_Recebimento: zera o crédito (opcional) e marca os pedidos como Recebido (opcional)
registro.rota('post', '/clientes/receber', ['clientes.receber', 'valores.ver'], clienteNosEstados(), async (req, res) => {
  const b = req.body || {};
  const codigo = parseInt(b.codigo, 10) || 0;
  const pedidos = (Array.isArray(b.pedidos) ? b.pedidos : []).map(n => parseInt(n, 10)).filter(n => n > 0).slice(0, 300);
  try {
    const razao = await razaoDoCodigo(codigo);
    if (!razao) return res.status(404).json({ error: 'Não existe nenhum cliente selecionado!' });
    if (b.zerarCredito) await pool.execute('UPDATE cadastro_clientes SET CREDITO = 0 WHERE CODIGO = ?', [codigo]);
    let marcados = 0;
    if (b.marcarRecebido && pedidos.length) {
      const [r] = await pool.execute(
        `UPDATE ped_orc SET FINANCEIRO = 'Recebido' WHERE TIPO = 'Pedido' AND RAZAO_SOCIAL = ? AND NUMERO IN (${pedidos.map(() => '?').join(',')})`,
        [razao, ...pedidos]);
      marcados = r.affectedRows;
    }
    res.json({ ok: true, marcados });
  } catch (err) {
    console.error('Erro /clientes/receber:', err.message);
    res.status(500).json({ error: 'Erro ao registrar o recebimento' });
  }
});

// ================= ANÁLISE DO CLIENTE (visão de diretoria) =================
// Junta, num só pedido, tudo que a página de análise precisa; os indicadores são calculados na tela.
registro.rota('get', '/clientes/analise/:codigo', ['clientes.ver'], async (req, res) => {
  try {
    const [cliRows] = await pool.execute('SELECT * FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1', [req.params.codigo]);
    if (!cliRows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    const c = cliRows[0];
    if (foraDosEstados(req, res, c.ESTADO)) return;
    const razao = c.RAZAO_SOCIAL;
    const t = k => (c[k] == null ? '' : String(c[k]));

    // pedidos e orçamentos dos últimos 36 meses (base para tendência, ciclo de compra, prazo e conversão)
    const [docs] = await pool.execute(
      `SELECT NUMERO, TIPO, DATE_FORMAT(DATA, '%Y-%m-%d') AS DATA, CAST(DATA_PRONTO AS CHAR) AS DATA_PRONTO, TOTAL, SITUACAO, FINANCEIRO, CLIENTE_FINAL
       FROM ped_orc WHERE RAZAO_SOCIAL = ? AND DATA >= DATE_SUB(CURDATE(), INTERVAL 36 MONTH)
       ORDER BY DATA DESC, NUMERO DESC LIMIT 3000`, [razao]);
    const [[desde]] = await pool.execute(
      `SELECT DATE_FORMAT(MIN(DATA), '%Y-%m-%d') AS primeiro, COUNT(*) AS qtd, SUM(TOTAL) AS total
       FROM ped_orc WHERE RAZAO_SOCIAL = ? AND TIPO = 'Pedido'`, [razao]);

    // contexto da empresa nos últimos 12 meses: faturamento total, conversão média e posição do cliente
    // (nos estados do usuário: quem é restrito a uma região não vê o faturamento das outras)
    const estEmp = filtroEstados(req, 'c.ESTADO');
    const joinEmp = estEmp.sql ? JOIN_CLIENTE : '';
    const andEmp = estEmp.sql ? 'AND ' + estEmp.sql : '';
    const [[emp]] = await pool.execute(
      `SELECT SUM(IF(p.TIPO = 'Pedido', p.TOTAL, 0)) AS pedidos, SUM(IF(p.TIPO = 'Orçamento', p.TOTAL, 0)) AS orcamentos,
              COUNT(DISTINCT IF(p.TIPO = 'Pedido', p.RAZAO_SOCIAL, NULL)) AS clientes
       FROM ped_orc p ${joinEmp} WHERE p.DATA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) ${andEmp}`, estEmp.params);
    const [[rank]] = await pool.execute(
      `SELECT COUNT(*) + 1 AS posicao FROM (
         SELECT p.RAZAO_SOCIAL, SUM(p.TOTAL) AS t FROM ped_orc p ${joinEmp}
         WHERE p.TIPO = 'Pedido' AND p.DATA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) ${andEmp} GROUP BY p.RAZAO_SOCIAL
       ) x WHERE x.t > (SELECT COALESCE(SUM(TOTAL), 0) FROM ped_orc
                        WHERE TIPO = 'Pedido' AND RAZAO_SOCIAL = ? AND DATA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH))`,
      [...estEmp.params, razao]);

    // recebíveis em aberto (para aging) e recebimentos dos últimos 12 meses (pontualidade)
    const [receber] = await pool.execute(
      `SELECT ID, DATE_FORMAT(DATA, '%Y-%m-%d') AS DATA, VALOR, SITUACAO, PEDIDO FROM fluxo_de_caixa
       WHERE RAZAO_SOCIAL = ? AND SITUACAO IN ('A Receber', 'Atrasado', 'Protestado') ORDER BY DATA`, [razao]);
    const [[recebido]] = await pool.execute(
      `SELECT SUM(VALOR) AS total, COUNT(*) AS qtd FROM fluxo_de_caixa
       WHERE RAZAO_SOCIAL = ? AND SITUACAO = 'Recebido' AND DATA >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`, [razao]);

    res.json(semValores(req, {
      cliente: {
        codigo: c.CODIGO, razaoSocial: razao, fantasia: t('FANTASIA'), classe: t('CLASSE'), cidade: t('CIDADE'), estado: t('ESTADO'),
        situacao: t('SITUACAO'), permissao: t('PERMISSAO'), representante: t('REPRESENTANTE'), desconto: numEstq(c.DESCONTO),
        tipoDesconto: t('TIPO_DESCONTO'), condicao: t('CONDICAO'), credito: numEstq(c.CREDITO), telefone: t('TELEFONE'), contato: t('CONTATO'),
        primeiroPedido: desde.primeiro || '', pedidosVida: Number(desde.qtd) || 0, totalVida: numEstq(desde.total)
      },
      documentos: docs.map(d => ({
        numero: d.NUMERO, tipo: d.TIPO, data: d.DATA, pronto: dataBRSegura(d.DATA_PRONTO), valor: numEstq(d.TOTAL),
        situacao: d.SITUACAO || '', financeiro: d.FINANCEIRO || '', clienteFinal: d.CLIENTE_FINAL || ''
      })),
      empresa: { pedidos12m: numEstq(emp.pedidos), orcamentos12m: numEstq(emp.orcamentos), clientesAtivos12m: Number(emp.clientes) || 0, posicao: Number(rank.posicao) || null },
      receber: receber.map(r => ({ id: r.ID, vencimento: r.DATA, valor: numEstq(r.VALOR), situacao: r.SITUACAO, pedido: r.PEDIDO ?? '' })),
      recebido12m: { total: numEstq(recebido.total), qtd: Number(recebido.qtd) || 0 }
    }, ['desconto', 'credito', 'totalVida', 'valor', 'pedidos12m', 'orcamentos12m', 'receber', 'recebido12m']));
  } catch (err) {
    console.error('Erro /clientes/analise:', err.code, err.message);
    res.status(500).json({ error: 'Erro ao montar a análise do cliente', detalhe: err.code || err.message });
  }
});

// Aba Histórico (Carrega_Grafico): pedidos por mês nos últimos 180 dias
registro.rota('get', '/clientes/historico/:codigo', ['clientes.ver'], async (req, res) => {
  try {
    const razao = await razaoPermitida(req, res, req.params.codigo);
    if (!razao) return;
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SUM(TOTAL) AS total, COUNT(*) AS qtd FROM ped_orc
       WHERE TIPO = 'Pedido' AND RAZAO_SOCIAL = ? AND DATA >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 180 DAY), '%Y-%m-01')
       GROUP BY DATE_FORMAT(DATA, '%Y-%m')`, [razao]);
    const porMes = Object.fromEntries(rows.map(r => [r.mes, r]));
    const ini = new Date(); ini.setDate(ini.getDate() - 180);
    const meses = [];
    for (let m = new Date(ini.getFullYear(), ini.getMonth(), 1); m <= new Date(); m.setMonth(m.getMonth() + 1)) {
      const k = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      meses.push({ mes: k, total: numEstq(porMes[k]?.total), qtd: Number(porMes[k]?.qtd) || 0 });
    }
    res.json(semValores(req, meses, ['total']));
  } catch (err) {
    console.error('Erro /clientes/historico:', err.message);
    res.status(500).json({ error: 'Erro ao carregar o histórico' });
  }
});

// ================= GRÁFICO: ORÇAMENTOS x PEDIDOS (últimos 6 meses) =================
registro.rota('get', '/dados_compras_orcamentos', [{ algum: ['paineis.ver', 'pedidos.ver'] }, 'valores.ver'], async (req, res) => {
  try {
    const cliente = req.query.cliente;
    const est = condicaoEstado(req, 'c.ESTADO');
    let filtroExtra = 'WHERE p.DATA >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 6 MONTH), \'%Y-%m-01\')';
    const params = [];
    if (est.sql) { filtroExtra += ' AND ' + est.sql; params.push(...est.params); }
    if (cliente) { filtroExtra += ' AND p.RAZAO_SOCIAL = ?'; params.push(cliente); }
    const sql = `
      SELECT DATE_FORMAT(p.DATA, '%m/%Y') as mes,
             SUM(CASE WHEN p.TIPO = 'Orçamento' THEN p.TOTAL ELSE 0 END) as orcamentos,
             SUM(CASE WHEN p.TIPO = 'Pedido' THEN p.TOTAL ELSE 0 END) as pedidos
      FROM ped_orc p
      INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL
      ${filtroExtra}
      GROUP BY DATE_FORMAT(p.DATA, '%m/%Y'), YEAR(p.DATA), MONTH(p.DATA)
      ORDER BY YEAR(p.DATA) ASC, MONTH(p.DATA) ASC`;
    const [rows] = await pool.execute(sql, params);
    res.json(rows.map(r => ({
      mes: r.mes,
      orcamentos: parseFloat(r.orcamentos) || 0,
      pedidos: parseFloat(r.pedidos) || 0
    })));
  } catch (err) {
    console.error('Erro /dados_compras_orcamentos:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= PDF =================
// Colunas do PDF; sem valores, Descrição e Observação ocupam o espaço de Unitário e Total.
function colunasPdf(verValores, W = 1) {
  if (!verValores) {
    return [
      { label: 'Item',       w: W * 0.07, align: 'center' },
      { label: 'Qtd',        w: W * 0.07, align: 'center' },
      { label: 'Descrição',  w: W * 0.55, align: 'left'  },
      { label: 'Observação', w: W * 0.31, align: 'left'  }
    ];
  }
  return [
    { label: 'Item',       w: W * 0.07, align: 'center' },
    { label: 'Qtd',        w: W * 0.07, align: 'center' },
    { label: 'Descrição',  w: W * 0.46, align: 'left'  },
    { label: 'Observação', w: W * 0.22, align: 'left'  },
    { label: 'Unitário',   w: W * 0.09, align: 'right' },
    { label: 'Total',      w: W * 0.09, align: 'right' }
  ];
}
registro.rota('get', '/dados_pdf', ['pedidos.pdf'], async (req, res) => {
  const { numero, tipo } = req.query;
  if (!numero || !tipo) return res.status(400).json({ error: 'Informe numero e tipo' });
  try {
    const [cabs] = await pool.execute(
      `SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL,
              SUB_TOTAL, TOTAL, DESCONTO
       FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    if (cabs.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    const cab = cabs[0];
    // só abre PDF de cliente dentro dos estados do usuário (mesma regra das listas)
    if ((req.acesso.estados || []).length) {
      const [est] = await pool.execute(
        'SELECT ESTADO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [cab.RAZAO_SOCIAL]);
      if (foraDosEstados(req, res, est[0]?.ESTADO)) return;
    }
    const verValores = podeVerValores(req);
    const [itens] = await pool.execute(
      `SELECT * FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
    const [v4] = await pool.execute(
      `SELECT * FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
    const [serr] = await pool.execute(
      `SELECT * FROM ped_orc_serralheria WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [comps] = await pool.execute(
      `SELECT * FROM ped_orc_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [compSerr] = await pool.execute(
      `SELECT * FROM ped_orc_serralheria_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [furos] = await pool.execute(
      `SELECT * FROM furacao_pedidos_orcamentos WHERE NUMERO = ? AND TIPO = ? ORDER BY id`, [numero, tipo]);

    const agrupar = (rows, col) => {
      const m = {};
      rows.forEach(r => { const k = String(r[col] ?? '').trim(); if (k) (m[k] = m[k] || []).push(r); });
      return m;
    };
    const v4Por = agrupar(v4, 'ITEM_PEDIDO');
    const serrPor = agrupar(serr, 'ITEM_PEDIDO');
    const compPor = agrupar(comps, 'ITEM_PEDIDO');
    const compSerrPor = agrupar(compSerr, 'ITEM_PEDIDO');
    const furosPor = agrupar(furos, 'ITEM');
    const fmtD = v => v ? new Date(v).toLocaleDateString('pt-BR') : '-';
    const fmtM = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="${numero}_${String(cab.RAZAO_SOCIAL).replace(/[^\w ]/g, '').trim()}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 15 });
    doc.pipe(res);
    const M = doc.page.margins.left;
    const W = doc.page.width - M - doc.page.margins.right;

    // CABEÇALHO
    doc.font('Helvetica-Bold').fontSize(10)
       .text('Elegance Indústria e Comércio de Artefatos de Alumínio LTDA/Me', M, doc.y, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(8)
       .text('Tel: (27) 3326-7213  |  elegance@elegancealuminio.com.br', M, doc.y, { width: W, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(14)
       .text(`${tipo} n°: ${numero}`, M, doc.y, { width: W, align: 'center' });
    doc.moveDown(0.8);

    // DADOS DO CLIENTE
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text(`Cliente: ${cab.RAZAO_SOCIAL}`, M, doc.y, { width: W });
    doc.text(`Cliente Final: ${cab.CLIENTE_FINAL || '-'}`, M, doc.y, { width: W });
    doc.font('Helvetica').fontSize(9);
    doc.text(`Data do ${tipo.toLowerCase()}: ${fmtD(cab.DATA)}          Pronto em: ${fmtD(cab.DATA_PRONTO)}`, M, doc.y, { width: W });
    if (tipo !== 'Pedido') {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(9)
         .text('Este orçamento tem validade de 10 dias úteis a partir da data discriminada acima', M, doc.y, { width: W });
    }
    doc.moveDown(0.6);

    // DESCRITIVO
    function descritivo(itemID, tipoProduto) {
      const linhas = [];
      if (v4Por[itemID]) v4Por[itemID].forEach(d => {
        linhas.push('— ' + (d.TIPO_PRODUTO || tipoProduto || 'Produto'));
        linhas.push('Perfil: ' + (d.PERFIL || '') + ' ' + (d.ACABAMENTO_PERFIL || '') +
          ((d.COR_PERFIL || '') ? ' | Cor: ' + d.COR_PERFIL : ''));
        if (d.PUXADOR && d.QTD_PUXADOR) {
          linhas.push('Puxador: ' + d.QTD_PUXADOR + ' - ' + d.PUXADOR + ' ' + (d.ACABAMENTO_PUXADOR || ''));
          linhas.push('Posição: ' + (d.POSICAO_PUXADOR || '') + ' | Tamanho: ' + (d.TAM_PUXADOR || '') + ' mm');
        }
        if (d.REVESTIMENTO) linhas.push('Revestimento: ' + d.REVESTIMENTO + ((d.COR_REVESTIMENTO) ? ' (' + d.COR_REVESTIMENTO + ')' : ''));
        if (d.PORTA) linhas.push(d.PORTA + ': H = ' + (d.ALTURA || '') + ' x L = ' + (d.LARGURA || '') + ' mm');
      });
      if (serrPor[itemID]) serrPor[itemID].forEach(m => {
        linhas.push('— ' + (m.PRODUTO || 'Metalon'));
        linhas.push('Material: ' + (m.MATERIAL || '') + ' | Acabamento: ' + (m.ACABAMENTO || '') + ' | Cor: ' + (m.COR || ''));
        linhas.push('H=' + (m.ALTURA || '') + ' x L=' + (m.LARGURA || '') + ' x P=' + (m.PROFUNDIDADE || ''));
      });
      if (compPor[itemID]) {
        linhas.push('Complementos:');
        compPor[itemID].forEach(c => linhas.push((c.QTD || '') + ' - ' + (c.COMPLEMENTO || '')));
      }
      if (compSerrPor[itemID]) {
        linhas.push('Complementos:');
        compSerrPor[itemID].forEach(c => linhas.push((c.QUANTIDADE || '') + ' - ' + (c.DESCRICAO || '')));
      }
      if (furosPor[itemID]) linhas.push('Furos: ' + furosPor[itemID].length + ' furos');
      return linhas.filter(l => l && l.trim() !== '');
    }

    // TABELA COM GRADE
    const cols = colunasPdf(verValores, W);
    const fontCel = 7.5, PAD = 4;
    function drawHeader(y0) {
      doc.rect(M, y0, W, 16).stroke();
      let x = M;
      cols.forEach(c => {
        doc.font('Helvetica-Bold').fontSize(8)
           .text(c.label, x + 2, y0 + 4, { width: c.w - 4, align: c.align, lineBreak: false });
        x += c.w;
      });
      return y0 + 16;
    }
    let y = doc.y + 8;
    y = drawHeader(y);
    itens.forEach(i => {
      const itemID = String(i.ITEM || '').trim();
      const descLinhas = descritivo(itemID, String(i.TIPO_PRODUTO || ''));
      const descTexto = descLinhas.join('\n') || '-';
      const obsTexto = String(i.OBSERVACAO || '-');
      doc.font('Helvetica').fontSize(fontCel);
      const hDesc = doc.heightOfString(descTexto, { width: cols[2].w - 6 });
      const hObs  = doc.heightOfString(obsTexto,  { width: cols[3].w - 6 });
      const rowH  = Math.max(hDesc, hObs, 14) + PAD * 2;
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawHeader(y);
      }
      let x = M;
      doc.text(String(itemID), x + 2, y + PAD, { width: cols[0].w - 4, align: 'center', height: rowH, ellipsis: true }); x += cols[0].w;
      doc.text(String(i.QTD || ''), x + 2, y + PAD, { width: cols[1].w - 4, align: 'center', height: rowH, ellipsis: true }); x += cols[1].w;
      doc.text(descTexto, x + 2, y + PAD, { width: cols[2].w - 4, height: rowH, ellipsis: true }); x += cols[2].w;
      doc.text(obsTexto, x + 2, y + PAD, { width: cols[3].w - 4, height: rowH, ellipsis: true }); x += cols[3].w;
      if (verValores) {
        doc.text(fmtM(i.UNITARIO), x + 2, y + PAD, { width: cols[4].w - 4, align: 'right', height: rowH, ellipsis: true }); x += cols[4].w;
        doc.text(fmtM(i.TOTAL), x + 2, y + PAD, { width: cols[5].w - 4, align: 'right', height: rowH, ellipsis: true });
      }
      doc.moveTo(M, y).lineTo(M + W, y).stroke();
      let gx = M;
      cols.forEach(c => { doc.moveTo(gx, y).lineTo(gx, y + rowH).stroke(); gx += c.w; });
      y += rowH;
    });
    doc.moveTo(M, y).lineTo(M + W, y).stroke();
    doc.y = y;

    // OBSERVAÇÃO GERAL
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(9).text('Observação:', M, doc.y, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(String(cab.OBS_GERAL || ''), M, doc.y, { width: W });

    // TOTAIS (só para quem vê valores — sem eles o PDF sai no formato da Guia de Produção)
    if (verValores) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`Subtotal: ${fmtM(cab.SUB_TOTAL)}`, { width: W, align: 'right' });
      doc.text(`Desconto: ${(parseFloat(cab.DESCONTO) || 0).toFixed(2)} %`, { width: W, align: 'right' });
      doc.text(`TOTAL: ${fmtM(cab.TOTAL)}`, { width: W, align: 'right' });
    }
    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= ADMIN: definir/trocar senha =================
registro.publica('post', '/admin/definir_senha', async (req, res) => {
  const chave = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const { username, novaSenha } = req.body;
  if (!username || !novaSenha || novaSenha.length < 8) {
    return res.status(400).json({ error: 'Usuário obrigatório e senha com no mínimo 8 caracteres' });
  }
  try {
    const hash = await bcrypt.hash(novaSenha, 12);
    const [r] = await pool.execute(
      'UPDATE cliente_usuarios SET SENHA = ? WHERE NOME = ?', [hash, username]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ success: true, message: 'Senha atualizada com hash bcrypt' });
  } catch (err) {
    console.error('Erro /admin/definir_senha:', err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// ================= MIGRAÇÃO DE SENHAS =================
// Converte para bcrypt as senhas ainda em texto puro (ex.: usuário criado pelo VB).
// POST com a chave no cabeçalho x-admin-key — nunca na URL.
registro.publica('post', '/migrar_senhas', async (req, res) => {
  const chave = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  try {
    const [rows] = await pool.execute('SELECT CODIGO, SENHA FROM cliente_usuarios');
    let convertidos = 0, jaHash = 0;
    for (const r of rows) {
      if (!String(r.SENHA || '').startsWith('$2')) {
        const hash = await bcrypt.hash(String(r.SENHA), 12);
        await pool.execute('UPDATE cliente_usuarios SET SENHA = ? WHERE CODIGO = ?', [hash, r.CODIGO]);
        convertidos++;
      } else {
        jaHash++;
      }
    }
    res.json({ success: true, convertidos, jaHash, total: rows.length });
  } catch (err) {
    console.error('Erro /migrar_senhas:', err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// ================= CATÁLOGOS PARA COMBOS DO ORÇAMENTO =================
const TABELAS_CATALOGO = {
  perfis:        ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Perfil'"],
  puxadores:     ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Puxador'"],
  revestimentos: ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Revestimento'"],
  // ✅ sistemas vem da tabela PRÓPRIA, como o VB lê (RepositorioProdutos.vb)
  sistemas:      ['sistema_correr', 'NOME', ''],
  divisores:     ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Divisor'"],
  materiais_serr: ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Perfil AC'"],
  acabamentos:   ['acabamentos',          'ACABAMENTO', "WHERE SITUACAO = 'Ativo'"],
  produtos_serr: ['serralheria_produtos', 'nome_modelo', 'WHERE ativo = 1'],
  cores:         ['cores', 'NOME_COR', '']
};
registro.rota('get', '/catalogos', ['orcamentos.criar'], async (req, res) => {
  const saida = {};
  for (const [chave, [tabela, coluna, where]] of Object.entries(TABELAS_CATALOGO)) {
    try {
      const [rows] = await pool.execute(
        `SELECT DISTINCT ${coluna} AS nome FROM ${tabela} ${where || ''} ORDER BY ${coluna}`);
      saida[chave] = rows.map(r => r.nome).filter(n => n);
    } catch (e) {
      saida[chave] = []; // tabela ausente → combo vazio, página continua
    }
  }
  res.json(saida);
});

// MOTOR FINANCEIRO — calculo/precos.js (o cadastro chega pelo leitor)
const leitorCadastro = criarLeitor(pool);
const buscarDadosProduto = nome => leitorCadastro.produto(nome);

registro.rota('post', '/calcular_preco', ['orcamentos.criar', 'valores.ver'], async (req, res) => {
  const b = req.body || {};
  try {
    const cliente = await lerCliente(pool, { clienteCodigo: b.clienteCodigo, cliente: b.cliente });
    // portas: acessórios somam ao item (frmPortasAbrir: base = portas + acessórios)
    const acessorios = Array.isArray(b.acessorios) && b.frente !== 'Serralheria' && b.frente !== 'Avulso'
      ? b.acessorios.slice(0, 100).filter(a => a && typeof a.nome === 'string').map(a => ({ nome: a.nome, qtd: Math.min(9999, Math.max(1, parseInt(a.qtd) || 1)),
          tamanho: Math.min(100000, Math.max(0, parseFloat(a.tamanho) || 0)),
          origem: a.origem === 'SISTEMA DE CORRER' ? 'SISTEMA DE CORRER' : 'MANUAL' }))
      : [];
    if (acessorios.length) {
      const r = await precoComAcessorios(b, cliente, leitorCadastro, acessorios);
      return res.json({ unitario: r.unitario, total: r.total, acessorios: r.acessorios, ...(b.debug ? { diag: r.diag } : {}) });
    }
    const r = await calcularPrecoItem(b, cliente, leitorCadastro);
    res.json({ unitario: r.unitario, total: r.total, ...(b.debug ? { diag: r.diag } : {}) });
  } catch (err) {
    if (err instanceof ErroPreco) return res.status(400).json({ error: err.message });
    console.error('Erro /calcular_preco:', err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// ============================================================
// CATÁLOGOS EM CASCATA — fiel ao RepositorioProdutos.vb
// ============================================================
const QUERIES_FILTRO = {
  perfis: `SELECT DISTINCT c.MODELO AS nome
           FROM cadastro_de_produtos c
           INNER JOIN perfis_permitidos p ON c.MODELO = p.MODELO
           WHERE c.SITUACAO = 'Ativo' AND p.TIPO_PRODUTO = ?
           ORDER BY c.MODELO`,
  acabamentos: `SELECT a.ACABAMENTO AS nome
                FROM acabamentos a
                INNER JOIN acabamentos_permitidos p ON a.ACABAMENTO = p.ACABAMENTO
                WHERE p.MODELO = ?
                ORDER BY a.ACABAMENTO`,
  puxadores: `SELECT c.MODELO AS nome
              FROM cadastro_de_produtos c
              INNER JOIN puxadores_permitidos p ON c.MODELO = p.PUXADOR_PERMITIDO
              WHERE p.MODELO = ? AND c.SITUACAO = 'Ativo'
              ORDER BY c.MODELO`,
  revestimentos: `SELECT c.MODELO AS nome
                  FROM cadastro_de_produtos c
                  INNER JOIN revestimentos_permitidos p ON c.MODELO = p.REVESTIMENTO_PERMITIDO
                  WHERE p.MODELO = ? AND c.SITUACAO = 'Ativo'
                  ORDER BY c.MODELO`,
  divisores: `SELECT c.MODELO AS nome
              FROM cadastro_de_produtos c
              INNER JOIN divisores_permitidos p ON c.MODELO = p.DIVISOR
              WHERE p.MODELO = ? AND c.SITUACAO = 'Ativo'
              ORDER BY c.MODELO`,
  materiais: `SELECT DISTINCT c.MODELO AS nome
              FROM cadastro_de_produtos c
              INNER JOIN modelos_permitidos_serralheria p ON c.MODELO = p.MODELO
              WHERE c.SITUACAO = 'Ativo' AND p.PRODUTO = ?
              ORDER BY c.MODELO`
};

// ✅ Resolve a família da frente por SEMELHANÇA (imune à grafia: giro/Abrir/Giro...)
function resolverAliasesFrente(chave) {
  const c = String(chave || '').toLowerCase();
  if (c.includes('correr')) return ['Porta de Correr', 'Porta de correr', 'Correr'];
  if (c.includes('bascul')) return ['Porta basculante', 'Porta Basculante', 'Basculante'];
  if (c.includes('gaveta')) return ['Frente de gaveta', 'Frente de Gaveta', 'Gaveta'];
  // giro / abrir / qualquer outra porta → mesma família
  return ['Porta de giro', 'Porta de Giro', 'Porta de Abrir', 'Porta de abrir', 'Giro', 'Abrir'];
}

// Itens de venda avulsa (frmServicos): categoria do pedido → CLASSE do cadastro_de_produtos
const CLASSES_AVULSO = {
  'Perfil': ['Perfil', 'Perfil Composto'],
  'Puxador': ['Puxador'],
  'Revestimento': ['Revestimento'],
  'Trilhos': ['Trilhos'],
  'Serviço': ['Serviço', 'Serviços', 'Servico', 'Servicos'],
  'Acessório': ['Acessórios', 'Acessório']
};
registro.rota('get', '/catalogos_filtro', ['orcamentos.criar'], async (req, res) => {
  const { campo, chave } = req.query;
  if (campo === 'avulsos') {
    const classes = CLASSES_AVULSO[chave];
    if (!classes) return res.status(400).json({ error: 'Categoria inválida' });
    try {
      const [rows] = await pool.execute(
        `SELECT DISTINCT MODELO AS nome FROM cadastro_de_produtos
         WHERE SITUACAO = 'Ativo' AND CLASSE IN (${classes.map(() => '?').join(',')}) ORDER BY MODELO`, classes);
      return res.json(rows.map(r => r.nome).filter(n => n));
    } catch (err) {
      console.error('Erro /catalogos_filtro (avulsos):', err.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }
  const sql = QUERIES_FILTRO[campo];
  if (!sql) return res.status(400).json({ error: 'Campo inválido' });
  try {
    let params = [chave || ''];
    let sqlFinal = sql;
    if (campo === 'perfis') {
      const aliases = resolverAliasesFrente(chave);
      sqlFinal = sql.replace('p.TIPO_PRODUTO = ?', `p.TIPO_PRODUTO IN (${aliases.map(() => '?').join(',')})`);
      params = aliases;
    }
    const [rows] = await pool.execute(sqlFinal, params);
    const lista = rows.map(r => r.nome).filter(n => n);
    // ✅ SEM FALLBACK: filtragem estrita. Lista vazia = problema de dados (visível)
    if (lista.length === 0 && campo === 'perfis') {
      console.warn(`PERFIS: nenhum perfil para '${chave}' — verifique TIPO_PRODUTO em perfis_permitidos.`);
    }
    res.json(lista);
  } catch (err) {
    console.error(`Erro /catalogos_filtro (${campo}):`, err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// Tipo nativo do puxador (repo.BuscarDadosProduto → TipoPuxador) — sem expor preços
registro.rota('get', '/dados_produto', ['orcamentos.criar'], async (req, res) => {
  try {
    const dados = await buscarDadosProduto(String(req.query.nome || ''));
    if (!dados) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ tipoPuxador: dados.tipoPuxador });
  } catch (err) {
    console.error('Erro /dados_produto:', err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// Cores agrupadas pela coluna TIPO (Sólida / Metálica)
registro.rota('get', '/cores_por_tipo', ['orcamentos.criar'], async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT NOME_COR, TIPO FROM cores ORDER BY NOME_COR');
    const grupos = {};
    rows.forEach(r => {
      const tipo = String(r.TIPO || '').trim() || 'Sem tipo';
      (grupos[tipo] = grupos[tipo] || []).push(r.NOME_COR);
    });
    res.json(grupos);
  } catch (err) {
    console.error('Erro /cores_por_tipo:', err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// ============================================================
// ESTOQUE — fiel ao frm_Estoque.vb (somente equipe interna)
// ============================================================
const numEstq = v => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const t = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return 0;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return isFinite(n) ? n : 0;
};
const txtEstq = (v, max = 255) => String(v ?? '').trim().slice(0, max);

// Carregar_Estoque + cmb_Filtro: busca por CODIGO/NOME (LIKE) ou por CLASSE
registro.rota('get', '/estoque', ['estoque.ver'], async (req, res) => {
  try {
    const busca = txtEstq(req.query.busca, 100);
    const classe = txtEstq(req.query.classe, 100);
    const where = [], params = [];
    if (classe) { where.push('CLASSE = ?'); params.push(classe); }
    if (busca) { where.push('(CAST(CODIGO AS CHAR) LIKE ? OR NOME_PRODUTO LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`); }
    const [rows] = await pool.execute(
      `SELECT CODIGO, NOME_PRODUTO, NOME_PRODUTO_FORNECEDOR, QTD_ESTOQUE, AGUARDANDO, MIN_ESTOQUE, SITUACAO, CLASSE, UNIDADE
       FROM estoque ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY SITUACAO ASC, NOME_PRODUTO ASC`, params);
    res.json(rows.map(r => ({
      codigo: r.CODIGO, produto: r.NOME_PRODUTO, prodFornecedor: r.NOME_PRODUTO_FORNECEDOR,
      qtd: numEstq(r.QTD_ESTOQUE), aguardando: r.AGUARDANDO ?? '', minimo: numEstq(r.MIN_ESTOQUE),
      situacao: r.SITUACAO, classe: r.CLASSE, unidade: r.UNIDADE
    })));
  } catch (err) {
    console.error('Erro /estoque:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Combos (classes/unidades/fornecedores já usados) + Contar_Valor_Estoque + contadores
registro.rota('get', '/estoque/resumo', ['estoque.ver'], async (req, res) => {
  try {
    const [[tot]] = await pool.execute(
      `SELECT SUM(CASE WHEN CLASSE = 'Revestimento' THEN (TAMANHO * VALOR * QTD_ESTOQUE) ELSE (VALOR * QTD_ESTOQUE) END) AS total,
              SUM(SITUACAO = 'Ativo') AS ativos,
              SUM(SITUACAO = 'Ativo' AND QTD_ESTOQUE <= 0) AS falta,
              SUM(SITUACAO = 'Ativo' AND QTD_ESTOQUE > 0 AND MIN_ESTOQUE > 0 AND QTD_ESTOQUE <= MIN_ESTOQUE) AS minimo
       FROM estoque`);
    const distintos = async col => {
      const [r] = await pool.execute(`SELECT DISTINCT ${col} AS v FROM estoque WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`);
      return r.map(x => x.v);
    };
    res.json(semValores(req, {
      valorTotal: numEstq(tot.total), ativos: Number(tot.ativos) || 0,
      falta: Number(tot.falta) || 0, minimo: Number(tot.minimo) || 0,
      classes: await distintos('CLASSE'), unidades: await distintos('UNIDADE'), fornecedores: await distintos('FORNECEDOR')
    }, ['valorTotal']));
  } catch (err) {
    console.error('Erro /estoque/resumo:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// txt_codigo_TextChanged: ficha completa do produto
registro.rota('get', '/estoque/item/:codigo', ['estoque.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM estoque WHERE CODIGO = ? LIMIT 1', [req.params.codigo]);
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    const r = rows[0];
    res.json(semValores(req, {
      codigo: r.CODIGO, codBarras: r.CODIGO_BARRA ?? '', fornecedor: r.FORNECEDOR ?? '', codFornecedor: r.COD_FORNECEDOR ?? '',
      prodFornecedor: r.NOME_PRODUTO_FORNECEDOR ?? '', produto: r.NOME_PRODUTO ?? '', classe: r.CLASSE ?? '',
      unidade: r.UNIDADE ?? '', situacao: r.SITUACAO ?? '', qtd: numEstq(r.QTD_ESTOQUE), minimo: numEstq(r.MIN_ESTOQUE),
      frete: numEstq(r.FRETE), ipi: numEstq(r.IPI), perda: numEstq(r.PERDA), valor: numEstq(r.VALOR),
      altura: numEstq(r.ALTURA), largura: numEstq(r.LARGURA), tamanho: numEstq(r.TAMANHO),
      aguardando: r.AGUARDANDO ?? '', observacao: r.OBSERVACAO ?? ''
    }, ['valor', 'frete', 'ipi']));
  } catch (err) {
    console.error('Erro /estoque/item:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Salvar_Estoque: mesmas validações do VB; INSERT se o código não existe, senão UPDATE
registro.rota('post', '/estoque/salvar', ['estoque.editar'], preservarDoBanco({
  sql: 'SELECT VALOR, FRETE, IPI FROM estoque WHERE CODIGO = ? LIMIT 1',
  chave: b => parseInt(b.codigo, 10) || 0,
  mapa: { valor: 'VALOR', frete: 'FRETE', ipi: 'IPI' },
  mensagemNovo: 'Cadastrar item novo exige permissão de valores.'
}), async (req, res) => {
  const b = req.body || {};
  const d = {
    codBarras: txtEstq(b.codBarras, 20), fornecedor: txtEstq(b.fornecedor), codFornecedor: txtEstq(b.codFornecedor, 100),
    prodFornecedor: txtEstq(b.prodFornecedor), produto: String(b.produto ?? '').trim(), classe: txtEstq(b.classe, 100),
    unidade: txtEstq(b.unidade, 50), situacao: b.situacao === 'Inativo' ? 'Inativo' : 'Ativo',
    qtd: numEstq(b.qtd), minimo: numEstq(b.minimo), frete: numEstq(b.frete), ipi: numEstq(b.ipi), perda: numEstq(b.perda),
    valor: numEstq(b.valor), altura: numEstq(b.altura), largura: numEstq(b.largura), tamanho: numEstq(b.tamanho),
    observacao: txtEstq(b.observacao, 2000)
  };
  const erro = msg => res.status(400).json({ error: msg });
  if (d.produto.length < 1 || d.produto.length > 255) return erro('O nome do produto precisa conter no mínimo 1 e no máximo 255 caracteres !');
  if (!d.codBarras) return erro('Este produto está sem código de barras!');
  if (d.fornecedor && !d.prodFornecedor) return erro('Você deve fornecer um nome do produto do fornecedor!');
  if (!d.classe) return erro('Você deve inserir uma classe para este produto!');
  if (!d.unidade) return erro('Você deve inserir um tipo de unidade para este produto!');
  if (!(d.valor > 0)) return erro('O valor do produto precisa ser maior que 0!');
  try {
    const codigo = parseInt(b.codigo, 10) || 0;
    const [existe] = codigo ? await pool.execute('SELECT CODIGO FROM estoque WHERE CODIGO = ? LIMIT 1', [codigo]) : [[]];
    const [dup] = await pool.execute('SELECT CODIGO FROM estoque WHERE NOME_PRODUTO = ? AND CODIGO <> ? LIMIT 1', [d.produto, existe.length ? codigo : 0]);
    if (dup.length) return erro('Este nome de produto já existe!');
    const valores = [d.codBarras, d.fornecedor, d.codFornecedor, d.prodFornecedor, d.produto, d.classe, d.unidade, d.situacao,
      d.qtd, d.minimo, d.frete, d.ipi, d.perda, d.valor, d.altura, d.largura, d.tamanho, d.observacao];
    if (existe.length) {
      await pool.execute(
        `UPDATE estoque SET CODIGO_BARRA=?, FORNECEDOR=?, COD_FORNECEDOR=?, NOME_PRODUTO_FORNECEDOR=?, NOME_PRODUTO=?, CLASSE=?,
         UNIDADE=?, SITUACAO=?, QTD_ESTOQUE=?, MIN_ESTOQUE=?, FRETE=?, IPI=?, PERDA=?, VALOR=?, ALTURA=?, LARGURA=?, TAMANHO=?, OBSERVACAO=?
         WHERE CODIGO = ?`, [...valores, codigo]);
      return res.json({ ok: true, codigo, acao: 'atualizado', mensagem: 'O registro foi atualizado com sucesso !' });
    }
    const [r] = await pool.execute(
      `INSERT INTO estoque (CODIGO_BARRA, FORNECEDOR, COD_FORNECEDOR, NOME_PRODUTO_FORNECEDOR, NOME_PRODUTO, CLASSE, UNIDADE, SITUACAO,
       QTD_ESTOQUE, MIN_ESTOQUE, FRETE, IPI, PERDA, VALOR, ALTURA, LARGURA, TAMANHO, AGUARDANDO, OBSERVACAO)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',?)`, valores);
    res.json({ ok: true, codigo: r.insertId, acao: 'inserido', mensagem: 'O registro foi inserido com sucesso !' });
  } catch (err) {
    console.error('Erro /estoque/salvar:', err.message);
    res.status(500).json({ error: 'Ocorreu um erro ao salvar o produto!' });
  }
});

// Gerar_Codigo_Barras: mantém o EAN-13 do produto ou gera um novo, único na tabela
function digitoEAN13(doze) {
  const soma = [...doze].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return String((10 - (soma % 10)) % 10);
}
registro.rota('post', '/estoque/codigo_barras', ['estoque.editar'], async (req, res) => {
  try {
    const atual = txtEstq(req.body?.atual, 20);
    const produto = txtEstq(req.body?.produto);
    if (/^\d{13}$/.test(atual) && produto) {
      const [r] = await pool.execute('SELECT CODIGO FROM estoque WHERE CODIGO_BARRA = ? AND NOME_PRODUTO = ? LIMIT 1', [atual, produto]);
      if (r.length) return res.json({ jaPossui: true, codigo: atual, mensagem: 'Este produto já possui um código de barras' });
    }
    for (let i = 0; i < 20; i++) {
      const doze = '789' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      const ean = doze + digitoEAN13(doze);
      const [r] = await pool.execute('SELECT CODIGO FROM estoque WHERE CODIGO_BARRA = ? LIMIT 1', [ean]);
      if (!r.length) return res.json({ jaPossui: false, codigo: ean });
    }
    res.status(500).json({ error: 'Não foi possível gerar um código de barras único.' });
  } catch (err) {
    console.error('Erro /estoque/codigo_barras:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// BackgroundWorker2: entradas x saídas dos últimos 12 meses + médias dos meses com movimento
registro.rota('get', '/estoque/movimentacao', ['estoque.ver'], async (req, res) => {
  const produto = txtEstq(req.query.produto);
  if (!produto) return res.json([]);
  const porMes = async tabela => {
    try {
      const [r] = await pool.execute(
        `SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes, SUM(QTD) AS qtd FROM ${tabela}
         WHERE NOME_PRODUTO = ? AND DATA >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
         GROUP BY DATE_FORMAT(DATA, '%Y-%m')`, [produto]);
      return Object.fromEntries(r.map(x => [x.mes, numEstq(x.qtd)]));
    } catch { return {}; }
  };
  const [ent, sai] = await Promise.all([porMes('entrada_estoque'), porMes('saida_estoque')]);
  const hoje = new Date();
  const meses = [];
  for (let x = -11; x <= 0; x++) {
    const m = new Date(hoje.getFullYear(), hoje.getMonth() + x, 1);
    const chave = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    meses.push({ mes: chave, entrada: ent[chave] || 0, saida: sai[chave] || 0 });
  }
  res.json(meses);
});

// ============================================================
// CADASTRO DE PRODUTOS (venda) — fiel ao frm_Cadastro_Produtos.vb
// ============================================================
// Carrega_Treenodes: classes → produtos (exceto situação 'Consulta') + próximo código
registro.rota('get', '/produtos', ['produtos.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT CODIGO, MODELO, CLASSE, SITUACAO FROM cadastro_de_produtos
       WHERE SITUACAO <> 'Consulta' OR SITUACAO IS NULL ORDER BY CLASSE, MODELO`);
    const [[mx]] = await pool.execute('SELECT MAX(CODIGO) AS m FROM cadastro_de_produtos');
    res.json({
      proximoCodigo: (parseInt(mx.m, 10) || 0) + 1,
      produtos: rows.map(r => ({ codigo: r.CODIGO, modelo: r.MODELO, classe: r.CLASSE || '', situacao: r.SITUACAO || '' }))
    });
  } catch (err) {
    console.error('Erro /produtos:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Combos: classes existentes, classes de acabamento e acessórios (complementos)
registro.rota('get', '/produtos/opcoes', ['produtos.ver'], async (req, res) => {
  const lista = async sql => { try { const [r] = await pool.execute(sql); return r.map(x => x.v).filter(Boolean); } catch { return []; } };
  res.json({
    classes: await lista('SELECT DISTINCT CLASSE AS v FROM cadastro_de_produtos ORDER BY CLASSE'),
    classesAcabamento: await lista('SELECT DISTINCT CLASSE AS v FROM acabamentos ORDER BY CLASSE ASC'),
    complementos: await lista("SELECT MODELO AS v FROM cadastro_de_produtos WHERE CLASSE = 'Acessórios' ORDER BY MODELO")
  });
});

// txt_Codigo_TextChanged: ficha do produto + o que ele tem permitido
registro.rota('get', '/produtos/item/:codigo', ['produtos.ver'], async (req, res) => {
  try {
    // SELECT * como no VB: colunas ausentes na tabela não derrubam a ficha
    const [rows] = await pool.execute('SELECT * FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [req.params.codigo]);
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
    const r = rows[0];
    const modelo = r.MODELO || '';
    const permitidos = async sql => { try { const [x] = await pool.execute(sql, [modelo]); return x.map(y => y.v).filter(Boolean); } catch { return []; } };
    res.json(semValores(req, {
      codigo: r.CODIGO, modelo, classe: r.CLASSE || '', tipoPuxador: r.TIPO_PUXADOR || '',
      descontoVidro: numEstq(r.DESCONTO_VIDRO), descPerfPux: numEstq(r.DESC_PERF_PUX),
      valorCheio: numEstq(r.VALOR_CHEIO), valorFixo: numEstq(r.VALOR_FIXO),
      observacao: r.OBSERVACAO || '', complementos: r.COMPLEMENTOS || '', classeAcabamento: r.CLASSE_ACABAMENTOS || '',
      situacao: r.SITUACAO || '', temImagem: r.IMAGEM != null && r.IMAGEM.length > 0,
      permitidos: {
        tiposProduto: await permitidos('SELECT TIPO_PRODUTO AS v FROM perfis_permitidos WHERE MODELO = ? ORDER BY TIPO_PRODUTO'),
        acabamentos: await permitidos('SELECT ACABAMENTO AS v FROM acabamentos_permitidos WHERE MODELO = ? ORDER BY ACABAMENTO'),
        puxadores: await permitidos('SELECT PUXADOR_PERMITIDO AS v FROM puxadores_permitidos WHERE MODELO = ? ORDER BY PUXADOR_PERMITIDO'),
        revestimentos: await permitidos('SELECT REVESTIMENTO_PERMITIDO AS v FROM revestimentos_permitidos WHERE MODELO = ? ORDER BY REVESTIMENTO_PERMITIDO'),
        divisores: await permitidos('SELECT DIVISOR AS v FROM divisores_permitidos WHERE MODELO = ? ORDER BY DIVISOR')
      }
    }, ['valorCheio', 'valorFixo']));
  } catch (err) {
    console.error('Erro /produtos/item:', err.code, err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// Imagem do produto (coluna IMAGEM, a mesma que o VB lê)
registro.rota('get', '/produtos/imagem/:codigo', ['produtos.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT IMAGEM FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1', [req.params.codigo]);
    if (!rows.length || !rows[0].IMAGEM) return res.status(404).json({ error: 'Sem imagem' });
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store').send(rows[0].IMAGEM);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return res.status(404).json({ error: 'Sem imagem' });
    console.error('Erro /produtos/imagem:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
registro.rota('put', '/produtos/imagem/:codigo', ['produtos.editar'], express.raw({ type: ['image/jpeg', 'image/png'], limit: '3mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Imagem inválida' });
  try {
    const [r] = await pool.execute('UPDATE cadastro_de_produtos SET IMAGEM = ? WHERE CODIGO = ?', [req.body, req.params.codigo]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Salve o produto antes de enviar a imagem.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro PUT /produtos/imagem:', err.message);
    if (err.code === 'ER_BAD_FIELD_ERROR') return res.status(400).json({ error: 'A tabela cadastro_de_produtos não tem a coluna IMAGEM.' });
    res.status(500).json({ error: 'Erro ao salvar a imagem' });
  }
});

// Salvar_Registro: mesmas validações; INSERT (sempre Ativo) ou UPDATE pela existência do CODIGO
registro.rota('post', '/produtos/salvar', ['produtos.editar'], preservarDoBanco({
  sql: 'SELECT VALOR_CHEIO, VALOR_FIXO FROM cadastro_de_produtos WHERE CODIGO = ? LIMIT 1',
  chave: b => String(b.codigo ?? '').trim(),
  mapa: { valorCheio: 'VALOR_CHEIO', valorFixo: 'VALOR_FIXO' },
  mensagemNovo: 'Cadastrar produto novo exige permissão de valores.'
}), async (req, res) => {
  const b = req.body || {};
  const erro = msg => res.status(400).json({ error: msg });
  const codigo = String(b.codigo ?? '').trim();
  const modelo = String(b.modelo ?? '').trim();
  const classe = txtEstq(b.classe, 100);
  const tipoPuxador = txtEstq(b.tipoPuxador, 50);
  const classeAcabamento = txtEstq(b.classeAcabamento, 100);
  const vazioParaNull = v => (v ? v : null);
  if (!/^\d+$/.test(codigo)) return erro('Favor inserir o CÓDIGO do produto');
  if (!modelo) return erro('Favor inserir o MODELO do produto');
  if (modelo.length > 255) return erro('Dados muito longos para o campo. Reduza o tamanho do texto.');
  if (classe === 'Puxador' && !tipoPuxador) return erro('Favor escolher o tipo de puxador !');
  if (!classeAcabamento) return erro('Favor inserir a CLASSE do ACABAMENTO');
  if (String(b.valorCheio ?? '').trim() === '') return erro('Favor inserir o VALOR CHEIO do produto');
  if (String(b.valorFixo ?? '').trim() === '') return erro('Favor inserir o VALOR FIXO do produto');
  const valorCheio = numEstq(b.valorCheio), valorFixo = numEstq(b.valorFixo);
  const campos = [modelo, valorCheio, valorFixo, numEstq(b.descontoVidro), vazioParaNull(tipoPuxador), vazioParaNull(classe),
    numEstq(b.descPerfPux)];
  const obs = vazioParaNull(txtEstq(b.observacao, 2000));
  const compl = vazioParaNull(txtEstq(b.complementos));
  let con;
  try {
    con = await pool.getConnection();
    await con.beginTransaction();
    const [ex] = await con.execute('SELECT COUNT(*) AS n FROM cadastro_de_produtos WHERE CODIGO = ?', [codigo]);
    const existe = Number(ex[0].n) > 0;
    if (existe) {
      const situacao = b.situacao === 'Ativo' ? 'Ativo' : 'Inativo';
      await con.execute(
        `UPDATE cadastro_de_produtos SET MODELO = ?, VALOR_CHEIO = ?, VALOR_FIXO = ?, DESCONTO_VIDRO = ?, TIPO_PUXADOR = ?,
         CLASSE = ?, DESC_PERF_PUX = ?, SITUACAO = ?, OBSERVACAO = ?, COMPLEMENTOS = ?, CLASSE_ACABAMENTOS = ? WHERE CODIGO = ?`,
        [...campos, situacao, obs, compl, classeAcabamento, codigo]);
    } else {
      await con.execute(
        `INSERT INTO cadastro_de_produtos (CODIGO, MODELO, VALOR_CHEIO, VALOR_FIXO, DESCONTO_VIDRO, TIPO_PUXADOR, CLASSE,
         DESC_PERF_PUX, SITUACAO, OBSERVACAO, COMPLEMENTOS, CLASSE_ACABAMENTOS) VALUES (?,?,?,?,?,?,?,?,'Ativo',?,?,?)`,
        [codigo, ...campos, obs, compl, classeAcabamento]);
    }
    await con.commit();
    res.json({ ok: true, codigo: Number(codigo), mensagem: existe ? 'Registro atualizado com sucesso!' : 'Registro inserido com sucesso!' });
  } catch (err) {
    if (con) await con.rollback().catch(() => {});
    console.error('Erro /produtos/salvar:', err.message);
    const msgs = {
      ER_DUP_ENTRY: 'Código já existe no sistema!',
      ER_NO_REFERENCED_ROW_2: 'Erro de integridade referencial. Verifique os dados relacionados.',
      ER_DATA_TOO_LONG: 'Dados muito longos para o campo. Reduza o tamanho do texto.',
      ER_BAD_FIELD_ERROR: 'Erro na estrutura da tabela. Contate o suporte técnico.'
    };
    res.status(msgs[err.code] ? 400 : 500).json({ error: msgs[err.code] || 'Erro inesperado ao salvar o produto.' });
  } finally {
    if (con) con.release();
  }
});

// ============================================================
// FINANCEIRO — FLUXO DE CAIXA (fiel ao frm_Fluxo_Caixa.vb)
// ============================================================
const SITUACOES_FLUXO = ['Recebido', 'A Receber', 'Pago', 'A Pagar', 'Faturado', 'Protestado', 'Atrasado'];
const COLUNAS_FLUXO = `ID, DATE_FORMAT(DATA, '%Y-%m-%d') AS DATA, RAZAO_SOCIAL, RAZAO_FABRICANTE, PEDIDO, PDV, PRE_NOTA_FISCAL,
  NOTA_FISCAL, FORMA_PGTO, BANCO, SITUACAO, VALOR, OBSERVACAO_GERAL, COD_CLASSIFICACAO`;
const linhaFluxo = r => ({
  id: r.ID, data: r.DATA, cliente: r.RAZAO_SOCIAL || '', fornecedor: r.RAZAO_FABRICANTE || '', pedido: r.PEDIDO ?? '',
  pdv: r.PDV ?? '', preNota: r.PRE_NOTA_FISCAL ?? '', notaFiscal: r.NOTA_FISCAL ?? '', formaPgto: r.FORMA_PGTO || '',
  banco: r.BANCO || '', situacao: r.SITUACAO || '', valor: numEstq(r.VALOR), observacao: r.OBSERVACAO_GERAL || '',
  codClassificacao: r.COD_CLASSIFICACAO == null ? null : Number(r.COD_CLASSIFICACAO)
});
function limitesMes(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  const hoje = new Date();
  const ano = m ? +m[1] : hoje.getFullYear(), mes = m ? +m[2] : hoje.getMonth() + 1;
  const ultimo = new Date(ano, mes, 0).getDate();
  const p2 = n => String(n).padStart(2, '0');
  return [`${ano}-${p2(mes)}-01`, `${ano}-${p2(mes)}-${p2(ultimo)}`];
}

// Carregar_Dados (cmb_pesquisa), meses anterior/próximo, filtro por situação e pesquisa
registro.rota('get', '/fluxo', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  try {
    const modo = String(req.query.modo || 'mes');
    const where = [], params = [];
    const [ini, fim] = limitesMes(req.query.mes);
    const busca = txtEstq(req.query.busca, 100);
    const situacao = txtEstq(req.query.situacao, 50);
    if (parseInt(req.query.id, 10) > 0) {
      where.push('ID = ?'); params.push(parseInt(req.query.id, 10));   // abrir um registro específico
    } else if (busca) {
      const campos = ['PEDIDO', 'PDV', 'PRE_NOTA_FISCAL', 'NOTA_FISCAL', 'VALOR', 'BANCO', 'SITUACAO', 'RAZAO_FABRICANTE',
                      'RAZAO_SOCIAL', 'FORMA_PGTO', 'OBSERVACAO_GERAL'];
      where.push('(' + campos.map(c => `CAST(${c} AS CHAR) LIKE ?`).join(' OR ') + ')');
      campos.forEach(() => params.push(`%${busca}%`));
    } else if (modo === 'todos') {
      // sem filtro
    } else if (['recebido', 'a_receber', 'pago', 'a_pagar'].includes(modo)) {
      where.push('SITUACAO = ?');
      params.push({ recebido: 'Recebido', a_receber: 'A receber', pago: 'Pago', a_pagar: 'A pagar' }[modo]);
    } else if (modo === 'hoje') {
      where.push('DATA = CURDATE()');
    } else if (modo === 'atrasados') {
      where.push("(SITUACAO = 'Atrasado' OR SITUACAO = 'Protestado')");
    } else {
      where.push('DATA BETWEEN ? AND ?');
      params.push(ini, fim);
      if (situacao) { where.push('SITUACAO = ?'); params.push(situacao); }
    }
    const [rows] = await pool.execute(
      `SELECT ${COLUNAS_FLUXO} FROM fluxo_de_caixa ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY DATA DESC, ID DESC`, params);
    res.json(rows.map(linhaFluxo));
  } catch (err) {
    console.error('Erro /fluxo:', err.message);
    res.status(500).json({ error: 'Erro ao carregar o fluxo de caixa' });
  }
});

// Carregar_Resumo_Mes (mês atual) — mesmas somas do VB
registro.rota('get', '/fluxo/resumo', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  try {
    const [[r]] = await pool.execute(`SELECT
      SUM(IF(MONTH(DATA)=MONTH(NOW()) AND YEAR(DATA)=YEAR(NOW()) AND SITUACAO='Pago', VALOR, 0)) AS pago,
      SUM(IF(MONTH(DATA)=MONTH(NOW()) AND YEAR(DATA)=YEAR(NOW()) AND SITUACAO='Recebido', VALOR, 0)) AS recebido,
      SUM(IF(MONTH(DATA)=MONTH(NOW()) AND YEAR(DATA)=YEAR(NOW()) AND SITUACAO='A pagar', VALOR, 0)) AS a_pagar,
      SUM(IF(MONTH(DATA)=MONTH(NOW()) AND YEAR(DATA)=YEAR(NOW()) AND SITUACAO='A receber', VALOR, 0)) AS a_receber,
      SUM(IF(DATA < CURDATE() AND SITUACAO='A receber', VALOR, 0)) AS atrasado,
      -- recebimentos já marcados como Atrasado/Protestado (entradas: tem cliente e não tem fornecedor)
      SUM(IF(SITUACAO IN ('Atrasado', 'Protestado') AND COALESCE(RAZAO_SOCIAL, '') <> ''
             AND COALESCE(RAZAO_FABRICANTE, '') = '', VALOR, 0)) AS marcados_atrasado
      FROM fluxo_de_caixa`);
    const v = k => numEstq(r[k]);
    // saldo idêntico ao VB: desconta só o "a receber" vencido, que já estava somado em a_receber
    const saldo = v('recebido') + v('a_receber') - v('atrasado') - v('pago') - v('a_pagar');
    res.json({
      pago: v('pago'), recebido: v('recebido'), aPagar: v('a_pagar'), aReceber: v('a_receber'),
      atrasado: v('atrasado') + v('marcados_atrasado'),
      aReceberVencido: v('atrasado'), marcadosAtrasado: v('marcados_atrasado'), saldo
    });
  } catch (err) {
    console.error('Erro /fluxo/resumo:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Combos: situações existentes, formas de pagamento, bancos, clientes, fornecedores e próximo ID
registro.rota('get', '/fluxo/opcoes', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  const lista = async sql => { try { const [r] = await pool.execute(sql); return r.map(x => x.v).filter(Boolean); } catch { return []; } };
  const [[mx]] = await pool.execute('SELECT MAX(ID) AS m FROM fluxo_de_caixa').catch(() => [[{ m: 0 }]]);
  res.json({
    proximoId: (parseInt(mx.m, 10) || 0) + 1,
    situacoes: await lista('SELECT DISTINCT SITUACAO AS v FROM fluxo_de_caixa ORDER BY SITUACAO ASC'),
    formas: await lista("SELECT DISTINCT FORMA_PGTO AS v FROM fluxo_de_caixa WHERE FORMA_PGTO <> '' ORDER BY FORMA_PGTO"),
    bancos: await lista("SELECT DISTINCT BANCO AS v FROM fluxo_de_caixa WHERE BANCO <> '' ORDER BY BANCO"),
    clientes: await lista('SELECT RAZAO_SOCIAL AS v FROM cadastro_clientes ORDER BY RAZAO_SOCIAL'),
    fornecedores: await lista(`SELECT RAZAO_FABRICANTE AS v FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE <> ''
                               UNION SELECT DISTINCT RAZAO_FABRICANTE FROM fluxo_de_caixa WHERE RAZAO_FABRICANTE <> '' ORDER BY v`)
  });
});

// Árvore de categorias (fluxo_de_caixa_classificacao: TIPO > CLASSE1 > CLASSE2 > CLASSE3)
registro.rota('get', '/fluxo/classificacoes', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, TIPO, CLASSE1, CLASSE2, CLASSE3 FROM fluxo_de_caixa_classificacao ORDER BY TIPO, CLASSE1, CLASSE2, CLASSE3');
    res.json(rows.map(r => ({ id: Number(r.id), tipo: r.TIPO || '', classe1: r.CLASSE1 || '', classe2: r.CLASSE2 || '', classe3: r.CLASSE3 || '' })));
  } catch (err) {
    console.error('Erro /fluxo/classificacoes:', err.message);
    res.status(500).json({ error: 'Erro ao carregar as categorias' });
  }
});

// BuscarClassificacaoFornecedor / BuscarClassificacaoCliente
// fornecedor com CF_CV → categoria travada nela; cliente cadastrado → categoria 1; senão o usuário escolhe
registro.rota('get', '/fluxo/classificacao_sugerida', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  const nome = txtEstq(req.query.nome);
  if (!nome) return res.json({ id: null, travado: false });
  try {
    if (req.query.movimento === 'Saída') {
      const [r] = await pool.execute('SELECT CF_CV FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = ? LIMIT 1', [nome]);
      const v = r.length ? String(r[0].CF_CV ?? '').trim() : '';
      return res.json(v && Number(v) > 0 ? { id: Number(v), travado: true } : { id: null, travado: false });
    }
    const [r] = await pool.execute('SELECT CODIGO FROM cadastro_clientes WHERE RAZAO_SOCIAL = ? LIMIT 1', [nome]);
    res.json(r.length ? { id: 1, travado: true } : { id: null, travado: false });
  } catch (err) {
    console.error('Erro /fluxo/classificacao_sugerida:', err.message);
    res.status(500).json({ error: 'Erro ao buscar CF_CV' });
  }
});

// Maiores gastos do mês: saídas (com fornecedor) agrupadas por fornecedor ou por categoria
registro.rota('get', '/fluxo/gastos', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  try {
    const [ini, fim] = limitesMes(req.query.mes);
    const porCategoria = req.query.agrupar === 'categoria';
    const rotulo = porCategoria
      ? "COALESCE(NULLIF(CONCAT_WS(' › ', NULLIF(c.CLASSE2, ''), NULLIF(c.CLASSE3, '')), ''), 'Sem categoria')"
      : 'f.RAZAO_FABRICANTE';
    const [rows] = await pool.execute(
      `SELECT ${rotulo} AS nome, SUM(f.VALOR) AS total, COUNT(*) AS qtd,
              SUM(IF(f.SITUACAO = 'Pago', f.VALOR, 0)) AS pago
       FROM fluxo_de_caixa f
       ${porCategoria ? 'LEFT JOIN fluxo_de_caixa_classificacao c ON c.id = f.COD_CLASSIFICACAO' : ''}
       WHERE f.DATA BETWEEN ? AND ? AND COALESCE(f.RAZAO_FABRICANTE, '') <> ''
       GROUP BY nome ORDER BY total DESC`, [ini, fim]);
    const itens = rows.map(r => ({ nome: r.nome || '—', total: numEstq(r.total), qtd: Number(r.qtd) || 0, pago: numEstq(r.pago) }));
    res.json({ total: itens.reduce((s, i) => s + i.total, 0), itens });
  } catch (err) {
    console.error('Erro /fluxo/gastos:', err.message);
    res.status(500).json({ error: 'Erro ao calcular os gastos do mês' });
  }
});

// Histórico: recebido x pago dos últimos 12 meses
registro.rota('get', '/fluxo/historico', ['financeiro.ver', 'valores.ver'], async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT DATE_FORMAT(DATA, '%Y-%m') AS mes,
        SUM(IF(SITUACAO = 'Recebido', VALOR, 0)) AS entrada, SUM(IF(SITUACAO = 'Pago', VALOR, 0)) AS saida
      FROM fluxo_de_caixa WHERE DATA >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
      GROUP BY DATE_FORMAT(DATA, '%Y-%m')`);
    const porMes = Object.fromEntries(rows.map(r => [r.mes, r]));
    const hoje = new Date(), saida = [];
    for (let x = -11; x <= 0; x++) {
      const m = new Date(hoje.getFullYear(), hoje.getMonth() + x, 1);
      const k = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      saida.push({ mes: k, entrada: numEstq(porMes[k]?.entrada), saida: numEstq(porMes[k]?.saida) });
    }
    res.json(saida);
  } catch (err) {
    console.error('Erro /fluxo/historico:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// SalvarToolStripMenuItem_Click: mesmas validações; INSERT ... ON DUPLICATE KEY UPDATE pelo ID
registro.rota('post', '/fluxo/salvar', ['financeiro.lancar', 'valores.ver'], async (req, res) => {
  const b = req.body || {};
  const erro = msg => res.status(400).json({ error: msg });
  const formaPgto = txtEstq(b.formaPgto, 100);
  if (!formaPgto) return erro('Favor escolher uma forma de pagamento!');
  const data = String(b.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(new Date(data + 'T00:00:00'))) return erro('Favor inserir uma data válida!');
  const valor = numEstq(b.valor);
  if (valor === 0) return erro('Favor inserir um valor!');
  const situacao = txtEstq(b.situacao, 50);
  if (!situacao) return erro('Favor escolher a situação desse registro!');
  const classificacao = parseInt(b.codClassificacao, 10);
  if (!(classificacao > 0)) return erro('Favor escolher uma categoria!');
  const nome = txtEstq(b.nome) || null;
  const fabricante = b.movimento === 'Saída' ? nome : null;
  const social = b.movimento === 'Entrada' ? nome : null;
  try {
    let id = parseInt(b.id, 10) || 0;
    if (!id) {
      const [[mx]] = await pool.execute('SELECT MAX(ID) AS m FROM fluxo_de_caixa');
      id = (parseInt(mx.m, 10) || 0) + 1;   // Contar_Registros
    }
    await pool.execute(
      `INSERT INTO fluxo_de_caixa (ID, DATA, RAZAO_FABRICANTE, RAZAO_SOCIAL, PEDIDO, PDV, PRE_NOTA_FISCAL, NOTA_FISCAL, FORMA_PGTO,
         BANCO, SITUACAO, VALOR, OBSERVACAO_GERAL, COD_CLASSIFICACAO)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE DATA=VALUES(DATA), RAZAO_FABRICANTE=VALUES(RAZAO_FABRICANTE), RAZAO_SOCIAL=VALUES(RAZAO_SOCIAL),
         PEDIDO=VALUES(PEDIDO), PDV=VALUES(PDV), PRE_NOTA_FISCAL=VALUES(PRE_NOTA_FISCAL), NOTA_FISCAL=VALUES(NOTA_FISCAL),
         FORMA_PGTO=VALUES(FORMA_PGTO), BANCO=VALUES(BANCO), SITUACAO=VALUES(SITUACAO), VALOR=VALUES(VALOR),
         OBSERVACAO_GERAL=VALUES(OBSERVACAO_GERAL), COD_CLASSIFICACAO=VALUES(COD_CLASSIFICACAO)`,
      [id, data, fabricante, social, txtEstq(b.pedido, 50), txtEstq(b.pdv, 50), txtEstq(b.preNota, 50), txtEstq(b.notaFiscal, 50),
       formaPgto, txtEstq(b.banco, 100), situacao, valor, txtEstq(b.observacao, 2000), classificacao]);
    res.json({ ok: true, id, mensagem: 'Registro salvo com sucesso!' });
  } catch (err) {
    console.error('Erro /fluxo/salvar:', err.message);
    res.status(500).json({ error: 'Erro ao salvar no fluxo de caixa.' });
  }
});

// Menu "Alterar para ..." — aceita vários registros de uma vez
registro.rota('post', '/fluxo/situacao', ['financeiro.lancar', 'valores.ver'], async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(n => parseInt(n, 10)).filter(n => n > 0).slice(0, 500);
  const situacao = String(req.body?.situacao || '');
  if (!ids.length) return res.status(400).json({ error: 'Favor escolher um item para ser alterado!' });
  if (!SITUACOES_FLUXO.includes(situacao)) return res.status(400).json({ error: 'Situação inválida' });
  try {
    const [r] = await pool.execute(`UPDATE fluxo_de_caixa SET SITUACAO = ? WHERE ID IN (${ids.map(() => '?').join(',')})`, [situacao, ...ids]);
    res.json({ ok: true, alterados: r.affectedRows });
  } catch (err) {
    console.error('Erro /fluxo/situacao:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

registro.rota('delete', '/fluxo/:id', ['financeiro.excluir', 'valores.ver'], async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM fluxo_de_caixa WHERE ID = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro DELETE /fluxo:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= ADMINISTRAÇÃO DE USUÁRIOS E PERMISSÕES =================
registrarAdmin({ rota: registro.rota, pool, acesso, bcrypt });
registrarEstoqueMovimentos({ rota: registro.rota, pool });
registrarPedOrc({ rota: registro.rota, pool });
registrarEstoqueAnalises({ rota: registro.rota, pool });

// ================= SUBIDA =================
// Ordem: tabelas web_ → migração única dos usuários → todas as rotas precisam
// estar no registro (senão o servidor não sobe) → escutar a porta.
async function iniciar() {
  await instalarTabelas(pool);
  const m = await migrarAcessos(pool, { adminInicial: process.env.WEB_ADMIN_INICIAL || '' });
  if (!m.jaFeita) console.log(`[permissões] migração inicial: ${m.criados} usuário(s) receberam perfil`);
  if ((await acrescentarPermissoesEstoque(pool)).feito) console.log('[permissões] estoque.desfazer e estoque.ajustar acrescentadas aos perfis completos');
  if ((await acrescentarPermissoesPedOrc(pool)).feito) console.log('[permissões] orcamentos.salvar e pedidos.criar acrescentadas');
  await garantirAdministrador(pool, { adminInicial: process.env.WEB_ADMIN_INICIAL || '' });
  registro.verificar();
  app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
}

if (require.main === module) {
  iniciar().catch(err => {
    console.error('FATAL na subida:', err.message);
    process.exit(1);
  });
}

module.exports = { app, pool, acesso, registro, colunasPdf };