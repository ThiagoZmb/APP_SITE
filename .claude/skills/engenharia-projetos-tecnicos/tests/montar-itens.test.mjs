import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { caminho, normalizar, lerFixture } from './apoio.mjs';

// Estes testes só valem dentro do repositório APP_SITE (a skill copiada para outro lugar não tem calculo/ nem rotas/)
const NO_REPO = existsSync(caminho('../../../calculo/engenharia.js'));
const NA_WEB = { skip: NO_REPO ? false : 'fora do repositório APP_SITE' };
const MONTAR = caminho('scripts/montar-itens.mjs');
const PRONTO = caminho('tests/fixtures/projeto-portas-pronto.json');
const PENDENCIAS = caminho('tests/fixtures/projeto-portas-pendencias.json');
const INVALIDO = caminho('tests/fixtures/projeto-invalido-sem-pendencia.json');
const GOLDEN = caminho('tests/golden/itens-tela-exemplo.json');

const validarSaida = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true })
  .compile(JSON.parse(readFileSync(caminho('schemas/itens-tela.schema.json'), 'utf8')));

function rodar(...args) {
  try {
    const stdout = execFileSync(process.execPath, [MONTAR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout), stderr: String(e.stderr) };
  }
}
const comPasta = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('golden: projeto sintético completo gera exatamente itens-tela-exemplo.json', () => {
  const r = rodar(PRONTO);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(normalizar(r.stdout), normalizar(readFileSync(GOLDEN, 'utf8')));
  const saida = JSON.parse(r.stdout);
  assert.deepEqual(saida, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.equal(saida.prontoParaLancar, true);
  assert.ok(saida.itens.every(i => i.prontoParaLancar));
});

test('CLI: --saida grava o mesmo conteúdo e --dominio explícito equivale ao padrão', () => comPasta(dir => {
  const arq = join(dir, 'itens.json');
  const r = rodar(PRONTO, '--dominio', 'portas-aluminio', '--saida', arq);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 de 2 pronto/);
  assert.equal(normalizar(readFileSync(arq, 'utf8')), normalizar(readFileSync(GOLDEN, 'utf8')));
}));

test('CLI: a saída (pronta ou com pendências) valida no schema itens-tela', () => {
  for (const arquivo of [PRONTO, PENDENCIAS]) {
    const r = rodar(arquivo);
    assert.equal(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(validarSaida(saida), true, JSON.stringify(validarSaida.errors));
  }
  assert.equal(validarSaida({ versao: '1.0.0' }), false);
});

test('CLI: projeto com pendências sai 0, mas nada incerto entra no item e prontoParaLancar é false', () => {
  const saida = JSON.parse(rodar(PENDENCIAS).stdout);
  assert.equal(saida.prontoParaLancar, false);
  const [p3, p4] = saida.itens;
  assert.equal(p3.prontoParaLancar, false);
  assert.equal(p3.item.largura, undefined, 'inferido não entra');
  assert.equal(p3.item.detalhes.perfil, undefined, 'ausente não entra');
  assert.equal(p3.item.detalhes.cor, undefined, 'conflitante não entra');
  assert.equal(p3.sugestoes[0].valor, 800);
  assert.deepEqual(p3.pendencias.map(p => p.tipo).sort(), ['conflitante', 'inferido', 'obrigatorio_ausente']);
  assert.equal(p4.item.frente, undefined);
  assert.ok(p4.pendencias.some(p => p.tipo === 'traducao_sem_correspondencia' && p.destino === 'tipo' && p.bloqueante), 'categoria desconhecida');
  assert.equal(saida.pendenciasDocumento[0].tipo, 'divergencia');
});

test('CLI: projeto inválido → exit 1, erros no stderr e nenhuma saída gerada', () => comPasta(dir => {
  const arq = join(dir, 'itens.json');
  const r = rodar(INVALIDO, '--saida', arq);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /itens\[0\]\.dimensoes\.espessura/);
  assert.equal(existsSync(arq), false);
}));

test('CLI: JSON quebrado → exit 1; arquivo inexistente → exit 2', () => comPasta(dir => {
  const quebrado = join(dir, 'q.json');
  writeFileSync(quebrado, '{ nao e json');
  assert.equal(rodar(quebrado).status, 1);
  assert.equal(rodar(join(dir, 'nao-existe.json')).status, 2);
}));

test('CLI: uso errado → exit 2 (sem argumentos, opção solta, domínio inexistente ou perigoso)', () => {
  assert.equal(rodar().status, 2);
  assert.equal(rodar(PRONTO, '--outra').status, 2);
  assert.equal(rodar(PRONTO, '--saida').status, 2);
  assert.equal(rodar(PRONTO, '--dominio').status, 2);
  assert.equal(rodar(PRONTO, '--dominio', 'nao-existe').status, 2);
  assert.equal(rodar(PRONTO, '--dominio', '../nucleo').status, 2);
  assert.equal(rodar(PRONTO, PENDENCIAS).status, 2);
});

