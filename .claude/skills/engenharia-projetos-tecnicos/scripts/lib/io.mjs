// ============================================================
// ENTRADA/SAÍDA dos CLIs: leitura de JSON e da configuração do núcleo.
// ============================================================
import { readFileSync } from 'node:fs';

const CONFIG = new URL('../../config/nucleo.json', import.meta.url);

export const carregarConfig = () => JSON.parse(readFileSync(CONFIG, 'utf8'));

// Lança Error com mensagem clara se o arquivo não existe ou não é JSON
export function lerJson(caminho) {
  let texto;
  try { texto = readFileSync(caminho, 'utf8'); } catch (e) { throw Object.assign(new Error(`não foi possível ler "${caminho}": ${e.code || e.message}`), { codigo: 'leitura' }); }
  try { return JSON.parse(texto); } catch (e) { throw Object.assign(new Error(`JSON inválido em "${caminho}": ${e.message}`), { codigo: 'json' }); }
}
