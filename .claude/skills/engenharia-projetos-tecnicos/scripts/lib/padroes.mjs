// ============================================================
// PADRÕES DA ELEGANCE — completa um projeto lido (leitura do modelo ou CLI) com as regras aprovadas em
// config/padroes-elegance.json. Quem aplica é este CÓDIGO; o modelo de leitura só transcreve.
//
// Garantias:
//   - nunca sobrescreve um valor lido (só preenche campo AUSENTE; a exceção são as "normalizações" listadas no
//     config, que trocam o texto lido pelo nome do cadastro e guardam o texto original na origem);
//   - todo valor vindo daqui nasce "inferido", metodo "configuracao", com pendência: uma pessoa confere antes de lançar;
//   - não altera conflitantes, cotas, contagens nem itens de outras categorias;
//   - função pura: devolve um documento novo, o de entrada não é alterado.
// ============================================================
import { inferido, ausente } from './valor.mjs';
import { furosPorRegra, deBaseParaTopo, REGRA_FUROS } from './furos.mjs';

const sem = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const vazio = v => !v || v.estado === 'ausente' || v.estado === 'conflitante';
const soAusente = v => !v || v.estado === 'ausente'; // conflitante nunca é preenchido por padrão
const texto = v => (!vazio(v) && typeof v.valor === 'string' ? v.valor : null);
const numero = v => (!vazio(v) && typeof v.valor === 'number' ? v.valor : null);
const codigoPerfil = t => (String(t ?? '').match(/\d{4}/) || [null])[0];

export function validarPadroes(p) {
  const erros = [];
  if (!p || typeof p !== 'object') return ['padrões: objeto esperado'];
  if (!Array.isArray(p.aplicaA) || p.aplicaA.length === 0) erros.push('"aplicaA" deve ser lista não vazia');
  if (!(typeof p.confianca === 'number' && p.confianca > 0 && p.confianca < 1)) erros.push('"confianca" deve estar entre 0 e 1 (nunca 1: o valor é inferido)');
  if (p.metadados?.status !== 'aprovado') erros.push('metadados.status deve ser "aprovado"');
  if (typeof p.perfil?.padrao !== 'string') erros.push('perfil.padrao obrigatório');
  if (p.furos !== undefined && !(Number.isFinite(p.furos.margemMm) && p.furos.margemMm >= 0)) erros.push('furos.margemMm deve ser número >= 0');
  if (p.revestimentoDesconhecido !== undefined && !(Array.isArray(p.revestimentoDesconhecido.nomes) && p.revestimentoDesconhecido.nomes.length)) erros.push('revestimentoDesconhecido.nomes deve ser lista não vazia');
  for (const r of p.observacoes ?? []) if (!r.id || !r.texto || !r.quandoVazio || !Array.isArray(r.quandoTextoContem) || !r.quandoTextoContem.length) erros.push(`observacoes: regra inválida (${r.id ?? 'sem id'})`);
  return erros;
}

