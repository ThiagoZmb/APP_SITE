// Importação do JSON de itens da skill engenharia-projetos-tecnicos na tela de orçamentos (importar_itens.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Imp = require('../importar_itens.js');
const { folhasDoItem } = require('../calculo/engenharia');
const { prepararPedOrc } = require('./apoio/bancoPedOrc');

const GOLDEN = path.join(__dirname, '..', '.claude', 'skills', 'engenharia-projetos-tecnicos', 'tests', 'golden', 'itens-tela-exemplo.json');
const golden = () => JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const clonar = o => JSON.parse(JSON.stringify(o));

// item no formato da skill (montar-itens), já pronto
const itemSkill = (idItem, item, extra = {}) => ({ idItem, item, prontoParaLancar: true, rastreio: {}, sugestoes: [], pendencias: [], ...extra });
const arquivo = (itens, extra = {}) => ({ versao: '1.0.0', dominio: 'portas-aluminio', origem: { arquivo: 'projeto.pdf' }, prontoParaLancar: true, itens, pendenciasDocumento: [], ...extra });
const giro = (mudar = {}, detalhes = {}) => ({
  frente: 'Porta de giro', qtd: 1, altura: 2000, largura: 500, acessorios: [], obs: '',
  furos: { lista: [900, 100], lados: ['Esquerdo'], referenciaInvertida: false },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', cor: '', puxador: 'Puxador X', tipoPuxador: 'Sobreposto', acabPux: '', corPux: '',
    tamanhoPux: 800, posicoesFolhas: ['Lateral Direita Centro'], revestimento: 'Vidro V', corRevest: 'Incolor', ...detalhes },
  ...mudar });
const correr = (mudar = {}, detalhes = {}) => ({
  frente: 'Porta de Correr', qtd: 2, altura: 2100, largura: 3000, acessorios: [], obs: '',
  furos: { lista: [], lados: [], referenciaInvertida: false },
  detalhes: { perfil: 'Perfil P', acabamento: 'Anodizado', puxador: 'Puxador X', tamanhoPux: 800,
    posicoesFolhas: ['Lateral Direita Centro', 'Lateral Esquerda Centro'], revestimento: 'Vidro V', sistema: 'S1', transpasse: 50, ...detalhes },
  ...mudar });
const erros = item => Imp.normalizarItem(item).erros.join(' | ');

// ---------------- leitura ----------------
test('lerJson: vazio, grande demais, inválido e com BOM', () => {
  assert.equal(Imp.lerJson('', 0).ok, false);
  assert.match(Imp.lerJson('{}', 2 * 1024 * 1024).erro, /grande demais/);
  assert.match(Imp.lerJson('{ itens: [', 10).erro, /não é um JSON válido/);
  assert.deepEqual(Imp.lerJson('﻿{"a":1}', 8), { ok: true, dados: { a: 1 } });
});

// ---------------- triagem ----------------
test('golden da skill: os dois itens entram; inferido vira aviso e sugestão, nunca valor', () => {
  const t = Imp.triar(golden());
  assert.equal(t.erro, undefined);
  assert.deepEqual(t.aceitos.map(a => a.idItem), ['P1', 'P2']);
  assert.deepEqual(t.recusados, []);
  const [p1, p2] = t.aceitos.map(a => a.item);
  assert.equal(p1.frente, 'Porta de Correr');
  assert.equal(p1.detalhes.sistema, 'SISTEMA EXEMPLO 2 FOLHAS');
  assert.deepEqual(p1.detalhes.posicoesFolhas, ['Lateral Direita Centro', 'Lateral Esquerda Centro']);
  assert.deepEqual(p1.furos, { lista: [], lados: [], referenciaInvertida: false });
  // giro sem puxador: lados preenchidos por folha, furos em ordem e sem repetição
  assert.deepEqual(p2.furos, { lista: [100, 1000], lados: ['Esquerdo'], referenciaInvertida: false });
  assert.equal(p2.detalhes.corRevest, '');           // só inferido no arquivo: não entra
  assert.equal(p2.detalhes.pares, false);
  assert.equal(t.sugestoes.length, 1);
  assert.deepEqual([t.sugestoes[0].idItem, t.sugestoes[0].destino, t.sugestoes[0].valor, t.sugestoes[0].pagina], ['P2', 'detalhes.corRevest', 'Incolor', 4]);
  assert.match(t.aceitos[1].avisos.join(' '), /só tem valor inferido/);
  assert.ok(!('valor' in p1) && !('valorTela' in p1));
});

