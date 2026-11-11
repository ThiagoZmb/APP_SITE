// Tela de dependências do perfil (produtos.html): lógica PURA (diferença, copiar de outro perfil, corpo do PUT, mensagens de erro).
// Roda no Node (testes) e no navegador (global ProdutosDependenciasTela). Sem DOM, sem rede. Regras: docs/regras/produtos-dependencias.md
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.ProdutosDependenciasTela = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  const GRUPOS = [
    { chave: 'tiposProduto', titulo: 'Tipos de produto' },
    { chave: 'acabamentos', titulo: 'Acabamentos' },
    { chave: 'puxadores', titulo: 'Puxadores' },
    { chave: 'revestimentos', titulo: 'Revestimentos' },
    { chave: 'divisores', titulo: 'Divisores' }
  ];
  const CHAVES = GRUPOS.map(g => g.chave);
  const tituloDe = chave => (GRUPOS.find(g => g.chave === chave) || {}).titulo || chave;

  const norm = v => String(v ?? '').trim().toLowerCase();
  const limpar = lista => {
    const out = [];
    for (const x of Array.isArray(lista) ? lista : []) {
      const t = String(x ?? '').trim();
      if (t && !out.some(y => norm(y) === norm(t))) out.push(t);
    }
    return out;
  };
  const tem = (lista, v) => lista.some(x => norm(x) === norm(v));
  const porGrupo = (obj, f) => { const o = {}; for (const g of CHAVES) o[g] = f(limpar(obj && obj[g]), g); return o; };
  const copiaListas = obj => porGrupo(obj, l => l);

  // adicionados = marcados agora e não gravados; removidos = gravados e não marcados agora (sem diferenciar maiúsculas)
  function diferenca(gravado, atual) {
    const g = limpar(gravado), a = limpar(atual);
    return { adicionados: a.filter(v => !tem(g, v)), removidos: g.filter(v => !tem(a, v)) };
  }
  // por grupo: { adicionados, removidos, alterado, ficaVazio }
  function resumo(gravados, atuais) {
    const out = {};
    for (const g of CHAVES) {
      const d = diferenca(gravados && gravados[g], atuais && atuais[g]);
      const alterado = d.adicionados.length > 0 || d.removidos.length > 0;
      out[g] = { ...d, alterado, ficaVazio: alterado && limpar(atuais && atuais[g]).length === 0 };
    }
    return out;
  }
  const gruposAlterados = (gravados, atuais) => { const r = resumo(gravados, atuais); return CHAVES.filter(g => r[g].alterado); };
  const totais = (gravados, atuais) => {
    const r = resumo(gravados, atuais);
    return CHAVES.reduce((t, g) => ({ adicionados: t.adicionados + r[g].adicionados.length, removidos: t.removidos + r[g].removidos.length }), { adicionados: 0, removidos: 0 });
  };

  // Alterna um valor (grafia da lista) em `atual`; devolve lista nova.
  const alternar = (atual, valor, marcado) => {
    const lista = limpar(atual);
    if (marcado) return tem(lista, valor) ? lista : [...lista, String(valor).trim()];
    return lista.filter(x => norm(x) !== norm(valor));
  };

  // Itens exibidos no grupo: opções do servidor + gravados + marcados que saíram das opções; os de `topo` (marcados ao carregar/copiar) vêm primeiro.
  // Filtro: texto contido (sem acento nem maiúsculas). `foraDasOpcoes` marca o que não está nas opções (continua aparecendo).
  const semAcento = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  function itensDoGrupo(opcoes, gravados, atuais, topo, filtro) {
    const base = limpar([...limpar(opcoes), ...limpar(gravados), ...limpar(atuais)]);
    const f = semAcento(filtro);
    const ordenados = [...base.filter(v => tem(topo || [], v)), ...base.filter(v => !tem(topo || [], v))];
    return ordenados.filter(v => !f || semAcento(v).includes(f)).map(v => ({ valor: v, marcado: tem(atuais || [], v), foraDasOpcoes: !tem(opcoes || [], v) }));
  }

  // "Copiar de outro perfil": aplica as listas do outro perfil só na tela. Só entram valores que o servidor aceitaria (opções ou já gravados neste
  // perfil); o resto vai em `ignorados` para avisar. `quais` = chaves dos grupos (padrão: todos).
  function aplicarCopia(atuais, outro, quais, opcoes, gravados) {
    const alvo = Array.isArray(quais) && quais.length ? quais.filter(c => CHAVES.includes(c)) : CHAVES;
    const novo = copiaListas(atuais);
    const ignorados = {};
    for (const g of alvo) {
      const validos = [...limpar(opcoes && opcoes[g]), ...limpar(gravados && gravados[g])];
      const origem = limpar(outro && outro[g]);
      novo[g] = origem.filter(v => tem(validos, v)).map(v => validos.find(x => norm(x) === norm(v)));
      const fora = origem.filter(v => !tem(validos, v));
      if (fora.length) ignorados[g] = fora;
    }
    return { atuais: novo, ignorados };
  }

  // Corpo do PUT: só os grupos alterados; grupo que fica vazio vai com confirmarVazio (por grupo) só se `confirmados` o inclui.
  function corpoPut(gravados, atuais, confirmados) {
    const r = resumo(gravados, atuais);
    const corpo = {}, vazios = {};
    for (const g of CHAVES) {
      if (!r[g].alterado) continue;
      corpo[g] = limpar(atuais[g]);
      if (r[g].ficaVazio && (confirmados || []).includes(g)) vazios[g] = true;
    }
    if (Object.keys(vazios).length) corpo.confirmarVazio = vazios;
    return corpo;
  }

  // Texto da confirmação antes de gravar: removidos por grupo e aviso de grupo que ficará vazio.
  function textoConfirmacao(gravados, atuais) {
    const r = resumo(gravados, atuais);
    const linhas = [];
    for (const g of CHAVES) {
      if (r[g].removidos.length) linhas.push(`${tituloDe(g)} - remover: ${r[g].removidos.join(', ')}`);
      if (r[g].ficaVazio) linhas.push(`ATENÇÃO: "${tituloDe(g)}" ficará VAZIO (nenhum permitido).`);
    }
    return linhas.join('\n');
  }
  const precisaConfirmar = (gravados, atuais) => totais(gravados, atuais).removidos > 0;

  // Mensagem em português para erro do servidor (err.status, err.dados = corpo JSON, err.message).
  function mensagemErro(err) {
    const s = err && err.status, d = (err && err.dados) || {};
    const lista = o => Object.keys(o || {}).map(g => `${tituloDe(g)}: ${[].concat(o[g]).join(', ')}`).join('; ');
    if (s === 400 && d.invalidos && Object.keys(d.invalidos).length) return 'Há valores que não existem mais nas opções (' + lista(d.invalidos) + '). Desmarque-os ou recarregue as opções.';
    if (s === 400 && Array.isArray(d.gruposVazios) && d.gruposVazios.length) return 'Esvaziar a lista exige confirmação: ' + d.gruposVazios.map(tituloDe).join(', ') + '.';
    if (s === 400) return d.error || 'Dados inválidos.';
    if (s === 403) return 'Você não tem permissão para editar as dependências deste perfil.';
    if (s === 404) return 'Produto não encontrado. Ele pode ter sido excluído; recarregue a lista.';
    if (s === 409) return d.error || 'Outra pessoa alterou este perfil ao mesmo tempo. Recarregue e tente de novo.';
    if (s === 422) return d.error || 'O produto não tem modelo cadastrado.';
    if (s >= 500 || s === undefined) return 'O servidor não conseguiu gravar agora. Nada foi alterado; suas marcações continuam na tela. Tente de novo em instantes.';
    return (err && err.message) || 'Não foi possível gravar.';
  }

  return { GRUPOS, CHAVES, tituloDe, limpar, diferenca, resumo, gruposAlterados, totais, alternar, itensDoGrupo, aplicarCopia, corpoPut, textoConfirmacao, precisaConfirmar, mensagemErro, copiaListas };
});
