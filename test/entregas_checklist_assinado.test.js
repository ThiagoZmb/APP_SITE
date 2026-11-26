// Foto do checklist assinado (2026-11-16): anexo tipo 'checklist' ja vinculado a um evento 'checklist_assinado', varias fotos por entrega,
// antes ou depois da baixa, sem tocar em status/pedido. Equipe (entregas.programar), motorista (so a propria) e administrativo (em nome do motorista).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { REGEX_VALOR } = require('../seguranca/valores');
const M = require('../minhas_entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 2)]);
const CT = { 'Content-Type': 'image/jpeg' };
const ADM = { codigo: 7, nome: 'Caio' };
const M21 = { codigo: 21, nome: 'Motorista Um' };
const PASSADO = '2000-01-01';
const chaves = (o, acc = []) => {
  if (Array.isArray(o)) o.forEach(x => chaves(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); chaves(v, acc); }
  return acc;
};

// 1 = do 21 Agendada, 2 = do 22 Em rota, 3 = do 21 Entregue, 4 = cancelada, 5 = do 21 de outro tipo (retirada)
function cenario(banco) {
  banco.semear.cliente({ TELEFONE: '2199999-0000' });
  for (const n of [601, 602, 603, 604, 605]) banco.semear.pedido({ NUMERO: n, SITUACAO: 'Pronto' });
  const base = { tipo: 'motorista', data_agendada: PASSADO };
  banco.semear.entrega({ ...base, status: 'agendada', numero: 601, motorista_codigo: 21 });
  banco.semear.entrega({ ...base, status: 'em_rota', numero: 602, motorista_codigo: 22 });
  banco.semear.entrega({ ...base, status: 'entregue', numero: 603, motorista_codigo: 21 });
  banco.semear.entrega({ ...base, status: 'cancelada', numero: 604, motorista_codigo: 21 });
  banco.semear.entrega({ ...base, status: 'agendada', numero: 605, motorista_codigo: 21, tipo: 'retirada' });
}
const enviarEquipe = (chamar, id, corpo = JPEG, cab = CT) => chamar(`/entregas/${id}/checklist_assinado`, 'PUT', corpo, cab);
const enviarMotorista = (chamar, id, corpo = JPEG, cab = CT) => chamar(`/minhas_entregas/${id}/checklist_assinado`, 'PUT', corpo, cab);

test('equipe: grava o anexo vinculado ao evento, a auditoria e nao muda status nem pedido; varias fotos', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  const antes = JSON.stringify(banco.entregas.find(e => e.id === 1));
  const r = await enviarEquipe(chamar, 1);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { anexoId: 1, qtdChecklistAssinado: 1 });
  assert.equal((await enviarEquipe(chamar, 1, PNG, { 'Content-Type': 'image/png' })).status, 201);
  const a = banco.anexos[0];
  assert.equal(a.tipo, 'checklist');
  assert.equal(a.entrega_id, 1);
  assert.ok(a.evento_id > 0, 'ja nasce vinculado: nunca fica solto');
  const ev = banco.eventos.filter(v => v.tipo === 'checklist_assinado');
  assert.equal(ev.length, 2);
  assert.equal(a.evento_id, ev[0].id);
  assert.equal(ev[0].usuario, 'Caio');
  assert.equal(JSON.stringify(banco.entregas.find(e => e.id === 1)), antes); // status e colunas intactos
  assert.equal(banco.pedidos.find(p => p.NUMERO === 601).SITUACAO, 'Pronto');
  const aud = banco.auditoria.filter(x => x.acao === 'entrega_checklist_assinado');
  assert.equal(aud.length, 2);
  assert.equal(aud[0].alvo, '601');
  // o detalhe devolve as fotos (tipo checklist) e o historico traz o evento; o binario sai pela rota de anexo existente
  const d = await (await chamar('/entregas/1')).json();
  assert.deepEqual(d.anexos.map(x => x.tipo), ['checklist', 'checklist']);
  assert.ok(d.eventos.some(v => v.tipo === 'checklist_assinado'));
  const bin = await chamar(`/entregas/1/anexo/${d.anexos[0].id}`);
  assert.equal(bin.status, 200);
  assert.equal(bin.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(chaves(d).filter(k => REGEX_VALOR.test(k)), []);
});

