// ============================================================
// LINHA COMERCIAL (ped_orc_lista_itens) no formato que o VB grava:
// TIPO_PRODUTO, PRODUTO, QTD e DESCRICAO de cada frente.
// ============================================================
const txt = v => String(v ?? '').trim();

// frmPortasAbrir.vb:2124-2150 — cada AppendLine termina em \r\n
function descricaoPorta(item, folhas, acessorios) {
  const d = item.detalhes || {}, ref = folhas[0] || {};
  const linhas = [`Tipo de produto: ${item.frente}`, `Tamanho: ${txt(item.altura)}x${txt(item.largura)} mm`];
  if (ref.perfil) linhas.push(`Perfil: ${ref.perfil} (${ref.acabPerfil}) | Cor: ${ref.corPerfil}`);
  if (ref.puxador) linhas.push(`Puxador: ${ref.qtdPuxador}x ${ref.puxador} (${ref.acabPuxador}) | Posição: ${ref.posicaoPuxador} | Tam: ${txt(d.tamanhoPux) || 0} mm`);
  if (ref.revestimento) linhas.push(`Revestimento: ${ref.revestimento} (${ref.corRevestimento})`);
  if (ref.divisor) linhas.push(`Divisor: ${ref.divisor} | Qtd H/V: ${ref.qtdDivH}/${ref.qtdDivV}`);
  folhas.forEach((f, i) => {
    linhas.push(`Folha ${i + 1}: H = ${f.altura} x L = ${f.largura} mm`);
    if (f.furos && f.furos.length) linhas.push(`Porta ${i + 1}: ${f.furos.length} furos`);
  });
  for (const a of acessorios) linhas.push(`Complemento: ${a.qtd}x ${a.nome} de ${a.tamanho} mm`);
  if (ref.obs) linhas.push(`Obs: ${ref.obs}`);
  return linhas.map(l => l + '\r\n').join('');
}

// frmPortasCorrer.vb:2268
function descricaoCorrer(item, folhas) {
  const d = item.detalhes || {};
  return `Tam: ${txt(item.altura)}x${txt(item.largura)}mm | Per: ${txt(d.perfil)} ${txt(d.acabamento)} | Sist: ${txt(d.sistema)} | ` +
    `Pux: ${txt(d.puxador)} | Rev: ${txt(d.revestimento)} | Portas: ${folhas.length} | Furos: ${(folhas[0]?.furos || []).length}` +
    // larguras diferentes: o transpasse digitado não se deduz das folhas, então vai na descrição (a leitura do pedido usa)
    (new Set(folhas.map(f => f.largura)).size > 1 && folhas[0]?.larguraVao ? ` | Transp: ${parseFloat(d.transpasse) || 0}` : '');
}

// frmServicos.vb:634-640
function descricaoAvulso(item) {
  const d = item.detalhes || {};
  let desc = `${txt(d.avProduto)} ${txt(d.avAcab)} ${txt(d.avCor)}`.replace(/\s+/g, ' ').trim();
  const alt = parseFloat(item.altura) || 0, larg = parseFloat(item.largura) || 0;
  if (d.categoria === 'Revestimento' && alt > 0 && larg > 0) desc += ` | Tam: ${alt}x${larg}mm`;
  else if (['Perfil', 'Trilhos', 'Puxador'].includes(d.categoria) && alt > 0) desc += ` | Medida: ${alt}mm`;
  return desc;
}

function linhaComercial(item, { folhas = [], acessorios = [] } = {}) {
  const d = item.detalhes || {};
  const qtd = Math.max(1, parseInt(item.qtd) || 1);
  if (item.frente === 'Serralheria') {
    // ModPedOrc encaminha "Metalons" para ProcessarSerralheriaNoBanco
    const produto = txt(d.produto);
    return { tipoProduto: 'Metalons', produto, qtd, descricao: produto === 'Produto editável' ? 'Estrutura metálica editável' : produto };
  }
  if (item.frente === 'Avulso') return { tipoProduto: txt(d.categoria), produto: '', qtd, descricao: descricaoAvulso(item) };
  // o VB compara "Porta de correr" com c minúsculo (frm_Pedido.vb:336, Cálculos_Pedido.vb:61)
  if (item.frente === 'Porta de Correr') return { tipoProduto: 'Porta de correr', produto: 'Porta de correr', qtd: 1, descricao: descricaoCorrer(item, folhas) };
  return { tipoProduto: item.frente, produto: item.frente, qtd, descricao: descricaoPorta(item, folhas, acessorios) };
}

module.exports = { linhaComercial };
