// CPF e CNPJ: só dígitos verificadores (não consulta a Receita). Funções puras.
const soDigitos = v => String(v ?? '').replace(/\D/g, '');

function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = (soma * 10) % 11 % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

function cnpjValido(v) {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  for (const t of [12, 13]) {
    const pesos = t === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * pesos[i];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

const formatarCpf = v => soDigitos(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const formatarCnpj = v => soDigitos(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// CPF (11 dígitos) ou CNPJ (14): devolve o texto formatado, ou null se não for um documento válido
function documentoFormatado(v) {
  const d = soDigitos(v);
  if (d.length === 11 && cpfValido(d)) return formatarCpf(d);
  if (d.length === 14 && cnpjValido(d)) return formatarCnpj(d);
  return null;
}

module.exports = { soDigitos, cpfValido, cnpjValido, formatarCpf, formatarCnpj, documentoFormatado };
