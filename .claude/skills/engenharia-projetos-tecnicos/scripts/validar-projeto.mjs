#!/usr/bin/env node
// Uso: node validar-projeto.mjs arquivo.json
// Saída: 0 = válido | 1 = inválido | 2 = uso errado ou arquivo ilegível
import { validarProjeto } from './lib/validacao.mjs';
import { aplicarVerificacoes } from './lib/cruzada.mjs';
import { carregarConfig, lerJson } from './lib/io.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
  console.error('Uso: node validar-projeto.mjs arquivo.json');
  process.exit(2);
}

let doc;
try { doc = lerJson(args[0]); } catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(e.codigo === 'json' ? 1 : 2);
}

const bruto = validarProjeto(doc);
if (!bruto.ok) {
  console.error(`INVÁLIDO — ${bruto.erros.length} erro(s):`);
  for (const e of bruto.erros) console.error(`  ${e.caminho}: ${e.mensagem}`);
  process.exit(1);
}

// Verificação cruzada: divergências viram pendências (não reprovam o documento)
const verificado = aplicarVerificacoes(doc, carregarConfig());
const novas = verificado.pendencias.slice(doc.pendencias.length);
console.log(`VÁLIDO — ${doc.itens.length} item(ns), ${verificado.pendencias.length} pendência(s).`);
for (const p of novas) console.log(`  pendência derivada [${p.tipo}]: ${p.mensagem}`);
