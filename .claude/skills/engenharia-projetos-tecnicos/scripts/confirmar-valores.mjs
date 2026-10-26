#!/usr/bin/env node
// Confirmação humana registrada no projeto (tudo ou nada; o arquivo de entrada nunca é alterado).
//
// Uso: node confirmar-valores.mjs projeto.json --por "Nome" --saida novo.json
//        [--ids a,b]                      inferido → confirmado (mantém metodo e origem)
//        [--resolver conflitante=candidato]   conflitante → candidato escolhido (repetível)
//        [--informar id=valor]            ausente → valor informado pela pessoa (repetível; "num:2" para número em campo sem unidade)
//        [--rejeitar id[,id...]]          inferido → ausente (valor errado); exige --nota com o motivo
//        [--nota "..."] [--em 2026-10-26T14:30:00-03:00]   (--em: só para testes; padrão = agora)
// Saída: 0 ok | 1 entrada inválida, regra violada ou saída inválida (nada é gravado) | 2 uso errado
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validarProjeto } from './lib/validacao.mjs';
import { lerJson } from './lib/io.mjs';
import { aplicarConfirmacoes } from './lib/confirmacao.mjs';

const USO = 'Uso: node confirmar-valores.mjs projeto.json --por "Nome" --saida novo.json [--ids a,b] [--resolver conflitante=candidato] [--informar id=valor] [--rejeitar a,b] [--nota "..."] [--em ISO]';
const falhaUso = msg => { if (msg) console.error(`Erro: ${msg}`); console.error(USO); process.exit(2); };

const args = process.argv.slice(2);
const o = { entrada: null, por: null, saida: null, nota: undefined, em: null, ids: [], resolver: [], informar: [], rejeitar: [] };
const valorDe = (a, i) => { const v = args[i + 1]; if (v === undefined || (v.startsWith('--') && v.length > 2)) falhaUso(`falta o valor de ${a}`); return v; };
const par = (a, v) => {
  const k = v.indexOf('=');
  if (k < 1 || k === v.length - 1) falhaUso(`${a} espera id=valor (recebido "${v}")`);
  return [v.slice(0, k).trim(), v.slice(k + 1)];
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--por' || a === '--saida' || a === '--nota' || a === '--em') { o[a.slice(2)] = valorDe(a, i); i++; }
  else if (a === '--ids') { o.ids.push(...valorDe(a, i).split(',').map(s => s.trim()).filter(Boolean)); i++; }
  else if (a === '--rejeitar') { o.rejeitar.push(...valorDe(a, i).split(',').map(s => s.trim()).filter(Boolean)); i++; }
  else if (a === '--resolver') { const [conflitante, candidato] = par(a, valorDe(a, i)); o.resolver.push({ conflitante, candidato: candidato.trim() }); i++; }
  else if (a === '--informar') { const [id, valor] = par(a, valorDe(a, i)); o.informar.push({ id, valor }); i++; }
  else if (a.startsWith('--')) falhaUso(`opção desconhecida: ${a}`);
  else if (o.entrada === null) o.entrada = a;
  else falhaUso('informe um único arquivo de projeto');
}
if (!o.entrada) falhaUso('informe o arquivo do projeto');
if (!o.por || !o.por.trim()) falhaUso('--por é obrigatório (quem confirmou)');
if (!o.saida) falhaUso('--saida é obrigatório (o arquivo de entrada nunca é sobrescrito)');
if (resolve(o.saida) === resolve(o.entrada)) falhaUso('--saida não pode ser o próprio arquivo de entrada');
if (!o.ids.length && !o.resolver.length && !o.informar.length && !o.rejeitar.length) falhaUso('nada a fazer: use --ids, --resolver, --informar ou --rejeitar');
if (o.rejeitar.length && !(o.nota ?? '').trim()) falhaUso('--rejeitar exige --nota com o motivo da rejeição');

let doc;
try { doc = lerJson(o.entrada); } catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(e.codigo === 'json' ? 1 : 2);
}
const falha = (titulo, erros) => {
  console.error(`${titulo} (${erros.length} erro(s)):`);
  for (const e of erros) console.error(`  ${e.caminho}: ${e.mensagem}`);
  process.exit(1);
};

const antes = validarProjeto(doc);
if (!antes.ok) falha('INVÁLIDO — projeto de entrada; nada foi gravado', antes.erros);

let resultado;
try {
  resultado = aplicarConfirmacoes(doc, { por: o.por.trim(), em: o.em ?? new Date().toISOString(), nota: o.nota, ids: o.ids, resolver: o.resolver, informar: o.informar, rejeitar: o.rejeitar });
} catch (e) {
  console.error(`Erro: ${e.message}`);
  console.error('Nada foi gravado.');
  process.exit(1);
}

const depois = validarProjeto(resultado.doc);
if (!depois.ok) {
  const dep = resultado.dependentesRejeitados;
  if (dep.length) {
    depois.erros.push(...dep.map(id => ({ caminho: id, mensagem: `depende de valor rejeitado e ficou inválido: rejeite "${id}" junto (--rejeitar ${id}) ou recalcule-o antes` })));
  }
  falha('INVÁLIDO — a confirmação geraria um projeto inválido; nada foi gravado', depois.erros);
}

writeFileSync(o.saida, `${JSON.stringify(resultado.doc, null, 2)}\n`, 'utf8');
const removidas = resultado.historico.find(h => h.acao === 'remover_pendencias')?.ids.length ?? 0;
console.log(`Gravado em ${o.saida}: ${o.ids.length} confirmado(s), ${o.resolver.length} conflito(s) resolvido(s), ${o.informar.length} informado(s), ${o.rejeitar.length} rejeitado(s); ${removidas} pendência(s) removida(s); ${resultado.doc.pendencias.length} pendência(s) restante(s).`);
for (const a of resultado.avisos) console.error(`AVISO: ${a}`);
