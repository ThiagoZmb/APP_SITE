const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://thiagozmb.github.io']
}));
app.use(express.json());

// Configuração do banco de dados
const dbConfig = {
  host: process.env.DB_HOST || 'db-elegance-v4.mysql.uhserver.com',
  user: process.env.DB_USER || 'tfz',
  password: process.env.DB_PASS || '@04t28b03p',
  port: process.env.DB_PORT || '3306',
  database: process.env.DB_NAME || 'db_elegance_v4'
};

// Endpoint de login — agora retorna o CARGO do usuário
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(
      'SELECT * FROM cliente_usuarios WHERE NOME = ? AND SENHA = ?',
      [username, password]
    );
    await conn.end();

    if (rows.length > 0) {
      const user = rows[0];
      res.json({
        success: true,
        user: {
          nome: user.NOME,
          empresa: user.RAZAO_SOCIAL,
          cargo: user.CARGO   // ⚠️ veja observação abaixo sobre o nome da coluna
        }
      });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ success: false, error: 'Erro de servidor' });
  }
});

// Endpoint para buscar dados dos pedidos
app.get('/dados_pedidos', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
      SELECT 
        p.NUMERO as numero,
        p.RAZAO_SOCIAL as cliente,
        p.CLIENTE_FINAL as clienteFinal,
        DATE_FORMAT(p.DATA, '%d/%m/%Y') as data,
        DATE_FORMAT(p.DATA_PRONTO, '%d/%m/%Y') as prontoEm,
        p.TOTAL as valor,
        p.OBS_GERAL as observacao,
        p.SITUACAO as situacao,
        p.FINANCEIRO as financeiro,
        DATE_FORMAT(p.DATA_ENTREGA, '%d/%m/%Y') as dataEntrega
       
      FROM ped_orc p
       WHERE p.TIPO='Pedido'
       ORDER BY NUMERO DESC
    `);
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar pedidos:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// Endpoint para buscar pedidos do RJ
app.get('/dados_pedidos_rj', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
      SELECT 
        p.NUMERO as numero,
        p.RAZAO_SOCIAL as cliente,
        p.CLIENTE_FINAL as clienteFinal,
        DATE_FORMAT(p.DATA, '%d/%m/%Y') as data,
        DATE_FORMAT(p.DATA_PRONTO, '%d/%m/%Y') as prontoEm,
        p.TOTAL as valor,
        p.OBS_GERAL as observacao,
        p.SITUACAO as situacao,
        p.FINANCEIRO as financeiro,
        DATE_FORMAT(p.DATA_ENTREGA, '%d/%m/%Y') as dataEntrega
      FROM ped_orc p
      INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL
      WHERE c.ESTADO = 'RJ' AND p.TIPO='Pedido'
      ORDER BY p.DATA DESC
    `);
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar pedidos:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});

// APLICADO CONFORME INSTRUÇÕES DO SISTEMA
app.get('/dados_clientes', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const estado = req.query.estado; // ex: /dados_clientes?estado=RJ

    const sql = `
      SELECT
        CODIGO as codigo, RAZAO_SOCIAL as razaoSocial, FANTASIA as fantasia,
        TIPO as tipo, CNPJ_CPF as cnpjCpf, IE_RG as ieRg,
        CEP as cep, ENDERECO as endereco, NUMERO as numero,
        BAIRRO as bairro, CIDADE as cidade, ESTADO as estado,
        SITUACAO as situacao, CONDICAO as condicao,
        CREDITO as credito, DESCONTO as desconto,
        OBSERVACAO as observacao, CONTATO as contato,
        TELEFONE as telefone, EMAIL as email, REPRESENTANTE as representante
      FROM cadastro_clientes
      ${estado ? 'WHERE ESTADO = ?' : ''}
      ORDER BY RAZAO_SOCIAL ASC
    `;
    const [rows] = await conn.execute(sql, estado ? [estado] : []);
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar clientes:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});



