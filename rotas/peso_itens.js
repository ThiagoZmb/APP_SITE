// Peso dos itens de porta da tela de orçamentos (só leitura: não grava nada, não audita).
// Reaproveita a MESMA montagem de folhas do pedido (folhasDoItem + gruposDoItem de ped_orc.js: medidas do vidro e do perfil já descontadas)
// e o cálculo puro de calculo/peso.js com os pesos de `web_pesos`. O peso aparece só em orcamentos.html: não entra em PDF nem na gravação.
// Peso NÃO é dinheiro: a rota exige só `orcamentos.criar` e nenhum nome de campo pode casar com REGEX_VALOR (kg, não valor).
const { criarLeitor } = require('../calculo/precos');
const { folhasDoItem, temSistemaCorrer, ErroEngenharia } = require('../calculo/engenharia');
const { montarTabela, pesoItem } = require('../calculo/peso');
const { lerSistemaCorrer, gruposDoItem, ErroItem, FRENTES_PORTA, MAX_QTD_ITEM } = require('./ped_orc');

const MAX_ITENS = 100;
const arred3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
const OBSERVACAO = 'Peso de perfil, divisor, puxador e vidro. Acessórios e trilhos/sistema de correr ficam fora do cálculo. Serralheria e venda avulsa não têm peso.';
const SEM_CALCULO = 'sem cálculo de peso para este tipo';

const semPeso = (motivo, extra = {}) => ({ pesoPorUnidadeKg: null, pesoKg: null, parcial: false, pendencias: null, motivo, ...extra });

function registrarPesoItens({ rota, pool }) {
  const leitor = criarLeitor(pool);

  rota('post', '/peso/itens', ['orcamentos.criar'], async (req, res) => {
    const itens = req.body && req.body.itens;
    if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Envie a lista de itens.' });
    if (itens.length > MAX_ITENS) return res.status(400).json({ error: `No máximo ${MAX_ITENS} itens por consulta.` });
    try {
      let tabela = null; // web_pesos é lido uma vez por chamada, só se houver porta
      const sistemas = new Map();
      const resultados = [];
      let total = 0, temPorta = false, parcial = false;
      for (const [i, item] of itens.entries()) {
        const n = i + 1;
        if (!item || typeof item !== 'object' || Array.isArray(item)) { resultados.push(semPeso('item incompleto')); continue; }
        if (item.frente === 'Serralheria' || item.frente === 'Avulso') { resultados.push(semPeso(SEM_CALCULO)); continue; }
        // frente desconhecida/ausente: não é porta nem tipo sem peso — fica sem peso e deixa o total parcial
        const falha = motivo => { resultados.push(semPeso(motivo)); parcial = true; };
        if (!FRENTES_PORTA.includes(item.frente)) { falha('tipo de produto inválido'); continue; }
        const qtd = Number(item.qtd);
        if (!item.detalhes || typeof item.detalhes !== 'object' || !(Number.isInteger(qtd) && qtd >= 1 && qtd <= MAX_QTD_ITEM)) { falha('item incompleto'); continue; }
        try {
          let descontoAlturaSistema = 0;
          if (item.frente === 'Porta de Correr' && temSistemaCorrer(item.detalhes.sistema)) {
            const nome = String(item.detalhes.sistema);
            if (!sistemas.has(nome)) sistemas.set(nome, await lerSistemaCorrer(pool, nome, qtd));
            const sis = sistemas.get(nome);
            if (!sis) { falha(`sistema de correr '${nome}' não encontrado`); continue; }
            descontoAlturaSistema = sis.descontoAltura;
          }
          const folhas = folhasDoItem(item, { descontoAlturaSistema });
          const grupos = await gruposDoItem(leitor, item, folhas, n);
          if (!tabela) {
            const [linhas] = await pool.execute('SELECT tipo, produto, unidade_peso, valor FROM web_pesos');
            tabela = montarTabela(linhas.map(l => ({ tipo: l.tipo, produto: l.produto, unidadePeso: l.unidade_peso, kgPorUnidade: l.valor })));
          }
          const comMedidas = grupos.map(g => ({ qtd: g.qtd, folha: { ...g.folha,
            ...(g.perfil ? { qtdAltura: g.perfil.qtdAltura, tamAltura: g.perfil.tamAltura, qtdLargura: g.perfil.qtdLargura, tamLargura: g.perfil.tamLargura } : {}),
            ...(g.vidro ? { alturaVidro: g.vidro.altura, larguraVidro: g.vidro.largura } : {}) } }));
          // as folhas do item somam item.qtd portas (cada grupo traz a sua quantidade): o peso do item já é o total
          const r = pesoItem(comMedidas, 1, tabela);
          temPorta = true; total += r.pesoKg; parcial = parcial || r.parcial;
          resultados.push({ pesoPorUnidadeKg: arred3(r.pesoKg / qtd), pesoKg: r.pesoKg, parcial: r.parcial,
            pendencias: r.pendencias.map(p => ({ tipo: p.tipo, produto: p.produto, motivo: p.motivo })) });
        } catch (err) {
          if (err instanceof ErroItem || err instanceof ErroEngenharia) { falha(String(err.message).replace(/^Item \d+:\s*/, '')); continue; }
          throw err;
        }
      }
      res.json({ itens: resultados, pesoDocumentoKg: temPorta ? arred3(total) : null, parcial, observacao: OBSERVACAO });
    } catch (err) {
      console.error('Erro POST /peso/itens:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' });
    }
  });
}

module.exports = { registrarPesoItens };
