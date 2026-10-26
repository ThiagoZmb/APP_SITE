// Apoio dos testes: raiz da skill, fixtures e construtores de documentos mínimos.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_URL = new URL('../', import.meta.url);
export const caminho = (...partes) => fileURLToPath(new URL(partes.join('/'), RAIZ_URL));
export const lerFixture = nome => JSON.parse(readFileSync(caminho('tests/fixtures', nome), 'utf8'));
export const normalizar = t => t.replace(/\r\n/g, '\n');

const origem = (pagina = 1, trecho = 't') => ({ arquivo: 'a.pdf', pagina, trecho });

// Valor confirmado em mm por padrão; "extra" sobrescreve qualquer campo
export const val = (id, valor, extra = {}) => ({
  id, valor, unidade: 'mm', estado: 'confirmado', confianca: 1, metodo: 'texto_vetorial', origem: origem(), ...extra,
});

// Documento mínimo válido com um item; "mudar" recebe o doc para ajustar
export function docMinimo(mudar = () => {}) {
  const doc = {
    versaoSchema: '1.0.0', dominio: 'teste', documento: { arquivo: 'a.pdf' },
    itens: [{ id: 'I1', tipo: 't', quantidade: val('I1.q', 1, { unidade: 'un' }), dimensoes: { altura: val('I1.h', 2100) }, atributos: {} }],
    pendencias: [], alertasSeguranca: [],
  };
  mudar(doc);
  return doc;
}

// ---- Apoio dos testes de mapeamento (montar-itens) ----
// Atributo de texto (sem unidade), confirmado por padrão
export const txt = (id, valor, extra = {}) => val(id, valor, { unidade: null, ...extra });
export const qtd = (id, valor) => val(id, valor, { unidade: 'un' });
export const inferidoVal = (id, valor, unidade = 'mm') => val(id, valor, { unidade, estado: 'inferido', confianca: 0.6, metodo: 'leitura_visual' });
export const ausenteVal = (id, unidade = null) => val(id, null, { unidade, estado: 'ausente', confianca: 0 });
export const conflitanteVal = (id, a, b) => val(id, null, { unidade: null, estado: 'conflitante', confianca: 0, candidatos: [txt(`${id}.a`, a), txt(`${id}.b`, b)] });

// Item de porta mínimo e completo (giro). "mudar" ajusta o item.
export function itemPorta(id = 'P1', mudar = () => {}) {
  const item = {
    id, tipo: 'porta_giro', quantidade: qtd(`${id}.qtd`, 1),
    dimensoes: { altura: val(`${id}.altura`, 2100), largura: val(`${id}.largura`, 900) },
    atributos: { perfil: txt(`${id}.perfil`, 'PERFIL EXEMPLO 25'), acabamentoPerfil: txt(`${id}.acab`, 'Anodizado') },
  };
  mudar(item);
  return item;
}

// Documento de portas válido: gera as pendências que o núcleo exige para valores incertos
export function docPortas(itens, mudar = () => {}) {
  const pendencias = [];
  for (const it of itens) {
    for (const v of [it.quantidade, ...Object.values(it.dimensoes), ...Object.values(it.atributos)]) {
      if (v.estado !== 'confirmado') pendencias.push({ id: `pend-${v.id}`, tipo: v.estado === 'inferido' ? 'inferido_sem_confirmacao' : v.estado, mensagem: `${v.id} incerto`, refs: [v.id] });
    }
  }
  const doc = { versaoSchema: '1.0.0', dominio: 'portas-aluminio', documento: { arquivo: 'a.pdf' }, itens, pendencias, alertasSeguranca: [] };
  mudar(doc);
  return doc;
}

// ---- Apoio dos testes de CLI (fase 1c) ----
// Roda um script da skill com o node atual; devolve { status, stdout, stderr } sem lançar em saída != 0
export function rodarScript(script, args = [], env = process.env) {
  const r = spawnSync(process.execPath, [caminho(script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function comPastaTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'skill-'));
  const limpar = () => rmSync(dir, { recursive: true, force: true });
  let r;
  try { r = fn(dir); } catch (e) { limpar(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(limpar);
  limpar();
  return r;
}
