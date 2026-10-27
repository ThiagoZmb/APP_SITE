// Validadores puros: CPF/CNPJ e os cadastros de fornecedor e de funcionário.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cpfValido, cnpjValido, documentoFormatado, formatarCpf, formatarCnpj } = require('../calculo/documentos');
const { validarFornecedor, validarFuncionario, dinheiro, dataIso } = require('../calculo/cadastros');

test('CPF: dígitos verificadores; repetidos e tamanho errado são inválidos; aceita máscara', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('1234'), false);
  assert.equal(cpfValido(null), false);
  assert.equal(formatarCpf('52998224725'), '529.982.247-25');
});

test('CNPJ: dígitos verificadores; repetidos e tamanho errado são inválidos', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11222333000181'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('00000000000000'), false);
  assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(documentoFormatado('11222333000181'), '11.222.333/0001-81');
  assert.equal(documentoFormatado('52998224725'), '529.982.247-25');
  assert.equal(documentoFormatado('123'), null);
});

const FORN = { razao: ' ALUMINIO SUL LTDA ', cidade: 'Niterói', uf: 'rj', classe: 'Matéria prima' };

test('validarFornecedor: mínimo válido (razão, cidade, UF, classe), situação padrão Ativo, UF em maiúsculas', () => {
  const { erros, dados } = validarFornecedor(FORN);
  assert.deepEqual(erros, []);
  assert.equal(dados.razao, 'ALUMINIO SUL LTDA');
  assert.equal(dados.uf, 'RJ');
  assert.equal(dados.status, 'Ativo');
  assert.equal(dados.cnpj, '');
});

test('validarFornecedor: erros de razão, cidade, UF, classe, situação, e-mail e CNPJ', () => {
  const { erros } = validarFornecedor({ razao: '', cidade: '', uf: 'R', classe: 'Outra', status: 'X', email: 'sem-arroba', cnpj: '11.222.333/0001-82' });
  const texto = erros.join(' | ');
  for (const trecho of ['Razão social', 'Cidade', 'UF deve ter 2 letras', 'classe', 'Situação', 'E-mail', 'CNPJ/CPF']) assert.ok(texto.includes(trecho), trecho);
  assert.deepEqual(validarFornecedor({ ...FORN, razao: '.' }).erros, ['Razão social inválida.']);
  assert.ok(validarFornecedor({ ...FORN, razao: 'x'.repeat(121) }).erros[0].includes('120'));
  assert.equal(validarFornecedor({ ...FORN, cnpj: '11222333000181' }).dados.cnpj, '11.222.333/0001-81');
  assert.deepEqual(validarFornecedor({ ...FORN, status: 'Inativo', email: 'a@b.com' }).erros, []);
});

const FUNC = { nome: 'João da Silva', cargo: 'Serralheiro', admissao: '2024-03-01' };

test('validarFuncionario: mínimo válido (nome, cargo, admissão); sem valores.ver o dinheiro nem é lido', () => {
  const { erros, dados } = validarFuncionario({ ...FUNC, salarioBase: '3000' });
  assert.deepEqual(erros, []);
  assert.equal(dados.situacao, 'Ativo');
  assert.equal('salarioBase' in dados, false);
  assert.equal(dados.insalubridade, 0);
  assert.equal(dados.demissao, null);
});

test('validarFuncionario: com valores.ver lê o dinheiro (vazio = 0, vírgula decimal, 2 casas) e recusa negativo, texto e excesso', () => {
  const ok = validarFuncionario({ ...FUNC, salarioBase: '3000,5', almoco: '', transporte: 150.456, insalubridade: true }, { podeValores: true });
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.dados.salarioBase, 3000.5);
  assert.equal(ok.dados.almoco, 0);
  assert.equal(ok.dados.transporte, 150.46);
  assert.equal(ok.dados.fgts, 0);
  assert.equal(ok.dados.insalubridade, 1);
  const ruim = validarFuncionario({ ...FUNC, salarioBase: -1, fgts: 'abc', almoco: 1e12 }, { podeValores: true }).erros.join(' | ');
  for (const t of ['Salário base', 'FGTS', 'Almoço']) assert.ok(ruim.includes(t), t);
});

test('validarFuncionario: erros de nome, cargo, admissão, CPF, situação e demissão', () => {
  const t = validarFuncionario({ nome: '', cargo: '', admissao: '2024-02-31', cpf: '111.111.111-11', situacao: 'Férias' }).erros.join(' | ');
  for (const trecho of ['Nome', 'Cargo', 'admissão', 'CPF inválido', 'Situação']) assert.ok(t.includes(trecho), trecho);
  assert.ok(validarFuncionario({ ...FUNC, situacao: 'Demitido' }).erros.join().includes('demissão'));
  assert.deepEqual(validarFuncionario({ ...FUNC, situacao: 'Demitido', demissao: '2026-05-01' }).erros, []);
  assert.ok(validarFuncionario({ ...FUNC, situacao: 'Demitido', demissao: '2023-01-01' }).erros.join().includes('anterior'));
  assert.equal(validarFuncionario({ ...FUNC, cpf: '52998224725' }).dados.cpf, '529.982.247-25');
});

test('dataIso e dinheiro', () => {
  assert.equal(dataIso('2024-02-29'), '2024-02-29');
  assert.equal(dataIso('2023-02-29'), null);
  assert.equal(dataIso('29/02/2024'), null);
  assert.equal(dinheiro(undefined), 0);
  assert.equal(dinheiro('1234,56'), 1234.56);
  assert.ok(Number.isNaN(dinheiro('1.234,56'))); // milhar com ponto + vírgula: ambíguo, recusa
});
