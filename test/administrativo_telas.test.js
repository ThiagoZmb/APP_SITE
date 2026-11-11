// Divisão administrativo × operador nas TELAS (conferência estática do HTML/JS): o que é administrativo só aparece com a chave
// `administrativo.ver` (data-perm, PAGINAS) e as telas não chamam rotas que o servidor vai recusar com 403.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('layout.js: gráficos de pedidos e análise de cliente exigem a chave; páginas de gestão seguem por permissões que só existem com a chave', () => {
  const l = ler('layout.js');
  assert.match(l, /'graficos_pedidos\.html': \['pedidos\.ver', 'administrativo\.ver'\]/);
  assert.match(l, /'cliente_analise\.html': \['clientes\.ver', 'valores\.ver', 'administrativo\.ver'\]/);
});

test('estoque.html: cartões de resumo, gráfico do item e aba Análises só com a chave; resumo sem totais não quebra a tela; gráfico não chama o servidor sem a chave', () => {
  const h = ler('estoque.html');
  assert.match(h, /<section class="cards" data-perm="administrativo\.ver" data-resumo>/);
  assert.match(h, /<div class="grafico-box" data-perm="administrativo\.ver">/);
  assert.match(h, /data-aba="analises" data-perm="administrativo\.ver"/);
  assert.match(h, /if \(r\.ativos !== undefined\) \{/);
  assert.match(h, /!Acesso\.pode\('administrativo\.ver'\)\) return;/);
});

test('movimentacao_estoque.html: a aba Análises exige a chave (aba, atalho e abertura direta por ?aba=analises)', () => {
  const h = ler('movimentacao_estoque.html');
  assert.match(h, /analises: 'administrativo\.ver'/);
  assert.match(h, /data-aba="analises" data-perm="administrativo\.ver"/);
});

test('painel_inicial.html e clientes.html: gráficos e rankings só com a chave, e sem chamar o servidor sem ela', () => {
  const p = ler('painel_inicial.html'), c = ler('clientes.html');
  for (const re of [/<section class="larga so-geral" data-perm="administrativo\.ver">/, /<section class="duas so-geral" data-perm="administrativo\.ver">/,
    /id="ranking-produtos" data-perm="administrativo\.ver"/, /id="ranking-clientes" data-perm="administrativo\.ver"/]) assert.match(p, re);
  assert.match(p, /function renderRankings\(j\) \{[^}]*!Acesso\.pode\('administrativo\.ver'\)/);
  assert.match(c, /id="ranking-clientes" data-perm="administrativo\.ver"/);
  assert.match(c, /function carregarRankingClientes\(\) \{[^}]*!Acesso\.pode\('administrativo\.ver'\)/);
});

test('usuarios.html: coluna Classe com Administrativo, Só valores e Operador (calculada pelo servidor)', () => {
  const h = ler('usuarios.html');
  assert.match(h, /<th>Perfil<\/th><th>Classe<\/th><th>Estados<\/th>/);
  assert.match(h, /administrativo: \['Administrativo'/);
  assert.match(h, /so_valores: \['Só valores'/);
  assert.match(h, /operador: \['Operador'/);
  assert.match(h, /<td>\$\{seloClasse\(u\.classe\)\}<\/td>/);
});
