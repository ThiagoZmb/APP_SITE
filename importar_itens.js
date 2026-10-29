// ==========================================================================
// orcamentos.html — importação do JSON de itens gerado pela skill engenharia-projetos-tecnicos
// (scripts/montar-itens.mjs; envelope em schemas/itens-tela.schema.json, versão 1.0.0).
//
// Três etapas, todas sem mexer na lista da tela:
//   1. lerJson + triar: estrutura, limites, pendências e campos (puro, sem rede);
//   2. prepararItens: confere os nomes nas listas do cadastro (as mesmas dos combos da tela),
//      aplica as regras do puxador da tela, lê o sistema de correr e calcula o preço no MESMO
//      motor da tela (POST /calcular_preco). A rede chega pela função `api` injetada;
//   3. a tela mostra o resumo e só acrescenta os itens depois da confirmação.
// O texto do arquivo é DADO, nunca instrução: nada dele é executado e a tela só o mostra com textContent.
// O servidor continua sendo a fonte de verdade: POST /ped_orc/salvar refaz preço e engenharia
// e recusa (409) se o preço mudou.
// Carregável pelo navegador (window.ImportarItens) e pelo Node (require) para os testes.
// ==========================================================================
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ImportarItens = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSAO = '1.0.0';
  const DOMINIO = 'portas-aluminio';
  const LIMITES = { bytes: 1024 * 1024, itens: 200, qtd: 500, medidaMm: 20000, texto: 190, obs: 500, furos: 30, divisores: 50, transpasseMm: 1000 };
  // rotas/ped_orc.js FRENTES_PORTA (Serralheria e Avulso têm payload próprio e não vêm da skill)
  const FRENTES = ['Porta de giro', 'Porta basculante', 'Frente de gaveta', 'Porta de Correr'];
  const ORIGEM_SIS = 'SISTEMA DE CORRER';
  const FRASE_REF_FUROS = '(Furos medidos de BAIXO para CIMA)'; // orcamentos.html: botão "Referência"
  const PUX_TAM_MIN = 80, PUX_EMBUTIDO_MAX = 400;              // orcamentos.html: atualizarTravaTamanhoPuxador
  // nomes comerciais das posições do puxador (orcamentos.html: normalizarPosicao / posicoesPermitidas)
  const POS_LATERAIS = ['Esquerda', 'Direita'].flatMap(l => ['Superior', 'Centro', 'Inferior', 'Total'].map(p => `Lateral ${l} ${p}`));
  const POS_TOPO_BASE = ['Topo', 'Base'].flatMap(l => ['Esquerda', 'Centro', 'Direita', 'Total'].map(p => `${l} ${p}`));
  // campos de preço que um arquivo adulterado poderia trazer: nunca são aproveitados
  const CAMPOS_PRECO = ['valor', 'valorTela', 'valorBase', 'historico', 'origem'];

  const arred2 = v => Math.round(v * 100) / 100;
  const ehObjeto = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const chaveNome = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const properCase = t => String(t || '').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  // texto do arquivo mostrado na tela: curto e sem quebras (a tela ainda usa textContent)
  const curto = (v, n = 160) => { const t = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const ehCorrer = f => f === 'Porta de Correr';
  const temFuros = f => f === 'Porta de giro' || f === 'Porta basculante';  // orcamentos.html: ehPortaComFuros
  const temSistema = s => !!s && s !== 'Sem sistema';                         // calculo/engenharia.js: temSistemaCorrer

  // ---------------- 1. Leitura ----------------
  function lerJson(texto, tamanhoBytes) {
    const tam = Number(tamanhoBytes ?? String(texto ?? '').length);
    if (!(tam > 0)) return { ok: false, erro: 'O arquivo está vazio.' };
    if (tam > LIMITES.bytes) return { ok: false, erro: `Arquivo grande demais (${Math.ceil(tam / 1024)} KB). O máximo é ${LIMITES.bytes / 1024 / 1024} MB.` };
    try {
      return { ok: true, dados: JSON.parse(String(texto).replace(/^﻿/, '')) };
    } catch {
      return { ok: false, erro: 'O arquivo não é um JSON válido.' };
    }
  }

  // ---------------- campos ----------------
  // Cada leitor devolve o valor normalizado ou registra o erro em `erros` (mensagem para a pessoa).
  function leitores(erros) {
    const texto = (rotulo, v, { max = LIMITES.texto, obrigatorio = false, multilinha = false } = {}) => {
      if (v === undefined || v === null) v = '';
      if (typeof v !== 'string') { erros.push(`${rotulo}: deve ser texto.`); return ''; }
      const t = v.trim();
      if (obrigatorio && !t) { erros.push(`${rotulo}: não informado.`); return ''; }
      if (t.length > max) { erros.push(`${rotulo}: texto longo demais (máximo ${max} caracteres).`); return ''; }
      // controle invisível (e quebra de linha fora da observação) não existe em nome de cadastro
      if ((multilinha ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(t)) { erros.push(`${rotulo}: tem caracteres de controle.`); return ''; }
      return t;
    };
    const numero = (rotulo, v, { min = 0, max = Infinity, inteiro = false, obrigatorio = false, maiorQue = null } = {}) => {
      if (v === undefined || v === null || v === '') {
        if (obrigatorio) erros.push(`${rotulo}: não informado.`);
        return null;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) { erros.push(`${rotulo}: deve ser número.`); return null; }
      if (inteiro && !Number.isInteger(v)) { erros.push(`${rotulo}: deve ser número inteiro.`); return null; }
      if (maiorQue !== null && !(v > maiorQue)) { erros.push(`${rotulo}: deve ser maior que ${maiorQue}.`); return null; }
      if (v < min || v > max) { erros.push(`${rotulo}: fora da faixa (${min} a ${max}).`); return null; }
      return v;
    };
    const lista = (rotulo, v) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) { erros.push(`${rotulo}: deve ser uma lista.`); return []; }
      return v;
    };
    return { texto, numero, lista };
  }

  // posição do puxador → nome comercial (ou null se não reconhecida)
  function posicaoCanonica(p) {
    const k = chaveNome(p);
    return [...POS_LATERAIS, ...POS_TOPO_BASE].find(n => chaveNome(n) === k) || null;
  }
  const ehTotal = p => /TOTAL/i.test(p || '');

  // Item da skill → item da tela (sem preço). Só campos conhecidos; o resto do objeto é ignorado.
  function normalizarItem(bruto) {
    const erros = [], avisos = [];
    if (!ehObjeto(bruto)) return { item: null, erros: ['O item da tela está vazio ou não é um objeto.'], avisos };
    const { texto, numero, lista } = leitores(erros);
    const d = ehObjeto(bruto.detalhes) ? bruto.detalhes : {};
    if (bruto.detalhes !== undefined && !ehObjeto(bruto.detalhes)) erros.push('detalhes: deve ser um objeto.');
    const fu = ehObjeto(bruto.furos) ? bruto.furos : {};
    if (bruto.furos !== undefined && !ehObjeto(bruto.furos)) erros.push('furos: deve ser um objeto.');

    const frenteTxt = texto('Frente', bruto.frente, { obrigatorio: true });
    const frente = FRENTES.find(f => chaveNome(f) === chaveNome(frenteTxt)) || '';
    if (frenteTxt && !frente) erros.push(`Frente "${curto(frenteTxt, 40)}" não existe na tela (aceitas: ${FRENTES.join(', ')}).`);
    const qtd = numero('Quantidade', bruto.qtd, { min: 1, max: LIMITES.qtd, inteiro: true, obrigatorio: true });
    const altura = numero('Altura', bruto.altura, { maiorQue: 0, max: LIMITES.medidaMm, obrigatorio: true });
    const largura = numero('Largura', bruto.largura, { maiorQue: 0, max: LIMITES.medidaMm, obrigatorio: true });

    const perfil = texto('Perfil', d.perfil, { obrigatorio: true });
    const acabamento = texto('Acabamento do perfil', d.acabamento, { obrigatorio: true });
    const cor = texto('Cor do perfil', d.cor);
    const puxador = texto('Puxador', d.puxador);
    let acabPux = texto('Acabamento do puxador', d.acabPux);
    let corPux = texto('Cor do puxador', d.corPux);
    const tipoPuxArquivo = texto('Tipo do puxador', d.tipoPuxador);
    let tamanhoPux = numero('Tamanho do puxador', d.tamanhoPux, { min: 0, max: LIMITES.medidaMm });
    const revestimento = texto('Revestimento', d.revestimento);
    let corRevest = texto('Cor do revestimento', d.corRevest);
    const divisor = texto('Divisor', d.divisor);
    const divH = numero('Divisores horizontais', d.divH, { min: 0, max: LIMITES.divisores, inteiro: true }) ?? 0;
    const divV = numero('Divisores verticais', d.divV, { min: 0, max: LIMITES.divisores, inteiro: true }) ?? 0;
    let sistema = texto('Sistema de correr', d.sistema);
    let transpasse = numero('Transpasse', d.transpasse, { min: 0, max: LIMITES.transpasseMm });
    let obs = texto('Observação', bruto.obs, { max: LIMITES.obs, multilinha: true });
    const posBrutas = lista('Posições do puxador', d.posicoesFolhas);
    let furosLista = lista('Furos', fu.lista);
    let lados = lista('Lados dos furos', fu.lados);
    const refInv = fu.referenciaInvertida === undefined ? false : fu.referenciaInvertida;
    if (typeof refInv !== 'boolean') erros.push('furos.referenciaInvertida: deve ser verdadeiro ou falso.');

    if (CAMPOS_PRECO.some(c => bruto[c] !== undefined)) avisos.push('Valor/histórico que veio no arquivo foi ignorado: o preço é calculado pelo motor da tela.');
    if (Array.isArray(bruto.acessorios) && bruto.acessorios.length) avisos.push('Acessórios do arquivo foram ignorados (não vêm do projeto). Acrescente-os editando o item (✏️).');
    if (!frente || qtd === null || altura === null || largura === null) return { item: null, erros, avisos };

    // ---- puxador e posições (uma por folha; correr: 1 ou 2 laterais por folha) ----
    let posicoes = [];
    const posInformadas = posBrutas.some(p => String(p ?? '').trim());
    if (!puxador) {
      if (posInformadas || acabPux || corPux || tamanhoPux) avisos.push('Sem puxador: posição, acabamento, cor e tamanho do puxador foram ignorados.');
      acabPux = ''; corPux = ''; tamanhoPux = null;
    } else {
      if (posBrutas.length !== qtd) erros.push(`Posições do puxador: informe uma por folha (${qtd} folha(s), ${posBrutas.length} posição(ões)).`);
      posBrutas.forEach((p, i) => {
        if (typeof p !== 'string' || !p.trim()) { erros.push(`Folha ${i + 1}: posição do puxador não informada.`); return; }
        const partes = p.split(',').map(s => s.trim()).filter(Boolean);
        const canon = partes.map(posicaoCanonica);
        if (canon.some(c => !c)) { erros.push(`Folha ${i + 1}: posição do puxador "${curto(p, 60)}" não reconhecida.`); return; }
        if (ehCorrer(frente)) {
          if (canon.length > 2) erros.push(`Folha ${i + 1}: no máximo 2 puxadores por porta de correr.`);
          if (canon.some(c => !c.startsWith('Lateral'))) erros.push(`Folha ${i + 1}: porta de correr só aceita puxador nas laterais.`);
          const lados2 = canon.map(c => c.includes('Esquerda') ? 'E' : 'D');
          if (new Set(lados2).size !== lados2.length) erros.push(`Folha ${i + 1}: dois puxadores no mesmo lado.`);
        } else if (canon.length !== 1) erros.push(`Folha ${i + 1}: informe uma única posição do puxador.`);
        posicoes[i] = canon.join(', ');
      });
      const totais = posicoes.filter(Boolean).map(ehTotal);
      if (totais.some(Boolean) && !totais.every(Boolean)) erros.push('Posições do puxador: "Total" (toda extensão) misturado com posições comuns no mesmo item.');
    }

    // ---- furos (só giro e basculante; a mesma lista em todas as folhas) ----
    const ref = frente === 'Porta basculante' ? largura : altura; // orcamentos.html: obterTamanhoReferencia
    if (!temFuros(frente)) {
      if (furosLista.length || lados.length) avisos.push(`${frente} não tem furação na tela: furos ignorados.`);
      furosLista = []; lados = [];
    } else if (furosLista.length) {
      if (furosLista.length > LIMITES.furos) erros.push(`Furos: no máximo ${LIMITES.furos}.`);
      furosLista.forEach((f, i) => {
        if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) erros.push(`Furo ${i + 1}: medida inválida.`);
        else if (f >= ref) erros.push(`Furo ${i + 1}: ${f} mm passa da medida da porta (${ref} mm).`);
      });
      furosLista = [...new Set(furosLista.filter(f => typeof f === 'number' && f > 0))].sort((a, b) => a - b);
      if (lados.length > qtd) erros.push(`Lados dos furos: ${lados.length} lado(s) para ${qtd} folha(s).`);
      if (frente === 'Porta basculante') {
        // orcamentos.html (sincronizarFurosComMemoria): na basculante o lado vem do perfil, igual em todas as folhas
        const base = chaveNome(perfil).includes('INVERTID') ? 'Inferior' : 'Superior';
        if (lados.some(l => chaveNome(l) !== chaveNome(base))) avisos.push(`Basculante: o lado dos furos vem do perfil (${base}); o lado do arquivo foi substituído.`);
        lados = Array.from({ length: qtd }, () => base);
        posicoes.forEach((p, i) => {
          if ((base === 'Superior' && /^Topo/.test(p)) || (base === 'Inferior' && /^Base/.test(p))) erros.push(`Folha ${i + 1}: puxador no mesmo lado das dobradiças (${base}).`);
        });
      } else {
        const lido = l => { const k = chaveNome(l); return k.startsWith('ESQ') ? 'Esquerdo' : k.startsWith('DIR') ? 'Direito' : null; };
        const lidos = lados.map((l, i) => {
          const v = typeof l === 'string' ? lido(l) : null;
          if (!v) erros.push(`Folha ${i + 1}: lado dos furos "${curto(l, 30)}" inválido (Esquerdo ou Direito).`);
          return v;
        });
        // orcamentos.html (sincronizarFurosComMemoria): sem lado, a dobradiça fica no lado oposto ao puxador da folha
        lados = Array.from({ length: qtd }, (_, i) => {
          const p = posicoes[i] || '';
          const oposto = /Lateral Esquerda/.test(p) ? 'Direito' : /Lateral Direita/.test(p) ? 'Esquerdo' : '';
          const l = lidos[i] || '';
          if (l && oposto && l !== oposto) erros.push(`Folha ${i + 1}: puxador e dobradiças (furos) do mesmo lado.`);
          return l || oposto || lidos[0] || 'Esquerdo';
        });
      }
    } else lados = [];
    if (refInv === true && !obs.includes(FRASE_REF_FUROS)) obs = (obs + ' ' + FRASE_REF_FUROS).trim();

    // ---- correr ----
    if (ehCorrer(frente)) {
      if (!sistema) erros.push('Porta de correr: informe o sistema (ou "Sem sistema").');
    } else {
      if (sistema || transpasse) avisos.push('Sistema de correr e transpasse só valem para porta de correr: ignorados.');
      sistema = ''; transpasse = null;
    }
    if (!revestimento && corRevest) { avisos.push('Cor do revestimento sem revestimento: ignorada.'); corRevest = ''; }

    if (erros.length) return { item: null, erros, avisos };
    const item = {
      frente, qtd, altura, largura, profundidade: 0, soldas: 0, qtdAltura: 1, qtdLargura: 1, qtdProfundidade: 1, complementos: [],
      furos: temFuros(frente) ? { lista: furosLista, lados, referenciaInvertida: refInv === true } : { lista: [], lados: [], referenciaInvertida: false },
      detalhes: {
        perfil, acabamento, cor,
        puxador, tipoPuxador: tipoPuxArquivo, tipoPuxadorNativo: '', posicao: posicoes[0] || '', posicoesFolhas: puxador ? posicoes : Array.from({ length: qtd }, () => ''),
        acabPux, corPux, tamanhoPux: tamanhoPux ?? '',
        revestimento, corRevest, divisor, divH, divV,
        pares: false, todaExt: false,
        sistema, transpasse: transpasse ?? '', desempenador: false,
        produto: '', material: '', acabSerr: '', corSerr: '', categoria: '', avProduto: '', avAcab: '', avCor: ''
      },
      acessorios: [],
      obs
    };
    return { item, erros, avisos };
  }

  // Regras do puxador da tela (orcamentos.html: aplicarRegrasPuxador, tipoPuxadorDaPorta, atualizarTravaTamanhoPuxador)
  // a partir do tipo nativo do cadastro (cadastro_de_produtos.TIPO_PUXADOR). Altera `item` e devolve { erros, avisos }.
  function aplicarRegrasPuxador(item, tipoNativo) {
    const erros = [], avisos = [];
    const d = item.detalhes;
    if (!d.puxador) { d.tipoPuxador = ''; d.tipoPuxadorNativo = ''; d.todaExt = false; d.tamanhoPux = 0; return { erros, avisos }; }
    const nat = String(tipoNativo || '').toUpperCase();
    const correr = ehCorrer(item.frente);
    const todaExt = d.posicoesFolhas.some(ehTotal);
    if (nat.includes('TOTAL') && !todaExt) erros.push(`O puxador ${d.puxador} é Total no cadastro: use as posições "… Total".`);
    else if (todaExt && nat.includes('EMBUTIDO')) erros.push(`Puxador embutido (${d.puxador}) não pode ser em toda a extensão.`);
    else if (todaExt && !(nat.includes('TOTAL') || nat.includes('SOBREPOSTO') || nat.includes('EXTENS'))) erros.push(`O puxador ${d.puxador} não aceita toda a extensão (tipo no cadastro: ${tipoNativo || 'não informado'}).`);
    const base = properCase(String(tipoNativo || '').replace(/total/ig, '').trim()) || (correr ? 'Sobreposto' : '');
    const tipo = todaExt ? (base ? `${base} Total` : 'Total') : base;
    if (d.tipoPuxador && chaveNome(d.tipoPuxador) !== chaveNome(tipo)) avisos.push(`Tipo do puxador no arquivo (${curto(d.tipoPuxador, 40)}) difere do cadastro (${tipo || 'sem tipo'}): vale o cadastro.`);
    d.tipoPuxador = tipo; d.tipoPuxadorNativo = String(tipoNativo || ''); d.todaExt = todaExt;
    // referência física do tamanho: basculante e Topo/Base = largura; laterais = altura
    const p0 = String(d.posicoesFolhas[0] || '').toUpperCase();
    const ref = (item.frente === 'Porta basculante' || p0.includes('TOPO') || p0.includes('BASE')) ? item.largura : item.altura;
    const tam = Number(d.tamanhoPux) || 0;
    if (todaExt) d.tamanhoPux = Math.round(ref);                         // total = lado inteiro
    else if (correr && nat.includes('EMBUTIDO')) {
      if (tam) avisos.push('Puxador embutido na porta de correr não tem tamanho: tamanho ignorado.');
      d.tamanhoPux = 0;
    } else if (!tam) erros.push('Tamanho do puxador não informado.');
    else if (tam < PUX_TAM_MIN) erros.push(`Tamanho do puxador abaixo do mínimo (${PUX_TAM_MIN} mm).`);
    else if (!correr && nat.includes('EMBUTIDO') && tam > PUX_EMBUTIDO_MAX) erros.push(`Puxador embutido vai até ${PUX_EMBUTIDO_MAX} mm.`);
    else if (!correr && tam > ref) erros.push(`Tamanho do puxador (${tam} mm) passa do tamanho da porta (${Math.round(ref)} mm).`);
    return { erros, avisos };
  }

  // ---------------- 1b. Triagem do arquivo ----------------
  // Devolve { erro } (arquivo inteiro recusado) ou { arquivo, aceitos, recusados, sugestoes, avisos }.
  function triar(dados, { itensNaLista = 0 } = {}) {
    if (!ehObjeto(dados)) return { erro: 'O arquivo não tem o formato esperado (objeto com "itens").' };
    if (dados.versao !== VERSAO) return { erro: `Versão do arquivo não suportada: "${curto(dados.versao, 20)}" (esperada ${VERSAO}).` };
    if (dados.dominio !== DOMINIO) return { erro: `Domínio "${curto(dados.dominio, 40)}" não é importável nesta tela (só ${DOMINIO}).` };
    if (!Array.isArray(dados.itens)) return { erro: 'O arquivo não tem a lista "itens".' };
    if (!dados.itens.length) return { erro: 'O arquivo não tem nenhum item.' };
    if (dados.itens.length > LIMITES.itens) return { erro: `O arquivo tem ${dados.itens.length} itens; o máximo por documento é ${LIMITES.itens}.` };
    if (!Array.isArray(dados.pendenciasDocumento)) return { erro: 'O arquivo não tem a lista "pendenciasDocumento".' };
    const arquivo = ehObjeto(dados.origem) && typeof dados.origem.arquivo === 'string' ? curto(dados.origem.arquivo, 120) : '';
    const avisos = [], aceitos = [], recusados = [], sugestoes = [];

    const ids = dados.itens.map((it, i) => (ehObjeto(it) && typeof it.idItem === 'string' && it.idItem.trim()) ? curto(it.idItem, 40) : `#${i + 1}`);
    const refsDoItem = dados.itens.map((it, i) => {
      const r = new Set([ids[i]]);
      if (ehObjeto(it) && ehObjeto(it.rastreio)) Object.values(it.rastreio).forEach(v => typeof v === 'string' && r.add(v));
      return r;
    });
    // pendência do documento: bloqueia os itens a que se refere; sem item identificado (ou de domínio/segurança), bloqueia tudo
    const bloqueioItem = dados.itens.map(() => []);
    const bloqueioGeral = [];
    for (const p of dados.pendenciasDocumento) {
      const msg = `Pendência do documento (${curto(ehObjeto(p) ? p.tipo : '', 30) || 'sem tipo'}): ${curto(ehObjeto(p) ? p.mensagem : p, 200) || 'sem mensagem'}`;
      const refs = ehObjeto(p) && Array.isArray(p.refs) ? p.refs.filter(r => typeof r === 'string') : [];
      const alvo = refsDoItem.map((set, i) => refs.some(r => set.has(r) || r.startsWith(ids[i] + '.')) ? i : -1).filter(i => i >= 0);
      const geral = !ehObjeto(p) || ['dominio_divergente', 'texto_suspeito'].includes(p.tipo) || !alvo.length;
      if (geral) bloqueioGeral.push(msg); else alvo.forEach(i => bloqueioItem[i].push(msg));
    }
    if (bloqueioGeral.length) avisos.push('O arquivo tem pendência do documento sem item identificado: nenhum item entra. Resolva na skill (confirmar-valores) e gere o arquivo de novo.');

    dados.itens.forEach((it, i) => {
      const idItem = ids[i];
      if (!ehObjeto(it)) { recusados.push({ idItem, motivos: ['Item com formato inválido.'] }); return; }
      for (const s of Array.isArray(it.sugestoes) ? it.sugestoes : []) {
        if (!ehObjeto(s)) continue;
        const o = ehObjeto(s.origem) ? s.origem : {};
        sugestoes.push({ idItem, destino: curto(s.destino, 60), valor: curto(s.valor, 80),
          confianca: typeof s.confianca === 'number' ? s.confianca : null,
          pagina: Number.isInteger(o.pagina) ? o.pagina : null, trecho: curto(o.trecho, 120) });
      }
      if (it.foraDoEscopo === true) { recusados.push({ idItem, motivos: ['Fora do escopo atual: este tipo ainda não tem item na tela (lance à mão).'] }); return; }
      const pend = Array.isArray(it.pendencias) ? it.pendencias.filter(ehObjeto) : [];
      const motivos = [...bloqueioGeral, ...bloqueioItem[i], ...pend.filter(p => p.bloqueante !== false).map(p => `Pendência: ${curto(p.mensagem, 200) || curto(p.tipo, 40)}`)];
      if (!motivos.length && it.prontoParaLancar !== true) motivos.push('A skill marcou o item como não pronto para lançar.');
      if (motivos.length) { recusados.push({ idItem, motivos }); return; }
      const n = normalizarItem(it.item);
      const avisosItem = [...pend.filter(p => p.bloqueante === false && p.tipo !== 'fora_do_escopo').map(p => curto(p.mensagem, 200)), ...n.avisos];
      if (!n.item) { recusados.push({ idItem, motivos: n.erros }); return; }
      if (itensNaLista + aceitos.length >= LIMITES.itens) { recusados.push({ idItem, motivos: [`A lista já chegou ao máximo de ${LIMITES.itens} itens por documento.`] }); return; }
      aceitos.push({ idItem, item: n.item, avisos: avisosItem });
    });
    if (dados.prontoParaLancar !== true && !bloqueioGeral.length) avisos.push('A skill marcou o arquivo como não pronto para lançar: só entram os itens liberados.');
    avisos.push('Cores (perfil, puxador, revestimento) não são conferidas com o cadastro na importação: confira editando o item (✏️) se precisar.');
    return { arquivo, aceitos, recusados, sugestoes, avisos };
  }

  // ---------------- 2. Preço (mesmo motor da tela) ----------------
  // Medida de cada folha (calculo/engenharia.js folhasDoItem; orcamentos.html medidasPortasCorrer):
  // correr com sistema → a medida do item é o VÃO; porta = vão − desconto; largura com transpasse.
  function medidasFolha(item, descontoAltura = 0) {
    const a = Number(item.altura) || 0, l = Number(item.largura) || 0, n = Math.max(1, parseInt(item.qtd) || 1);
    if (!(ehCorrer(item.frente) && temSistema(item.detalhes.sistema))) return { altura: a, largura: l };
    const t = parseFloat(item.detalhes.transpasse) || 0;
    return { altura: Math.round(a - (Number(descontoAltura) || 0)), largura: Math.round(n > 1 ? (l + t * (n - 1)) / n : l) };
  }

  // Corpo do POST /calcular_preco: os campos que a tela manda (calcularPrecoAutomatico), com a mesma
  // entrada que o servidor refaz ao salvar (rotas/ped_orc.js entradaPreco + acessórios do sistema).
  function entradaCalculo(item, { clienteNome = '', clienteCodigo = '', sistema = null } = {}) {
    const d = item.detalhes;
    const m = medidasFolha(item, sistema ? sistema.descontoAltura : 0);
    return {
      frente: item.frente, cliente: clienteNome, clienteCodigo,
      altura: m.altura, largura: m.largura,
      acessorios: (sistema ? sistema.acessorios : []).map(a => ({ nome: a.nome, qtd: a.qtd, tamanho: a.tamanho || 0, origem: ORIGEM_SIS })),
      qtd: item.qtd,
      perfil: d.perfil, acabPerfil: d.acabamento,
      puxador: d.puxador, acabPuxador: d.acabPux, tipoPuxador: d.tipoPuxador,
      posicaoPuxador: d.posicoesFolhas[0] || '', posicoesFolhas: d.posicoesFolhas.slice(0, item.qtd), tamanhoPuxador: d.tamanhoPux,
      revestimento: d.revestimento, divisor: d.divisor, qtdDivH: d.divH || 0, qtdDivV: d.divV || 0,
      percentuais: ''
    };
  }

  // descrição da lista (mesmo texto de orcamentos.html coletarForm; o servidor monta a sua ao gravar)
  function descricaoItem(item) {
    const d = item.detalhes;
    const pos = d.posicoesFolhas.slice(0, item.qtd);
    const descPos = !pos.some(Boolean) ? '' : new Set(pos).size === 1 ? ` (${pos[0]})` : ' (' + pos.map((p, i) => `F${i + 1}: ${p || '-'}`).join(' / ') + ')';
    return `${item.frente} — Perfil: ${d.perfil || '-'}, ${d.acabamento || '-'} ${d.cor || ''}`.trimEnd() +
      ` | Puxador: ${d.puxador || '-'}` +
      (d.puxador ? `${d.acabPux ? ' ' + d.acabPux : ''}${d.corPux ? ' ' + d.corPux : ''}` + descPos +
        (d.todaExt ? ' toda extensão' : (d.tamanhoPux ? ` ${d.tamanhoPux}mm` : '')) : '') +
      ` | Revest: ${d.revestimento || '-'}${d.corRevest ? ' ' + d.corRevest : ''}` +
      ` | Divisor: ${d.divisor || '-'} (${d.divH || 0}H/${d.divV || 0}V)` +
      (temFuros(item.frente) && item.furos.lista.length ? ` | Furos: ${item.furos.lista.join(', ')} mm (${[...new Set(item.furos.lados)].join('/')})` : '') +
      (ehCorrer(item.frente) ? ` | Sistema: ${d.sistema || '-'} / Transpasse: ${d.transpasse || 0}mm` : '');
  }

  // Item pronto para a lista, como o adicionarItem deixa (valor = base sem %, histórico vazio)
  function montarItemTela(item, resposta, { sistema = null } = {}) {
    const valor = arred2(Number(resposta && resposta.unitario) || 0);
    if (!(valor > 0)) return { erro: 'O motor devolveu valor zero para este item.' };
    const precos = resposta && Array.isArray(resposta.acessorios) ? resposta.acessorios : [];
    const acessorios = (sistema ? sistema.acessorios : []).map((a, i) => {
      const p = precos[i] && precos[i].nome === a.nome ? precos[i] : {};
      return { nome: a.nome, classe: a.classe, qtd: a.qtd, qtdMax: a.qtd, tamanho: a.tamanho || 0, origem: ORIGEM_SIS,
        valorUnitario: p.valorUnitario ?? null, valorTotal: p.valorTotal ?? null };
    });
    const pronto = { ...item, detalhes: { ...item.detalhes }, acessorios, valor, valorBase: valor, valorTela: valor, historico: '' };
    pronto.descricao = descricaoItem(pronto);
    return { item: pronto };
  }

  // ---------------- 2b. Orquestração (rede pela `api` injetada) ----------------
  // api(caminho, { method, body }) → JSON da resposta; erro HTTP → Error com .status e a mensagem do servidor.
  async function prepararItens(aceitos, { api, clienteNome = '', clienteCodigo = '', aoProgresso = () => {} } = {}) {
    const cache = new Map();
    const lembrar = (chave, fn) => { if (!cache.has(chave)) cache.set(chave, fn().catch(e => { cache.delete(chave); throw e; })); return cache.get(chave); };
    const catalogo = (campo, chave) => lembrar(`cat|${campo}|${chave}`, () => api(`/catalogos_filtro?campo=${encodeURIComponent(campo)}&chave=${encodeURIComponent(chave)}`));
    const tipoNativo = nome => lembrar(`pux|${nome}`, () => api(`/dados_produto?nome=${encodeURIComponent(nome)}`).then(r => String((r && r.tipoPuxador) || '')));
    // nome do arquivo → nome do cadastro (igual, ou só com diferença de maiúsculas/acentos/espaços: usa a grafia do cadastro)
    async function conferir(rotulo, valor, campo, chave, avisos) {
      const lista = await catalogo(campo, chave);
      const nomes = Array.isArray(lista) ? lista.map(String) : [];
      if (nomes.includes(valor)) return { valor };
      const igual = nomes.find(n => chaveNome(n) === chaveNome(valor));
      if (igual) { avisos.push(`${rotulo}: "${curto(valor, 60)}" ajustado para a grafia do cadastro "${igual}".`); return { valor: igual }; }
      return { erro: `${rotulo} "${curto(valor, 60)}" não está no cadastro para ${chave}.` };
    }
    const importados = [], falhas = [];
    let descontoJaAplicado = false;
    for (const [k, a] of aceitos.entries()) {
      aoProgresso(k + 1, aceitos.length, a.idItem);
      const item = { ...a.item, detalhes: { ...a.item.detalhes }, furos: { ...a.item.furos } };
      const d = item.detalhes, avisos = [...a.avisos], erros = [];
      try {
        const c = async (rotulo, campoItem, campo, chave) => {
          if (!d[campoItem]) return;
          const r = await conferir(rotulo, d[campoItem], campo, chave, avisos);
          if (r.erro) erros.push(r.erro); else d[campoItem] = r.valor;
        };
        await c('Perfil', 'perfil', 'perfis', item.frente);
        if (!erros.length) {
          await c('Acabamento do perfil', 'acabamento', 'acabamentos', d.perfil);
          await c('Puxador', 'puxador', 'puxadores', d.perfil);
          await c('Revestimento', 'revestimento', 'revestimentos', d.perfil);
          await c('Divisor', 'divisor', 'divisores', d.perfil);
          if (d.puxador && !erros.length) await c('Acabamento do puxador', 'acabPux', 'acabamentos', d.puxador);
        }
        if (!erros.length && d.puxador) {
          let nat;
          try { nat = await tipoNativo(d.puxador); }
          catch (e) { if (e && e.status === 404) erros.push(`Puxador "${d.puxador}" não encontrado no cadastro.`); else throw e; }
          if (nat !== undefined) { const r = aplicarRegrasPuxador(item, nat); erros.push(...r.erros); avisos.push(...r.avisos); }
        } else if (!d.puxador) aplicarRegrasPuxador(item, '');
        let sistema = null;
        if (!erros.length && ehCorrer(item.frente) && temSistema(d.sistema)) {
          const q = `nome=${encodeURIComponent(d.sistema)}&folhas=${item.qtd}&larguraVao=${encodeURIComponent(item.largura)}&desempenador=0&clienteCodigo=${encodeURIComponent(clienteCodigo)}`;
          try {
            const r = await api(`/ped_orc/sistema_correr?${q}`);
            sistema = { descontoAltura: Number(r.descontoAltura) || 0, acessorios: (Array.isArray(r.acessorios) ? r.acessorios : []).map(x => ({ nome: x.nome, classe: x.classe, qtd: x.qtd, tamanho: x.tamanho || 0 })) };
            if (r.temDesempenador) avisos.push('O sistema tem desempenador opcional: não incluído (marque editando o item, se precisar).');
          } catch (e) { if (e && e.status === 404) erros.push(`Sistema de correr "${d.sistema}" não encontrado.`); else throw e; }
          if (sistema) { const m = medidasFolha(item, sistema.descontoAltura); if (!(m.altura > 0 && m.largura > 0)) erros.push(`Medida da porta inválida depois do desconto do sistema (${m.altura} × ${m.largura} mm).`); }
        }
        if (erros.length) { falhas.push({ idItem: a.idItem, motivos: erros }); continue; }
        let resp;
        try { resp = await api('/calcular_preco', { method: 'POST', body: { ...entradaCalculo(item, { clienteNome, clienteCodigo, sistema }), debug: true } }); }
        catch (e) {
          if (e && e.status === 400) { falhas.push({ idItem: a.idItem, motivos: [`Sem preço no banco: ${curto(e.message, 200)}`] }); continue; }
          throw e;
        }
        const m = montarItemTela(item, resp, { sistema });
        if (m.erro) { falhas.push({ idItem: a.idItem, motivos: [m.erro] }); continue; }
        if (resp.diag && resp.diag.isFixo && resp.diag.descontoCliente > 0) descontoJaAplicado = true;
        importados.push({ idItem: a.idItem, item: m.item, avisos });
      } catch (e) {
        falhas.push({ idItem: a.idItem, motivos: [`Erro ao consultar o servidor${e && e.status ? ` (HTTP ${e.status})` : ''}: ${curto(e && e.message, 160)}`] });
      }
    }
    return { importados, falhas, descontoJaAplicado };
  }

  return { VERSAO, DOMINIO, LIMITES, FRENTES, lerJson, triar, normalizarItem, aplicarRegrasPuxador, medidasFolha, entradaCalculo, descricaoItem, montarItemTela, prepararItens };
});
