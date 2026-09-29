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

// ✅ PDF do Pedido/Orçamento — versão corrigida (sem sobreposição)
app.get('/dados_pdf', async (req, res) => {
  const { numero, tipo } = req.query;
  if (!numero || !tipo) return res.status(400).json({ error: 'Informe numero e tipo' });

  try {
    const conn = await mysql.createConnection(dbConfig);

    const [cabs] = await conn.execute(
      `SELECT RAZAO_SOCIAL, CLIENTE_FINAL, DATA, DATA_PRONTO, OBS_GERAL,
              SUB_TOTAL, TOTAL, DESCONTO
       FROM ped_orc WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    if (cabs.length === 0) { await conn.end(); return res.status(404).json({ error: 'Pedido não encontrado' }); }
    const cab = cabs[0];

    const [itens] = await conn.execute(
      `SELECT * FROM ped_orc_lista_itens WHERE NUMERO = ? AND TIPO = ? ORDER BY CAST(ITEM AS UNSIGNED)`, [numero, tipo]);
    const [v4] = await conn.execute(
      `SELECT * FROM ped_orc_itens_v4 WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [serr] = await conn.execute(
      `SELECT * FROM ped_orc_serralheria WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [comps] = await conn.execute(
      `SELECT * FROM ped_orc_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [compSerr] = await conn.execute(
      `SELECT * FROM ped_orc_serralheria_complementos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    const [furos] = await conn.execute(
      `SELECT * FROM furacao_pedidos_orcamentos WHERE NUMERO = ? AND TIPO = ?`, [numero, tipo]);
    await conn.end();

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

    // ================= CABEÇALHO =================
    doc.font('Helvetica-Bold').fontSize(10)
       .text('Elegance Indústria e Comércio de Artefatos de Alumínio LTDA/Me', M, doc.y, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(8)
       .text('Tel: (27) 3326-7213  |  elegance@elegancealuminio.com.br', M, doc.y, { width: W, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(14)
       .text(`${tipo} n°: ${numero}`, M, doc.y, { width: W, align: 'center' });
    doc.moveDown(0.8);

    // ================= DADOS DO CLIENTE — 1 campo por linha (sem sobreposição) =================
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text(`Cliente: ${cab.RAZAO_SOCIAL}`, M, doc.y, { width: W });      // quebra dentro de W, nunca invade
    doc.text(`Cliente Final: ${cab.CLIENTE_FINAL || '-'}`, M, doc.y, { width: W });
    doc.font('Helvetica').fontSize(9);
    doc.text(`Data do ${tipo.toLowerCase()}: ${fmtD(cab.DATA)}          Pronto em: ${fmtD(cab.DATA_PRONTO)}`, M, doc.y, { width: W });
    if (tipo !== 'Pedido') {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(9)
         .text('Este orçamento tem validade de 10 dias úteis a partir da data discriminada acima', M, doc.y, { width: W });
    }
    doc.moveDown(0.6);

    // ================= DESCRITIVO DO ITEM =================
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

    // ================= TABELA COM GRADE (altura medida, não estimada) =================
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
      // ✅ altura REAL: mede o texto dentro da largura da coluna
      const hDesc = doc.heightOfString(descTexto, { width: cols[2].w - 6 });
      const hObs  = doc.heightOfString(obsTexto,  { width: cols[3].w - 6 });
      const rowH  = Math.max(hDesc, hObs, 14) + PAD * 2;

      // Quebra de página: repete o cabeçalho
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawHeader(y);
      }

      // Células — cada uma presa à sua caixa (width + height + ellipsis)
      let x = M;
      doc.text(String(itemID), x + 2, y + PAD, { width: cols[0].w - 4, align: 'center', height: rowH, ellipsis: true }); x += cols[0].w;
      doc.text(String(i.QTD || ''), x + 2, y + PAD, { width: cols[1].w - 4, align: 'center', height: rowH, ellipsis: true }); x += cols[1].w;
      doc.text(descTexto, x + 2, y + PAD, { width: cols[2].w - 4, height: rowH, ellipsis: true }); x += cols[2].w;
      doc.text(obsTexto, x + 2, y + PAD, { width: cols[3].w - 4, height: rowH, ellipsis: true }); x += cols[3].w;
      doc.text(fmtM(i.UNITARIO), x + 2, y + PAD, { width: cols[4].w - 4, align: 'right', height: rowH, ellipsis: true }); x += cols[4].w;
      doc.text(fmtM(i.TOTAL), x + 2, y + PAD, { width: cols[5].w - 4, align: 'right', height: rowH, ellipsis: true });

      // Grade da linha
      doc.moveTo(M, y).lineTo(M + W, y).stroke();
      let gx = M;
      cols.forEach(c => { doc.moveTo(gx, y).lineTo(gx, y + rowH).stroke(); gx += c.w; });

      y += rowH;
    });
    doc.moveTo(M, y).lineTo(M + W, y).stroke(); // fecha a tabela
    doc.y = y;

    // ================= OBSERVAÇÃO GERAL =================
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(9).text('Observação:', M, doc.y, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(String(cab.OBS_GERAL || ''), M, doc.y, { width: W });

    // ================= TOTAIS — fluxo sequencial (impossível sobrepor) =================
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Subtotal: ${fmtM(cab.SUB_TOTAL)}`, { width: W, align: 'right' });
    doc.text(`Desconto: ${(parseFloat(cab.DESCONTO) || 0).toFixed(2)} %`, { width: W, align: 'right' });
    doc.text(`TOTAL: ${fmtM(cab.TOTAL)}`, { width: W, align: 'right' });

    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  }
});



// ✅ Endpoint único: ?tipo=Pedido|Orçamento  +  ?estado=RJ (representante)
app.get('/dados_lista', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const tipo = req.query.tipo === 'Orçamento' ? 'Orçamento' : 'Pedido';
    const estado = req.query.estado;

    const sql = `
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
      ${estado ? 'INNER JOIN cadastro_clientes c ON p.RAZAO_SOCIAL = c.RAZAO_SOCIAL' : ''}
      WHERE p.TIPO = ? ${estado ? 'AND c.ESTADO = ?' : ''}
      ORDER BY p.NUMERO DESC
    `;
    const params = estado ? [tipo, estado] : [tipo];
    const [rows] = await conn.execute(sql, params);
    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar lista:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
});






// ✅ ISTO FALTAVA — inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
