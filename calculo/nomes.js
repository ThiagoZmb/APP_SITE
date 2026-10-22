// Comparação de nomes de produtos (importação de XML, ligações de custo)
// nome para comparar: sem acento, maiúsculas, só letras e números separados por um espaço
const normalizarNome = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
// semelhança entre nomes (Dice das palavras): 1 = mesmas palavras, 0 = nenhuma em comum
function semelhanca(a, b) {
  const pa = new Set(normalizarNome(a).split(' ').filter(Boolean)), pb = new Set(normalizarNome(b).split(' ').filter(Boolean));
  if (!pa.size || !pb.size) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns++;
  return (2 * comuns) / (pa.size + pb.size);
}

// chave igual à do MySQL (utf8mb4_unicode_ci): ignora acento, maiúsculas e espaço no fim, mas NÃO a pontuação
// ("PERFIL 3.5" e "PERFIL 3,5" são itens diferentes). Para casar compras com o item de estoque.
const chaveMySQL = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/ +$/, '');

module.exports = { normalizarNome, semelhanca, chaveMySQL };
