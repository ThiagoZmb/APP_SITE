// Banco simulado com estado para as rotas de orçamento/pedido (rotas/ped_orc.js).
// Cada regra imita um SQL da rota; as listas em memória são o "banco".
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const jwt = require('jsonwebtoken');
const { subir } = require('./servidor');
const { criarPoolFalso } = require('./poolFalso');
const { app, pool, acesso } = require('../../index.js');
const { PERFIS_INICIAIS } = require('../../seguranca/permissoes');

const duplicado = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
const doPerfil = nome => PERFIS_INICIAIS.find(p => p.nome === nome).permissoes;
const PERFIS = {
  'Administrador': doPerfil('Administrador'),
  'Interno completo': doPerfil('Interno completo'),
  'Vendedor': doPerfil('Vendedor'),
  'Estoquista': doPerfil('Estoquista'),
  'Monta sem valores': ['orcamentos.criar', 'orcamentos.salvar'],
  'Monta sem salvar': ['orcamentos.criar', 'valores.ver'],
  'Representante SP': doPerfil('Administrador')
};

const produto = (MODELO, VALOR_CHEIO, VALOR_FIXO = VALOR_CHEIO, DESCONTO_VIDRO = 0, DESC_PERF_PUX = 0, TIPO_PUXADOR = '') =>
  ({ MODELO, VALOR_CHEIO, VALOR_FIXO, DESCONTO_VIDRO, DESC_PERF_PUX, TIPO_PUXADOR, SITUACAO: 'Ativo' });

// colunas de cada INSERT, na ordem do SQL da rota → objeto gravado
const colunasDo = sql => sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(',').map(c => c.trim());
const linhaDe = (sql, params) => Object.fromEntries(colunasDo(sql).map((c, i) => [c, params[i]]));

