import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicarPadroes, validarPadroes } from '../scripts/lib/padroes.mjs';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { ausente, inferido, confirmado } from '../scripts/lib/valor.mjs';
import { processarLeitura, carregarMapa, carregarPadroes } from '../scripts/lib/servico.mjs';
import { camposLeitura } from '../scripts/lib/leitura.mjs';
const camposLeituraDe = mapa => camposLeitura(mapa).map(c => c.campo);

const PADROES = JSON.parse(readFileSync(new URL('../config/padroes-elegance.json', import.meta.url), 'utf8'));
const ARQ = 'pedido.pdf';
const o = trecho => ({ arquivo: ARQ, pagina: 1, trecho });
const aus = (id, unidade = null) => ausente({ id, unidade, metodo: 'leitura_visual', origem: o('não lido') });

function projeto(atributos = {}, dimensoes = {}) {
  const attrs = { tipoFrente: aus('P1.tipoFrente'), perfil: aus('P1.perfil'), acabamentoPerfil: aus('P1.acabamentoPerfil'), corPerfil: aus('P1.corPerfil'), revestimento: aus('P1.revestimento'), ...atributos };
  const dim = { altura: aus('P1.altura', 'mm'), largura: aus('P1.largura', 'mm'), ...dimensoes };
  const itens = [{ id: 'P1', tipo: 'porta_aluminio', quantidade: confirmado({ id: 'P1.qtd', valor: 2, unidade: 'un', metodo: 'texto_vetorial', origem: o('2 portas') }), dimensoes: dim, atributos: attrs }];
  const pendencias = [];
  for (const v of [...Object.values(attrs), ...Object.values(dim)]) {
    if (v.estado === 'ausente') pendencias.push({ id: `pend-${v.id}`, tipo: 'ausente', refs: [v.id], mensagem: `${v.id} não lido` });
    else if (v.estado === 'inferido') pendencias.push({ id: `pend-${v.id}`, tipo: 'inferido_sem_confirmacao', refs: [v.id], mensagem: `${v.id} inferido` });
  }
  return { versaoSchema: '1.1.0', dominio: 'portas-aluminio', documento: { arquivo: ARQ }, itens, pendencias, alertasSeguranca: [] };
}
const lido = (id, valor, estado = 'confirmado') => (estado === 'confirmado'
  ? confirmado({ id, valor, metodo: 'texto_vetorial', origem: o(String(valor)) })
  : inferido({ id, valor, metodo: 'leitura_visual', origem: o(String(valor)), confianca: 0.8 }));

test('o config dos padrões é válido e aprovado', () => {
  assert.deepEqual(validarPadroes(PADROES), []);
  assert.deepEqual(validarPadroes({ ...PADROES, confianca: 1 }).length > 0, true);
  assert.equal(validarPadroes({ ...PADROES, metadados: { status: 'rascunho' } }).length > 0, true);
});

test('perfil ausente: 3345 por padrão; 3026 se o texto fala em cristaleira', () => {
  const a = aplicarPadroes(projeto(), PADROES);
  assert.equal(a.doc.itens[0].atributos.perfil.valor, '3345');
  const b = aplicarPadroes(projeto(), PADROES, { textos: ['SALA DE JANTAR - CRISTALEIRA'] });
  assert.equal(b.doc.itens[0].atributos.perfil.valor, '3026');
  const c = aplicarPadroes(projeto(), PADROES, { legendas: { P1: 'Portas - cristaleira em L' } });
  assert.equal(c.doc.itens[0].atributos.perfil.valor, '3026');
});

test('valor do padrão nasce inferido, metodo configuracao, com pendência no lugar da "ausente"; o projeto continua válido', () => {
  const { doc } = aplicarPadroes(projeto(), PADROES);
  const v = doc.itens[0].atributos.perfil;
  assert.equal(v.estado, 'inferido');
  assert.equal(v.metodo, 'configuracao');
  assert.ok(v.confianca > 0 && v.confianca < 1);
  assert.match(v.origem.trecho, /padrão Elegance/);
  const pend = doc.pendencias.filter(p => p.refs.includes('P1.perfil'));
  assert.equal(pend.length, 1);
  assert.equal(pend[0].tipo, 'inferido_sem_confirmacao');
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
});

