document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const resDiv = document.getElementById('result');

  if (!username || !password) {
    resDiv.textContent = 'Por favor, preencha todos os campos.';
    resDiv.className = 'result error show';
    return;
  }

  resDiv.textContent = '';
  resDiv.className = 'result';

  showLoading(true);
  resDiv.textContent = 'Verificando credenciais...';
  resDiv.className = 'result show';

  const apiUrl = 'https://elegance-backend-hrho.onrender.com/login';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Erro HTTP: ${res.status}`);
    }

    const data = await res.json();

    if (data.success) {
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      resDiv.textContent = 'Login bem-sucedido!';
      resDiv.className = 'result success show';

      const existingWelcome = document.getElementById('welcome-message');
      if (existingWelcome) existingWelcome.remove();

      const welcomeDiv = document.createElement('div');
      welcomeDiv.id = 'welcome-message';
      welcomeDiv.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.9); display: flex;
        align-items: center; justify-content: center;
        z-index: 10000; backdrop-filter: blur(10px);
        animation: fadeIn 0.5s ease-out;
      `;

      const welcomeContent = document.createElement('div');
      welcomeContent.style.cssText = `
        background: white; padding: 40px; border-radius: 20px;
        text-align: center; max-width: 500px;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5);
      `;

      const welcomeHeading = document.createElement('h2');
      const userName = data.user ? data.user.nome : 'Usuário';
      welcomeHeading.textContent = `Bem-vindo, ${userName}!`;
      welcomeHeading.style.cssText = `
        color: #8B0000; margin-bottom: 20px; font-size: 32px;
      `;

      const welcomeText = document.createElement('p');
      welcomeText.textContent = 'Redirecionando para o painel principal...';
      welcomeText.style.cssText = `
        font-size: 18px; color: #333; margin-bottom: 30px;
      `;

      const spinner = document.createElement('div');
      spinner.style.cssText = `
        width: 50px; height: 50px;
        border: 5px solid rgba(139, 0, 0, 0.2);
        border-top: 5px solid #8B0000;
        border-radius: 50%; margin: 0 auto;
        animation: spin 1s linear infinite;
      `;

      const style = document.createElement('style');
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);

      welcomeContent.appendChild(welcomeHeading);
      welcomeContent.appendChild(welcomeText);
      welcomeContent.appendChild(spinner);
      welcomeDiv.appendChild(welcomeContent);
      document.body.appendChild(welcomeDiv);

      welcomeDiv.offsetHeight;

      setTimeout(() => {
        window.location.href = 'https://thiagozmb.github.io/elegance_app/painel_inicial.html';
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

function showLoading(show) {
  const loading = document.querySelector('.loading');
  const btnText = document.querySelector('.btn-text');
  const btn = document.querySelector('.login-btn');

  if (loading) loading.style.display = show ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = show ? 'Entrando...' : 'Entrar';
  if (btn) btn.disabled = show;
}

function checkExistingLogin() {
  const userData = localStorage.getItem('user');
  if (userData) {
    console.log('Usuário já logado:', JSON.parse(userData));
  }
}

document.addEventListener('DOMContentLoaded', checkExistingLogin);
