// Tela do plano de corte: lógica pura e conferência do HTML/layout estáticos (a captura real no navegador não tem teste automático).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../corte.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const barra = (o = {}) => ({ tipo: 'vara', retalhoId: null, comprimento: 6000, sobra: 997, destinoSobra: 'guardar',
  pecas: [{ tamanho: 2100, item: 1, origem: 'porta-altura' }, { tamanho: 900, item: 1, origem: 'porta-largura' }], ...o });

test('formatação: mm com milhar, percentual com vírgula, "—" para ausente', () => {
  assert.match(T.mm(6000), /^6\.000 mm$/);
  assert.equal(T.mm(null), '—');
  assert.equal(T.pctTxt(83.3), '83,3%');
  assert.equal(T.pctTxt(undefined), '—');
  assert.equal(T.larguraPct(1500, 6000), 25);
  assert.equal(T.larguraPct(1, 0), 0);
  assert.equal(T.larguraPct(7000, 6000), 100);   // nunca passa de 100%
});

test('rótulos de origem e de situação do plano', () => {
  assert.equal(T.rotuloOrigem('porta-altura'), 'Altura');
  assert.equal(T.rotuloOrigem('puxador'), 'Puxador');
  assert.equal(T.rotuloOrigem('xyz'), 'xyz');
  assert.match(T.rotuloSituacao('desatualizado'), /pedido mudou/i);
  assert.match(T.rotuloSituacao('gerado'), /aguardando corte/i);
});

test('barra: peças proporcionais, sobra rotulada, peça cortada marcada, tudo escapado', () => {
  const html = T.htmlBarra('P100|Anodizado|Natural', barra({ pecas: [{ tamanho: 3000, item: 1, origem: 'puxador' }] }), 0, { cortadas: new Set([T.chaveCortada('P100|Anodizado|Natural', 0, 0)]) });
  assert.match(html, /width:50%/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Vara nova/);
  assert.match(html, /Sobra/);
  const retalho = T.htmlBarra('G', barra({ tipo: 'retalho', retalhoId: 7, comprimento: 2200, sobra: 97, destinoSobra: 'descartar' }), 2, {});
  assert.match(retalho, /Retalho nº 7/);
  assert.match(retalho, /descartar/i);
  const mau = T.htmlBarra('<img src=x onerror=alert(1)>', barra(), 0, {});
  assert.doesNotMatch(mau, /<img/);
});

test('resumo, pendências e erros: texto explicado e escapado', () => {
  const r = T.htmlResumo({ qtdVarasNovas: 2, qtdRetalhosUsados: 1, aproveitamentoPct: 83.3, sobraSomaMm: 1200 });
  assert.match(r, /2/); assert.match(r, /83,3%/); assert.match(r, /1\.200 mm/);
  assert.equal(T.htmlPendencias([]), '');
  const p = T.htmlPendencias([{ item: 3, perfil: '<b>P</b>', motivo: 'Perfil sem cor' }]);
  assert.match(p, /Item 3/); assert.doesNotMatch(p, /<b>P<\/b>/); assert.match(p, /&lt;b&gt;P/);
  assert.match(T.htmlErros([{ peca: { tamanho: 7000, perfil: 'P', item: 1 }, motivo: 'Peça maior que a vara' }]), /7\.000 mm/);
});

test('corpos de envio: salvar leva impressão e retalhos; conferência leva sobras e retalhos não usados', () => {
  assert.deepEqual(T.corpoSalvar({ impressao: 'abc', retalhosUsados: [7], outro: 1 }), { impressao: 'abc', retalhosUsados: [7] });
  const linhas = [{ grupo: 'G', barra: 0, destino: 'guardar', medida: '990' }, { grupo: 'G', barra: 1, destino: 'descartar', medida: '' }];
  assert.deepEqual(T.corpoConferencia(linhas, [7]), {
    sobras: [{ grupo: 'G', barra: 0, destino: 'guardar', medidaReal: 990 }, { grupo: 'G', barra: 1, destino: 'descartar' }], retalhosNaoUsados: [7] });
});

