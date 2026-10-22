// ==========================================================================
// custos.html — aba "Formação de preço" (partes B + C).
// Usa o que o script da página já define: $, api, esc, moeda, mostrarErro, fecharDetalhe, UN.
// Premissas são do Thiago (web_custo_parametros, web_preco_*); a única gravação no cadastro do VB
// é o VALOR_FIXO confirmado em #dlg-gravar (POST /precos/gravar).
// ==========================================================================
let precos = null;                 // resposta de GET /precos/formacao
const selecao = new Map();         // codigo → valor novo a gravar
let detalhePreco = null;           // resposta de GET /precos/formacao/:codigo
let visiveis = new Set();          // códigos que o filtro mostra: só eles entram na gravação
const MAX_GRAVAR = 500;

const pctBR = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
// "8,5" | "8.5" | "" → número | null; texto inválido → NaN
const lerNumero = t => { const s = String(t ?? '').trim().replace(',', '.'); return s === '' ? null : (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN); };
const podePreco = p => window.Acesso && Acesso.pode(p);
// mesma conta de calculo/precos_formacao.js (margemCom), em %
function margemCom(valor, { custo, V, F }, d) {
    if (!(Number(valor) > 0) || custo == null || d == null || d >= 100) return null;
    return (1 - V / 100 - F / 100 - custo / (valor * (1 - d / 100))) * 100;
}
const margemTxt = v => v == null ? '—' : `<span class="${v < 0 ? 'neg' : ''}">${pctBR(v)}</span>`;
const ORIGEM = { material: 'do material', classe: 'da classe', padrao: 'padrão' };

