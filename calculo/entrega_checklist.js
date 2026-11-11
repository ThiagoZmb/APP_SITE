// ==========================================================================
// "CHECKLIST EXTERNO – ENTREGAS" (folha que o motorista leva para conferência e assinatura do cliente): funções puras.
// - montarAutomatico: dados da entrega -> campos da folha (sem dinheiro);
// - validarEdicao: campos editados pela equipe (tabela web_entrega_checklist) conferidos e limpos; nunca corta em silêncio;
// - mesclar: o que foi salvo substitui o automático campo a campo; itens e "Entrega n de N" continuam automáticos;
// - textoPdf / quebrarLinhas / ajustarTexto: texto do banco como DADO para o PDF (só caracteres que a Helvetica do PDF
//   escreve; quebra de linha medida por uma função recebida, para caber em uma página A4).
// Testes: test/entrega_checklist.test.js.
// ==========================================================================

// campos editáveis (a mesma lista vale para a tela, a rota e o PDF); max = caracteres
const CAMPOS = [
  { chave: 'dataEntrega', rotulo: 'Data de entrega', max: 10, data: true },
  { chave: 'pedido', rotulo: 'Pedido', max: 40 },
  { chave: 'cliente', rotulo: 'Cliente', max: 190 },
  { chave: 'clienteFinal', rotulo: 'Cliente final', max: 190 },
  { chave: 'endereco', rotulo: 'Endereço', max: 400, multilinha: true },
  { chave: 'observacoes', rotulo: 'Observações de entrega', max: 500, multilinha: true },
  { chave: 'contato', rotulo: 'Contato no local', max: 190 },
  { chave: 'motorista', rotulo: 'Motorista', max: 120 },
  { chave: 'observacoesGerais', rotulo: 'Observações gerais da entrega', max: 600, multilinha: true }
];
const CHAVES = CAMPOS.map(c => c.chave);

const DIAS = ['DOMINGO', 'SEGUNDA FEIRA', 'TERÇA FEIRA', 'QUARTA FEIRA', 'QUINTA FEIRA', 'SEXTA FEIRA', 'SÁBADO'];

