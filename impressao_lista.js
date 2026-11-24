// Impressão de listas "como estão na tela": monta, a partir das linhas que a tela JÁ filtrou, um bloco só de papel
// (cabeçalho com título, data/hora, filtros ativos e total de linhas + tabela + rodapé) e chama window.print().
// Nada é buscado no servidor: quem chama entrega as linhas visíveis. O visual de papel (A4 paisagem, fundo branco,
// cabeçalho da tabela repetido, linha sem quebrar) vive em impressao_lista.css.
//
// Como usar numa página:
//   1) <link rel="stylesheet" href="impressao_lista.css?v=..."> e <script src="impressao_lista.js?v=..." defer></script>;
//   2) ImpressaoLista.imprimir(window, { titulo, geradoEm, filtros: [[rótulo, valor], ...], colunas, linhas, filtradas, limite, total });
//      colunas = [{ id, rotulo, num?, valor? }]  (valor:true = coluna de dinheiro; some sem `podeValores`)
//      linhas  = [{ classe?, celulas: { [id]: html } }]  (html já escapado por quem monta a linha)
//      total   = texto do total ou '' (a tela decide se pode mostrá-lo: valores.ver e olho aberto).
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (raiz && raiz.document) raiz.ImpressaoLista = api;
})(typeof window !== 'undefined' ? window : null, function () {
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Coluna de dinheiro só sai para quem tem valores.ver.
    const colunasVisiveis = (colunas, podeValores) => (colunas || []).filter(c => !c.valor || podeValores);

    // "Período: Últimos 6 meses · Cliente: X · Busca: 123"; filtro vazio não entra.
    function textoFiltros(pares) {
        const ativos = (pares || []).filter(p => p && p[1] !== null && p[1] !== undefined && String(p[1]).trim() !== '');
        return ativos.length ? ativos.map(([r, v]) => `${r}: ${String(v).trim()}`).join(' · ') : 'Nenhum filtro ativo';
    }

    // Quantas linhas saem e se a impressão é parcial (a tela corta a lista num teto; o papel imprime o mesmo corte).
    function resumoQuantidade(impressas, filtradas) {
        const n = Number(impressas) || 0, f = Math.max(Number(filtradas) || 0, n);
        const nf = v => v.toLocaleString('pt-BR');
        return f > n
            ? { parcial: true, texto: `${nf(n)} de ${nf(f)} registro(s) — impressão PARCIAL: a tela mostra só os ${nf(n)} primeiros; use a busca ou o período para refinar.` }
            : { parcial: false, texto: `${nf(n)} registro(s)` };
    }

    // Nome sugerido do arquivo PDF: "Orcamentos_<cliente>_<AAAA-MM-DD>" (sem acento nem caractere proibido; cliente vazio some).
    function nomeArquivo(prefixo, cliente, dataISO) {
        const limpa = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 50).replace(/_+$/, '');
        return [limpa(prefixo) || 'Lista', limpa(cliente), limpa(dataISO)].filter(Boolean).join('_');
    }

    function htmlDocumento(cfg) {
        const c = cfg || {};
        const colunas = colunasVisiveis(c.colunas, c.podeValores !== false);
        const linhas = c.linhas || [];
        const qtd = resumoQuantidade(linhas.length, c.filtradas);
        const cab = colunas.map(col => `<th${col.num ? ' class="num"' : ''}>${esc(col.rotulo)}</th>`).join('');
        const corpo = linhas.map(l => `<tr${l.classe ? ` class="${esc(l.classe)}"` : ''}>${colunas.map(col => `<td${col.num ? ' class="num"' : ''}>${(l.celulas || {})[col.id] ?? ''}</td>`).join('')}</tr>`).join('')
            || `<tr><td colspan="${colunas.length || 1}" class="vazio">Nenhum registro na tela</td></tr>`;
        return `<div class="imp-cab">
            <h1 class="imp-titulo">${esc(c.titulo)}</h1>
            <div class="imp-meta"><span>Gerado em ${esc(c.geradoEm)}</span><span class="imp-qtd${qtd.parcial ? ' imp-parcial' : ''}">${esc(qtd.texto)}</span>${c.total ? `<span>Total: <b>${esc(c.total)}</b></span>` : ''}</div>
            <p class="imp-filtros">${esc(textoFiltros(c.filtros))}</p>
        </div>
        <table class="imp-tabela"><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
        <div class="imp-rodape">Elegance · ${esc(c.titulo)} · ${esc(c.geradoEm)}</div>`;
    }

    // Põe o bloco no fim do body, esconde o resto da página só para a impressão (classe no body) e limpa ao terminar.
    function imprimir(win, cfg) {
        const doc = win.document;
        const antigo = doc.getElementById('area-impressao');
        if (antigo) antigo.remove();
        const area = doc.createElement('div');
        area.id = 'area-impressao';
        area.innerHTML = htmlDocumento(cfg);
        doc.body.appendChild(area);
        doc.body.classList.add('imprimindo-lista');
        const tituloAntes = doc.title;
        // vira o nome do arquivo ao "salvar como PDF": `nomeArquivo` (de nomeArquivo()) quando a tela dá um; senão título + data/hora
        doc.title = (cfg && cfg.nomeArquivo) || `${(cfg && cfg.titulo) || 'Lista'} - ${(cfg && cfg.geradoEm) || ''}`.replace(/[\\/:*?"<>|]+/g, '-').trim();
        const limpar = () => {
            win.removeEventListener('afterprint', limpar);
            doc.body.classList.remove('imprimindo-lista');
            doc.title = tituloAntes;
            area.remove();
        };
        win.addEventListener('afterprint', limpar);
        win.print();
        return area;
    }

    return { esc, colunasVisiveis, textoFiltros, resumoQuantidade, nomeArquivo, htmlDocumento, imprimir };
});