test('nunca sobrescreve valor lido e não muda o documento de entrada', () => {
  const base = projeto({ perfil: lido('P1.perfil', 'PERFIL 3136') });
  const copia = JSON.stringify(base);
  const { doc } = aplicarPadroes(base, PADROES);
  assert.equal(doc.itens[0].atributos.perfil.valor, 'PERFIL 3136');
  assert.equal(doc.itens[0].atributos.perfil.estado, 'confirmado');
  assert.equal(JSON.stringify(base), copia);
});

test('conflitante não é tocado', () => {
  const conf = { id: 'P1.perfil', valor: null, unidade: null, estado: 'conflitante', confianca: 0.5, metodo: 'leitura_visual', origem: o('x'),
    candidatos: [lido('P1.perfil.c1', '3136', 'inferido'), lido('P1.perfil.c2', '3026', 'inferido')] };
  const { doc, aplicados } = aplicarPadroes(projeto({ perfil: conf }), PADROES);
  assert.equal(doc.itens[0].atributos.perfil.estado, 'conflitante');
  assert.equal(aplicados.some(x => x.campo === 'perfil'), false);
});

test('acabamento pela cor: bronze/champanhe = Anodizado Bronze; preto = Pintura Sólida; onix = Pintura Metálica', () => {
  const casos = [['Bronze', 'Anodizado Bronze'], ['PERFIL CHAMPANHE', 'Anodizado Bronze'], ['champagne', 'Anodizado Bronze'], ['Preto', 'Pintura Sólida Alumínio'], ['Onix', 'Pintura Metálica Alumínio']];
  for (const [cor, esperado] of casos) {
    const { doc } = aplicarPadroes(projeto({ corPerfil: lido('P1.corPerfil', cor), perfil: lido('P1.perfil', '3345') }), PADROES);
    assert.equal(doc.itens[0].atributos.acabamentoPerfil.valor, esperado, cor);
  }
});

test('perfil 3026 não permite Anodizado Bronze: usa Pintura Metálica Alumínio e explica', () => {
  const { doc } = aplicarPadroes(projeto({ corPerfil: lido('P1.corPerfil', 'Bronze') }), PADROES, { textos: ['cristaleira'] });
  const a = doc.itens[0].atributos;
  assert.equal(a.perfil.valor, '3026');
  assert.equal(a.acabamentoPerfil.valor, 'Pintura Metálica Alumínio');
  assert.match(a.acabamentoPerfil.origem.trecho, /não permite/);
});

test('acabamento já lido não é alterado; sem cor não há palpite de acabamento', () => {
  const x = aplicarPadroes(projeto({ acabamentoPerfil: lido('P1.acabamentoPerfil', 'Inox escovado'), corPerfil: lido('P1.corPerfil', 'Bronze') }), PADROES);
  assert.equal(x.doc.itens[0].atributos.acabamentoPerfil.valor, 'Inox escovado');
  const y = aplicarPadroes(projeto(), PADROES);
  assert.equal(y.doc.itens[0].atributos.acabamentoPerfil.estado, 'ausente');
});

test('normalizações: vidro incolor/reflecta bronze e preto fosco viram os nomes do cadastro, guardando o texto lido', () => {
  const { doc } = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'VIDRO INCOLOR'), corPerfil: lido('P1.corPerfil', 'Preto fosco') }), PADROES);
  const a = doc.itens[0].atributos;
  assert.equal(a.revestimento.valor, 'Incolor (Extra Clear) 4mm');
  assert.match(a.revestimento.origem.trecho, /VIDRO INCOLOR/);
  assert.equal(a.revestimento.estado, 'inferido');
  assert.equal(a.corPerfil.valor, 'Preto');
  assert.equal(a.acabamentoPerfil.valor, 'Pintura Sólida Alumínio');
  const r = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'reflecta bronze') }), PADROES);
  assert.equal(r.doc.itens[0].atributos.revestimento.valor, 'Reflecta Bronze 4mm');
  const n = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'Canelado') }), PADROES);
  assert.equal(n.doc.itens[0].atributos.revestimento.valor, 'Canelado 4mm');
});

