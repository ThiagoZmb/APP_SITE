// ==========================================================================
// ELEGANCE — casca comum das páginas: menu lateral único, avatar e menu móvel.
// Também aplica as permissões na tela: menu, "Sem acesso", data-perm e data-valor.
// Quem decide de verdade é o backend; aqui a tela só deixa de mostrar o que não vale.
// ==========================================================================
(function () {
    const LOGIN_URL = 'https://thiagozmb.github.io/APP_SITE/login.html';
    const API = 'https://elegance-backend-hrho.onrender.com';
    const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const ICONES = {
        inicio: ic('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
        pedidos: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
        novo: ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>'),
        clientes: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5"/>'),
        entregas: ic('<path d="M2 6a1 1 0 0 1 1-1h11v11H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
        graficos: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
        estoque: ic('<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
        produtos: ic('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
        financeiro: ic('<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19M6.5 15h3"/>'),
        sair: ic('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>'),
        menu: ic('<path d="M4 6h16M4 12h16M4 18h16"/>'),
        usuarios: ic('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="m16.5 3.5 1.5 1.5 3-3"/>'),
        fornecedores: ic('<path d="M3 21V9l6 4V9l6 4V4h6v17z"/><path d="M7 17h2M12 17h2M17 17h1"/>'),
        tintas: ic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
        funcionarios: ic('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 8h4M17 12h4"/>'),
        corte: ic('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
        gestao: ic('<path d="M3 20h18"/><rect x="5" y="11" width="3.5" height="9"/><rect x="10.25" y="6" width="3.5" height="14"/><rect x="15.5" y="3" width="3.5" height="17"/>'),
        precos: ic('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>')
    };
    const MENU = [
        { secao: 'Visão geral' },
        { href: 'inicio.html', texto: 'Início', icone: 'inicio' },
        { secao: 'Comercial' },
        { href: 'painel_inicial.html', texto: 'Pedidos e Orçamentos', icone: 'pedidos' },
        { href: 'orcamentos.html', texto: 'Novo orçamento', icone: 'novo', sub: true },
        { href: 'corte.html', texto: 'Plano de corte', icone: 'corte', sub: true },   // subitem de Pedidos (corte de perfis por pedido e retalhos)
        { href: 'corte_vidros.html', texto: 'Corte de vidros', icone: 'corte', sub: true },   // subitem de Pedidos (corte de vidros por pedido, chapas e retalhos)
        { href: 'clientes.html', texto: 'Clientes', icone: 'clientes' },
        { href: 'entregas.html', texto: 'Entregas', icone: 'entregas' },
        { href: 'minhas_entregas.html', texto: 'Minhas entregas', icone: 'entregas', sub: true },   // subitem de Entregas (tela do motorista)
        { secao: 'Gestão' },
        { href: 'estoque.html', texto: 'Estoque', icone: 'estoque' },
        { href: 'custos.html', texto: 'Custos e preços', icone: 'precos', sub: true },   // subitem do Estoque (o custo vem das compras)
        { href: 'tintas.html', texto: 'Tintas', icone: 'tintas', sub: true },   // subitem do Estoque (cadastro de tintas e insumos de pintura)
        { href: 'produtos.html', texto: 'Produtos', icone: 'produtos' },
        { href: 'fornecedores.html', texto: 'Fornecedores', icone: 'fornecedores' },
        { href: 'funcionarios.html', texto: 'Funcionários', icone: 'funcionarios' },
        { href: 'financeiro.html', texto: 'Financeiro', icone: 'financeiro' },
        { href: 'notas_fiscais.html', texto: 'Notas fiscais', icone: 'financeiro', sub: true },   // subitem do Financeiro (notas de entrada e saída, só cabeçalho)
        { href: 'gestao.html', texto: 'Central de Gestão', icone: 'gestao', sub: true },   // subitem do Financeiro (metas, caixa e orçamento)
        { href: 'usuarios.html', texto: 'Usuários', icone: 'usuarios' }
    ];
    // ----- Modo atendimento: o cliente acompanha o orçamento na tela, então o vendedor não mostra dados gerais da empresa -----
    // Quem tem 'atendimento.modo' começa cada sessão com o modo ligado e pode desligar/ligar a qualquer momento (botão no topo).
    // É um recurso de tela (privacidade na frente do cliente), não uma barreira de segurança: quem decide o acesso continua sendo o servidor.
    const ATEND_CHAVE = 'atendimento', ATEND_CLIENTE = 'atendimento_cliente';
    const ATEND_BLOQUEADAS = ['inicio.html', 'graficos_pedidos.html', 'financeiro.html', 'custos.html', 'gestao.html'];
    const ss = { ler: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
        gravar: (k, v) => { try { if (v === null || v === '') sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* sem armazenamento: vale só nesta página */ } } };
    const atendTem = acesso => (acesso?.permissoes || []).includes('atendimento.modo');
    const atendAtivoPara = acesso => atendTem(acesso) && ss.ler(ATEND_CHAVE) !== '0';
    const atendBloqueia = arquivo => ATEND_BLOQUEADAS.includes(String(arquivo || '').toLowerCase());
    window.Atendimento = {
        disponivel: () => atendTem(auth()?.acesso),
        ativo: () => atendAtivoPara(auth()?.acesso),
        cliente: () => ss.ler(ATEND_CLIENTE) || '',
        definirCliente: nome => ss.gravar(ATEND_CLIENTE, String(nome || '').trim()),
        paginasBloqueadas: ATEND_BLOQUEADAS.slice(),
        alternar: () => { ss.gravar(ATEND_CHAVE, atendAtivoPara(auth()?.acesso) ? '0' : '1'); }
    };
    // página → permissões exigidas (todas; um item { algum: [...] } é atendido por qualquer uma da lista). A ordem é a da "primeira página permitida" depois do login.
    // Página nova: acrescentar aqui e no MENU.
    const PAGINAS = {
        'inicio.html': ['paineis.ver'],
        'painel_inicial.html': ['pedidos.ver'],
        'graficos_pedidos.html': ['pedidos.ver'],
        'clientes.html': ['clientes.ver'],
        'cliente_analise.html': ['clientes.ver', 'valores.ver'],
        'entregas.html': ['entregas.ver'],
        'estoque.html': ['estoque.ver'],
        'movimentacao_estoque.html': ['estoque.ver', { algum: ['estoque.movimentar', 'estoque.desfazer', 'estoque.ajustar'] }],
        'produtos.html': ['produtos.ver'],
        'fornecedores.html': ['fornecedores.ver'],
        'notas_fiscais.html': ['notas.ver'],
        'tintas.html': ['tintas.ver'],
        'funcionarios.html': ['funcionarios.ver'],
        'orcamentos.html': ['orcamentos.criar', 'valores.ver'],
        'custos.html': ['precos.ver', 'valores.ver'],
        'financeiro.html': ['financeiro.ver', 'valores.ver'],
        'gestao.html': ['gestao.ver', 'valores.ver'],
        'corte.html': ['corte.ver'],
        'corte_vidros.html': ['corte.ver'],
        'usuarios.html': ['admin.usuarios'],
        'minhas_entregas.html': ['entregas.baixar']   // por último: quem tem só entregas.baixar (motorista) cai aqui; os demais mantêm a primeira página de sempre
    };
    window.ACESSO_PAGINAS = PAGINAS;

    function auth() {
        try { return JSON.parse(localStorage.getItem('auth') || 'null'); } catch { return null; }
    }
    const arquivoAtual = () => (location.pathname.split('/').pop() || 'inicio.html').toLowerCase();
    // pode('a') ou pode('a b'): todos os códigos exigidos
    const pode = codigos => {
        const tem = auth()?.acesso?.permissoes || [];
        return String(codigos || '').split(/\s+/).filter(Boolean).every(c => tem.includes(c));
    };
    const atendeItem = (item, tem) => typeof item === 'string' ? tem.includes(item) : (item?.algum || []).some(c => tem.includes(c));
    // primeira página do mapa que o acesso abre (graficos_pedidos só redireciona); null = nenhuma
    const primeiraPaginaDe = acesso => Object.keys(PAGINAS).find(p => p !== 'graficos_pedidos.html'
        && !(atendAtivoPara(acesso) && atendBloqueia(p))
        && PAGINAS[p].every(item => atendeItem(item, acesso?.permissoes || []))) || null;
    const podePagina = arquivo => {
        const exige = PAGINAS[String(arquivo || '').toLowerCase()];
        if (atendAtivoPara(auth()?.acesso) && atendBloqueia(arquivo)) return false;
        return !exige || exige.every(item => atendeItem(item, auth()?.acesso?.permissoes || []));
    };
    // Permissões do usuário para a tela se montar (quem decide de verdade é o backend)
    window.Acesso = {
        atual: () => auth()?.acesso || null,
        pode,
        podePagina,
        primeiraPagina: () => primeiraPaginaDe(auth()?.acesso),
        primeiraPaginaDe,
        paginaLiberada: () => podePagina(arquivoAtual()),
        aplicar
    };

    // ----- elementos: data-perm="a b", data-valor, data-sem-valor e links para páginas proibidas -----
    const OCULTO = 'acesso-oculto';
    function aplicar(raiz = document) {
        if (!raiz.querySelectorAll) return;
        const SEL = '[data-perm], [data-valor], [data-sem-valor], a[href]';
        const els = [...raiz.querySelectorAll(SEL)];
        if (raiz.matches?.(SEL)) els.push(raiz);
        const verValores = pode('valores.ver');
        for (const el of els) {
            if (el.closest('nav.sidebar')) continue; // o menu se desenha sozinho
            let ok = true;
            if (el.hasAttribute('data-perm')) ok = pode(el.getAttribute('data-perm'));
            if (ok && el.hasAttribute('data-valor')) ok = verValores;
            if (ok && el.hasAttribute('data-sem-valor')) ok = !verValores; // texto alternativo para quem não vê valores
            if (ok && el.tagName === 'A') {
                const alvo = (el.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop().toLowerCase();
                if (PAGINAS[alvo]) ok = podePagina(alvo);
            }
            el.classList.toggle(OCULTO, !ok);
        }
    }
    function observar() {
        const css = document.createElement('style');
        css.textContent = `.${OCULTO} { display: none !important; }
            body.modo-atendimento .so-geral { display: none !important; }
            .btn-atendimento { margin-left: auto; margin-right: 14px; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; border: 1px solid #fff; background: #fff; color: #c62828; font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap; }
            .btn-atendimento svg { width: 18px; height: 18px; }
            .btn-atendimento.ligado { color: #1b7a3a; }
            .btn-atendimento.flutuante { position: fixed; right: 16px; bottom: 16px; z-index: 60; margin: 0; box-shadow: 0 2px 10px rgba(0,0,0,.25); border-color: #ddd; }
            @media (max-width: 768px) { .btn-atendimento span { display: none; } .btn-atendimento { margin-right: 8px; } }
            #sem-acesso-pagina { text-align: center; padding: 80px 20px; color: var(--text-light, #666); }
            #sem-acesso-pagina h2 { color: var(--text-dark, #222); margin-bottom: 8px; }
            #sem-acesso-pagina a { display: inline-block; margin-top: 18px; color: var(--primary-color, #8B0000); font-weight: 700; }`;
        document.head.appendChild(css);
        aplicar();
        new MutationObserver(lista => {
            for (const m of lista) for (const n of m.addedNodes) if (n.nodeType === 1) aplicar(n);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ----- página sem permissão: esconde o conteúdo e oferece a primeira página permitida -----
    function semAcesso() {
        const main = document.querySelector('main');
        if (!main || document.getElementById('sem-acesso-pagina')) return;
        [...main.children].forEach(el => el.classList.add(OCULTO));
        const destino = window.Acesso.primeiraPagina();
        const bloco = document.createElement('section');
        bloco.id = 'sem-acesso-pagina';
        const pelaModo = atendAtivoPara(auth()?.acesso) && atendBloqueia(arquivoAtual());
        bloco.innerHTML = (pelaModo ? '<h2>Modo atendimento ligado</h2><p>Esta tela mostra dados gerais da empresa e fica escondida enquanto há cliente acompanhando.</p><button type="button" class="btn btn-primary" id="atend-desligar">Desligar modo atendimento</button><br>' : '<h2>Sem acesso</h2><p>Seu usuário não tem permissão para esta página.</p>') +
            (destino ? `<a href="${destino}">Ir para o início</a>` : '<a href="login.html" class="sair">Sair</a>');
        bloco.querySelector('#atend-desligar')?.addEventListener('click', () => { window.Atendimento.alternar(); location.reload(); });
        bloco.querySelector('.sair')?.addEventListener('click', () => localStorage.removeItem('auth'));
        main.appendChild(bloco);
    }
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function montar() {
        const container = document.querySelector('.container');
        if (!container) return;
        const nav = container.querySelector(':scope > nav, :scope > .sidebar');
        const header = container.querySelector(':scope > header');
        const a = auth();
        const PAGINA_PAI = { 'cliente_analise.html': 'clientes.html', 'graficos_pedidos.html': 'painel_inicial.html', 'movimentacao_estoque.html': 'estoque.html' };   // subpáginas acendem o item do menu de origem
        const arquivo = arquivoAtual();
        const atual = PAGINA_PAI[arquivo] || arquivo;
        observar();
        document.body.classList.toggle('modo-atendimento', window.Atendimento.ativo());
        if (!podePagina(arquivo)) semAcesso();

        // ----- menu lateral -----
        if (nav) {
            nav.removeAttribute('style');
            nav.classList.add('sidebar');
            desenharMenu(nav, atual);
            const fundo = document.createElement('div');
            fundo.className = 'sb-fundo';
            fundo.addEventListener('click', () => document.body.classList.remove('menu-aberto'));
            container.appendChild(fundo);
            atualizarAcesso(nav, atual);
        }
        montarTopo(container, header, a);
        montarBotaoAtendimento(container, header);
    }

    function montarBotaoAtendimento(container, header) {
        if (!window.Atendimento.disponivel() || document.getElementById('btn-atendimento')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'btn-atendimento';
        const ligado = window.Atendimento.ativo();
        b.className = 'btn-atendimento' + (ligado ? ' ligado' : '');
        b.setAttribute('aria-pressed', String(ligado));
        b.title = ligado ? 'Há cliente acompanhando: dados gerais da empresa estão escondidos. Clique para desligar.' : 'Sem cliente acompanhando. Clique para esconder os dados gerais da empresa.';
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ligado ? '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>') + '</svg><span>Modo atendimento: ' + (ligado ? 'ligado' : 'desligado') + '</span>';
        b.addEventListener('click', () => {
            window.Atendimento.alternar();
            // ligando numa tela que o modo esconde, vai para a primeira tela permitida
            if (window.Atendimento.ativo() && !podePagina(arquivoAtual())) location.href = window.Acesso.primeiraPagina() || 'login.html';
            else location.reload();
        });
        const perfil = header && header.querySelector('.user-profile');
        if (perfil) perfil.before(b); else { b.classList.add('flutuante'); document.body.appendChild(b); }
    }

    function desenharMenu(nav, atual) {
            // seção aparece só se tiver ao menos uma página liberada até a próxima seção
            const visivel = MENU.map(m => m.href ? podePagina(m.href) : null);
            MENU.forEach((m, i) => {
                if (!m.secao) return;
                const fim = MENU.findIndex((x, j) => j > i && x.secao);
                visivel[i] = visivel.slice(i + 1, fim < 0 ? MENU.length : fim).some(Boolean);
            });
            nav.innerHTML =
                `<a class="sb-marca" href="${window.Acesso.primeiraPagina() || 'inicio.html'}"><span class="sb-logo">E</span><span><b>Elegance</b><small>Sistema de gestão</small></span></a>` +
                MENU.map((m, i) => {
                    const oculto = visivel[i] ? '' : ' hidden';
                    if (m.secao) return `<div class="sb-secao"${oculto}>${m.secao}</div>`;
                    const ativo = m.href === atual ? ' active' : '';
                    return `<a class="menu-item${m.sub ? ' sub' : ''}${ativo}" href="${m.href}"${oculto}${ativo ? ' aria-current="page"' : ''}>${ICONES[m.icone]}<span>${m.texto}</span></a>`;
                }).join('') +
                `<div class="sb-rodape"><button type="button" class="sb-sair">${ICONES.sair}<span>Sair</span></button></div>`;
            nav.querySelector('.sb-sair').addEventListener('click', () => {
                localStorage.removeItem('auth');
                location.href = LOGIN_URL;
            });
    }

    // Atualiza perfil/permissões/estados pelo /auth/verify (sessões antigas e mudanças feitas pelo administrador)
    async function atualizarAcesso(nav, atual) {
        const a = auth();
        if (!a?.token) return;
        try {
            const r = await fetch(API + '/auth/verify', { headers: { Authorization: 'Bearer ' + a.token } });
            if (r.status === 401) { localStorage.removeItem('auth'); location.href = LOGIN_URL; return; }
            if (!r.ok) return;
            const d = await r.json();
            const novo = auth();
            if (!novo || !d.acesso || novo.token !== a.token) return;
            const chave = x => JSON.stringify([[...(x?.permissoes || [])].sort(), [...(x?.estados || [])].sort()]);
            const mudou = chave(novo.acesso) !== chave(d.acesso);
            novo.acesso = d.acesso;
            localStorage.setItem('auth', JSON.stringify(novo));
            // a página já se montou com o acesso antigo: recarrega uma vez para refletir o novo
            if (mudou) { location.reload(); return; }
            desenharMenu(nav, atual);
            document.dispatchEvent(new CustomEvent('acesso-atualizado', { detail: d.acesso }));
        } catch { /* sem rede: mantém o que já tem */ }
    }

    function montarTopo(container, header, a) {

        // ----- topo: botão do menu móvel + avatar -----
        if (header) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-menu-mobile';
            btn.setAttribute('aria-label', 'Abrir menu');
            btn.innerHTML = ICONES.menu;
            btn.addEventListener('click', () => document.body.classList.toggle('menu-aberto'));
            header.prepend(btn);
            const perfil = header.querySelector('.user-profile');
            if (perfil && !perfil.querySelector('.user-avatar')) {
                const av = document.createElement('div');
                av.className = 'user-avatar';
                av.textContent = (a?.user?.nome || 'E').charAt(0).toUpperCase();
                perfil.prepend(av);
            }
            if (perfil && !perfil.querySelector('.user-cargo') && a?.user?.cargo) {
                const nome = perfil.querySelector('#user-name');
                if (nome) {
                    const info = document.createElement('div');
                    info.className = 'user-info';
                    nome.replaceWith(info);
                    info.appendChild(nome);
                    info.insertAdjacentHTML('beforeend', `<span class="user-cargo">${esc(a.user.cargo)}</span>`);
                }
            }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('menu-aberto'); });

        // texto cortado com "…" nas listas: mostra o conteúdo inteiro ao passar o mouse
        document.addEventListener('mouseover', e => {
            const el = e.target.closest('.nome-mov .nm, tbody td, .obs-linha, .prod-forn, .prod-nome, .lista .meio b, .ranking .nome');
            if (!el || el.hasAttribute('title')) return;
            if (el.scrollWidth > el.clientWidth + 1) el.title = el.textContent.replace(/\s+/g, ' ').trim();
        });
    }

    // Abre um PDF do backend sem token na URL: baixa com o cabeçalho Authorization e mostra numa aba nova.
    // A aba é aberta já no clique (depois de um await o navegador bloquearia o pop-up).
    // ----- gravar o PDF em "C:\Programa Elegance\<pasta>\<nº>_<cliente>.PDF", como o VB -----
    // O navegador não escreve em qualquer lugar do disco: a pasta "Programa Elegance" é escolhida UMA vez (Chrome/Edge), o
    // navegador guarda a escolha e, depois, cada PDF aberto é gravado direto na subpasta certa (Pedidos(PDF), Orçamentos(PDF), Produção).
    const PastaPdf = (() => {
        const abrirDb = () => new Promise((ok, falha) => {
            const r = indexedDB.open('elegance_pdf', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('pastas');
            r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
        });
        const ler = async () => { const db = await abrirDb(); return new Promise((ok, falha) => { const q = db.transaction('pastas').objectStore('pastas').get('raiz'); q.onsuccess = () => ok(q.result || null); q.onerror = () => falha(q.error); }); };
        const guardar = async h => { const db = await abrirDb(); return new Promise((ok, falha) => { const t = db.transaction('pastas', 'readwrite'); t.objectStore('pastas').put(h, 'raiz'); t.oncomplete = ok; t.onerror = () => falha(t.error); }); };
        const suportado = () => typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
        // pasta já escolhida com permissão de gravação (pede a permissão ao usuário se o navegador a esqueceu; precisa de um clique recente)
        async function pronta() {
            if (!suportado()) return null;
            const h = await ler();
            if (!h) return null;
            const opc = { mode: 'readwrite' };
            if ((await h.queryPermission(opc)) === 'granted') return h;
            return (await h.requestPermission(opc)) === 'granted' ? h : null;
        }
        async function escolher() {
            const h = await window.showDirectoryPicker({ id: 'programa-elegance', mode: 'readwrite' });
            await guardar(h);
            return h;
        }
        async function salvar(raiz, pasta, nome, blob) {
            const dir = await raiz.getDirectoryHandle(pasta, { create: true });
            const arq = await dir.getFileHandle(nome, { create: true });
            const w = await arq.createWritable();
            await w.write(blob); await w.close();
            return `${raiz.name}\\${pasta}\\${nome}`;
        }
        return { suportado, pronta, escolher, salvar };
    })();

    // aviso discreto no canto da tela (some sozinho, ou fica até o clique quando traz botão)
    function avisoCanto(texto, { botao, aoClicar, tipo } = {}) {
        let el = document.getElementById('aviso-pdf');
        if (!el) {
            el = document.createElement('div'); el.id = 'aviso-pdf';
            el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;max-width:360px;padding:12px 14px;border-radius:12px;font:13px/1.45 sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center';
            document.body.appendChild(el);
        }
        el.style.background = tipo === 'erro' ? '#a52a2a' : '#1c2230';
        el.textContent = '';
        const t = document.createElement('span'); t.textContent = texto; el.appendChild(t);
        const fechar = () => { el.remove(); };
        if (botao) {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = botao;
            b.style.cssText = 'flex:none;padding:6px 10px;border:none;border-radius:8px;background:#fff;color:#1c2230;font-weight:700;cursor:pointer';
            b.addEventListener('click', async () => { try { await aoClicar(); } finally { fechar(); } });
            el.appendChild(b);
        } else setTimeout(fechar, 7000);
    }

    window.abrirPdfAutenticado = async function (url) {
        const aba = window.open('', '_blank');
        const aviso = t => { if (aba) aba.document.body.innerHTML = `<p style="font:15px sans-serif;padding:24px;color:#444">${esc(t)}</p>`; };
        aviso('Gerando PDF…');
        // a permissão de gravar na pasta só pode ser pedida enquanto o clique é recente: antes de esperar o servidor
        let raiz = null;
        try { raiz = await PastaPdf.pronta(); } catch { raiz = null; }
        try {
            const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (auth()?.token || '') } });
            if (r.status === 401) {
                if (aba) aba.close();
                localStorage.removeItem('auth');
                location.href = LOGIN_URL;
                return;
            }
            if (!r.ok) {
                // a rota de vidros explica o 404 ("Este pedido não tem vidros."); as demais caem nos textos padrão
                let msg = ''; try { msg = (await r.json()).error || ''; } catch { /* sem corpo JSON */ }
                throw new Error(r.status === 404 && /vidros/i.test(msg) ? msg : r.status === 404 ? 'Pedido não encontrado.' : r.status === 403 ? 'Acesso restrito.' : `Erro ${r.status} no servidor.`);
            }
            const pdf = await r.blob();
            const link = URL.createObjectURL(pdf);
            if (aba) aba.location.href = link; else location.href = link;
            setTimeout(() => URL.revokeObjectURL(link), 120000);
            // nome e pasta vêm do servidor (mesma regra do VB)
            const nome = decodeURIComponent(r.headers.get('X-Pdf-Nome') || ''), pasta = decodeURIComponent(r.headers.get('X-Pdf-Pasta') || '');
            if (nome && pasta && PastaPdf.suportado()) {
                if (raiz) {
                    try { avisoCanto('PDF salvo em ' + await PastaPdf.salvar(raiz, pasta, nome, pdf)); }
                    catch (e) { avisoCanto('O PDF abriu, mas não foi possível salvá-lo na pasta: ' + e.message, { tipo: 'erro' }); }
                } else {
                    avisoCanto(`Quer salvar os PDFs em "Programa Elegance\\${pasta}"? Escolha a pasta C:\\Programa Elegance (uma vez só).`, {
                        botao: 'Escolher pasta',
                        aoClicar: async () => {
                            try { const h = await PastaPdf.escolher(); avisoCanto('PDF salvo em ' + await PastaPdf.salvar(h, pasta, nome, pdf)); }
                            catch (e) { if (e.name !== 'AbortError') avisoCanto('Não foi possível salvar: ' + e.message, { tipo: 'erro' }); }
                        }
                    });
                }
            }
        } catch (e) {
            if (aba) aviso('Não foi possível gerar o PDF: ' + e.message); else alert('Não foi possível gerar o PDF: ' + e.message);
        }
    };

    // ----- indicação de processamento: vale para qualquer página e qualquer botão, sem mexer nas páginas -----
    // Toda chamada ao servidor (fetch) é contada. Com espera > 0,3 s aparece a barra no topo; o elemento clicado
    // logo antes do pedido fica "ocupado" (indicador girando, desabilitado) até a resposta; espera > 5 s mostra
    // o aviso de servidor iniciando (o Render "dorme" e pode levar até 1 minuto para acordar).
    function iniciarIndicadores() {
        const ATRASO_BARRA = 300, ATRASO_AVISO = 5000, JANELA_CLIQUE = 400;
        const css = document.createElement('style');
        css.textContent = `
            #carregando-global { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 9999; overflow: hidden; pointer-events: none; display: none; }
            #carregando-global.ativo { display: block; }
            #carregando-global::before { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; background: var(--primary-color, #8B0000); animation: carregando-barra 1.1s ease-in-out infinite; }
            @keyframes carregando-barra { from { left: -40%; } to { left: 100%; } }
            .processando { cursor: progress !important; }
            button.processando, a.processando { position: relative; opacity: .75; }
            button.processando::after, a.processando::after { content: ''; display: inline-block; width: 12px; height: 12px; margin-left: 8px; vertical-align: -2px;
                border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: carregando-giro .7s linear infinite; }
            tr.processando td { opacity: .6; }
            @keyframes carregando-giro { to { transform: rotate(360deg); } }
            #aviso-servidor { position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; z-index: 9998; background: #2c3e50; color: #fff;
                padding: 12px 18px; border-radius: 12px; font: 600 14px 'Segoe UI', sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,.25); max-width: calc(100vw - 32px); }`;
        document.head.appendChild(css);
        const barra = document.createElement('div');
        barra.id = 'carregando-global';
        barra.setAttribute('role', 'progressbar'); barra.setAttribute('aria-label', 'Carregando');
        document.body.appendChild(barra);
        let aviso = null;

        let emAndamento = 0, timerBarra = null, timerAviso = null;
        let ultimoClique = null, quandoClique = 0;
        document.addEventListener('click', e => {
            ultimoClique = e.target.closest('button, a[href], [role="button"], tr[data-i], tr[data-codigo], tr[data-numero]');
            quandoClique = Date.now();
        }, true);

        const ocupados = new Map(); // elemento → { pedidos, desabilitadoAntes }
        function ocupar(el) {
            const o = ocupados.get(el) || { pedidos: 0, desabilitadoAntes: el.disabled };
            o.pedidos++;
            ocupados.set(el, o);
            el.classList.add('processando'); el.setAttribute('aria-busy', 'true');
            if ('disabled' in el) el.disabled = true;
        }
        function liberar(el) {
            const o = ocupados.get(el); if (!o) return;
            if (--o.pedidos > 0) return;
            ocupados.delete(el);
            el.classList.remove('processando'); el.removeAttribute('aria-busy');
            if ('disabled' in el) el.disabled = o.desabilitadoAntes;
        }
        function comecou() {
            if (emAndamento++ > 0) return;
            timerBarra = setTimeout(() => barra.classList.add('ativo'), ATRASO_BARRA);
            timerAviso = setTimeout(() => {
                aviso = document.createElement('div');
                aviso.id = 'aviso-servidor'; aviso.setAttribute('role', 'status');
                aviso.textContent = 'O servidor está iniciando, isso pode levar até 1 minuto…';
                document.body.appendChild(aviso);
            }, ATRASO_AVISO);
        }
        function terminou() {
            if (--emAndamento > 0) return;
            clearTimeout(timerBarra); clearTimeout(timerAviso);
            barra.classList.remove('ativo');
            aviso?.remove(); aviso = null;
        }
        const fetchOriginal = window.fetch.bind(window);
        window.fetch = (...args) => {
            const el = ultimoClique && Date.now() - quandoClique < JANELA_CLIQUE && ultimoClique.isConnected ? ultimoClique : null;
            comecou();
            if (el) ocupar(el);
            const p = fetchOriginal(...args);
            p.finally(() => { terminou(); if (el) liberar(el); }).catch(() => {});
            return p;
        };
    }
    iniciarIndicadores();

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
    else montar();
})();
