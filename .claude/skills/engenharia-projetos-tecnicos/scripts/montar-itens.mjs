#!/usr/bin/env node
// Uso: node montar-itens.mjs projeto.json [--dominio portas-aluminio] [--saida itens.json]
// Valida o projeto (schema + regras + verificação cruzada) e monta os itens no formato da tela do orçamento/pedido.
// Saída: 0 ok (mesmo com itens pendentes: ver prontoParaLancar) | 1 projeto inválido (nada é gerado) | 2 uso errado
import { existsSync, writeFileSync } from 'node:fs';
import { validarProjeto } from './lib/validacao.mjs';
import { aplicarVerificacoes } from './lib/cruzada.mjs';
import { montarSaida } from './lib/mapear.mjs';
import { carregarConfig, lerJson } from './lib/io.mjs';

const USO = 'Uso: node montar-itens.mjs projeto.json [--dominio portas-aluminio] [--saida itens.json]';
const args = process.argv.slice(2);
const posicionais = [];
const opcoes = { dominio: 'portas-aluminio', saida: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dominio' || a === '--saida') {
    const v = args[++i];
    if (!v || v.startsWith('-')) { console.error(USO); process.exit(2); }
    opcoes[a.slice(2)] = v;
  } else if (a.startsWith('-')) { console.error(USO); process.exit(2); } else posicionais.push(a);
}
// o nome do domínio vira nome de arquivo: só minúsculas, dígitos e hífen (sem "..", "/" ou "\")
if (posicionais.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(opcoes.dominio)) { console.error(USO); process.exit(2); }

const arquivoMapa = new URL(`../config/regras-por-dominio/${opcoes.dominio}.json`, import.meta.url);
if (!existsSync(arquivoMapa)) { console.error(`Erro: domínio "${opcoes.dominio}" não existe em config/regras-por-dominio/`); process.exit(2); }

let doc, mapa;
try { doc = lerJson(posicionais[0]); } catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(e.codigo === 'json' ? 1 : 2);
}
try { mapa = lerJson(arquivoMapa); } catch (e) { console.error(`Erro no mapa do domínio: ${e.message}`); process.exit(2); }

const bruto = validarProjeto(doc);
if (!bruto.ok) {
  console.error(`INVÁLIDO — itens não gerados (${bruto.erros.length} erro(s)):`);
  for (const e of bruto.erros) console.error(`  ${e.caminho}: ${e.mensagem}`);
  process.exit(1);
}

let saida;
try { saida = montarSaida(aplicarVerificacoes(doc, carregarConfig()), mapa); } catch (e) {
  console.error(`Erro no mapa do domínio: ${e.message}`);
  process.exit(2);
}
const json = `${JSON.stringify(saida, null, 2)}\n`;
const prontos = saida.itens.filter(i => i.prontoParaLancar).length;
const fora = saida.itens.filter(i => i.foraDoEscopo).length;
const resumo = `${prontos} de ${saida.itens.length} pronto(s) para lançar${fora ? ` (${fora} fora do escopo atual, sem mapeamento)` : ''}; ${saida.pendenciasDocumento.length} pendência(s) do documento.`;
if (opcoes.saida) {
  writeFileSync(opcoes.saida, json, 'utf8');
  console.log(`Itens gravados em ${opcoes.saida}: ${resumo}`);
} else {
  process.stdout.write(json);
  console.error(resumo);
}
