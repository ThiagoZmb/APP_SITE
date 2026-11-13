// Banco simulado com estado para as rotas do módulo Entregas (rotas/entregas.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
// Para estender: acrescente uma regra em `regras` (o primeiro padrão que casar responde) e, se precisar de dados,
// um helper em `semear`.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso, sessoes } = require('../../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./sessaoFalsa');
aceitarSidDeTeste(sessoes);

const duplicado = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
const PERFIS = {
  'Programador': ['entregas.ver', 'entregas.programar'],
  'Motorista': ['entregas.baixar'],
  'Motorista com valores': ['entregas.baixar', 'valores.ver'],
  'Somente ver': ['entregas.ver'],
  // administrativo (2026-11-13): a chave administrativo.ver; "com baixa" também é motorista; "sem ver" não tem entregas.ver
  'Administrativo': ['entregas.ver', 'administrativo.ver', 'valores.ver'],
  'Administrativo com baixa': ['entregas.ver', 'administrativo.ver', 'valores.ver', 'entregas.baixar'],
  'Administrativo sem ver': ['administrativo.ver', 'valores.ver']
};
const OCORRENCIAS = ['ausente', 'endereco_errado', 'recusa', 'parcial'];

function bancoEntregas() {
  const estado = {
    pedidos: [],   // ped_orc: NUMERO, TIPO, SITUACAO, RAZAO_SOCIAL, DATA_ENTREGA
    clientes: [],  // cadastro_clientes: RAZAO_SOCIAL, ESTADO, CIDADE
    entregas: [],  // web_entregas
    eventos: [],   // web_entrega_eventos
    anexos: [],    // web_entrega_anexos
    auditoria: [], // web_auditoria
    itens: [],     // itens do pedido (ped_orc_lista_itens: NUMERO, TIPO, ITEM, DESCRICAO, QTD)
    entregaItens: [], // web_entrega_itens: { id, entrega_id, numero_item, quantidade, descricao }
    encerradas: [],   // web_entrega_sobras_encerradas: { id, numero, numero_item, descricao, quantidade, hash_itens, motivo, usuario, criado_em }
    usuarios: [    // cliente_usuarios
      { CODIGO: 21, NOME: 'Motorista Um' },
      { CODIGO: 22, NOME: 'Motorista Dois' },
      { CODIGO: 30, NOME: 'Sem Acesso' }
    ],
    acessos: [     // web_usuario_acesso
      { usuario_codigo: 21, perfil_id: 9, ativo: 1 },
      { usuario_codigo: 22, perfil_id: 9, ativo: 1 },
      { usuario_codigo: 30, perfil_id: 1, ativo: 1 }
    ],
    permsPerfil: [ // web_perfil_permissoes
      { perfil_id: 9, permissao: 'entregas.baixar' },
      { perfil_id: 1, permissao: 'entregas.ver' }
    ],
    excecoes: []   // web_usuario_excecoes: { usuario_codigo, permissao, tipo }
  };
  const { pedidos, clientes, entregas, eventos, usuarios } = estado;
  const ehPronto = p => p.TIPO === 'Pedido' && p.SITUACAO === 'Pronto';
  const pedidoDe = e => pedidos.find(p => p.NUMERO === e.numero && p.TIPO === 'Pedido');
  const clienteDe = p => clientes.find(c => c.RAZAO_SOCIAL === p?.RAZAO_SOCIAL);

  const fichaDe = e => {
    const ped = pedidoDe(e); const cli = clienteDe(ped);
    return { cliente: ped?.RAZAO_SOCIAL ?? null, cli_telefone: cli?.TELEFONE ?? null, cli_rua: cli?.ENDERECO ?? null, cli_numero: cli?.NUMERO ?? null,
      cli_bairro: cli?.BAIRRO ?? null, cli_cidade: cli?.CIDADE ?? null, cli_uf: cli?.ESTADO ?? null, cli_cep: cli?.CEP ?? null };
  };
  // "Entrega n de N" (mesma regra do SQL_ORDEM da rota)
  const ordemDe = e => {
    const validas = entregas.filter(x => x.numero === e.numero && x.status !== 'cancelada').sort((a, b) => (a.sequencia - b.sequencia) || (a.id - b.id));
    return { qtd_entregas_pedido: String(validas.length), ordem_entrega: String(validas.filter(x => x.sequencia < e.sequencia || (x.sequencia === e.sequencia && x.id <= e.id)).length) };
  };
  const colunasInsert = sql => /\(([^)]+)\)\s*VALUES/.exec(sql)[1].split(',').map(c => c.trim());
  // INSERT de várias linhas (VALUES (...), (...)): devolve um objeto por linha
  const linhasInsert = (sql, params) => {
    const cols = colunasInsert(sql); const r = [];
    for (let i = 0; i < params.length; i += cols.length) r.push(Object.fromEntries(cols.map((c, k) => [c, params[i + k]])));
    return r;
  };
  const itensDoPedidoFalso = numero => estado.itens.filter(i => i.NUMERO === numero && i.TIPO === 'Pedido').sort((a, b) => a.ITEM - b.ITEM);
  const regras = [
    // ---- divisão da entrega (etapas 4 e 5) ----
    [/^SELECT \* FROM web_entregas WHERE numero = \? ORDER BY sequencia, id FOR UPDATE$/, (sql, [numero]) =>
      entregas.filter(e => e.numero === numero).sort((a, b) => (a.sequencia - b.sequencia) || (a.id - b.id)).map(e => ({ ...e }))],
    [/^SELECT \* FROM web_entregas WHERE numero IN/, (sql, nums) =>
      entregas.filter(e => nums.includes(e.numero)).sort((a, b) => (a.numero - b.numero) || (a.sequencia - b.sequencia) || (a.id - b.id)).map(e => ({ ...e }))],
    [/^SELECT i\.entrega_id, i\.numero_item, i\.descricao, i\.quantidade, i\.unidade, i\.observacao FROM web_entrega_itens i\s+JOIN web_entregas e/, (sql, nums) => {
      const ids = entregas.filter(e => nums.includes(e.numero)).map(e => e.id);
      return estado.entregaItens.filter(i => ids.includes(i.entrega_id)).sort((a, b) => (a.entrega_id - b.entrega_id) || (a.numero_item - b.numero_item) || (a.id - b.id))
        .map(i => ({ entrega_id: i.entrega_id, numero_item: i.numero_item, descricao: i.descricao, quantidade: String(i.quantidade), unidade: i.unidade ?? null, observacao: i.observacao ?? null }));
    }],
    [/^SELECT numero, numero_item, descricao, quantidade, hash_itens FROM web_entrega_sobras_encerradas WHERE numero IN/, (sql, nums) =>
      estado.encerradas.filter(x => nums.includes(x.numero)).map(x => ({ ...x, quantidade: String(x.quantidade) }))],
    [/^SELECT numero_item, quantidade, hash_itens FROM web_entrega_sobras_encerradas WHERE numero = \?$/, (sql, [numero]) =>
      estado.encerradas.filter(x => x.numero === numero).map(x => ({ numero_item: x.numero_item, quantidade: String(x.quantidade), hash_itens: x.hash_itens ?? null }))],
    [/^SELECT NUMERO, ITEM, DESCRICAO, QTD, PRODUTO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/, (sql, nums) =>
      estado.itens.filter(i => i.TIPO === 'Pedido' && nums.includes(i.NUMERO)).sort((a, b) => (a.NUMERO - b.NUMERO) || (a.ITEM - b.ITEM))
        .map(i => ({ NUMERO: i.NUMERO, ITEM: i.ITEM, DESCRICAO: i.DESCRICAO, QTD: i.QTD, PRODUTO: i.PRODUTO ?? null, OBSERVACAO: i.OBSERVACAO ?? null }))],
    // balão do calendário (rotas/pedido_itens.js): itens de todos os pedidos da lista, só texto
    [/^SELECT NUMERO, ITEM, TIPO_PRODUTO, PRODUTO, QTD, DESCRICAO, OBSERVACAO FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO IN/, (sql, nums) =>
      estado.itens.filter(i => i.TIPO === 'Pedido' && nums.includes(i.NUMERO)).sort((a, b) => (a.NUMERO - b.NUMERO) || (a.ITEM - b.ITEM))
        .map(i => ({ NUMERO: i.NUMERO, ITEM: i.ITEM, TIPO_PRODUTO: i.TIPO_PRODUTO ?? null, PRODUTO: i.PRODUTO ?? null, QTD: i.QTD, DESCRICAO: i.DESCRICAO, OBSERVACAO: i.OBSERVACAO ?? null }))],
    [/^SELECT 1 AS ok FROM ped_orc p JOIN cadastro_clientes c/, (sql, [numero, ...estados]) => {
      const cli = clienteDe(pedidos.find(p => p.NUMERO === numero && p.TIPO === 'Pedido'));
      return cli && estados.includes(cli.ESTADO) ? [{ ok: 1 }] : [];
    }],
    [/^INSERT INTO web_entregas \(/, (sql, params) => {
      const [l] = linhasInsert(sql, params);
      if (entregas.some(e => e.numero === l.numero && e.sequencia === l.sequencia)) throw duplicado(); // UNIQUE(numero, sequencia)
      const id = Math.max(0, ...entregas.map(e => e.id)) + 1;
      entregas.push({ id, tipo: null, data_agendada: null, motorista_codigo: null, endereco_rua: null, endereco_numero: null, endereco_bairro: null, endereco_cidade: null,
        endereco_uf: null, endereco_cep: null, endereco_ref: null, contato_local: null, transportadora: null, rastreio: null, previsao: null, observacao: null, hash_itens: null, ...l });
      return { affectedRows: 1, insertId: id };
    }],
    [/^INSERT INTO web_entrega_itens \(/, (sql, params) => {
      const ls = linhasInsert(sql, params);
      for (const l of ls) estado.entregaItens.push({ id: Math.max(0, ...estado.entregaItens.map(i => i.id)) + 1, ...l });
      return { affectedRows: ls.length };
    }],
    [/^DELETE FROM web_entrega_itens WHERE entrega_id = \?$/, (sql, [id]) => {
      const fica = estado.entregaItens.filter(i => i.entrega_id !== id);
      const n = estado.entregaItens.length - fica.length;
      estado.entregaItens.splice(0, estado.entregaItens.length, ...fica);
      return { affectedRows: n };
    }],
    [/^INSERT INTO web_entrega_sobras_encerradas \(/, (sql, params) => {
      const ls = linhasInsert(sql, params);
      for (const l of ls) estado.encerradas.push({ id: estado.encerradas.length + 1, ...l });
      return { affectedRows: ls.length };
    }],
    // "Saldo a entregar": pedidos Pronto com alguma entrega com lista ou hash
    [/^SELECT DISTINCT p\.NUMERO AS numero/, (sql, estados) => {
      const nums = [...new Set(entregas.filter(e => (e.hash_itens || estado.entregaItens.some(i => i.entrega_id === e.id)) && ehPronto(pedidoDe(e) || {})).map(e => e.numero))];
      return nums.sort((a, b) => a - b).map(n => {
        const ped = pedidos.find(p => p.NUMERO === n && p.TIPO === 'Pedido'); const cli = clienteDe(ped);
        return { numero: n, cliente: ped.RAZAO_SOCIAL, cliente_final: ped.CLIENTE_FINAL ?? null, pronto_em: ped.DATA_PRONTO ?? null, cidade: cli?.CIDADE ?? null, uf: cli?.ESTADO ?? null };
      }).filter(x => !sql.includes('c.ESTADO IN') || estados.includes(x.uf));
    }],

    // ---- baixa com várias entregas por pedido (etapa 3): trava do pedido antes da entrega e releitura das entregas ----
    [/^SELECT numero FROM web_entregas WHERE id = \?$/, (sql, [id]) => entregas.filter(e => e.id === id).map(e => ({ numero: e.numero }))],
    [/^SELECT SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido' FOR UPDATE$/, (sql, [numero]) =>
      pedidos.filter(x => x.NUMERO === numero && x.TIPO === 'Pedido').map(x => ({ SITUACAO: x.SITUACAO }))],
    [/^SELECT e\.id, e\.status, e\.hash_itens, \(SELECT COUNT\(\*\) FROM web_entrega_itens i WHERE i\.entrega_id = e\.id\) AS qtd_linhas_itens\s+FROM web_entregas e WHERE e\.numero = \? FOR UPDATE$/, (sql, [numero]) =>
      entregas.filter(e => e.numero === numero).map(e => ({ id: e.id, status: e.status, hash_itens: e.hash_itens ?? null, qtd_linhas_itens: String(estado.entregaItens.filter(i => i.entrega_id === e.id).length) }))],
    [/^SELECT entrega_id, numero_item, quantidade FROM web_entrega_itens WHERE entrega_id IN/, (sql, ids) =>
      estado.entregaItens.filter(i => ids.includes(i.entrega_id)).map(i => ({ entrega_id: i.entrega_id, numero_item: i.numero_item, quantidade: String(i.quantidade) }))],
    [/^SELECT ITEM, DESCRICAO, QTD FROM ped_orc_lista_itens WHERE TIPO = 'Pedido' AND NUMERO = \?/, (sql, [numero]) => itensDoPedidoFalso(numero)
      .map(i => ({ ITEM: i.ITEM, DESCRICAO: i.DESCRICAO, QTD: i.QTD }))],

    // ---- administrativo (2026-11-13): lista de TODOS os motoristas (tipo motorista), nome do motorista e filtro de estados depois da data ----
    [/AS motorista_nome,[\s\S]*AS qtd_itens/, (sql, [data, ...estados]) => entregas
      .filter(e => e.tipo === 'motorista' && ['agendada', 'em_rota', 'ocorrencia'].includes(e.status) && e.data_agendada
        && (sql.includes('<= ?') ? e.data_agendada <= data : e.data_agendada === data)
        && (!sql.includes('c.ESTADO IN') || estados.includes(clienteDe(pedidoDe(e))?.ESTADO)))
      .sort((a, b) => String(a.data_agendada).localeCompare(String(b.data_agendada)) || a.numero - b.numero)
      .map(e => ({ ...e, ...fichaDe(e), ...ordemDe(e), motorista_nome: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME ?? null,
        qtd_itens: String(estado.entregaItens.filter(i => i.entrega_id === e.id).length || estado.itens.filter(i => i.NUMERO === e.numero && i.TIPO === 'Pedido').length) }))],
    [/^SELECT \* FROM web_entregas WHERE id = \? AND tipo = 'motorista'/, (sql, [id]) => entregas.filter(e => e.id === id && e.tipo === 'motorista').map(e => ({ ...e }))],
    [/^SELECT NOME FROM cliente_usuarios WHERE CODIGO = \?$/, (sql, [codigo]) => usuarios.filter(u => u.CODIGO === codigo).map(u => ({ NOME: u.NOME }))],

    // ---- rotas do motorista (T6): o dono é sempre motorista_codigo ----
    [/AS qtd_itens/, (sql, [uid, data]) => entregas
      .filter(e => e.motorista_codigo === uid && e.tipo === 'motorista' && ['agendada', 'em_rota', 'ocorrencia'].includes(e.status) && e.data_agendada
        && (sql.includes('<= ?') ? e.data_agendada <= data : e.data_agendada === data))
      .sort((a, b) => String(a.data_agendada).localeCompare(String(b.data_agendada)) || a.numero - b.numero)
      .map(e => ({ ...e, ...fichaDe(e), ...ordemDe(e),
        // itens DESTA entrega (lista dela); sem lista = itens do pedido inteiro
        qtd_itens: String(estado.entregaItens.filter(i => i.entrega_id === e.id).length || estado.itens.filter(i => i.NUMERO === e.numero && i.TIPO === 'Pedido').length) }))],
    [/FROM web_entregas WHERE id = \? AND motorista_codigo = \?/, (sql, [id, uid]) =>
      entregas.filter(e => e.id === id && e.motorista_codigo === uid && e.tipo === 'motorista').map(e => ({ ...e }))],
    [/^SELECT p\.RAZAO_SOCIAL AS cliente, c\.TELEFONE AS cli_telefone/, (sql, [numero]) => {
      const ped = pedidos.find(p => p.NUMERO === numero && p.TIPO === 'Pedido'); return ped ? [fichaDe({ numero })] : [];
    }],
    [/^SELECT id, tipo, mime, criado_em FROM web_entrega_anexos WHERE entrega_id = \? AND \(evento_id IS NOT NULL OR criado_por = \?\)/, (sql, [id, por]) =>
      estado.anexos.filter(a => a.entrega_id === id && (a.evento_id != null || a.criado_por === por)).map(({ id: i, tipo, mime, criado_em }) => ({ id: i, tipo, mime, criado_em }))],
    [/^SELECT mime, dados FROM web_entrega_anexos WHERE id = \? AND entrega_id = \? AND \(evento_id IS NOT NULL OR criado_por = \?\)/, (sql, [id, entrega_id, por]) =>
      estado.anexos.filter(a => a.id === id && a.entrega_id === entrega_id && (a.evento_id != null || a.criado_por === por)).map(a => ({ mime: a.mime, dados: a.dados }))],
    [/AND tipo = 'foto' AND id IN/, (sql, [entrega_id, criado_por, ...ids]) =>
      estado.anexos.filter(a => a.entrega_id === entrega_id && a.criado_por === criado_por && a.evento_id == null && a.tipo === 'foto' && ids.includes(a.id)).map(a => ({ id: a.id }))],

    // listagem (GET /entregas): os filtros entram no SQL na ordem status, busca (2 parâmetros), estados
    [/AS data_prometida/, (sql, params) => {
      const p = [...params];
      const status = sql.includes('e.status = ?') ? p.shift() : null;
      const busca = sql.includes('LIKE') ? (p.shift(), p.shift()) : null;
      const estados = sql.includes('c.ESTADO IN') ? p : null;
      const termo = busca === null ? null : String(busca).replace(/%/g, '').toLowerCase();
      return entregas.map(e => {
        const ped = pedidoDe(e); const cli = clienteDe(ped);
        return ped && { e, ped, cli };
      }).filter(x => x
        && (status === null || x.e.status === status)
        && (termo === null || String(x.e.numero).includes(termo) || String(x.ped.RAZAO_SOCIAL).toLowerCase().includes(termo))
        && (estados === null || (x.cli && estados.includes(x.cli.ESTADO))))
        .sort((a, b) => (a.e.data_agendada ? 0 : 1) - (b.e.data_agendada ? 0 : 1)
          || String(a.e.data_agendada).localeCompare(String(b.e.data_agendada)) || a.e.numero - b.e.numero)
        .map(({ e, ped, cli }) => ({
          id: e.id, numero: e.numero, status: e.status, tipo: e.tipo, data_agendada: e.data_agendada,
          data_prometida: ped.DATA_PRONTO || null, data_pedido: ped.DATA || null, cliente: ped.RAZAO_SOCIAL, situacao_pedido: ped.SITUACAO ?? null,
          cidade: e.endereco_cidade || cli?.CIDADE || null, uf: e.endereco_uf || cli?.ESTADO || null,
          motorista: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME || null,
          qtd_ocorrencias: String(eventos.filter(v => v.entrega_id === e.id && OCORRENCIAS.includes(v.tipo)).length),
          ...ordemDe(e)
        }));
    }],
    // varredura em lote: INSERT IGNORE ... SELECT dos pedidos Pronto sem registro (UNIQUE(numero, sequencia), sequencia 1) e eventos 'criada' das entregas sem evento
    [/^INSERT IGNORE INTO web_entregas \(numero, sequencia, status, criado_em, atualizado_em\)\s+SELECT p\.NUMERO, 1, 'a_programar'/, (sql, [criado_em, atualizado_em]) => {
      const novos = pedidos.filter(p => ehPronto(p) && !entregas.some(e => e.numero === p.NUMERO));
      for (const p of novos) {
        entregas.push({ id: entregas.length + 1, numero: p.NUMERO, sequencia: 1, status: 'a_programar', tipo: null, data_agendada: null, motorista_codigo: null,
          endereco_rua: null, endereco_numero: null, endereco_bairro: null, endereco_cidade: null, endereco_uf: null, endereco_cep: null,
          endereco_ref: null, contato_local: null, transportadora: null, rastreio: null, previsao: null, observacao: null, criado_em, atualizado_em });
      }
      return { affectedRows: novos.length, insertId: novos.length ? entregas.length - novos.length + 1 : 0 };
    }],
    [/^INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo\)\s+SELECT/, (sql, [quando]) => {
      const sem = entregas.filter(e => !eventos.some(v => v.entrega_id === e.id));
      for (const e of sem) eventos.push({ id: eventos.length + 1, entrega_id: e.id, quando, usuario: 'sistema', tipo: 'criada', motivo: null, entregue_a: null, detalhe: null });
      return { affectedRows: sem.length };
    }],
    [/INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo\) VALUES/, (sql, [entrega_id, quando, usuario, tipo, motivo]) => {
      eventos.push({ id: eventos.length + 1, entrega_id, quando, usuario, tipo, motivo: motivo ?? null, entregue_a: null, detalhe: null });
      return { affectedRows: 1, insertId: eventos.length };
    }],
    // (2026-11-11) encerrada com o pedido cujo pedido não está mais Entregue/Retirado (último evento = 'encerrada')
    [/^SELECT e\.id, e\.status, v\.detalhe FROM web_entregas e JOIN ped_orc p/, () =>
      entregas.filter(e => ['entregue', 'retirado'].includes(e.status)).map(e => {
        const ped = pedidoDe(e); const ult = eventos.filter(v => v.entrega_id === e.id).sort((x, y) => y.id - x.id)[0];
        return ped && ult && ult.tipo === 'encerrada' && !['Entregue', 'Retirado'].includes(ped.SITUACAO ?? '') ? { id: e.id, status: e.status, detalhe: ult.detalhe } : null;
      }).filter(Boolean)],
    // (2026-11-11) pedido Entregue/Retirado: A programar/Agendada/Ocorrência e a cancelada pela varredura por "saiu de Pronto" (último evento)
    [/^SELECT e\.id, e\.status, p\.SITUACAO AS situacao FROM web_entregas e JOIN ped_orc p/, (sql, [motivo]) =>
      entregas.map(e => ({ e, ped: pedidoDe(e) })).filter(({ e, ped }) => ped && ['Entregue', 'Retirado'].includes(ped.SITUACAO) && (
        ['a_programar', 'agendada', 'ocorrencia'].includes(e.status)
        || (e.status === 'cancelada' && (() => { const u = eventos.filter(v => v.entrega_id === e.id).sort((x, y) => y.id - x.id)[0];
          return u && u.usuario === 'sistema' && u.tipo === 'cancelada' && u.motivo === motivo; })())))
        .sort((a, b) => a.e.id - b.e.id).map(({ e, ped }) => ({ id: e.id, status: e.status, situacao: ped.SITUACAO }))],
    [/^UPDATE web_entregas SET status = \?, atualizado_em = \? WHERE id = \? AND status = \?$/, (sql, [para, atualizado_em, id, de]) => {
      const e = entregas.find(x => x.id === id && x.status === de);
      if (!e) return { affectedRows: 0 };
      Object.assign(e, { status: para, atualizado_em }); return { affectedRows: 1 };
    }],
    // pedido Cancelado: A programar, Agendada e Ocorrência (Em rota fica)
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status IN \('a_programar', 'agendada', 'ocorrencia'\)/, () =>
      entregas.filter(e => ['a_programar', 'agendada', 'ocorrencia'].includes(e.status)).filter(e => pedidoDe(e)?.SITUACAO === 'Cancelado').map(e => ({ id: e.id }))],
    // cancelamento: A programar cujo pedido deixou de estar Pronto
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status = 'a_programar'/, () =>
      entregas.filter(e => e.status === 'a_programar').filter(e => { const p = pedidoDe(e); return p && !ehPronto(p) && p.SITUACAO !== 'Em Produção'; }).map(e => ({ id: e.id }))],
    [/^UPDATE web_entregas SET status = 'cancelada', atualizado_em = \? WHERE id = \? AND status IN \(([^)]*)\)/, (sql, [atualizado_em, id]) => {
      const de = /status IN \(([^)]*)\)/.exec(sql)[1].split(',').map(x => x.trim().replace(/'/g, ''));
      const e = entregas.find(x => x.id === id && de.includes(x.status));
      if (!e) return { affectedRows: 0 };
      Object.assign(e, { status: 'cancelada', atualizado_em }); return { affectedRows: 1 };
    }],
    // reabertura: cancelada pela varredura por "saiu de Pronto" (último evento) cujo pedido voltou a Pronto
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status = 'cancelada'/, (sql, [motivo]) =>
      entregas.filter(e => e.status === 'cancelada' && ehPronto(pedidoDe(e) || {})).filter(e => {
        const ult = eventos.filter(v => v.entrega_id === e.id).sort((x, y) => y.id - x.id)[0];
        return ult && ult.usuario === 'sistema' && ult.tipo === 'cancelada' && ult.motivo === motivo;
      }).map(e => ({ id: e.id }))],
    [/^UPDATE web_entregas SET status = 'a_programar', atualizado_em = \? WHERE id = \? AND status = 'cancelada'/, (sql, [atualizado_em, id]) => {
      const e = entregas.find(x => x.id === id && x.status === 'cancelada');
      if (!e) return { affectedRows: 0 };
      Object.assign(e, { status: 'a_programar', atualizado_em }); return { affectedRows: 1 };
    }],

    // ---- programar entrega (T4) ----
    // detalhe de uma entrega + endereço do cadastro do cliente (filtro de estados opcional, depois do id)
    [/AS cli_endereco/, (sql, [id, ...estados]) => {
      const e = entregas.find(x => x.id === id); if (!e) return [];
      const ped = pedidoDe(e); const cli = clienteDe(ped);
      if (sql.includes('c.ESTADO IN') && !(cli && estados.includes(cli.ESTADO))) return [];
      return [{ ...e, situacao_pedido: ped?.SITUACAO ?? null, cliente: ped?.RAZAO_SOCIAL ?? null, prometida: ped?.DATA_PRONTO ?? null, data_pedido: ped?.DATA ?? null,
        cli_endereco: cli?.ENDERECO ?? null, cli_numero: cli?.NUMERO ?? null, cli_bairro: cli?.BAIRRO ?? null, cli_cidade: cli?.CIDADE ?? null,
        cli_estado: cli?.ESTADO ?? null, cli_cep: cli?.CEP ?? null, cli_telefone: cli?.TELEFONE ?? null,
        motorista_nome: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME ?? null }];
    }],
    [/FROM web_entrega_eventos WHERE entrega_id = \? ORDER BY/, (sql, [id]) => eventos.filter(v => v.entrega_id === id)],
    [/FROM ped_orc_lista_itens/, (sql, [numero]) => estado.itens.filter(i => i.NUMERO === numero && i.TIPO === 'Pedido')
      .sort((a, b) => a.ITEM - b.ITEM).map(i => ({ ITEM: i.ITEM, DESCRICAO: i.DESCRICAO, QTD: i.QTD }))], // itensDoPedido (item, descrição e quantidade)
    // motoristas: ativos, com entregas.baixar pelo perfil ou liberado, e não bloqueado
    [/FROM cliente_usuarios u JOIN web_usuario_acesso/, () => {
      const exc = (u, tipo) => estado.excecoes.some(x => x.usuario_codigo === u.CODIGO && x.permissao === 'entregas.baixar' && x.tipo === tipo);
      return usuarios.filter(u => {
        const a = estado.acessos.find(x => x.usuario_codigo === u.CODIGO);
        if (!a || a.ativo !== 1) return false;
        const doPerfil = estado.permsPerfil.some(p => p.perfil_id === a.perfil_id && p.permissao === 'entregas.baixar');
        return (doPerfil || exc(u, 'liberar')) && !exc(u, 'bloquear');
      }).sort((a, b) => a.NOME.localeCompare(b.NOME)).map(u => ({ CODIGO: u.CODIGO, NOME: u.NOME }));
    }],
    [/FROM web_entregas WHERE id = \? FOR UPDATE/, (sql, [id]) => entregas.filter(e => e.id === id).map(e => ({ ...e }))],
    [/SELECT 1 AS ok FROM web_entregas e/, (sql, [id, ...estados]) => {
      const e = entregas.find(x => x.id === id); const cli = e && clienteDe(pedidoDe(e));
      return cli && estados.includes(cli.ESTADO) ? [{ ok: 1 }] : [];
    }],
    // UPDATE genérico: "SET a = ?, b = ? WHERE id = ?" (as colunas vêm do próprio SQL)
    [/^UPDATE web_entregas SET [\s\S]* WHERE id = \?$/, (sql, params) => {
      const cols = /SET ([\s\S]*) WHERE/.exec(sql)[1].split(',').map(s => s.trim().replace(/ = \?$/, ''));
      const e = entregas.find(x => x.id === params[cols.length]); if (!e) return { affectedRows: 0 };
      cols.forEach((c, i) => { e[c] = params[i]; });
      return { affectedRows: 1 };
    }],
    [/INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a\)/, (sql, [entrega_id, quando, usuario, tipo, motivo, detalhe, entregue_a]) => {
      eventos.push({ id: eventos.length + 1, entrega_id, quando, usuario, tipo, motivo: motivo ?? null, entregue_a: entregue_a ?? null, detalhe: detalhe ?? null });
      return { affectedRows: 1, insertId: eventos.length };
    }],
    [/INSERT INTO web_auditoria \(quando, quem, acao, alvo, detalhe\)/, (sql, [quando, quem, acao, alvo, detalhe]) => {
      estado.auditoria.push({ quando, quem, acao, alvo, detalhe }); return { affectedRows: 1, insertId: estado.auditoria.length };
    }],

    // ---- anexos e baixa (T5) ----
    [/^SELECT id, status FROM web_entregas WHERE id = \?$/, (sql, [id]) => entregas.filter(e => e.id === id).map(e => ({ id: e.id, status: e.status }))],
    [/^SELECT COUNT\(\*\) AS n FROM web_entrega_anexos/, (sql, [entrega_id, criado_por]) =>
      [{ n: String(estado.anexos.filter(a => a.entrega_id === entrega_id && a.criado_por === criado_por && a.evento_id == null).length) }]],
    [/^INSERT INTO web_entrega_anexos \(entrega_id, tipo, mime, dados, criado_por, criado_em\)/, (sql, [entrega_id, tipo, mime, dados, criado_por, criado_em]) => {
      const id = estado.anexos.length + 1;
      estado.anexos.push({ id, entrega_id, evento_id: null, tipo, mime, dados, criado_por, criado_em });
      return { affectedRows: 1, insertId: id };
    }],
    // anexos que o usuário pode vincular: da entrega, dele e ainda soltos
    [/^SELECT id FROM web_entrega_anexos WHERE entrega_id = \? AND criado_por = \? AND evento_id IS NULL AND id IN/, (sql, [entrega_id, criado_por, ...ids]) =>
      estado.anexos.filter(a => a.entrega_id === entrega_id && a.criado_por === criado_por && a.evento_id == null && ids.includes(a.id)).map(a => ({ id: a.id }))],
    [/^UPDATE web_entrega_anexos SET evento_id = \? WHERE id IN/, (sql, [evento_id, ...ids]) => {
      const alvo = estado.anexos.filter(a => ids.includes(a.id)); alvo.forEach(a => { a.evento_id = evento_id; });
      return { affectedRows: alvo.length };
    }],
    // baixa no pedido: SITUACAO + DATA_ENTREGA (como o VB); com "<> 'Cancelado'" só atinge pedido não cancelado
    [/^UPDATE ped_orc SET SITUACAO = \?/, (sql, params) => {
      const comData = sql.includes('DATA_ENTREGA = ?');
      const [situacao, ...resto] = params; const data = comData ? resto.shift() : undefined; const [numero] = resto;
      const p = pedidos.find(x => x.NUMERO === numero && x.TIPO === 'Pedido');
      if (!p || (sql.includes("SITUACAO <> 'Cancelado'") && p.SITUACAO === 'Cancelado')) return { affectedRows: 0 };
      p.SITUACAO = situacao; if (comData) p.DATA_ENTREGA = data; return { affectedRows: 1 };
    }],
    [/^SELECT SITUACAO FROM ped_orc WHERE NUMERO = \? AND TIPO = 'Pedido'$/, (sql, [numero]) =>
      pedidos.filter(x => x.NUMERO === numero && x.TIPO === 'Pedido').map(x => ({ SITUACAO: x.SITUACAO }))],
    [/^SELECT id, tipo, mime, criado_em FROM web_entrega_anexos WHERE entrega_id = \? AND evento_id IS NOT NULL/, (sql, [id]) =>
      estado.anexos.filter(a => a.entrega_id === id && a.evento_id != null).map(({ id: i, tipo, mime, criado_em }) => ({ id: i, tipo, mime, criado_em }))],
    [/^SELECT mime, dados FROM web_entrega_anexos WHERE id = \? AND entrega_id = \?/, (sql, [id, entrega_id]) =>
      estado.anexos.filter(a => a.id === id && a.entrega_id === entrega_id).map(a => ({ mime: a.mime, dados: a.dados }))]
  ];
  const f = criarPoolFalso(regras);
  // como no MySQL: ROLLBACK desfaz o que a transação mudou (BEGIN tira uma foto do estado; ROLLBACK volta a ela)
  const conectar = f.getConnection;
  f.getConnection = async () => {
    const c = await conectar();
    let foto = null;
    return { ...c,
      beginTransaction: async () => { foto = JSON.parse(JSON.stringify(estado)); await c.beginTransaction(); },
      rollback: async () => {
        if (foto) for (const k of Object.keys(estado)) {
          const atual = estado[k];
          foto[k].forEach((o, i) => { if (atual[i] && typeof o === 'object') { for (const ch of Object.keys(atual[i])) delete atual[i][ch]; Object.assign(atual[i], o); } });
          atual.splice(foto[k].length, atual.length - foto[k].length);
          for (let i = atual.length; i < foto[k].length; i++) atual.push(foto[k][i]);
        }
        await c.rollback();
      } };
  };

  const semear = {
    cliente: (c = {}) => { const x = { RAZAO_SOCIAL: 'CLIENTE TESTE LTDA', ESTADO: 'RJ', CIDADE: 'Niterói', ...c }; clientes.push(x); return x; },
    pedido: (p = {}) => { const x = { NUMERO: pedidos.length + 100, TIPO: 'Pedido', SITUACAO: 'Pronto', RAZAO_SOCIAL: 'CLIENTE TESTE LTDA', DATA_ENTREGA: null, DATA_PRONTO: null, DATA: null, ...p }; pedidos.push(x); return x; },
    // registro de web_entregas já existente (para testar o que a varredura não pode mexer)
    entrega: (e = {}) => {
      const x = { id: entregas.length + 1, numero: 100, sequencia: 1, status: 'a_programar', tipo: null, data_agendada: null, motorista_codigo: null,
        endereco_rua: null, endereco_numero: null, endereco_bairro: null, endereco_cidade: null, endereco_uf: null, endereco_cep: null,
        endereco_ref: null, contato_local: null, transportadora: null, rastreio: null, previsao: null, observacao: null,
        criado_em: '2026-10-01 08:00:00', atualizado_em: '2026-10-01 08:00:00', ...e };
      entregas.push(x); return x;
    },
    // linha de web_entrega_itens (entrega com lista de itens = entrega parcial)
    entregaItem: (i = {}) => { const x = { id: estado.entregaItens.length + 1, entrega_id: 1, numero_item: 1, quantidade: 1, descricao: 'Item', ...i }; estado.entregaItens.push(x); return x; },
    // item do pedido (ped_orc_lista_itens)
    item: (i = {}) => { const x = { NUMERO: 100, TIPO: 'Pedido', ITEM: estado.itens.length + 1, DESCRICAO: 'Item', QTD: 1, ...i }; estado.itens.push(x); return x; },
    evento: (v = {}) => { const x = { id: eventos.length + 1, entrega_id: 1, quando: '2026-10-01 08:00:00', usuario: 'sistema', tipo: 'criada', motivo: null, entregue_a: null, detalhe: null, ...v }; eventos.push(x); return x; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

// Sobe o app com o banco simulado. `usuario` é quem está logado (padrão: Caio, código 7); `estados` restringe a região.
async function prepararEntregas(t, { perfil = 'Programador', usuario = { codigo: 7, nome: 'Caio' }, estados = [], banco = bancoEntregas() } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: usuario.nome, cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo, cabecalhos = {}) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(usuario.codigo, usuario.nome), 'Content-Type': 'application/json', ...cabecalhos },
    body: corpo === undefined ? undefined : (typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo)) });
  return { banco, chamar };
}

module.exports = { bancoEntregas, prepararEntregas, PERFIS, duplicado };
