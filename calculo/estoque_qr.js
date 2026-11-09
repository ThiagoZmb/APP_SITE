// Baixa de estoque por QR/código de barras: funções puras (testáveis sem banco).
// A rota é quem diz "não encontrado"; aqui só se valida o formato do texto lido.

// 1 a 20 caracteres, sem caracteres de controle; senão null.
function codigoValido(texto) {
  if (typeof texto !== 'string') return null;
  const t = texto.trim();
  if (t.length < 1 || t.length > 20) return null;
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

// O que a tela do celular pode ver de um produto (só 4 campos).
function projetarItem(linha) {
  return {
    codigo: Number(linha.CODIGO),
    nome: String(linha.NOME_PRODUTO ?? ''),
    unidade: String(linha.UNIDADE ?? ''),
    qtd: Number(linha.QTD_ESTOQUE)
  };
}

// Etiquetas para impressão; produto sem CODIGO_BARRA não entra e é contado.
function projetarEtiquetas(linhas) {
  const itens = [];
  let semCodigo = 0;
  for (const l of linhas) {
    const cod = String(l.CODIGO_BARRA ?? '').trim();
    if (!cod) { semCodigo++; continue; }
    itens.push({ codigo: Number(l.CODIGO), produto: String(l.NOME_PRODUTO ?? ''), unidade: String(l.UNIDADE ?? ''), codBarras: cod });
  }
  return { itens, semCodigo };
}

module.exports = { codigoValido, projetarItem, projetarEtiquetas };