// doc: projeto-tecnico. contexto.textos: textos do PDF que ajudam (legendas dos itens, observações) — só leitura.
// → { doc, aplicados: [{ id, campo, valor, regra }] }
export function aplicarPadroes(doc, padroes, contexto = {}) {
  const erros = validarPadroes(padroes);
  if (erros.length) throw new Error(`padrões inválidos: ${erros.join('; ')}`);
  const novo = JSON.parse(JSON.stringify(doc));
  const aplicados = [];
  const textos = (contexto.textos || []).map(sem).join(' | ');

  for (const item of novo.itens) {
    if (!padroes.aplicaA.includes(item.tipo)) continue;
    const a = item.atributos;
    const dim = item.dimensoes;
    const arquivo = novo.documento.arquivo;
    const textoItem = `${textos} | ${sem((contexto.legendas || {})[item.id])}`;

    // coloca (ou troca) um valor do padrão e registra a pendência no lugar da antiga "ausente"
    const por = (grupo, campo, valor, regra, motivo, originalTrecho) => {
      const antigo = grupo[campo];
      const id = antigo?.id || `${item.id}.${campo}`;
      grupo[campo] = inferido({
        id, valor, unidade: null, metodo: 'configuracao', confianca: padroes.confianca,
        origem: { arquivo, pagina: antigo?.origem?.pagina ?? null, trecho: `${originalTrecho ? `${originalTrecho} → ` : ''}padrão Elegance "${regra}" (${motivo}); aprovado por ${padroes.metadados.responsavel} em ${padroes.metadados.data}` },
      });
      novo.pendencias = novo.pendencias.filter(p => !(p.refs || []).includes(id));
      novo.pendencias.push({
        id: `pend-padrao-${id}`, tipo: 'inferido_sem_confirmacao', refs: [id],
        ...(antigo?.origem?.pagina ? { pagina: antigo.origem.pagina } : {}),
        mensagem: `${id}: "${valor}" veio do padrão da Elegance "${regra}" (${motivo}), não do desenho; conferir.`,
      });
      aplicados.push({ id, campo, valor, regra });
    };

    // 1) normalizações do texto lido (vidro, cor)
    for (const n of padroes.normalizacoes || []) {
      const v = a[n.campo];
      const t = texto(v);
      if (t === null || t === n.valor) continue;
      if (!n.quandoTextoIgual.map(sem).includes(sem(t))) continue;
      por(a, n.campo, n.valor, `normalizar-${n.campo}`, n.motivo, v.origem?.trecho ? `lido "${t}" (${v.origem.trecho})` : `lido "${t}"`);
    }

    // acrescenta uma frase à observação do item (nunca perde o que já havia); vem do padrão, então fica inferida
    const observar = (frase, regra, motivo) => {
      const atual = texto(a.observacao);
      if (atual && sem(atual).includes(sem(frase))) return;
      por(a, 'observacao', atual ? `${atual} ${frase}` : frase, regra, motivo);
    };

    // 1b) vidro lido que não existe no cadastro: não escolhe; esvazia o campo e leva o texto para a observação
    const desc = padroes.revestimentoDesconhecido;
    const vidro = a.revestimento;
    const vidroLido = texto(vidro);
    if (desc && vidroLido && !desc.nomes.map(sem).includes(sem(vidroLido))) {
      const id = vidro.id;
      a.revestimento = ausente({ id, unidade: null, metodo: vidro.metodo, origem: { ...vidro.origem, trecho: `${vidro.origem?.trecho ?? ''} (vidro "${vidroLido}" não existe no cadastro)`.trim() } });
      novo.pendencias = novo.pendencias.filter(p => !(p.refs || []).includes(id));
      novo.pendencias.push({ id: `pend-padrao-${id}`, tipo: 'ausente', refs: [id], ...(vidro.origem?.pagina ? { pagina: vidro.origem.pagina } : {}),
        mensagem: `${id}: o projeto pede o vidro "${vidroLido}", que não existe no cadastro; escolha o vidro (o texto do projeto foi para a observação do item).` });
      observar(`Do projeto: vidro "${vidroLido}" (não existe no cadastro; escolher o vidro).`, 'vidro-fora-do-cadastro', desc.motivo);
      aplicados.push({ id, campo: 'revestimento', valor: null, regra: 'vidro-fora-do-cadastro' });
    }

    // 2) perfil
    if (soAusente(a.perfil)) {
      const regra = (padroes.perfil.porContexto || []).find(r => r.textoContem.some(p => textoItem.includes(sem(p))));
      por(a, 'perfil', regra ? regra.valor : padroes.perfil.padrao, regra ? 'perfil-por-contexto' : 'perfil-padrao', regra ? regra.motivo : padroes.perfil.motivoPadrao);
    }

    // 3) acabamento do perfil pela cor lida
    if (soAusente(a.acabamentoPerfil)) {
      const cor = sem(texto(a.corPerfil));
      const regra = cor ? (padroes.acabamentoPorCor || []).find(r => r.corContem.some(p => cor.includes(sem(p)))) : null;
      if (regra) {
        let acab = regra.acabamento;
        let motivo = regra.motivo;
        const cod = codigoPerfil(texto(a.perfil));
        const nao = padroes.acabamentoNaoPermitido;
        if (nao && cod && (nao.porPerfil[cod] || []).includes(acab)) {
          motivo = `${motivo}; o perfil ${cod} não permite "${acab}": ${nao.motivo}`;
          acab = nao.alternativa;
        }
        por(a, 'acabamentoPerfil', acab, 'acabamento-por-cor', motivo);
      }
    }

    // 4) tipo de frente por proporção (só sem indicação alguma)
    if (soAusente(a.tipoFrente) && padroes.tipoFrente) {
      const alt = numero(dim.altura), lar = numero(dim.largura);
      if (alt !== null && lar !== null && alt > lar) por(a, 'tipoFrente', padroes.tipoFrente.alturaMaiorQueLargura, 'tipo-frente-por-proporcao', padroes.tipoFrente.motivo);
    }

    // 5a) furos lidos com cota a partir da BASE: o sistema usa sempre o topo; converte (a posição lida fica na origem)
    if (padroes.furos && !soAusente(a.furos) && a.furos.estado !== 'conflitante' && a.furos.metodo !== 'configuracao' && /base/.test(sem(texto(a.referenciaFuros)))) {
      const tipoF = texto(a.tipoFrente);
      const dimF = tipoF === 'porta_giro' ? numero(dim.altura) : tipoF === 'porta_basculante' ? numero(dim.largura) : null;
      const lidaF = typeof a.furos.valor === 'string' ? a.furos.valor.split(';').map(Number) : [];
      const conv = dimF !== null ? deBaseParaTopo(lidaF, dimF) : null;
      if (conv) por(a, 'furos', conv.join(';'), 'furos-da-base-para-o-topo', `o desenho cota os furos a partir da base; o sistema mede do topo (dimensão ${dimF} mm)`, `lido ${a.furos.valor} a partir da base`);
      else novo.pendencias.push({ id: `pend-ref-${a.furos.id}`, tipo: 'inferido_sem_confirmacao', refs: [a.furos.id], mensagem: `${a.furos.id}: o desenho cota os furos a partir da BASE, mas o sistema mede do TOPO e não deu para converter (falta tipo de frente/dimensão ou posição fora da porta); conferir as posições.` });
    }

    // 5) furos de dobradiça sem posição cotada: 100 mm das pontas (lib/furos.mjs). Só giro (altura) e basculante (largura).
    if (soAusente(a.furos) && padroes.furos) {
      const tipo = texto(a.tipoFrente);
      const dimensao = tipo === 'porta_giro' ? numero(dim.altura) : tipo === 'porta_basculante' ? numero(dim.largura) : null;
      let porPorta = numero(a.qtdFurosPorPorta);
      let origemQtd = 'quantidade por porta lida no projeto';
      if (porPorta === null) {
        const total = numero(a.qtdFurosTotal), portas = numero(item.quantidade);
        if (total !== null && portas && Number.isInteger(total / portas)) { porPorta = total / portas; origemQtd = `${total} furos no item ÷ ${portas} portas`; }
      }
      if (dimensao !== null && porPorta !== null) {
        try {
          const lista = furosPorRegra(dimensao, porPorta, padroes.furos.margemMm);
          por(a, 'furos', lista.join(';'), REGRA_FUROS, `${padroes.furos.motivo}; ${porPorta} furo(s) por porta (${origemQtd}), dimensão ${dimensao} mm`);
        } catch { /* dimensão ou quantidade fora do possível: segue sem furos (ausente) */ }
      }
    }

    // 6) observações automáticas (ex.: "puxador igual ao pedido anterior": não inventa o puxador, avisa)
    for (const r of padroes.observacoes || []) {
      if (soAusente(a[r.quandoVazio]) && r.quandoTextoContem.some(p => textoItem.includes(sem(p)))) observar(r.texto, r.id, 'aviso automático do padrão');
    }
  }
  return { doc: novo, aplicados };
}
