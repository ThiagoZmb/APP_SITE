const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= VALIDAÇÃO DE AMBIENTE (falha rápido se faltar algo) =================
const JWT_SECRET = process.env.JWT_SECRET;
const OBRIGATORIAS = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
const faltando = OBRIGATORIAS.filter(k => !process.env[k]);
if (!JWT_SECRET || faltando.length > 0) {
  console.error('FATAL: variáveis de ambiente ausentes:', [...faltando, ...(JWT_SECRET ? [] : ['JWT_SECRET'])]);
  process.exit(1); // não sobe servidor com configuração incompleta
}

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME
};

// Pool de conexões (mais seguro e rápido que abrir conexão por request)
const pool = mysql.createPool({
  ...dbConfig,
  connectionLimit: 10,
  waitForConnections: true,
  dateStrings: true,   // datas já vêm 'YYYY-MM-DD' — evita bug de fuso
  multipleStatements: false // bloqueia SQL stacking
});

app.use(helmet()); // headers de segurança padrão
app.use(cors({ origin: ['https://thiagozmb.github.io'] }));
app.use(express.json({ limit: '10kb' })); // payload limitado

// ================= RATE LIMIT — trava força bruta =================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // janela de 15 min
  max: 5,                    // 5 tentativas por IP
  message: { success: false, message: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ================= JWT — sessão assinada =================
function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.ID, nome: usuario.NOME, cargo: usuario.CARGO },
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'elegance-api' }
  );
}

// Middleware: exige token válido (header Bearer OU ?token= para PDFs)
function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: 'elegance-api' });
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

// Cargo do TOKEN decide o filtro — o navegador não manda mais nada
function ehRepresentante(req) {
  return String(req.user.cargo || '').toLowerCase().includes('representante');
}

// ================= LOGIN =================
app.post('/login', loginLimiter, async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  // Validação de entrada: tamanho máximo evita abuso; mensagem genérica evita enumeração
  if (!username || !password || username.length > 100 || password.length > 200) {
    return res.status(400).json({ success: false, message: 'Usuário ou senha inválidos.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT ID, NOME, RAZAO_SOCIAL, CARGO, SENHA FROM cliente_usuarios WHERE NOME = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      // Mensagem idêntica nos dois casos (não revela se o usuário existe)
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
    }

    const user = rows[0];
    const senhaOk = await bcrypt.compare(password, user.SENHA);
    if (!senhaOk) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
    }

    res.json({
      success: true,
      token: gerarToken(user),
      user: { nome: user.NOME, empresa: user.RAZAO_SOCIAL, cargo: user.CARGO }
    });
  } catch (err) {
    console.error('Erro no login:', err.message); // log sem detalhes internos
    res.status(500).json({ success: false, message: 'Erro de servidor.' });
  }
});

// ================= VERIFICAÇÃO DE SESSÃO (frontend usa no guard) =================
app.get('/auth/verify', autenticar, (req, res) => {
  res.json({ valid: true, user: { nome: req.user.nome, cargo: req.user.cargo } });
});

