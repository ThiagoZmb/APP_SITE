// Horário de acesso por perfil (funções puras, sem banco).
// horario = { dias: { '0'..'6': null | { inicio: 'HH:MM', fim: 'HH:MM' } } }  (0 = domingo; null = sem acesso nesse dia; fim exclusivo)
// Sem horario = sem restrição de hora. Hora sempre de Brasília (o servidor roda em UTC).
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutos = h => { const m = REGEX_HORA.exec(h); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// Valida o que veio da tela. Devolve { horario } (null = sem restrição) ou { erro }.
function validarHorario(bruto) {
  if (bruto === null || bruto === undefined) return { horario: null };
  if (typeof bruto !== 'object' || Array.isArray(bruto) || !bruto.dias || typeof bruto.dias !== 'object') return { erro: 'Horário inválido.' };
  const dias = {};
  for (let d = 0; d <= 6; d++) {
    const v = bruto.dias[String(d)];
    if (v === null || v === undefined) { dias[String(d)] = null; continue; }
    const ini = minutos(v && v.inicio), fim = minutos(v && v.fim);
    if (ini === null || fim === null) return { erro: `${DIAS[d]}: informe hora inicial e final no formato HH:MM.` };
    if (fim <= ini) return { erro: `${DIAS[d]}: a hora final precisa ser depois da inicial.` };
    dias[String(d)] = { inicio: v.inicio, fim: v.fim };
  }
  return { horario: { dias } };
}

// lê o JSON gravado; qualquer coisa estranha = sem restrição (nunca trava todo mundo por dado ruim)
function lerHorario(texto) {
  if (!texto) return null;
  try { const r = validarHorario(typeof texto === 'string' ? JSON.parse(texto) : texto); return r.erro ? null : r.horario; } catch { return null; }
}

// dia da semana (0 = domingo) e minutos desde 00:00 em Brasília
function agoraBrasilia(data = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(data);
  const get = t => p.find(x => x.type === t).value;
  return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), min: Number(get('hour')) * 60 + Number(get('minute')) };
}

const dentroDoHorario = (horario, data = new Date()) => {
  if (!horario) return true;
  const { dia, min } = agoraBrasilia(data);
  const j = horario.dias[String(dia)];
  return !!j && min >= minutos(j.inicio) && min < minutos(j.fim);
};

// Por que o acesso está fechado agora: null (liberado) | { motivo: 'manual' | 'horario', mensagem }
function bloqueioAgora({ bloqueioManual = false, horario = null } = {}, data = new Date()) {
  if (bloqueioManual) return { motivo: 'manual', mensagem: 'Acesso bloqueado pelo administrador. Fale com o responsável.' };
  if (!dentroDoHorario(horario, data)) return { motivo: 'horario', mensagem: 'Fora do horário de acesso permitido para o seu perfil.' };
  return null;
}

module.exports = { DIAS, validarHorario, lerHorario, agoraBrasilia, dentroDoHorario, bloqueioAgora };