test('arquivo inteiro recusado: formato, versão, domínio, sem itens, mais de 200 itens', () => {
  assert.match(Imp.triar([]).erro, /formato esperado/);
  assert.match(Imp.triar(null).erro, /formato esperado/);
  assert.match(Imp.triar(arquivo([], { versao: '2.0.0' })).erro, /Versão/);
  assert.match(Imp.triar(arquivo([], { dominio: 'guarda-corpo' })).erro, /Domínio/);
  assert.match(Imp.triar(arquivo([])).erro, /nenhum item/);
  assert.match(Imp.triar(arquivo('x')).erro, /lista "itens"/);
  assert.match(Imp.triar(arquivo(Array.from({ length: 201 }, (_, i) => itemSkill('P' + i, giro())))).erro, /máximo por documento é 200/);
  assert.match(Imp.triar({ ...arquivo([itemSkill('P1', giro())]), pendenciasDocumento: undefined }).erro, /pendenciasDocumento/);
});

test('pendência bloqueante, fora do escopo e item não pronto ficam de fora com o motivo', () => {
  const t = Imp.triar(arquivo([
    itemSkill('P1', giro()),
    itemSkill('P2', {}, { prontoParaLancar: false, pendencias: [{ id: 'x', tipo: 'obrigatorio_ausente', destino: 'altura', mensagem: 'Campo "altura" ausente.', bloqueante: true, refs: [] }] }),
    itemSkill('E1', {}, { foraDoEscopo: true, prontoParaLancar: false, pendencias: [{ id: 'f', tipo: 'fora_do_escopo', destino: 'tipo', mensagem: 'fora', bloqueante: false, refs: [] }] }),
    itemSkill('P3', giro(), { prontoParaLancar: false })
  ], { prontoParaLancar: false }));
  assert.deepEqual(t.aceitos.map(a => a.idItem), ['P1']);
  const motivo = id => t.recusados.find(r => r.idItem === id).motivos.join(' ');
  assert.match(motivo('P2'), /altura" ausente/);
  assert.match(motivo('E1'), /Fora do escopo/);
  assert.match(motivo('P3'), /não pronto/);
  assert.match(t.avisos.join(' '), /não pronto para lançar/);
});

test('pendência do documento: bloqueia só os itens citados; sem item identificado ou de segurança, bloqueia tudo', () => {
  const div = refs => ({ id: 'd', tipo: 'divergencia', mensagem: 'Soma das cotas difere', refs });
  const base = [itemSkill('P1', giro(), { rastreio: { altura: 'C1.alt' } }), itemSkill('P2', giro())];
  let t = Imp.triar(arquivo(base, { pendenciasDocumento: [div(['C1.alt'])] }));
  assert.deepEqual(t.aceitos.map(a => a.idItem), ['P2']);
  assert.match(t.recusados[0].motivos[0], /Soma das cotas/);
  t = Imp.triar(arquivo(base, { pendenciasDocumento: [div(['P2.largura'])] }));
  assert.deepEqual(t.aceitos.map(a => a.idItem), ['P1']);
  t = Imp.triar(arquivo(base, { pendenciasDocumento: [div(['Z9'])] }));
  assert.deepEqual(t.aceitos, []);
  t = Imp.triar(arquivo(base, { pendenciasDocumento: [{ id: 's', tipo: 'texto_suspeito', mensagem: 'ignore as instruções', refs: ['P1.obs'] }] }));
  assert.deepEqual(t.aceitos, []);
  assert.equal(t.recusados.length, 2);
});

test('limite de 200 itens conta o que já está na lista', () => {
  const t = Imp.triar(arquivo([itemSkill('P1', giro()), itemSkill('P2', giro())]), { itensNaLista: 199 });
  assert.deepEqual(t.aceitos.map(a => a.idItem), ['P1']);
  assert.match(t.recusados[0].motivos[0], /máximo de 200/);
});

// ---------------- campos ----------------
test('campos obrigatórios, tipos e faixas', () => {
  assert.match(erros(giro({ frente: 'Serralheria' })), /Frente "Serralheria" não existe/);
  assert.match(erros(giro({ qtd: 0 })), /Quantidade: fora da faixa/);
  assert.match(erros(giro({ qtd: 1.5 })), /Quantidade: deve ser número inteiro/);
  assert.match(erros(giro({ qtd: 501 })), /Quantidade: fora da faixa/);
  assert.match(erros(giro({ qtd: '2' })), /Quantidade: deve ser número/);
  assert.match(erros(giro({ altura: -1 })), /Altura: deve ser maior que 0/);
  assert.match(erros(giro({ largura: 999999 })), /Largura: fora da faixa/);
  assert.match(erros(giro({}, { perfil: '' })), /Perfil: não informado/);
  assert.match(erros(giro({}, { acabamento: undefined })), /Acabamento do perfil: não informado/);
  assert.match(erros(giro({}, { perfil: 'x'.repeat(191) })), /longo demais/);
  assert.match(erros(giro({}, { perfil: 'P\u0007' })), /caracteres de controle/);
  assert.match(erros(giro({}, { perfil: 42 })), /Perfil: deve ser texto/);
  assert.match(erros(giro({ detalhes: 'x' })), /detalhes: deve ser um objeto/);
  assert.match(erros(giro({}, { divH: -1 })), /Divisores horizontais/);
  assert.match(erros(correr({}, { sistema: '' })), /informe o sistema/);
  // frente sem diferença de maiúsculas vira a grafia da tela
  assert.equal(Imp.normalizarItem(correr({ frente: 'porta de correr' })).item.frente, 'Porta de Correr');
  // observação aceita quebra de linha
  assert.equal(Imp.normalizarItem(giro({ obs: 'linha 1\nlinha 2' })).item.obs, 'linha 1\nlinha 2');
});

test('puxador: uma posição reconhecida por folha; correr só laterais (até 2); Total não se mistura', () => {
  assert.match(erros(giro({ qtd: 2 })), /uma por folha \(2 folha\(s\), 1 posição/);
  assert.match(erros(giro({}, { posicoesFolhas: [''] })), /Folha 1: posição do puxador não informada/);
  assert.match(erros(giro({}, { posicoesFolhas: ['Meio da porta'] })), /não reconhecida/);
  assert.match(erros(giro({}, { posicoesFolhas: ['Lateral Direita Centro, Topo Centro'] })), /uma única posição/);
  assert.match(erros(correr({}, { posicoesFolhas: ['Topo Centro', 'Lateral Esquerda Centro'] })), /só aceita puxador nas laterais/);
  assert.match(erros(correr({}, { posicoesFolhas: ['Lateral Esquerda Centro, Lateral Esquerda Superior', ''] })), /mesmo lado/);
  assert.match(erros(giro({ qtd: 2, furos: { lista: [] } }, { posicoesFolhas: ['Lateral Direita Total', 'Lateral Esquerda Centro'] })), /misturado/);
  // grafia livre vira o nome comercial; correr aceita dois puxadores na folha
  const ok = Imp.normalizarItem(correr({}, { posicoesFolhas: ['lateral  direita centro', 'LATERAL ESQUERDA CENTRO, Lateral Direita Centro'] }));
  assert.deepEqual(ok.item.detalhes.posicoesFolhas, ['Lateral Direita Centro', 'Lateral Esquerda Centro, Lateral Direita Centro']);
  // sem puxador: posição/tamanho ignorados com aviso
  const sem = Imp.normalizarItem(giro({}, { puxador: '', tamanhoPux: 150 }));
  assert.deepEqual(sem.item.detalhes.posicoesFolhas, ['']);
  assert.match(sem.avisos.join(' '), /Sem puxador/);
});

test('furos: só giro e basculante, dentro da porta, dobradiça nunca do lado do puxador', () => {
  const gav = Imp.normalizarItem(giro({ frente: 'Frente de gaveta' }));
  assert.deepEqual(gav.item.furos, { lista: [], lados: [], referenciaInvertida: false });
  assert.match(gav.avisos.join(' '), /não tem furação/);
  assert.match(erros(giro({ furos: { lista: [100, 2000], lados: ['Esquerdo'] } })), /Furo 2: 2000 mm passa da medida/);
  assert.match(erros(giro({ furos: { lista: [100, 'a'], lados: ['Esquerdo'] } })), /Furo 2: medida inválida/);
  assert.match(erros(giro({ furos: { lista: [100], lados: ['Direito'] } })), /puxador e dobradiças/);
  assert.match(erros(giro({ furos: { lista: [100], lados: ['Cima'] } })), /lado dos furos "Cima" inválido/);
  // sem lado: oposto ao puxador de cada folha
  const par = Imp.normalizarItem(giro({ qtd: 2, furos: { lista: [100] } }, { posicoesFolhas: ['Lateral Direita Centro', 'Lateral Esquerda Centro'] }));
  assert.deepEqual(par.item.furos.lados, ['Esquerdo', 'Direito']);
  // basculante: lado vem do perfil (Superior; "invertido" → Inferior) e mede pela largura
  const bas = Imp.normalizarItem(giro({ frente: 'Porta basculante', largura: 900, furos: { lista: [100, 800], lados: ['Esquerdo'] } }, { posicoesFolhas: ['Base Centro'] }));
  assert.deepEqual(bas.item.furos.lados, ['Superior']);
  assert.match(bas.avisos.join(' '), /vem do perfil/);
  assert.match(erros(giro({ frente: 'Porta basculante', furos: { lista: [100] } }, { posicoesFolhas: ['Topo Centro'] })), /mesmo lado das dobradiças/);
  const inv = Imp.normalizarItem(giro({ frente: 'Porta basculante', furos: { lista: [100] } }, { perfil: 'Perfil Invertido', posicoesFolhas: ['Topo Centro'] }));
  assert.deepEqual(inv.item.furos.lados, ['Inferior']);
  // referência invertida: a frase vai para a observação, como o botão da tela
  assert.match(Imp.normalizarItem(giro({ furos: { lista: [100], referenciaInvertida: true } })).item.obs, /Furos medidos de BAIXO para CIMA/);
});

test('valor, histórico e acessórios do arquivo nunca entram; correr fica sem sistema fora do correr', () => {
  const r = Imp.normalizarItem(giro({ valor: 1, valorTela: 1, historico: '+90', acessorios: [{ nome: 'Fechadura', qtd: 1 }] }, { sistema: 'S1' }));
  assert.equal(r.item.valor, undefined);
  assert.equal(r.item.historico, undefined);
  assert.deepEqual(r.item.acessorios, []);
  assert.equal(r.item.detalhes.sistema, '');
  assert.match(r.avisos.join(' '), /preço é calculado pelo motor/);
  assert.match(r.avisos.join(' '), /Acessórios do arquivo foram ignorados/);
  assert.match(r.avisos.join(' '), /só valem para porta de correr/);
});

test('regras do puxador pelo tipo do cadastro (tipo, toda extensão e tamanho)', () => {
  const aplicar = (item, nat) => { const i = Imp.normalizarItem(item).item; return { i, ...Imp.aplicarRegrasPuxador(i, nat) }; };
  let r = aplicar(giro(), 'Sobreposto');
  assert.deepEqual([r.erros, r.i.detalhes.tipoPuxador, r.i.detalhes.todaExt, r.i.detalhes.tamanhoPux], [[], 'Sobreposto', false, 800]);
  r = aplicar(giro({}, { posicoesFolhas: ['Lateral Direita Total'], tamanhoPux: 5 }), 'SOBREPOSTO');
  assert.deepEqual([r.erros, r.i.detalhes.tipoPuxador, r.i.detalhes.todaExt, r.i.detalhes.tamanhoPux], [[], 'Sobreposto Total', true, 2000]);
  r = aplicar(giro({}, { posicoesFolhas: ['Topo Total'] }), 'Total');
  assert.deepEqual([r.erros, r.i.detalhes.tipoPuxador, r.i.detalhes.tamanhoPux], [[], 'Total', 500]);
  assert.match(aplicar(giro(), 'Total').erros[0], /é Total no cadastro/);
  assert.match(aplicar(giro({}, { posicoesFolhas: ['Lateral Direita Total'] }), 'Embutido').erros[0], /não pode ser em toda a extensão/);
  assert.match(aplicar(giro({}, { posicoesFolhas: ['Lateral Direita Total'] }), '').erros[0], /não aceita toda a extensão/);
  assert.match(aplicar(giro({}, { tamanhoPux: null }), 'Sobreposto').erros[0], /Tamanho do puxador não informado/);
  assert.match(aplicar(giro({}, { tamanhoPux: 50 }), 'Sobreposto').erros[0], /mínimo/);
  assert.match(aplicar(giro({}, { tamanhoPux: 500 }), 'Embutido').erros[0], /embutido vai até 400/);
  assert.match(aplicar(giro({}, { tamanhoPux: 2500 }), 'Sobreposto').erros[0], /passa do tamanho da porta/);
  // tipo diferente no arquivo: vale o cadastro, com aviso
  assert.match(aplicar(giro({}, { tipoPuxador: 'Embutido' }), 'Sobreposto').avisos[0], /vale o cadastro/);
  // correr: sem tipo no cadastro vira Sobreposto; embutido não tem tamanho
  assert.equal(aplicar(correr(), '').i.detalhes.tipoPuxador, 'Sobreposto');
  r = aplicar(correr(), 'Embutido');
  assert.deepEqual([r.erros, r.i.detalhes.tamanhoPux], [[], 0]);
});

// ---------------- preço ----------------
test('medida da folha e corpo do /calcular_preco iguais ao que o servidor refaz ao salvar', () => {
  const i = Imp.normalizarItem(correr()).item;
  Imp.aplicarRegrasPuxador(i, 'Sobreposto');
  const folha = folhasDoItem(i, { descontoAlturaSistema: 40 })[0];
  assert.deepEqual(Imp.medidasFolha(i, 40), { altura: folha.altura, largura: folha.largura });
  assert.deepEqual(Imp.medidasFolha(i, 40), { altura: 2060, largura: 1525 });
  const sistema = { descontoAltura: 40, acessorios: [{ nome: 'Trilho Sup', classe: 'Trilho superior', qtd: 2, tamanho: 3000 }] };
  const e = Imp.entradaCalculo(i, { clienteNome: 'C', clienteCodigo: 7, sistema });
  assert.deepEqual(e, { frente: 'Porta de Correr', cliente: 'C', clienteCodigo: 7, altura: 2060, largura: 1525,
    acessorios: [{ nome: 'Trilho Sup', qtd: 2, tamanho: 3000, origem: 'SISTEMA DE CORRER' }], qtd: 2,
    perfil: 'Perfil P', acabPerfil: 'Anodizado', puxador: 'Puxador X', acabPuxador: '', tipoPuxador: 'Sobreposto',
    posicaoPuxador: 'Lateral Direita Centro', posicoesFolhas: ['Lateral Direita Centro', 'Lateral Esquerda Centro'],
    tamanhoPuxador: 800, revestimento: 'Vidro V', divisor: '', qtdDivH: 0, qtdDivV: 0, percentuais: '' });
  // a posição de cada folha é a mesma que o servidor usa ao refazer o preço (rotas/ped_orc.js entradaPreco)
  assert.deepEqual(folhasDoItem(i, { descontoAlturaSistema: 40 }).map(f => f.posicaoPuxador), e.posicoesFolhas);
  // sem sistema a medida é a da porta
  const sem = Imp.normalizarItem(correr({}, { sistema: 'Sem sistema' })).item;
  assert.deepEqual(Imp.medidasFolha(sem, 40), { altura: 2100, largura: 3000 });
});

test('item pronto: valor do motor, valorTela, histórico vazio, acessórios do sistema e descrição da tela', () => {
  const i = Imp.normalizarItem(giro({ furos: { lista: [100, 900], lados: ['Esquerdo'] } })).item;
  Imp.aplicarRegrasPuxador(i, 'Sobreposto');
  assert.match(Imp.montarItemTela(i, { unitario: 0 }).erro, /valor zero/);
  const { item } = Imp.montarItemTela(i, { unitario: 710.084 });
  assert.deepEqual([item.valor, item.valorBase, item.valorTela, item.historico], [710.08, 710.08, 710.08, '']);
  assert.equal(item.descricao, 'Porta de giro — Perfil: Perfil P, Anodizado | Puxador: Puxador X (Lateral Direita Centro) 800mm' +
    ' | Revest: Vidro V Incolor | Divisor: - (0H/0V) | Furos: 100, 900 mm (Esquerdo)');
  const c = Imp.normalizarItem(correr()).item;
  Imp.aplicarRegrasPuxador(c, 'Sobreposto');
  const sistema = { descontoAltura: 40, acessorios: [{ nome: 'Roldana', classe: 'Roldana', qtd: 4, tamanho: 0 }] };
  const r = Imp.montarItemTela(c, { unitario: 900, acessorios: [{ nome: 'Roldana', valorUnitario: 15, valorTotal: 60 }] }, { sistema });
  assert.deepEqual(r.item.acessorios, [{ nome: 'Roldana', classe: 'Roldana', qtd: 4, qtdMax: 4, tamanho: 0, origem: 'SISTEMA DE CORRER', valorUnitario: 15, valorTotal: 60 }]);
  assert.match(r.item.descricao, /\(F1: Lateral Direita Centro \/ F2: Lateral Esquerda Centro\) 800mm.* \| Sistema: S1 \/ Transpasse: 50mm$/);
});

// ---------------- fluxo com o servidor (banco simulado) ----------------
// catálogos da tela (/catalogos_filtro) no banco simulado de orçamentos
function comCatalogos(banco) {
  banco.f.regras.unshift(
    [/INNER JOIN perfis_permitidos/, [{ nome: 'Perfil P' }]],
    [/INNER JOIN acabamentos_permitidos/, (sql, [m]) => ['Perfil P', 'Puxador X'].includes(m) ? [{ nome: 'Anodizado' }] : []],
    [/INNER JOIN puxadores_permitidos/, [{ nome: 'Puxador X' }]],
    [/INNER JOIN revestimentos_permitidos/, [{ nome: 'Vidro V' }]],
    [/INNER JOIN divisores_permitidos/, []]);
}
const apiDe = chamar => async (caminho, { method = 'GET', body } = {}) => {
  const r = await chamar(caminho, method, body);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status });
  return j;
};
// o que a tela manda no POST /ped_orc/salvar (orcamentos.html gravar)
const paraSalvar = it => ({ frente: it.frente, qtd: it.qtd, altura: it.altura, largura: it.largura, profundidade: it.profundidade, soldas: it.soldas,
  furos: it.furos, detalhes: it.detalhes, acessorios: it.acessorios || [], historico: it.historico || '', obs: it.obs || '', valorTela: it.valor });

