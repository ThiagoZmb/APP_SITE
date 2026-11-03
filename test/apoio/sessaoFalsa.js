// Sessão de teste: os testes assinam o JWT com este `sid`, e `sessoes.valida` o aceita
// sem consultar o banco. Nenhum desvio no código de produção: o helper só troca o método da instância.
const SID_TESTE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function aceitarSidDeTeste(sessoes) {
  if (sessoes._sidDeTeste) return;
  const original = sessoes.valida;
  sessoes.valida = async (sid, codigo) => sid === SID_TESTE ? true : original(sid, codigo);
  sessoes._sidDeTeste = true;
}

module.exports = { SID_TESTE, aceitarSidDeTeste };