function dataIso(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
// "2026-11-12" -> "QUINTA FEIRA" (data inválida ou vazia -> '')
function diaDaSemana(iso) {
  const d = dataIso(iso);
  if (!d) return '';
  const [a, m, dd] = d.split('-').map(Number);
  return DIAS[new Date(Date.UTC(a, m - 1, dd)).getUTCDay()];
}
const dataBR = iso => { const d = dataIso(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''; };

const r4 = x => Math.round((Number(x) || 0) * 1e4) / 1e4;
// quantidade para a folha: inteiro sem casas, fração com vírgula ("1,5")
const qtdTexto = n => String(r4(n)).replace('.', ',');

const t = v => String(v ?? '').trim();
// endereço de entrega numa linha: "Rua X, 12 - Bairro - Cidade/UF - CEP 29000-000 - Ref.: perto da praça"
function textoEndereco(a) {
  if (!a) return '';
  const l1 = [t(a.rua), t(a.numero)].filter(Boolean).join(', ');
  const cidade = [t(a.cidade), t(a.uf)].filter(Boolean).join('/');
  return [l1, t(a.bairro), cidade, t(a.cep) ? 'CEP ' + t(a.cep) : '', t(a.ref) ? 'Ref.: ' + t(a.ref) : ''].filter(Boolean).join(' - ');
}

// Dados AUTOMÁTICOS da folha a partir da entrega (nada de dinheiro). Entradas:
//  entrega: linha de web_entregas (numero, data_agendada, endereco_*, contato_local, observacao, tipo)
//  cliente, clienteFinal: do pedido (ped_orc); motoristaNome: nome (nunca o código). Endereço = SÓ o da própria entrega
//  (decisão do dono, 2026-11-12: nunca o do cadastro do cliente; sem endereço a folha não é gerada, ver podeGerar);
//  itens: [{ item, descricao, qtd }] DESTA entrega; ordem: { ordemEntrega, qtdEntregasPedido } (só com mais de uma entrega)
function montarAutomatico({ entrega = {}, cliente = '', clienteFinal = '', motoristaNome = '', itens = [], ordem = {} } = {}) {
  const e = entrega || {};
  const end = textoEndereco({ rua: e.endereco_rua, numero: e.endereco_numero, bairro: e.endereco_bairro, cidade: e.endereco_cidade,
    uf: e.endereco_uf, cep: e.endereco_cep, ref: e.endereco_ref });
  const lista = (Array.isArray(itens) ? itens : []).map(i => ({
    item: i && i.item !== null && i.item !== undefined && Number.isFinite(Number(i.item)) ? Number(i.item) : null,
    descricao: t(i && i.descricao), qtd: r4(i && i.qtd) }));
  const n = Number(ordem && ordem.qtdEntregasPedido) || 0;
  return {
    dataEntrega: dataIso(e.data_agendada),
    pedido: e.numero !== null && e.numero !== undefined ? String(e.numero) : '',
    entregaRotulo: n > 1 && Number(ordem.ordemEntrega) > 0 ? `Entrega ${Number(ordem.ordemEntrega)} de ${n}` : '',
    cliente: t(cliente), clienteFinal: t(clienteFinal),
    endereco: end, enderecoOrigem: end ? 'entrega' : '',
    observacoes: t(e.observacao), contato: t(e.contato_local),
    motorista: t(motoristaNome), observacoesGerais: '',
    itens: lista, qtdItensEsperada: lista.length ? r4(lista.reduce((s, i) => s + i.qtd, 0)) : null
  };
}

// Folha em branco: tudo vazio para escrever à mão (mesmo sem entrega)
function folhaEmBranco() {
  return { ...Object.fromEntries(CHAVES.map(k => [k, ''])), entregaRotulo: '', enderecoOrigem: '', itens: [], qtdItensEsperada: null, branco: true };
}

// Limpa um texto digitado: tira caracteres de controle; multilinha mantém quebras (no máximo 2 seguidas), linha única vira espaço
function limparTexto(v, multilinha) {
  let s = String(v).replace(/\r\n?/g, '\n');
  s = multilinha ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ');
  return s.trim();
}

// Edição salva pela equipe: { ok: true, dados } ou { ok: false, erro }. Campo ausente/null = vazio (o salvo vale inteiro);
// número só no "pedido"; texto acima do limite é recusado (nunca cortado); data vazia ou AAAA-MM-DD válida.
function validarEdicao(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, erro: 'Envie os campos do checklist.' };
  const dados = {};
  for (const c of CAMPOS) {
    let v = corpo[c.chave];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'number' && c.chave === 'pedido' && Number.isFinite(v)) v = String(v);
    if (typeof v !== 'string') return { ok: false, erro: `Campo "${c.rotulo}" inválido.` };
    const s = limparTexto(v, c.multilinha);
    if (s.length > c.max) return { ok: false, erro: `"${c.rotulo}" passa de ${c.max} caracteres.` };
    if (c.data && s && !dataIso(s)) return { ok: false, erro: 'Data de entrega inválida: use AAAA-MM-DD.' };
    dados[c.chave] = c.data ? dataIso(s) : s;
  }
  return { ok: true, dados };
}

// Lê o JSON gravado em web_entrega_checklist.dados (texto ou objeto); inválido = null (vale o automático)
function lerSalvo(v) {
  let o = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = validarEdicao(o);
  return r.ok ? r.dados : null;
}

// O salvo (se houver) substitui os campos editáveis; o resto (itens, quantidade esperada, "Entrega n de N") fica automático
function mesclar(automatico, salvo) {
  if (!salvo) return { ...automatico, editado: false };
  const r = { ...automatico, editado: true };
  for (const k of CHAVES) if (Object.hasOwn(salvo, k)) r[k] = salvo[k];
  if (Object.hasOwn(salvo, 'endereco') && salvo.endereco !== automatico.endereco) r.enderecoOrigem = salvo.endereco ? 'editado' : '';
  return r;
}