test('equipe: depois da baixa vale; cancelada 409; limite de 6 fotos; imagem invalida 400; grande 413; sem permissao 403; id inexistente 404', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  assert.equal((await enviarEquipe(chamar, 3)).status, 201); // entregue
  assert.equal((await enviarEquipe(chamar, 4)).status, 409); // cancelada
  assert.equal((await enviarEquipe(chamar, 999)).status, 404);
  assert.equal((await enviarEquipe(chamar, 1, Buffer.from('nao e imagem'), CT)).status, 400);
  assert.equal((await enviarEquipe(chamar, 1, PNG, CT)).status, 400); // mime nao confere com os bytes
  assert.equal((await enviarEquipe(chamar, 1, Buffer.concat([JPEG, Buffer.alloc(1100 * 1024)]))).status, 413);
  for (let i = 0; i < 6; i++) assert.equal((await enviarEquipe(chamar, 1)).status, 201);
  const sexta = await enviarEquipe(chamar, 1);
  assert.equal(sexta.status, 409);
  assert.equal(banco.anexos.filter(a => a.entrega_id === 1).length, 6);
});

test('equipe sem entregas.checklist_assinado recebe 403 e nada e gravado (so agendar nao basta)', async t => {
  const so = await prepararEntregas(t, { perfil: 'Só agendar' });
  cenario(so.banco);
  assert.equal((await enviarEquipe(so.chamar, 1)).status, 403);
  assert.equal(so.banco.anexos.length, 0);
});

test('equipe sem nenhuma permissao de entregas recebe 403 e nada e gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Operador' });
  cenario(banco);
  const r = await enviarEquipe(chamar, 1);
  assert.ok([403].includes(r.status), String(r.status));
  assert.equal(banco.anexos.length, 0);
});

test('motorista: so a propria entrega; antes (agendada/em rota) e depois da baixa; alheia, retirada e cancelada recusadas', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  assert.equal((await enviarMotorista(chamar, 1)).status, 201); // agendada, dele
  assert.equal((await enviarMotorista(chamar, 3)).status, 201); // entregue, dele (depois da baixa)
  assert.equal((await enviarMotorista(chamar, 2)).status, 404); // do 22
  assert.equal((await enviarMotorista(chamar, 5)).status, 404); // tipo retirada
  assert.equal((await enviarMotorista(chamar, 4)).status, 409); // cancelada
  assert.equal((await enviarMotorista(chamar, 1, Buffer.from('x'))).status, 400);
  assert.equal(banco.anexos.length, 2);
  assert.equal(banco.anexos[0].criado_por, '21');
  assert.equal(banco.eventos.filter(v => v.tipo === 'checklist_assinado' && v.usuario === 'Motorista Um').length, 2);
  assert.equal(banco.entregas.find(e => e.id === 1).status, 'agendada'); // nao bloqueia nem adianta a baixa
});

test('motorista: a foto nao bloqueia a baixa, que continua valendo depois', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas.find(e => e.id === 1).status = 'em_rota';
  assert.equal((await enviarMotorista(chamar, 1)).status, 201);
  const b = await chamar('/minhas_entregas/1/baixa', 'POST', { entregueA: 'Maria' });
  assert.equal(b.status, 200);
  assert.equal(banco.entregas.find(e => e.id === 1).status, 'entregue');
  assert.equal(banco.anexos.filter(a => a.tipo === 'checklist').length, 1);
});

test('motorista: a lista marca checklistAssinado so quando ha foto; sem dinheiro', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  assert.equal((await enviarMotorista(chamar, 1)).status, 201);
  assert.equal((await enviarMotorista(chamar, 1)).status, 201);
  const j = await (await chamar('/minhas_entregas')).json();
  const e1 = j.entregas.find(e => e.numero === 601);
  assert.equal(e1.checklistAssinado, true);
  assert.equal(e1.qtdChecklistAssinado, 2);
  assert.equal(Object.hasOwn(j.entregas.find(e => e.numero === 605) || {}, 'checklistAssinado'), false);
  assert.deepEqual(chaves(j).filter(k => REGEX_VALOR.test(k)), []);
  // o detalhe do motorista traz as fotos ja vinculadas
  const d = await (await chamar('/minhas_entregas/1')).json();
  assert.deepEqual(d.anexos.map(x => x.tipo), ['checklist', 'checklist']);
});

