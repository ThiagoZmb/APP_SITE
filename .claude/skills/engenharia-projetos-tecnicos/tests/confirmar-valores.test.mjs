import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { aplicarConfirmacoes, lerValorInformado } from '../scripts/lib/confirmacao.mjs';
import { gerarRelatorio } from '../scripts/lib/relatorio.mjs';
import { val, txt, qtd, inferidoVal, ausenteVal, conflitanteVal, rodarScript, comPastaTemp } from './apoio.mjs';

const EM = '2026-10-26T14:30:00-03:00';
const BASE = { por: 'Maria Souza', em: EM };

// Projeto com um valor de cada estado + um calculado que depende do inferido + pendências de vários tipos
function projeto() {
  const doc = {
    versaoSchema: '1.0.0', dominio: 'portas-aluminio', documento: { arquivo: 'a.pdf' },
    itens: [{
      id: 'P1', tipo: 'porta_giro', quantidade: qtd('P1.qtd', 1),
      dimensoes: {
        altura: inferidoVal('P1.altura', 2063),                 // inferido (cota em cm lida do desenho)
        largura: ausenteVal('P1.largura', 'mm'),                // ausente, comprimento
        area: val('P1.area', 1856700, { estado: 'inferido', confianca: 0.5, metodo: 'calculado', regra: 'altura x largura', origem: { arquivo: 'a.pdf', pagina: 1, trecho: 'altura x largura', entradas: ['P1.altura', 'P1.larg2'] } }),
        larg2: val('P1.larg2', 900),
      },
      atributos: {
        perfil: ausenteVal('P1.perfil'),                        // ausente, texto
        cor: conflitanteVal('P1.cor', 'Fosco', 'Brilhante'),    // conflitante
        puxador: inferidoVal('P1.puxador', 'PUXADOR 2790', null),
      },
    }],
    pendencias: [
      { id: 'pend-altura', tipo: 'inferido_sem_confirmacao', mensagem: 'altura inferida', refs: ['P1.altura'] },
      { id: 'pend-unid', tipo: 'unidade_ambigua', mensagem: 'cota sem unidade, cm inferido', refs: ['P1.altura'] },
      { id: 'pend-largura', tipo: 'ausente', mensagem: 'largura não cotada', refs: ['P1.largura'] },
      { id: 'pend-perfil', tipo: 'ausente', mensagem: 'perfil ilegível', refs: ['P1.perfil'] },
      { id: 'pend-cor', tipo: 'conflitante', mensagem: 'cor diverge', refs: ['P1.cor'] },
      { id: 'pend-puxador', tipo: 'inferido_sem_confirmacao', mensagem: 'puxador inferido', refs: ['P1.puxador'] },
      { id: 'pend-area', tipo: 'inferido_sem_confirmacao', mensagem: 'área calculada de valor inferido', refs: ['P1.area'] },
      { id: 'pend-misto', tipo: 'ausente', mensagem: 'altura e largura juntas', refs: ['P1.altura', 'P1.largura'] },
      { id: 'pend-soma', tipo: 'divergencia', mensagem: 'soma não fecha', refs: ['P1.altura'] },
    ],
    alertasSeguranca: [],
  };
  const v = validarProjeto(doc);
  assert.deepEqual(v.erros, [], 'o projeto de teste deve ser válido');
  return doc;
}
const idsPend = doc => doc.pendencias.map(p => p.id);
const achar = (doc, id) => Object.values({ ...doc.itens[0].dimensoes, ...doc.itens[0].atributos }).find(v => v.id === id);

