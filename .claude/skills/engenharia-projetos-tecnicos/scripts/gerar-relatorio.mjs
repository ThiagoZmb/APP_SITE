#!/usr/bin/env node
// Uso: node gerar-relatorio.mjs arquivo.json [--saida arq.md]
// Valida antes; se inválido, sai com 1 e NÃO gera relatório. Saída: 0 ok | 1 inválido | 2 uso errado
import { writeFileSync } from 'node:fs';
import { validarProjeto } from './lib/validacao.mjs';
import { aplicarVerificacoes } from './lib/cruzada.mjs';
import { gerarRelatorio } from './lib/relatorio.mjs';
import { carregarConfig, lerJson } from './lib/io.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--saida');
const saida = i >= 0 ? args[i + 1] : null;
const resto = i >= 0 ? args.filter((_, k) => k !== i && k !== i + 1) : args;
if (resto.length !== 1 || resto[0].startsWith('-') || (i >= 0 && (!saida || saida.startsWith('-')))) {
  console.error('Uso: node gerar-relatorio.mjs arquivo.json [--saida arq.md]');
  process.exit(2);
}

let doc;
try { doc = lerJson(resto[0]); } catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(e.codigo === 'json' ? 1 : 2);
}

const bruto = validarProjeto(doc);
if (!bruto.ok) {
  console.error(`INVÁLIDO — relatório não gerado (${bruto.erros.length} erro(s)):`);
  for (const e of bruto.erros) console.error(`  ${e.caminho}: ${e.mensagem}`);
  process.exit(1);
}

const md = gerarRelatorio(aplicarVerificacoes(doc, carregarConfig()));
if (saida) {
  writeFileSync(saida, md, 'utf8');
  console.log(`Relatório gravado em ${saida}`);
} else {
  process.stdout.write(md);
}
