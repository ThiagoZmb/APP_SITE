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
import { inferido } from './valor.mjs';

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
  }
  return { doc: novo, aplicados };
}
