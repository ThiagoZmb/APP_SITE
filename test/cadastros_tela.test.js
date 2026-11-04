// Telas de fornecedores e funcionários: lógica pura e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../fornecedores.js');
const P = require('../funcionarios.js');
const Comum = require('../entregas_comum.js');
const { DINHEIRO_FUNCIONARIO, CAMPOS_DINHEIRO_FUNCIONARIO, calcularEncargos } = require('../calculo/cadastros');
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
  assert.deepEqual(P.DINHEIRO.map(([k]) => k), CAMPOS_DINHEIRO_FUNCIONARIO);
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
  for (const k of CAMPOS_DINHEIRO_FUNCIONARIO) assert.ok(secao.includes(`id="f-${k}"`), k + ' dentro da seção data-valor');
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
  const dinheiro = new Set(CAMPOS_DINHEIRO_FUNCIONARIO);
  const chaves = ['codigo', 'nome', 'cargo', 'situacao', 'telefone', 'cidade', 'uf', 'admissao', 'endereco', 'bairro', 'cep', 'identidade', 'cpf', 'insalubridade', 'demissao',
    'razao', 'fantasia', 'classe', 'status', 'email', 'cnpj', 'numero', 'inscricaoEstadual'];
  for (const k of chaves) if (!dinheiro.has(k)) assert.ok(!REGEX_VALOR.test(k), k);
});

test('funcionários (tela): encargos calculados na tela batem com o servidor; campos calculados ficam desabilitados e obrigatórios', () => {
  for (const [sb, d] of [[3000, 0], [1518, 0], [0, 0], ['2500,75', 0]]) {
    const t = P.calcularEncargos(sb), sv = calcularEncargos(Number(String(sb).replace(',', '.')));
    assert.deepEqual(t, sv);
  }
  assert.equal(P.calcularEncargos(1200, 0).ferias, 133.33); // 1200/12 = 100; + 1/3 = 133,33
  const f = fs.readFileSync(require('node:path').join(__dirname, '..', 'funcionarios.html'), 'utf8');
  for (const k of P.CALCULADOS) assert.match(f, new RegExp(`<input[^>]*id="f-${k}"[^>]*required[^>]*disabled`), k);
  assert.equal(P.calcularEncargos(3000).decimo, 250);
  assert.match(f, /id="f-insalubridadeValor"[^>]*disabled/);
  assert.deepEqual(P.corpoSalvar({ nome: 'Ana', situacao: 'Ativo', cargo: 'Auxiliar', admissao: '2025-01-10', salarioBase: '3000', fgts: '9' }, null, { comValores: true }).fgts, 240);
});

test('funcionários (tela): custo total mensal espelha o servidor, formata em R$ e fica na seção data-valor', () => {
  const v = { salarioBase: '3000', ...P.calcularEncargos('3000'), almoco: '400', transporte: '150,5' };
  assert.equal(P.custoTotalMensal(v), require('../calculo/cadastros').custoTotalMensal(v));
  assert.equal(P.brl(5000.5).replace(/[\s ]/g, ' '), 'R$ 5.000,50');
  const f = fs.readFileSync(path.join(__dirname, '..', 'funcionarios.html'), 'utf8');
  const ini = f.indexOf('<fieldset data-valor>');
  assert.ok(f.slice(ini, f.indexOf('</fieldset>', ini)).includes('id="custo-total"'));
  assert.doesNotMatch(f.slice(ini, f.indexOf('</fieldset>', ini)), /style=/);
});