test('tipo de frente: altura maior que a largura = giro; sem medidas ou largura maior não muda', () => {
  const dim = (alt, lar) => ({ altura: lido('P1.altura', alt), largura: lido('P1.largura', lar) });
  const mm = (v, id) => confirmado({ id, valor: v, unidade: 'mm', metodo: 'texto_vetorial', origem: o(String(v)) });
  const g = aplicarPadroes(projeto({}, { altura: mm(597, 'P1.altura'), largura: mm(463, 'P1.largura') }), PADROES);
  assert.equal(g.doc.itens[0].atributos.tipoFrente.valor, 'porta_giro');
  const h = aplicarPadroes(projeto({}, { altura: mm(463, 'P1.altura'), largura: mm(597, 'P1.largura') }), PADROES);
  assert.equal(h.doc.itens[0].atributos.tipoFrente.estado, 'ausente');
  assert.equal(aplicarPadroes(projeto(), PADROES).doc.itens[0].atributos.tipoFrente.estado, 'ausente');
  void dim;
});

test('só atua em itens de categoria porta_aluminio', () => {
  const base = projeto();
  base.itens[0].tipo = 'estrutura_metalica_aco';
  const { aplicados } = aplicarPadroes(base, PADROES);
  assert.equal(aplicados.length, 0);
});

test('padrões inválidos lançam erro (confiança 1 ou status não aprovado)', () => {
  assert.throws(() => aplicarPadroes(projeto(), { ...PADROES, confianca: 1 }), /padrões inválidos/);
});

test('processarLeitura com { padroes } completa o que falta; sem ela o comportamento é o de antes', () => {
  const mapa = carregarMapa();
  const leitura = { itens: [{ id: 'P1', categoria: 'porta_aluminio', legenda: 'PORTAS CRISTALEIRA, PERFIL PRETO', quantidade: { texto: '2', pagina: 1, trecho: '2 PORTAS', confianca: 0.9, unidadeSeNumero: 'nao_se_aplica', motivoUnidade: '', candidatos: [] },
    valores: [{ campo: 'corPerfil', texto: 'PRETO FOSCO', pagina: 1, trecho: 'PERFIL PRETO FOSCO', confianca: 0.9, unidadeSeNumero: 'nao_se_aplica', motivoUnidade: '', candidatos: [] }] }],
  cotas: [], contagens: [], textoSuspeito: [], observacoes: '' };
  const sem = processarLeitura(leitura, { arquivo: 'p.pdf', paginas: 1, mapa });
  assert.equal(sem.ok, true, JSON.stringify(sem.erros));
  assert.equal(sem.doc.itens[0].atributos.perfil.estado, 'ausente');
  const com = processarLeitura(leitura, { arquivo: 'p.pdf', paginas: 1, mapa, padroes: carregarPadroes() });
  assert.equal(com.ok, true, JSON.stringify(com.erros));
  const a = com.doc.itens[0].atributos;
  assert.equal(a.perfil.valor, '3026');
  assert.equal(a.corPerfil.valor, 'Preto');
  assert.equal(a.acabamentoPerfil.valor, 'Pintura Sólida Alumínio');
  assert.ok(com.padroesAplicados.length >= 3);
});

// ---------- etapa 2 ----------
const mmv = (id, v) => confirmado({ id, valor: v, unidade: 'mm', metodo: 'texto_vetorial', origem: o(String(v)) });
const inteiro = (id, v) => inferido({ id, valor: v, unidade: 'un', metodo: 'leitura_visual', origem: o(String(v)), confianca: 0.8 });