// ================= DADOS (todos protegidos) =================
app.get('/dados_lista', autenticar, async (req, res) => {
  try {
    const tipo = req.query.tipo === 'Orçamento' ? 'Orçamento' : 'Pedido';
    // ✅ Autorização no SERVIDOR: representante é FORÇADO a RJ, ignore o que o cliente pedir
    const estado = ehRepresentante(req) ? 'RJ' : (req.query.estado || null);

    const sql = `
      SELECT 
        p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
        DATE_FORMAT(p.DATA, '%d/%m/%Y') as data,
        DATE_FORMAT(p.DATA_PRONTO, '%d/%m/%Y') as prontoEm,
        p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao,
        p.FINANCEIRO as financeiro,
        DATE_FORMAT(p.DATA_ENTREGA, '%d/%m/%Y') as dataEntrega
      FROM ped_orc p
      ${estado ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
      WHERE p.TIPO = ? ${estado ? 'AND c.ESTADO = ?' : ''}
      ORDER BY p.NUMERO DESC`;
    const params = estado ? [tipo, estado] : [tipo];
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Erro /dados_lista:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Mantidos por compatibilidade — agora também protegidos
app.get('/dados_pedidos', autenticar, async (req, res) => {
  try {
    const where = ehRepresentante(req)
      ? `INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL WHERE c.ESTADO = 'RJ' AND p.TIPO='Pedido'`
      : `WHERE p.TIPO='Pedido'`;
    const [rows] = await pool.execute(`
      SELECT p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
             DATE_FORMAT(p.DATA, '%d/%m/%Y') as data, DATE_FORMAT(p.DATA_PRONTO, '%d/%m/%Y') as prontoEm,
             p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao, p.FINANCEIRO as financeiro,
             DATE_FORMAT(p.DATA_ENTREGA, '%d/%m/%Y') as dataEntrega
      FROM ped_orc p ${where} ORDER BY NUMERO DESC`);
    res.json(rows);
  } catch (err) {
    console.error('Erro /dados_pedidos:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

app.get('/dados_pedidos_rj', autenticar, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.NUMERO as numero, p.RAZAO_SOCIAL as cliente, p.CLIENTE_FINAL as clienteFinal,
             DATE_FORMAT(p.DATA, '%d/%m/%Y') as data, DATE_FORMAT(p.DATA_PRONTO, '%d/%m/%Y') as prontoEm,
             p.TOTAL as valor, p.OBS_GERAL as observacao, p.SITUACAO as situacao, p.FINANCEIRO as financeiro,
             DATE_FORMAT(p.DATA_ENTREGA, '%d/%m/%Y') as dataEntrega
      FROM ped_orc p
      INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL
      WHERE c.ESTADO = 'RJ' AND p.TIPO='Pedido' ORDER BY p.DATA DESC`);
    res.json(rows);
  } catch (err) {
    console.error('Erro /dados_pedidos_rj:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

app.get('/dados_clientes', autenticar, async (req, res) => {
  try {
    const estado = ehRepresentante(req) ? 'RJ' : (req.query.estado || null);
    const sql = `
      SELECT CODIGO as codigo, RAZAO_SOCIAL as razaoSocial, FANTASIA as fantasia,
             TIPO as tipo, CNPJ_CPF as cnpjCpf, IE_RG as ieRg,
             CEP as cep, ENDERECO as endereco, NUMERO as numero,
             BAIRRO as bairro, CIDADE as cidade, ESTADO as estado,
             SITUACAO as situacao, CONDICAO as condicao,
             CREDITO as credito, DESCONTO as desconto,
             OBSERVACAO as observacao, CONTATO as contato,
             TELEFONE as telefone, EMAIL as email, REPRESENTANTE as representante
      FROM cadastro_clientes ${estado ? 'WHERE ESTADO = ?' : ''}
      ORDER BY RAZAO_SOCIAL ASC`;
    const [rows] = await pool.execute(sql, estado ? [estado] : []);
    res.json(rows);
  } catch (err) {
    console.error('Erro /dados_clientes:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

app.get('/dados_compras_orcamentos', autenticar, async (req, res) => {
  try {
    const cliente = req.query.cliente;
    const estado = ehRepresentante(req) ? 'RJ' : (req.query.estado || null);
    let filtroExtra = 'WHERE YEAR(p.DATA) = YEAR(CURDATE())';
    let params = [];
    if (cliente && !ehRepresentante(req)) {
      filtroExtra += ' AND p.RAZAO_SOCIAL = ?';
      params.push(cliente);
    } else if (estado) {
      filtroExtra += ' AND c.ESTADO = ?';
      params.push(estado);
    }
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

const PDFDocument = require('pdfkit');
// PDF: aceita token via ?token= (necessário porque window.open não envia headers)
app.get('/dados_pdf', autenticar, async (req, res) => {
  // ... (mantenha EXATAMENTE o corpo atual do seu endpoint PDF — só a assinatura acima muda,
  //      pois agora ele exige token válido antes de desenhar)
});

// ================= ADMIN: definir/trocar senha (protegido por chave, não por login) =================
app.post('/admin/definir_senha', async (req, res) => {
  const chave = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const { username, novaSenha } = req.body;
  if (!username || !novaSenha || novaSenha.length < 8) {
    return res.status(400).json({ error: 'Usuário obrigatório e senha com no mínimo 8 caracteres' });
  }
  try {
    const hash = await bcrypt.hash(novaSenha, 12); // custo 12 = padrão robusto
    const [r] = await pool.execute(
      'UPDATE cliente_usuarios SET SENHA = ? WHERE NOME = ?', [hash, username]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ success: true, message: 'Senha atualizada com hash bcrypt' });
  } catch (err) {
    console.error('Erro /admin/definir_senha:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});