// Banco simulado com estado para as rotas do módulo Entregas (rotas/entregas.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
// Para estender: acrescente uma regra em `regras` (o primeiro padrão que casar responde) e, se precisar de dados,
// um helper em `semear`.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');

const duplicado = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
const PERFIS = {
  'Programador': ['entregas.ver', 'entregas.programar'],
  'Motorista': ['entregas.baixar'],
  'Motorista com valores': ['entregas.baixar', 'valores.ver'],
  'Somente ver': ['entregas.ver']
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
    itens: [],     // itens do pedido
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

  const regras = [
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
          data_prometida: ped.DATA_ENTREGA || null, cliente: ped.RAZAO_SOCIAL,
          cidade: e.endereco_cidade || cli?.CIDADE || null, uf: e.endereco_uf || cli?.ESTADO || null,
          motorista: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME || null,
          qtd_ocorrencias: String(eventos.filter(v => v.entrega_id === e.id && OCORRENCIAS.includes(v.tipo)).length)
        }));
    }],
    // varredura: pedidos Pronto ainda sem registro
    [/SELECT p\.NUMERO FROM ped_orc p WHERE [\s\S]*NOT EXISTS/, () =>
      pedidos.filter(p => ehPronto(p) && !entregas.some(e => e.numero === p.NUMERO)).map(p => ({ NUMERO: p.NUMERO }))],
    // UNIQUE(numero): INSERT IGNORE de número repetido não grava (affectedRows 0)
    [/INSERT IGNORE INTO web_entregas \(numero, status, criado_em, atualizado_em\)/, (sql, [numero, criado_em, atualizado_em]) => {
      if (entregas.some(e => e.numero === numero)) return { affectedRows: 0, insertId: 0 };
      const e = { id: entregas.length + 1, numero, status: 'a_programar', tipo: null, data_agendada: null, motorista_codigo: null,
        endereco_rua: null, endereco_numero: null, endereco_bairro: null, endereco_cidade: null, endereco_uf: null, endereco_cep: null,
        endereco_ref: null, contato_local: null, transportadora: null, rastreio: null, previsao: null, observacao: null, criado_em, atualizado_em };
      entregas.push(e); return { affectedRows: 1, insertId: e.id };
    }],
    [/INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo\)/, (sql, [entrega_id, quando, usuario, tipo, motivo]) => {
      eventos.push({ id: eventos.length + 1, entrega_id, quando, usuario, tipo, motivo: motivo ?? null, entregue_a: null, detalhe: null });
      return { affectedRows: 1, insertId: eventos.length };
    }],
    // cancelamento: A programar cujo pedido deixou de estar Pronto
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status = 'a_programar'/, () =>
      entregas.filter(e => e.status === 'a_programar').filter(e => { const p = pedidoDe(e); return p && !ehPronto(p); }).map(e => ({ id: e.id }))],
    [/UPDATE web_entregas SET status = 'cancelada', atualizado_em = \? WHERE id = \? AND status = 'a_programar'/, (sql, [atualizado_em, id]) => {
      const e = entregas.find(x => x.id === id && x.status === 'a_programar');
      if (!e) return { affectedRows: 0 };
      Object.assign(e, { status: 'cancelada', atualizado_em }); return { affectedRows: 1 };
    }],

    // ---- programar entrega (T4) ----
    // detalhe de uma entrega + endereço do cadastro do cliente (filtro de estados opcional, depois do id)
    [/AS cli_endereco/, (sql, [id, ...estados]) => {
      const e = entregas.find(x => x.id === id); if (!e) return [];
      const ped = pedidoDe(e); const cli = clienteDe(ped);
      if (sql.includes('c.ESTADO IN') && !(cli && estados.includes(cli.ESTADO))) return [];
      return [{ ...e, cliente: ped?.RAZAO_SOCIAL ?? null, prometida: ped?.DATA_ENTREGA ?? null,
        cli_endereco: cli?.ENDERECO ?? null, cli_numero: cli?.NUMERO ?? null, cli_bairro: cli?.BAIRRO ?? null, cli_cidade: cli?.CIDADE ?? null,
        cli_estado: cli?.ESTADO ?? null, cli_cep: cli?.CEP ?? null, cli_telefone: cli?.TELEFONE ?? null }];
    }],
    [/FROM web_entrega_eventos WHERE entrega_id = \? ORDER BY/, (sql, [id]) => eventos.filter(v => v.entrega_id === id)],
    [/FROM ped_orc_lista_itens/, (sql, [numero]) => estado.itens.filter(i => i.NUMERO === numero && i.TIPO === 'Pedido')
      .sort((a, b) => a.ITEM - b.ITEM).map(i => ({ DESCRICAO: i.DESCRICAO, QTD: i.QTD }))],
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
    [/INSERT INTO web_entrega_eventos \(entrega_id, quando, usuario, tipo, motivo, detalhe\)/, (sql, [entrega_id, quando, usuario, tipo, motivo, detalhe]) => {
      eventos.push({ id: eventos.length + 1, entrega_id, quando, usuario, tipo, motivo: motivo ?? null, entregue_a: null, detalhe: detalhe ?? null });
      return { affectedRows: 1, insertId: eventos.length };
    }],
    [/INSERT INTO web_auditoria \(quando, quem, acao, alvo, detalhe\)/, (sql, [quando, quem, acao, alvo, detalhe]) => {
      estado.auditoria.push({ quando, quem, acao, alvo, detalhe }); return { affectedRows: 1, insertId: estado.auditoria.length };
    }]
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
    pedido: (p = {}) => { const x = { NUMERO: pedidos.length + 100, TIPO: 'Pedido', SITUACAO: 'Pronto', RAZAO_SOCIAL: 'CLIENTE TESTE LTDA', DATA_ENTREGA: null, ...p }; pedidos.push(x); return x; },
    // registro de web_entregas já existente (para testar o que a varredura não pode mexer)
    entrega: (e = {}) => {
      const x = { id: entregas.length + 1, numero: 100, status: 'a_programar', tipo: null, data_agendada: null, motorista_codigo: null,
        endereco_rua: null, endereco_numero: null, endereco_bairro: null, endereco_cidade: null, endereco_uf: null, endereco_cep: null,
        endereco_ref: null, contato_local: null, transportadora: null, rastreio: null, previsao: null, observacao: null,
        criado_em: '2026-10-01 08:00:00', atualizado_em: '2026-10-01 08:00:00', ...e };
      entregas.push(x); return x;
    },
    evento: (v = {}) => { const x = { id: eventos.length + 1, entrega_id: 1, quando: '2026-10-01 08:00:00', usuario: 'sistema', tipo: 'criada', motivo: null, entregue_a: null, detalhe: null, ...v }; eventos.push(x); return x; }
  };
  return { f, regras, estado, ...estado, semear };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

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
    body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
  return { banco, chamar };
}

module.exports = { bancoEntregas, prepararEntregas, PERFIS, duplicado };