// ---------- --ids ----------
test('--ids: inferido → confirmado, mantém metodo/origem e grava confirmacao; entrada não é alterada', () => {
  const entrada = projeto();
  const copia = structuredClone(entrada);
  const { doc, historico } = aplicarConfirmacoes(entrada, { ...BASE, nota: 'conferi no desenho', ids: ['P1.altura'] });
  assert.deepEqual(entrada, copia, 'documento de entrada intacto');
  const v = achar(doc, 'P1.altura');
  assert.equal(v.estado, 'confirmado');
  assert.equal(v.metodo, 'leitura_visual');
  assert.equal(v.valor, 2063);
  assert.deepEqual(v.origem, entrada.itens[0].dimensoes.altura.origem);
  assert.deepEqual(v.confirmacao, { por: 'Maria Souza', em: EM, nota: 'conferi no desenho' });
  assert.equal(doc.versaoSchema, '1.1.0');
  assert.deepEqual(historico[0], { em: EM, por: 'Maria Souza', acao: 'confirmar', ids: ['P1.altura'], nota: 'conferi no desenho' });
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
});

test('--ids: ausente, conflitante, já confirmado ou id inexistente → erro claro (tudo ou nada)', () => {
  const d = projeto();
  const falha = (ids, padrao) => assert.throws(() => aplicarConfirmacoes(d, { ...BASE, ids }), padrao);
  falha(['P1.largura'], /"P1.largura" está "ausente".*--informar/);
  falha(['P1.cor'], /"P1.cor" está "conflitante".*--resolver/);
  falha(['P1.larg2'], /"P1.larg2" está "confirmado"/);
  falha(['nao-existe'], /não existe no documento/);
  falha(['P1.altura', 'P1.larg2'], /"P1.larg2" está "confirmado"/); // o primeiro seria válido: nada é aplicado
  falha(['P1.altura', 'P1.altura'], /mais de uma vez/);
});

test('exige --por, --em ISO válido e ao menos uma ação', () => {
  const d = projeto();
  assert.throws(() => aplicarConfirmacoes(d, { em: EM, ids: ['P1.altura'] }), /quem confirmou/);
  assert.throws(() => aplicarConfirmacoes(d, { por: ' ', em: EM, ids: ['P1.altura'] }), /quem confirmou/);
  assert.throws(() => aplicarConfirmacoes(d, { por: 'M', em: 'ontem', ids: ['P1.altura'] }), /data inválida/);
  assert.throws(() => aplicarConfirmacoes(d, { por: 'M', em: '2026-13-45', ids: ['P1.altura'] }), /data inválida/);
  assert.throws(() => aplicarConfirmacoes(d, BASE), /nada a fazer/);
});

// ---------- --resolver ----------
test('--resolver: conflitante vira o candidato escolhido (confirmado, com confirmacao); candidatos vão para o histórico', () => {
  const entrada = projeto();
  const { doc, historico } = aplicarConfirmacoes(entrada, { ...BASE, resolver: [{ conflitante: 'P1.cor', candidato: 'P1.cor.b' }] });
  const v = achar(doc, 'P1.cor');
  assert.equal(v.estado, 'confirmado');
  assert.equal(v.valor, 'Brilhante');
  assert.equal(v.id, 'P1.cor', 'mantém o id: as referências continuam valendo');
  assert.equal(v.candidatos, undefined);
  assert.equal(v.confianca, 1);
  assert.deepEqual(v.confirmacao, { por: 'Maria Souza', em: EM });
  const h = historico[0];
  assert.equal(h.acao, 'resolver_conflito');
  assert.deepEqual(h.detalhes.resolucoes[0].candidatos.map(c => [c.id, c.valor]), [['P1.cor.a', 'Fosco'], ['P1.cor.b', 'Brilhante']]);
  assert.equal(h.detalhes.resolucoes[0].escolhido, 'P1.cor.b');
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
  assert.ok(!idsPend(doc).includes('pend-cor'), 'pendência do conflito resolvida');
});

test('--resolver: candidato de outro valor, valor não conflitante ou id inexistente → erro', () => {
  const d = projeto();
  assert.throws(() => aplicarConfirmacoes(d, { ...BASE, resolver: [{ conflitante: 'P1.cor', candidato: 'P1.altura' }] }), /não é candidato de "P1.cor" \(candidatos: P1\.cor\.a, P1\.cor\.b\)/);
  assert.throws(() => aplicarConfirmacoes(d, { ...BASE, resolver: [{ conflitante: 'P1.altura', candidato: 'x' }] }), /só valor "conflitante"/);
  assert.throws(() => aplicarConfirmacoes(d, { ...BASE, resolver: [{ conflitante: 'nada', candidato: 'x' }] }), /não existe/);
});