test('conferência na tela recusa medida maior que a sobra, zero e texto, como o servidor', () => {
  const plano = { grupos: [{ chave: 'G', barras: [barra({ sobra: 997 })] }] };
  assert.deepEqual(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'guardar', medida: '990' }], plano), []);
  for (const medida of ['998', '0', 'abc', '', '12,5']) assert.equal(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'guardar', medida }], plano).length, 1, medida);
  assert.deepEqual(T.validarConferenciaForm([{ grupo: 'G', barra: 0, destino: 'descartar', medida: '' }], plano), []);
});

test('lista de retalhos: ações só com permissão e só para retalho disponível', () => {
  const lista = [{ id: 1, perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 1500, situacao: 'disponivel', planoOrigem: null, planoReserva: null },
    { id: 2, perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 800, situacao: 'reservado', planoOrigem: null, planoReserva: 9 }];
  const com = T.htmlRetalhos(lista, true), sem = T.htmlRetalhos(lista, false);
  assert.equal((com.match(/data-acao="descartar"/g) || []).length, 1);
  assert.doesNotMatch(sem, /data-acao=/);
  assert.match(T.htmlRetalhos([], true), /Nenhum retalho/);
});

test('HTML: todo id usado pelo JS existe, CSP presente, scripts carregados', () => {
  const html = ler('corte.html'), js = ler('corte.js');
  const usados = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(usados.length > 15);
  for (const id of new Set(usados)) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" em corte.html`);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<script src="entregas_comum\.js/);
  assert.match(html, /<script src="corte\.js/);
  assert.match(html, /<script src="layout\.js/);
});

test('menu: Plano de corte no layout e no botão direito dos pedidos', () => {
  const layout = ler('layout.js');
  assert.match(layout, /href: 'corte\.html'/);
  assert.match(layout, /'corte\.html': \['corte\.ver'\]/);
  const painel = ler('painel_inicial.html');
  assert.match(painel, /add\('corte\.ver'[^\n]*Plano de corte[^\n]*corte\.html\?numero=/);
});

test('retalho reservado: quem planeja pode cancelar o plano que o prende (saída para reserva órfã)', () => {
  const lista = [{ id: 2, perfil: 'P', acabamento: 'A', cor: 'C', comprimento: 800, situacao: 'reservado', planoOrigem: null, planoReserva: 9 }];
  const com = T.htmlRetalhos(lista, false, true);
  assert.match(com, /data-acao="cancelar-plano" data-plano="9"/);
  assert.doesNotMatch(T.htmlRetalhos(lista, false, false), /cancelar-plano/);
  assert.doesNotMatch(T.htmlRetalhos(lista, true, false), /cancelar-plano/);
});

test('grupo sem acabamento ou sem cor é rotulado em vez de ficar em branco', () => {
  const html = T.htmlGrupo({ chave: 'P||', perfil: 'P', acabamento: '', cor: '', barras: [barra()] }, {});
  assert.match(html, /sem acabamento/);
  assert.match(html, /sem cor/);
  assert.match(T.htmlRetalhos([{ id: 1, perfil: 'P', acabamento: 'Anodizado', cor: '', comprimento: 900, situacao: 'disponivel', planoOrigem: null, planoReserva: null }], false), /sem cor/);
});

// ---- cores por perfil, andamento do corte ----
test('cada perfil tem uma cor própria (fundo, faixa, peça), diferente da vizinha, e a paleta recomeça depois de 8', () => {
  const estilos = [0, 1, 2, 3, 4, 5, 6, 7].map(T.estiloGrupo);
  assert.equal(new Set(estilos).size, 8);
  for (const e of estilos) { assert.match(e, /--g-solido:/); assert.match(e, /--g-fundo:/); assert.match(e, /--g-peca:/); }
  assert.equal(T.estiloGrupo(8), T.estiloGrupo(0));
});

test('grupo: nome do perfil em destaque, cor do grupo aplicada e andamento "X de Y peças cortadas"', () => {
  const g = { chave: 'P|A|C', perfil: 'P', acabamento: 'A', cor: 'C', barras: [barra({ pecas: [{ tamanho: 1000, item: 1, origem: 'porta-altura' }, { tamanho: 900, item: 1, origem: 'porta-largura' }] }),
    barra({ pecas: [{ tamanho: 500, item: 2, origem: 'puxador' }] })] };
  const cortadas = new Set([T.chaveCortada('P|A|C', 0, 0), T.chaveCortada('P|A|C', 1, 0)]);
  const html = T.htmlGrupo(g, { cortadas }, 2);
  assert.ok(html.includes(`style="${T.estiloGrupo(2)}"`));
  assert.match(html, /<span class="nome-perfil">P<\/span>/);
  assert.match(html, /2 de 3 peças cortadas/);
  assert.match(html, /class="barra completa"/);                  // só a segunda vara está toda cortada
  assert.equal((html.match(/class="barra completa"/g) || []).length, 1);
  assert.match(html, /Vara completa/);
});

test('texto de status: pré-visualização explica que é preciso salvar para dar baixa; plano salvo mostra o andamento', () => {
  assert.match(T.textoStatusPlano({ modo: 'previa', planoSalvoConferido: false }), /Salve o plano para marcar as peças cortadas/);
  assert.match(T.textoStatusPlano({ modo: 'previa', planoSalvoConferido: true }), /já tem um plano conferido/);
  const s = T.textoStatusPlano({ modo: 'salvo', salvo: { id: 5, situacao: 'gerado' }, total: 8, cortadas: 3 });
  assert.match(s, /Plano nº 5/); assert.match(s, /3 de 8 peças cortadas/); assert.match(s, /clique numa peça/i);
  assert.doesNotMatch(T.textoStatusPlano({ modo: 'salvo', salvo: { id: 5, situacao: 'conferido' }, total: 8, cortadas: 8 }), /clique numa peça/i);
});

test('contarPecas soma as peças de todas as varas do plano', () => {
  assert.equal(T.contarPecas({ grupos: [{ barras: [barra(), barra({ pecas: [{ tamanho: 1, item: 1, origem: 'puxador' }] })] }] }), 3);
  assert.equal(T.contarPecas({ grupos: [] }), 0);
});

// ---- baixa no estoque das varas novas (bloco "Baixa no estoque" da conferência) ----
const planoBaixa = () => ({ grupos: [
  { chave: 'P100|Anodizado|Natural', perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', barras: [barra(), barra(), barra({ tipo: 'retalho', retalhoId: 3, comprimento: 2200 })] },
  { chave: 'P200||', perfil: 'P200', acabamento: '', cor: '', barras: [barra({ tipo: 'retalho', retalhoId: 4, comprimento: 3000 })] }] });
const produtosBaixa = [{ codigo: 1, nome: 'P100', unidade: 'Barra', qtdEstoque: 50 }, { codigo: 2, nome: '  p200 ', unidade: '', qtdEstoque: 7 }, { codigo: 3, nome: '<b>X</b>', unidade: 'Un', qtdEstoque: 1 }];

test('baixa: só entram os grupos com vara nova, contando as varas (retalho não conta)', () => {
  assert.deepEqual(T.gruposComVarasNovas(planoBaixa()), [{ chave: 'P100|Anodizado|Natural', perfil: 'P100', acabamento: 'Anodizado', cor: 'Natural', varas: 2 }]);
  assert.deepEqual(T.gruposComVarasNovas({ grupos: [] }), []);
  assert.deepEqual(T.gruposComVarasNovas(null), []);
});

test('baixa: produto pré-selecionado quando o nome bate com o perfil (sem caixa/espaços); sem nome igual ou ambíguo, o usuário escolhe', () => {
  assert.equal(T.sugerirProduto('P100', produtosBaixa), 1);
  assert.equal(T.sugerirProduto(' p200', produtosBaixa), 2);
  assert.equal(T.sugerirProduto('P999', produtosBaixa), null);
  assert.equal(T.sugerirProduto('', produtosBaixa), null);
  assert.equal(T.sugerirProduto('A', [{ codigo: 1, nome: 'A' }, { codigo: 2, nome: 'a' }]), null);   // dois iguais: não adivinha
});

test('baixa: bloco com perfil, acabamento/cor, nº de varas e seletor de produto, tudo escapado', () => {
  const grupos = T.gruposComVarasNovas(planoBaixa());
  const html = T.htmlBaixaEstoque(grupos, produtosBaixa);
  assert.match(html, /Baixa no estoque/);
  assert.match(html, /<b>P100<\/b>/);
  assert.match(html, /Anodizado/); assert.match(html, /Natural/);
  assert.match(html, /2 varas novas/);
  assert.match(html, /class="baixa-produto" data-chave="P100\|Anodizado\|Natural"/);
  assert.match(html, /<option value="1" selected>P100 \(estoque: 50 Barra\)<\/option>/);   // pré-selecionado
  assert.match(html, /<option value="">— escolha o produto —<\/option>/);
  assert.doesNotMatch(html, /<b>X<\/b>/); assert.match(html, /&lt;b&gt;X/);
  assert.match(T.htmlBaixaEstoque([{ chave: 'G', perfil: 'P', acabamento: '', cor: '', varas: 1 }], produtosBaixa), /1 vara nova/);
  assert.match(T.htmlBaixaEstoque([{ chave: 'G', perfil: 'P', acabamento: '', cor: '', varas: 1 }], produtosBaixa), /sem acabamento/);
  assert.equal(T.htmlBaixaEstoque([], produtosBaixa), '');
  // escolha do usuário vale mais que a sugestão
  assert.match(T.htmlBaixaEstoque(grupos, produtosBaixa, { 'P100|Anodizado|Natural': 2 }), /<option value="2" selected>/);
  // lista não carregada: avisa em vez de oferecer seletor vazio
  const semLista = T.htmlBaixaEstoque(grupos, null);
  assert.match(semLista, /role="alert"/); assert.doesNotMatch(semLista, /<select/);
});

test('baixa: corpo de envio leva {chave, produtoCodigo}; a conferência só ganha "baixas" quando informadas', () => {
  const baixas = T.corpoBaixas([{ chave: 'G', produtoCodigo: '7' }]);
  assert.deepEqual(baixas, [{ chave: 'G', produtoCodigo: 7 }]);
  assert.deepEqual(T.corpoConferencia([], [], baixas), { sobras: [], retalhosNaoUsados: [], baixas });
  assert.deepEqual(T.corpoConferencia([], []), { sobras: [], retalhosNaoUsados: [] });
});

test('baixa: a tela recusa grupo sem produto e produto repetido, como o servidor', () => {
  const grupos = [{ chave: 'A', perfil: 'P1', acabamento: '', cor: '', varas: 1 }, { chave: 'B', perfil: 'P2', acabamento: 'X', cor: 'Y', varas: 2 }];
  assert.deepEqual(T.validarBaixasForm(grupos, [{ chave: 'A', produtoCodigo: '1' }, { chave: 'B', produtoCodigo: '2' }]), []);
  assert.match(T.validarBaixasForm(grupos, [{ chave: 'A', produtoCodigo: '1' }, { chave: 'B', produtoCodigo: '' }])[0], /Escolha o produto do estoque para P2/);
  assert.match(T.validarBaixasForm(grupos, [{ chave: 'A', produtoCodigo: '1' }])[0], /Escolha o produto/);
  assert.match(T.validarBaixasForm(grupos, [{ chave: 'A', produtoCodigo: '1' }, { chave: 'B', produtoCodigo: '1' }])[0], /mais de um grupo/);
});

test('baixa: a tela usa a rota de produtos do corte e envia as baixas na confirmação', () => {
  const js = ler('corte.js'), html = ler('corte.html');
  assert.match(js, /chamar\('\/corte\/estoque\/produtos'\)/);
  assert.match(js, /corpoConferencia\(linhas, naoUsados, grupos\.length \? corpoBaixas\(selecoes\) : \[\]\)/);
  assert.match(js, /pode\('estoque\.movimentar'\)/);
  assert.match(js, /class="baixa-produto"/);
  assert.match(html, /\.baixa-estoque \{/);
  assert.match(html, /\.baixa-linha \{/);
});
