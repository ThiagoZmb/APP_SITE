// Olho dos resumos: um botão (olho aberto/fechado) que mostra ou esconde os blocos de números-resumo
// do topo de cada tela (elementos marcados com data-resumo). Decisão do dono: a tela SEMPRE inicia com os
// resumos escondidos e a escolha NÃO é guardada entre visitas (nada guardado no navegador).
//
// Como usar numa página:
//   1) <script src="olho_resumos.js?v=..."></script> no <head> (sem defer, antes dos scripts da página);
//   2) data-resumo em cada bloco de resumo (junto com data-perm/data-valor, que continuam mandando);
//   3) (opcional) data-olho-destino no elemento onde o botão deve entrar (filtros/barra do título); sem ele o
//      botão ganha uma barrinha própria logo acima do primeiro resumo;
//   4) quem busca os números só para os resumos chama, no começo da função de carga:
//        if (OlhoResumos.adiar(carregarX)) return;
//      Escondido, a busca é adiada (zero ida e volta ao banco) e roda uma vez quando o usuário mostrar.
// O esconder por padrão vive no tema.css (body:not(.resumos-on) [data-resumo]), por isso não há "flash".
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (raiz && raiz.document) api.iniciar(raiz);
})(typeof window !== 'undefined' ? window : null, function () {
    // ---------- lógica pura (testada no Node) ----------

    // O botão só aparece se ao menos um resumo é permitido ao usuário: sem a classe acesso-oculto (data-perm/data-valor
    // do layout.js) e, no modo atendimento, fora do que é "so-geral".
    function algumResumoPermitido(itens, modoAtendimento) {
        return (itens || []).some(i => i && !i.oculto && !(modoAtendimento && i.soGeral));
    }

    // Estado do olho: começa escondido; guarda as buscas adiadas (sem repetição) e entrega-as ao mostrar.
    function criarEstado() {
        let visivel = false;
        const pendentes = new Set();
        return {
            visivel: () => visivel,
            // true = estava escondido: a função fica anotada e NÃO deve rodar agora; false = pode rodar já
            adiar(fn) {
                if (visivel) return false;
                if (typeof fn === 'function') pendentes.add(fn);
                return true;
            },
            // muda o estado; ao mostrar devolve as buscas adiadas (e esquece), ao esconder devolve []
            definir(v) {
                visivel = !!v;
                if (!visivel) return [];
                const lista = [...pendentes];
                pendentes.clear();
                return lista;
            },
            qtdPendentes: () => pendentes.size
        };
    }

    // ---------- navegador ----------
    const ICO_ABERTO = '<svg class="olho-ico olho-ico-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICO_FECHADO = '<svg class="olho-ico olho-ico-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';

    const estado = criarEstado();
    let botao = null;

    function aplicarNoBotao() {
        if (!botao) return;
        const v = estado.visivel();
        botao.setAttribute('aria-pressed', v ? 'true' : 'false');
        const rotulo = v ? 'Ocultar resumos' : 'Mostrar resumos';
        botao.setAttribute('aria-label', rotulo);
        botao.title = rotulo;
    }

    function definir(v) {
        const lista = estado.definir(v);
        document.body.classList.toggle('resumos-on', estado.visivel());
        aplicarNoBotao();
        // o que foi adiado enquanto escondido roda agora; falha de uma não impede as outras
        for (const fn of lista) {
            try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { /* a própria tela mostra o erro dela */ }
        }
    }

    function resumos() { return [...document.querySelectorAll('[data-resumo]')]; }

    function atualizarVisibilidadeDoBotao() {
        if (!botao) return;
        const itens = resumos().map(el => ({ oculto: el.classList.contains('acesso-oculto'), soGeral: el.classList.contains('so-geral') }));
        const permitido = algumResumoPermitido(itens, document.body.classList.contains('modo-atendimento'));
        botao.hidden = !permitido;
        if (botao.parentElement && botao.parentElement.classList.contains('olho-barra')) botao.parentElement.hidden = !permitido;
    }

    function montar() {
        const alvos = resumos();
        if (!alvos.length) return;
        botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'olho-resumos';
        botao.hidden = true;
        botao.innerHTML = ICO_ABERTO + ICO_FECHADO + '<span class="olho-txt">Resumos</span>';
        botao.addEventListener('click', () => definir(!estado.visivel()));
        const destino = document.querySelector('[data-olho-destino]');
        if (destino) destino.insertBefore(botao, destino.firstChild);
        else {
            const barra = document.createElement('div');
            barra.className = 'olho-barra';
            barra.hidden = true;
            barra.appendChild(botao);
            alvos[0].parentNode.insertBefore(barra, alvos[0]);
        }
        aplicarNoBotao();
        atualizarVisibilidadeDoBotao();
        // as permissões chegam pelo layout.js (classe acesso-oculto) e o modo atendimento liga/desliga no body:
        // reavalia quando uma dessas classes muda
        const obs = new MutationObserver(atualizarVisibilidadeDoBotao);
        alvos.forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class'] }));
        obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    function iniciar(janela) {
        const api = {
            visivel: () => estado.visivel(),
            mostrar: () => definir(true),
            ocultar: () => definir(false),
            alternar: () => definir(!estado.visivel()),
            adiar: fn => estado.adiar(fn)
        };
        janela.OlhoResumos = api;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
        else montar();
    }

    return { algumResumoPermitido, criarEstado, iniciar };
});
