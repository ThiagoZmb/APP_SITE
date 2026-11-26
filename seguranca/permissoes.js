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
  { codigo: 'pedidos.data_pronto', nome: 'Alterar a data de pronto do pedido', area: 'Pedidos' },
  { codigo: 'pedidos.desconto', nome: 'Ajustar o desconto adicional do pedido (também exige Valores financeiros)', area: 'Pedidos' },
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
  { codigo: 'entregas.programar', nome: 'Agendar entregas e corrigir endereço, contato e observação', area: 'Entregas' },
  { codigo: 'entregas.reagendar', nome: 'Reagendar entregas (só administrativo)', area: 'Entregas' },
  { codigo: 'entregas.cancelar', nome: 'Cancelar entrega', area: 'Entregas' },
  { codigo: 'entregas.criar', nome: 'Criar entrega à mão', area: 'Entregas' },
  { codigo: 'entregas.dividir', nome: 'Separar itens em outra entrega e gerar a entrega do saldo', area: 'Entregas' },
  { codigo: 'entregas.encerrar_saldo', nome: 'Encerrar o saldo a entregar', area: 'Entregas' },
  { codigo: 'entregas.concluir', nome: 'Dar baixa pela equipe (retirada, envio a outro estado, comprovante)', area: 'Entregas' },
  { codigo: 'entregas.checklist_assinado', nome: 'Anexar a foto do checklist assinado (pela tela da equipe)', area: 'Entregas' },
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
  { codigo: 'tarefas_admin.usar', nome: 'Semana compartilhada', area: 'Pessoal' },
  { codigo: 'atendimento.modo', nome: 'Iniciar no Modo atendimento (esconde Início, gráficos, Financeiro, Custos, Gestão e, de quem não é administrativo, as agendas; só mostra pedidos do cliente atual; o usuário pode desligar)', area: 'Especial' },
  { codigo: 'administrativo.ver', nome: 'Acesso administrativo: gráficos, indicadores, resumos e totais, telas de gestão e valores em dinheiro (sem ela o usuário é operador; com "Valores financeiros" e sem esta, é "só valores")', area: 'Especial' },
  { codigo: 'valores.ver', nome: 'Valores financeiros em qualquer tela', area: 'Especial' },
  { codigo: 'admin.usuarios', nome: 'Gerenciar usuários, perfis e permissões', area: 'Administração' },
  { codigo: 'portal.gerir', nome: 'Gerenciar o portal do cliente: liberar empresas, convidar, suspender e reiniciar o 2º fator', area: 'Administração' }
];
// Descrição de cada ação, em português, para a tela de usuários e perfis (o que a caixa libera, onde aparece e o que mais exige).
// Toda permissão nova precisa de uma linha aqui (test/permissoes.test.js confere).
const DESCRICOES = {
  'paineis.ver': 'Abre o Início e os painéis com gráficos e rankings. Só vale com Acesso administrativo.',
  'indicadores.ver': 'Mostra os quadros de indicadores no topo de Pedidos e Orçamentos. Só vale com Acesso administrativo.',
  'pedidos.ver': 'Lista e abre pedidos e orçamentos (sem dinheiro, a menos que tenha Valores financeiros). Também dá o histórico do pedido.',
  'pedidos.pdf': 'Abre e imprime o PDF do pedido/orçamento, a guia de produção, os vidros e as etiquetas da Zebra.',
  'pedidos.checklist': 'Abre/imprime o checklist de produção pelo botão direito do pedido.',
  'checklist.enviar': 'Troca o PDF único do checklist de produção guardado no sistema.',
  'orcamentos.criar': 'Abre a tela de orçamentos, calcula preço e lê projeto em PDF. Precisa também de Valores financeiros.',
  'orcamentos.salvar': 'Grava o orçamento montado e altera a data de pronto de orçamentos.',
  'orcamentos.situacao': 'Marca o orçamento como Baixado, sem poder editá-lo nem cancelá-lo.',
  'pedidos.criar': 'Transforma orçamento em pedido e grava alterações em pedidos existentes.',
  'pedidos.cancelar': 'Cancela o pedido (libera planos de corte e entregas ligadas).',
  'pedidos.situacao': 'Muda a situação pelo botão direito (Em Produção, Pronto, Entregue, Retirado) e desfaz o "Pedido finalizado" das etapas.',
  'pedidos.data_pronto': 'Altera só a data de pronto (data prometida) do pedido pelo botão direito; não muda a situação.',
  'pedidos.desconto': 'Troca o desconto adicional (em % ou valor final) de um pedido já salvo, pelo botão direito. Quem grava o pedido inteiro (Salvar como pedido) também muda o desconto ao salvar.',
  'pedidos.excluir': 'Apaga o pedido ou orçamento do banco. Não tem como desfazer.',
  'clientes.ver': 'Lista e abre o cadastro dos clientes (dos estados liberados ao usuário).',
  'clientes.editar': 'Cadastra e edita clientes, inclusive renomear, e vê o relatório de nomes duplicados.',
  'clientes.permissao': 'Bloqueia ou libera o cliente para novos pedidos.',
  'clientes.credito': 'Concede crédito ao cliente. Só vale com Acesso administrativo.',
  'clientes.receber': 'Vê o financeiro do cliente e registra recebimentos. Só vale com Acesso administrativo.',
  'estoque.ver': 'Lista os itens do estoque e as quantidades.',
  'estoque.editar': 'Cadastra e edita itens do estoque, o código de barras e imprime as etiquetas com QR.',
  'estoque.movimentar': 'Dá entrada (manual ou por XML da NF-e) e saída de estoque, inclusive a baixa por QR no celular e a baixa das varas/chapas no plano de corte.',
  'estoque.desfazer': 'Estorna uma entrada ou saída já registrada.',
  'estoque.ajustar': 'Corrige a quantidade do item pelo inventário (ajuste).',
  'compras_nfe.ver': 'Vê as notas de compra emitidas contra a empresa (SEFAZ) e sincroniza pelo serviço do PC.',
  'compras_nfe.importar': 'Dá ciência, baixa o XML e leva a nota de compra para a entrada de estoque.',
  'produtos.ver': 'Abre o cadastro de produtos.',
  'produtos.editar': 'Edita dados e foto do produto.',
  'perfis.desenho': 'Edita o desenho da seção do perfil usado no 3D do orçamento.',
  'produtos.dependencias': 'Define quais tipos de produto, acabamentos, puxadores, revestimentos e divisores cada perfil aceita.',
  'financeiro.ver': 'Abre o fluxo de caixa. Só vale com Acesso administrativo.',
  'financeiro.lancar': 'Lança, edita, divide e muda a situação de movimentos do caixa. Só vale com Acesso administrativo.',
  'financeiro.excluir': 'Exclui movimentos do caixa. Só vale com Acesso administrativo.',
  'precos.ver': 'Vê custos dos materiais e formação de preço. Só vale com Acesso administrativo.',
  'precos.editar': 'Edita ligações de custo, parâmetros e margens. Só vale com Acesso administrativo.',
  'precos.gravar': 'Grava o preço de venda (VALOR_FIXO) no cadastro e desfaz. Só vale com Acesso administrativo.',
  'entregas.ver': 'Abre a tela de Entregas e o detalhe de cada entrega (sem dinheiro).',
  'entregas.programar': 'Agenda a entrega que está "A programar" (data, tipo e motorista) e, pelo "Editar entrega", corrige endereço, contato e observação. Também edita os campos do checklist externo (com Imprimir o checklist externo).',
  'entregas.reagendar': 'Muda data, tipo ou motorista de entrega já agendada, em rota ou com ocorrência (botão Reagendar e "Editar entrega"). Só vale com Acesso administrativo.',
  'entregas.cancelar': 'Cancela a entrega, com motivo obrigatório.',
  'entregas.criar': 'Cria a entrega de um pedido Pronto ou Em Produção que ainda não tem nenhuma (botão "Criar entrega" e "Programar entrega" do botão direito).',
  'entregas.dividir': 'Divide o pedido em várias entregas: "Separar em outra entrega", "Gerar entrega do restante" e "Gerar entrega do saldo".',
  'entregas.encerrar_saldo': 'Dá como encerrados os itens que ficaram sem entrega. Se não sobrar nada, o pedido é marcado como Entregue/Retirado.',
  'entregas.concluir': 'Pela tela da equipe: baixa de retirada no balcão, marca como enviada (outro estado) e confirma o comprovante; inclui enviar as fotos dessas baixas. Pode fechar o pedido.',
  'entregas.checklist_assinado': 'Fotografa e anexa a folha do checklist assinada pelo cliente, pela tela de Entregas.',
  'entregas.baixar': 'Motorista: vê as próprias entregas em "Minhas entregas", registra a saída, a entrega e as ocorrências.',
  'entregas.checklist': 'Abre o PDF do checklist externo da entrega (automático, editado ou em branco).',
  'fornecedores.ver': 'Lista e abre fornecedores.',
  'fornecedores.editar': 'Cadastra e edita fornecedores.',
  'funcionarios.ver': 'Lista e abre funcionários (salário só com Valores financeiros).',
  'funcionarios.editar': 'Cadastra e edita funcionários.',
  'tintas.ver': 'Lista as tintas.',
  'tintas.editar': 'Cadastra, edita e exclui tintas.',
  'notas.ver': 'Lista as notas fiscais de entrada e saída registradas na web.',
  'notas.editar': 'Lança, edita e cancela notas fiscais (cancelar não tem volta).',
  'pesos.ver': 'Vê o peso cadastrado dos produtos.',
  'pesos.editar': 'Cadastra, edita e exclui o peso dos produtos.',
  'danfe.ver': 'Abre o PDF da nota fiscal (DANFE) ligada ao pedido.',
  'danfe.enviar': 'Envia os PDFs das notas (DANFE) para o sistema.',
  'danfe.vincular': 'Liga à mão uma nota (DANFE) a um pedido.',
  'gestao.ver': 'Abre a Central de Gestão. Só vale com Acesso administrativo.',
  'gestao.editar': 'Define metas e orçamentos na Central de Gestão. Só vale com Acesso administrativo.',
  'corte.ver': 'Vê os planos de corte de perfis e vidros e os retalhos.',
  'corte.planejar': 'Gera, salva, confere e confirma o plano de corte (a baixa no estoque também exige Dar entrada e saída).',
  'corte.parametros': 'Altera vara, serra, sobra mínima e cadastra retalhos à mão.',
  'etapas.ver': 'Abre a tela de etapas de produção.',
  'etapas.corte_perfil': 'Dá OK (ou desfaz) na etapa Perfil cortado.',
  'etapas.corte_vidro': 'Dá OK (ou desfaz) na etapa Vidro cortado.',
  'etapas.pintura_perfil': 'Dá OK (ou desfaz) na etapa Perfil pintado.',
  'etapas.pintura_vidro': 'Dá OK (ou desfaz) na etapa Vidro pintado.',
  'etapas.montagem': 'Dá OK (ou desfaz) na etapa Portas montadas.',
  'etapas.finalizar': 'Dá OK em Pedido finalizado, o que marca o pedido como Pronto.',
  'etapas.gerir': 'Mexe em qualquer etapa, marca N/A e força o finalizado.',
  'tarefas_admin.usar': 'Abre a Semana compartilhada (caderno: ver, escrever, marcar e apagar) e recebe os alarmes dele. Automática para quem tem Acesso administrativo, mesmo fora do perfil; para tirar de alguém, use Bloquear no usuário.',
  'atendimento.modo': 'Entra já no Modo atendimento (tela limpa para atender o cliente); o usuário pode desligar. O modo também esconde Minha semana e Semana compartilhada de quem não tem Acesso administrativo.',
  'administrativo.ver': 'Chave da classe administrativa: libera gráficos, indicadores, totais, gestão e dinheiro. Sem ela, as permissões marcadas "Só administrativo" não valem.',
  'valores.ver': 'Mostra preços e valores em dinheiro nas telas.',
  'admin.usuarios': 'Cria e edita usuários, perfis e permissões (esta tela).',
  'portal.gerir': 'Libera empresas no portal do cliente, convida, suspende e reinicia o 2º fator.'
};
for (const p of CATALOGO) p.descricao = DESCRICOES[p.codigo] || '';
const CODIGOS = new Set(CATALOGO.map(p => p.codigo));