async function carregarPrecos() {
    try {
        precos = await api('/precos/formacao');
        mostrarErro('');
        selecao.clear();
        for (const m of precos.materiais)
            if (m.gravavelPorPadrao && m.sugerido != null && m.sugerido !== m.valorFixo) selecao.set(m.codigo, m.sugerido);
        const classes = [...new Set(precos.materiais.map(m => m.classe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const atual = $('prc-classe').value;
        $('prc-classe').innerHTML = '<option value="">Todas as classes</option>' + classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        $('prc-classe').value = classes.includes(atual) ? atual : '';
        $('prc-recarregar').style.display = 'none';
        renderParametros();
        renderPrecos();
    } catch (e) { mostrarErro(e.message); }
}

function renderParametros() {
    const p = precos.parametros, r = precos.referencias;
    const extras = precos.encargos.filter(e => e.ativo).reduce((s, e) => s + e.pct, 0);
    const por = (param, valor, ref) => {
        const el = document.querySelector(`#prc-parametros [data-param="${param}"]`);
        const v = el.querySelector('.prc-valor');
        v.textContent = valor == null ? 'não definido' : pctBR(valor);
        v.classList.toggle('indef', valor == null);
        el.querySelector('.prc-ref').innerHTML = ref;
    };
    por('imposto', p.impostoPct, 'alíquota do Simples Nacional');
    por('comissao', p.comissaoPct, r.comissao.motivo ? esc(r.comissao.motivo)
        : `clientes: média ${pctBR(r.comissao.media)} · mais comum ${pctBR(r.comissao.maisFrequente)} (${r.comissao.qtd})`);
    por('encargos', extras, precos.encargos.length ? precos.encargos.map(e => `${esc(e.nome)} ${pctBR(e.pct)}${e.ativo ? '' : ' (inativo)'}`).join(' · ') : 'nenhum cadastrado');
    const cf = r.custoFixo;
    por('custoFixo', p.custoFixoPct, (cf.motivo ? esc(cf.motivo) : `referência ${pctBR(cf.pct)} (${moeda(cf.despesasMes)}/mês ÷ ${moeda(cf.receitasMes)}/mês, ${p.referenciaMeses} meses)`)
        + ' · <a href="#" class="prc-ref-contas">ver contas</a>');
    por('desconto', p.descontoPct, r.desconto.motivo ? esc(r.desconto.motivo)
        : `clientes de desconto fixo: média ${pctBR(r.desconto.media)} · mais comum ${pctBR(r.desconto.maisFrequente)} · maior ${pctBR(r.desconto.maior)}`);
    por('margem', p.margemPct, `${precos.margens.classes.length} classe(s) e ${precos.margens.materiais.length} material(is) com margem própria`);
    const partes = [p.impostoPct, p.comissaoPct, extras, p.custoFixoPct, p.margemPct];
    const soma = partes.reduce((s, v) => s + (v || 0), 0);
    $('prc-soma').textContent = `Imposto + comissão + encargos + custo fixo + margem = ${pctBR(soma)}${soma >= 100 ? ' — impossível formar preço' : ''}`;
    $('prc-soma').classList.toggle('alerta', soma >= 100);
}

function filtrados() {
    const q = $('prc-busca').value.trim().toLowerCase(), classe = $('prc-classe').value;
    const comCusto = $('prc-com-custo').checked, varMin = lerNumero($('prc-variacao').value);
    return precos.materiais.filter(m => (!q || m.modelo.toLowerCase().includes(q))
        && (!classe || m.classe === classe)
        && (!comCusto || m.custo != null)
        && (varMin == null || Number.isNaN(varMin) || (m.variacao != null && Math.abs(m.variacao) >= varMin)));
}

function renderPrecos() {
    const lista = filtrados();
    visiveis = new Set(lista.map(m => m.codigo));
    const tb = $('tab-precos').querySelector('tbody');
    if (!lista.length) { tb.innerHTML = '<tr><td colspan="12" class="vazio">Nenhum material.</td></tr>'; atualizarBotaoGravar(); return; }
    tb.innerHTML = lista.map(m => {
        const novo = selecao.has(m.codigo) ? selecao.get(m.codigo) : m.sugerido;
        const variacao = novo != null && m.atual ? (novo - m.atual) / m.atual * 100 : null;
        // sem sugestão só fica marcável se já está na seleção (valor do simulador), para poder desmarcar
        const marcavel = podePreco('precos.gravar') && (m.sugerido != null || selecao.has(m.codigo));
        const avisos = m.avisos.map(a => `<span class="prc-aviso">${a.startsWith('custo desatualizado') ? '🕒' : '⚠️'} ${esc(a)}</span>`).join('');
        const corpo = m.sugerido == null && m.minimo == null
            ? `<td colspan="9" class="prc-motivo">${m.motivos.map(esc).join(' · ')}</td>`
            : `<td class="num">${moeda(m.custo)}<small>/${UN[m.unidade] || m.unidade}</small></td>
               <td class="num col-opc">${moeda(m.minimo)}</td><td class="num col-opc">${moeda(m.equilibrio)}</td><td class="num col-opc">${moeda(m.alvo)}</td>
               <td class="num">${moeda(m.atual)}<span class="seta">→</span><span class="novo">${moeda(novo)}</span>${m.motivos.length ? `<span class="prc-motivo" style="display:block">${m.motivos.map(esc).join(' · ')}</span>` : ''}</td>
               <td class="num ${variacao > 0 ? 'var-sobe' : variacao < 0 ? 'var-desce' : ''}">${variacao == null ? '—' : (variacao > 0 ? '+' : '') + variacao.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</td>
               <td class="num col-opc">${margemTxt(m.margemAtual)}</td><td class="num col-opc">${margemTxt(m.margemPior)}</td>
               <td class="col-opc">${m.origemMargem ? `<span class="origem-${m.origemMargem}">${pctBR(m.M)} ${ORIGEM[m.origemMargem]}</span>` : ''}</td>`;
        return `<tr data-codigo="${m.codigo}"><td><input type="checkbox" class="prc-marcar" aria-label="Gravar ${esc(m.modelo)}" ${selecao.has(m.codigo) ? 'checked' : ''} ${marcavel ? '' : 'disabled'}></td>
            <td>${esc(m.modelo)}${avisos}</td><td class="col-opc">${esc(m.classe)}</td>${corpo}</tr>`;
    }).join('');
    atualizarBotaoGravar();
}

function atualizarBotaoGravar() {
    const n = itensSelecionados().length, fora = selecao.size - n;
    $('prc-gravar').textContent = `Gravar selecionados (${n})`;
    $('prc-gravar').disabled = !n;
    $('prc-fora-filtro').textContent = fora ? `${fora} marcado${fora > 1 ? 's' : ''} fora do filtro não ${fora > 1 ? 'entram' : 'entra'}` : '';
}

// ---------- premissas ----------
function abrirPremissas() {
    const p = precos.parametros;
    const v = x => x == null ? '' : String(x).replace('.', ',');
    $('pp-imposto').value = v(p.impostoPct); $('pp-comissao').value = v(p.comissaoPct); $('pp-custo-fixo').value = v(p.custoFixoPct);
    $('pp-desconto').value = v(p.descontoPct); $('pp-margem').value = v(p.margemPct); $('pp-meses').value = p.referenciaMeses;
    $('pp-encargos').querySelector('tbody').innerHTML = precos.encargos.map(e => linhaEncargo(e)).join('');
    const margemDe = c => precos.margens.classes.find(x => x.classe === c)?.pct;
    const classes = [...new Set([...precos.materiais.map(m => m.classe), ...precos.margens.classes.map(c => c.classe)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('pp-margens').querySelector('tbody').innerHTML = classes.map(c =>
        `<tr data-classe="${esc(c)}"><td>${esc(c)}</td><td><input type="text" inputmode="decimal" class="marg-pct" value="${v(margemDe(c))}" aria-label="Margem de ${esc(c)}"></td></tr>`).join('');
    $('pp-msg').textContent = '';
    $('dlg-precos-param').showModal();
}
const linhaEncargo = (e = null) => `<tr ${e ? `data-id="${e.id}"` : 'data-novo'}>
    <td><input type="text" class="enc-nome" maxlength="60" value="${esc(e?.nome || '')}" aria-label="Nome do encargo"></td>
    <td><input type="text" inputmode="decimal" class="enc-pct" value="${e ? String(e.pct).replace('.', ',') : ''}" aria-label="Percentual do encargo"></td>
    <td><input type="checkbox" class="enc-ativo" ${!e || e.ativo ? 'checked' : ''} aria-label="Ativo"></td>
    <td><button type="button" class="btn-mini enc-excluir" aria-label="Excluir encargo">✕</button></td></tr>`;

async function salvarPremissas() {
    const p = precos.parametros, erro = t => { $('pp-msg').textContent = t; };
    const campos = [['pp-imposto', 'impostoPct', 'imposto'], ['pp-comissao', 'comissaoPct', 'comissão'], ['pp-custo-fixo', 'custoFixoPct', 'custo fixo'],
        ['pp-desconto', 'descontoPct', 'desconto'], ['pp-margem', 'margemPct', 'margem padrão']];
    const corpo = {};
    for (const [id, campo, nome] of campos) {
        const n = lerNumero($(id).value);
        if (Number.isNaN(n)) return erro(`Percentual de ${nome} inválido.`);
        if (n !== p[campo]) corpo[campo] = n;
    }
    const meses = Number($('pp-meses').value);
    if (meses !== p.referenciaMeses) corpo.referenciaMeses = meses;
    const pedidos = [];
    if (Object.keys(corpo).length) pedidos.push(['/precos/parametros', 'PUT', corpo]);
    for (const tr of $('pp-encargos').querySelectorAll('tbody tr')) {
        const nome = tr.querySelector('.enc-nome').value.trim(), pct = lerNumero(tr.querySelector('.enc-pct').value), ativo = tr.querySelector('.enc-ativo').checked;
        const excluir = tr.classList.contains('excluir');
        if (tr.hasAttribute('data-novo')) {
            if (excluir || (!nome && pct == null)) continue;
            if (!nome || pct == null || Number.isNaN(pct)) return erro('Encargo novo: preencha o nome e o percentual.');
            pedidos.push(['/precos/encargos', 'POST', { nome, pct }]);
            continue;
        }
        const id = Number(tr.dataset.id), e = precos.encargos.find(x => x.id === id);
        if (excluir) { pedidos.push([`/precos/encargos/${id}`, 'DELETE']); continue; }
        if (!nome || pct == null || Number.isNaN(pct)) return erro(`Encargo "${e.nome}": preencha o nome e o percentual.`);
        if (nome !== e.nome || pct !== e.pct || ativo !== e.ativo) pedidos.push([`/precos/encargos/${id}`, 'PUT', { nome, pct, ativo }]);
    }
    for (const tr of $('pp-margens').querySelectorAll('tbody tr')) {
        const classe = tr.dataset.classe, n = lerNumero(tr.querySelector('.marg-pct').value);
        if (Number.isNaN(n)) return erro(`Margem de ${classe} inválida.`);
        const antes = precos.margens.classes.find(x => x.classe === classe)?.pct ?? null;
        if (n !== antes) pedidos.push(['/precos/margens', 'PUT', { escopo: 'classe', chave: classe, margemPct: n }]);
    }
    try {
        for (const [caminho, method, b] of pedidos) await api(caminho, { method, ...(b ? { body: JSON.stringify(b) } : {}) });
        $('dlg-precos-param').close();
        if (pedidos.length) await carregarPrecos();
    } catch (e) { erro(e.message); if (pedidos.length) carregarPrecos(); }
}

// referência de custo fixo: só ver as contas, ou (calcular = true) recalcular na hora e oferecer "Usar X%"
let cfCalculado = null;
const arred2 = v => Math.round(Number((v * 100).toPrecision(15))) / 100;
function mostrarCustoFixo(cf, meses, calcular) {
    cfCalculado = calcular ? cf : null;
    $('dlg-contas-titulo').textContent = calcular ? 'Custo fixo calculado com os dados reais' : 'Referência de custo fixo';
    $('dlg-contas-corpo').innerHTML = (cf.motivo ? `<p class="msg erro">${esc(cf.motivo)}</p>` : '')
        + (calcular && cf.pct != null ? `<p class="cf-conta">${moeda(cf.despesasMes)}/mês de despesas fixas ÷ ${moeda(cf.receitasMes)}/mês de faturamento = <b>${pctBR(cf.pct)}</b></p>` : '')
        + `<p class="prc-ref">Despesas pagas com classificação fixa ÷ receitas recebidas (que entram na DRE ou sem classificação), média dos últimos ${meses} meses.
           Despesas variáveis (material, comissão, imposto, frete) ficam de fora: já entram no preço como custo e encargos.
           Receitas sem classificação incluídas: ${moeda(cf.receitasSemClassificacao)}.</p>`
        + (cf.contas.length ? `<table><thead><tr><th>Conta fixa</th><th class="num">Total no período</th></tr></thead><tbody>`
            + cf.contas.map(c => `<tr><td>${esc(c.nome)}</td><td class="num">${moeda(c.total)}</td></tr>`).join('') + '</tbody></table>' : '')
        + (cf.comportamentos.length ? `<p class="prc-ref">Comportamentos encontrados: ${cf.comportamentos.map(esc).join(', ')}</p>` : '')
        + (cf.semComportamento.length ? `<p class="prc-ref">Despesas sem comportamento: ${cf.semComportamento.map(esc).join(', ')}</p>` : '');
    const usavel = calcular && cf.pct != null && cf.pct < 100;
    $('cf-usar').style.display = usavel ? '' : 'none';
    $('cf-usar').disabled = false;
    if (usavel) $('cf-usar').textContent = `Usar ${pctBR(arred2(cf.pct))} como custo fixo`;
    if (!$('dlg-contas').open) { $('cf-msg').textContent = ''; $('dlg-contas').showModal(); }
}
const abrirContas = () => mostrarCustoFixo(precos.referencias.custoFixo, precos.parametros.referenciaMeses, false);

async function calcularCustoFixo() {
    try {
        const r = await api('/precos/custo-fixo');
        mostrarCustoFixo(r, r.meses, true);
    } catch (e) { mostrarErro(e.message); }
}

async function usarCustoFixo() {
    if (!cfCalculado) return;
    $('cf-usar').disabled = true;
    const a = getAuth();
    try {
        const res = await fetch(API_BASE + '/precos/custo-fixo/aplicar', { method: 'POST', body: JSON.stringify({ pctVisto: arred2(cfCalculado.pct) }),
            headers: { 'Authorization': 'Bearer ' + (a ? a.token : ''), 'Content-Type': 'application/json' } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            // números mudaram (ou não dá para calcular): mostra o cálculo novo para confirmar de novo
            if (json.referencia) mostrarCustoFixo(json.referencia, json.referencia.meses, true);
            $('cf-msg').textContent = json.error || `Erro ${res.status}`;
            $('cf-usar').disabled = false;
            return;
        }
        $('dlg-contas').close();
        await carregarPrecos();
    } catch (e) { $('cf-msg').textContent = e.message; $('cf-usar').disabled = false; }
}

// ---------- detalhe, simulador e histórico ----------
async function abrirDetalhePreco(codigo) {
    try {
        detalhePreco = await api(`/precos/formacao/${codigo}`);
        const d = detalhePreco, p = d.preco;
        $('dp-titulo').textContent = d.material.modelo;
        $('dp-avisos').innerHTML = [...p.motivos.map(m => `<span class="prc-motivo" style="display:block">⚠️ ${esc(m)}</span>`),
            ...p.avisos.map(a => `<span class="prc-aviso">🕒 ${esc(a)}</span>`)].join('');
        $('dp-passos').innerHTML = [...d.custo.passos, ...p.passos.slice(1)].map(t => `<li>${esc(t)}</li>`).join('');
        const propria = (precos?.margens.materiais || []).find(x => x.codigo === d.material.codigo)?.pct;
        $('dp-margem-propria').value = propria == null ? '' : String(propria).replace('.', ',');
        $('dp-margem-propria').disabled = !podePreco('precos.editar');
        $('dp-margem-origem').textContent = p.origemMargem ? `em uso: ${pctBR(p.M)} (${ORIGEM[p.origemMargem]})` : '';
        const linha = precos?.materiais.find(m => m.codigo === d.material.codigo);
        $('sim-valor').value = linha && selecao.has(linha.codigo) ? String(selecao.get(linha.codigo)).replace('.', ',') : (p.atual == null ? '' : String(p.atual).replace('.', ','));
        simular();
        const podeDesfazer = podePreco('precos.gravar');
        $('dp-historico').querySelector('tbody').innerHTML = d.historico.length ? d.historico.map(h => `<tr data-id="${h.id}">
            <td>${esc(dataBR(h.gravadoEm))} ${esc(String(h.gravadoEm).slice(11, 16))}${h.desfeitoEm ? '<br><small>desfeito</small>' : ''}</td><td>${esc(h.gravadoPor)}</td>
            <td class="num">${moeda(h.valorAnterior)}</td><td class="num">${moeda(h.valorNovo)}</td>
            <td>${h.ultimo && !h.desfeitoEm && podeDesfazer ? `<button type="button" class="btn-mini hist-desfazer" data-id="${h.id}">Desfazer</button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="5" class="vazio">Nenhuma gravação pela web.</td></tr>';
        $('det-preco').classList.add('aberto'); $('det-fundo').classList.add('aberto');
    } catch (e) { mostrarErro(e.message); }
}

function simular() {
    if (!detalhePreco) return;
    const p = detalhePreco.preco, v = lerNumero($('sim-valor').value);
    const ok = v != null && !Number.isNaN(v) && v > 0 && p.custo != null && p.V != null;
    $('sim-margem').innerHTML = ok ? margemTxt(margemCom(v, p, p.D)) : '—';
    $('sim-margem-pior').innerHTML = ok && detalhePreco.descontoMax != null ? margemTxt(margemCom(v, p, detalhePreco.descontoMax)) : '—';
    $('sim-usar').disabled = !(v > 0 && Math.round(v * 100) / 100 === v);
}

function usarValorSimulado() {
    const v = lerNumero($('sim-valor').value);
    if (!(v > 0) || !detalhePreco) return;
    selecao.set(detalhePreco.material.codigo, Math.round(v * 100) / 100);
    renderPrecos();
}

async function salvarMargemPropria() {
    if (!detalhePreco) return;
    const n = lerNumero($('dp-margem-propria').value);
    if (Number.isNaN(n)) { mostrarErro('Margem inválida.'); return; }
    try {
        await api('/precos/margens', { method: 'PUT', body: JSON.stringify({ escopo: 'material', chave: detalhePreco.material.codigo, margemPct: n }) });
        await carregarPrecos();
        await abrirDetalhePreco(detalhePreco.material.codigo);
    } catch (e) { mostrarErro(e.message); }
}

async function desfazerGravacao(id) {
    try {
        await api(`/precos/desfazer/${id}`, { method: 'POST' });
        const codigo = detalhePreco.material.codigo;
        await carregarPrecos();
        await abrirDetalhePreco(codigo);
    } catch (e) { mostrarErro(e.message); alert(e.message); }
}

// ---------- gravação ----------
function itensSelecionados() {
    return [...selecao].filter(([codigo]) => visiveis.has(codigo))
        .map(([codigo, valorNovo]) => ({ m: precos.materiais.find(x => x.codigo === codigo), valorNovo })).filter(x => x.m);
}
function abrirGravar() {
    const itens = itensSelecionados();
    if (!itens.length) return;
    if (itens.length > MAX_GRAVAR) { mostrarErro(`Grave no máximo ${MAX_GRAVAR} materiais por vez: use os filtros ou desmarque alguns.`); return; }
    $('dlg-gravar-tabela').querySelector('tbody').innerHTML = itens.map(({ m, valorNovo }) => {
        const v = m.atual ? (valorNovo - m.atual) / m.atual * 100 : null;
        return `<tr data-codigo="${m.codigo}"><td>${esc(m.modelo)}</td><td class="num">${moeda(m.valorFixo)} → <b>${moeda(valorNovo)}</b></td>
            <td class="num">${v == null ? '—' : (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</td></tr>`;
    }).join('');
    $('dlg-gravar-titulo').textContent = `Gravar VALOR_FIXO de ${itens.length} material(is) no cadastro`;
    $('dlg-gravar-msg').textContent = '';
    $('dlg-gravar-confirmar').disabled = false;
    $('dlg-gravar').showModal();
}

async function confirmarGravar() {
    const itens = itensSelecionados().map(({ m, valorNovo }) => ({ codigo: m.codigo, valorNovo, valorEsperado: m.valorFixo }));
    $('dlg-gravar-confirmar').disabled = true;
    const a = getAuth();
    try {
        const res = await fetch(API_BASE + '/precos/gravar', { method: 'POST', body: JSON.stringify({ itens }),
            headers: { 'Authorization': 'Bearer ' + (a ? a.token : ''), 'Content-Type': 'application/json' } });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409 && json.conflitos) {
            $('dlg-gravar-msg').textContent = json.error;
            for (const c of json.conflitos) {
                const tr = $('tab-precos').querySelector(`tr[data-codigo="${c.codigo}"]`);
                if (!tr) continue;
                tr.classList.add('conflito');
                tr.children[1].insertAdjacentHTML('beforeend', `<span class="prc-motivo" style="display:block">valor agora: ${moeda(c.atual)}</span>`);
            }
            $('prc-recarregar').style.display = '';
            return;
        }
        if (!res.ok) { $('dlg-gravar-msg').textContent = json.error || `Erro ${res.status}`; $('dlg-gravar-confirmar').disabled = false; return; }
        $('dlg-gravar').close();
        await carregarPrecos();
    } catch (e) { $('dlg-gravar-msg').textContent = e.message; $('dlg-gravar-confirmar').disabled = false; }
}

// ---------- eventos ----------
$('prc-editar').addEventListener('click', abrirPremissas);
$('pp-salvar').addEventListener('click', salvarPremissas);
$('pp-cancelar').addEventListener('click', () => $('dlg-precos-param').close());
$('pp-enc-novo').addEventListener('click', () => $('pp-encargos').querySelector('tbody').insertAdjacentHTML('beforeend', linhaEncargo()));
$('pp-encargos').addEventListener('click', e => {
    const b = e.target.closest('.enc-excluir'); if (!b) return;
    const tr = b.closest('tr'); tr.classList.toggle('excluir'); tr.style.opacity = tr.classList.contains('excluir') ? .4 : 1;
});
$('prc-parametros').addEventListener('click', e => { if (e.target.closest('.prc-ref-contas')) { e.preventDefault(); abrirContas(); } });
$('dlg-contas-fechar').addEventListener('click', () => $('dlg-contas').close());
$('prc-calcular-cf').addEventListener('click', calcularCustoFixo);
$('cf-usar').addEventListener('click', usarCustoFixo);
['prc-busca', 'prc-variacao'].forEach(id => $(id).addEventListener('input', renderPrecos));
['prc-classe', 'prc-com-custo'].forEach(id => $(id).addEventListener('change', renderPrecos));
$('tab-precos').addEventListener('change', e => {
    if (!e.target.matches('input.prc-marcar')) return;
    const codigo = Number(e.target.closest('tr').dataset.codigo), m = precos.materiais.find(x => x.codigo === codigo);
    if (e.target.checked) selecao.set(codigo, m.sugerido); else selecao.delete(codigo);
    renderPrecos();
});
$('tab-precos').addEventListener('click', e => {
    if (e.target.closest('input, button, a')) return;
    const tr = e.target.closest('tr[data-codigo]'); if (tr) abrirDetalhePreco(Number(tr.dataset.codigo));
});
$('prc-gravar').addEventListener('click', abrirGravar);
$('prc-recarregar').addEventListener('click', carregarPrecos);
$('dlg-gravar-confirmar').addEventListener('click', confirmarGravar);
$('dlg-gravar-cancelar').addEventListener('click', () => $('dlg-gravar').close());
$('dp-fechar').addEventListener('click', fecharDetalhe);
$('sim-valor').addEventListener('input', simular);
$('sim-usar').addEventListener('click', usarValorSimulado);
$('dp-margem-propria').addEventListener('change', salvarMargemPropria);
$('dp-historico').addEventListener('click', e => { const b = e.target.closest('.hist-desfazer'); if (b) desfazerGravacao(Number(b.dataset.id)); });