// Sem endereço não há checklist de entrega (decisão do dono): vale para o automático, o salvo e o do motorista; a folha em branco é livre
const MSG_SEM_ENDERECO = 'Informe o endereço da entrega para gerar o checklist.';
const podeGerar = dados => !!t(dados && dados.endereco);

// "Item 3 · Porta de giro × 2" (só descrição e quantidade)
const linhaItem = i => `${i.item !== null && i.item !== undefined ? 'Item ' + i.item + ' · ' : ''}${t(i.descricao) || 'Sem descrição'} × ${qtdTexto(i.qtd)}`;

// ---------------- texto para o PDF ----------------
// A Helvetica do PDF só escreve o conjunto WinAnsi: Latin-1 e alguns sinais (aspas curvas, travessões, reticências, €...).
// Letra acentuada fora dele perde o acento; o resto (emoji, outros alfabetos) vira "?". Controles viram espaço.
const EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
function textoPdf(v, { multilinha = false } = {}) {
  const s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  let r = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\n') { r += multilinha ? '\n' : ' '; continue; }
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) { r += ' '; continue; }
    if (c <= 0xff || EXTRAS.has(ch)) { r += ch; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    r += base && [...base].every(x => x.codePointAt(0) <= 0xff) ? base : '?';
  }
  return multilinha ? r.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').trim() : r.replace(/\s+/g, ' ').trim();
}

// Quebra `texto` em linhas que cabem em `largura`, medindo com `medir(trecho)`. Respeita as quebras do texto; palavra maior
// que a linha é cortada por caractere. Texto vazio = [].
function quebrarLinhas(texto, largura, medir) {
  const linhas = [];
  for (const par of String(texto ?? '').split('\n')) {
    const palavras = par.split(/\s+/).filter(Boolean);
    let atual = '';
    for (let p of palavras) {
      const tentativa = atual ? atual + ' ' + p : p;
      if (medir(tentativa) <= largura) { atual = tentativa; continue; }
      if (atual) { linhas.push(atual); atual = ''; }
      while (medir(p) > largura && p.length > 1) { // palavra sozinha não cabe: corta
        let k = p.length - 1;
        while (k > 1 && medir(p.slice(0, k)) > largura) k--;
        linhas.push(p.slice(0, k));
        p = p.slice(k);
      }
      atual = p;
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

// Escolhe o MAIOR tamanho de fonte em que o texto cabe em `maxLinhas`; se nem o menor couber, usa o menor e corta a última
// linha com "..." (cortado = true). medir(trecho, tamanho) -> largura.
// `maxLinhas` pode ser uma função do tamanho (caixa de altura fixa: fonte menor = mais linhas).
function ajustarTexto(texto, largura, medir, { tamanhos = [10], maxLinhas = 1 } = {}) {
  const lista = [...tamanhos].sort((a, b) => b - a);
  const limite = tam => Math.max(1, Math.floor(typeof maxLinhas === 'function' ? maxLinhas(tam) : maxLinhas));
  for (const tam of lista) {
    const linhas = quebrarLinhas(texto, largura, s => medir(s, tam));
    if (linhas.length <= limite(tam)) return { tamanho: tam, linhas, cortado: false };
  }
  const tam = lista[lista.length - 1];
  const linhas = quebrarLinhas(texto, largura, s => medir(s, tam)).slice(0, limite(tam));
  let ult = linhas[linhas.length - 1];
  while (ult.length && medir(ult + '...', tam) > largura) ult = ult.slice(0, -1);
  linhas[linhas.length - 1] = ult.replace(/\s+$/, '') + '...';
  return { tamanho: tam, linhas, cortado: true };
}

module.exports = { CAMPOS, CHAVES, DIAS, dataIso, diaDaSemana, dataBR, qtdTexto, textoEndereco, montarAutomatico, folhaEmBranco, limparTexto,
  validarEdicao, lerSalvo, mesclar, linhaItem, podeGerar, MSG_SEM_ENDERECO, textoPdf, quebrarLinhas, ajustarTexto };