test('funcionários (tela): CSS dos desabilitados vence a regra dos campos (especificidade) e layout Cidade/Bairro/UF', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'tema.css'), 'utf8');
  assert.match(css, /body \.form-group input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):disabled[\s\S]*?background-color: #f4f4f6 !important/);
  assert.ok(css.indexOf(':not([type=radio]):disabled') > css.indexOf('body .form-group input:not([type=checkbox]):not([type=radio]),'), 'vem depois da regra geral');
  const f = fs.readFileSync(path.join(__dirname, '..', 'funcionarios.html'), 'utf8');
  assert.match(f, /\.linha3b \{[^}]*minmax\(0, 1\.3fr\) minmax\(0, 1\.7fr\) 84px/);
  assert.match(f, /id="f-decimo"[^>]*required[^>]*disabled/);
  assert.match(f, /id="custo-lista"/);
  assert.doesNotMatch(f.slice(f.indexOf('id="qtd"') - 80, f.indexOf('id="qtd"') + 200), /style=/);
  const versoes = fs.readdirSync(path.join(__dirname, '..')).filter(n => n.endsWith('.html')).map(n => /tema\.css\?v=(\d+)/.exec(fs.readFileSync(path.join(__dirname, '..', n), 'utf8'))).filter(Boolean).map(m => m[1]);
  assert.equal(new Set(versoes).size, 1, 'todas as páginas com a mesma versão do tema.css (quebra o cache)');
});

test('funcionários (tela): insalubridade só com o checkbox marcado, igual ao servidor', () => {
  assert.equal(P.calcularEncargos(3000, false).insalubridadeValor, 0);
  assert.equal(P.calcularEncargos(3000, true, 1621).insalubridadeValor, 324.2);
  assert.equal(P.calcularEncargos(9999, true, 1621).insalubridadeValor, 324.2);
  assert.equal(P.calcularEncargos(3000, true, null).insalubridadeValor, null, 'pendência, não zero');
  assert.deepEqual(P.calcularEncargos(2500, true, 1621), calcularEncargos(2500, true, 1621));
  const ok = { nome: 'Ana', situacao: 'Ativo', cargo: 'Auxiliar', admissao: '2025-01-10', salarioBase: '3000' };
  assert.equal(P.corpoSalvar({ ...ok, insalubridade: true }, null, { comValores: true, salarioMinimo: 1621 }).insalubridadeValor, 324.2);
  assert.equal(P.corpoSalvar({ ...ok, insalubridade: false }, null, { comValores: true, salarioMinimo: 1621 }).insalubridadeValor, 0);
});

const normal = t => String(t).replace(/[\s ]+/g, ' ');
// Roda funcionarios.js de verdade com um DOM mínimo: lista -> clique -> GET /funcionarios/:codigo -> formulário preenchido
async function abrirFuncionario(detalhe, salarioMinimo = 1621) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', checked: false, hidden: false, disabled: false, textContent: '', innerHTML: '', ouvintes: {},
    addEventListener(t, fn) { this.ouvintes[t] = fn; }, hasAttribute: () => false, getAttribute: () => null });
  const doc = { getElementById: el, querySelectorAll: () => [], createElement: () => ({ remove() {} }), addEventListener() {} };
  const resposta = corpo => ({ ok: true, status: 200, json: async () => corpo });
  const win = { document: doc, setTimeout: (f) => 0, clearTimeout() {}, URLSearchParams,
    localStorage: { getItem: () => JSON.stringify({ token: 't', user: { nome: 'x' }, exp: Date.now() + 1e6 }), removeItem() {} },
    Acesso: { pode: () => true },
    fetch: async url => resposta(url.includes('/funcionarios/cargos') ? { cargos: [] } : url.endsWith('/funcionarios/' + detalhe.codigo) ? { funcionario: detalhe, salarioMinimo }
      : { funcionarios: [{ codigo: detalhe.codigo, nome: detalhe.nome, cargo: 'X', situacao: 'Ativo', telefone: '', admissao: '2024-01-01' }], custoTotal: 1, salarioMinimo }) };
  P.iniciar(win);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  els.lista.ouvintes.click({ target: { closest: () => ({ getAttribute: () => String(detalhe.codigo) }) } });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return els;
}

