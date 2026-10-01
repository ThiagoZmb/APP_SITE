// migrar_senhas.js — converte SENHA texto puro → hash bcrypt. RODAR UMA VEZ. Fazer backup antes!
require('dotenv').config(); // se rodar local; no Render as envs já existem
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME
  });
  const [rows] = await conn.execute('SELECT ID, SENHA FROM cliente_usuarios');
  for (const r of rows) {
    // Só converte se ainda NÃO for hash bcrypt (hash bcrypt começa com $2)
    if (!String(r.SENHA).startsWith('$2')) {
      const hash = await bcrypt.hash(r.SENHA, 12);
      await conn.execute('UPDATE cliente_usuarios SET SENHA = ? WHERE ID = ?', [hash, r.ID]);
      console.log(`Usuário ID ${r.ID}: senha convertida.`);
    }
  }
  await conn.end();
  console.log('Migração concluída.');
})();