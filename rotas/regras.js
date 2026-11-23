// Livro de regras (somente leitura): consulta das regras de item. Nada é gravado e a resposta nunca carrega dinheiro.
const { avaliar, livro, LIMITES } = require('../calculo/regras_item');

// Mesma regra de ehCopia em rotas/ped_orc.js (estados de item copiado do banco): item assim não é refeito, então não tem regra a avaliar.
const ESTADOS_COPIA = ['intacto', 'so_pct', 'travado'];
const ehCopia = it => !!it.origem && ESTADOS_COPIA.includes(it.origem.estado);

function registrarRegras({ rota }) {
  const erro500 = (res, rotulo, err) => { console.error(`Erro ${rotulo}:`, err.message); if (!res.headersSent) res.status(500).json({ error: 'Erro de servidor' }); };

  rota('post', '/regras/verificar_item', ['orcamentos.criar'], async (req, res) => {
    try {
      const item = req.body;
      if (!item || typeof item !== 'object' || Array.isArray(item)) return res.status(400).json({ error: 'Item inválido.' });
      res.json({ regras: ehCopia(item) ? [] : avaliar(item) });
    } catch (err) { erro500(res, 'POST /regras/verificar_item', err); }
  });

  rota('get', '/regras/livro', ['administrativo.ver'], async (req, res) => {
    try {
      res.json({ regras: livro(), limites: LIMITES });
    } catch (err) { erro500(res, 'GET /regras/livro', err); }
  });
}

module.exports = { registrarRegras };