test('funcionários (tela): abrir quem NÃO recebe insalubridade (0, "0", "0.0", null) mostra 0,00 e o custo total sem ela; marcar recalcula', async () => {
  const base = { codigo: 7, nome: 'Pedro Henrique', cargo: 'X', situacao: 'Ativo', admissao: '2024-01-01', salarioBase: 1650, insalubridadeValor: 330, fgts: 132, ferias: 183.33,
    feriasFgts: 14.67, decimo: 137.5, decimoFgts: 11, almoco: 0, transporte: 0, planoSaude: 0, segVida: 0, outros: 0 };
  for (const flag of [0, '0', '0.0', null, undefined, false]) {
    const els = await abrirFuncionario({ ...base, insalubridade: flag });
    assert.equal(els['f-insalubridade'].checked, false, String(flag));
    assert.equal(els['f-insalubridadeValor'].value, '0.00', String(flag));
    assert.equal(normal(els['custo-total'].textContent), 'Custo total: R$ 2.128,50', String(flag));
    els['f-insalubridade'].checked = true; els['f-insalubridade'].ouvintes.change();
    assert.equal(els['f-insalubridadeValor'].value, '324.20');
    assert.equal(normal(els['custo-total'].textContent), 'Custo total: R$ 2.452,70');
  }
  for (const flag of [1, '1', true]) {
    const els = await abrirFuncionario({ ...base, insalubridade: flag });
    assert.equal(els['f-insalubridade'].checked, true);
    assert.equal(els['f-insalubridadeValor'].value, '324.20');
  }
});

test('funcionários (tela): o ?v= do funcionarios.js mudou junto com a lógica (senão o navegador usa o JS antigo em cache)', () => {
  const f = fs.readFileSync(path.join(__dirname, '..', 'funcionarios.html'), 'utf8');
  assert.match(f, /funcionarios\.js\?v=202611051200/);
});

test('funcionários (tela): sem salário mínimo cadastrado, quem recebe insalubridade fica com pendência visível (campo vazio, aviso, custo parcial)', async () => {
  const base = { codigo: 7, nome: 'Pedro', cargo: 'X', situacao: 'Ativo', admissao: '2024-01-01', salarioBase: 1650, insalubridade: 1, almoco: 0, transporte: 0, planoSaude: 0, segVida: 0, outros: 0 };
  const els = await abrirFuncionario(base, null);
  assert.equal(els['f-insalubridadeValor'].value, '');
  assert.equal(els['aviso-insalubridade'].hidden, false);
  assert.match(normal(els['custo-total'].textContent), /parcial/);
  els['f-insalubridade'].checked = false; els['f-insalubridade'].ouvintes.change();
  assert.equal(els['f-insalubridadeValor'].value, '0.00');
  assert.equal(els['aviso-insalubridade'].hidden, true);
});

test('funcionários (tela): Cargo com texto mostra TODAS as opções ao focar/clicar; digitar filtra; sair sem escolher restaura o texto', async () => {
  const base = { codigo: 7, nome: 'Pedro', cargo: 'Pintor', situacao: 'Ativo', admissao: '2024-01-01', salarioBase: 1650 };
  const els = await abrirFuncionario(base);
  const c = els['f-cargo'];
  assert.equal(c.value, 'Pintor');
  c.ouvintes.focus();                      // foco: esvazia para o datalist listar tudo
  assert.equal(c.value, '');
  c.ouvintes.blur();                       // saiu sem escolher: volta o texto
  assert.equal(c.value, 'Pintor');
  c.ouvintes.click();                      // clique na seta com o campo já focado
  assert.equal(c.value, '');
  c.value = 'Serralheiro'; c.ouvintes.input(); c.ouvintes.blur(); // escolheu uma opção: vale o novo
  assert.equal(c.value, 'Serralheiro');
  c.ouvintes.focus(); c.value = 'Pi'; c.ouvintes.input(); c.ouvintes.blur(); // digitou para filtrar
  assert.equal(c.value, 'Pi');
});
