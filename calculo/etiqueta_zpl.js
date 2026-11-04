// Etiqueta de pedido/produção para a Zebra (ZPL), 100 x 60 mm a 203 dpi (800 x 480 dots). Função pura, sem banco.
// Uma etiqueta por item do Pedido. Nenhum campo de dinheiro. Todo texto do banco passa por sanearZpl: ^, ~ e \ são
// caracteres de comando do ZPL, então o conteúdo do pedido nunca pode chegar à impressora com eles.
const MAX_CLIENTE = 50;
const MAX_DESCRICAO = 300;
const MAX_MEDIDAS = 80;

// remove ^ ~ \ e troca caracteres de controle por espaço
function sanearZpl(texto) {
  return String(texto ?? '').replace(/[\^~\\]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ');
}

const cortar = (texto, max) => (texto.length > max ? texto.slice(0, max - 1) + '…' : texto);

// "ALTURAxLARGURA" de cada folha (ped_orc_itens_v4), separadas por " | "; sem medida cadastrada = "—" (nunca estimada)
function medidasDoItem(v4) {
  const partes = (v4 || [])
    .map(f => [f?.ALTURA, f?.LARGURA].map(x => String(x ?? '').trim()))
    .filter(([a, l]) => a !== '' && l !== '')
    .map(([a, l]) => `${a}x${l}`);
  return partes.length ? partes.join(' | ') : '—';
}

const campo = (x, y, fonte, texto) => `^FO${x},${y}^A0N,${fonte},${fonte}^FD${texto}^FS`;

// dados = { numero, cliente, dataEntrega, itens: [{ ITEM, QTD, descricao, v4 }] }  →  { zpl, quantidade }
function montarEtiquetas({ numero, cliente, dataEntrega, itens }) {
  const lista = itens || [];
  const num = String(numero ?? '').replace(/\D/g, '');
  const quem = cortar(sanearZpl(cliente).trim(), MAX_CLIENTE);
  const entrega = sanearZpl(dataEntrega).trim() || '—';
  const blocos = lista.map((it, i) => {
    const desc = cortar(sanearZpl(it.descricao).replace(/\s+/g, ' ').trim(), MAX_DESCRICAO);
    const medidas = cortar(sanearZpl(medidasDoItem(it.v4)), MAX_MEDIDAS);
    return [
      '^XA^CI28^PW800^LL480',
      campo(20, 15, 44, quem),
      campo(20, 70, 36, `Pedido nº ${num}`),
      campo(450, 70, 36, `Item ${i + 1}/${lista.length}  Qtd ${sanearZpl(it.QTD).trim() || '1'}`),
      `^FO20,120^A0N,28,28^FB760,5,4,L,0^FD${desc}^FS`,
      campo(20, 290, 30, `Medidas: ${medidas}`),
      campo(20, 330, 30, `Entrega: ${entrega}`),
      `^FO20,375^BY3^BCN,80,Y,N,N^FD${num}^FS`,
      '^XZ'
    ].join('\n');
  });
  return { zpl: blocos.join('\n'), quantidade: lista.length };
}

module.exports = { sanearZpl, medidasDoItem, montarEtiquetas };
