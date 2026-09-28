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



/// Endpoint: comparação Orçamentos x Pedidos por mês, FILTRADO POR CLIENTE
app.get('/dados_compras_orcamentos', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const cliente = req.query.cliente;        // ex: /dados_compras_orcamentos?cliente=EMPRESA XYZ LTDA
    const estado = req.query.estado;          // usado pelo Representante (sem cliente escolhido)

    let filtroExtra = '';
    let params = [];

    if (cliente) {
      filtroExtra = 'WHERE p.RAZAO_SOCIAL = ?';
      params = [cliente];
    } else if (estado) {
      filtroExtra = 'WHERE c.ESTADO = ?';
      params = [estado];
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
    ...
    // resto igual ao que te passei antes


// ✅ ISTO FALTAVA — inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
