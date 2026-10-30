// ==========================================================================
// Catálogo de permissões da web (fonte única). O banco só guarda os códigos.
// Página ou função nova? Acrescente a permissão aqui (código "area.acao") —
// ela aparece sozinha na tela de usuários. Ver a receita na especificação.
// ==========================================================================
const CATALOGO = [
  { codigo: 'paineis.ver', nome: 'Ver início e painéis', area: 'Painéis' },
  { codigo: 'pedidos.ver', nome: 'Ver pedidos e orçamentos', area: 'Pedidos' },
  { codigo: 'pedidos.pdf', nome: 'Abrir PDF de pedido/orçamento', area: 'Pedidos' },
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
  { codigo: 'financeiro.ver', nome: 'Ver fluxo de caixa (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'financeiro.lancar', nome: 'Lançar, editar e mudar situação (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'financeiro.excluir', nome: 'Excluir lançamento (também exige Valores financeiros)', area: 'Financeiro' },
  { codigo: 'precos.ver', nome: 'Ver custos e preços (também exige Valores financeiros)', area: 'Preços' },
  { codigo: 'precos.editar', nome: 'Editar ligações de custo, parâmetros e margens', area: 'Preços' },
  { codigo: 'precos.gravar', nome: 'Gravar preço de venda no cadastro (VALOR_FIXO)', area: 'Preços' },
  { codigo: 'entregas.ver', nome: 'Ver entregas', area: 'Entregas' },
  { codigo: 'entregas.programar', nome: 'Programar entregas (agendar, reagendar, cancelar, endereço, comprovantes)', area: 'Entregas' },
  { codigo: 'entregas.baixar', nome: 'Dar baixa nas próprias entregas (motorista)', area: 'Entregas' },
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
  { codigo: 'gestao.ver', nome: 'Ver a Central de Gestão: metas, caixa e orçamento (também exige Valores financeiros)', area: 'Gestão' },
  { codigo: 'gestao.editar', nome: 'Definir metas e orçamentos na Central de Gestão (também exige Valores financeiros)', area: 'Gestão' },
  { codigo: 'corte.ver', nome: 'Ver o plano de corte dos pedidos e os retalhos', area: 'Plano de corte' },
  { codigo: 'corte.planejar', nome: 'Gerar, salvar, conferir e confirmar o plano de corte', area: 'Plano de corte' },
  { codigo: 'corte.parametros', nome: 'Editar vara, serra e sobra mínima e cadastrar retalhos à mão', area: 'Plano de corte' },
  { codigo: 'atendimento.modo', nome: 'Iniciar no Modo atendimento (esconde Início, gráficos, Financeiro, Custos e Gestão; só mostra pedidos do cliente atual; o usuário pode desligar)', area: 'Especial' },
  { codigo: 'valores.ver', nome: 'Valores financeiros em qualquer tela', area: 'Especial' },
  { codigo: 'admin.usuarios', nome: 'Gerenciar usuários, perfis e permissões', area: 'Administração' }
];
const CODIGOS = new Set(CATALOGO.map(p => p.codigo));
const TODAS = CATALOGO.map(p => p.codigo);

const PERFIS_INICIAIS = [
  { nome: 'Administrador', descricao: 'Acesso total, inclusive usuários e permissões', permissoes: TODAS.filter(c => c !== 'atendimento.modo') },
  { nome: 'Interno completo', descricao: 'Tudo, menos administrar usuários', permissoes: TODAS.filter(c => c !== 'admin.usuarios' && c !== 'pedidos.criar' && c !== 'pedidos.cancelar' && c !== 'pedidos.situacao' && c !== 'pedidos.excluir' &&c !== 'precos.editar' && c !== 'precos.gravar' && c !== 'entregas.baixar' && c !== 'funcionarios.ver' && c !== 'funcionarios.editar' && c !== 'gestao.ver' && c !== 'gestao.editar' && c !== 'corte.parametros') },
  { nome: 'Vendedor', descricao: 'Pedidos, orçamentos e clientes, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.criar', 'orcamentos.salvar', 'clientes.ver', 'clientes.editar', 'valores.ver', 'atendimento.modo'] },
  { nome: 'Estoquista', descricao: 'Estoque sem valores financeiros', permissoes: ['estoque.ver', 'estoque.movimentar'] },
  { nome: 'Representante', descricao: 'Pedidos e clientes da sua região, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.situacao', 'clientes.ver', 'valores.ver'] }
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
  return final;
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

module.exports = { CATALOGO, CODIGOS, PERFIS_INICIAIS, permissoesFinais, atende };