function bancoPedOrc() {
  const estado = {
    clientes: [{ CODIGO: 7, RAZAO_SOCIAL: 'CLIENTE TESTE', MEDICAO: 'Vão', TIPO_DESCONTO: 'Desconto progressivo', DESCONTO: 0, COMISSAO: '5', REPRESENTANTE: 'JOÃO REP', ESTADO: 'RJ' },
      { CODIGO: 8, RAZAO_SOCIAL: 'LOJA PAULISTA', MEDICAO: '', TIPO_DESCONTO: '', DESCONTO: 0, COMISSAO: '0', REPRESENTANTE: 'MARIA', ESTADO: 'SP' }],
    produtos: [produto('Perfil P', 100, 80, 20), produto('Puxador X', 50, 40, 10, 30, 'Sobreposto'), produto('Vidro V', 200),
      produto('Dobradiça', 20, 10), produto('Fechadura', 30, 25), produto('Trilho Sup', 40, 30), produto('Roldana', 15, 12), produto('Desemp', 60, 50),
      produto('Metalon 20', 30), produto('Serviço corte', 25, 25)],
    acabamentos: [],
    permitidos: [{ TIPO_PRODUTO: 'Porta de giro', MODELO: 'Fechadura' }, { TIPO_PRODUTO: 'Porta de giro', MODELO: 'Dobradiça' }, { TIPO_PRODUTO: 'Porta basculante', MODELO: 'Dobradiça' }],
    sistemas: [{ NOME: 'S1', DESCONTO_ALTURA: 40 }],
    itensSistema: [{ NOME: 'S1', MODELO: 'Trilho Sup', QTD: 1, MULTIPLICADOR: '', CLASSE: 'Trilho superior' },
      { NOME: 'S1', MODELO: 'Roldana', QTD: 2, MULTIPLICADOR: '', CLASSE: 'Roldana' },
      { NOME: 'S1', MODELO: 'Desemp', QTD: 1, MULTIPLICADOR: '', CLASSE: 'Desempenador' }],
    configSistema: [{ NOME: 'S1', QTD_PORTAS: 2, QTD_TRILHO_SUP: 2, QTD_TRILHO_INF: 1 }],
    serrProdutos: [{ nome_modelo: 'Grade', fixo: 0 }],
    pedOrc: [], listaItens: [], itensV4: [], vidros: [], perfis: [], furacao: [], complementos: [], serralheria: [], serralheriaComp: []
  };
  // falhas simuladas: { 'ped_orc': n } → as n próximas gravações nessa tabela falham
  const falhas = {};
  const dupNoCabecalho = { vezes: 0 };
  const transacao = { foto: null };
  let ultimoId = 1000;
  const TABELA = { ped_orc_lista_itens: 'listaItens', ped_orc_itens_v4: 'itensV4', vidros: 'vidros', perfis: 'perfis',
    furacao_pedidos_orcamentos: 'furacao', ped_orc_complementos: 'complementos', ped_orc_serralheria: 'serralheria',
    ped_orc_serralheria_complementos: 'serralheriaComp', ped_orc: 'pedOrc' };
  const norm = t => String(t ?? '').trim();
  const regras = [
    // cadastro
    [/FROM cadastro_clientes WHERE CODIGO = \?/, (sql, [c]) => estado.clientes.filter(x => String(x.CODIGO) === String(c))],
    [/FROM cadastro_de_produtos WHERE TRIM\(MODELO\) = TRIM\(\?\) AND SITUACAO/, (sql, [m]) => estado.produtos.filter(p => norm(p.MODELO) === norm(m))],
    [/FROM cadastro_de_produtos WHERE TRIM\(MODELO\) = 'Solda'/, () => []],
    [/FROM acabamentos WHERE/, (sql, [a]) => estado.acabamentos.filter(x => norm(x.ACABAMENTO) === norm(a))],
    [/FROM serralheria_produtos WHERE/, (sql, [n]) => estado.serrProdutos.filter(x => norm(x.nome_modelo) === norm(n))],
    [/FROM acessorios_permitidos WHERE TIPO_PRODUTO = \?/, (sql, [t]) => estado.permitidos.filter(x => x.TIPO_PRODUTO === t)
      .map(x => ({ MODELO: x.MODELO })).sort((a, b) => a.MODELO.localeCompare(b.MODELO))],
    [/FROM sistema_correr WHERE NOME = \?/, (sql, [n]) => estado.sistemas.filter(s => s.NOME === n)],
    [/FROM itens_sistema_correr WHERE NOME = \?/, (sql, [n]) => estado.itensSistema.filter(i => i.NOME === n)],
    [/FROM config_sistema_correr WHERE NOME = \? AND QTD_PORTAS = \?/, (sql, [n, q]) => estado.configSistema.filter(c => c.NOME === n && c.QTD_PORTAS === Number(q))],
    // cabeçalho
    // InnoDB (REPEATABLE READ): leitura comum vê a foto do início da transação; FOR UPDATE vê o que já foi gravado
    [/SELECT MAX\(NUMERO\) AS m FROM ped_orc WHERE TIPO = \?/, (sql, [t]) => {
      const fonte = /FOR UPDATE/.test(sql) || !transacao.foto ? estado.pedOrc : transacao.foto.pedOrc;
      const ns = fonte.filter(p => p.TIPO === t).map(p => p.NUMERO);
      return [{ m: ns.length ? Math.max(...ns) : null }]; }],
    [/FROM ped_orc WHERE NUMERO = \? AND TIPO = \? FOR UPDATE/, (sql, [n, t]) => estado.pedOrc.filter(p => p.NUMERO === Number(n) && p.TIPO === t)],
    [/^UPDATE ped_orc SET/, (sql, params) => {
      const cols = sql.match(/SET (.+) WHERE/)[1].split(',').map(c => c.split('=')[0].trim());
      const [n, t] = params.slice(cols.length);
      const p = estado.pedOrc.find(x => x.NUMERO === Number(n) && x.TIPO === t);
      cols.forEach((c, i) => { p[c] = params[i]; }); return { affectedRows: 1 }; }],
    [/^INSERT INTO (\w+)/, (sql, params) => {
      const tabela = sql.match(/^INSERT INTO (\w+)/)[1];
      if (falhas[tabela] > 0) { falhas[tabela]--; throw new Error('falha simulada em ' + tabela); }
      const l = linhaDe(sql, params);
      if (tabela === 'ped_orc') {
        if (dupNoCabecalho.vezes > 0) { dupNoCabecalho.vezes--; estado.pedOrc.push({ TIPO: l.TIPO, NUMERO: l.NUMERO, RAZAO_SOCIAL: 'VB' }); throw duplicado(); }
        if (estado.pedOrc.some(p => p.NUMERO === l.NUMERO && p.TIPO === l.TIPO)) throw duplicado();
      }
      if (l.id === null || l.id === undefined) { delete l.id; l[tabela === 'ped_orc_itens_v4' ? 'ID' : 'id'] = ++ultimoId; }
      estado[TABELA[tabela]].push(l); return { affectedRows: 1, insertId: ultimoId }; }],
    // leitura do documento (lerDocumento)
    [/^SELECT \* FROM (\w+) WHERE NUMERO = \?( AND TIPO = \?)?( ORDER BY id)?( FOR UPDATE)?$/, (sql, [n, t]) => {
      const lista = estado[TABELA[sql.match(/FROM (\w+)/)[1]]];
      return lista.filter(x => Number(x.NUMERO) === Number(n) && (t === undefined || x.TIPO === t))
        .sort((a, b) => (a.id ?? a.ID ?? 0) - (b.id ?? b.ID ?? 0)).map(x => ({ ...x })); }],
    [/FROM cadastro_clientes WHERE RAZAO_SOCIAL = \?/, (sql, [r]) => estado.clientes.filter(c => c.RAZAO_SOCIAL === r)],
    // busca (GET /ped_orc/buscar)
    [/FROM ped_orc p/, (sql, params) => {
      const [tipo, ...resto] = params;
      let lista = estado.pedOrc.filter(p => p.TIPO === tipo);
      if (/p\.NUMERO = \?/.test(sql)) { const n = Number(resto.shift()); lista = lista.filter(p => p.NUMERO === n); }
      if (/LIKE \?/.test(sql)) { const q = String(resto.shift()).replace(/%/g, '').toLowerCase(); lista = lista.filter(p => String(p.RAZAO_SOCIAL).toLowerCase().includes(q)); }
      if (/c\.ESTADO IN/.test(sql)) lista = lista.filter(p => resto.includes(estado.clientes.find(c => c.RAZAO_SOCIAL === p.RAZAO_SOCIAL)?.ESTADO));
      return lista.sort((a, b) => b.NUMERO - a.NUMERO).slice(0, 20)
        .map(p => ({ tipo: p.TIPO, numero: p.NUMERO, cliente: p.RAZAO_SOCIAL, data: String(p.DATA || '').slice(0, 10), total: p.TOTAL })); }],
    [/^DELETE FROM (\w+) WHERE NUMERO = \?( AND TIPO = \?)?$/, (sql, [n, t]) => {
      const tabela = sql.match(/^DELETE FROM (\w+)/)[1], lista = estado[TABELA[tabela]];
      const fica = lista.filter(x => !(Number(x.NUMERO) === Number(n) && (t === undefined || x.TIPO === t)));
      lista.splice(0, lista.length, ...fica); return { affectedRows: 1 }; }]
  ];
  const f = criarPoolFalso(regras);
  // como no MySQL: ROLLBACK volta ao estado do BEGIN
  const conectar = f.getConnection;
  f.getConnection = async () => {
    const c = await conectar();
    let foto = null;
    return { ...c,
      beginTransaction: async () => { foto = JSON.parse(JSON.stringify(estado)); transacao.foto = foto; await c.beginTransaction(); },
      rollback: async () => { if (foto) for (const k of Object.keys(estado)) estado[k].splice(0, estado[k].length, ...foto[k]); transacao.foto = null; await c.rollback(); },
      commit: async () => { transacao.foto = null; await c.commit(); } };
  };
  return { f, estado, falhas, dupNoCabecalho, ...estado };
}

const token = (id, nome) => jwt.sign({ id, nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

// Sobe o app com o banco simulado; o usuário logado tem o perfil pedido.
async function prepararPedOrc(t, { perfil = 'Administrador', banco = bancoPedOrc(), estados = perfil === 'Representante SP' ? ['SP'] : [] } = {}) {
  pool.execute = banco.f.execute; pool.getConnection = banco.f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Thiago', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados, ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (caminho, metodo = 'GET', corpo) => fetch(s.url + caminho, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(7, 'Thiago'), 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { banco, chamar };
}

module.exports = { bancoPedOrc, prepararPedOrc };