// ---------- --informar ----------
test('--informar: ausente em mm aceita o número (vírgula decimal) e continua em mm; metodo informado_humano', () => {
  const { doc, historico } = aplicarConfirmacoes(projeto(), { ...BASE, informar: [{ id: 'P1.largura', valor: '79,5' }] });
  const v = achar(doc, 'P1.largura');
  assert.deepEqual([v.estado, v.valor, v.unidade, v.metodo, v.confianca], ['confirmado', 79.5, 'mm', 'informado_humano', 1]);
  assert.deepEqual(v.confirmacao, { por: 'Maria Souza', em: EM });
  assert.equal(historico[0].acao, 'informar');
  assert.equal(validarProjeto(doc).ok, true, JSON.stringify(validarProjeto(doc).erros));
});

test('--informar: com unidade escrita converte para mm sem arredondar; sem unidade em mm declarado pela pessoa', () => {
  assert.equal(lerValorInformado('206,3 cm', 'mm'), 2063);
  assert.equal(lerValorInformado('2,1 m', 'mm'), 2100);
  assert.equal(lerValorInformado('2100', 'mm'), 2100);
  assert.equal(lerValorInformado('3', 'un'), 3);
  assert.throws(() => lerValorInformado('2.100', 'mm'), /não é uma cota válida/, 'ambíguo não é adivinhado');
  assert.throws(() => lerValorInformado('abc', 'mm'), /não é uma cota válida/);
  assert.throws(() => lerValorInformado('abc', 'un'), /não é um número válido/);
  assert.throws(() => lerValorInformado('  ', 'mm'), /vazio/);
});

test('--informar: ausente de texto (sem unidade) vira texto; "num:" vira número', () => {
  assert.equal(lerValorInformado('PERFIL 3136', null), 'PERFIL 3136');
  assert.equal(lerValorInformado('2790', null), '2790', 'código numérico de produto continua texto');
  assert.equal(lerValorInformado('num:2', null), 2);
  assert.throws(() => lerValorInformado('num:x', null), /não é um número/);
  const { doc } = aplicarConfirmacoes(projeto(), { ...BASE, informar: [{ id: 'P1.perfil', valor: 'PERFIL 3136' }] });
  const v = achar(doc, 'P1.perfil');
  assert.deepEqual([v.valor, v.unidade, v.estado, v.metodo], ['PERFIL 3136', null, 'confirmado', 'informado_humano']);
});

test('--informar: só vale para ausente; valor inválido é erro', () => {
  const d = projeto();
  assert.throws(() => aplicarConfirmacoes(d, { ...BASE, informar: [{ id: 'P1.altura', valor: '2000' }] }), /"P1.altura" está "inferido"/);
  assert.throws(() => aplicarConfirmacoes(d, { ...BASE, informar: [{ id: 'P1.largura', valor: 'x' }] }), /não é uma cota válida/);
});

test('informado_humano sem confirmacao é inválido (nova regra semântica) e o enum aceita o método', () => {
  const d = projeto();
  d.itens[0].dimensoes.larg2 = val('P1.larg2', 900, { metodo: 'informado_humano' });
  const r = validarProjeto(d);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some(e => /informado_humano.*exige confirmacao/.test(e.mensagem)));
  d.itens[0].dimensoes.larg2.confirmacao = { por: 'Maria', em: EM };
  assert.equal(validarProjeto(d).ok, true);
});

test('versão do schema: 1.0.0 e 1.1.0 válidos; historico é opcional; outra versão é inválida', () => {
  const d = projeto();
  assert.equal(validarProjeto(d).ok, true);
  d.versaoSchema = '1.1.0';
  d.historico = [{ em: EM, por: 'M', acao: 'confirmar', ids: ['P1.altura'] }];
  assert.equal(validarProjeto(d).ok, true);
  d.historico = [{ em: 'ontem', por: 'M', acao: 'x', ids: [] }];
  assert.equal(validarProjeto(d).ok, false);
  d.historico = [];
  d.versaoSchema = '2.0.0';
  assert.equal(validarProjeto(d).ok, false);
});

