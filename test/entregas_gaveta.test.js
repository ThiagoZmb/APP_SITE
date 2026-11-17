// Gaveta do detalhe em telas estreitas (entregas.html + entregas.js): decisão pura (node:test) e conferência do código-fonte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('telaEstreita: até 1100px é estreita; inválido nunca abre gaveta', () => {
  assert.equal(E.LARGURA_GAVETA, 1100);
  assert.equal(E.telaEstreita(390), true);
  assert.equal(E.telaEstreita(1100), true);
  assert.equal(E.telaEstreita(1101), false);
  assert.equal(E.telaEstreita(1920), false);
  for (const v of [0, -5, NaN, undefined, null, 'abc']) assert.equal(E.telaEstreita(v), false);
});

test('decisaoGaveta: abre ao mostrar detalhe/formulário em tela estreita, fecha no vazio, nunca no desktop', () => {
  const d = (estreita, aberta, vista) => E.decisaoGaveta({ estreita, aberta, vista });
  assert.equal(d(true, false, 'vista-detalhe'), 'abrir');
  assert.equal(d(true, false, 'vista-criar'), 'abrir');
  assert.equal(d(true, true, 'vista-agendar'), 'manter'); // trocar de vista dentro da gaveta não reabre
  assert.equal(d(true, true, 'vazio-painel'), 'fechar');
  assert.equal(d(true, false, 'vazio-painel'), 'manter');
  assert.equal(d(false, false, 'vista-detalhe'), 'manter'); // desktop: nada muda
  assert.equal(d(false, true, 'vista-detalhe'), 'fechar'); // alargou a janela com a gaveta aberta
  assert.equal(d(true, false, undefined), 'manter');
});

test('entregas.js: gaveta usa o mesmo painel, histórico, Esc, foco e trava de rolagem', () => {
  const j = ler('entregas.js');
  assert.match(j, /decisaoGaveta\(\{ estreita: telaEstreitaAgora\(\)/);
  assert.match(j, /win\.history\.pushState\(\{ gavetaEntregas: true \}/);
  assert.match(j, /addEventListener\('popstate'/);
  assert.match(j, /ev\.key !== 'Escape' \|\| !gav\.aberta \|\| ev\.defaultPrevented/);
  assert.match(j, /\.cc-fundo, \.dp-fundo/); // câmera e janelas tratam o próprio Esc
  assert.match(j, /doc\.body\.classList\.add\('gaveta-ativa'\)/);
  assert.match(j, /el\.inert = true/);
  assert.match(j, /painel\.focus\(\{ preventScroll: true \}\)/);
  assert.match(j, /volta\.focus\(\{ preventScroll: true \}\)/);
  // não duplica a renderização do detalhe
  assert.equal((j.match(/function desenharDetalhe/g) || []).length, 1);
});

test('entregas.html: topo da gaveta, CSS abaixo de 1100px, empilhamento e versão do script', () => {
  const h = ler('entregas.html');
  assert.match(h, /<button type="button" class="btn btn-secondary gaveta-voltar" id="gaveta-voltar">/);
  assert.match(h, /@media \(max-width: 1100px\) \{\s*#painel:not\(\.gaveta-aberta\) \{ display: none; \}/);
  assert.match(h, /#painel\.gaveta-aberta \{ position: fixed; inset: 0; z-index: 60;/);
  assert.match(h, /body\.gaveta-ativa \{ overflow: hidden; \}/);
  // câmera (3000), janelas (.dp-fundo 2000), menu (1000) e janela do checklist (70) ficam acima da gaveta (60); toasts acima de tudo menos a câmera
  assert.match(ler('camera_captura.css'), /\.cc-fundo \{[^}]*z-index: 3000/);
  assert.match(ler('tema.css'), /\.dp-fundo \{[^}]*z-index: 2000/);
  assert.match(h, /#ent-menu \{[^}]*z-index: 1000/);
  assert.match(h, /\.ck-fundo \{[^}]*z-index: 70/);
  assert.match(h, /#toasts \{[^}]*z-index: 2100/);
  assert.match(h, /entregas\.js\?v=202611251000/);
  // ações e permissões continuam no mesmo painel
  assert.match(h, /id="btn-baixa-adm" data-perm="administrativo\.ver"/);
  assert.match(h, /id="btn-foto-checklist" data-perm="entregas\.checklist_assinado"/);
});
