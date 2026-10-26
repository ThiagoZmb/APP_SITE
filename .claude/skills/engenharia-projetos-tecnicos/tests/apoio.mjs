// Apoio dos testes: raiz da skill, fixtures e construtores de documentos mínimos.
import { readFileSync } from 'node:fs';
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
