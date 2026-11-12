// ============================================================
// AUDITORIA DO CÁLCULO — painel lateral (gaveta) de orcamentos.html
// Mostra, em tempo real, o que foi enviado ao motor de preço, o que o servidor leu do banco, o passo a passo das contas
// e o que a tela fez com o resultado; guarda os últimos 20 cálculos da sessão e destaca o que mudou nas ENTRADAS
// de um cálculo para o anterior. Regras: docs/regras/auditoria-calculo.md.
// Só aparece para quem tem `administrativo.ver` (a rota /calcular_preco também confere: sem a chave não devolve rastro).
// Parte de cima: funções puras (testadas no Node). Parte de baixo: a gaveta (só no navegador).
// ============================================================
(function (raiz) {
    'use strict';

    const MAX_HISTORICO = 20;
    // campos do corpo que não são entrada de cálculo (controle do pedido)
    const IGNORAR_NA_COMPARACAO = new Set(['debug', 'auditoria']);

    // { a: { b: [1, 2] } } → { 'a.b[0]': 1, 'a.b[1]': 2 }; listas vazias e objetos vazios viram '[]' / '{}' para aparecerem
    function achatar(valor, prefixo, saida) {
        saida = saida || {};
        prefixo = prefixo || '';
        if (Array.isArray(valor)) {
            if (!valor.length) saida[prefixo] = '[]';
            valor.forEach((v, i) => achatar(v, `${prefixo}[${i}]`, saida));
        } else if (valor && typeof valor === 'object') {
            const chaves = Object.keys(valor);
            if (!chaves.length && prefixo) saida[prefixo] = '{}';
            for (const k of chaves) {
                if (!prefixo && IGNORAR_NA_COMPARACAO.has(k)) continue;
                achatar(valor[k], prefixo ? `${prefixo}.${k}` : k, saida);
            }
        } else if (prefixo) {
            saida[prefixo] = valor;
        }
        return saida;
    }

    // Compara as ENTRADAS de dois cálculos. '' e ausente são diferentes de propósito (folha sem posição ≠ folha que não existe).
    function diferencas(antes, depois) {
        const a = achatar(antes || {}), d = achatar(depois || {});
        const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort();
        const lista = [];
        for (const c of campos) {
            const va = c in a ? a[c] : undefined, vd = c in d ? d[c] : undefined;
            if (String(va) !== String(vd) || (va === undefined) !== (vd === undefined)) lista.push({ campo: c, antes: va, depois: vd });
        }
        return lista;
    }

    function textoValor(v) {
        if (v === undefined) return '(ausente)';
        if (v === null) return 'null';
        if (v === '') return '""';
        return String(v);
    }

    const num2 = v => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—');

    // valor salvo x recalculado (edição): compara a BASE (sem % do histórico), que é o que o motor devolve
    function compararSalvo(salvoBase, recalculado) {
        const s = Number(salvoBase), r = Number(recalculado);
        if (!Number.isFinite(s) || !Number.isFinite(r) || !(s > 0)) return null;
        const dif = Math.round((r - s) * 100) / 100;
        return { salvo: Math.round(s * 100) / 100, recalculado: Math.round(r * 100) / 100, diferenca: dif, difere: Math.abs(dif) >= 0.01 };
    }

    // Base salva de um item da lista: a guardada, ou o valor dividido pelo fator do histórico de % (aditivo, regra do VB)
    function baseSalvaDoItem(item, fatorHistorico) {
        if (!item) return null;
        if (Number(item.valorBase) > 0) return Number(item.valorBase);
        const f = typeof fatorHistorico === 'function' ? fatorHistorico(item.historico) : 1;
        return Number(item.valor) > 0 ? Math.round(Number(item.valor) / (f || 1) * 100) / 100 : null;
    }

    // "Adicionar/Atualizar item": que valor vai para a lista. Valor salvo intacto no campo (edição sem recálculo) JÁ tem a % da
    // lista: grava igual, sem aplicar a % de novo. Valor vindo do motor é a BASE: a % do item é aplicada uma vez.
    function valorAoAtualizar({ valorCampo, editando, campoTemSalvo, antigo, baseSalva, fatorHistorico }) {
        const fator = typeof fatorHistorico === 'function' ? fatorHistorico : () => 1;
        if (editando && campoTemSalvo && antigo) {
            return { valor: Number(antigo.valor), historico: antigo.historico || '',
                valorBase: Number(antigo.valorBase) > 0 ? Number(antigo.valorBase) : (Number(baseSalva) > 0 ? Number(baseSalva) : Number(antigo.valor)) };
        }
        const historico = editando && antigo ? (antigo.historico || '') : '';
        const base = Number(valorCampo) || 0;
        return { valorBase: base, historico, valor: Math.round(base * fator(historico) * 100) / 100 };
    }

    function linhasPassos(passos, nivel, saida) {
        const pre = '  '.repeat(nivel);
        (passos || []).forEach((p, i) => {
            const res = p.unitario !== undefined ? ` → unitário ${p.unitario} | total ${p.total}` : (p.resultado !== undefined ? ` = ${p.resultado}${p.unidade ? ' ' + p.unidade : ''}` : '');
            saida.push(`${pre}${i + 1}. ${p.titulo || p.etapa}${p.formula ? ': ' + p.formula : ''}${res}`);
            if (Array.isArray(p.passos) && p.passos.length) linhasPassos(p.passos, nivel + 1, saida);
        });
        return saida;
    }

    function descreverLeitura(l) {
        const r = l.resultado;
        if (r && typeof r === 'object' && !Array.isArray(r)) {
            const partes = [];
            if (r.codigo !== undefined && r.codigo !== null) partes.push(`CODIGO ${r.codigo}`);
            if (r.valorFixo !== undefined) partes.push(`VALOR_FIXO ${r.valorFixo}`);
            if (r.descontoVidro !== undefined) partes.push(`DESCONTO_VIDRO ${r.descontoVidro}`);
            if (r.tipoPuxador !== undefined) partes.push(`TIPO_PUXADOR "${r.tipoPuxador}"`);
            if (r.descontoPerfilPux !== undefined) partes.push(`DESC_PERF_PUX ${r.descontoPerfilPux}`);
            return partes.join(', ') || JSON.stringify(r);
        }
        if (Array.isArray(r)) return `${r.length} registro(s)`;
        if (r === null) return 'NÃO ENCONTRADO';
        return l.fonte === 'taxaAcabamento' ? `${r}%` : String(r);
    }

    // Relatório em texto de um cálculo (para colar numa conversa ou num chamado)
    function relatorioTexto(reg, contexto) {
        if (!reg) return 'Nenhum cálculo registrado.';
        const L = [];
        L.push(`AUDITORIA DO CÁLCULO #${reg.id} — ${reg.hora} — ${reg.origem}`);
        L.push(`Estado: ${reg.estado}${reg.erro ? ' (' + reg.erro + ')' : ''}`);
        L.push(`Disparado por: ${reg.gatilho || '(não identificado)'}`);
        if (reg.resposta) L.push(`Resposta do motor: unitário ${num2(reg.resposta.unitario)} | total ${num2(reg.resposta.total)}`);
        if (reg.campo) L.push(`Campo "Valor unitário": antes ${textoValor(reg.campo.antes)} → depois ${textoValor(reg.campo.depois)}`);
        if (reg.edicao && reg.edicao.comparacao) {
            const c = reg.edicao.comparacao;
            L.push(`Edição do item ${reg.edicao.item}: base salva ${num2(c.salvo)} x recalculada ${num2(c.recalculado)} (${c.difere ? 'DIFERENTE: ' + num2(c.diferenca) : 'igual'})`);
        }
        if (reg.mudancas && reg.mudancas.length) {
            L.push('', 'Entradas que mudaram desde o cálculo anterior:');
            reg.mudancas.forEach(m => L.push(`  ${m.campo}: ${textoValor(m.antes)} → ${textoValor(m.depois)}`));
        }
        L.push('', 'Entrada enviada ao motor:');
        const plano = achatar(reg.payload || {});
        Object.keys(plano).forEach(k => L.push(`  ${k} = ${textoValor(plano[k])}`));
        const a = reg.auditoria;
        if (a) {
            L.push('', `Cliente: ${a.cliente && a.cliente.encontrado ? `${a.cliente.razaoSocial} (código ${a.cliente.codigo}); desconto ${a.cliente.desconto}%; ${a.cliente.isFixo ? 'desconto fixo' : 'não é desconto fixo'}` : 'não encontrado (sem desconto)'}`);
            L.push('', 'Leituras do banco:');
            (a.leituras || []).forEach(l => L.push(`  ${l.fonte}(${textoValor(l.chave)}): ${descreverLeitura(l)}`));
            L.push('', 'Passo a passo:');
            linhasPassos(a.passos, 1, L);
        } else {
            L.push('', '(sem rastro do servidor neste cálculo)');
        }
        if (contexto) {
            L.push('', `Agora na tela: valor no campo ${textoValor(contexto.valorCampo)}; seria gravado ${textoValor(contexto.valorGravado)}${contexto.historico ? ' (com % ' + contexto.historico + ')' : ''}`);
        }
        return L.join('\n');
    }

    const API = { MAX_HISTORICO, valorAoAtualizar, achatar, diferencas, textoValor, compararSalvo, baseSalvaDoItem, relatorioTexto, linhasPassos, descreverLeitura };
    if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

    // ======================= GAVETA (navegador) =======================
    const doc = raiz.document;
    const CHAVE_ABERTA = 'orc.auditoria.aberta';
    let historico = [];        // mais novo no fim
    let seqInterno = 0;
    let selecionado = null;    // id do registro em detalhe (null = o mais recente)
    let ultimoGatilho = '';
    let contextoFn = null;     // a página informa o estado atual (valor no campo, edição, cálculo pendente)
    let simuladorFn = null;    // a página recalcula com o formulário atual SEM aplicar no campo (salvo x recalculado sob demanda)
    let montado = false;

    const pode = () => !!(raiz.Acesso && typeof raiz.Acesso.pode === 'function' && raiz.Acesso.pode('administrativo.ver'));
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const lerAberta = () => { try { return raiz.localStorage.getItem(CHAVE_ABERTA) === '1'; } catch { return false; } };
    const gravarAberta = v => { try { raiz.localStorage.setItem(CHAVE_ABERTA, v ? '1' : '0'); } catch { /* sem armazenamento: só não lembra */ } };
    const horaAgora = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };

    function rotuloCampo(el) {
        if (!el || !el.id) return el && el.name ? el.name : 'campo';
        const lab = doc.querySelector(`label[for="${el.id}"]`) || (el.closest && el.closest('.form-group') && el.closest('.form-group').querySelector('label'));
        const t = lab ? lab.textContent.trim() : '';
        return t ? `${t} (${el.id})` : el.id;
    }
    function valorCampo(el) {
        if (el.type === 'checkbox') return el.checked ? 'marcado' : 'desmarcado';
        if (el.tagName === 'SELECT') return el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value;
        return el.value;
    }

    function gatilho(texto) { ultimoGatilho = String(texto || ''); }

    // Começo de um cálculo: guarda a entrada e o que disparou. Devolve o registro (a página o completa em `fim`).
    function inicio({ origem, payload, campoAntes, edicao }) {
        if (!pode()) return null;
        const reg = { id: ++seqInterno, hora: horaAgora(), origem: origem || 'motor', gatilho: ultimoGatilho, payload: JSON.parse(JSON.stringify(payload || {})),
            estado: 'pendente', resposta: null, auditoria: null, erro: '', campo: { antes: campoAntes, depois: undefined }, edicao: edicao || null, mudancas: [] };
        const anterior = [...historico].reverse().find(r => r.origem === reg.origem);
        reg.mudancas = anterior ? diferencas(anterior.payload, reg.payload) : [];
        reg.primeiro = !anterior;
        historico.push(reg);
        if (historico.length > MAX_HISTORICO) historico = historico.slice(-MAX_HISTORICO);
        renderizar();
        return reg;
    }
    // Fim: estado = 'aplicado' (o valor foi para o campo), 'descartado' (resposta de um estado antigo do formulário) ou 'erro'
    function fim(reg, { estado, resposta, erro, campoDepois }) {
        if (!reg) return;
        reg.estado = estado;
        if (resposta) {
            reg.resposta = { unitario: resposta.unitario, total: resposta.total };
            if (Array.isArray(resposta.acessorios)) reg.resposta.acessorios = resposta.acessorios;
            if (Array.isArray(resposta.complementos)) reg.resposta.complementos = resposta.complementos;
            if (Array.isArray(resposta.pecas)) reg.resposta.pecas = resposta.pecas;
            reg.auditoria = resposta.auditoria || null;
        }
        reg.erro = erro || '';
        reg.campo.depois = campoDepois;
        if (reg.edicao && resposta && (estado === 'aplicado' || estado === 'simulado')) reg.edicao.comparacao = compararSalvo(reg.edicao.base, resposta.unitario);
        renderizar();
    }
    // Serralheria: o valor do item é somado NA TELA (peças × qtd + complementos) ÷ conjuntos; isto registra essa composição
    function composicaoSerralheria({ pecas, complementos, qtd, unitario }) {
        if (!pode()) return;
        const reg = inicio({ origem: 'composição da serralheria (tela)', payload: { qtdConjuntos: qtd,
            pecas: (pecas || []).map(p => ({ produto: p.produto, material: p.material, qtd: p.qtd || 1, valorPeca: p.valor })),
            complementos: (complementos || []).map(c => ({ descricao: c.descricao, qtd: c.qtd, valorTotal: c.valorTotal })) } });
        if (!reg) return;
        const somaPecas = (pecas || []).reduce((s, p) => s + (Number(p.valor) || 0) * (p.qtd || 1), 0);
        const somaComp = (complementos || []).reduce((s, c) => s + (Number(c.valorTotal) || 0), 0);
        reg.auditoria = { versao: 1, frente: 'Serralheria', cliente: null, leituras: [], passos: [
            ...(pecas || []).map((p, i) => ({ etapa: 'peca', titulo: `Peça ${i + 1}: ${p.produto || ''} / ${p.material || ''}`, formula: `${num2(p.valor)} × ${p.qtd || 1}`, resultado: Math.round((Number(p.valor) || 0) * (p.qtd || 1) * 100) / 100 })),
            ...(complementos || []).map(c => ({ etapa: 'complemento', titulo: `Complemento ${c.descricao || c.id}`, formula: `${c.qtd} × ${num2(c.valorUnitario)}`, resultado: c.valorTotal })),
            { etapa: 'final', titulo: 'Unitário do item (tela)', formula: `(${num2(somaPecas)} peças + ${num2(somaComp)} complementos) ÷ ${qtd} conjunto(s)`, unitario: unitario, total: Math.round((Number(unitario) || 0) * qtd * 100) / 100 }
        ] };
        fim(reg, { estado: 'aplicado', resposta: { unitario, total: Math.round((Number(unitario) || 0) * qtd * 100) / 100, auditoria: reg.auditoria }, campoDepois: unitario });
    }
    function definirContexto(fn) { contextoFn = typeof fn === 'function' ? fn : null; }
    function definirSimulador(fn) { simuladorFn = typeof fn === 'function' ? fn : null; }
    async function simular() {
        const aviso = doc.getElementById('aud-copiado');
        if (!simuladorFn) return;
        try { await simuladorFn(); if (aviso) aviso.textContent = 'Recalculado (o campo não mudou).'; }
        catch (e) { if (aviso) aviso.textContent = (e && e.message) || 'Não foi possível recalcular.'; }
        if (aviso) setTimeout(() => { aviso.textContent = ''; }, 4000);
        renderizar();
    }
    function contextoAtual() { try { return contextoFn ? contextoFn() : null; } catch { return null; } }
    const pedir = () => pode();

    // ---------- desenho ----------
    function montar() {
        if (montado || !doc.body) return;
        if (!pode()) { const b = doc.getElementById('aud-abrir'); if (b) b.hidden = true; return; }
        montado = true;
        const botao = doc.createElement('button');
        botao.type = 'button'; botao.id = 'aud-abrir'; botao.className = 'aud-abrir';
        botao.setAttribute('data-perm', 'administrativo.ver');
        botao.setAttribute('aria-controls', 'aud-gaveta'); botao.setAttribute('aria-expanded', 'false');
        botao.title = 'Auditoria do cálculo: entradas, leituras do banco e passo a passo do preço';
        botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6M9 4a2 2 0 0 0-2 2v0h10v0a2 2 0 0 0-2-2M7 6H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1"/><path d="M9 12h6M9 16h4"/></svg><span>Auditoria</span>';
        const gaveta = doc.createElement('aside');
        gaveta.id = 'aud-gaveta'; gaveta.className = 'aud-gaveta';
        gaveta.setAttribute('aria-label', 'Auditoria do cálculo');
        gaveta.setAttribute('data-perm', 'administrativo.ver');
        gaveta.innerHTML = `
            <div class="aud-topo">
                <div class="aud-titulo"><h2>Auditoria do cálculo</h2><small>Últimos ${MAX_HISTORICO} cálculos desta sessão</small></div>
                <button type="button" class="aud-fechar" id="aud-fechar" aria-label="Fechar auditoria" title="Fechar (Esc)">✕</button>
            </div>
            <div class="aud-barra">
                <button type="button" class="aud-btn" id="aud-simular" title="Calcula com o formulário atual e mostra aqui, sem trocar o valor do campo">Recalcular sem aplicar</button>
                <button type="button" class="aud-btn" id="aud-copiar-texto">Copiar relatório</button>
                <button type="button" class="aud-btn" id="aud-copiar-json">Copiar JSON</button>
                <button type="button" class="aud-btn" id="aud-limpar">Limpar histórico</button>
                <span class="aud-copiado" id="aud-copiado" role="status" aria-live="polite"></span>
            </div>
            <div class="aud-corpo" id="aud-corpo"></div>`;
        doc.body.appendChild(botao);
        doc.body.appendChild(gaveta);
        botao.addEventListener('click', () => abrir(!gaveta.classList.contains('aberta')));
        gaveta.querySelector('#aud-fechar').addEventListener('click', () => { abrir(false); botao.focus(); });
        gaveta.addEventListener('keydown', e => { if (e.key === 'Escape') { abrir(false); botao.focus(); } });
        gaveta.querySelector('#aud-simular').addEventListener('click', simular);
        gaveta.querySelector('#aud-copiar-texto').addEventListener('click', () => copiar(relatorioTexto(registroEmDetalhe(), contextoAtual())));
        gaveta.querySelector('#aud-copiar-json').addEventListener('click', () => copiar(JSON.stringify({ agora: contextoAtual(), historico }, null, 2)));
        gaveta.querySelector('#aud-limpar').addEventListener('click', () => { historico = []; selecionado = null; renderizar(); });
        gaveta.addEventListener('click', e => {
            const linha = e.target.closest && e.target.closest('tr[data-reg]');
            if (linha) { selecionado = Number(linha.dataset.reg); renderizar(); }
        });
        gaveta.addEventListener('keydown', e => {
            const linha = e.target.closest && e.target.closest('tr[data-reg]');
            if (linha && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selecionado = Number(linha.dataset.reg); renderizar(); }
        });
        // o que disparou o cálculo: o último campo do formulário alterado (os disparos do desenho e da edição avisam por gatilho())
        const anotarCampo = e => {
            const el = e.target;
            if (!el || !el.closest || !el.closest('#form-item') || el.closest('#aud-gaveta')) return;
            gatilho(`${rotuloCampo(el)} = ${valorCampo(el)}`);
        };
        doc.addEventListener('change', anotarCampo, true);
        doc.addEventListener('input', anotarCampo, true);
        abrir(lerAberta(), true);
    }
    function abrir(sim, inicial) {
        const g = doc.getElementById('aud-gaveta'), b = doc.getElementById('aud-abrir');
        if (!g || !b) return;
        g.classList.toggle('aberta', !!sim);
        b.setAttribute('aria-expanded', sim ? 'true' : 'false');
        b.classList.toggle('ativo', !!sim);
        if (!inicial) gravarAberta(!!sim);
        if (sim) { renderizar(); if (!inicial) setTimeout(() => { const f = doc.getElementById('aud-fechar'); if (f) f.focus({ preventScroll: true }); }, 30); }
    }
    async function copiar(texto) {
        const aviso = doc.getElementById('aud-copiado');
        let ok = false;
        try { await raiz.navigator.clipboard.writeText(texto); ok = true; } catch {
            try { const t = doc.createElement('textarea'); t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; doc.body.appendChild(t); t.select(); ok = doc.execCommand('copy'); t.remove(); } catch { ok = false; }
        }
        if (aviso) { aviso.textContent = ok ? 'Copiado.' : 'Não foi possível copiar.'; setTimeout(() => { aviso.textContent = ''; }, 2500); }
    }
    function registroEmDetalhe() {
        if (!historico.length) return null;
        return historico.find(r => r.id === selecionado) || historico[historico.length - 1];
    }
    const SELO = { pendente: ['aviso', 'Calculando'], aplicado: ['ok', 'Aplicado no campo'], simulado: ['info', 'Simulado (não aplicado)'], descartado: ['neutro', 'Descartado (resposta antiga)'], erro: ['perigo', 'Erro'] };
    const selo = estado => { const [c0, t] = SELO[estado] || ['neutro', estado]; const c = raiz.Situacoes ? raiz.Situacoes.cor('calculo', estado) : c0; return `<span class="aud-selo aud-selo-${c}">${esc(t)}</span>`; };
    const mono = v => `<span class="aud-num">${esc(v)}</span>`;

    function htmlPassos(passos) {
        if (!passos || !passos.length) return '<p class="aud-vazio">Sem passos.</p>';
        return '<ol class="aud-passos">' + passos.map(p => {
            const res = p.unitario !== undefined ? `<div class="aud-res">unitário ${mono(num2(p.unitario))} · total ${mono(num2(p.total))}</div>`
                : (p.resultado !== undefined ? `<div class="aud-res">= ${mono(typeof p.resultado === 'number' ? p.resultado : String(p.resultado))}${p.unidade ? ' ' + esc(p.unidade) : ''}</div>` : '');
            const alerta = (p.etapa === 'puxador' && p.qtdPux === 0) || (p.etapa === 'puxador_tipo' && p.qtdPux === 0) ? ' aud-passo-alerta' : '';
            return `<li class="aud-passo${alerta}"><div class="aud-passo-tit">${esc(p.titulo || p.etapa)}</div>` +
                (p.formula ? `<div class="aud-formula">${esc(p.formula)}</div>` : '') + res +
                (Array.isArray(p.passos) && p.passos.length ? `<details class="aud-sub"><summary>Ver contas deste ${p.etapa === 'peca' ? 'item' : 'grupo'}</summary>${htmlPassos(p.passos)}</details>` : '') + '</li>';
        }).join('') + '</ol>';
    }
    function htmlLeituras(leituras) {
        if (!leituras || !leituras.length) return '<p class="aud-vazio">Nenhuma leitura registrada.</p>';
        return '<div class="aud-rolagem aud-rolagem-curta"><table class="aud-tabela"><thead><tr><th>Leitura</th><th>Chave</th><th>Resultado</th></tr></thead><tbody>' +
            leituras.map(l => `<tr${l.resultado === null ? ' class="aud-linha-alerta"' : ''}><td>${esc(l.fonte)}</td><td>${esc(textoValor(l.chave))}</td><td class="aud-mono-cel">${esc(descreverLeitura(l))}</td></tr>`).join('') +
            '</tbody></table></div>';
    }
    function htmlEntrada(payload) {
        const plano = achatar(payload || {});
        const chaves = Object.keys(plano);
        if (!chaves.length) return '<p class="aud-vazio">Sem entrada.</p>';
        return '<div class="aud-rolagem aud-rolagem-curta"><table class="aud-tabela"><thead><tr><th>Campo</th><th>Valor</th></tr></thead><tbody>' +
            chaves.map(k => `<tr><td>${esc(k)}</td><td class="aud-mono-cel">${esc(textoValor(plano[k]))}</td></tr>`).join('') + '</tbody></table></div>';
    }
    function htmlMudancas(reg) {
        if (reg.primeiro) return '<p class="aud-vazio">Primeiro cálculo desta origem na sessão.</p>';
        if (!reg.mudancas.length) return '<p class="aud-igual">Nenhuma entrada mudou em relação ao cálculo anterior (mesma configuração).</p>';
        return '<ul class="aud-mudancas">' + reg.mudancas.map(m => `<li><b>${esc(m.campo)}</b>: <span class="aud-num">${esc(textoValor(m.antes))}</span> → <span class="aud-num aud-novo">${esc(textoValor(m.depois))}</span></li>`).join('') + '</ul>';
    }
    function htmlAgora() {
        const c = contextoAtual();
        if (!c) return '';
        const linhas = [
            ['Valor no campo', c.valorCampo !== undefined && c.valorCampo !== '' ? mono(c.valorCampo) : '<span class="aud-vazio">vazio</span>'],
            ['Seria gravado (unitário)', c.valorGravado !== null && c.valorGravado !== undefined ? mono(num2(c.valorGravado)) + (c.historico ? ` <small>(com % ${esc(c.historico)})</small>` : '') : '—'],
            ['Cálculo', c.pendente ? '<span class="aud-selo aud-selo-aviso">Pendente: aguarde antes de adicionar</span>' : '<span class="aud-selo aud-selo-ok">Em dia</span>']
        ];
        if (c.edicao) {
            const cmp = c.edicao.comparacao;
            linhas.push([`Editando item ${esc(c.edicao.item)}`, `base salva ${mono(num2(c.edicao.base))}` +
                (cmp ? ` · recalculada ${mono(num2(cmp.recalculado))} ${cmp.difere ? `<span class="aud-selo aud-selo-perigo">difere ${esc(num2(cmp.diferenca))}</span>` : '<span class="aud-selo aud-selo-ok">igual</span>'}`
                    : ' · não recalculado (use "Recalcular sem aplicar")') +
                (c.edicao.valorSalvoNoCampo ? ' · <span class="aud-selo aud-selo-neutro">campo com o valor do banco</span>' : '')]);
        }
        return '<section class="aud-bloco aud-agora"><h3>Agora na tela</h3><dl>' + linhas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl></section>';
    }
    function htmlDetalhe(reg) {
        if (!reg) return '<section class="aud-bloco"><p class="aud-vazio">Nenhum cálculo ainda. Monte ou abra um item: cada cálculo aparece aqui.</p></section>';
        const a = reg.auditoria;
        const cli = a && a.cliente ? (a.cliente.encontrado ? `${esc(a.cliente.razaoSocial)} (código ${mono(a.cliente.codigo)}) · desconto ${mono(a.cliente.desconto + '%')} · ${a.cliente.isFixo ? 'desconto fixo (entra no item)' : 'não é desconto fixo'}` : 'Cliente não encontrado: sem desconto') : '—';
        const cmp = reg.edicao && reg.edicao.comparacao;
        return `<section class="aud-bloco">
            <h3>Cálculo #${esc(reg.id)} <small>${esc(reg.hora)} · ${esc(reg.origem)}</small> ${selo(reg.estado)}</h3>
            <p class="aud-gatilho"><b>Disparado por:</b> ${esc(reg.gatilho || '(não identificado)')}</p>
            ${reg.erro ? `<p class="aud-erro">${esc(reg.erro)}</p>` : ''}
            <dl class="aud-resumo">
                <dt>Unitário do motor</dt><dd>${reg.resposta ? mono(num2(reg.resposta.unitario)) : '—'}</dd>
                <dt>Total do motor</dt><dd>${reg.resposta ? mono(num2(reg.resposta.total)) : '—'}</dd>
                <dt>Campo antes → depois</dt><dd>${mono(textoValor(reg.campo.antes))} → ${reg.estado === 'pendente' ? mono('…') : mono(textoValor(reg.campo.depois))}</dd>
                ${cmp ? `<dt>Salvo x recalculado</dt><dd>${mono(num2(cmp.salvo))} x ${mono(num2(cmp.recalculado))} ${cmp.difere ? `<span class="aud-selo aud-selo-perigo">difere ${esc(num2(cmp.diferenca))}</span>` : '<span class="aud-selo aud-selo-ok">igual</span>'}</dd>` : ''}
            </dl>
            <details open><summary>O que mudou nas entradas desde o cálculo anterior</summary>${htmlMudancas(reg)}</details>
            <details><summary>Entrada enviada ao motor</summary>${htmlEntrada(reg.payload)}</details>
            <details open><summary>Cliente</summary><p class="aud-linha">${cli}</p></details>
            <details${a ? ' open' : ''}><summary>Leituras do banco</summary>${a ? htmlLeituras(a.leituras) : '<p class="aud-vazio">Sem rastro do servidor.</p>'}</details>
            <details open><summary>Passo a passo</summary>${a ? htmlPassos(a.passos) : '<p class="aud-vazio">Sem rastro do servidor.</p>'}</details>
            ${reg.resposta && Array.isArray(reg.resposta.acessorios) && reg.resposta.acessorios.length ? `<details><summary>Acessórios devolvidos</summary><div class="aud-rolagem aud-rolagem-curta"><table class="aud-tabela"><thead><tr><th>Acessório</th><th>Qtd</th><th>Tabela</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${reg.resposta.acessorios.map(x => `<tr><td>${esc(x.nome)}</td><td class="aud-mono-cel">${esc(x.qtd)}</td><td class="aud-mono-cel">${esc(num2(x.valorTabela))}</td><td class="aud-mono-cel">${esc(num2(x.valorUnitario))}</td><td class="aud-mono-cel">${esc(num2(x.valorTotal))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        </section>`;
    }
    function htmlHistorico() {
        if (!historico.length) return '';
        const atual = registroEmDetalhe();
        return '<section class="aud-bloco"><h3>Histórico <small>clique numa linha para ver o detalhe</small></h3><div class="aud-rolagem"><table class="aud-tabela aud-hist"><thead><tr><th>#</th><th>Hora</th><th>Origem</th><th>Unitário</th><th>Estado</th><th>Mudou</th></tr></thead><tbody>' +
            [...historico].reverse().map(r => `<tr data-reg="${r.id}" tabindex="0" class="${atual && atual.id === r.id ? 'aud-sel' : ''}" aria-selected="${atual && atual.id === r.id}">` +
                `<td class="aud-mono-cel">${r.id}</td><td class="aud-mono-cel">${esc(r.hora.slice(0, 8))}</td><td>${esc(r.origem)}</td>` +
                `<td class="aud-mono-cel">${r.resposta ? esc(num2(r.resposta.unitario)) : '—'}</td><td>${selo(r.estado)}</td>` +
                `<td>${r.primeiro ? '—' : r.mudancas.length ? esc(r.mudancas.slice(0, 2).map(m => m.campo).join(', ') + (r.mudancas.length > 2 ? ` +${r.mudancas.length - 2}` : '')) : '<span class="aud-igual">nada</span>'}</td></tr>`).join('') +
            '</tbody></table></div></section>';
    }
    function renderizar() {
        const corpo = doc.getElementById('aud-corpo'), g = doc.getElementById('aud-gaveta');
        if (!corpo || !g || !g.classList.contains('aberta')) return;
        const abertos = [...corpo.querySelectorAll('details')].map(d => d.open);
        const rolagem = corpo.scrollTop;
        corpo.innerHTML = htmlAgora() + htmlDetalhe(registroEmDetalhe()) + htmlHistorico();
        // mantém abertos/fechados os blocos que o usuário mexeu (mesma estrutura)
        const novos = [...corpo.querySelectorAll('details')];
        if (novos.length === abertos.length) novos.forEach((d, i) => { d.open = abertos[i]; });
        corpo.scrollTop = rolagem;
    }

    function iniciar() {
        montar();
        doc.addEventListener('acesso-atualizado', () => { if (!montado) montar(); });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', iniciar); else setTimeout(iniciar, 0);

    raiz.AuditoriaCalculo = Object.assign({}, API, { pedir, gatilho, inicio, fim, composicaoSerralheria, definirContexto, definirSimulador, simular, renderizar, abrir });
})(typeof window !== 'undefined' ? window : globalThis);
