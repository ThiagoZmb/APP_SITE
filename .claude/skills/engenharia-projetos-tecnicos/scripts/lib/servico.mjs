// ============================================================
// SERVIÇO — o que o sistema web (leitura de PDF, pasta leitura/ na raiz do repositório) usa da skill.
// Só compõe as funções do núcleo; nenhuma regra nova mora aqui:
//   prompt e schema da leitura → leitura.mjs + prompts/leitura-pdf-sistema.md
//   leitura → projeto-tecnico   → leitura.mjs (inferido, unidades, conflitos, segurança)
//   validação                   → validacao.mjs (schema + 7 regras)
//   verificação cruzada         → cruzada.mjs (soma de cotas, contagens; config/nucleo.json)
//   itens da tela               → mapear.mjs (montarSaida, o mesmo do montar-itens.mjs)
//   confirmação humana          → confirmacao.mjs (aplicarConfirmacoes, o mesmo do confirmar-valores.mjs)
// ============================================================
import { readFileSync } from 'node:fs';
import { validarProjeto } from './validacao.mjs';
import { aplicarVerificacoes } from './cruzada.mjs';
import { montarSaida, validarMapa } from './mapear.mjs';
import { aplicarConfirmacoes } from './confirmacao.mjs';
import { carregarConfig } from './io.mjs';
import { esquemaLeitura, validarLeitura, leituraParaProjeto, camposLeitura } from './leitura.mjs';

export { esquemaLeitura, camposLeitura };

export function carregarMapa(dominio = 'portas-aluminio') {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(dominio)) throw new Error(`domínio inválido: "${dominio}"`);
  return validarMapa(JSON.parse(readFileSync(new URL(`../../config/regras-por-dominio/${dominio}.json`, import.meta.url), 'utf8')));
}

// Prompt de sistema: metodologia da skill (prompts/leitura-pdf-sistema.md) + categorias e campos do mapa
export function textoSistema(mapa) {
  const modelo = readFileSync(new URL('../../prompts/leitura-pdf-sistema.md', import.meta.url), 'utf8');
  const lista = xs => xs.map(x => `\`${x}\``).join(', ');
  return modelo
    .replace('{{CATEGORIAS}}', lista([...(mapa.categorias ?? []), ...(mapa.foraDoEscopo?.tipos ?? [])]))
    .replace('{{FORA_DO_ESCOPO}}', lista(mapa.foraDoEscopo?.tipos ?? []))
    .replace('{{CAMPOS}}', `Campos aceitos: ${lista(camposLeitura(mapa).map(c => c.campo))}.`);
}

// Leitura do modelo → projeto-tecnico validado.
// → { ok: true, doc, extras } | { ok: false, erros: [texto] } (erros servem para pedir a correção ao modelo)
export function processarLeitura(leitura, { arquivo, sha256, paginas, mapa }) {
  const forma = validarLeitura(leitura, mapa);
  if (!forma.ok) return { ok: false, erros: forma.erros };
  let r;
  try { r = leituraParaProjeto(leitura, { arquivo, sha256, paginas, mapa }); } catch (e) { return { ok: false, erros: [e.message] }; }
  const v = validarProjeto(r.doc);
  if (!v.ok) return { ok: false, erros: v.erros.slice(0, 20).map(e => `${e.caminho}: ${e.mensagem}`) };
  return { ok: true, doc: r.doc, extras: r.extras };
}

// Projeto (sem as pendências da verificação cruzada) → documento verificado + itens da tela.
// A verificação é refeita a cada chamada: uma divergência some quando a pessoa corrige o valor errado.
export function avaliar(docBase, mapa) {
  const v = validarProjeto(docBase);
  if (!v.ok) return { ok: false, erros: v.erros.map(e => `${e.caminho}: ${e.mensagem}`) };
  const docVerificado = aplicarVerificacoes(docBase, carregarConfig());
  return { ok: true, docVerificado, saida: montarSaida(docVerificado, mapa) };
}

// Decisões da pessoa (web) → projeto novo. Tudo ou nada: qualquer erro lança Error e nada muda.
//   confirmar: [id]                       inferido → confirmado
//   rejeitar:  [{ id, motivo }]           inferido → ausente (motivo obrigatório; cada rejeição com o seu motivo)
//   informar:  [{ id, valor }]            ausente → informado (aplicado depois das rejeições: rejeitar + informar = corrigir)
//   resolver:  [{ conflitante, candidato }]
export function aplicarDecisoes(docBase, { confirmar = [], rejeitar = [], informar = [], resolver = [] } = {}, { por, em }) {
  const rejeitados = new Set(rejeitar.map(r => r.id));
  const dupla = confirmar.find(id => rejeitados.has(id));
  if (dupla) throw new Error(`o valor "${dupla}" foi marcado para confirmar e para rejeitar`);
  let doc = docBase;
  const avisos = [];
  for (const r of rejeitar) {
    const x = aplicarConfirmacoes(doc, { por, em, nota: r.motivo, rejeitar: [r.id] });
    doc = x.doc;
    avisos.push(...x.avisos);
  }
  if (confirmar.length || informar.length || resolver.length) {
    const x = aplicarConfirmacoes(doc, { por, em, ids: confirmar, informar, resolver });
    doc = x.doc;
    avisos.push(...x.avisos);
  }
  if (doc === docBase) throw new Error('nenhuma decisão enviada');
  const v = validarProjeto(doc);
  if (!v.ok) throw new Error(`as decisões gerariam um projeto inválido: ${v.erros.slice(0, 3).map(e => `${e.caminho}: ${e.mensagem}`).join('; ')}`);
  return { doc, avisos };
}