test('fluxo completo: importa, calcula no motor da tela e o /ped_orc/salvar aceita sem 409', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  comCatalogos(banco);
  const dados = arquivo([
    itemSkill('P1', giro({}, { revestimento: 'vidro  v' })),   // grafia diferente do cadastro: ajustada
    itemSkill('P2', correr()),
    itemSkill('P3', giro({}, { perfil: 'Perfil Z' })),          // fora do cadastro
    itemSkill('P4', correr({}, { sistema: 'S9' })),              // sistema inexistente
    itemSkill('P5', giro(), { pendencias: [{ id: 'p', tipo: 'conflitante', destino: 'largura', mensagem: 'Largura 500 ou 550?', bloqueante: true, refs: [] }] })
  ]);
  const tri = Imp.triar(Imp.lerJson(JSON.stringify(dados)).dados);
  assert.deepEqual(tri.aceitos.map(a => a.idItem), ['P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(tri.recusados.map(r => r.idItem), ['P5']);
  const progresso = [];
  const prep = await Imp.prepararItens(tri.aceitos, { api: apiDe(chamar), clienteNome: 'CLIENTE TESTE', clienteCodigo: '7', aoProgresso: (i, n) => progresso.push(`${i}/${n}`) });
  assert.deepEqual(progresso, ['1/4', '2/4', '3/4', '4/4']);
  assert.deepEqual(prep.importados.map(x => x.idItem), ['P1', 'P2']);
  const falha = id => prep.falhas.find(f => f.idItem === id).motivos.join(' ');
  assert.match(falha('P3'), /Perfil "Perfil Z" não está no cadastro para Porta de giro/);
  assert.match(falha('P4'), /Sistema de correr "S9" não encontrado/);
  const [p1, p2] = prep.importados.map(x => x.item);
  assert.equal(p1.detalhes.revestimento, 'Vidro V');
  assert.match(prep.importados[0].avisos.join(' '), /grafia do cadastro/);
  // giro 2000×500: perfil 5 m × 100 = 500 + puxador 0,8 m × 50 = 40 + vidro 1,98 × 0,48 m² × 200 = 190,08
  assert.deepEqual([p1.valor, p1.valorTela, p1.valorBase, p1.historico], [730.08, 730.08, 730.08, '']);
  assert.equal(p1.detalhes.tipoPuxador, 'Sobreposto');
  // correr: acessórios do sistema (trilho no vão, roldanas por folha) e preço pela medida da porta
  assert.deepEqual(p2.acessorios.map(a => [a.nome, a.qtd, a.tamanho, a.origem]), [['Trilho Sup', 2, 3000, 'SISTEMA DE CORRER'], ['Roldana', 4, 0, 'SISTEMA DE CORRER']]);
  assert.match(prep.importados[1].avisos.join(' '), /desempenador opcional/);

  const r = await chamar('/ped_orc/salvar', 'POST', { modo: 'novo', tipo: 'Orçamento', clienteCodigo: 7, clienteFinal: '', obsGeral: '', descontoPct: 0,
    totalTela: p1.valor * p1.qtd + p2.valor * p2.qtd, itens: [p1, p2].map(paraSalvar) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(await r.json(), { ok: true, tipo: 'Orçamento', numero: 1 });
  assert.deepEqual(banco.listaItens.map(l => [l.ITEM, l.TIPO_PRODUTO, l.UNITARIO]), [[1, 'Porta de giro', p1.valor], [2, 'Porta de correr', Math.round(p2.valor * 2 * 100) / 100]]);
  // duas folhas (puxadores em lados opostos): porta = vão − desconto do sistema, largura com transpasse
  assert.deepEqual(banco.itensV4.filter(v => v.ITEM_PEDIDO === 2).map(v => [v.ALTURA, v.LARGURA, v.ALTURA_VAO, v.LARGURA_VAO, v.POSICAO_PUXADOR]),
    [[2060, 1525, 2100, 3000, 'Lateral Direita Centro'], [2060, 1525, 2100, 3000, 'Lateral Esquerda Centro']]);
  assert.deepEqual(banco.furacao.map(f => [f.ITEM, f.LADO, f.TAMANHO]), [[1, 'Esquerdo', 100], [1, 'Esquerdo', 900]]);
});

test('fluxo: preço adulterado no arquivo não passa (o motor recalcula) e servidor fora do ar vira motivo do item', async t => {
  const { banco, chamar } = await prepararPedOrc(t);
  comCatalogos(banco);
  const tri = Imp.triar(arquivo([itemSkill('P1', giro({ valor: 0.01, valorTela: 0.01 }))]));
  const prep = await Imp.prepararItens(tri.aceitos, { api: apiDe(chamar), clienteCodigo: '7' });
  assert.ok(prep.importados[0].item.valor > 1);
  const fora = await Imp.prepararItens(tri.aceitos, { api: async () => { throw Object.assign(new Error('Erro de servidor'), { status: 500 }); } });
  assert.deepEqual(fora.importados, []);
  assert.match(fora.falhas[0].motivos[0], /Erro ao consultar o servidor \(HTTP 500\)/);
});
