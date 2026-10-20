// ==========================================================================
// ELEGANCE — painel de ranking (lista com barras + gráfico de rosca),
// no mesmo formato do "Maiores gastos" do financeiro.
//
// Ranking.montar(elemento, {
//   titulo, subtitulo: total => texto,
//   metricas: [{ id, rotulo, valor: item => número, formatar: n => texto, dinheiro: true|false }],
//            (métricas com dinheiro: true somem para quem não tem valores.ver)
//   info: (item, metrica, pct) => texto da linha de baixo,
//   carregar: async () => [{ nome, ... }],
//   aoClicar: item => {}            (opcional)
// })
// ==========================================================================
(function () {
    // cores bem distintas entre si (vinho da marca primeiro); "Outros" sempre em cinza claro
    const CORES = ['#a3213a', '#2f6fdb', '#1f9d55', '#f2a516', '#7b4fd6', '#14a3a3', '#e0527e', '#94a3b8'];
    const COR_OUTROS = '#d5d9e0';
    const TOP_LISTA = 8, TOP_ROSCA = 6;
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pctBR = n => n.toFixed(1).replace('.', ',') + '%';

    let chartPromessa = null;
    function garantirChart() {
        if (window.Chart) return Promise.resolve();
        if (!chartPromessa) chartPromessa = new Promise((ok, erro) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
            s.integrity = 'sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4'; // arquivo adulterado no CDN não roda
            s.crossOrigin = 'anonymous';
            s.onload = ok; s.onerror = erro;
            document.head.appendChild(s);
        });
        return chartPromessa;
    }

    function montar(alvo, cfg) {
        const verValores = !window.Acesso || window.Acesso.pode('valores.ver');
        cfg = { ...cfg, metricas: cfg.metricas.filter(m => verValores || !m.dinheiro) };
        let metrica = cfg.metricas[0];
        let dados = [];
        let grafico = null;
        alvo.classList.add('rk-painel');
        alvo.innerHTML = `
            <div class="rk-topo">
                <div>
                    <div class="painel-titulo rk-titulo">${esc(cfg.titulo)}</div>
                    <div class="rk-sub"></div>
                </div>
                ${cfg.metricas.length > 1 ? `<div class="rk-seg" role="group">${cfg.metricas.map((m, i) =>
                    `<button type="button" data-m="${m.id}" class="${i === 0 ? 'on' : ''}">${esc(m.rotulo)}</button>`).join('')}</div>` : ''}
            </div>
            <div class="rk-corpo">
                <ul class="rk-lista"><li class="rk-vazio">Carregando...</li></ul>
                <div class="rk-rosca"><canvas></canvas><div class="rk-centro"><small>Top ${TOP_ROSCA}</small><b>—</b></div></div>
            </div>`;
        const lista = alvo.querySelector('.rk-lista');
        const sub = alvo.querySelector('.rk-sub');
        const centro = alvo.querySelector('.rk-centro b');

        async function desenhar() {
            const ordenados = [...dados].map(it => ({ it, v: metrica.valor(it) || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
            const total = ordenados.reduce((s, x) => s + x.v, 0);
            sub.innerHTML = cfg.subtitulo ? cfg.subtitulo(total, metrica) : '';
            const top = ordenados.slice(0, TOP_LISTA);
            const maior = top[0]?.v || 1;
            lista.classList.toggle('rk-clicavel', !!cfg.aoClicar);
            lista.innerHTML = top.length ? top.map((x, i) => {
                const pct = total ? x.v / total * 100 : 0;
                const cor = CORES[Math.min(i, CORES.length - 1)];
                return `<li data-i="${i}">
                    <span class="rk-pos" style="background:${cor}">${i + 1}</span>
                    <span class="rk-nome" title="${esc(x.it.nome)}">${esc(x.it.nome)}</span>
                    <span class="rk-val">${esc(metrica.formatar(x.v))}</span>
                    <span class="rk-barra"><span style="width:${(x.v / maior * 100).toFixed(1)}%;background:${cor}"></span></span>
                    <span class="rk-info">${esc(cfg.info ? cfg.info(x.it, metrica, pctBR(pct)) : pctBR(pct))}</span>
                </li>`;
            }).join('') : '<li class="rk-vazio">Nenhum dado nos últimos 12 meses</li>';
            lista._top = top.map(x => x.it);

            const fatias = ordenados.slice(0, TOP_ROSCA);
            const outros = ordenados.slice(TOP_ROSCA).reduce((s, x) => s + x.v, 0);
            centro.textContent = total ? pctBR(fatias.reduce((s, x) => s + x.v, 0) / total * 100).replace(/,\d%$/, '%') : '—';
            try { await garantirChart(); } catch { return; }
            if (grafico) grafico.destroy();
            const rotulos = [...fatias.map(x => x.it.nome), ...(outros > 0 ? ['Outros'] : [])];
            const valores = [...fatias.map(x => x.v), ...(outros > 0 ? [outros] : [])];
            grafico = new Chart(alvo.querySelector('canvas'), {
                type: 'doughnut',
                data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: [...CORES.slice(0, fatias.length), ...(outros > 0 ? [COR_OUTROS] : [])], borderColor: '#fff', borderWidth: 3, hoverOffset: 8 }] },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '68%',
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${metrica.formatar(c.raw)} (${pctBR(c.raw / total * 100)})` } } }
                }
            });
        }

        alvo.querySelectorAll('.rk-seg button').forEach(b => b.addEventListener('click', () => {
            metrica = cfg.metricas.find(m => m.id === b.dataset.m);
            alvo.querySelectorAll('.rk-seg button').forEach(x => x.classList.toggle('on', x === b));
            desenhar();
        }));
        lista.addEventListener('click', e => {
            const li = e.target.closest('li[data-i]');
            if (li && cfg.aoClicar) cfg.aoClicar(lista._top[Number(li.dataset.i)]);
        });

        (async () => {
            try { dados = await cfg.carregar(); }
            catch (e) { lista.innerHTML = `<li class="rk-vazio">⚠️ ${esc(e.message)}</li>`; return; }
            desenhar();
        })();
    }

    window.Ranking = { montar };
})();
