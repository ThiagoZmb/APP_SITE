// Cópia das notas do VB (nf_entrada e nf_saida) para web_notas_fiscais (função pura, testável sem banco).
// As tabelas do VB só guardam NUMERO, nome da contraparte, DATA e valor: série entra como "1" e a chave fica em branco.
// Nenhuma nota é perdida em silêncio: o que não pode entrar vai em `ignoradas` com o motivo.
const { normalizarNumero } = require('./notas_fiscais');

const SERIE = '1';
const VALOR_MAXIMO = 999999999999.99;
const nomeChave = s => String(s ?? '').trim().toLowerCase();

function dataDe(v) {
  const s = String(v ?? '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
}

// nulo ou vazio = 0 (o VB aceitava); texto, negativo ou fora do DECIMAL(14,2) = null
function valorDe(v) {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAXIMO) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// existentes: linhas de web_notas_fiscais (tipo, serie, numero, contraparte_codigo) — a importação pode rodar de novo sem duplicar
function planejarImportacao({ entradas = [], saidas = [], fornecedores = [], clientes = [], existentes = [] }) {
  const indice = (linhas, nome, codigo, excluir = () => false) => {
    const m = new Map();
    for (const l of linhas) if (!excluir(l[nome]) && !m.has(nomeChave(l[nome]))) m.set(nomeChave(l[nome]), { codigo: Number(l[codigo]), nome: String(l[nome]).trim() });
    return m;
  };
  const porFornecedor = indice(fornecedores, 'RAZAO_FABRICANTE', 'COD', n => String(n).trim() === '.');   // "." é o marcador vazio do VB
  const porCliente = indice(clientes, 'RAZAO_SOCIAL', 'CODIGO');
  const vistas = new Set(existentes.map(e => `${e.tipo}|${e.serie}|${e.numero}|${Number(e.contraparte_codigo)}`));
  const agora = new Set();   // chaves das notas que entram nesta rodada
  const plano = { entram: [], qtdJaImportadas: 0, qtdValorZero: 0, ignoradas: [], semCadastro: [] };

  const converter = (tipo, linhas, campoNome, campoValor, campoValorAlt, cadastro) => {
    for (const l of linhas) {
      const ignorar = motivo => plano.ignoradas.push({ tipo, numero: String(l.NUMERO ?? ''), motivo });
      const numero = normalizarNumero(l.NUMERO);
      if (!numero) { ignorar('número inválido'); continue; }
      const dataEmissao = dataDe(l.DATA);
      if (!dataEmissao) { ignorar('data inválida'); continue; }
      const valorTotal = valorDe(l[campoValor] ?? l[campoValorAlt]);
      if (valorTotal === null) { ignorar('valor inválido'); continue; }
      const nomeOriginal = String(l[campoNome] ?? '').trim();
      const achado = cadastro.get(nomeChave(nomeOriginal));
      const codigo = achado ? achado.codigo : 0;
      const chave = `${tipo}|${SERIE}|${numero}|${codigo}`;
      if (vistas.has(chave)) {
        // já está em web_notas_fiscais (importação anterior) ou veio duas vezes na origem
        if (agora.has(chave)) ignorar('repetida na origem');
        else plano.qtdJaImportadas++;
        continue;
      }
      vistas.add(chave);
      agora.add(chave);
      if (valorTotal === 0) plano.qtdValorZero++;
      if (!codigo) plano.semCadastro.push({ tipo, numero, nome: nomeOriginal });
      plano.entram.push({ tipo, numero, serie: SERIE, dataEmissao, contraparteCodigo: codigo, contraparteNome: (achado ? achado.nome : nomeOriginal || '(sem nome)').slice(0, 190), valorTotal });
    }
  };
  converter('entrada', entradas, 'RAZAO_FABRICANTE', 'VALOR_TOTAL', 'VALOR', porFornecedor);
  converter('saida', saidas, 'RAZAO_SOCIAL', 'VALOR', 'VALOR_TOTAL', porCliente);
  return plano;
}

module.exports = { planejarImportacao };
