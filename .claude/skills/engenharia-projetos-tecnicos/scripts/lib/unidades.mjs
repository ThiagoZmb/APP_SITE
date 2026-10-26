// ============================================================
// UNIDADES E NÚMEROS pt-BR — comprimento interno = mm.
// Nada de arredondar: a conversão usa aritmética decimal exata (BigInt).
// ============================================================

// fator = [numerador inteiro, casas decimais]: pol = 254 / 10 = 25,4 exato
const FATORES = { mm: [1n, 0], cm: [10n, 0], m: [1000n, 0], pol: [254n, 1] };

export const UNIDADES_COMPRIMENTO = Object.freeze(Object.keys(FATORES));

// Apelidos aceitos em texto de cota → unidade canônica
const APELIDOS = { mm: 'mm', cm: 'cm', m: 'm', pol: 'pol', 'pol.': 'pol', in: 'pol', '"': 'pol', '″': 'pol' };

// 2.1 → { negativo, digitos: 21n, escala: 1 }
function decompor(valor) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(valor));
  if (!m) throw new Error(`Número não representável: ${valor}`);
  const [, sinal, inteiro, frac = '', exp = '0'] = m;
  return { sinal, digitos: BigInt(inteiro + frac), escala: frac.length - Number(exp) };
}

function paraNumero(sinal, inteiro, escala) {
  if (escala <= 0) return Number(`${sinal}${inteiro * 10n ** BigInt(-escala)}`);
  const s = inteiro.toString().padStart(escala + 1, '0');
  return Number(`${sinal}${s.slice(0, -escala)}.${s.slice(-escala)}`);
}

// Converte para mm sem arredondar (resultado = valor decimal exato mais próximo de um double)
export function paraMm(valor, unidade) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new Error(`Valor inválido para conversão: ${valor}`);
  const fator = FATORES[unidade];
  if (!fator) throw new Error(`Unidade de comprimento desconhecida: "${unidade}" (aceitas: ${UNIDADES_COMPRIMENTO.join(', ')})`);
  const { sinal, digitos, escala } = decompor(valor);
  return paraNumero(sinal, digitos * fator[0], escala + fator[1]);
}

const resultado = (valor, ambiguo = false, motivo = null, extra = {}) => ({ valor, ambiguo, motivo, ...extra });

// Número pt-BR: vírgula = decimal, ponto = milhar. "2.100" é ambíguo e NUNCA é adivinhado.
export function lerNumeroBr(texto) {
  const t = String(texto ?? '').trim();
  if (/^-?\d+$/.test(t)) return resultado(Number(t));
  if (/^-?\d+,\d+$/.test(t)) return resultado(Number(t.replace(',', '.')));
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) return resultado(Number(t.replace(/\./g, '').replace(',', '.')));
  if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(t)) {
    const milhar = Number(t.replace('.', ''));
    const decimal = Number(t);
    return resultado(null, true, `"${t}" pode ser milhar (${milhar}) ou decimal (${decimal}); confirme com o projeto`, { candidatos: [milhar, decimal] });
  }
  if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t)) return resultado(Number(t.replace(/\./g, '')));
  if (/^-?\d+\.\d+$/.test(t)) return resultado(Number(t));
  return resultado(null, false, `"${t}" não é um número reconhecido`);
}

const unidadeDe = decl => (decl && typeof decl === 'object' ? { unidade: decl.unidade, inferida: !!decl.inferida } : { unidade: decl ?? null, inferida: false });

// Lê uma cota ("210 cm", "2,1 m", "2100") e devolve o valor em mm + estado da unidade.
// unidadeDeclarada: 'mm' (declarada na prancha) | { unidade:'mm', inferida:true } | undefined
export function interpretarCota(texto, { unidadeDeclarada } = {}) {
  const base = { valorMm: null, valorOriginal: null, unidadeOriginal: null, estadoUnidade: 'ausente', ambiguo: false, pendencias: [] };
  const pendencia = mensagem => ({ tipo: 'unidade_ambigua', mensagem });
  const m = /^\s*(-?\d[\d.,]*)\s*([A-Za-zµ"″'.]*)\s*$/.exec(String(texto ?? ''));
  if (!m) return { ...base, pendencias: [pendencia(`Cota "${texto}" não segue o formato número + unidade`)] };
  const num = lerNumeroBr(m[1]);
  if (num.valor === null) return { ...base, ambiguo: num.ambiguo, pendencias: [pendencia(num.motivo)] };

  const sufixo = m[2].toLowerCase();
  let unidade, estado;
  if (sufixo) {
    unidade = APELIDOS[sufixo];
    if (!unidade) return { ...base, valorOriginal: num.valor, pendencias: [pendencia(`Unidade "${m[2]}" desconhecida na cota "${texto}"`)] };
    estado = 'confirmado'; // unidade escrita na própria cota
  } else {
    const decl = unidadeDe(unidadeDeclarada);
    if (!decl.unidade) {
      return { ...base, valorOriginal: num.valor, pendencias: [pendencia(`Cota "${texto}" sem unidade e sem unidade declarada na prancha`)] };
    }
    unidade = decl.unidade;
    estado = decl.inferida ? 'inferido' : 'confirmado';
  }
  const pendencias = estado === 'inferido' ? [pendencia(`Unidade "${unidade}" da cota "${texto}" foi inferida, não declarada`)] : [];
  return { ...base, valorMm: paraMm(num.valor, unidade), valorOriginal: num.valor, unidadeOriginal: unidade, estadoUnidade: estado, pendencias };
}
