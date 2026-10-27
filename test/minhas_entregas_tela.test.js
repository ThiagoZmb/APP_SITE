// Tela do motorista (minhas_entregas.html + minhas_entregas.js): lógica pura (node:test) e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../minhas_entregas.js');
const C = require('../entregas_comum.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ent = (id, status, extra = {}) => ({ id, numero: 100 + id, status, dataAgendada: '2026-10-26', cliente: 'C' + id, telefone: '', endereco: null, contatoLocal: null, qtdItens: 1, ...extra });

test('helpers compartilhados: esc, datas e escala de imagem continuam disponíveis', () => {
  assert.equal(C.esc('<b>"&\''), '&lt;b&gt;&quot;&amp;&#39;');
  assert.equal(C.dataBR('2026-10-26'), '26/10/2026');
  assert.equal(C.dataHoraBR('2026-10-26 14:05:09'), '26/10/2026 14:05');
  assert.deepEqual(C.escalaImagem(4000, 3000, 1600), { largura: 1600, altura: 1200 });
  assert.equal(M.esc, C.esc);
});

test('F7: telefoneLimpo usa o primeiro número com 8+ dígitos (dois números não viram um só)', () => {
  assert.equal(M.telefoneLimpo('(21) 2222-3333 / (21) 99999-8888'), '2122223333');
  assert.equal(M.telefoneLimpo('2122223333; 21999998888'), '2122223333');
  assert.equal(M.telefoneLimpo('2122223333, 21999998888'), '2122223333');
  assert.equal(M.telefoneLimpo('2122223333 | 21999998888'), '2122223333');
  assert.equal(M.telefoneLimpo('2122223333 e 21999998888'), '2122223333');
  assert.equal(M.telefoneLimpo('123 / (21) 99999-8888'), '21999998888'); // primeiro trecho curto é ignorado
  assert.equal(M.telefoneLimpo('+55 21 99999-8888 / 2122223333'), '+5521999998888');
  assert.equal(M.telefoneLimpo('1234567 / 7654321'), '');
  assert.equal(M.telefoneLimpo(''), '');
  assert.equal(M.urlLigar('2122223333 / 21999998888'), 'tel:2122223333');
});

test('F7: cartão mostra SEMPRE o telefone bruto (escapado), com ou sem link de ligar', () => {
  assert.ok(M.htmlTelefone('(21) 2222-3333 / (21) 99999-8888').includes('(21) 2222-3333 / (21) 99999-8888'));
  assert.match(M.htmlTelefone('sem número'), /sem número/); // sem link, mas visível
  assert.equal(M.htmlTelefone(''), '');
  assert.equal(M.htmlTelefone(null), '');
  assert.ok(!M.htmlTelefone('<img src=x onerror=1>').includes('<img'));
  // o cartão usa o helper (ver htmlCartao)
  assert.ok(ler('minhas_entregas.js').includes('htmlTelefone(e.telefone)'));
});

test('telefoneLimpo: só dígitos e + inicial', () => {
  assert.equal(M.telefoneLimpo('(21) 99999-8888'), '21999998888');
  assert.equal(M.telefoneLimpo('+55 21 99999-8888'), '+5521999998888');
  assert.equal(M.telefoneLimpo('21 9999+8888'), '2199998888');
  assert.equal(M.telefoneLimpo('javascript:alert(1)'), ''); // poucos dígitos: não é telefone
  assert.equal(M.telefoneLimpo('1234567'), '');
  assert.equal(M.telefoneLimpo('21999998888'), '21999998888');
  assert.equal(M.telefoneLimpo('sem número'), '');
  assert.equal(M.telefoneLimpo(null), '');
  assert.equal(M.urlLigar('(21) 99999-8888'), 'tel:21999998888');
  assert.equal(M.urlLigar(''), '');
});

test('enderecoTexto: monta o endereço legível e ignora campos vazios', () => {
  assert.equal(M.enderecoTexto({ rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Rio', uf: 'RJ', cep: '20000-000', ref: 'portão azul' }),
    'Rua A, 10 · Centro · Rio/RJ · 20000-000 · portão azul');
  assert.equal(M.enderecoTexto({ rua: 'Rua A', numero: '', bairro: '', cidade: 'Rio', uf: '', cep: '', ref: null }), 'Rua A · Rio');
  assert.equal(M.enderecoTexto(null), '');
});

test('enderecoDe: usa o da entrega; sem ele, sugere o do cliente; sem nenhum, avisa', () => {
  const end = { rua: 'Rua A', numero: '10', bairro: '', cidade: 'Rio', uf: 'RJ', cep: '', ref: null };
  assert.deepEqual(M.enderecoDe({ endereco: end }), { origem: 'entrega', texto: 'Rua A, 10 · Rio/RJ', mapa: 'Rua A, 10, Rio - RJ' });
  const cli = { rua: 'Av B', numero: '5', bairro: 'Lapa', cidade: 'Rio', uf: 'RJ', cep: '20000-000' };
  assert.deepEqual(M.enderecoDe({ endereco: null, enderecoCliente: cli }),
    { origem: 'cliente', texto: 'Av B, 5 · Lapa · Rio/RJ · 20000-000', mapa: 'Av B, 5, Lapa, Rio - RJ, 20000-000' });
  assert.deepEqual(M.enderecoDe({ endereco: null, enderecoCliente: { rua: '', numero: '', bairro: '', cidade: '', uf: '', cep: '' } }), { origem: null, texto: '', mapa: '' });
  assert.deepEqual(M.enderecoDe({ endereco: null }), { origem: null, texto: '', mapa: '' });
});

test('urlMapa: Google Maps com o endereço codificado; vazio sem endereço', () => {
  const e = { endereco: { rua: 'Rua A', numero: '10', bairro: '', cidade: 'Rio', uf: 'RJ', cep: '', ref: 'perto do "bar" & cia' } };
  assert.equal(M.urlMapa(e), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Rua A, 10, Rio - RJ'));
  assert.match(M.urlMapa({ endereco: null, enderecoCliente: { rua: 'Av B', numero: '5', bairro: '', cidade: 'Rio', uf: 'RJ', cep: '' } }), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Av%20B/);
  assert.equal(M.urlMapa({ endereco: null }), '');
});

test('rótulos de status e de resultado', () => {
  assert.equal(M.rotuloStatus('agendada'), 'Agendada');
  assert.equal(M.rotuloStatus('em_rota'), 'Em rota');
  assert.equal(M.rotuloStatus('ocorrencia'), 'Ocorrência');
  assert.equal(M.rotuloStatus('x'), 'x');
  assert.equal(M.corStatus('ocorrencia'), 'perigo');
  assert.equal(M.rotuloResultado('endereco_errado'), 'Endereço errado');
  assert.equal(M.rotuloResultado('recusa'), 'Recusa');
  assert.equal(M.rotuloResultado('ausente'), 'Cliente ausente');
  assert.deepEqual(M.RESULTADOS.map(r => r.id), ['entregue', 'parcial', 'ausente', 'endereco_errado', 'recusa']);
});

test('acoesMotorista: iniciar só na agendada, baixar só em rota, ocorrência sem ações', () => {
  assert.deepEqual(M.acoesMotorista({ status: 'agendada' }), ['iniciar']);
  assert.deepEqual(M.acoesMotorista({ status: 'em_rota' }), ['baixar']);
  for (const s of ['ocorrencia', 'entregue', 'cancelada', 'a_programar']) assert.deepEqual(M.acoesMotorista({ status: s }), []);
  assert.deepEqual(M.acoesMotorista(null), []);
});

test('motivoOcorrencia: motivo do último evento de ocorrência', () => {
  const ev = [{ tipo: 'agendada', motivo: null }, { tipo: 'ausente', motivo: 'ninguém atendeu' }, { tipo: 'reagendada', motivo: null }, { tipo: 'recusa', motivo: 'cliente recusou' }];
  assert.deepEqual(M.motivoOcorrencia(ev), { tipo: 'recusa', rotulo: 'Recusa', motivo: 'cliente recusou' });
  assert.equal(M.motivoOcorrencia([{ tipo: 'agendada' }]), null);
  assert.equal(M.motivoOcorrencia(undefined), null);
});

test('hojeISO e deslocarDia: calendário local, virada de mês e de ano', () => {
  assert.equal(M.hojeISO(new Date(2026, 9, 26, 23, 30)), '2026-10-26');
  assert.equal(M.hojeISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(M.deslocarDia('2026-10-31', 1), '2026-11-01');
  assert.equal(M.deslocarDia('2026-01-01', -1), '2025-12-31');
  assert.equal(M.deslocarDia('2026-03-01', -1), '2026-02-28');
});

test('agruparCartoes: atrasadas primeiro, depois por dia; em rota antes de agendada; ocorrência por último', () => {
  const l = [
    ent(1, 'agendada', { dataAgendada: '2026-10-26' }),
    ent(2, 'em_rota', { dataAgendada: '2026-10-26' }),
    ent(3, 'ocorrencia', { dataAgendada: '2026-10-26' }),
    ent(4, 'agendada', { dataAgendada: '2026-10-24' }),
    ent(5, 'agendada', { dataAgendada: '2026-10-26', numero: 50 }),
    ent(6, 'agendada', { dataAgendada: '2026-10-27' })
  ];
  const g = M.agruparCartoes(l, '2026-10-26');
  assert.deepEqual(g.map(x => [x.dia, x.atrasada]), [['2026-10-24', true], ['2026-10-26', false], ['2026-10-27', false]]);
  assert.deepEqual(g[1].entregas.map(e => e.id), [2, 5, 1, 3]);
  assert.deepEqual(M.agruparCartoes([], '2026-10-26'), []);
  assert.deepEqual(M.agruparCartoes(null, '2026-10-26'), []);
});

const PARCIAL = [{ descricao: 'Porta', qtd: 0, max: 2 }, { descricao: 'Janela', qtd: 1, max: 3 }];

test('validarBaixa: entregue exige só quem recebeu (foto é opcional)', () => {
  assert.deepEqual(M.validarBaixa('entregue', { entregueA: 'Maria', temFoto: true }), []);
  assert.match(M.validarBaixa('entregue', { entregueA: '  ', temFoto: true })[0], /quem recebeu/i);
  assert.deepEqual(M.validarBaixa('entregue', { entregueA: 'Maria', temFoto: false }), []);
  assert.equal(M.validarBaixa('entregue', { entregueA: '', temFoto: false }).length, 1);
  assert.match(M.validarBaixa('entregue', { entregueA: 'x'.repeat(191), temFoto: true })[0], /190/);
});

test('validarBaixa: ocorrências exigem motivo de 3 a 500; parcial exige itens entregues', () => {
  for (const r of ['ausente', 'endereco_errado', 'recusa']) {
    assert.deepEqual(M.validarBaixa(r, { motivo: 'não atendeu' }), [], r);
    assert.match(M.validarBaixa(r, { motivo: 'ab' })[0], /motivo/i, r);
    assert.match(M.validarBaixa(r, { motivo: ' '.repeat(10) })[0], /motivo/i, r);
    assert.match(M.validarBaixa(r, { motivo: 'x'.repeat(501) })[0], /motivo/i, r);
  }
  assert.deepEqual(M.validarBaixa('parcial', { motivo: 'faltou uma', itens: PARCIAL }), []);
  assert.match(M.validarBaixa('parcial', { motivo: 'faltou uma', itens: [{ descricao: 'Porta', qtd: 0, max: 2 }] })[0], /item/i);
  assert.match(M.validarBaixa('parcial', { motivo: 'faltou uma', itens: [{ descricao: 'Porta', qtd: 5, max: 2 }] })[0], /quantidade/i);
  assert.match(M.validarBaixa('parcial', { motivo: 'faltou uma', itens: [{ descricao: 'Porta', qtd: 1.5, max: 2 }] })[0], /quantidade/i);
  assert.match(M.validarBaixa('parcial', { motivo: '', itens: PARCIAL })[0], /motivo/i);
  assert.match(M.validarBaixa('voando', {})[0], /resultado/i);
});

test('corpoBaixa e corpoOcorrencia: exatamente o que as rotas esperam', () => {
  assert.deepEqual(M.corpoBaixa({ entregueA: ' Maria ' }, [11, 12]), { entregueA: 'Maria', anexoIds: [11, 12] });
  assert.deepEqual(M.corpoOcorrencia('ausente', { motivo: ' ninguém atendeu ' }), { tipo: 'ausente', motivo: 'ninguém atendeu' });
  assert.deepEqual(M.corpoOcorrencia('recusa', { motivo: 'recusou', itens: PARCIAL }), { tipo: 'recusa', motivo: 'recusou' });
  assert.deepEqual(M.corpoOcorrencia('parcial', { motivo: 'faltou', itens: PARCIAL }),
    { tipo: 'parcial', motivo: 'faltou', itensEntregues: [{ descricao: 'Janela', qtd: 1 }] });
});

test('maxInteiro: quantidade máxima inteira de um item (mínimo 1)', () => {
  assert.equal(M.maxInteiro(3), 3);
  assert.equal(M.maxInteiro(2.5), 2);
  assert.equal(M.maxInteiro(0.4), 1);
  assert.equal(M.maxInteiro(null), 1);
});

// ---- estáticos ----
test('minhas_entregas.html: viewport, CSP, permissão, scripts e sem handlers inline', () => {
  const h = ler('minhas_entregas.html');
  assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)?.[1];
  assert.ok(csp, 'CSP presente');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src [^;]*blob:/);
  assert.match(csp, /connect-src [^;]*https:\/\/elegance-backend-hrho\.onrender\.com/);
  assert.match(h, /<script src="entregas_comum\.js[^"]*" defer>/);
  assert.match(h, /<script src="minhas_entregas\.js[^"]*" defer>/);
  assert.match(h, /<script src="layout\.js[^"]*" defer>/);
  assert.ok(h.indexOf('entregas_comum.js') < h.indexOf('minhas_entregas.js'), 'comum antes da tela');
  assert.match(h, /data-perm="entregas\.baixar"/);
  assert.match(h, /type="file"[^>]*accept="image\/\*"/);
  assert.doesNotMatch(h, /capture="environment"/); // galeria liberada: a foto é opcional
  assert.match(h, /<canvas[^>]*id="assinatura"/);
  assert.doesNotMatch(h, /\son[a-z]+=/i);
  assert.doesNotMatch(h, /R\$|valor|preço/i);
});

test('minhas_entregas.js: links tel:/maps dentro da CSP, abertura segura e nada de dinheiro', () => {
  const j = ler('minhas_entregas.js');
  assert.match(j, /target="_blank" rel="noopener"/);
  assert.match(j, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(j, /'tel:'/);
  assert.doesNotMatch(j, /\.(valor|preco|preço|total|desconto)\b/i);
  assert.doesNotMatch(j, /\son(click|change|submit|input|load)=/i);
  assert.doesNotMatch(j, /eval\(|new Function/);
});

test('entregas_comum.js é carregado pelas duas páginas', () => {
  assert.match(ler('entregas.html'), /<script src="entregas_comum\.js[^"]*" defer>/);
  assert.match(ler('minhas_entregas.html'), /<script src="entregas_comum\.js[^"]*" defer>/);
});

// layout.js real, num contexto simulado: Acesso.primeiraPaginaDe
function carregarLayout() {
  const ctx = {
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { pathname: '/x.html' }, fetch: async () => ({}), URL, console, setTimeout, clearTimeout,
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } }
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(ler('layout.js'), ctx);
  return ctx;
}

test('layout.js: Minhas entregas no menu e em PAGINAS (por último)', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'minhas_entregas\.html', texto: 'Minhas entregas', icone: 'entregas', sub: true \}/); // subitem de Entregas
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]/);
  const { ACESSO_PAGINAS } = carregarLayout();
  assert.equal(Object.keys(ACESSO_PAGINAS).pop(), 'minhas_entregas.html');
  // dentro da seção Comercial (antes de "Gestão")
  assert.ok(l.indexOf("href: 'minhas_entregas.html'") < l.indexOf("secao: 'Gestão'"));
});

test('primeira página: acesso só com entregas.baixar cai em minhas_entregas.html', () => {
  const { Acesso } = carregarLayout();
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['entregas.baixar'] }), 'minhas_entregas.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: [] }), null);
});

test('primeira página de quem já tinha acesso não muda (ex.: com entregas.baixar a mais)', () => {
  const { Acesso } = carregarLayout();
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['paineis.ver', 'entregas.baixar'] }), 'inicio.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['pedidos.ver', 'entregas.baixar'] }), 'painel_inicial.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['usuarios.ver', 'admin.usuarios', 'entregas.baixar'] }), 'usuarios.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['entregas.ver', 'entregas.baixar'] }), 'entregas.html');
  assert.equal(Acesso.primeiraPaginaDe({ permissoes: ['pedidos.ver'] }), 'painel_inicial.html');
});
