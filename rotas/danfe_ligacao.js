// Ligação pedido <-> nota do DANFE, compartilhada pelas rotas internas (rotas/danfe.js) e pelo portal do cliente.
// Regras: (1) vínculo manual (web_danfe_vinculos) vem primeiro; (2) automática pelo financeiro: fluxo_de_caixa.PEDIDO = nº do pedido
// e fluxo_de_caixa.NOTA_FISCAL (pode vir "8862/8887") = numero_nf do DANFE, só modelo 55 emitido pelo CNPJ da empresa.
// Nada aqui é dinheiro: nenhum nome de campo pode casar com REGEX_VALOR (use numeroNf, qtd*).
const { numerosDeNotaFiscal } = require('../calculo/danfe');

const MODELO_NFE = '55';

const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
const marcas = n => Array(n).fill('?').join(', ');
const dataHora = v => (v ? String(v).replace('T', ' ').slice(0, 19) : '');
const notaDe = (r, origem) => ({ chave: r.chave, numeroNf: Number(r.numero_nf), serie: Number(r.serie), origem, enviadoEm: dataHora(r.enviado_em) });
const pedidoDe = v => { const s = String(v ?? '').trim(); const n = /^\d{1,9}$/.test(s) ? Number(s) : 0; return n > 0 ? n : 0; };

function criarLigacaoDanfe({ pool }) {
  // CNPJ do emitente = o da empresa: variável EMPRESA_CNPJ (14 dígitos) ou o mais frequente entre os DANFE enviados. '' se não houver nenhum.
  async function cnpjEmpresa(db) {
    const env = String(process.env.EMPRESA_CNPJ || '').replace(/\D/g, '');
    if (env.length === 14) return env;
    const [[linha]] = await db.execute('SELECT cnpj_emitente, COUNT(*) AS qtd FROM web_danfe GROUP BY cnpj_emitente ORDER BY qtd DESC, cnpj_emitente LIMIT 1');
    return linha ? String(linha.cnpj_emitente) : '';
  }

  // notas ligadas pelo financeiro: números de NF dos lançamentos do pedido -> DANFE enviados com esse número
  async function notasDoFinanceiro(db, pedido, empresa) {
    const [fluxo] = await db.execute("SELECT NOTA_FISCAL FROM fluxo_de_caixa WHERE TRIM(PEDIDO) = ? AND NOTA_FISCAL IS NOT NULL AND NOTA_FISCAL <> ''", [String(pedido)]);
    const numeros = [];
    for (const f of fluxo) for (const n of numerosDeNotaFiscal(f.NOTA_FISCAL)) if (!numeros.includes(n)) numeros.push(n);
    if (!numeros.length) return { numeros, notas: [] };
    if (!empresa) return { numeros, notas: [] };
    const [achadas] = await db.execute(
      `SELECT chave, numero_nf, serie, enviado_em FROM web_danfe WHERE modelo = ? AND cnpj_emitente = ? AND numero_nf IN (${marcas(numeros.length)}) ORDER BY numero_nf, id`,
      [MODELO_NFE, empresa, ...numeros]);
    return { numeros, notas: achadas };
  }

  // pedidos (números) a que uma nota está ligada: manual + automática (financeiro cita o número da NF e a nota é da empresa)
  async function pedidosDaNota(d, empresa) {
    const lista = new Set();
    const [manual] = await pool.execute('SELECT pedido_numero FROM web_danfe_vinculos WHERE chave = ?', [d.chave]);
    for (const m of manual) lista.add(Number(m.pedido_numero));
    if (d.modelo === MODELO_NFE && empresa && d.cnpj_emitente === empresa) {
      const [fluxo] = await pool.execute(
        "SELECT PEDIDO, NOTA_FISCAL FROM fluxo_de_caixa WHERE NOTA_FISCAL LIKE ? AND PEDIDO IS NOT NULL AND PEDIDO <> '' LIMIT 500", [like(d.numero_nf)]);
      for (const f of fluxo) {
        const p = pedidoDe(f.PEDIDO);
        if (p && numerosDeNotaFiscal(f.NOTA_FISCAL).includes(Number(d.numero_nf))) lista.add(p);
      }
    }
    return [...lista];
  }

  // notas do pedido: vínculo manual primeiro, depois as do financeiro (sem repetir a chave)
  async function notasDoPedido(numero) {
    const [manuais] = await pool.execute(
      `SELECT d.chave, d.numero_nf, d.serie, d.enviado_em FROM web_danfe_vinculos v JOIN web_danfe d ON d.chave = v.chave WHERE v.pedido_numero = ? ORDER BY v.id`, [numero]);
    const notas = manuais.map(m => notaDe(m, 'manual'));
    const empresa = await cnpjEmpresa(pool);
    const fin = await notasDoFinanceiro(pool, numero, empresa);
    for (const f of fin.notas) if (!notas.some(n => n.chave === f.chave)) notas.push(notaDe(f, 'financeiro'));
    const cobertos = new Set(notas.map(n => n.numeroNf));
    return { notas, semArquivo: fin.numeros.filter(n => !cobertos.has(n)) };
  }

  return { cnpjEmpresa, notasDoFinanceiro, pedidosDaNota, notasDoPedido };
}

module.exports = { criarLigacaoDanfe, MODELO_NFE };