// ---------- pendências, histórico, avisos ----------
test('pendências: some a que ficou toda resolvida; mantém as demais (inclusive divergência e parcialmente resolvidas)', () => {
  const { doc, historico } = aplicarConfirmacoes(projeto(), { ...BASE, ids: ['P1.altura'], informar: [{ id: 'P1.perfil', valor: 'PERFIL 3136' }] });
  const ficam = idsPend(doc);
  assert.ok(!ficam.includes('pend-altura') && !ficam.includes('pend-unid'), 'inferido e unidade_ambigua resolvidos');
  assert.ok(!ficam.includes('pend-perfil'));
  assert.ok(ficam.includes('pend-misto'), 'refs P1.altura e P1.largura: largura ainda ausente');
  assert.ok(ficam.includes('pend-soma'), 'divergência nunca é removida por confirmação');
  for (const id of ['pend-largura', 'pend-cor', 'pend-puxador', 'pend-area']) assert.ok(ficam.includes(id), id);
  const rem = historico.find(h => h.acao === 'remover_pendencias');
  assert.deepEqual(rem.ids.sort(), ['pend-altura', 'pend-perfil', 'pend-unid']);
  assert.equal(validarProjeto(doc).ok, true);
});

test('histórico: acrescenta sem apagar o anterior; cada tipo de ação vira um registro', () => {
  const primeiro = aplicarConfirmacoes(projeto(), { ...BASE, ids: ['P1.altura'] }).doc;
  const segundo = aplicarConfirmacoes(primeiro, { por: 'João', em: '2026-10-27', nota: 'obra', ids: ['P1.puxador'], resolver: [{ conflitante: 'P1.cor', candidato: 'P1.cor.a' }], informar: [{ id: 'P1.largura', valor: '800' }] }).doc;
  const acoes = segundo.historico.map(h => `${h.por}:${h.acao}`);
  assert.deepEqual(acoes.slice(0, 2), ['Maria Souza:confirmar', 'Maria Souza:remover_pendencias']);
  assert.deepEqual(acoes.slice(2, 5), ['João:confirmar', 'João:resolver_conflito', 'João:informar']);
  assert.equal(segundo.historico.at(-1).nota, 'obra');
  assert.equal(validarProjeto(segundo).ok, true, JSON.stringify(validarProjeto(segundo).erros));
  assert.match(gerarRelatorio(segundo), /## Histórico de confirmações[\s\S]*João: resolver_conflito \(P1\.cor\)/);
});

test('aviso: calculado que depende de valor recém-confirmado ou informado (não é recalculado)', () => {
  const r = aplicarConfirmacoes(projeto(), { ...BASE, ids: ['P1.altura'] });
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /"P1\.area".*altura x largura.*"P1\.altura".*recalcule/);
  assert.equal(achar(r.doc, 'P1.area').valor, 1856700, 'o valor calculado não é alterado');
  assert.equal(aplicarConfirmacoes(projeto(), { ...BASE, ids: ['P1.puxador'] }).avisos.length, 0);
});

// ---------- CLI ----------
const SCRIPT = 'scripts/confirmar-valores.mjs';
const gravar = (dir, doc, nome = 'projeto.json') => { const a = join(dir, nome); writeFileSync(a, JSON.stringify(doc, null, 2)); return a; };

