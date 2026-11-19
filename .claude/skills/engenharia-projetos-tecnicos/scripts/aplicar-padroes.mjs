#!/usr/bin/env node
// Uso: node aplicar-padroes.mjs projeto.json --saida novo.json [--texto "legenda ou observação do PDF"]...
// Completa campos AUSENTES do projeto com os padrões aprovados da Elegance (config/padroes-elegance.json).
// Tudo que vem do padrão fica "inferido" (metodo configuracao) com pendência; confirme depois com confirmar-valores.mjs.
// Saída: 0 ok | 1 projeto inválido | 2 uso errado
import { writeFileSync } from 'node:fs';
import { validarProjeto } from './lib/validacao.mjs';
import { aplicarPadroes } from './lib/padroes.mjs';
import { lerJson } from './lib/io.mjs';

const USO = 'Uso: node aplicar-padroes.mjs projeto.json --saida novo.json [--texto "..."]...';
const args = process.argv.slice(2);
const o = { entrada: null, saida: null, textos: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--saida' || a === '--texto') {
    const v = args[++i];
    if (!v || (v.startsWith('--') && a === '--saida')) { console.error(USO); process.exit(2); }
    if (a === '--saida') o.saida = v; else o.textos.push(v);
  } else if (a.startsWith('--') || o.entrada) { console.error(USO); process.exit(2); } else o.entrada = a;
}
if (!o.entrada || !o.saida) { console.error(USO); process.exit(2); }

let doc, padroes;
try {
  doc = lerJson(o.entrada);
  padroes = lerJson(new URL('../config/padroes-elegance.json', import.meta.url));
} catch (e) { console.error(`Erro: ${e.message}`); process.exit(e.codigo === 'json' ? 1 : 2); }

const antes = validarProjeto(doc);
if (!antes.ok) { console.error(`INVÁLIDO — nada foi gravado (${antes.erros.length} erro(s)):`); for (const e of antes.erros) console.error(`  ${e.caminho}: ${e.mensagem}`); process.exit(1); }

const { doc: novo, aplicados } = aplicarPadroes(doc, padroes, { textos: o.textos });
const depois = validarProjeto(novo);
if (!depois.ok) { console.error(`O resultado seria inválido — nada foi gravado:`); for (const e of depois.erros) console.error(`  ${e.caminho}: ${e.mensagem}`); process.exit(1); }
writeFileSync(o.saida, JSON.stringify(novo, null, 2) + '\n');
console.log(`Gravado em ${o.saida}: ${aplicados.length} valor(es) vindo(s) dos padrões (inferidos, com pendência).`);
for (const x of aplicados) console.log(`  ${x.id} = "${x.valor}"  [${x.regra}]`);