// Divisão do sistema em administrativo × operador (decisão do dono, 2026-11-10). `administrativo.ver` é a CHAVE: quem tem vê gráficos, indicadores,
// resumos, telas de gestão e dinheiro (recebe valores.ver junto). Sem a chave, estas permissões não existem, mesmo que o perfil ou uma exceção
// "liberar" as tenha. valores.ver NÃO está na lista: Vendedor e Representante veem preço para montar orçamento sem ser administrativos.
const PERMISSOES_ADMINISTRATIVAS = [
  'paineis.ver', 'indicadores.ver', 'financeiro.ver', 'financeiro.lancar', 'financeiro.excluir', 'gestao.ver', 'gestao.editar',
  'precos.ver', 'precos.editar', 'precos.gravar', 'clientes.receber', 'clientes.credito',
  // permissões por ação (2026-11-17): "Reagendar entregas só pode ser feita pelo administrativo" (pedido do dono)
  'entregas.reagendar',
  // semana compartilhada entre administradores (2026-11-25)
  'tarefas_admin.usar'
];
for (const p of CATALOGO) p.administrativa = PERMISSOES_ADMINISTRATIVAS.includes(p.codigo);
const TODAS = CATALOGO.map(p => p.codigo);

const PERFIS_INICIAIS = [
  { nome: 'Administrador', descricao: 'Acesso total, inclusive usuários e permissões', permissoes: TODAS.filter(c => c !== 'atendimento.modo') },
  { nome: 'Interno completo', descricao: 'Tudo, menos administrar usuários', permissoes: TODAS.filter(c => c !== 'admin.usuarios' && c !== 'pedidos.criar' && c !== 'pedidos.cancelar' && c !== 'pedidos.situacao' && c !== 'pedidos.data_pronto' && c !== 'pedidos.excluir' &&c !== 'precos.editar' && c !== 'precos.gravar' && c !== 'entregas.baixar' && c !== 'funcionarios.ver' && c !== 'funcionarios.editar' && c !== 'gestao.ver' && c !== 'gestao.editar' && c !== 'corte.parametros' && c !== 'danfe.enviar' && c !== 'danfe.vincular' && c !== 'portal.gerir' && c !== 'etapas.finalizar' && c !== 'etapas.gerir' && c !== 'indicadores.ver' && c !== 'produtos.dependencias' && c !== 'tarefas_admin.usar') },
  { nome: 'Vendedor', descricao: 'Pedidos, orçamentos e clientes, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.criar', 'orcamentos.salvar', 'pedidos.desconto', 'clientes.ver', 'clientes.editar', 'valores.ver', 'atendimento.modo'] },
  { nome: 'Estoquista', descricao: 'Estoque sem valores financeiros', permissoes: ['estoque.ver', 'estoque.movimentar'] },
  { nome: 'Representante', descricao: 'Pedidos e clientes da sua região, com valores',
    permissoes: ['paineis.ver', 'pedidos.ver', 'pedidos.pdf', 'orcamentos.situacao', 'clientes.ver', 'valores.ver'] },
  // operador: faz saída de estoque, atualiza status e as etapas da produção; nada de gráficos, resumos, gestão nem dinheiro
  { nome: 'Operador', descricao: 'Operação do dia a dia (saída de estoque, status do pedido, etapas, entregas), sem informações administrativas',
    permissoes: ['estoque.ver', 'estoque.movimentar', 'pedidos.ver', 'pedidos.pdf', 'pedidos.situacao', 'pedidos.data_pronto', 'etapas.ver', 'etapas.corte_perfil', 'etapas.corte_vidro',
      'etapas.pintura_perfil', 'etapas.pintura_vidro', 'etapas.montagem', 'etapas.finalizar', 'entregas.ver', 'entregas.checklist', 'corte.ver'] }
];

// perfil + exceções "liberar" − exceções "bloquear"; inativo = nada; códigos fora do catálogo são ignorados.
// A chave administrativo.ver traz valores.ver e tarefas_admin.usar (esta, salvo exceção "bloquear").
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
  if (final.has('administrativo.ver')) {
    final.add('valores.ver');
    // Semana compartilhada (2026-11-26): automática para todo administrativo, esteja ou não no perfil; só "bloquear" no usuário tira
    if (!excecoes.some(e => e.permissao === 'tarefas_admin.usar' && e.tipo === 'bloquear')) final.add('tarefas_admin.usar');
  } else for (const c of PERMISSOES_ADMINISTRATIVAS) final.delete(c);
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
