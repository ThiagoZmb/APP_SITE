// Telas de fornecedores e funcionários: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../fornecedores.js');
const P = require('../funcionarios.js');
const Comum = require('../entregas_comum.js');
const { DINHEIRO_FUNCIONARIO } = require('../calculo/cadastros');
const { REGEX_VALOR } = require('../seguranca/valores');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('fornecedores: validarForm e corpoSalvar', () => {
  const ok = { razao: ' ALUMINIO ', classe: 'Insumos', cidade: 'Niterói', uf: 'rj', email: '' };
  assert.deepEqual(F.validarForm(ok), []);
  assert.equal(F.validarForm({}).length, 4);
  assert.ok(F.validarForm({ ...ok, email: 'x' }).join().includes('E-mail'));
  assert.ok(F.validarForm({ ...ok, uf: 'R' }).join().includes('UF'));
  const b = F.corpoSalvar({ ...ok, extra: 'não vai' }, 5);
  assert.equal(b.razao, 'ALUMINIO');
  assert.equal(b.codigo, 5);
  assert.equal('extra' in b, false);
  assert.equal('codigo' in F.corpoSalvar(ok, null), false);
});

test('funcionários: validarForm (valores só validados para quem tem valores.ver) e corpoSalvar', () => {
  const ok = { nome: 'Ana', situacao: 'Ativo', cargo: 'Auxiliar', admissao: '2025-01-10' };
  assert.deepEqual(P.validarForm(ok), []);
  assert.ok(P.validarForm({ ...ok, admissao: '' }).join().includes('admissão'));
  assert.ok(P.validarForm({ ...ok, situacao: 'Demitido' }).join().includes('demissão'));
  assert.deepEqual(P.validarForm({ ...ok, situacao: 'Demitido', demissao: '2026-02-01' }), []);
  assert.deepEqual(P.validarForm({ ...ok, salarioBase: '-5' }), []); // sem valores.ver o campo nem é olhado
  assert.ok(P.validarForm({ ...ok, salarioBase: '-5' }, { comValores: true }).join().includes('Salário base'));
  const sem = P.corpoSalvar({ ...ok, salarioBase: '3000', insalubridade: true }, 3);
  assert.equal('salarioBase' in sem, false);
  assert.equal(sem.insalubridade, true);
  assert.equal(sem.codigo, 3);
  assert.equal(P.corpoSalvar({ ...ok, salarioBase: '3000' }, null, { comValores: true }).salarioBase, '3000');
});

test('funcionários: os campos de dinheiro da tela são os mesmos do servidor', () => {
  assert.deepEqual(P.DINHEIRO.map(([k]) => k), DINHEIRO_FUNCIONARIO.map(([k]) => k));
});

test('busca de CEP compartilhada: enderecoDoViaCep e consultarCep', async () => {
  assert.deepEqual(Comum.enderecoDoViaCep({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'Niterói', uf: 'rj' }), { rua: 'Rua A', bairro: 'Centro', cidade: 'Niterói', uf: 'RJ' });
  assert.equal(Comum.enderecoDoViaCep({ erro: true }), null);
  const win = { fetch: async url => ({ json: async () => (url.includes('24220000') ? { logradouro: 'Rua B', localidade: 'Niterói', uf: 'RJ' } : { erro: true }) }) };
  assert.equal((await Comum.consultarCep(win, '24.220-000')).rua, 'Rua B');
  assert.equal(await Comum.consultarCep(win, '99999999'), null);
  await assert.rejects(() => Comum.consultarCep(win, '123'), /8 números/);
  await assert.rejects(() => Comum.consultarCep({ fetch: async () => { throw new Error('rede'); } }, '24220000'), /consultar o CEP/);
});

test('páginas: CSP com ViaCEP, scripts, botão do CEP, sem handlers inline; salário só em data-valor', () => {
  for (const [html, js, perm] of [['fornecedores.html', 'fornecedores.js', 'fornecedores'], ['funcionarios.html', 'funcionarios.js', 'funcionarios']]) {
    const h = ler(html);
    assert.match(h, /connect-src[^"]*viacep\.com\.br/, html);
    assert.ok(h.includes('<script src="layout.js'), html);
    assert.ok(h.includes('<script src="entregas_comum.js'), html);
    assert.ok(h.includes(`<script src="${js}`), html);
    assert.ok(h.includes('id="btn-cep"') && h.includes('id="btn-novo"') && h.includes('id="btn-salvar"'), html);
    assert.ok(h.includes(`data-perm="${perm}.editar"`), html);
    assert.doesNotMatch(h, /\son(click|change|submit|error)=/, html);
    assert.match(h, /name="viewport"/);
  }
  const f = ler('funcionarios.html');
  const secao = f.slice(f.indexOf('<fieldset data-valor>'), f.indexOf('</fieldset>', f.indexOf('<fieldset data-valor>')));
  for (const [k] of DINHEIRO_FUNCIONARIO) assert.ok(secao.includes(`id="f-${k}"`), k + ' dentro da seção data-valor');
  assert.ok(!f.slice(0, f.indexOf('<fieldset data-valor>')).includes('id="f-salarioBase"'));
});

test('layout.js: Fornecedores e Funcionários no menu (Gestão) e em PAGINAS com as permissões certas; minhas_entregas continua por último', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'fornecedores\.html', texto: 'Fornecedores'/);
  assert.match(l, /href: 'funcionarios\.html', texto: 'Funcionários'/);
  assert.match(l, /'fornecedores\.html': \['fornecedores\.ver'\]/);
  assert.match(l, /'funcionarios\.html': \['funcionarios\.ver'\]/);
  assert.ok(l.indexOf("href: 'fornecedores.html'") > l.indexOf("secao: 'Gestão'"));
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});

test('nomes de campo da API de funcionários e fornecedores não casam com REGEX_VALOR (exceto o dinheiro, que é filtrado por semValores)', () => {
  const dinheiro = new Set(DINHEIRO_FUNCIONARIO.map(([k]) => k));
  const chaves = ['codigo', 'nome', 'cargo', 'situacao', 'telefone', 'cidade', 'uf', 'admissao', 'endereco', 'bairro', 'cep', 'identidade', 'cpf', 'insalubridade', 'demissao',
    'razao', 'fantasia', 'classe', 'status', 'email', 'cnpj', 'numero', 'inscricaoEstadual'];
  for (const k of chaves) if (!dinheiro.has(k)) assert.ok(!REGEX_VALOR.test(k), k);
});