test('furos: 5 por porta em altura 2337 = 100;634;1169;1703;2237 (giro), pela regra das pontas', () => {
  const { doc } = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro'), qtdFurosPorPorta: inteiro('P1.qtdFurosPorPorta', 5) }, { altura: mmv('P1.altura', 2337), largura: mmv('P1.largura', 346) }), PADROES);
  const f = doc.itens[0].atributos.furos;
  assert.equal(f.valor, '100;634;1169;1703;2237');
  assert.equal(f.estado, 'inferido');
  assert.equal(f.metodo, 'configuracao');
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
});

test('furos: total do item dividido pelas portas; basculante usa a largura; divisão não inteira não chuta', () => {
  const a = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro'), qtdFurosTotal: inteiro('P1.qtdFurosTotal', 6) }, { altura: mmv('P1.altura', 2363), largura: mmv('P1.largura', 336) }), PADROES);
  assert.equal(a.doc.itens[0].atributos.furos.valor, '100;1182;2263'); // 6 furos / 2 portas = 3
  const b = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_basculante'), qtdFurosPorPorta: inteiro('P1.qtdFurosPorPorta', 2) }, { altura: mmv('P1.altura', 558), largura: mmv('P1.largura', 904) }), PADROES);
  assert.equal(b.doc.itens[0].atributos.furos.valor, '100;804');
  const c = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro'), qtdFurosTotal: inteiro('P1.qtdFurosTotal', 5) }, { altura: mmv('P1.altura', 2000), largura: mmv('P1.largura', 500) }), PADROES);
  assert.equal(c.doc.itens[0].atributos.furos?.estado ?? 'ausente', 'ausente'); // 5 / 2 portas não é inteiro
});

test('furos: posição lida no projeto manda; sem quantidade ou sem tipo de frente não há furos', () => {
  const lidos = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro'), furos: lido('P1.furos', '150;900'), qtdFurosPorPorta: inteiro('P1.qtdFurosPorPorta', 5) }, { altura: mmv('P1.altura', 2000), largura: mmv('P1.largura', 500) }), PADROES);
  assert.equal(lidos.doc.itens[0].atributos.furos.valor, '150;900');
  const semQtd = aplicarPadroes(projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro') }, { altura: mmv('P1.altura', 2000), largura: mmv('P1.largura', 500) }), PADROES);
  assert.equal(semQtd.doc.itens[0].atributos.furos?.estado ?? 'ausente', 'ausente');
  const semTipo = aplicarPadroes(projeto({ qtdFurosPorPorta: inteiro('P1.qtdFurosPorPorta', 3) }, { altura: mmv('P1.altura', 500), largura: mmv('P1.largura', 900) }), PADROES);
  assert.equal(semTipo.doc.itens[0].atributos.furos?.estado ?? 'ausente', 'ausente');
});

test('vidro que não existe no cadastro: campo fica vazio e o texto vai para a observação; vidro do cadastro não muda', () => {
  const { doc } = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'VIDRO MINI CANELADO') }), PADROES);
  const a = doc.itens[0].atributos;
  assert.equal(a.revestimento.estado, 'ausente');
  assert.match(a.observacao.valor, /MINI CANELADO/);
  assert.match(a.observacao.valor, /não existe no cadastro/);
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
  const ok = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'Miniboreal') }), PADROES);
  assert.equal(ok.doc.itens[0].atributos.revestimento.valor, 'Miniboreal');
  const canelado = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'Canelado') }), PADROES);
  assert.equal(canelado.doc.itens[0].atributos.revestimento.valor, 'Canelado 4mm');
});

test('observação já existente é preservada ao acrescentar o aviso do vidro', () => {
  const { doc } = aplicarPadroes(projeto({ revestimento: lido('P1.revestimento', 'vidro mini canelado'), observacao: lido('P1.observacao', 'Entregar na obra') }), PADROES);
  assert.match(doc.itens[0].atributos.observacao.valor, /^Entregar na obra .*mini canelado/i);
});

