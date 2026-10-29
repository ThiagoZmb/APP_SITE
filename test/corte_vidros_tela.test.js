// Tela do plano de corte de vidros: lógica pura e conferência do HTML/layout estáticos (a captura real no navegador não tem teste automático).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../corte_vidros.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const peca = (o = {}) => ({ x: 0, y: 0, altura: 1200, largura: 800, girada: false, item: 1, medicao: 1, ...o });
const chapa = (o = {}) => ({ tipo: 'chapa', altura: 2400, largura: 3210, aproveitamentoPct: 55.5,
  pecas: [peca(), peca({ x: 800, altura: 800, largura: 1200, girada: true, item: 2 })],
  sobras: [{ x: 2000, y: 0, altura: 2400, largura: 1210 }], ...o });
const grupo = (o = {}) => ({ chave: 'Incolor|', modelo: 'Incolor', cor: '', produtoCodigo: 5, produtoNome: 'Vidro Incolor 8mm', aguardandoProduto: false,
  chapa: { altura: 2400, largura: 3210 }, chapas: [chapa()], erros: [], ...o });

test('formatação: mm com milhar, percentual com vírgula, medida AxL', () => {
  assert.match(T.mm(2400), /^2\.400 mm$/);
  assert.equal(T.mm(null), '—');
  assert.equal(T.pctTxt(55.5), '55,5%');
  assert.equal(T.pctTxt(undefined), '—');
  assert.match(T.medida(2400, 3210), /^2\.400 × 3\.210 mm$/);
  assert.equal(T.pct(250, 1000), 25);
  assert.equal(T.pct(1, 0), 0);
  assert.equal(T.pct(2000, 1000), 100);
});

test('chapa: caixa com aspect-ratio e peças em % da largura/altura, numeradas por item, giro indicado', () => {
  const html = T.htmlChapa(grupo(), grupo().chapas[0], 0, {});
  assert.match(html, /aspect-ratio:3210 \/ 2400/);
  assert.match(html, /Chapa nova/);
  // peça 1: x=0,y=0, 800 de largura e 1200 de altura numa chapa de 3210 x 2400
  assert.match(html, /left:0%;top:0%;width:24\.92%;height:50%/);
  // peça 2 girada: x=800
  assert.match(html, /left:24\.92%;top:0%;width:37\.38%;height:33\.33%/);
  assert.match(html, /girada/i);
  assert.match(html, /class="sobra-vidro"[^>]*left:62\.31%/);
  assert.match(html, /Item 1/); assert.match(html, /Item 2/);
  assert.match(html, /55,5%/);
});

