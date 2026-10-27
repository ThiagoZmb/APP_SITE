// Cadastro de funcionários (tabela do VB `funcionarios`, como o frm_Funcionários).
// Dados pessoais: `funcionarios.ver` / `funcionarios.editar`. Salário e encargos (dinheiro): só com `valores.ver` — sem ela a rota não devolve
// esses campos e, ao salvar, mantém os valores que já estão gravados. A coluna SENHA do VB nunca sai nem é alterada por aqui (novo funcionário
// entra com SENHA vazia, como o VB sem senha digitada); DARF também não é tocado. NIVEL recebe o cargo, como o VB.
// Não há exclusão pela web: o funcionário sai de uso pela situação (Inativo ou Demitido).
const { emTransacao, ErroUsuario, agoraLocal, hojeLocal } = require('./transacao');
const { semValores, podeVerValores, preservarValores } = require('../seguranca/valores');
const { validarFuncionario, SITUACOES_FUNCIONARIO, DINHEIRO_FUNCIONARIO, CAMPOS_DINHEIRO_FUNCIONARIO } = require('../calculo/cadastros');

const VER = ['funcionarios.ver'];
const EDITAR = ['funcionarios.editar'];
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
const dia = v => (v ? String(v).slice(0, 10) : null);
const num = v => Math.round((Number(v) || 0) * 100) / 100;

const resumo = r => ({ codigo: Number(r.CODIGO), nome: r.NOME || '', cargo: r.CARGO || '', situacao: r.SITUACAO || 'Ativo', telefone: r.TELEFONE || '',
  cidade: r.CIDADE || '', uf: r.ESTADO || '', admissao: dia(r.ADMISSAO) });
// SENHA, NIVEL e DARF nunca são lidos para a resposta
function completo(r) {
  const o = { ...resumo(r), endereco: r.ENDERECO || '', bairro: r.BAIRRO || '', cep: r.CEP || '', identidade: r.IDENTIDADE || '', cpf: r.CPF || '',
    insalubridade: Number(r.INSALUBRIDADE) ? 1 : 0, demissao: r.SITUACAO === 'Demitido' ? dia(r.DEMISSAO) : null };
  for (const [chave, coluna] of DINHEIRO_FUNCIONARIO) o[chave] = num(r[coluna]);
  return o;
}

