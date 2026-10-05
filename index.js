const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= VALIDAÇÃO DE AMBIENTE =================
const JWT_SECRET = process.env.JWT_SECRET;
const OBRIGATORIAS = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
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

// ================= JWT =================
function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.CODIGO, nome: usuario.NOME, cargo: usuario.CARGO },
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'elegance-api' }
  );
}
function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET, { issuer: 'elegance-api' });
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}
// Cargo do TOKEN decide o filtro — o navegador não manda nada
function ehRepresentante(req) {
  return String(req.user.cargo || '').toLowerCase().includes('representante');
}

// ================= LOGIN =================
app.post('/login', loginLimiter, async (req, res) => {
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
    console.error('Erro no login:', err.message);
    res.status(500).json({ success: false, message: 'Erro de servidor.' });
  }
});

// ================= VERIFICAÇÃO DE SESSÃO =================
app.get('/auth/verify', autenticar, (req, res) => {
  res.json({ valid: true, user: { nome: req.user.nome, cargo: req.user.cargo } });
});

// ================= LISTA ÚNICA (Pedido ou Orçamento) =================
app.get('/dados_lista', autenticar, async (req, res) => {
  try {
    const tipo = req.query.tipo === 'Orçamento' ? 'Orçamento' : 'Pedido';
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

// Mantidos por compatibilidade
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

// ================= CLIENTES =================
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

// ================= GRÁFICO: ORÇAMENTOS x PEDIDOS =================
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

// ================= PDF =================
app.get('/dados_pdf', autenticar, async (req, res) => {
  const { numero, tipo } = req.query;
  if (!numero || !tipo) return res.status(400).json({ error: 'Informe numero e tipo' });
  try {
    const [cabs] = await pool.execute(
      `SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL,
              SUB_TOTAL, TOTAL, DESCONTO
       FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    if (cabs.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    const cab = cabs[0];
    const [itens] = await pool.execute(
      `SELECT * FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
    const [v4] = await pool.execute(
      `SELECT * FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [serr] = await pool.execute(
      `SELECT * FROM ped_orc_serralheria WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [comps] = await pool.execute(
      `SELECT * FROM ped_orc_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [compSerr] = await pool.execute(
      `SELECT * FROM ped_orc_serralheria_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [furos] = await pool.execute(
      `SELECT * FROM furacao_pedidos_orcamentos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);

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
    const cols = [
      { label: 'Item',       w: W * 0.07, align: 'center' },
      { label: 'Qtd',        w: W * 0.07, align: 'center' },
      { label: 'Descrição',  w: W * 0.46, align: 'left'  },
      { label: 'Observação', w: W * 0.22, align: 'left'  },
      { label: 'Unitário',   w: W * 0.09, align: 'right' },
      { label: 'Total',      w: W * 0.09, align: 'right' }
    ];
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
      doc.text(fmtM(i.UNITARIO), x + 2, y + PAD, { width: cols[4].w - 4, align: 'right', height: rowH, ellipsis: true }); x += cols[4].w;
      doc.text(fmtM(i.TOTAL), x + 2, y + PAD, { width: cols[5].w - 4, align: 'right', height: rowH, ellipsis: true });
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

    // TOTAIS
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Subtotal: ${fmtM(cab.SUB_TOTAL)}`, { width: W, align: 'right' });
    doc.text(`Desconto: ${(parseFloat(cab.DESCONTO) || 0).toFixed(2)} %`, { width: W, align: 'right' });
    doc.text(`TOTAL: ${fmtM(cab.TOTAL)}`, { width: W, align: 'right' });
    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  }
});

// ================= ADMIN: definir/trocar senha =================
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

// ================= MIGRAÇÃO DE SENHAS (rodar UMA VEZ, depois remover) =================
// Corrigido: tabela usa CODIGO (não ID) — colunas: CODIGO, NOME, CARGO, SENHA, SITUACAO...
app.get('/migrar_senhas', async (req, res) => {
  const chave = req.query.key;
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
// ✅ Nomes confirmados no dump + valores reais de CLASSE
const TABELAS_CATALOGO = {
  // FRENTES DE PORTAS (alumínio)
  perfis:        ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Perfil'"],
  puxadores:     ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Puxador'"],
  revestimentos: ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Revestimento'"],
  sistemas:      ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Sistema de correr'"],
  divisores:     ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Divisor'"],
  // FRENTE SERRALHERIA (Perfil AC = aço carbono)
  materiais_serr: ['cadastro_de_produtos', 'MODELO', "WHERE SITUACAO = 'Ativo' AND CLASSE = 'Perfil AC'"],
  // GERAIS
  acabamentos:   ['acabamentos',          'ACABAMENTO', "WHERE SITUACAO = 'Ativo'"],
  produtos_serr: ['serralheria_produtos', 'nome_modelo', 'WHERE ativo = 1'],
  cores:         ['cores', 'NOME_COR', '']
};
app.get('/catalogos', autenticar, async (req, res) => {
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

// ============================================================
// MOTOR FINANCEIRO — PORTAS + SERRALHERIA (fiel ao VB)
// ✅ VERSÃO ÚNICA (removeu o bloco antigo duplicado com
//    COLUNAS_PROD errado — causa do ER_BAD_FIELD_ERROR)
// Colunas confirmadas no VB: VALOR_CHEIO, VALOR_FIXO,
// DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX
// ============================================================
async function buscarDadosProduto(nome) {
  if (!nome) return null;
  const [rows] = await pool.execute(
    `SELECT CODIGO, MODELO, VALOR_CHEIO, VALOR_FIXO, DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX
     FROM cadastro_de_produtos WHERE TRIM(MODELO) = TRIM(?) AND SITUACAO = 'Ativo' LIMIT 1`, [nome]);
  if (!rows.length) return null;
  return {
    valorFixo: parseFloat(rows[0].VALOR_FIXO) || 0,
    valorCheio: parseFloat(rows[0].VALOR_CHEIO) || 0,
    descontoVidro: parseFloat(rows[0].DESCONTO_VIDRO) || 0,
    descontoPerfilPux: parseFloat(rows[0].DESC_PERF_PUX) || 0,
    tipoPuxador: String(rows[0].TIPO_PUXADOR || '')
  };
}

async function taxaAcabamento(nome) {
  if (!nome) return 0;
  try {
    const [rows] = await pool.execute(
      'SELECT VALOR FROM acabamentos WHERE TRIM(ACABAMENTO) = TRIM(?) LIMIT 1', [nome]);
    return rows.length ? (parseFloat(rows[0].VALOR) || 0) : 0;
  } catch { return 0; }
}

// auxiliares
const precoBase = (d, isFixo) => isFixo ? d.valorFixo : d.valorCheio;
const comAcab = (base, taxa) => base + base * (taxa / 100);
const alturaS = b => parseFloat(b.altura) || 0;
const largS = b => parseFloat(b.largura) || 0;
const profS = b => parseFloat(b.profundidade) || 0;

function aplicarPercentuais(valor, texto) {
  let v = valor;
  for (const parte of String(texto || '').split(';')) {
    let t = parte.trim(); if (!t) continue;
    let sinal = '+', num = t;
    if (t.startsWith('+') || t.startsWith('-')) { sinal = t[0]; num = t.slice(1); }
    const pct = parseFloat(num.replace(/%/g, '').replace(',', '.'));
    if (!isNaN(pct)) v = sinal === '+' ? v * (1 + pct / 100) : v * (1 - pct / 100);
  }
  return v;
}

function atualizarTotalItem() {
    const u = parseFloat(document.getElementById('f-valor').value.replace(',', '.')) || 0;
    const q = parseFloat(document.getElementById('f-qtd').value) || 1;
    document.getElementById('f-total-item').value = (u * q).toFixed(2).replace('.', ',');
}

app.post('/calcular_preco', autenticar, async (req, res) => {
  const b = req.body || {};
  try {
    // Política comercial do cliente — por CODIGO (preciso) com fallback por nome
    let cli = [];
    if (b.clienteCodigo) {
      [cli] = await pool.execute(
        'SELECT TIPO_DESCONTO, DESCONTO FROM cadastro_clientes WHERE CODIGO = ? LIMIT 1',
        [b.clienteCodigo]);
    } else if (b.cliente) {
      [cli] = await pool.execute(
        'SELECT TIPO_DESCONTO, DESCONTO FROM cadastro_clientes WHERE TRIM(RAZAO_SOCIAL) = TRIM(?) LIMIT 1',
        [b.cliente]);
    }
    const isFixo = String(cli[0]?.TIPO_DESCONTO || '').toUpperCase().includes('FIXO');
    const descontoCliente = cli.length ? (parseFloat(cli[0].DESCONTO) || 0) : 0;

    let subtotal = 0; // base ANTES do desconto do cliente
    let diag = { clienteEncontrado: cli.length > 0, isFixo, descontoCliente };

    // ============ FRENTE SERRALHERIA (MotorPrecificacaoSerralheria.vb) ============
    if (b.frente === 'Serralheria') {
      const [prod] = await pool.execute(
        'SELECT COALESCE(fixo,0) AS fixo FROM serralheria_produtos WHERE TRIM(nome_modelo) = TRIM(?) LIMIT 1',
        [b.produto || '']);
      const valorFixoProduto = prod.length ? (parseFloat(prod[0].fixo) || 0) : 0;

      const dadosMat = await buscarDadosProduto(b.material);
      if (!dadosMat) return res.status(400).json({ error: `Material '${b.material}' não encontrado ou sem preços.` });

      // Metragem: (A/1000 × qtdA) + (L/1000 × qtdL) + (P/1000 × qtdP) — qtds padrão 1
      const qtdA = parseFloat(b.qtdAltura) > 0 ? parseFloat(b.qtdAltura) : 1;
      const qtdL = parseFloat(b.qtdLargura) > 0 ? parseFloat(b.qtdLargura) : 1;
      const qtdP = parseFloat(b.qtdProfundidade) > 0 ? parseFloat(b.qtdProfundidade) : 1;
      const metragem = (alturaS(b) / 1000) * qtdA + (largS(b) / 1000) * qtdL + (profS(b) / 1000) * qtdP;

      const material = metragem * precoBase(dadosMat, isFixo);
      subtotal += material;

      // Solda: produto "Solda" no cadastro (VALOR_FIXO, senão VALOR_CHEIO)
      try {
        const [sol] = await pool.execute(
          `SELECT COALESCE(NULLIF(VALOR_FIXO,0), NULLIF(VALOR_CHEIO,0), 0) AS v
           FROM cadastro_de_produtos WHERE TRIM(MODELO) = 'Solda' LIMIT 1`);
        const soldas = parseFloat(b.soldas) || 0;
        subtotal += (parseFloat(sol[0]?.v) || 0) * soldas;
      } catch { /* Solda sem cadastro → 0 */ }

      // Acabamento % sobre o material
      const pctAcab = await taxaAcabamento(b.acabamento);
      subtotal += material * (pctAcab / 100);

      // Complementos (qtd × valor unitário)
      (Array.isArray(b.complementos) ? b.complementos : []).forEach(c => {
        subtotal += (parseFloat(c.qtd) || 0) * (parseFloat(c.valorUnit) || 0);
      });

      subtotal += valorFixoProduto; // fixo do produto entra na base

      const qtd = parseFloat(b.qtd) > 0 ? parseFloat(b.qtd) : 1;
      let final = subtotal * qtd;
      if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
      final = aplicarPercentuais(final, b.percentuais);

      diag.serralheria = { metragem, precoM: Math.round(material / (metragem || 1) * 100) / 100, valorFixoProduto };
      return res.json({
        unitario: Math.round((final / qtd) * 100) / 100,
        total: Math.round(final * 100) / 100,
        ...(b.debug ? { diag } : {})
      });
    }

    // ============ FRENTE PORTAS (MotorFinanceiro.CalcularValorVendaPorta) ============
    const altura = parseFloat(b.altura) || 0;
    const largura = parseFloat(b.largura) || 0;

    const dadosPerfil = await buscarDadosProduto(b.perfil);
    if (!dadosPerfil) return res.status(400).json({ error: `Perfil '${b.perfil}' não encontrado ou sem preços.` });
    const dadosPux = b.puxador ? await buscarDadosProduto(b.puxador) : null;
    const dadosRev = b.revestimento ? await buscarDadosProduto(b.revestimento) : null;
    const dadosDiv = b.divisor ? await buscarDadosProduto(b.divisor) : null;

    const taxaPerfil = await taxaAcabamento(b.acabPerfil);
    const taxaPux = dadosPux ? await taxaAcabamento(b.acabPuxador) : 0;
    const taxaRev = dadosRev ? await taxaAcabamento(b.acabRevest) : 0;

    const temPux = !!dadosPux;
    const posPux = String(b.posicaoPuxador || '').toUpperCase();
    const tipoPux = String(dadosPux?.tipoPuxador || b.tipoPuxador || '').toUpperCase(); // TIPO_PUXADOR do banco
    const qtdPux = posPux ? posPux.split(',').filter(p => p.trim()).length : 0;
    const isSobreposto = tipoPux.includes('SOBREPOSTO');
    const isEmbutido = tipoPux.includes('EMBUTIDO');
    const isTotal = tipoPux.includes('TOTAL') || posPux.includes('TOTAL');

    // 1. PERFIL (puxador Total desconta o lado dele)
    const ladoPux = (posPux.includes('TOPO') || posPux.includes('BASE')) ? largura : altura;
    const ladoOp  = (posPux.includes('TOPO') || posPux.includes('BASE')) ? altura : largura;
    const perimetro = (temPux && isTotal && !isSobreposto && !isEmbutido)
      ? 2 * ladoOp + ladoPux * Math.max(0, 2 - qtdPux)
      : 2 * altura + 2 * largura;
    const precoMPerfil = comAcab(precoBase(dadosPerfil, isFixo), taxaPerfil);
    subtotal += (perimetro / 1000) * precoMPerfil;

    // 2. PUXADOR (mínimo R$ 20/un — fiel ao VB)
    if (dadosPux) {
      const compUnit = isTotal ? ladoPux : (parseFloat(b.tamanhoPuxador) || 0);
      const custo = (compUnit * qtdPux / 1000) * comAcab(precoBase(dadosPux, isFixo), taxaPux);
      subtotal += Math.max(20 * qtdPux, custo);
    }

    // 3. DIVISORES
    let compDiv = 0;
    if (dadosDiv) {
      const largV = Math.max(0, largura - dadosPerfil.descontoVidro);
      const altV  = Math.max(0, altura - dadosPerfil.descontoVidro);
      compDiv = (parseInt(b.qtdDivH) || 0) * largV + (parseInt(b.qtdDivV) || 0) * altV;
      subtotal += (compDiv / 1000) * comAcab(precoBase(dadosDiv, isFixo), taxaPerfil);
    }

    // 4. REVESTIMENTO (área líquida, com dedução do divisor)
    if (dadosRev) {
      let descX = dadosPerfil.descontoVidro, descY = dadosPerfil.descontoVidro;
      if (temPux && isSobreposto) {
        if (posPux.includes('TOPO') || posPux.includes('BASE')) descY += dadosPerfil.descontoPerfilPux * qtdPux;
        else descX += dadosPerfil.descontoPerfilPux * qtdPux;
      }
      const area = Math.max(0, (Math.max(0, altura - descY) / 1000) * (Math.max(0, largura - descX) / 1000));
      const areaDiv = (compDiv / 1000) * 0.015;
      subtotal += Math.max(0, area - areaDiv) * comAcab(precoBase(dadosRev, isFixo), taxaRev);
    }

    // 5. Desconto do cliente + percentuais da linha
    let final = subtotal;
    if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
    final = aplicarPercentuais(final, b.percentuais);

    const qtd = parseFloat(b.qtd) > 0 ? parseFloat(b.qtd) : 1;
    diag.perfil = {
      fixo: dadosPerfil.valorFixo, cheio: dadosPerfil.valorCheio,
      taxaAcab: taxaPerfil, precoM: Math.round(precoMPerfil * 100) / 100
    };
    diag.perimetroMm = perimetro;

    res.json({
      unitario: Math.round(final * 100) / 100,
      total: Math.round(final * qtd * 100) / 100,
      ...(b.debug ? { diag } : {})
    });
  } catch (err) {
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

// Nomes do FRONT → valores reais da base (ajuste após rodar o SELECT DISTINCT)
const ALIAS_FRENTE = {
  'Porta de Abrir':  ['Porta de Abrir', 'Porta de abrir', 'Porta de Giro', 'Porta de giro', 'Giro', 'Abrir'],
  'Porta de Correr': ['Porta de Correr', 'Porta de correr', 'Correr']
};

app.get('/catalogos_filtro', autenticar, async (req, res) => {
  const { campo, chave } = req.query;
  const sql = QUERIES_FILTRO[campo];
  if (!sql) return res.status(400).json({ error: 'Campo inválido' });
  try {
    let params = [chave || ''];
    let sqlFinal = sql;
    // Perfis: busca por TODOS os aliases da frente (resolve "Abrir" vs "giro")
    if (campo === 'perfis') {
      const aliases = ALIAS_FRENTE[chave] || [chave];
      sqlFinal = sql.replace('p.TIPO_PRODUTO = ?', `p.TIPO_PRODUTO IN (${aliases.map(() => '?').join(',')})`);
      params = aliases;
    }
    const [rows] = await pool.execute(sqlFinal, params);
    let lista = rows.map(r => r.nome).filter(n => n);
    // FALLBACK: coluna TIPO_PRODUTO vazia na base → não deixa o vendedor travado
    if (lista.length === 0 && campo === 'perfis') {
      console.warn(`PERFIS: nenhum perfil classificado para '${chave}' — usando fallback (todos os perfis ativos). Popule TIPO_PRODUTO em perfis_permitidos.`);
      const [todos] = await pool.execute(
        `SELECT MODELO AS nome FROM cadastro_de_produtos
         WHERE SITUACAO = 'Ativo' AND CLASSE = 'Perfil' ORDER BY MODELO`);
      lista = todos.map(r => r.nome);
    }
    res.json(lista);
  } catch (err) {
    console.error(`Erro /catalogos_filtro (${campo}):`, err.message);
    res.status(500).json({ error: 'Erro de servidor', detalhe: err.code || err.message });
  }
});

// Cores agrupadas pela coluna TIPO (Sólida / Metálica)
app.get('/cores_por_tipo', autenticar, async (req, res) => {
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







app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});