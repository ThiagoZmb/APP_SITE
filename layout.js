// ==========================================================================
// ELEGANCE — casca comum das páginas: menu lateral único, avatar e menu móvel.
// Só mexe na navegação; os scripts de cada página continuam como estão.
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
        graficos: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
        estoque: ic('<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
        produtos: ic('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
        financeiro: ic('<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19M6.5 15h3"/>'),
        sair: ic('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>'),
        menu: ic('<path d="M4 6h16M4 12h16M4 18h16"/>'),
        usuarios: ic('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="m16.5 3.5 1.5 1.5 3-3"/>')
    };
    const MENU = [
        { secao: 'Visão geral' },
        { href: 'inicio.html', texto: 'Início', icone: 'inicio' },
        { secao: 'Comercial' },
        { href: 'painel_inicial.html', texto: 'Pedidos e Orçamentos', icone: 'pedidos' },
        { href: 'orcamentos.html', texto: 'Novo orçamento', icone: 'novo' },
        { href: 'clientes.html', texto: 'Clientes', icone: 'clientes' },
        { secao: 'Gestão', interno: true },
        { href: 'estoque.html', texto: 'Estoque', icone: 'estoque', interno: true },
        { href: 'produtos.html', texto: 'Produtos', icone: 'produtos', interno: true },
        { href: 'financeiro.html', texto: 'Financeiro', icone: 'financeiro', interno: true },
        { href: 'usuarios.html', texto: 'Usuários', icone: 'usuarios', exige: 'admin.usuarios' }
    ];

    function auth() {
        try { return JSON.parse(localStorage.getItem('auth') || 'null'); } catch { return null; }
    }
    // Permissões do usuário para a tela se montar (quem decide de verdade é o backend)
    window.Acesso = {
        atual: () => auth()?.acesso || null,
        pode: codigo => (auth()?.acesso?.permissoes || []).includes(codigo)
    };
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function montar() {
        const container = document.querySelector('.container');
        if (!container) return;
        const nav = container.querySelector(':scope > nav, :scope > .sidebar');
        const header = container.querySelector(':scope > header');
        const a = auth();
        const PAGINA_PAI = { 'cliente_analise.html': 'clientes.html', 'graficos_pedidos.html': 'painel_inicial.html' };   // subpáginas acendem o item do menu de origem
        const arquivo = (location.pathname.split('/').pop() || 'inicio.html').toLowerCase();
        const atual = PAGINA_PAI[arquivo] || arquivo;

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
    }

    function desenharMenu(nav, atual) {
        const a = auth();
        const representante = String(a?.user?.cargo || '').toLowerCase().includes('representante');
            nav.innerHTML =
                `<a class="sb-marca" href="inicio.html"><span class="sb-logo">E</span><span><b>Elegance</b><small>Sistema de gestão</small></span></a>` +
                MENU.map(m => {
                    const oculto = (m.interno && representante) || (m.exige && !window.Acesso.pode(m.exige)) ? ' hidden' : '';
                    if (m.secao) return `<div class="sb-secao"${oculto}>${m.secao}</div>`;
                    const ativo = m.href === atual ? ' active' : '';
                    return `<a class="menu-item${ativo}" href="${m.href}"${oculto}${ativo ? ' aria-current="page"' : ''}>${ICONES[m.icone]}<span>${m.texto}</span></a>`;
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
            if (!novo || !d.acesso) return;
            novo.acesso = d.acesso;
            localStorage.setItem('auth', JSON.stringify(novo));
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
    window.abrirPdfAutenticado = async function (url) {
        const aba = window.open('', '_blank');
        const aviso = t => { if (aba) aba.document.body.innerHTML = `<p style="font:15px sans-serif;padding:24px;color:#444">${esc(t)}</p>`; };
        aviso('Gerando PDF…');
        try {
            const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (auth()?.token || '') } });
            if (r.status === 401) {
                if (aba) aba.close();
                localStorage.removeItem('auth');
                location.href = LOGIN_URL;
                return;
            }
            if (!r.ok) throw new Error(r.status === 404 ? 'Pedido não encontrado.' : r.status === 403 ? 'Acesso restrito.' : `Erro ${r.status} no servidor.`);
            const link = URL.createObjectURL(await r.blob());
            if (aba) aba.location.href = link; else location.href = link;
            setTimeout(() => URL.revokeObjectURL(link), 120000);
        } catch (e) {
            if (aba) aviso('Não foi possível gerar o PDF: ' + e.message); else alert('Não foi possível gerar o PDF: ' + e.message);
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
    else montar();
})();
