// Minha semana (caderno de tarefas pessoal): validações e datas, funções puras.
const QUADROS = ['dia', 'tarefas', 'notas'];
const MAX_TEXTO = 300;

// AAAA-MM-DD que existe no calendário (2026-02-30 não vale)
function validarData(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// os sete dias a partir de `inicio`; a conta é toda em UTC, para o fuso nunca voltar um dia
function diasDaSemana(inicio) {
  const [a, m, d] = inicio.split('-').map(Number);
  const dois = n => String(n).padStart(2, '0');
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(Date.UTC(a, m - 1, d + i));
    return `${x.getUTCFullYear()}-${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`;
  });
}

// cada tarefa é uma linha só: quebra de linha vira espaço
function limparTexto(v) {
  if (typeof v !== 'string') return { ok: false, motivo: 'Escreva o texto da tarefa.' };
  const texto = v.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
  if (!texto) return { ok: false, motivo: 'Escreva o texto da tarefa.' };
  if (texto.length > MAX_TEXTO) return { ok: false, motivo: `O texto pode ter até ${MAX_TEXTO} caracteres.` };
  return { ok: true, texto };
}

function validarNova(corpo) {
  const { quadro, data, texto } = corpo || {};
  if (!QUADROS.includes(quadro)) return { ok: false, motivo: 'Quadro inválido.' };
  if (quadro === 'dia' && !validarData(data)) return { ok: false, motivo: 'Data inválida.' };
  const t = limparTexto(texto);
  if (!t.ok) return t;
  return { ok: true, valor: { quadro, data: quadro === 'dia' ? data : null, texto: t.texto } };
}

// `alarme`: 'AAAA-MM-DD HH:MM' ou null (remove). A rota ainda recusa alarme no quadro notas.
function validarMudanca(corpo) {
  const { texto, feita, alarme } = corpo || {};
  const valor = {};
  if (texto !== undefined) {
    const t = limparTexto(texto);
    if (!t.ok) return t;
    valor.texto = t.texto;
  }
  if (feita !== undefined) {
    if (typeof feita !== 'boolean') return { ok: false, motivo: 'Marcação inválida.' };
    valor.feita = feita;
  }
  if (alarme !== undefined) {
    if (alarme !== null && !require('./alarmes').validarAlarme(alarme)) return { ok: false, motivo: 'Data ou hora do alarme inválida.' };
    valor.alarme = alarme;
  }
  if (!Object.keys(valor).length) return { ok: false, motivo: 'Nada para mudar.' };
  return { ok: true, valor };
}

module.exports = { QUADROS, MAX_TEXTO, validarData, diasDaSemana, validarNova, validarMudanca };
