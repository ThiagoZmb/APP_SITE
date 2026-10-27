// Cadastro de fornecedores (tabela do VB `cadastro_fornecedores`, lida e gravada como o frm_Cadastro_Fornecedores).
// A razão social (RAZAO_FABRICANTE) é a chave que o estoque, as compras e o financeiro usam para achar o fornecedor;
// por isso a web não deixa mudá-la depois de cadastrada (renomear deixaria compras e lançamentos sem fornecedor).
// Não há exclusão (como no VB): o fornecedor sai de uso mudando a situação para Inativo.
const { emTransacao, ErroUsuario, agoraLocal } = require('./transacao');
const { validarFornecedor, CLASSES_FORNECEDOR } = require('../calculo/cadastros');

const VER = ['fornecedores.ver'];
const EDITAR = ['fornecedores.editar'];
const LIMITE_LISTA = 2000;
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';

const resumo = r => ({ codigo: Number(r.COD), razao: r.RAZAO_FABRICANTE || '', fantasia: r.FANTASIA || '', cidade: r.CIDADE || '', uf: r.ESTADO || '',
  status: r.STATUS || 'Ativo', classe: r.CLASSE || '', telefone: r.TELEFONE || '', email: r.EMAIL || '', cnpj: r.CNPJ || '' });
const completo = r => ({ ...resumo(r), endereco: r.ENDERECO || '', numero: r.NUMERO || '', bairro: r.BAIRRO || '', cep: r.CEP || '', inscricaoEstadual: r.INSCRICAO_ESTADUAL || '' });

function registrarFornecedores({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const codigoDe = req => { const n = Number(req.params.codigo); return Number.isInteger(n) && n > 0 ? n : null; };

  rota('get', '/fornecedores', VER, async (req, res) => {
    try {
      const busca = String(req.query.busca ?? '').trim().slice(0, 100);
      const status = String(req.query.status ?? '');
      const where = ["RAZAO_FABRICANTE <> '.'"], params = [];
      if (status === 'Ativo' || status === 'Inativo') { where.push('STATUS = ?'); params.push(status); }
      if (busca) {
        where.push('(RAZAO_FABRICANTE LIKE ? OR FANTASIA LIKE ? OR CNPJ LIKE ? OR CIDADE LIKE ?)');
        params.push(like(busca), like(busca), like(busca), like(busca));
      }
      const [linhas] = await pool.execute(
        `SELECT COD, RAZAO_FABRICANTE, FANTASIA, CIDADE, ESTADO, STATUS, CLASSE, TELEFONE, EMAIL, CNPJ FROM cadastro_fornecedores
         WHERE ${where.join(' AND ')} ORDER BY RAZAO_FABRICANTE LIMIT ${LIMITE_LISTA}`, params);
      res.json({ fornecedores: linhas.map(resumo), classes: CLASSES_FORNECEDOR });
    } catch (err) {
      console.error('Erro GET /fornecedores:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/fornecedores/:codigo', VER, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    try {
      const [[r]] = await pool.execute('SELECT * FROM cadastro_fornecedores WHERE COD = ? LIMIT 1', [codigo]);
      if (!r) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
      res.json({ fornecedor: completo(r) });
    } catch (err) {
      console.error('Erro GET /fornecedores/:codigo:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // sem `codigo` no corpo cria; com `codigo` atualiza
  rota('post', '/fornecedores/salvar', EDITAR, async (req, res) => {
    const b = req.body || {};
    const { erros, dados } = validarFornecedor(b);
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const criando = b.codigo === undefined || b.codigo === null || b.codigo === '';
    const codigoAtual = criando ? null : Number(b.codigo);
    if (!criando && !(Number.isInteger(codigoAtual) && codigoAtual > 0)) return res.status(400).json({ error: 'Código inválido.' });
    const colunas = [dados.razao, dados.fantasia, dados.endereco, dados.numero, dados.bairro, dados.cidade, dados.uf, dados.status, dados.cep,
      dados.email, dados.telefone, dados.cnpj, dados.inscricaoEstadual, dados.classe];
    const r = await emTransacao(pool, res, 'POST /fornecedores/salvar', async conn => {
      if (criando) {
        const [iguais] = await conn.execute('SELECT COD FROM cadastro_fornecedores WHERE RAZAO_FABRICANTE = ? FOR UPDATE', [dados.razao]);
        if (iguais.length) throw new ErroUsuario(409, `Já existe um fornecedor com a razão social "${dados.razao}" (código ${iguais[0].COD}).`);
        const [ins] = await conn.execute(
          `INSERT INTO cadastro_fornecedores (RAZAO_FABRICANTE, FANTASIA, ENDERECO, NUMERO, BAIRRO, CIDADE, ESTADO, STATUS, CEP, EMAIL, TELEFONE, CNPJ, INSCRICAO_ESTADUAL, CLASSE, CF_CV)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`, colunas);
        const codigo = Number(ins.insertId);
        await auditar(conn, req, 'fornecedor_criado', dados.razao, { codigo, classe: dados.classe, status: dados.status });
        return { codigo, criado: true };
      }
      const [[atual]] = await conn.execute('SELECT * FROM cadastro_fornecedores WHERE COD = ? FOR UPDATE', [codigoAtual]);
      if (!atual) throw new ErroUsuario(404, 'Fornecedor não encontrado.');
      if (String(atual.RAZAO_FABRICANTE || '').trim() !== dados.razao) {
        throw new ErroUsuario(409, 'A razão social não pode ser alterada: o estoque, as compras e o financeiro usam esse nome. Para parar de usar este fornecedor, mude a situação para Inativo.');
      }
      await conn.execute(
        `UPDATE cadastro_fornecedores SET RAZAO_FABRICANTE = ?, FANTASIA = ?, ENDERECO = ?, NUMERO = ?, BAIRRO = ?, CIDADE = ?, ESTADO = ?, STATUS = ?, CEP = ?,
           EMAIL = ?, TELEFONE = ?, CNPJ = ?, INSCRICAO_ESTADUAL = ?, CLASSE = ? WHERE COD = ?`, [...colunas, codigoAtual]);
      const antes = completo(atual);
      const mudou = Object.keys(dados).filter(k => String(dados[k] ?? '') !== String(antes[k] ?? ''));
      await auditar(conn, req, 'fornecedor_alterado', dados.razao, { codigo: codigoAtual, campos: mudou });
      return { codigo: codigoAtual, criado: false };
    });
    if (r) res.json({ ok: true, ...r });
  });
}

module.exports = { registrarFornecedores };
