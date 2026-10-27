// Validação do cadastro de tintas (função pura, testável sem banco).
// Regras tiradas de frm_Cadastro_Tintas.vb; o que o VB deixa livre continua livre.
const ordenar = l => [...l].sort((a, b) => a.localeCompare(b, 'pt-BR'));

const CLASSES_TINTA = ordenar(['Tinta', 'Catalisador', 'Aderente', 'Verniz', 'Diluente', 'Retardador']);
const CONJUNTOS_TINTA = ordenar([
  'Conjunto Vidro', 'Conjunto Perfil Laca Brilho', 'Conjunto Perfil Laca Fosca', 'Conjunto Perfil Microtextura Fosca',
  'Conjunto Perfil Microtextura Brilho', 'Conjunto Inox Brilho', 'Conjunto Inox Fosco', 'Conjunto Perfil Acrílica Fosca',
  'Conjunto Perfil Acrílica Brilho'
]);
const TIPOS_TINTA = ordenar([
  'Laca Brilho Metálica', 'Laca Brilho Sólida', 'Laca Fosca Sólida', 'Laca Fosca Metálica', 'Microtextura Sólida', 'Microtextura Metálica',
  'Vetrive Sólida', 'Vetrive Metálica', 'Vetrive Gliter', 'Tinta Acrílica Sólida Fosca', 'Tinta Acrílica Sólida Brilho',
  'Tinta Acrílica Metálica Fosca', 'Tinta Acrílica Metálica Brilho', 'Pasticgrip', 'Verniz Fosco', 'Verniz Brilho',
  'Verniz Acrílico Fosco', 'Verniz Acrílico Brilho', 'Aderente (Fundo Fosfatizante)'
]);

const COR_PRETA = 'FF000000'; // o VB grava preto quando a classe é Tinta e ninguém escolheu cor
const t = v => String(v ?? '').trim();

// número >= 0 com vírgula OU ponto decimal ("12,5" / "12.5"); "1.234,56", texto e negativo = NaN
function numero(v) {
  const s = t(v);
  if (!/^\d+([.,]\d+)?$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}

function campo(erros, valor, rotulo, max) {
  const s = t(valor);
  if (s.length > max) erros.push(`${rotulo} muito longo (máximo ${max} caracteres).`);
  return s;
}

function escolha(erros, valor, rotulo, lista) {
  const s = t(valor);
  if (!lista.includes(s)) erros.push(`Escolha ${rotulo}.`);
  return s;
}

// podeValores: sem `valores.ver` o valor nem é lido (a rota mantém o que já está gravado)
function validarTinta(b = {}, { podeValores = false } = {}) {
  const erros = [];
  const dados = {
    fabricante: t(b.fabricante),
    classe: escolha(erros, b.classe, 'a Classe', CLASSES_TINTA),
    tipo: escolha(erros, b.tipo, 'o Tipo', TIPOS_TINTA),
    conjunto: escolha(erros, b.conjunto, 'o Conjunto', CONJUNTOS_TINTA),
    refFabricante: campo(erros, b.refFabricante, 'Referência do fabricante', 100),
    corElegance: campo(erros, b.corElegance, 'Cor Elegance', 100)
  };
  if (!dados.fabricante) erros.push('Fabricante é obrigatório.');
  if (podeValores) {
    dados.valor = numero(b.valor);
    if (Number.isNaN(dados.valor)) erros.push('Valor inválido (use números, com vírgula ou ponto decimal).');
  }
  dados.porcentagem = numero(b.porcentagem);
  if (Number.isNaN(dados.porcentagem) || dados.porcentagem > 100) { erros.push('% da mistura inválida (de 0 a 100).'); dados.porcentagem = 0; }
  const rendimento = t(b.rendimento);
  dados.rendimento = rendimento === '' ? 0 : numero(rendimento);
  if (Number.isNaN(dados.rendimento)) { erros.push('Rendimento inválido.'); dados.rendimento = 0; }
  const cor = t(b.cor).toUpperCase();
  if (cor) {
    if (!/^[0-9A-F]{8}$/.test(cor)) erros.push('Cor inválida.');
    dados.cor = cor;
  } else if (dados.classe === 'Tinta') dados.cor = COR_PRETA;
  else { erros.push('Cor é obrigatória (só a classe Tinta pode ficar sem cor).'); dados.cor = ''; }
  return { erros, dados };
}

module.exports = { CLASSES_TINTA, TIPOS_TINTA, CONJUNTOS_TINTA, COR_PRETA, validarTinta };