test('mapa portas-aluminio: valores de frente são exatamente os aceitos pela web (FRENTES_PORTA em rotas/ped_orc.js:15)', NA_WEB, () => {
  const fonte = readFileSync(caminho('../../../rotas/ped_orc.js'), 'utf8');
  const linha = /const FRENTES_PORTA = \[(.*)\];/.exec(fonte);
  assert.ok(linha, 'FRENTES_PORTA não encontrada em rotas/ped_orc.js (o arquivo mudou? atualize o mapa e as references)');
  const aceitas = [...linha[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const mapa = lerFixtureMapa();
  const traduzidas = [...new Set(Object.values(mapa.campos.find(c => c.destino === 'frente').traducao))].sort();
  assert.deepEqual(traduzidas, aceitas);
});

const lerFixtureMapa = () => JSON.parse(readFileSync(caminho('config/regras-por-dominio/portas-aluminio.json'), 'utf8'));

// ---- Prova de consumo: a web (calculo/engenharia.js) lê o item montado, sem reimplementar nenhuma regra ----
const requerer = createRequire(import.meta.url);
const engenharia = NO_REPO ? requerer(caminho('../../../calculo/engenharia.js')) : null;
const linhas = NO_REPO ? requerer(caminho('../../../calculo/linhas_vb.js')) : null;

test('consumo pela web: folhasDoItem e agruparFolhas aceitam cada item pronto (nº de folhas = qtd)', NA_WEB, () => {
  const saida = JSON.parse(rodar(PRONTO).stdout);
  const prontos = saida.itens.filter(i => i.prontoParaLancar);
  assert.equal(prontos.length, 2);
  for (const { item } of prontos) {
    const folhas = engenharia.folhasDoItem(item, {});
    assert.equal(folhas.length, item.qtd, `${item.frente}: folhas = qtd`);
    const grupos = engenharia.agruparFolhas(folhas);
    assert.equal(grupos.reduce((s, g) => s + g.qtd, 0), item.qtd);
    assert.equal(folhas[0].perfil, item.detalhes.perfil);
    assert.equal(folhas[0].acabPerfil, item.detalhes.acabamento);
    assert.equal(folhas[0].revestimento, item.detalhes.revestimento);
    // a linha comercial do VB também é montada sem erro a partir do item
    const linha = linhas.linhaComercial(item, { folhas, acessorios: [] });
    assert.ok(linha.tipoProduto && linha.descricao);
  }
});

test('consumo pela web: giro leva furos únicos e lado; a medida é a da folha (sem desconto da skill)', NA_WEB, () => {
  const giro = JSON.parse(rodar(PRONTO).stdout).itens.find(i => i.item.frente === 'Porta de giro').item;
  const [folha] = engenharia.folhasDoItem(giro, {});
  assert.equal(folha.altura, 2100);
  assert.equal(folha.largura, 900);
  assert.deepEqual(folha.furos, [100, 1000]); // a web remove o furo repetido (engenharia.js furosUnicos)
  assert.equal(folha.posicaoFuros, 'Esquerdo');
  assert.equal(folha.alturaVao, null);
});

test('consumo pela web: correr com sistema leva o VÃO; é a web que desconta (engenharia.js:31-36)', NA_WEB, () => {
  const correr = JSON.parse(rodar(PRONTO).stdout).itens.find(i => i.item.frente === 'Porta de Correr').item;
  assert.equal(correr.altura, 2100);
  assert.equal(correr.largura, 3000);
  const folhas = engenharia.folhasDoItem(correr, { descontoAlturaSistema: 30 }); // 30 = valor de teste; o real vem do banco (sistema_correr)
  assert.equal(folhas.length, 2);
  assert.equal(folhas[0].alturaVao, 2100);
  assert.equal(folhas[0].larguraVao, 3000);
  assert.equal(folhas[0].altura, 2070); // vão − desconto do sistema, feito pela web
  assert.equal(folhas[0].largura, 1525); // (3000 + 50 × 1) / 2, feito pela web
  assert.deepEqual(folhas[0].posicaoPuxador, 'Lateral Direita Centro');
  assert.equal(folhas[1].posicaoPuxador, 'Lateral Esquerda Centro');
});

test('config/barras-comerciais.json: 6000 mm, kerf 3 mm e sobra mínima 300 mm aprovados pelo usuário', () => {
  const cfg = JSON.parse(readFileSync(caminho('config/barras-comerciais.json'), 'utf8'));
  assert.equal(cfg.barraComercial.comprimentoMm, 6000);
  assert.equal(cfg.barraComercial.kerfMm, 3);
  assert.equal(cfg.barraComercial.sobraMinimaMm, 300);
  for (const chave of ['comprimentoMm', 'kerfMm', 'sobraMinimaMm']) {
    const m = cfg.metadados[`barraComercial.${chave}`];
    assert.ok(m, chave);
    assert.deepEqual(Object.keys(m).sort(), ['data', 'motivo', 'responsavel', 'status', 'versao']);
  }
  for (const chave of ['comprimentoMm', 'kerfMm', 'sobraMinimaMm']) {
    const m = cfg.metadados[`barraComercial.${chave}`];
    assert.equal(m.responsavel, 'usuário do sistema');
    assert.equal(m.status, 'aprovado');
  }
});

test('mapa portas-aluminio: metadados completos (versão, data, responsável pendente, motivo)', () => {
  const m = lerFixtureMapa().metadados;
  assert.equal(m.data, '2026-10-26');
  assert.equal(m.responsavel, null);
  assert.ok(m.versao && m.motivo);
  assert.equal(lerFixture('dominio-guarda-corpo-teste.json').metadados.responsavel, null);
});
