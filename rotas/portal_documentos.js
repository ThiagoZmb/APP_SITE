'use strict';
// Portal do cliente, etapa 3c: PDF do pedido (sem preços) e DANFE (somente leitura).
// A empresa vem SEMPRE da sessão (req.portal.empresaCodigo); nenhum parâmetro, cabeçalho ou corpo escolhe a empresa.
// Ordem de cada rota: (1) número do pedido válido, (2) posse do pedido pela empresa da sessão (consulta fixa),
// (3) só então o resto. Todo insucesso (pedido alheio ou inexistente, orçamento, número ou chave mal formados, chave que
// não está entre as notas ligadas AQUELE pedido) responde o mesmo 404, com o mesmo corpo e os mesmos cabeçalhos.
// Nenhum DANFE é buscado só pela chave: a chave só abre se estiver em notasDoPedido(número já validado como da empresa).
const rateLimit = require('express-rate-limit');
const { numeroValido } = require('../calculo/portal_pedidos');
const { lerChave } = require('../calculo/danfe');
const { auditarPortal } = require('../portal/auditoria');
const { criarLigacaoDanfe } = require('./danfe_ligacao');
const { carregarCabecalhoPedOrc, carregarCorpoPedOrc } = require('../pdf/carregar_ped_orc');

const SQL_POSSE = `SELECT p.NUMERO, p.RAZAO_SOCIAL
  FROM ped_orc p
  JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
 WHERE c.CODIGO = ? AND p.TIPO = 'Pedido' AND p.NUMERO = ? LIMIT 1`;

const NAO_ENCONTRADO = { error: 'Documento não encontrado.' };
const MSG_LIMITE = { error: 'Muitas aberturas de documento. Aguarde alguns minutos.' };
const LIMITE_PADRAO = { janelaMs: 10 * 60 * 1000, max: 30 };

// Campos de dinheiro zerados antes de desenhar (defesa em profundidade: o gerador já recebe verValores=false).
const CAMPOS_DINHEIRO = ['SUB_TOTAL', 'TOTAL', 'DESCONTO', 'UNITARIO', 'VALOR_UNITARIO', 'VALOR_TOTAL', 'VALOR'];
const semDinheiro = linha => {
  const saida = { ...linha };
  for (const campo of CAMPOS_DINHEIRO) if (campo in saida) saida[campo] = 0;
  return saida;
};

