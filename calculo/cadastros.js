// Validação dos cadastros de fornecedores e de funcionários (funções puras, testáveis sem banco).
// Regras tiradas dos formulários do VB (frm_Cadastro_Fornecedores e frm_Funcionários); o que o VB deixa livre continua livre.
const { cpfValido, formatarCpf, documentoFormatado, soDigitos } = require('./documentos');

const CLASSES_FORNECEDOR = ['Matéria prima', 'Insumos', 'Serviços', 'Geral'];
const STATUS_FORNECEDOR = ['Ativo', 'Inativo'];
const SITUACOES_FUNCIONARIO = ['Ativo', 'Inativo', 'Demitido'];

// campos de dinheiro do funcionário: chave da API -> coluna da tabela `funcionarios`, com o rótulo para as mensagens
const DINHEIRO_FUNCIONARIO = [
  ['salarioBase', 'SALARIO_BASE', 'Salário base'], ['fgts', 'FGTS', 'FGTS'], ['ferias', 'FERIAS_1_12', 'Férias (1/12)'],
  ['feriasFgts', 'FERIAS_FGTS_1_12', 'FGTS das férias'], ['decimo', 'DECIMO_1_12', '13º (1/12)'], ['decimoFgts', 'DECIMO_1_12_FGTS', 'FGTS do 13º'],
  ['almoco', 'ALMOCO', 'Almoço'], ['transporte', 'TRANSPORTE', 'Transporte'], ['planoSaude', 'PLANO_SAUDE', 'Plano de saúde'],
  ['segVida', 'SEG_VIDA', 'Seguro de vida'], ['outros', 'OCIOSIDADE', 'Outros']
];
const CAMPOS_DINHEIRO_FUNCIONARIO = DINHEIRO_FUNCIONARIO.map(([k]) => k);

const t = v => String(v ?? '').trim();
const LIMITE_DINHEIRO = 9999999.99;

function dataIso(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t(v));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1900 ? t(v) : null;
}

// número >= 0 com 2 casas; vazio = 0; aceita "1234,56" ou "1234.56"; fora disso NaN
function dinheiro(v) {
  if (v === undefined || v === null || t(v) === '') return 0;
  let s = t(v);
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const n = typeof v === 'number' ? v : Number(s);
  if (!Number.isFinite(n) || n < 0 || n > LIMITE_DINHEIRO) return NaN;
  return Math.round(n * 100) / 100;
}

// confere tamanho; devolve o texto cortado nas pontas
function campo(erros, valor, rotulo, max, { obrigatorio = false } = {}) {
  const s = t(valor);
  if (obrigatorio && !s) erros.push(`${rotulo} é obrigatório.`);
  else if (s.length > max) erros.push(`${rotulo} muito longo (máximo ${max} caracteres).`);
  return s;
}

function lerUf(erros, valor, { obrigatorio }) {
  const s = t(valor).toUpperCase();
  if (!s) { if (obrigatorio) erros.push('UF é obrigatória.'); return ''; }
  if (!/^[A-Z]{2}$/.test(s)) erros.push('UF deve ter 2 letras.');
  return s;
}

function validarFornecedor(b = {}) {
  const erros = [];
  const razao = campo(erros, b.razao, 'Razão social', 120, { obrigatorio: true });
  if (razao === '.') erros.push('Razão social inválida.');
  const dados = {
    razao,
    fantasia: campo(erros, b.fantasia, 'Nome fantasia', 120),
    endereco: campo(erros, b.endereco, 'Endereço', 120),
    numero: campo(erros, b.numero, 'Número', 20),
    bairro: campo(erros, b.bairro, 'Bairro', 80),
    cidade: campo(erros, b.cidade, 'Cidade', 80, { obrigatorio: true }),
    uf: lerUf(erros, b.uf, { obrigatorio: true }),
    cep: campo(erros, b.cep, 'CEP', 12),
    email: campo(erros, b.email, 'E-mail', 120),
    telefone: campo(erros, b.telefone, 'Telefone', 40),
    inscricaoEstadual: campo(erros, b.inscricaoEstadual, 'Inscrição estadual', 30),
    classe: t(b.classe),
    status: t(b.status) || 'Ativo'
  };
  if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) erros.push('E-mail inválido.');
  const doc = t(b.cnpj);
  if (doc) {
    const f = documentoFormatado(doc);
    if (!f) erros.push('CNPJ/CPF inválido.'); else dados.cnpj = f;
  } else dados.cnpj = '';
  if (!CLASSES_FORNECEDOR.includes(dados.classe)) erros.push(`Escolha a classe (${CLASSES_FORNECEDOR.join(', ')}).`);
  if (!STATUS_FORNECEDOR.includes(dados.status)) erros.push('Situação inválida (Ativo ou Inativo).');
  return { erros, dados };
}

// podeValores: sem `valores.ver` os campos de dinheiro nem são lidos (a rota mantém os que já estão gravados)
function validarFuncionario(b = {}, { podeValores = false } = {}) {
  const erros = [];
  const dados = {
    nome: campo(erros, b.nome, 'Nome', 120, { obrigatorio: true }),
    situacao: t(b.situacao) || 'Ativo',
    endereco: campo(erros, b.endereco, 'Endereço', 120),
    bairro: campo(erros, b.bairro, 'Bairro', 80),
    cidade: campo(erros, b.cidade, 'Cidade', 80),
    uf: lerUf(erros, b.uf, { obrigatorio: false }),
    cep: campo(erros, b.cep, 'CEP', 12),
    telefone: campo(erros, b.telefone, 'Telefone', 40),
    identidade: campo(erros, b.identidade, 'Identidade', 30),
    cargo: campo(erros, b.cargo, 'Cargo', 60, { obrigatorio: true }),
    insalubridade: b.insalubridade === true || b.insalubridade === 1 || b.insalubridade === '1' ? 1 : 0
  };
  if (!SITUACOES_FUNCIONARIO.includes(dados.situacao)) erros.push('Situação inválida (Ativo, Inativo ou Demitido).');
  const cpf = t(b.cpf);
  if (cpf) { if (cpfValido(cpf)) dados.cpf = formatarCpf(cpf); else erros.push('CPF inválido.'); } else dados.cpf = '';
  dados.admissao = dataIso(b.admissao);
  if (!dados.admissao) erros.push('Informe a data de admissão (AAAA-MM-DD).');
  const dem = t(b.demissao);
  dados.demissao = dem ? dataIso(dem) : null;
  if (dem && !dados.demissao) erros.push('Data de demissão inválida (AAAA-MM-DD).');
  if (dados.situacao === 'Demitido' && !dem) erros.push('Informe a data de demissão.');
  if (dados.admissao && dados.demissao && dados.demissao < dados.admissao) erros.push('A demissão não pode ser anterior à admissão.');
  if (podeValores) {
    for (const [chave, , rotulo] of DINHEIRO_FUNCIONARIO) {
      const n = dinheiro(b[chave]);
      if (Number.isNaN(n)) erros.push(`${rotulo}: informe um número de 0 a ${LIMITE_DINHEIRO.toLocaleString('pt-BR')}.`); else dados[chave] = n;
    }
  }
  return { erros, dados };
}

module.exports = { CLASSES_FORNECEDOR, STATUS_FORNECEDOR, SITUACOES_FUNCIONARIO, DINHEIRO_FUNCIONARIO, CAMPOS_DINHEIRO_FUNCIONARIO,
  dataIso, dinheiro, validarFornecedor, validarFuncionario, soDigitos };
