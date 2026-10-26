// Módulo Entregas: regras de status e validação de anexo (funções puras, sem banco)
const STATUS = Object.freeze({
  A_PROGRAMAR: 'a_programar', AGENDADA: 'agendada', EM_ROTA: 'em_rota', OCORRENCIA: 'ocorrencia',
  ENTREGUE: 'entregue', RETIRADO: 'retirado', ENVIADA: 'enviada', CANCELADA: 'cancelada'
});
const TIPOS = Object.freeze({ MOTORISTA: 'motorista', RETIRADA: 'retirada', OUTRO_ESTADO: 'outro_estado' });

const MOTIVOS_OCORRENCIA = ['ausente', 'endereco_errado', 'recusa', 'parcial'];

// em_rota: só o motorista conclui (entregue/ocorrência); a equipe pode reagendar ou cancelar para não deixar a entrega presa
// ação -> { de: status de origem, tipo: tipo exigido (null = qualquer), para: status novo, evento }
const TRANSICOES = {
  agendar: { de: ['a_programar'], tipo: null, para: 'agendada', evento: 'agendada' },
  reagendar: { de: ['ocorrencia', 'agendada', 'em_rota'], tipo: null, para: 'agendada', evento: 'reagendada' },
  saiu: { de: ['agendada'], tipo: 'motorista', para: 'em_rota', evento: 'saiu' },
  entregue: { de: ['em_rota'], tipo: 'motorista', para: 'entregue', evento: 'entregue' },
  retirada: { de: ['agendada'], tipo: 'retirada', para: 'retirado', evento: 'retirada' },
  enviada: { de: ['agendada'], tipo: 'outro_estado', para: 'enviada', evento: 'enviada' },
  comprovante: { de: ['enviada'], tipo: 'outro_estado', para: 'entregue', evento: 'comprovante' },
  cancelar: { de: ['a_programar', 'agendada', 'ocorrencia', 'em_rota'], tipo: null, para: 'cancelada', evento: 'cancelada' }
};
for (const m of MOTIVOS_OCORRENCIA) {
  TRANSICOES['ocorrencia:' + m] = { de: ['em_rota'], tipo: 'motorista', para: 'ocorrencia', evento: m };
}

// próximo status e evento do histórico; null = transição inválida
function proximo(entrega, acao) {
  if (!entrega || typeof acao !== 'string' || !Object.hasOwn(TRANSICOES, acao)) return null;
  const t = TRANSICOES[acao];
  if (!t.de.includes(entrega.status)) return null;
  if (t.tipo && entrega.tipo !== t.tipo) return null;
  return { status: t.para, evento: t.evento };
}

// valor para ped_orc.SITUACAO quando a entrega chega a esse status
function pedidoPara(status) {
  if (status === 'entregue') return 'Entregue';
  if (status === 'retirado') return 'Retirado';
  return null;
}

const LIMITE_ANEXO = 1048576; // 1 MiB

// confere tamanho, assinatura (JPEG/PNG) e se o mime declarado bate com ela
function validarAnexo(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, motivo: 'Arquivo vazio ou inválido.' };
  if (buffer.length > LIMITE_ANEXO) return { ok: false, motivo: 'Arquivo muito grande (máximo 1 MB).' };
  let tipo = null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) tipo = 'jpeg';
  else if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) tipo = 'png';
  if (!tipo) return { ok: false, motivo: 'Formato não aceito: envie uma imagem JPEG ou PNG.' };
  if (mime !== 'image/' + tipo) return { ok: false, motivo: 'O tipo informado não confere com o conteúdo do arquivo.' };
  return { ok: true, tipo };
}

module.exports = { STATUS, TIPOS, proximo, pedidoPara, validarAnexo };