test('"puxador igual ao pedido anterior" gera aviso na observação em vez de inventar o puxador', () => {
  const { doc } = aplicarPadroes(projeto(), PADROES, { textos: ['* PUXADOR IGUAL AO PEDIDO ANTERIOR'] });
  const a = doc.itens[0].atributos;
  assert.match(a.observacao.valor, /puxador igual ao pedido anterior/);
  assert.equal(a.puxador, undefined);
  const lidoP = aplicarPadroes(projeto({ puxador: lido('P1.puxador', '2018 E') }), PADROES, { textos: ['puxador igual ao anterior'] });
  assert.equal(lidoP.doc.itens[0].atributos.observacao?.estado ?? 'ausente', 'ausente');
});

test('mapa: auxiliares entram na leitura (schema e campos) e só viram valor se lidos', () => {
  const mapa = carregarMapa();
  const campos = camposLeituraDe(mapa);
  assert.ok(campos.includes('qtdFurosPorPorta') && campos.includes('qtdFurosTotal'));
  const leitura = { itens: [{ id: 'P1', categoria: 'porta_aluminio', legenda: '', quantidade: { texto: '2', pagina: 1, trecho: '2', confianca: 0.9, unidadeSeNumero: 'nao_se_aplica', motivoUnidade: '', candidatos: [] }, valores: [
    { campo: 'qtdFurosTotal', texto: '6', pagina: 1, trecho: '6 furos de caneco', confianca: 0.9, unidadeSeNumero: 'nao_se_aplica', motivoUnidade: '', candidatos: [] }] }],
  cotas: [], contagens: [], textoSuspeito: [], observacoes: '' };
  const r = processarLeitura(leitura, { arquivo: 'p.pdf', paginas: 1, mapa });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(r.doc.itens[0].atributos.qtdFurosTotal.valor, 6);
  assert.equal(r.doc.itens[0].atributos.qtdFurosPorPorta, undefined); // não lido: nem "ausente" nem pendência
  assert.equal(r.doc.pendencias.some(p => p.refs.includes('P1.qtdFurosPorPorta')), false);
});

test('furos cotados a partir da BASE são convertidos para o TOPO; do topo ou sem referência ficam como lidos', () => {
  const dims = { altura: mmv('P1.altura', 2000), largura: mmv('P1.largura', 500) };
  const frente = lido('P1.tipoFrente', 'porta_giro');
  const base = projeto({ tipoFrente: frente, furos: lido('P1.furos', '100;900'), referenciaFuros: lido('P1.referenciaFuros', 'Base') }, dims);
  assert.equal(aplicarPadroes(base, PADROES).doc.itens[0].atributos.furos.valor, '1100;1900');
  const topo = projeto({ tipoFrente: frente, furos: lido('P1.furos', '100;900'), referenciaFuros: lido('P1.referenciaFuros', 'topo') }, dims);
  assert.equal(aplicarPadroes(topo, PADROES).doc.itens[0].atributos.furos.valor, '100;900');
  const semRef = projeto({ tipoFrente: frente, furos: lido('P1.furos', '100;900') }, dims);
  assert.equal(aplicarPadroes(semRef, PADROES).doc.itens[0].atributos.furos.valor, '100;900');
});

test('furos da base que não cabem na porta não são convertidos no escuro: pendência', () => {
  const x = projeto({ tipoFrente: lido('P1.tipoFrente', 'porta_giro'), furos: lido('P1.furos', '100;2500'), referenciaFuros: lido('P1.referenciaFuros', 'base') }, { altura: mmv('P1.altura', 2000), largura: mmv('P1.largura', 500) });
  const { doc } = aplicarPadroes(x, PADROES);
  assert.equal(doc.itens[0].atributos.furos.valor, '100;2500');
  assert.ok(doc.pendencias.some(p => p.id === 'pend-ref-P1.furos'));
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
});
