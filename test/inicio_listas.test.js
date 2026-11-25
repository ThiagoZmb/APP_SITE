'use strict';
// Início: executa o script real de inicio.html (com DOM falso) e confere que as listas "Últimos pedidos" e
// "Previsão de finalização" saem do "Carregando..." com o olho fechado e aberto, com e sem valores.ver.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Olho = require('../olho_resumos.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'inicio.html'), 'utf8');
const script = /<script>\r?\n([\s\S]*?)<\/script>/.exec(html)[1];

function montar({ valores }) {
  const elementos = {};
  const elemento = () => {
    let texto = '';
    return {
      innerHTML: '', hidden: false,
      get textContent() { return texto; },
      set textContent(v) { texto = String(v); this.innerHTML = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    };
  };
  const estado = Olho.criarEstado();
  const pedidos = [{ numero: 101, cliente: 'Cliente A', data: '01/01/2020', prontoEm: '02/01/2020', situacao: 'Em Produção', valor: valores ? 150 : undefined }];
  const janela = {
    OlhoResumos: { carga: fn => Olho.criarCarga(estado, fn) },
    Acesso: { pode: p => (String(p).includes('valores') ? valores : true), paginaLiberada: () => true },
    Situacoes: { selo: (_a, _b, rotulo) => `<span>${rotulo}</span>` },
    document: { getElementById: id => (elementos[id] ||= elemento()), createElement: elemento, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {} },
    fetch: async url => ({ ok: true, status: 200, json: async () => (url.includes('tipo=Pedido') ? pedidos : []) })
  };
  janela.window = janela;
  vm.createContext(janela);
  vm.runInContext(script, janela);
  return { janela, elementos, abrirOlho: () => estado.definir(true).forEach(fn => fn()) };
}

for (const valores of [true, false]) {
  for (const aberto of [false, true]) {
    test(`listas do início carregam (olho ${aberto ? 'aberto' : 'fechado'}, ${valores ? 'com' : 'sem'} valores.ver)`, async () => {
      const t = montar({ valores });
      if (aberto) t.abrirOlho();
      await t.janela.carregarComercial();
      assert.match(t.elementos.ultimos.innerHTML, /#101/);
      assert.match(t.elementos.entregas.innerHTML, /#101/);
      assert.equal(/R\$/.test(t.elementos.ultimos.innerHTML), valores, 'valor na lista só com valores.ver');
    });
  }
}