// Endpoint: comparação Orçamentos x Pedidos por mês
app.get('/dados_compras_orcamentos', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const cliente = req.query.cliente;
    const estado = req.query.estado;

        let filtroExtra = '';
    let params = [];

    if (cliente) {
      // Cliente selecionado + SOMENTE ano vigente
      filtroExtra = 'WHERE p.RAZAO_SOCIAL = ? AND YEAR(p.DATA) = YEAR(CURDATE())';
      params = [cliente];
    } else if (estado) {
      // Representante: estado RJ + SOMENTE ano vigente
      filtroExtra = "WHERE c.ESTADO = ? AND YEAR(p.DATA) = YEAR(CURDATE())";
      params = [estado];
    } else {
      // Visão geral (Administrador sem cliente): ano vigente
      filtroExtra = 'WHERE YEAR(p.DATA) = YEAR(CURDATE())';
    }

    const sql = `
      SELECT
        DATE_FORMAT(p.DATA, '%m/%Y') as mes,
        SUM(CASE WHEN p.TIPO = 'Orçamento' THEN p.TOTAL ELSE 0 END) as orcamentos,
        SUM(CASE WHEN p.TIPO = 'Pedido'    THEN p.TOTAL ELSE 0 END) as pedidos
      FROM ped_orc p
      INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL
      ${filtroExtra}
      GROUP BY DATE_FORMAT(p.DATA, '%m/%Y'), YEAR(p.DATA), MONTH(p.DATA)
      ORDER BY YEAR(p.DATA) ASC, MONTH(p.DATA) ASC
    `;
    const [rows] = await conn.execute(sql, params);
    await conn.end();

    const resultado = rows.map(r => ({
      mes: r.mes,
      orcamentos: parseFloat(r.orcamentos) || 0,
      pedidos: parseFloat(r.pedidos) || 0
    }));
    res.json(resultado);
  } catch (err) {
    console.error('Erro ao buscar compras x orçamentos:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});


const PDFDocument = require('pdfkit');

// ✅ PDF do Pedido/Orçamento — equivale ao Gerar_PDF_PedOrc do VB.NET
app.get('/dados_pdf', async (req, res) => {
  const { numero, tipo } = req.query;   // ex: /dados_pdf?numero=23360&tipo=Pedido
  if (!numero || !tipo) return res.status(400).json({ error: 'Informe numero e tipo' });

  try {
    const conn = await mysql.createConnection(dbConfig);

    // Cabeçalho do pedido (ped_orc)
    const [cabs] = await conn.execute(
      `SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL,
              SUB_TOTAL, TOTAL, DESCONTO
       FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    if (cabs.length === 0) { await conn.end(); return res.status(404).json({ error: 'Pedido não encontrado' }); }
    const cab = cabs[0];

    // Itens do pedido
    const [itens] = await conn.execute(
      `SELECT ITEM, QTD, OBSERVACAO, UNITARIO, TOTAL
       FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = ? ORDER BY ITEM`, [numero, tipo]);
    await conn.end();

    const fmtD = v => v ? new Date(v).toLocaleDateString('pt-BR') : '-';
    const fmtM = v => 'R$ ' + (parseFloat(v) || 0).toFixed(2).replace('.', ',');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="${numero}_${String(cab.RAZAO_SOCIAL).replace(/[^\w ]/g,'').trim()}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 20 });
    doc.pipe(res);

    // ===== CABEÇALHO (linha 1: logo | empresa | nº) =====
    doc.fontSize(9).font('Helvetica-Bold')
       .text('Elegance Indústria e Comércio de Artefatos de Alumínio LTDA/Me', { continued: true })
       .font('Helvetica')
       .text('   Tel: (27) 3326-7213 | elegance@elegancealuminio.com.br');
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold')
       .text(`${tipo === 'Pedido' ? 'Pedido' : 'Orçamento'} n°: ${numero}`, { align: 'center' });
    doc.moveDown();

    // ===== DADOS =====
    doc.fontSize(10)
       .text(`Cliente: ${cab.RAZAO_SOCIAL}`)
       .text(`Cliente Final: ${cab.CLIENTE_FINAL || '-'}`)
       .text(`Data do ${tipo.toLowerCase()}: ${fmtD(cab.DATA)}`)
       .text(`Pronto em: ${fmtD(cab.DATA_PRONTO)}`);
    if (tipo !== 'Pedido') {
      doc.text('Este orçamento tem validade de 10 dias úteis a partir da data indicada acima');
    }

    // ===== TABELA DE ITENS =====
    doc.moveDown().fontSize(9).font('Helvetica-Bold');
    doc.text('Item', 30, doc.y, { width: 40, continued: true }) // cabeçalho simples
       .text('Qtd', 70, doc.y, { width: 40, continued: true })
       .text('Descrição', 120, doc.y, { width: 200, continued: true })
       .text('Observação', 330, doc.y, { width: 120, continued: true })
       .text('Unit.', 460, doc.y, { width: 60, continued: true })
       .text('Total', 525, doc.y, { width: 60 });
    doc.moveTo(30, doc.y).lineTo(585, doc.y).stroke(); // divisória

    doc.font('Helvetica').fontSize(8);
    itens.forEach(i => {
      doc.text(String(i.ITEM || ''), 30, doc.y, { width: 40, continued: true })
         .text(String(i.QTD || ''), 70, doc.y, { width: 40, continued: true })
         .text(String(i.OBSERVACAO || '-'), 120, doc.y, { width: 200, continued: true })
         .text(String(i.OBSERVACAO || ''), 330, doc.y, { width: 120, continued: true })
         .text(fmtM(i.UNITARIO), 460, doc.y, { width: 60, continued: true })
         .text(fmtM(i.TOTAL), 525, doc.y, { width: 60 });
    });

    // ===== OBSERVAÇÃO GERAL =====
    doc.moveDown().moveDown().fontSize(10).font('Helvetica-Bold').text('Observação:', { align: 'center' });
    doc.font('Helvetica').text(cab.OBS_GERAL || '');

    // ===== TOTAIS =====
    doc.moveDown().fontSize(10).font('Helvetica-Bold');
    doc.text(`Subtotal: ${fmtM(cab.SUB_TOTAL)}`, { align: 'right', continued: true });
    doc.text(`  Desconto: ${(parseFloat(cab.DESCONTO) || 0).toFixed(2)} %`, { continued: true });
    doc.text(`  Total: ${fmtM(cab.TOTAL)}`);

    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  }
});



// ✅ ISTO FALTAVA — inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