function registrarFuncionarios({ rota, pool }) {
  const auditar = (conn, req, acao, alvo, detalhe) => conn.execute('INSERT INTO web_auditoria (quando, quem, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)',
    [agoraLocal(), req.acesso?.nome || '', acao, alvo, JSON.stringify(detalhe)]);
  const codigoDe = req => { const n = Number(req.params.codigo); return Number.isInteger(n) && n > 0 ? n : null; };

  rota('get', '/funcionarios', VER, async (req, res) => {
    try {
      const busca = String(req.query.busca ?? '').trim().slice(0, 100);
      const situacao = String(req.query.situacao ?? '');
      const where = ['1 = 1'], params = [];
      if (SITUACOES_FUNCIONARIO.includes(situacao)) { where.push('SITUACAO = ?'); params.push(situacao); }
      if (busca) { where.push('(NOME LIKE ? OR CARGO LIKE ? OR CIDADE LIKE ?)'); params.push(like(busca), like(busca), like(busca)); }
      const [linhas] = await pool.execute(
        `SELECT CODIGO, NOME, CARGO, SITUACAO, TELEFONE, CIDADE, ESTADO, ADMISSAO FROM funcionarios WHERE ${where.join(' AND ')} ORDER BY NOME LIMIT 2000`, params);
      res.json({ funcionarios: linhas.map(resumo) });
    } catch (err) {
      console.error('Erro GET /funcionarios:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // cargos do VB (tabela `cargos`), para a lista de escolha
  rota('get', '/funcionarios/cargos', VER, async (req, res) => {
    try {
      const [linhas] = await pool.execute('SELECT CARGO FROM cargos ORDER BY CARGO');
      res.json({ cargos: linhas.map(l => l.CARGO).filter(Boolean) });
    } catch (err) {
      console.error('Erro GET /funcionarios/cargos:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  rota('get', '/funcionarios/:codigo', VER, async (req, res) => {
    const codigo = codigoDe(req);
    if (!codigo) return res.status(404).json({ error: 'Funcionário não encontrado.' });
    try {
      const [[r]] = await pool.execute('SELECT * FROM funcionarios WHERE CODIGO = ? LIMIT 1', [codigo]);
      if (!r) return res.status(404).json({ error: 'Funcionário não encontrado.' });
      res.json({ funcionario: semValores(req, completo(r), CAMPOS_DINHEIRO_FUNCIONARIO) });
    } catch (err) {
      console.error('Erro GET /funcionarios/:codigo:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });

  // sem `codigo` no corpo cria; com `codigo` atualiza
  rota('post', '/funcionarios/salvar', EDITAR, async (req, res) => {
    const b = req.body || {};
    const { erros, dados } = validarFuncionario(b, { podeValores: podeVerValores(req) });
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const criando = b.codigo === undefined || b.codigo === null || b.codigo === '';
    const codigoAtual = criando ? null : Number(b.codigo);
    if (!criando && !(Number.isInteger(codigoAtual) && codigoAtual > 0)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await emTransacao(pool, res, 'POST /funcionarios/salvar', async conn => {
      let atual = null;
      if (!criando) {
        [[atual]] = await conn.execute('SELECT * FROM funcionarios WHERE CODIGO = ? FOR UPDATE', [codigoAtual]);
        if (!atual) throw new ErroUsuario(404, 'Funcionário não encontrado.');
      }
      // sem valores.ver: mantém o dinheiro já gravado (ou 0 em cadastro novo)
      const d = preservarValores(req, dados, atual ? completo(atual) : Object.fromEntries(CAMPOS_DINHEIRO_FUNCIONARIO.map(k => [k, 0])), CAMPOS_DINHEIRO_FUNCIONARIO);
      // como o VB, a demissão sempre grava uma data (hoje, se ninguém informou); a tela só mostra para quem está Demitido
      const demissao = d.demissao || (atual && dia(atual.DEMISSAO)) || hojeLocal();
      const colunasTexto = [d.situacao, d.nome, d.endereco, d.bairro, d.cidade, d.uf, d.cep, d.telefone, d.identidade, d.cpf, d.cargo];
      const colunasDinheiro = DINHEIRO_FUNCIONARIO.map(([chave]) => d[chave]);
      if (criando) {
        const [ins] = await conn.execute(
          `INSERT INTO funcionarios (SITUACAO, NOME, ENDERECO, BAIRRO, CIDADE, ESTADO, CEP, TELEFONE, IDENTIDADE, CPF, CARGO, INSALUBRIDADE, ${DINHEIRO_FUNCIONARIO.map(([, c]) => c).join(', ')},
             DARF, SENHA, NIVEL, ADMISSAO, DEMISSAO) VALUES (${'?, '.repeat(11 + 1 + colunasDinheiro.length)}0, '', ?, ?, ?)`,
          [...colunasTexto, d.insalubridade, ...colunasDinheiro, d.cargo, d.admissao, demissao]);
        const codigo = Number(ins.insertId);
        await auditar(conn, req, 'funcionario_criado', d.nome, { codigo, cargo: d.cargo, situacao: d.situacao });
        return { codigo, criado: true };
      }
      await conn.execute(
        `UPDATE funcionarios SET SITUACAO = ?, NOME = ?, ENDERECO = ?, BAIRRO = ?, CIDADE = ?, ESTADO = ?, CEP = ?, TELEFONE = ?, IDENTIDADE = ?, CPF = ?, CARGO = ?,
           INSALUBRIDADE = ?, ${DINHEIRO_FUNCIONARIO.map(([, c]) => c + ' = ?').join(', ')}, NIVEL = ?, ADMISSAO = ?, DEMISSAO = ? WHERE CODIGO = ?`,
        [...colunasTexto, d.insalubridade, ...colunasDinheiro, d.cargo, d.admissao, demissao, codigoAtual]);
      // na auditoria só vão os NOMES dos campos que mudaram (nunca CPF nem valores)
      const antes = completo(atual);
      const mudou = Object.keys(d).filter(k => k in antes && String(d[k] ?? '') !== String(antes[k] ?? ''));
      await auditar(conn, req, 'funcionario_alterado', d.nome, { codigo: codigoAtual, campos: mudou });
      return { codigo: codigoAtual, criado: false };
    });
    if (r) res.json({ ok: true, ...r });
  });
}

module.exports = { registrarFuncionarios };
