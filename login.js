document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const resDiv = document.getElementById('result');
  
  // Validação básica 
  if (!username || !password) {
    resDiv.textContent = 'Por favor, preencha todos os campos.';
    resDiv.className = 'result error show';
    return;
  }
  
  // Resetar mensagens de erro
  resDiv.textContent = '';
  resDiv.className = 'result';
  
  // Mostrar feedback visual
  showLoading(true);
  resDiv.textContent = 'Verificando credenciais...';
  resDiv.className = 'result show';
  
  const apiUrl = 'https://app-cek0.onrender.com/login';
  
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    // Verificar se a resposta é válida
    if (!res.ok) {
      throw new Error(`Erro HTTP: ${res.status}`);
    }
    

    const data = await res.json();
   
    if (data.success) {
      // NOVO: Salvar dados do usuário no localStorage
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
        console.log('Dados do usuário salvos:', data.user);
      }
      
      resDiv.textContent = 'Login bem-sucedido!';
      resDiv.className = 'result success show';
      
      // Remover qualquer mensagem de boas-vindas existente
      const existingWelcome = document.getElementById('welcome-message');
      if (existingWelcome) {
        existingWelcome.remove();
      }
      
      // Criar a estrutura da mensagem de boas-vindas
      const welcomeDiv = document.createElement('div');
      welcomeDiv.id = 'welcome-message';
      welcomeDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(10px);
        animation: fadeIn 0.5s ease-out;
      `;
      
      const welcomeContent = document.createElement('div');
      welcomeContent.style.cssText = `
        background: white;
        padding: 40px;
        border-radius: 20px;
        text-align: center;
        max-width: 500px;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5);
      `;
      
      const welcomeHeading = document.createElement('h2');
      // MODIFICADO: Usar o nome do usuário na mensagem de boas-vindas
      const userName = data.user ? data.user.nome : 'Usuário';
      welcomeHeading.textContent = `Bem-vindo, ${userName}!`;
      welcomeHeading.style.cssText = `
        color: #8B0000;
        margin-bottom: 20px;
        font-size: 32px;
      `;
      
      const welcomeText = document.createElement('p');
      welcomeText.textContent = 'Redirecionando para o painel principal...';
      welcomeText.style.cssText = `
        font-size: 18px;
        color: #333;
        margin-bottom: 30px;
      `;
      
      const spinner = document.createElement('div');
      spinner.style.cssText = `
        width: 50px;
        height: 50px;
        border: 5px solid rgba(139, 0, 0, 0.2);
        border-top: 5px solid #8B0000;
        border-radius: 50%;
        margin: 0 auto;
        animation: spin 1s linear infinite;
      `;
      
      // Adicionar estilos de animação globalmente
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
      
      // Montar a estrutura
      welcomeContent.appendChild(welcomeHeading);
      welcomeContent.appendChild(welcomeText);
      welcomeContent.appendChild(spinner);
      welcomeDiv.appendChild(welcomeContent);
      document.body.appendChild(welcomeDiv);
      
      // Forçar reflow para garantir a animação
      welcomeDiv.offsetHeight;
      
      // Redirecionar após 1 segundo
      setTimeout(() => {
        window.location.href = "https://thiagozmb.github.io/elegance_app/painel_inicial.html";
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

// Função para mostrar/ocultar loading
function showLoading(show) {
  const loading = document.querySelector('.loading');
  const btnText = document.querySelector('.btn-text');
  const btn = document.querySelector('.login-btn');
  
  if (loading) loading.style.display = show ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = show ? 'Entrando...' : 'Entrar';
  if (btn) btn.disabled = show;
}

// NOVO: Função para verificar se o usuário já está logado (opcional)
// Você pode chamar esta função quando a página de login carregar
function checkExistingLogin() {
  const userData = localStorage.getItem('user');
  if (userData) {
    // Usuário já está logado, pode redirecionar direto
    console.log('Usuário já logado:', JSON.parse(userData));
    // Descomente a linha abaixo se quiser redirecionar automaticamente
    // window.location.href = "https://thiagozmb.github.io/elegance_app/painel_inicial.html";
  }
}

// Verificar login existente quando a página carregar
document.addEventListener('DOMContentLoaded', checkExistingLogin);
