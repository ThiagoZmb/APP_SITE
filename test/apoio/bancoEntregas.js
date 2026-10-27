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

  const fichaDe = e => {
    const ped = pedidoDe(e); const cli = clienteDe(ped);
    return { cliente: ped?.RAZAO_SOCIAL ?? null, cli_telefone: cli?.TELEFONE ?? null, cli_rua: cli?.ENDERECO ?? null, cli_numero: cli?.NUMERO ?? null,
      cli_bairro: cli?.BAIRRO ?? null, cli_cidade: cli?.CIDADE ?? null, cli_uf: cli?.ESTADO ?? null, cli_cep: cli?.CEP ?? null };
  };
  const regras = [
    // ---- rotas do motorista (T6): o dono é sempre motorista_codigo ----
    [/AS qtd_itens/, (sql, [uid, data]) => entregas
      .filter(e => e.motorista_codigo === uid && e.tipo === 'motorista' && ['agendada', 'em_rota', 'ocorrencia'].includes(e.status) && e.data_agendada
        && (sql.includes('<= ?') ? e.data_agendada <= data : e.data_agendada === data))
      .sort((a, b) => String(a.data_agendada).localeCompare(String(b.data_agendada)) || a.numero - b.numero)
      .map(e => ({ ...e, ...fichaDe(e), qtd_itens: String(estado.itens.filter(i => i.NUMERO === e.numero && i.TIPO === 'Pedido').length) }))],
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
          data_prometida: ped.DATA_PRONTO || null, data_pedido: ped.DATA || null, cliente: ped.RAZAO_SOCIAL,
          cidade: e.endereco_cidade || cli?.CIDADE || null, uf: e.endereco_uf || cli?.ESTADO || null,
          motorista: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME || null,
          qtd_ocorrencias: String(eventos.filter(v => v.entrega_id === e.id && OCORRENCIAS.includes(v.tipo)).length)
        }));
    }],
    // varredura em lote: INSERT IGNORE ... SELECT dos pedidos Pronto sem registro (UNIQUE(numero)) e eventos 'criada' das entregas sem evento
    [/^INSERT IGNORE INTO web_entregas \(numero, status, criado_em, atualizado_em\)\s+SELECT/, (sql, [criado_em, atualizado_em]) => {
      const novos = pedidos.filter(p => ehPronto(p) && !entregas.some(e => e.numero === p.NUMERO));
      for (const p of novos) {
        entregas.push({ id: entregas.length + 1, numero: p.NUMERO, status: 'a_programar', tipo: null, data_agendada: null, motorista_codigo: null,
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
    // pedido Cancelado: A programar, Agendada e Ocorrência (Em rota fica)
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status IN \('a_programar', 'agendada', 'ocorrencia'\)/, () =>
      entregas.filter(e => ['a_programar', 'agendada', 'ocorrencia'].includes(e.status)).filter(e => pedidoDe(e)?.SITUACAO === 'Cancelado').map(e => ({ id: e.id }))],
    // cancelamento: A programar cujo pedido deixou de estar Pronto
    [/SELECT e\.id FROM web_entregas e JOIN ped_orc p [\s\S]*e\.status = 'a_programar'/, () =>
      entregas.filter(e => e.status === 'a_programar').filter(e => { const p = pedidoDe(e); return p && !ehPronto(p); }).map(e => ({ id: e.id }))],
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
      return [{ ...e, cliente: ped?.RAZAO_SOCIAL ?? null, prometida: ped?.DATA_PRONTO ?? null, data_pedido: ped?.DATA ?? null,
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
    body: corpo === undefined ? undefined : (typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo)) });
  return { banco, chamar };
}

module.exports = { bancoEntregas, prepararEntregas, PERFIS, duplicado };