test('administrativo envia em nome do motorista de qualquer entrega; evento e auditoria dizem "em nome de"', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Administrativo', usuario: ADM });
  cenario(banco);
  const r = await enviarMotorista(chamar, 2);
  assert.equal(r.status, 201);
  const ev = banco.eventos.find(v => v.tipo === 'checklist_assinado');
  assert.equal(ev.usuario, 'Caio');
  assert.match(ev.motivo, /em nome do motorista Motorista Dois/);
  const det = JSON.parse(ev.detalhe);
  assert.equal(det.porAdministrativo, true);
  assert.equal(det.emNomeDe.codigo, 22);
  assert.equal(banco.entregas.find(e => e.id === 2).status, 'em_rota');
  assert.equal((await enviarMotorista(chamar, 5)).status, 404); // retirada: nao e de motorista
  const aud = banco.auditoria.find(x => x.acao === 'entrega_checklist_assinado');
  assert.ok(aud && JSON.parse(aud.detalhe).emNomeDe.codigo === 22);
});

test('a foto do checklist nao conta como anexo pendente e nao atrapalha a vinculacao da baixa', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas.find(e => e.id === 1).status = 'em_rota';
  for (let i = 0; i < 5; i++) assert.equal((await enviarMotorista(chamar, 1)).status, 201);
  const f = await chamar('/minhas_entregas/1/anexo?tipo=foto', 'PUT', JPEG, CT);
  assert.equal(f.status, 201); // contagem de pendentes ignora o checklist
  const { anexoId } = await f.json();
  assert.equal((await chamar('/minhas_entregas/1/baixa', 'POST', { entregueA: 'Maria', anexoIds: [anexoId] })).status, 200);
});

test('rotas novas estao no registro com permissao e a transacao trava a entrega antes de contar e gravar', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  banco.entregas.find(e => e.id === 1).status = 'em_rota';
  const log = [];
  const orig = banco.f.execute;
  banco.f.execute = async (sql, p) => { log.push(String(sql).replace(/\s+/g, ' ').trim()); return orig(sql, p); };
  // a conexao da transacao usa o mesmo executor do banco falso
  await enviarMotorista(chamar, 1);
  const i = re => log.findIndex(s => re.test(s));
  if (i(/FOR UPDATE/) >= 0) assert.ok(i(/COUNT\(\*\) AS qtd_fotos/) > i(/FOR UPDATE/));
  const src = ler('rotas/entregas.js');
  assert.match(src, /rota\('put', '\/entregas\/:id\/checklist_assinado', CHECKLIST_ASSINADO/);
  assert.match(src, /rota\('put', '\/minhas_entregas\/:id\/checklist_assinado', MINHAS, guardaMinhas/);
});

test('instalacao: nenhuma tabela nem coluna nova (tipo VARCHAR(20) comporta "checklist"; evento VARCHAR(30) comporta "checklist_assinado")', () => {
  assert.ok('checklist'.length <= 20 && 'checklist_assinado'.length <= 30);
  const inst = ler('seguranca/instalacao.js');
  assert.match(inst, /web_entrega_anexos[\s\S]*tipo VARCHAR\(20\)/);
  assert.match(inst, /web_entrega_eventos[\s\S]*tipo VARCHAR\(30\)/);
});

// ---- camera ao vivo + registro em tempo real (2026-11-16): chave de idempotencia por foto ----
const CHAVE = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const comChave = (chamar, rota, id, chave, corpo = JPEG) => chamar(`${rota}/${id}/checklist_assinado?chave=${chave}`, 'PUT', corpo, CT);

test('idempotencia: reenviar a MESMA chave devolve 200 com o mesmo anexo e nao duplica (equipe e motorista)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  const a = await comChave(chamar, '/entregas', 1, CHAVE);
  assert.equal(a.status, 201);
  const ja = await a.json();
  const b = await comChave(chamar, '/entregas', 1, CHAVE); // a resposta se perdeu na rede e a tela reenviou
  assert.equal(b.status, 200);
  const rb = await b.json();
  assert.equal(rb.anexoId, ja.anexoId);
  assert.equal(rb.qtdChecklistAssinado, 1);
  assert.equal(banco.anexos.filter(x => x.tipo === 'checklist').length, 1);
  assert.equal(banco.eventos.filter(v => v.tipo === 'checklist_assinado').length, 1);
  assert.equal(banco.auditoria.filter(x => x.acao === 'entrega_checklist_assinado').length, 1);
  assert.equal(JSON.parse(banco.eventos.find(v => v.tipo === 'checklist_assinado').detalhe).chave, CHAVE);
  // outra chave = outra foto; sem chave continua como antes
  assert.equal((await comChave(chamar, '/entregas', 1, 'outra-chave-0001')).status, 201);
  assert.equal((await enviarEquipe(chamar, 1)).status, 201);
  assert.equal(banco.anexos.filter(x => x.tipo === 'checklist').length, 3);
  // a mesma chave em OUTRA entrega e uma foto nova dela
  assert.equal((await comChave(chamar, '/entregas', 3, CHAVE)).status, 201);
});