// Gera o PDF inteiro em memória: um erro do gerador vira 500 antes de qualquer byte ser enviado.
function gerarPdfEmMemoria(pdf, dados) {
  return new Promise((resolve, reject) => {
    const doc = pdf.novoDocumento();
    const partes = [];
    doc.on('data', parte => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    try {
      pdf.desenharPedOrc(doc, dados, { verValores: false, producao: false });
      doc.end();
    } catch (err) { reject(err); }
  });
}

function registrarPortalDocumentos({ portal, pool, pdf = require('../pdf/ped_orc'), limite = LIMITE_PADRAO }) {
  const ligacao = criarLigacaoDanfe({ pool });

  const falhaInterna = (res, nome, err) => {
    console.error(`Erro ${nome}:`, (err && err.code) || 'sem código');
    if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
  };

  // ÚNICA saída de insucesso: mesmo status, corpo e cabeçalhos para qualquer motivo.
  const naoEncontrado = res => res.status(404).json(NAO_ENCONTRADO);

  // posse: o pedido é da empresa da sessão (e é Pedido, nunca Orçamento)? Devolve a linha ou null.
  async function posse(empresa, numero) {
    const [linhas] = await pool.execute(SQL_POSSE, [empresa, numero]);
    return linhas.length ? linhas[0] : null;
  }

  function enviarArquivo(res, nomeArquivo, bytes) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.status(200).end(bytes);
  }

  // limite por usuário (só em memória), DEPOIS da autenticação e só nas rotas de arquivo; contagem não vaza nada
  const limitar = rateLimit({
    windowMs: limite.janelaMs, limit: limite.max,
    keyGenerator: req => `u${req.portal.usuarioId}`,
    standardHeaders: false, legacyHeaders: false,
    handler: (req, res) => res.status(429).set('Retry-After', String(Math.ceil(limite.janelaMs / 1000))).json(MSG_LIMITE)
  });

  portal('get', '/portal/api/pedidos/:numero/documentos', ['documentos.ver'], async (req, res) => {
    try {
      const numero = numeroValido(req.params.numero);
      if (numero === null) return naoEncontrado(res);
      if (!await posse(req.portal.empresaCodigo, numero)) return naoEncontrado(res);
      const { notas } = await ligacao.notasDoPedido(numero);
      res.json({ pdfPedido: true, notas: notas.map(n => ({ chave: n.chave, numeroNf: n.numeroNf, serie: n.serie })) });
    } catch (err) { falhaInterna(res, 'GET /portal/api/pedidos/:numero/documentos', err); }
  });

  portal('get', '/portal/api/pedidos/:numero/pdf', ['documentos.ver'], limitar, async (req, res) => {
    try {
      const numero = numeroValido(req.params.numero);
      if (numero === null) return naoEncontrado(res);
      const empresa = req.portal.empresaCodigo;
      if (!await posse(empresa, numero)) return naoEncontrado(res);
      const cab = await carregarCabecalhoPedOrc(pool, numero, 'Pedido');
      if (!cab) return naoEncontrado(res);
      const corpo = await carregarCorpoPedOrc(pool, { numero, tipo: 'Pedido', cab, producao: false });
      const bytes = await gerarPdfEmMemoria(pdf, {
        tipo: 'Pedido', numero,
        cab: { ...semDinheiro(cab), OBS_GERAL: '' },
        itens: corpo.itens.map(semDinheiro), v4: corpo.v4.map(semDinheiro),
        complementos: corpo.comps.map(semDinheiro), serralheria: corpo.serr.map(semDinheiro),
        compSerralheria: corpo.compSerr.map(semDinheiro), furos: corpo.furos, medicao: '', desenhos: corpo.desenhos
      });
      // a auditoria não lança; o await garante que a linha existe antes de a resposta sair
      await auditarPortal(pool, {
        evento: 'documento_aberto', usuarioId: req.portal.usuarioId, clienteCodigo: empresa,
        ip: req.ip, detalhe: `tipo=pdf;pedido=${numero}`
      });
      enviarArquivo(res, `Pedido-${numero}.pdf`, bytes);
    } catch (err) { falhaInterna(res, 'GET /portal/api/pedidos/:numero/pdf', err); }
  });

  portal('get', '/portal/api/pedidos/:numero/danfe/:chave', ['documentos.ver'], limitar, async (req, res) => {
    try {
      const numero = numeroValido(req.params.numero);
      if (numero === null) return naoEncontrado(res);
      const c = lerChave(req.params.chave);
      if (!c.valida) return naoEncontrado(res);
      const empresa = req.portal.empresaCodigo;
      if (!await posse(empresa, numero)) return naoEncontrado(res);
      // a chave só abre se estiver entre as notas ligadas a ESTE pedido (que acabou de ser provado como da empresa)
      const { notas } = await ligacao.notasDoPedido(numero);
      if (!notas.some(n => n.chave === c.chave)) return naoEncontrado(res);
      const [achadas] = await pool.execute('SELECT numero_nf, pdf FROM web_danfe WHERE chave = ?', [c.chave]);
      if (!achadas.length || !Buffer.isBuffer(achadas[0].pdf)) return naoEncontrado(res);
      const numeroNf = String(achadas[0].numero_nf).replace(/\D/g, '');
      await auditarPortal(pool, {
        evento: 'documento_aberto', usuarioId: req.portal.usuarioId, clienteCodigo: empresa,
        ip: req.ip, detalhe: `tipo=danfe;pedido=${numero};nf=${numeroNf}`
      });
      enviarArquivo(res, `NF-${numeroNf}.pdf`, achadas[0].pdf);
    } catch (err) { falhaInterna(res, 'GET /portal/api/pedidos/:numero/danfe/:chave', err); }
  });
}

module.exports = { registrarPortalDocumentos };
