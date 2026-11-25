// Alarmes das semanas: 'AAAA-MM-DD HH:MM', hora de Brasília exatamente como foi digitada (sem fuso). Funções puras.
const { validarData } = require('./minha_semana');

function validarAlarme(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):[0-5]\d$/.exec(s);
  return !!m && validarData(m[1]);
}

// DATETIME do banco ('AAAA-MM-DD HH:MM:SS') -> formato da API; vazio vira null
const alarmeDoBanco = v => (v ? String(v).slice(0, 16) : null);

module.exports = { validarAlarme, alarmeDoBanco };