test('CLI: ids + resolver + informar gravam o projeto novo, validado, e deixam a entrada intacta', () => comPastaTemp(dir => {
  const entrada = gravar(dir, projeto());
  const antes = readFileSync(entrada, 'utf8');
  const saida = join(dir, 'novo.json');
  const r = rodarScript(SCRIPT, [entrada, '--por', 'Maria Souza', '--em', EM, '--nota', 'revisão na obra', '--ids', 'P1.altura,P1.puxador',
    '--resolver', 'P1.cor=P1.cor.a', '--informar', 'P1.largura=79,5', '--informar', 'P1.perfil=PERFIL 3136', '--saida', saida]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 confirmado\(s\), 1 conflito\(s\) resolvido\(s\), 2 informado\(s\)/);
  assert.match(r.stderr, /AVISO: valor calculado "P1\.area"/);
  assert.equal(readFileSync(entrada, 'utf8'), antes);
  const novo = JSON.parse(readFileSync(saida, 'utf8'));
  assert.equal(novo.versaoSchema, '1.1.0');
  assert.equal(validarProjeto(novo).ok, true);
  assert.deepEqual(novo.historico.map(h => h.acao), ['confirmar', 'resolver_conflito', 'informar', 'remover_pendencias']);
  assert.ok(novo.historico.every(h => h.em === EM && h.por === 'Maria Souza'));
}));

test('CLI: tudo ou nada — um id inválido entre os válidos não grava nada (exit 1)', () => comPastaTemp(dir => {
  const entrada = gravar(dir, projeto());
  const saida = join(dir, 'novo.json');
  const r = rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.altura,P1.larg2', '--saida', saida]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"P1\.larg2" está "confirmado"/);
  assert.match(r.stderr, /Nada foi gravado/);
  assert.equal(existsSync(saida), false);
}));

test('CLI: projeto de entrada inválido → exit 1 e nada gravado', () => comPastaTemp(dir => {
  const ruim = projeto();
  ruim.pendencias = [];
  const entrada = gravar(dir, ruim);
  const saida = join(dir, 'novo.json');
  const r = rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.altura', '--saida', saida]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INVÁLIDO — projeto de entrada/);
  assert.equal(existsSync(saida), false);
}));

test('CLI: saída inválida → não grava, exit 1 (confirmar calculado inferido com entrada inferida)', () => comPastaTemp(dir => {
  const d = projeto();
  d.itens[0].dimensoes.larg2 = inferidoVal('P1.larg2', 900);
  d.pendencias.push({ id: 'pend-larg2', tipo: 'inferido_sem_confirmacao', mensagem: 'x', refs: ['P1.larg2'] });
  const entrada = gravar(dir, d);
  const saida = join(dir, 'novo.json');
  // confirmar só a área, mantendo as entradas inferidas: o calculado ficaria "melhor" que as entradas
  const r = rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.area', '--saida', saida]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /melhor que o pior estado das entradas/);
  assert.match(r.stderr, /nada foi gravado/);
  assert.equal(existsSync(saida), false);
}));

test('CLI: uso errado → exit 2 (sem --por, sem --saida, sem ação, saída = entrada, opção desconhecida, par sem "=")', () => comPastaTemp(dir => {
  const entrada = gravar(dir, projeto());
  const saida = join(dir, 'n.json');
  assert.equal(rodarScript(SCRIPT, []).status, 2);
  assert.equal(rodarScript(SCRIPT, [entrada, '--ids', 'P1.altura', '--saida', saida]).status, 2, 'falta --por');
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.altura']).status, 2, 'falta --saida');
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--saida', saida]).status, 2, 'nenhuma ação');
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.altura', '--saida', entrada]).status, 2, 'não sobrescreve a entrada');
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'a', '--saida', saida, '--x']).status, 2);
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--resolver', 'semigual', '--saida', saida]).status, 2);
  assert.equal(rodarScript(SCRIPT, [join(dir, 'nao-existe.json'), '--por', 'M', '--ids', 'a', '--saida', saida]).status, 2);
  assert.equal(existsSync(saida), false);
}));

test('CLI: sem --em usa a data de agora (ISO válida)', () => comPastaTemp(dir => {
  const entrada = gravar(dir, projeto());
  const saida = join(dir, 'n.json');
  assert.equal(rodarScript(SCRIPT, [entrada, '--por', 'M', '--ids', 'P1.puxador', '--saida', saida]).status, 0);
  const em = JSON.parse(readFileSync(saida, 'utf8')).historico[0].em;
  assert.ok(Math.abs(Date.now() - Date.parse(em)) < 60_000, em);
}));
