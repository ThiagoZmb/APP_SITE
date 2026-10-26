// Itens que a Elegance fabrica mas ainda não têm mapa para a tela (estantes/louceiros em perfil, estruturas de aço):
// ficam registrados no projeto e aparecem como "fora do escopo atual", nunca descartados em silêncio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { mapearItens, montarSaida, validarMapa } from '../scripts/lib/mapear.mjs';
import { validarProjeto } from '../scripts/lib/validacao.mjs';
import { gerarRelatorio } from '../scripts/lib/relatorio.mjs';
import { caminho, qtd, val, txt, itemPorta, docPortas, rodarScript, comPastaTemp } from './apoio.mjs';

const MAPA = JSON.parse(readFileSync(caminho('config/regras-por-dominio/portas-aluminio.json'), 'utf8'));
const validarSaida = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true })
  .compile(JSON.parse(readFileSync(caminho('schemas/itens-tela.schema.json'), 'utf8')));

const outro = (id, tipo, extra = {}) => ({
  id, tipo, quantidade: qtd(`${id}.qtd`, 2),
  dimensoes: { altura: val(`${id}.altura`, 2400) }, atributos: { sistema: txt(`${id}.sis`, 'SISTEMA THIN1802') }, ...extra,
});

test('mapa de portas declara os 4 tipos fora do escopo e continua válido', () => {
  assert.deepEqual(MAPA.foraDoEscopo.tipos, ['estante_perfil_aluminio', 'louceiro_perfil_aluminio', 'sistema_perfil_aluminio', 'estrutura_metalica_aco']);
  assert.doesNotThrow(() => validarMapa(MAPA));
});

test('item de tipo fora do escopo: registrado, vazio, não lançável, pendência informativa (não bloqueante)', () => {
  const doc = docPortas([itemPorta('P1'), outro('E1', 'estante_perfil_aluminio'), outro('M1', 'Estrutura_Metalica_Aco')]);
  assert.deepEqual(validarProjeto(doc).erros, []);
  const [p1, e1, m1] = mapearItens(doc, MAPA);
  assert.equal(p1.prontoParaLancar, true);
  assert.equal(p1.foraDoEscopo, undefined);
  for (const r of [e1, m1]) {
    assert.equal(r.foraDoEscopo, true);
    assert.equal(r.prontoParaLancar, false);
    assert.deepEqual(r.item, {});
    assert.equal(r.pendencias.length, 1);
    assert.equal(r.pendencias[0].tipo, 'fora_do_escopo');
    assert.equal(r.pendencias[0].bloqueante, false);
    assert.match(r.pendencias[0].mensagem, /fora do escopo atual \(sem mapeamento/);
  }
  assert.equal(m1.idItem, 'M1', 'tipo reconhecido sem diferença de maiúsculas');
});

test('saída: fora do escopo não bloqueia os itens de porta, mas sozinho nada é lançável', () => {
  const comPorta = montarSaida(docPortas([itemPorta('P1'), outro('E1', 'louceiro_perfil_aluminio')]), MAPA);
  assert.equal(comPorta.prontoParaLancar, true);
  assert.equal(comPorta.itens.length, 2, 'o item fora do escopo continua na saída');
  const soFora = montarSaida(docPortas([outro('E1', 'estante_perfil_aluminio')]), MAPA);
  assert.equal(soFora.prontoParaLancar, false);
  const portaPendente = montarSaida(docPortas([itemPorta('P1', it => { delete it.atributos.perfil; }), outro('E1', 'estante_perfil_aluminio')]), MAPA);
  assert.equal(portaPendente.prontoParaLancar, false, 'pendência da porta continua bloqueando');
});

test('categoria desconhecida (não declarada) continua virando traducao_sem_correspondencia: nunca adivinha', () => {
  const [r] = mapearItens(docPortas([itemPorta('P1', it => { it.tipo = 'janela_maxim_ar'; })]), MAPA);
  assert.equal(r.foraDoEscopo, undefined);
  assert.ok(r.pendencias.some(p => p.tipo === 'traducao_sem_correspondencia' && p.bloqueante));
});

test('validarMapa: foraDoEscopo malformado é recusado', () => {
  const ruim = f => () => validarMapa({ ...structuredClone(MAPA), foraDoEscopo: f });
  assert.throws(ruim({ tipos: [] }), /foraDoEscopo/);
  assert.throws(ruim({ tipos: ['a', ''] }), /foraDoEscopo/);
  assert.throws(ruim('x'), /foraDoEscopo/);
  assert.throws(ruim({ tipos: ['a'], motivo: 3 }), /motivo/);
});

test('CLI montar-itens e gerar-relatorio mostram o item fora do escopo; saída valida no schema', () => comPastaTemp(dir => {
  const doc = docPortas([itemPorta('P1'), outro('E1', 'estante_perfil_aluminio')]);
  const arq = join(dir, 'p.json');
  writeFileSync(arq, JSON.stringify(doc));
  const m = rodarScript('scripts/montar-itens.mjs', [arq]);
  assert.equal(m.status, 0, m.stderr);
  const saida = JSON.parse(m.stdout);
  assert.equal(validarSaida(saida), true, JSON.stringify(validarSaida.errors));
  assert.equal(saida.itens[1].foraDoEscopo, true);
  assert.match(m.stderr, /1 fora do escopo/);
  const r = rodarScript('scripts/gerar-relatorio.mjs', [arq]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## Fora do escopo atual \(sem mapeamento\)\n\n- Item E1 \(estante_perfil_aluminio\): fora do escopo atual/);
  assert.ok(!r.stdout.includes('Item P1 (porta_aluminio): fora do escopo'));
}));

test('relatório sem item fora do escopo não ganha a seção (golden intacto)', () => {
  assert.ok(!gerarRelatorio(docPortas([itemPorta('P1')]), { foraDoEscopo: MAPA.foraDoEscopo }).includes('Fora do escopo'));
});

test('validarMapa: categorias malformadas são recusadas; mapa de portas declara porta_aluminio', () => {
  assert.deepEqual(MAPA.categorias, ['porta_aluminio']);
  const ruim = c => () => validarMapa({ ...structuredClone(MAPA), categorias: c });
  assert.throws(ruim([]), /categorias/);
  assert.throws(ruim(['a', '']), /categorias/);
  assert.throws(ruim('x'), /categorias/);
});
