// Minha semana (caderno de tarefas pessoal): validações e datas, funções puras.
const { validarHorario } = require('./agenda_horario');
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

// ---------- categorias (cada agenda tem a sua lista; a cor é um código da paleta fixa, nunca hexadecimal) ----------
const CORES = ['vermelho', 'laranja', 'amarelo', 'lima', 'verde', 'turquesa', 'azul', 'lavanda', 'roxo', 'rosa'];
const MAX_NOME = 30;
const MAX_CATEGORIAS = 30;

// mesma comparação da chave única do banco (utf8mb4_unicode_ci): "Médico" e "MEDICO" são o mesmo nome
const chaveNome = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// `parcial`: na alteração basta um dos dois
function validarCategoria(corpo, { parcial = false } = {}) {
  const { nome, cor } = corpo || {};
  const valor = {};
  if (nome !== undefined || !parcial) {
    if (typeof nome !== 'string') return { ok: false, motivo: 'Escreva o nome da categoria.' };
    const limpo = nome.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!limpo) return { ok: false, motivo: 'Escreva o nome da categoria.' };
    if ([...limpo].length > MAX_NOME) return { ok: false, motivo: `O nome pode ter até ${MAX_NOME} caracteres.` };
    valor.nome = limpo;
  }
  if (cor !== undefined || !parcial) {
    if (!CORES.includes(cor)) return { ok: false, motivo: 'Escolha uma das cores.' };
    valor.cor = cor;
  }
  if (!Object.keys(valor).length) return { ok: false, motivo: 'Nada para mudar.' };
  return { ok: true, valor };
}

// id de categoria: inteiro positivo de INT (o banco recusaria acima disso) ou null (sem categoria)
const categoriaValida = v => v === null || (Number.isInteger(v) && v > 0 && v < 2 ** 31);

// horário (calculo/agenda_horario.js): só nos itens dos dias; null = dia todo
const SO_DIA_TEM_HORARIO = 'Só os itens dos dias têm horário.';

function validarNova(corpo) {
  const { quadro, data, texto, categoriaId, horario } = corpo || {};
  if (!QUADROS.includes(quadro)) return { ok: false, motivo: 'Quadro inválido.' };
  if (quadro === 'dia' && !validarData(data)) return { ok: false, motivo: 'Data inválida.' };
  const t = limparTexto(texto);
  if (!t.ok) return t;
  if (categoriaId !== undefined && !categoriaValida(categoriaId)) return { ok: false, motivo: 'Categoria inválida.' };
  const h = validarHorario(horario);
  if (!h.ok) return h;
  if (h.valor && quadro !== 'dia') return { ok: false, motivo: SO_DIA_TEM_HORARIO };
  return { ok: true, valor: { quadro, data: quadro === 'dia' ? data : null, texto: t.texto, categoriaId: categoriaId ?? null, horario: h.valor ?? null } };
}

// `alarme`: 'AAAA-MM-DD HH:MM' ou null (remove). A rota ainda recusa alarme no quadro notas.
// Mover: `quadro` (e `data`, só no quadro dia). Notas não têm caixinha nem alarme.
// `horario`: { inicio, fim } ou null (dia todo); a rota ainda recusa horário em item que fica fora dos dias.
function validarMudanca(corpo) {
  const { texto, feita, alarme, quadro, data, categoriaId, horario } = corpo || {};
  const valor = {};
  if (quadro !== undefined) {
    if (!QUADROS.includes(quadro)) return { ok: false, motivo: 'Quadro inválido.' };
    if (quadro === 'dia' && !validarData(data)) return { ok: false, motivo: 'Data inválida.' };
    valor.quadro = quadro;
    valor.data = quadro === 'dia' ? data : null;
    if (quadro === 'notas' && feita === true) return { ok: false, motivo: 'Notas não têm caixinha.' };
    if (quadro === 'notas' && alarme) return { ok: false, motivo: 'Notas não têm alarme.' };
    if (quadro !== 'dia' && horario) return { ok: false, motivo: SO_DIA_TEM_HORARIO };
  } else if (data !== undefined) {
    return { ok: false, motivo: 'Informe para onde mover.' };
  }
  if (horario !== undefined) {
    const h = validarHorario(horario);
    if (!h.ok) return h;
    valor.horario = h.valor;
  }
  if (categoriaId !== undefined) {
    if (!categoriaValida(categoriaId)) return { ok: false, motivo: 'Categoria inválida.' };
    valor.categoriaId = categoriaId;
  }
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

module.exports = { QUADROS, MAX_TEXTO, CORES, MAX_NOME, MAX_CATEGORIAS, SO_DIA_TEM_HORARIO, chaveNome, validarCategoria, validarData, diasDaSemana, validarNova, validarMudanca };
