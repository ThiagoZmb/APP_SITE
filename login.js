const API_BASE = 'https://elegance-backend-hrho.onrender.com';

document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value; // NÃO dar trim na senha
  const resDiv = document.getElementById('result');

  // Validação de entrada no cliente (o servidor valida de novo — defesa em camadas)
  if (!username || !password) {
    resDiv.textContent = 'Por favor, preencha todos os campos.';
    resDiv.className = 'result error show';
    return;
  }
  if (username.length > 100 || password.length > 200) {
    resDiv.textContent = 'Dados inválidos.';
    resDiv.className = 'result error show';
    return;
  }

  resDiv.textContent = 'Verificando credenciais...';
  resDiv.className = 'result show';
  showLoading(true);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (res.ok && data.success && data.token) {
      // Guarda token + dados NÃO sensíveis (nunca a senha)
      localStorage.setItem('auth', JSON.stringify({
        token: data.token,
        user: data.user,
        exp: Date.now() + 8 * 60 * 60 * 1000 // 8h, igual ao JWT
      }));
      // Limpa formato antigo (evita conflito com o guard antigo)
      localStorage.removeItem('user');

      resDiv.textContent = 'Login bem-sucedido!';
      resDiv.className = 'result success show';
      mostrarBoasVindas(data.user ? data.user.nome : 'Usuário');
      setTimeout(() => {
        window.location.href = 'https://thiagozmb.github.io/APP_SITE/painel_inicial.html';
      }, 1000);
    } else {
      resDiv.textContent = data.message || 'Usuário ou senha inválidos.';
      resDiv.className = 'result error show';
      showLoading(false);
    }
  } catch (err) {
    resDiv.textContent = 'Erro ao conectar ao servidor. Tente novamente.';
    resDiv.className = 'result error show';
    showLoading(false);
    console.error('Erro no login:', err);
  }
});

function mostrarBoasVindas(userName) {
  const welcomeDiv = document.createElement('div');
  welcomeDiv.id = 'welcome-message';
  welcomeDiv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(10px);';
  const box = document.createElement('div');
  box.style.cssText = 'background:white;padding:40px;border-radius:20px;text-align:center;max-width:500px;box-shadow:0 10px 50px rgba(0,0,0,.5);';
  const h2 = document.createElement('h2');
  h2.textContent = `Bem-vindo, ${userName}!`; // textContent = seguro contra XSS
  h2.style.cssText = 'color:#8B0000;margin-bottom:20px;font-size:32px;';
  const p = document.createElement('p');
  p.textContent = 'Redirecionando para o painel principal...';
  p.style.cssText = 'font-size:18px;color:#333;margin-bottom:30px;';
  const spinner = document.createElement('div');
  spinner.style.cssText = 'width:50px;height:50px;border:5px solid rgba(139,0,0,.2);border-top:5px solid #8B0000;border-radius:50%;margin:0 auto;animation:spin 1s linear infinite;';
  box.appendChild(h2); box.appendChild(p); box.appendChild(spinner);
  welcomeDiv.appendChild(box);
  document.body.appendChild(welcomeDiv);
}

function showLoading(show) {
  const loading = document.querySelector('.loading');
  const btnText = document.querySelector('.btn-text');
  const btn = document.querySelector('.login-btn');
  if (loading) loading.style.display = show ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = show ? 'Entrando...' : 'Entrar';
  if (btn) btn.disabled = show;
}

// Se já existe sessão válida, pula direto para o painel
async function checkExistingLogin() {
  const raw = localStorage.getItem('auth');
  if (!raw) return;
  try {
    const auth = JSON.parse(raw);
    if (!auth.token || Date.now() > auth.exp) { localStorage.removeItem('auth'); return; }
    const res = await fetch(`${API_BASE}/auth/verify`, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if (res.ok) {
      window.location.href = 'https://thiagozmb.github.io/APP_SITE/painel_inicial.html';
    } else {
      localStorage.removeItem('auth');
    }
  } catch { localStorage.removeItem('auth'); }
}

document.addEventListener('DOMContentLoaded', checkExistingLogin);