test('idempotencia: chave invalida 400; o motorista tambem reenvia sem duplicar; limite de fotos nao bloqueia o reenvio de uma ja gravada', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: M21 });
  cenario(banco);
  for (const ruim of ['curta', 'tem espaco 123456', 'ac%C3%A7ao-123456', 'x'.repeat(65)])
    assert.equal((await comChave(chamar, '/minhas_entregas', 1, ruim)).status, 400, ruim);
  assert.equal(banco.anexos.length, 0);
  assert.equal((await comChave(chamar, '/minhas_entregas', 1, CHAVE)).status, 201);
  assert.equal((await comChave(chamar, '/minhas_entregas', 1, CHAVE)).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await comChave(chamar, '/minhas_entregas', 1, `chave-numero-${i}0`)).status, 201);
  assert.equal(banco.anexos.length, 6);
  assert.equal((await comChave(chamar, '/minhas_entregas', 1, 'chave-numero-novo')).status, 409); // 7a foto
  assert.equal((await comChave(chamar, '/minhas_entregas', 1, CHAVE)).status, 200); // reenvio da 1a: reconhecido, nao e 409
});

test('tela da equipe: botao abre a camera ao vivo (camera_captura.js), sem input de arquivo; selo, miniatura e rotulo do evento', () => {
  const h = ler('entregas.html'), js = ler('entregas.js');
  assert.match(h, /id="btn-foto-checklist"[^>]*data-perm="entregas\.checklist_assinado"/);
  assert.doesNotMatch(h, /id="d-foto-checklist"/);
  assert.match(h, /<link rel="stylesheet" href="camera_captura\.css\?v=\d+">/);
  assert.match(h, /<script src="camera_captura\.js\?v=\d+" defer><\/script>[\s\S]*<script src="entregas\.js\?v=/);
  assert.match(js, /checklist_assinado: 'Checklist assinado anexado'/);
  assert.match(js, /Checklist assinado ✓/);
  assert.match(js, /win\.CameraCaptura\.capturar\(win,/);
  assert.match(js, /\/checklist_assinado\?chave=\$\{encodeURIComponent\(chave\)\}`, \{ metodo: 'PUT', binario: blob, mime: 'image\/jpeg' \}/);
  assert.match(js, /estado\.det\.anexos\.push\(a\);[\s\S]*carregarAnexo\(e\.id, a, caixa\)/); // detalhe aberto reflete a foto na hora
});

test('tela do motorista: botao no cartao (perm do motorista ou administrativo), camera ao vivo, selo com contagem', () => {
  const h = ler('minhas_entregas.html'), js = ler('minhas_entregas.js');
  assert.doesNotMatch(h, /id="m-foto-checklist"/);
  assert.match(h, /<script src="camera_captura\.js\?v=\d+" defer><\/script>[\s\S]*<script src="minhas_entregas\.js\?v=/);
  assert.match(js, /data-acao=\\?"foto_checklist\\?"/);
  assert.match(js, /'administrativo\.ver' : 'entregas\.baixar'/);
  assert.match(js, /win\.CameraCaptura\.capturar\(win,/);
  assert.match(js, /e\.checklistAssinado = true; e\.qtdChecklistAssinado = /); // selo e contagem do cartao na hora
  // o selo aparece so com foto
  const e = { id: 1, numero: 601, status: 'agendada', checklistAssinado: true };
  assert.equal(typeof M.corStatus, 'function');
  assert.match(js, /Checklist assinado ✓/);
  assert.ok(e.checklistAssinado);
});

// ---- folhas antigas pelo computador (2026-11-17): arquivo em vez de camera, entrega concluida, "Registrar entrega antiga" ----
test('equipe: entrega Entregue e Retirado aceitam a foto (nada muda no status nem no pedido); so cancelada e recusada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  cenario(banco);
  banco.semear.pedido({ NUMERO: 606, SITUACAO: 'Retirado' });
  banco.semear.entrega({ status: 'retirado', numero: 606 });
  for (const id of [3, 6]) {
    assert.equal((await enviarEquipe(chamar, id)).status, 201);
    const d = await (await chamar(`/entregas/${id}`)).json();
    assert.equal(d.anexos.filter(a => a.tipo === 'checklist').length, 1); // o detalhe da concluida devolve a foto para a tela mostrar
  }
  assert.equal(banco.entregas.find(e => e.id === 3).status, 'entregue');
  assert.equal(banco.entregas.find(e => e.id === 6).status, 'retirado');
  assert.equal((await enviarEquipe(chamar, 4)).status, 409);
});

test('registrar entrega antiga: pedido Entregue/Retirado sem entrega ganha entrega JA concluida, evento, auditoria; pedido intacto; depois aceita foto', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 701, SITUACAO: 'Entregue' });
  banco.semear.pedido({ NUMERO: 702, SITUACAO: 'Retirado' });
  const reg = n => chamar(`/entregas/pedido/${n}/registrar_antiga`, 'POST', {});
  const r = await reg(701);
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.entrega.status, 'entregue');
  assert.equal((await (await reg(702)).json()).entrega.status, 'retirado');
  assert.equal(banco.entregas.length, 2);
  assert.equal(banco.eventos.filter(v => v.tipo === 'criada').length, 2);
  assert.equal(banco.auditoria.filter(x => x.acao === 'entrega_antiga_registrada' && x.alvo === '701').length, 1);
  assert.equal(banco.pedidos.find(p => p.NUMERO === 701).SITUACAO, 'Entregue');
  // a varredura (abrir Entregas) nao mexe nela, e ela aparece como concluida
  const lista = await (await chamar('/entregas')).json();
  assert.deepEqual(lista.entregas.map(e => e.status).sort(), ['entregue', 'retirado']);
  assert.equal(banco.eventos.filter(v => v.tipo !== 'criada').length, 0);
  // repetir = 409 (ja tem entrega); foto vale na entrega registrada
  const dup = await reg(701);
  assert.equal(dup.status, 409);
  assert.match((await dup.json()).error, /já tem entrega/);
  assert.equal((await enviarEquipe(chamar, j.entrega.id)).status, 201);
});

test('registrar entrega antiga: a data real do pedido (DATA_ENTREGA) vira a data da entrega; vazia/invalida fica sem data; lista e detalhe mostram', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 721, SITUACAO: 'Entregue', DATA_ENTREGA: '2026-10-23 00:00:00' });
  banco.semear.pedido({ NUMERO: 722, SITUACAO: 'Retirado', DATA_ENTREGA: null });
  banco.semear.pedido({ NUMERO: 723, SITUACAO: 'Entregue', DATA_ENTREGA: '0000-00-00' });
  const r = await (await chamar('/entregas/pedido/721/registrar_antiga', 'POST', {})).json();
  assert.equal(r.entrega.dataAgendada, '2026-10-23');
  assert.equal(banco.entregas.find(e => e.numero === 721).data_agendada, '2026-10-23');
  for (const n of [722, 723]) assert.equal((await (await chamar(`/entregas/pedido/${n}/registrar_antiga`, 'POST', {})).json()).entrega.dataAgendada, null);
  const lista = (await (await chamar('/entregas')).json()).entregas;
  assert.equal(lista.find(e => e.numero === 721).dataAgendada, '2026-10-23');
  assert.equal(lista.find(e => e.numero === 722).dataAgendada, null);
  assert.equal((await (await chamar(`/entregas/${r.entrega.id}`)).json()).entrega.dataAgendada, '2026-10-23');
  assert.equal(banco.pedidos.find(p => p.NUMERO === 721).DATA_ENTREGA, '2026-10-23 00:00:00'); // pedido intacto
});

test('entrega concluida ja registrada SEM data usa ped_orc.DATA_ENTREGA como reserva (lista e detalhe); aberta nunca', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 731, SITUACAO: 'Entregue', DATA_ENTREGA: '2026-10-23' });
  banco.semear.entrega({ numero: 731, status: 'entregue' });
  banco.semear.pedido({ NUMERO: 732, SITUACAO: 'Pronto', DATA_ENTREGA: '2026-10-24' });
  banco.semear.entrega({ numero: 732, status: 'a_programar' });
  const lista = (await (await chamar('/entregas')).json()).entregas;
  assert.equal(lista.find(e => e.numero === 731).dataAgendada, '2026-10-23');
  assert.equal(lista.find(e => e.numero === 732).dataAgendada, null);
  const id = banco.entregas.find(e => e.numero === 731).id;
  assert.equal((await (await chamar(`/entregas/${id}`)).json()).entrega.dataAgendada, '2026-10-23');
  assert.equal(banco.entregas.find(e => e.id === id).data_agendada, null); // so leitura: nada gravado
});

test('registrar entrega antiga: recusa Pronto/Em Producao/Cancelado (409), inexistente (404) e nao cria nada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 711, SITUACAO: 'Pronto' });
  banco.semear.pedido({ NUMERO: 712, SITUACAO: 'Em Produção' });
  banco.semear.pedido({ NUMERO: 713, SITUACAO: 'Cancelado' });
  for (const n of [711, 712, 713]) assert.equal((await chamar(`/entregas/pedido/${n}/registrar_antiga`, 'POST', {})).status, 409);
  assert.equal((await chamar('/entregas/pedido/999/registrar_antiga', 'POST', {})).status, 404);
  assert.equal(banco.entregas.length, 0);
});

test('registrar entrega antiga: rota exige entregas.criar e o sistema continua sem tabela nova', () => {
  assert.match(ler('rotas/entregas.js'), /rota\('post', '\/entregas\/pedido\/:numero\/registrar_antiga', CRIAR,/);
});

test('tela da equipe: "Escolher arquivo(s)" sem capture, JPEG/PNG, multiplo, mesmo PUT com chave, reduz no navegador, limite de 6; registrar antiga', () => {
  const h = ler('entregas.html'), js = ler('entregas.js');
  assert.match(h, /id="btn-arquivo-checklist"[^>]*data-perm="entregas\.checklist_assinado"/);
  assert.match(h, /<input type="file" id="in-arquivo-checklist" accept="image\/jpeg,image\/png" multiple hidden>/);
  assert.doesNotMatch(h, /id="in-arquivo-checklist"[^>]*capture/);
  assert.match(js, /MAX_FOTOS_CHECKLIST = 6/);
  assert.match(js, /CameraCaptura\.reduzirParaCaber\(img\.naturalWidth, img\.naturalHeight/);
  assert.match(js, /\/checklist_assinado\?chave=\$\{encodeURIComponent\(win\.CameraCaptura\.novaChave\(win\)\)\}`, \{ metodo: 'PUT', binario: blob, mime: 'image\/jpeg' \}/);
  assert.match(js, /\$\('btn-arquivo-checklist'\)\.hidden = e\.status === 'cancelada'/); // aparece na entrega concluida
  assert.doesNotMatch(js.slice(js.indexOf('async function enviarArquivosChecklist'), js.indexOf('function perguntarBaixaDepoisDaFoto')), /perguntarBaixa/); // nunca pergunta da baixa
  assert.match(h, /id="btn-registrar-antiga"[^>]*data-perm="entregas\.criar"/);
  assert.match(js, /\/registrar_antiga`, \{ metodo: 'POST'/);
  assert.match(h, /entregas\.js\?v=202612011000/);
});