test('retalho é destacado e mostra o número; peça cortada fica marcada e só é clicável quando permitido', () => {
  const g = grupo({ chapas: [chapa({ tipo: 'retalho', retalhoId: 7, altura: 1500, largura: 1000, pecas: [peca({ altura: 500, largura: 400 })], sobras: [] })] });
  const html = T.htmlChapa(g, g.chapas[0], 0, { cortadas: new Set([T.chaveCortada('Incolor|', 0, 0)]), clicavel: true });
  assert.match(html, /Retalho nº 7/);
  assert.match(html, /class="chapa retalho/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /class="peca-v cortada"/);
  assert.doesNotMatch(html, /disabled/);
  assert.match(T.htmlChapa(g, g.chapas[0], 0, {}), /disabled/);
  // a escala é a mesma do grupo: o retalho (1500 de 2400) é menor que a chapa
  assert.match(html, /height:\d+px/);
});

test('texto vindo do servidor sai escapado (modelo, cor, produto, motivo)', () => {
  const mau = '<img src=x onerror=alert(1)>';
  const g = grupo({ chave: mau, modelo: mau, cor: mau, produtoNome: mau });
  const html = T.htmlGrupo(g, {}, 0);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(T.htmlPendencias([{ item: 3, modelo: mau, motivo: mau }]), /<img/);
  assert.doesNotMatch(T.htmlBloqueios(T.motivosBloqueio({ grupos: [grupo({ modelo: mau, aguardandoProduto: true, chapas: [] })] })), /<img/);
  assert.doesNotMatch(T.htmlSeletorProdutos([{ chave: mau, modelo: mau, cor: mau, qtdPecas: 1, candidatos: [{ codigo: 1, nome: mau, altura: 1, largura: 1 }], preSelecionado: null }], {}), /<img/);
  assert.doesNotMatch(T.htmlRetalhos([{ id: 1, produtoCodigo: 1, produtoNome: mau, altura: 1, largura: 1, situacao: 'disponivel', planoOrigem: null, planoReserva: null }], true), /<img/);
});

test('grupo sem cor é rotulado; andamento "X de Y peças cortadas"', () => {
  const g = grupo();
  const html = T.htmlGrupo(g, { cortadas: new Set([T.chaveCortada('Incolor|', 0, 1)]) }, 2);
  assert.match(html, /sem cor/);
  assert.match(html, /1 de 2 peças cortadas/);
  assert.ok(html.includes(`style="${T.estiloGrupo(2)}"`));
  assert.equal(T.estiloGrupo(8), T.estiloGrupo(0));
  assert.equal(T.contarPecas({ grupos: [g, g] }), 4);
  assert.equal(T.contarPecas(null), 0);
});

test('bloqueio do Salvar: grupo aguardando produto ou com erros mostra os motivos', () => {
  assert.deepEqual(T.motivosBloqueio({ grupos: [grupo()] }), []);
  const m = T.motivosBloqueio({ grupos: [grupo({ modelo: 'Fumê', cor: 'Verde', aguardandoProduto: true, produtoCodigo: null, chapas: [] }),
    grupo({ modelo: 'Incolor', erros: ['Peça do item 2 (3000 x 4000 mm) maior que a chapa'] })] });
  assert.equal(m.length, 2);
  assert.match(m[0], /Fumê/); assert.match(m[0], /escolha o produto/i);
  assert.match(m[1], /maior que a chapa/);
  assert.match(T.htmlBloqueios(m), /role="alert"/);
  assert.equal(T.htmlBloqueios([]), '');
});

test('seletor de produto: candidatos do grupo, pré-selecionado, escolha do usuário manda', () => {
  const grupos = [{ chave: 'Incolor|', modelo: 'Incolor', cor: '', qtdPecas: 3, preSelecionado: 5,
    candidatos: [{ codigo: 5, nome: 'Vidro Incolor 8mm', altura: 2400, largura: 3210 }, { codigo: 6, nome: 'Vidro Incolor 10mm', altura: 2200, largura: 3300 }] }];
  const html = T.htmlSeletorProdutos(grupos, {});
  assert.match(html, /class="escolha-produto" data-chave="Incolor\|"/);
  assert.match(html, /<option value="5" selected>Vidro Incolor 8mm \(2\.400 × 3\.210 mm\)<\/option>/);
  assert.match(html, /<option value="">— escolha o produto —<\/option>/);
  assert.match(T.htmlSeletorProdutos(grupos, { 'Incolor|': 6 }), /<option value="6" selected>/);
  assert.doesNotMatch(T.htmlSeletorProdutos(grupos, { 'Incolor|': 6 }), /<option value="5" selected>/);
  // sem candidato pelo nome: o seletor existe e avisa
  assert.match(T.htmlSeletorProdutos([{ ...grupos[0], candidatos: [], preSelecionado: null }], {}), /Nenhum vidro do estoque/);
  assert.equal(T.htmlSeletorProdutos([], {}), '');
});

test('escolhas: efetivas = escolha do usuário ou pré-selecionado; vão na query em JSON codificado', () => {
  const grupos = [{ chave: 'A|', preSelecionado: 5 }, { chave: 'B|', preSelecionado: null }, { chave: 'C|', preSelecionado: 9 }];
  assert.deepEqual(T.escolhasEfetivas(grupos, { 'C|': 7, 'B|': 4 }), { 'A|': 5, 'B|': 4, 'C|': 7 });
  assert.deepEqual(T.escolhasEfetivas(grupos, {}), { 'A|': 5, 'C|': 9 });
  assert.equal(T.queryEscolhas({}), '');
  const q = T.queryEscolhas({ 'A|': 5 });
  assert.equal(q, '?escolhas=' + encodeURIComponent('{"A|":5}'));
  assert.deepEqual(T.corpoSalvar({ impressao: 'abc', retalhosUsados: [7], outro: 1 }, { 'A|': 5 }), { impressao: 'abc', retalhosUsados: [7], escolhas: { 'A|': 5 } });
});

test('resumo, pendências e status do plano', () => {
  const r = T.htmlResumo({ qtdChapasNovas: 2, qtdRetalhosUsados: 1, aproveitamentoPct: 83.3 });
  assert.match(r, /2/); assert.match(r, /83,3%/);
  assert.equal(T.htmlPendencias([]), '');
  assert.match(T.htmlPendencias([{ item: 3, motivo: 'Sem medida' }]), /Item 3/);
  assert.match(T.textoStatusPlano({ modo: 'previa', planoSalvoConferido: false }), /Salve o plano para marcar as peças cortadas/);
  assert.match(T.textoStatusPlano({ modo: 'previa', planoSalvoConferido: true }), /já tem um plano conferido/);
  const s = T.textoStatusPlano({ modo: 'salvo', salvo: { id: 5, situacao: 'gerado' }, total: 8, cortadas: 3 });
  assert.match(s, /Plano nº 5/); assert.match(s, /3 de 8 peças cortadas/); assert.match(s, /clique numa peça/i);
  assert.doesNotMatch(T.textoStatusPlano({ modo: 'salvo', salvo: { id: 5, situacao: 'conferido' }, total: 8, cortadas: 8 }), /clique numa peça/i);
});

// ---- conferência ----
test('conferência: cada sobra de cada chapa vira uma linha com medida real e destino; retalho ganha "não usado"', () => {
  const g = grupo({ chapas: [chapa({ sobras: [{ x: 0, y: 0, altura: 600, largura: 500 }, { x: 0, y: 0, altura: 400, largura: 350 }] }),
    chapa({ tipo: 'retalho', retalhoId: 3, pecas: [peca()], sobras: [] })] });
  const html = T.htmlGrupo(g, { conferindo: true }, 0);
  assert.equal((html.match(/class="conf-linha"/g) || []).length, 2);
  assert.match(html, /data-grupo="Incolor\|" data-chapa="0" data-sobra="1"/);
  assert.match(html, /class="conf-altura"[^>]*value="400"/);
  assert.match(html, /class="conf-largura"[^>]*value="350"/);
  assert.match(html, /<option value="guardar" selected>/);
  assert.match(html, /class="conf-naousado" data-id="3"/);
});

test('corpos de envio: sobras com chapa/sobra/altura/largura, retalhos não usados, baixas', () => {
  const linhas = [{ grupo: 'G', chapa: 0, sobra: 0, destino: 'guardar', altura: '590', largura: '500' }, { grupo: 'G', chapa: 1, sobra: 0, destino: 'descartar', altura: '', largura: '' }];
  const baixas = [{ chave: 'G', produtoCodigo: 5 }];
  assert.deepEqual(T.corpoConferencia(linhas, [7], baixas), {
    sobras: [{ grupo: 'G', chapa: 0, sobra: 0, destino: 'guardar', altura: 590, largura: 500 }, { grupo: 'G', chapa: 1, sobra: 0, destino: 'descartar' }],
    retalhosNaoUsados: [7], baixas });
});

test('conferência na tela recusa medida maior que a calculada, abaixo da sobra mínima, zero e texto, como o servidor', () => {
  const plano = { grupos: [{ chave: 'G', chapas: [{ sobras: [{ altura: 600, largura: 500 }] }] }] };
  const linha = (altura, largura, destino = 'guardar') => ({ grupo: 'G', chapa: 0, sobra: 0, destino, altura, largura });
  assert.deepEqual(T.validarConferenciaForm([linha('590', '500')], plano, 300), []);
  for (const [a, l] of [['601', '500'], ['600', '501'], ['0', '500'], ['abc', '500'], ['', ''], ['12,5', '500'], ['299', '500'], ['600', '299']])
    assert.equal(T.validarConferenciaForm([linha(a, l)], plano, 300).length, 1, `${a}x${l}`);
  assert.deepEqual(T.validarConferenciaForm([linha('', '', 'descartar')], plano, 300), []);   // descartar não exige medida
});

test('baixa no estoque: uma linha por produto com a SOMA de chapas novas; retalho não conta; corpo é por grupo', () => {
  const plano = { grupos: [
    grupo({ chave: 'A|', modelo: 'A', produtoCodigo: 5, produtoNome: 'Vidro A', chapas: [chapa(), chapa(), chapa({ tipo: 'retalho', retalhoId: 1 })] }),
    grupo({ chave: 'B|', modelo: 'B', produtoCodigo: 5, produtoNome: 'Vidro A', chapas: [chapa()] }),
    grupo({ chave: 'C|', modelo: 'C', produtoCodigo: 8, produtoNome: 'Vidro C', chapas: [chapa({ tipo: 'retalho', retalhoId: 2 })] })] };
  const grupos = T.gruposComChapasNovas(plano);
  assert.deepEqual(grupos.map(g => [g.chave, g.chapas, g.produtoCodigo]), [['A|', 2, 5], ['B|', 1, 5]]);   // C só tem retalho: fora
  assert.deepEqual(T.corpoBaixas(grupos), [{ chave: 'A|', produtoCodigo: 5 }, { chave: 'B|', produtoCodigo: 5 }]);
  assert.deepEqual(T.produtosDaBaixa(grupos), [{ produtoCodigo: 5, produtoNome: 'Vidro A', chapas: 3 }]);
  const html = T.htmlBaixaEstoque(grupos);
  assert.match(html, /Baixa no estoque/);
  assert.match(html, /Vidro A/); assert.match(html, /3 chapas novas/);
  assert.equal((html.match(/class="baixa-linha"/g) || []).length, 1);
  assert.equal(T.htmlBaixaEstoque([]), '');
  assert.match(T.htmlBaixaEstoque([{ chave: 'A|', modelo: 'A', cor: '', produtoCodigo: 5, produtoNome: 'V', chapas: 1 }]), /1 chapa nova/);
});

test('baixa no estoque: valida produto do grupo antes de enviar', () => {
  assert.deepEqual(T.validarBaixas([{ chave: 'A|', modelo: 'A', cor: '', produtoCodigo: 5, chapas: 1 }]), []);
  assert.match(T.validarBaixas([{ chave: 'A|', modelo: 'A', cor: 'Verde', produtoCodigo: null, chapas: 1 }])[0], /Escolha o produto.*A/);
});

// ---- retalhos e parâmetros ----
test('lista de retalhos: ações só com permissão e só para retalho disponível; reservado ganha cancelar plano', () => {
  const lista = [{ id: 1, produtoCodigo: 5, produtoNome: 'Vidro A', altura: 1500, largura: 900, situacao: 'disponivel', planoOrigem: null, planoReserva: null },
    { id: 2, produtoCodigo: 5, produtoNome: 'Vidro A', altura: 800, largura: 700, situacao: 'reservado', planoOrigem: null, planoReserva: 9 }];
  const com = T.htmlRetalhos(lista, true), sem = T.htmlRetalhos(lista, false);
  assert.equal((com.match(/data-acao="descartar"/g) || []).length, 1);
  assert.doesNotMatch(sem, /data-acao=/);
  assert.match(T.htmlRetalhos(lista, false, true), /data-acao="cancelar-plano" data-plano="9"/);
  assert.doesNotMatch(T.htmlRetalhos(lista, true, false), /cancelar-plano/);
  assert.match(T.htmlRetalhos([], true), /Nenhum retalho/);
  assert.match(com, /1\.500 × 900 mm/);
});

test('parâmetros: mostra serra e sobra mínima', () => {
  const html = T.htmlConfig({ padrao: { serra: 0, sobraMinima: 300 } });
  assert.match(html, /Serra/); assert.match(html, /300 mm/);
});

test('exclusão: confirmação mais forte quando há plano conferido', () => {
  const base = T.textoConfirmarExclusao({ pedido: { numero: 12 }, qtdPlanosGravados: 2, qtdConferidos: 0 });
  assert.match(base, /pedido nº 12/); assert.doesNotMatch(base, /ATENÇÃO/);
  assert.match(T.textoConfirmarExclusao({ pedido: { numero: 12 }, qtdPlanosGravados: 1, qtdConferidos: 1 }), /ATENÇÃO/);
});

// ---- arquivos ----
test('HTML: todo id usado pelo JS existe, CSP presente, três abas, scripts carregados', () => {
  const html = ler('corte_vidros.html'), js = ler('corte_vidros.js');
  const usados = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(usados.length > 15);
  for (const id of new Set(usados)) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" em corte_vidros.html`);
  assert.match(html, /Content-Security-Policy/);
  for (const aba of ['plano', 'retalhos', 'config']) assert.match(html, new RegExp(`data-aba="${aba}"`));
  assert.match(html, /<script src="entregas_comum\.js/);
  assert.match(html, /<script src="corte_vidros\.js/);
  assert.match(html, /<script src="layout\.js/);
  assert.match(html, /\.baixa-estoque \{/);
  assert.match(html, /\.chapa \{/);
  assert.match(html, /\.escolha-produto|\.escolhas/);
});

test('JS: chama cada rota do corte de vidros e usa escolhas; baixa só com permissão de estoque', () => {
  const js = ler('corte_vidros.js');
  for (const rota of ['/corte_vidros/pedido/', '/salvar', '/corte_vidros/plano/', '/pecas', '/confirmar', '/cancelar', '/corte_vidros/config', '/corte_vidros/retalhos', '/descartar', '/corte_vidros/estoque/produtos'])
    assert.ok(js.includes(rota), `falta ${rota}`);
  assert.match(js, /metodo: 'DELETE'/);
  assert.match(js, /encodeURIComponent/);
  assert.match(js, /escolhas/);
  assert.match(js, /pode\('estoque\.movimentar'\)/);
  assert.match(js, /corte_vidros_marcas_/);
  assert.match(js, /ESPERA_ENVIO_MS = 3000/);
  assert.match(js, /ESPERA_REENVIO_MS = 15000/);
  assert.match(js, /pagehide/);
});

test('JS: nenhum innerHTML recebe dado do servidor sem passar por montador que escapa', () => {
  const js = ler('corte_vidros.js');
  const atribuicoes = [...js.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)].map(m => m[1].trim());
  assert.ok(atribuicoes.length > 3);
  for (const a of atribuicoes) assert.match(a, /html\w+\(|esc\(|^'[^'$]*'$/, `innerHTML suspeito: ${a}`);
});

test('menu: Corte de vidros no layout com a permissão corte.ver', () => {
  const layout = ler('layout.js');
  assert.match(layout, /\{ href: 'corte_vidros\.html', texto: 'Corte de vidros', icone: 'corte', sub: true \}/);
  assert.match(layout, /'corte_vidros\.html': \['corte\.ver'\]/);
});

// ---- avisos da conferência e do saldo ----
test('retalhosNaoUsadosComPecas: só retalhos marcados como não usados que têm peças planejadas', () => {
  const plano = { grupos: [grupo({ chapas: [chapa({ tipo: 'retalho', retalhoId: 3, pecas: [peca()] }), chapa({ tipo: 'retalho', retalhoId: 4, pecas: [] }),
    chapa({ tipo: 'retalho', retalhoId: 5, pecas: [peca()] }), chapa()] })] };
  assert.deepEqual(T.retalhosNaoUsadosComPecas(plano, [3, 4]), [3]);
  assert.deepEqual(T.retalhosNaoUsadosComPecas(plano, []), []);
  assert.deepEqual(T.retalhosNaoUsadosComPecas(plano, [99]), []);
  assert.deepEqual(T.retalhosNaoUsadosComPecas(null, [3]), []);
});

test('textoAvisosConfirmacao: avisa retalho não usado com peças e plano desatualizado; sem motivo, vazio', () => {
  const sem = T.textoAvisosConfirmacao({ retalhosComPecas: [], situacao: 'gerado' });
  assert.equal(sem, '');
  const ret = T.textoAvisosConfirmacao({ retalhosComPecas: [3], situacao: 'gerado' });
  assert.match(ret, /As peças planejadas em retalho marcado como não usado NÃO terão baixa no estoque\. Se você cortou essas peças de uma chapa nova, cancele, refaça o plano ou lance a saída de estoque manualmente\./);
  assert.doesNotMatch(ret, /pedido mudou/);
  const des = T.textoAvisosConfirmacao({ retalhosComPecas: [], situacao: 'desatualizado' });
  assert.match(des, /O pedido mudou depois que este plano foi gerado\. A baixa será feita pelo plano salvo\./);
  const ambos = T.textoAvisosConfirmacao({ retalhosComPecas: [3], situacao: 'desatualizado' });
  assert.match(ambos, /NÃO terão baixa/); assert.match(ambos, /pedido mudou/);
});

test('avisosSaldo: soma as chapas NOVAS por produto e avisa só quando excede o saldo', () => {
  const candidatos = [{ codigo: 5, nome: 'Vidro A', qtdEstoque: 3 }, { codigo: 8, nome: 'Vidro C', qtdEstoque: 10 }];
  const plano = { grupos: [
    grupo({ chave: 'A|', modelo: 'A', produtoCodigo: 5, chapas: [chapa(), chapa(), chapa({ tipo: 'retalho', retalhoId: 1 })] }),
    grupo({ chave: 'B|', modelo: 'B', produtoCodigo: 5, chapas: [chapa(), chapa()] }),
    grupo({ chave: 'C|', modelo: 'C', produtoCodigo: 8, chapas: [chapa()] }),
    grupo({ chave: 'D|', modelo: 'D', aguardandoProduto: true, produtoCodigo: null, chapas: [] })] };
  const a = T.avisosSaldo(plano, candidatos);
  assert.equal(a.length, 1);
  assert.equal(a[0].produtoCodigo, 5);
  assert.equal(a[0].necessarias, 4); assert.equal(a[0].saldo, 3);
  assert.deepEqual(T.avisosSaldo(plano, [{ codigo: 5, nome: 'Vidro A', qtdEstoque: 4 }]), []);
  assert.deepEqual(T.avisosSaldo(plano, []), []);   // sem saldo conhecido não avisa
  assert.match(T.htmlAvisosSaldo(a), /4 chapas novas/);
  assert.match(T.htmlAvisosSaldo(a), /3 no estoque/);
  assert.equal(T.htmlAvisosSaldo([]), '');
});

test('seletor de produtos mostra "N chapas no estoque" por opção, com escape', () => {
  const grupos = [{ chave: 'Incolor|', modelo: 'Incolor', cor: '', qtdPecas: 2, preSelecionado: 5,
    candidatos: [{ codigo: 5, nome: 'Vidro <b>A</b>', altura: 2400, largura: 3210, qtdEstoque: 1 }, { codigo: 6, nome: 'Vidro B', altura: 2400, largura: 2200, qtdEstoque: 12 }] }];
  const html = T.htmlSeletorProdutos(grupos, {});
  assert.match(html, /1 chapa no estoque/);
  assert.match(html, /12 chapas no estoque/);
  assert.doesNotMatch(html, /<b>A<\/b>/);
});

test('confirmar usa os avisos puros (texto fixo do retalho não usado e do plano desatualizado)', () => {
  const js = ler('corte_vidros.js');
  assert.match(js, /textoAvisosConfirmacao/); assert.match(js, /retalhosNaoUsadosComPecas/); assert.match(js, /avisosSaldo/);
});

test('menu: Corte de vidros no botão direito dos pedidos, abaixo do Corte de perfil', () => {
  const html = ler('painel_inicial.html');
  assert.match(html, /add\('corte\.ver'[^\n]*Corte de vidros[^\n]*corte_vidros\.html\?numero=/);
  assert.ok(html.indexOf('Corte de perfil') < html.indexOf('Corte de vidros'), 'Corte de perfil deve vir antes de Corte de vidros');
  const linhaVidros = html.split('\n').find(l => l.includes("'Corte de vidros'"));
  assert.match(linhaVidros, /if \(ehPedido && !cancelado\) add\('corte\.ver'/);
});

test('lista de pedidos: filtro por número ou cliente e ligação do botão Abrir no HTML', () => {
  const lista = [{ numero: 1234, cliente: 'Construtora São João', data: '01/10/2026', situacao: 'Pronto' }, { numero: 99, cliente: 'Outro', data: '', situacao: '' }];
  assert.deepEqual(T.filtrarPedidos(lista, 'joao').map(p => p.numero), [1234]);
  assert.deepEqual(T.filtrarPedidos(lista, '99').map(p => p.numero), [99]);
  assert.match(T.htmlListaPedidos(lista, ''), /data-numero="99"/);
  assert.match(T.htmlListaPedidos(lista, 'zzz'), /Nenhum pedido/);
  const html = ler('corte_vidros.html'), js = ler('corte_vidros.js');
  assert.match(html, /id="btn-abrir"/); assert.match(html, /id="lista-pedidos"/); assert.match(html, /id="numero"/);
  assert.match(js, /chamar\('\/corte\/pedidos'\)/);
});
