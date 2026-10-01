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
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME
};

const pool = mysql.createPool({
  ...dbConfig,
  connectionLimit: 10,
  waitForConnections: true,
  dateStrings: true,        // datas vêm 'YYYY-MM-DD' — evita bug de fuso
  multipleStatements: false // bloqueia SQL stacking
});

app.use(helmet());
app.use(cors({ origin: ['https://thiagozmb.github.io'] }));
app.use(express.json({ limit: '10kb' }));

// ================= RATE LIMIT — trava força bruta =================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ================= JWT — sessão assinada =================
function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.CODIGO, nome: usuario.NOME, cargo: usuario.CARGO },  // ✅ CODIGO (não ID)
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'elegance-api' }
  );
}

// Middleware: exige token válido (header Bearer OU ?token= para PDFs)
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
    // ✅ CORRIGIDO: CODIGO (a tabela não tem coluna ID)
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

// ================= DADOS: LISTA ÚNICA (Pedido ou Orçamento) =================
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

// Mantidos por compatibilidade — também protegidos
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
// PDF do Pedido/Orçamento — protegido por token (via header OU ?token=)
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

    // TABELA COM GRADE (altura medida — sem sobreposição)
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

// ================= MIGRAÇÃO DE SENHAS (one-time, protegida) =================
app.get('/migrar_senhas', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  try {
    const [rows] = await pool.execute('SELECT CODIGO, SENHA FROM cliente_usuarios');
    let convertidas = 0, jaHash = 0;
    for (const r of rows) {
      const atual = String(r.SENHA || '');
      if (!atual.startsWith('$2')) {
        const hash = await bcrypt.hash(atual, 12);
        await pool.execute('UPDATE cliente_usuarios SET SENHA = ? WHERE CODIGO = ?', [hash, r.CODIGO]);
        convertidas++;
      } else {
        jaHash++;
      }
    }
    res.json({ success: true, convertidas, jaHash, total: rows.length });
  } catch (err) {
    console.error('Erro na migração:', err.message);
    res.status(500).json({ error: 'Erro de servidor' });
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
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});