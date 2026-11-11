// ==========================================================================
// Catálogo de permissões da web (fonte única). O banco só guarda os códigos.
// Página ou função nova? Acrescente a permissão aqui (código "area.acao") —
// ela aparece sozinha na tela de usuários. Ver a receita na especificação.
// ==========================================================================
const CATALOGO = [
  { codigo: 'paineis.ver', nome: 'Ver início e painéis', area: 'Painéis' },
  { codigo: 'indicadores.ver', nome: 'Ver os indicadores "Operação agora" e "Resultado do período" em Pedidos e Orçamentos', area: 'Painéis' },
  { codigo: 'pedidos.ver', nome: 'Ver pedidos e orçamentos', area: 'Pedidos' },
  { codigo: 'pedidos.pdf', nome: 'Abrir PDF de pedido/orçamento', area: 'Pedidos' },
  { codigo: 'pedidos.checklist', nome: 'Imprimir o checklist de produção (PDF enviado ao sistema)', area: 'Pedidos' },
  { codigo: 'checklist.enviar', nome: 'Enviar (trocar) o PDF do checklist de produção', area: 'Pedidos' },
  { codigo: 'orcamentos.criar', nome: 'Montar orçamento (também exige Valores financeiros)', area: 'Pedidos' },
  { codigo: 'orcamentos.salvar', nome: 'Salvar orçamento', area: 'Pedidos' },
  { codigo: 'orcamentos.situacao', nome: 'Marcar orçamento como Baixado (sem editar nem cancelar)', area: 'Pedidos' },
  { codigo: 'pedidos.criar', nome: 'Salvar como pedido', area: 'Pedidos' },
  { codigo: 'pedidos.cancelar', nome: 'Cancelar pedido', area: 'Pedidos' },
  { codigo: 'pedidos.situacao', nome: 'Mudar a situação do pedido (Em Produção, Pronto, Entregue, Retirado)', area: 'Pedidos' },
  { codigo: 'pedidos.excluir', nome: 'Excluir pedido/orçamento (apaga do banco, sem desfazer)', area: 'Pedidos' },
  { codigo: 'clientes.ver', nome: 'Ver clientes e análise', area: 'Clientes' },
  { codigo: 'clientes.editar', nome: 'Cadastrar e editar cliente', area: 'Clientes' },
  { codigo: 'clientes.permissao', nome: 'Bloquear/liberar cliente no sistema', area: 'Clientes' },
  { codigo: 'clientes.credito', nome: 'Conceder crédito (também exige Valores financeiros)', area: 'Clientes' },
  { codigo: 'clientes.receber', nome: 'Ver financeiro do cliente e receber (também exige Valores financeiros)', area: 'Clientes' },
  { codigo: 'estoque.ver', nome: 'Ver estoque', area: 'Estoque' },
  { codigo: 'estoque.editar', nome: 'Cadastrar e editar item, código de barras', area: 'Estoque' },
  { codigo: 'estoque.movimentar', nome: 'Dar entrada e saída', area: 'Estoque' },
  { codigo: 'estoque.desfazer', nome: 'Desfazer entrada/saída', area: 'Estoque' },
  { codigo: 'estoque.ajustar', nome: 'Ajustar estoque (inventário)', area: 'Estoque' },
  { codigo: 'compras_nfe.ver', nome: 'Ver as notas de compra da SEFAZ e sincronizar (pelo serviço local do PC; o valor também exige Valores financeiros)', area: 'Estoque' },
  { codigo: 'compras_nfe.importar', nome: 'Dar ciência da operação, baixar o XML e importar a nota de compra na entrada (também exige Dar entrada e saída)', area: 'Estoque' },
  { codigo: 'produtos.ver', nome: 'Ver cadastro de produtos', area: 'Produtos' },
  { codigo: 'produtos.editar', nome: 'Editar produto e imagem', area: 'Produtos' },
  { codigo: 'perfis.desenho', nome: 'Editar o desenho (seção) dos perfis usado no 3D do orçamento', area: 'Produtos' },
  { codigo: 'produtos.dependencias', nome: 'Editar as dependências do perfil (tipos de produto, acabamentos, puxadores, revestimentos e divisores permitidos)', area: 'Produtos' },
  { codigo: 'financeiro.ver', nome: 'Ver fluxo de caixa (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'financeiro.lancar', nome: 'Lançar, editar e mudar situação (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'financeiro.excluir', nome: 'Excluir lançamento (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'precos.ver', nome: 'Ver custos e preços (também exige Valores financeiros)', area: 'Preços' },
  { codigo: 'precos.editar', nome: 'Editar ligações de custo, parâmetros e margens', area: 'Preços' },
  { codigo: 'precos.gravar', nome: 'Gravar preço de venda no cadastro (VALOR_FIXO)', area: 'Preços' },
  { codigo: 'entregas.ver', nome: 'Ver entregas', area: 'Entregas' },
  { codigo: 'entregas.programar', nome: 'Programar entregas (agendar, reagendar, cancelar, endereço, comprovantes)', area: 'Entregas' },
  { codigo: 'entregas.baixar', nome: 'Dar baixa nas próprias entregas (motorista)', area: 'Entregas' },
  { codigo: 'entregas.checklist', nome: 'Imprimir o checklist externo da entrega (PDF para conferência e assinatura do cliente); editar os campos também exige Programar entregas', area: 'Entregas' },
  { codigo: 'fornecedores.ver', nome: 'Ver fornecedores', area: 'Cadastros' },
  { codigo: 'fornecedores.editar', nome: 'Cadastrar e editar fornecedores', area: 'Cadastros' },
  { codigo: 'funcionarios.ver', nome: 'Ver funcionários (dados pessoais; salário e encargos também exigem Valores financeiros)', area: 'Cadastros' },
  { codigo: 'funcionarios.editar', nome: 'Cadastrar e editar funcionários (salário e encargos também exigem Valores financeiros)', area: 'Cadastros' },
  { codigo: 'tintas.ver', nome: 'Ver tintas (o valor também exige Valores financeiros)', area: 'Cadastros' },
  { codigo: 'tintas.editar', nome: 'Cadastrar, editar e excluir tintas (o valor também exige Valores financeiros)', area: 'Cadastros' },
  { codigo: 'notas.ver', nome: 'Ver notas fiscais de entrada e saída (o valor também exige Valores financeiros)', area: 'Cadastros' },
  { codigo: 'notas.editar', nome: 'Lançar, editar e cancelar notas fiscais (o valor também exige Valores financeiros)', area: 'Cadastros' },
  { codigo: 'pesos.ver', nome: 'Ver o peso cadastrado de perfis, puxadores, vidros e acessórios', area: 'Cadastros' },
  { codigo: 'pesos.editar', nome: 'Cadastrar, editar e excluir o peso dos produtos', area: 'Cadastros' },
  { codigo: 'danfe.ver', nome: 'Abrir a nota fiscal em PDF (DANFE) a partir do pedido', area: 'Cadastros' },
  { codigo: 'danfe.enviar', nome: 'Enviar os PDFs das notas fiscais (DANFE) para o sistema', area: 'Cadastros' },
  { codigo: 'danfe.vincular', nome: 'Vincular à mão uma nota fiscal (DANFE) a um pedido', area: 'Cadastros' },
  { codigo: 'gestao.ver', nome: 'Ver a Central de Gestão: metas, caixa e orçamento (também exige Valores financeiros)', area: 'Gestão' },
  { codigo: 'gestao.editar', nome: 'Definir metas e orçamentos na Central de Gestão (também exige Valores financeiros)', area: 'Gestão' },
  { codigo: 'corte.ver', nome: 'Ver o plano de corte dos pedidos e os retalhos', area: 'Plano de corte' },
  { codigo: 'corte.planejar', nome: 'Gerar, salvar, conferir e confirmar o plano de corte', area: 'Plano de corte' },
  { codigo: 'corte.parametros', nome: 'Editar vara, serra e sobra mínima e cadastrar retalhos à mão', area: 'Plano de corte' },
  { codigo: 'etapas.ver', nome: 'Ver a tela de etapas de produção dos pedidos', area: 'Etapas de produção' },
  { codigo: 'etapas.corte_perfil', nome: 'Dar OK na etapa Perfil cortado', area: 'Etapas de produção' },
  { codigo: 'etapas.corte_vidro', nome: 'Dar OK na etapa Vidro cortado', area: 'Etapas de produção' },
  { codigo: 'etapas.pintura_perfil', nome: 'Dar OK na etapa Perfil pintado', area: 'Etapas de produção' },
  { codigo: 'etapas.pintura_vidro', nome: 'Dar OK na etapa Vidro pintado', area: 'Etapas de produção' },
  { codigo: 'etapas.montagem', nome: 'Dar OK na etapa Portas montadas', area: 'Etapas de produção' },
  { codigo: 'etapas.finalizar', nome: 'Dar OK em Pedido finalizado (marca o pedido como Pronto)', area: 'Etapas de produção' },
  { codigo: 'etapas.gerir', nome: 'Gerir todas as etapas de produção: qualquer etapa, N/A, desfazer e forçar o finalizado', area: 'Etapas de produção' },
  { codigo: 'atendimento.modo', nome: 'Iniciar no Modo atendimento (esconde Início, gráficos, Financeiro, Custos e Gestão; só mostra pedidos do cliente atual; o usuário pode desligar)', area: 'Especial' },
  { codigo: 'administrativo.ver', nome: 'Acesso administrativo: gráficos, indicadores, resumos e totais, telas de gestão e valores em dinheiro (sem ela o usuário é operador; com "Valores financeiros" e sem esta, é "só valores")', area: 'Especial' },
  { codigo: 'valores.ver', nome: 'Valores financeiros em qualquer tela', area: 'Especial' },
  { codigo: 'admin.usuarios', nome: 'Gerenciar usuários, perfis e permissões', area: 'Administração' },
  { codigo: 'portal.gerir', nome: 'Gerenciar o portal do cliente: liberar empresas, convidar, suspender e reiniciar o 2º fator', area: 'Administração' }
];
const CODIGOS = new Set(CATALOGO.map(p => p.codigo));

// Divisão do sistema em administrativo × operador (decisão do dono, 2026-11-10). `administrativo.ver` é a CHAVE: quem tem vê gráficos, indicadores,
// resumos, telas de gestão e dinheiro (recebe valores.ver junto). Sem a chave, estas permissões não existem, mesmo que o perfil ou uma exceção
// "liberar" as tenha. valores.ver NÃO está na lista: Vendedor e Representante veem preço para montar orçamento sem ser administrativos.
const PERMISSOES_ADMINISTRATIVAS = [
  'paineis.ver', 'indicadores.ver', 'financeiro.ver', 'financeiro.lancar', 'financeiro.excluir', 'gestao.ver', 'gestao.editar',
  'precos.ver', 'precos.editar', 'precos.gravar', 'clientes.receber', 'clientes.credito'
];
const TODAS = CATALOGO.map(p => p.codigo);

const PERFIS_INICIAIS = [
  { nome: 'Administrador', descricao: 'Acesso total, inclusive usuários e permissões', permissoes: TODAS.filter(c => c !== 'atendimento.modo') },
  { nome: 'Interno completo', descricao: 'Tudo, menos administrar usuários', permissoes: TODAS.filter(c => c !== 'admin.usuarios' && c !== 'pedidos.criar' && c !== 'pedidos.cancelar' && c !== 'pedidos.situacao' && c !== 'pedidos.excluir' &&c !== 'precos.editar' && c !== 'precos.gravar' && c !== 'entregas.baixar' && c !== 'funcionarios.ver' && c !== 'funcionarios.editar' && c !== 'gestao.ver' && c !== 'gestao.editar' && c !== 'corte.parametros' && c !== 'danfe.enviar' && c !== 'danfe.vincular' && c !== 'portal.gerir' && c !== 'etapas.finalizar' && c !== 'etapas.gerir' && c !== 'indicadores.ver' && c !== 'produtos.dependencias') },
  { nome: 'Vendedor', descricao: 'Pedidos, orçamentos e clientes, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.criar', 'orcamentos.salvar', 'clientes.ver', 'clientes.editar', 'valores.ver', 'atendimento.modo'] },
  { nome: 'Estoquista', descricao: 'Estoque sem valores financeiros', permissoes: ['estoque.ver', 'estoque.movimentar'] },
  { nome: 'Representante', descricao: 'Pedidos e clientes da sua região, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.situacao', 'clientes.ver', 'valores.ver'] },
  // operador: faz saída de estoque, atualiza status e as etapas da produção; nada de gráficos, resumos, gestão nem dinheiro
  { nome: 'Operador', descricao: 'Operação do dia a dia (saída de estoque, status do pedido, etapas, entregas), sem informações administrativas',
    permissoes: ['estoque.ver', 'estoque.movimentar', 'pedidos.ver', 'pedidos.pdf', 'pedidos.situacao', 'etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro',
      'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'entregas.ver', 'entregas.checklist', 'corte.ver'] }
];

// perfil + exceções "liberar" − exceções "bloquear"; inativo = nada; códigos fora do catálogo são ignorados
function permissoesFinais({ permissoesPerfil = [], excecoes = [], ativo }) {
  const final = new Set();
  if (!ativo) return final;
  for (const c of permissoesPerfil) if (CODIGOS.has(c)) final.add(c);
  for (const e of excecoes) {
    if (!CODIGOS.has(e.permissao)) continue;
    if (e.tipo === 'liberar') final.add(e.permissao);
    else if (e.tipo === 'bloquear') final.delete(e.permissao);
  }
  // a chave administrativa decide: com ela vem o dinheiro; sem ela as permissões administrativas somem
  if (final.has('administrativo.ver')) final.add('valores.ver');
  else for (const c of PERMISSOES_ADMINISTRATIVAS) final.delete(c);
  return final;
}

// Classe do usuário, só para exibir (nunca guardada): 'administrativo' (tem a chave), 'so_valores' (valores.ver sem a chave: vendedor/representante)
// ou 'operador' (nenhuma das duas). Recebe o conjunto de permissões FINAIS.
function classeDoAcesso(permissoes) {
  const p = permissoes instanceof Set ? permissoes : new Set(permissoes || []);
  if (p.has('administrativo.ver')) return 'administrativo';
  return p.has('valores.ver') ? 'so_valores' : 'operador';
}

// exige: lista em que todos os itens precisam ser atendidos; { algum: [...] } basta um deles
function atende(perms, exige) {
  const faltando = [];
  for (const item of exige || []) {
    if (typeof item === 'string') { if (!perms.has(item)) faltando.push(item); }
    else if (!item.algum.some(c => perms.has(c))) faltando.push('algum:' + item.algum.join('|'));
  }
  return { ok: faltando.length === 0, faltando };
}

module.exports = { CATALOGO, CODIGOS, PERFIS_INICIAIS, PERMISSOES_ADMINISTRATIVAS, permissoesFinais, classeDoAcesso, atende };
