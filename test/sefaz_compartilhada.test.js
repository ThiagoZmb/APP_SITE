// Notas de compra pela SEFAZ com PASTA COMPARTILHADA entre PCs (campo "pastaCompartilhada" do sefaz.config.json):
// estado da fila, índice e XML na pasta da rede, trava entre PCs (sefaz.trava), regras de consumo valendo para a
// empresa toda, migração dos dados locais e pasta fora do ar sem cair no disco local.
// Dois serviços (duas instâncias de criarSefaz, raízes e configs diferentes, "PC-A" e "PC-B") apontam para o MESMO
// diretório temporário. Nenhuma rede real: só o servidor HTTPS falso da SEFAZ dos testes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../local/sefaz');
const A = require('./apoio/sefazFalsa');

const CNPJ = '33000167000101';
const CHAVE_A = A.gerarChave({ numero: 601 });
const CHAVE_B = A.gerarChave({ numero: 602 });
const pfx = A.gerarPfx({ cnpj: CNPJ });
const doc = (nsu, xml) => ({ nsu, schema: 'x.xsd', xml });
const TRAVA = pasta => path.join(pasta, S.NOME_TRAVA);
const NOTAS = pasta => path.join(pasta, 'NFe', 'Entrada_Homologacao');
const lerJsonArq = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function pastaComum(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-comp-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return path.join(base, 'NFE COMPRAS (SEFAZ)');      // nome com espaço e parênteses, como o real
}
const servico = (t, pasta, computador, extra = {}) => A.prepararServico(t, { pfx, cnpj: CNPJ,
  configExtra: pasta === undefined ? {} : { pastaCompartilhada: pasta },
  opcoes: { computador, esperaTrava: { longa: 150, curta: 400 }, ...extra } });
async function dois(t, extra = {}) {
  const pasta = pastaComum(t);
  return { pasta, a: await servico(t, pasta, 'PC-A', extra), b: await servico(t, pasta, 'PC-B', extra) };
}
// nada do estado/notas pode aparecer no disco local de um PC que usa a pasta compartilhada
function semNadaLocal(p) {
  assert.ok(!fs.existsSync(path.join(p.dir, 'NFe')), 'sem NFe no disco local');
  assert.ok(!fs.existsSync(path.join(p.dir, 'Servico', 'sefaz.estado.json')), 'sem estado no disco local');
}

// ---------------------------------------------------------------- configuração
test('pastaCompartilhada: caminho de rede (\\\\servidor\\pasta) ou com letra; uma barra só, relativo ou fora do formato é recusado', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-cfg-'));
  const arq = path.join(base, 'sefaz.config.json');
  const ler = v => { fs.writeFileSync(arq, JSON.stringify({ cnpj: CNPJ, uf: 'RJ', ambiente: 'homologacao', certificado: path.join(base, 'a.pfx'), senha: 'S-123', pastaCompartilhada: v })); return S.lerConfig(arq, {}); };
  try {
    const real = '\\\\pc-serverdell\\SERVIDOR ELEGANCE\\SIMONE\\CERTIFICADO DIGITAL NFE\\NFE COMPRAS (SEFAZ)';
    assert.equal(ler(real).config.pastaCompartilhada, real);
    // o mesmo caminho escrito no JSON com as barras duplicadas é lido certinho
    fs.writeFileSync(arq, '{"cnpj":"' + CNPJ + '","uf":"RJ","ambiente":"homologacao","certificado":"C:\\\\a.pfx","senha":"x",' +
      '"pastaCompartilhada":"\\\\\\\\pc-serverdell\\\\SERVIDOR ELEGANCE\\\\NFE COMPRAS (SEFAZ)"}');
    assert.equal(S.lerConfig(arq, {}).config.pastaCompartilhada, '\\\\pc-serverdell\\SERVIDOR ELEGANCE\\NFE COMPRAS (SEFAZ)');
    assert.equal(ler('Z:\\Notas').ok, true);
    assert.equal(ler('').config.pastaCompartilhada, '', 'vazio = desligado');
    assert.equal(ler(null).config.pastaCompartilhada, '');
    // o erro que já aconteceu: uma barra só no começo (o Windows leria como C:\pc-serverdell\...)
    const uma = ler('\\pc-serverdell\\SERVIDOR ELEGANCE');
    assert.equal(uma.ok, false);
    assert.match(uma.motivo, /DUAS barras/);
    assert.ok(uma.motivo.includes('"\\\\\\\\servidor\\\\pasta"'), 'mostra como escrever no JSON');
    for (const v of ['pasta\\relativa', '   ', 123, '\\\\?\\C:\\x', '\\\\.\\pipe\\x', '\\\\servidor', 'C:\\a:b', 'C:\\a*b', ['\\\\s\\p']]) {
      const r = ler(v);
      assert.equal(r.ok, false, JSON.stringify(v));
      assert.match(r.motivo, /pastaCompartilhada/);
      assert.ok(!r.motivo.includes('S-123'));
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- (a) e (b): mesmo estado para os dois PCs
test('(a) A sincroniza e B enxerga as mesmas notas, o mesmo XML e o mesmo ultNSU sem chamar a SEFAZ', async t => {
  const { pasta, a, b } = await dois(t);
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000002', maxNSU: '000000000000002',
    docs: [doc('000000000000001', A.resNFe({ chave: CHAVE_A })), doc('000000000000002', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  const r = await a.sefaz.sincronizar();
  assert.equal(r.novas, 2);
  const nb = (await b.sefaz.notas()).notas;
  assert.deepEqual(nb.map(n => [n.chave, n.situacao]).sort(), [[CHAVE_A, 'resumo'], [CHAVE_B, 'completa']].sort());
  assert.match(await b.sefaz.xml(CHAVE_B), /<nfeProc/);
  const st = await b.sefaz.status();
  assert.equal(st.ultNSU, '000000000000002'); assert.equal(st.qtdNotas, 2);
  assert.deepEqual(st.compartilhada, { ativa: true, acessivel: true, pasta: 'NFE COMPRAS (SEFAZ)' });
  assert.equal(b.falsa.pedidos.length, 0, 'B não chamou a SEFAZ');
  assert.ok(fs.existsSync(path.join(pasta, 'sefaz.estado.json')) && fs.existsSync(path.join(NOTAS(pasta), 'indice.json')) && fs.existsSync(path.join(NOTAS(pasta), `${CHAVE_B}.xml`)));
  assert.ok(!fs.existsSync(TRAVA(pasta)), 'trava solta depois do sucesso');
  semNadaLocal(a); semNadaLocal(b);
});

test('(b) B logo depois do 137 de A: 429 sem chamar a SEFAZ; 656 de A bloqueia o baixar de B; 20 por hora contam juntas', async t => {
  const { pasta, a, b } = await dois(t);
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137', ultNSU: '000000000000005', maxNSU: '000000000000005' }) });
  await a.sefaz.sincronizar();
  await assert.rejects(b.sefaz.sincronizar(), e => e.status === 429 && /Próxima consulta liberada às 11:00/.test(e.message));
  assert.equal(b.falsa.pedidos.length, 0);
  assert.equal((await b.sefaz.status()).proximaConsultaHora, '11:00');
  assert.ok(!fs.existsSync(TRAVA(pasta)), 'o 429 não deixa a trava presa');
  // 656 em A (por chave) bloqueia B por 1 hora
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '656', xMotivo: 'Rejeicao: Consumo Indevido' }) });
  await assert.rejects(a.sefaz.baixar(CHAVE_A), e => e.status === 429 && /656/.test(e.message));
  assert.ok(!fs.existsSync(TRAVA(pasta)), 'o 656 não deixa a trava presa');
  await assert.rejects(b.sefaz.baixar(CHAVE_A), e => e.status === 429 && /consumo indevido/.test(e.message));
  assert.equal(b.falsa.pedidos.length, 0);
  // passada a hora: consultas por chave dos dois PCs somam no mesmo limite de 20
  a.relogio.t += S.HORA + 1000; b.relogio.t += S.HORA + 1000;
  for (let i = 0; i < 10; i++) { a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) }); b.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) }); }
  for (let i = 0; i < 10; i++) { await assert.rejects(a.sefaz.baixar(CHAVE_B), e => e.status === 404); await assert.rejects(b.sefaz.baixar(CHAVE_B), e => e.status === 404); }
  await assert.rejects(b.sefaz.baixar(CHAVE_B), e => e.status === 429 && /Limite de 20/.test(e.message));
  assert.equal(b.falsa.pedidos.length, 10);
  assert.equal((await a.sefaz.status()).consultasChaveNaHora, 20);
});

// ---------------------------------------------------------------- (c) e (d): trava
test('(c) trava de outro computador: 409 com o nome dele, sem chamar a SEFAZ; trava velha (20 min) é retomada e avisada', async t => {
  const { pasta, b } = await dois(t);
  fs.mkdirSync(pasta, { recursive: true });
  const travar = (dados) => fs.writeFileSync(TRAVA(pasta), JSON.stringify({ computador: 'PC-DO-ESTOQUE', pid: 4242, token: 'abc123', ...dados }));
  travar({ desde: b.relogio.t - 60 * 1000 });
  await assert.rejects(b.sefaz.sincronizar(), e => e.status === 409 && e.message === 'Outro computador (PC-DO-ESTOQUE) está falando com a SEFAZ neste momento. Aguarde e tente de novo.'
    && e.extra.outroComputador === 'PC-DO-ESTOQUE');
  await assert.rejects(b.sefaz.baixar(CHAVE_A), e => e.status === 409);
  const t0 = Date.now();
  await assert.rejects(b.sefaz.importada(CHAVE_A), e => e.status === 409 && /PC-DO-ESTOQUE/.test(e.message));
  assert.ok(Date.now() - t0 >= 350, 'operação curta espera um pouco antes de desistir');
  assert.equal(b.falsa.pedidos.length, 0);
  const st = await b.sefaz.status();
  assert.equal(st.compartilhada.emUsoPor, 'PC-DO-ESTOQUE');
  assert.equal(lerJsonArq(TRAVA(pasta)).token, 'abc123', 'a trava dos outros não foi mexida');
  // 21 minutos depois: abandonada → retomada
  travar({ desde: b.relogio.t - S.TRAVA_ABANDONADA - 60 * 1000 });
  b.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  assert.equal((await b.sefaz.sincronizar()).ok, true);
  assert.ok(!fs.existsSync(TRAVA(pasta)));
  const st2 = await b.sefaz.status();
  assert.equal(st2.compartilhada.travaRetomada, true);
  assert.ok(st2.avisos.some(a => /trava abandonada do computador PC-DO-ESTOQUE/.test(a)), st2.avisos.join(' | '));
  assert.ok(!(await b.sefaz.status()).avisos.some(a => /trava abandonada/.test(a)), 'avisa uma vez');
  assert.ok(fs.readdirSync(pasta).every(n => !n.endsWith('.velha') && !n.endsWith('.tmp')), 'sem sobras de arquivos');
});

test('(c) trava deste mesmo PC deixada por um processo que não existe mais é retomada sem esperar 20 min; trava ilegível recente segura', async t => {
  const { pasta, b } = await dois(t);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(TRAVA(pasta), JSON.stringify({ computador: 'PC-B', pid: 2147483641, desde: b.relogio.t, token: 'zz' }));
  b.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  assert.equal((await b.sefaz.sincronizar()).ok, true);
  assert.ok(!fs.existsSync(TRAVA(pasta)));
  // trava vazia (outro PC criando agora): conta como ocupada
  b.relogio.t += S.HORA + 1000;
  fs.writeFileSync(TRAVA(pasta), '');
  await assert.rejects(b.sefaz.sincronizar(), e => e.status === 409 && /Outro computador \(desconhecido\)/.test(e.message));
  // ...mas vazia e velha (arquivo de mais de 20 min) é retomada
  const velho = new Date(Date.now() - S.TRAVA_ABANDONADA - 60000);
  fs.utimesSync(TRAVA(pasta), velho, velho);
  b.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  assert.equal((await b.sefaz.sincronizar()).ok, true);
  assert.equal(b.falsa.pedidos.length, 2);
});

test('(d) a trava é solta depois de sucesso, 429, 656, cStat inesperado e erro de arquivo; e enquanto A trabalha, B recebe 409', async t => {
  const { pasta, a, b } = await dois(t);
  const solta = () => assert.ok(!fs.existsSync(TRAVA(pasta)), 'trava solta');
  // enquanto A espera a SEFAZ (resposta atrasada), a trava existe e B recebe 409 com o nome de A
  let liberar;
  const segura = new Promise(ok => { liberar = ok; });
  const lenta = A.retDist({ cStat: '137' });
  a.falsa.servidor.removeAllListeners('request');      // troca o atendente do servidor falso por um que só responde quando liberado
  a.falsa.servidor.on('request', (req, res) => { req.resume(); req.on('end', async () => { await segura; res.writeHead(200, { 'Content-Type': 'application/soap+xml' }); res.end(lenta); }); });
  const emAndamento = a.sefaz.sincronizar();
  try {
    for (let i = 0; i < 100 && !fs.existsSync(TRAVA(pasta)); i++) await new Promise(ok => setTimeout(ok, 10));
    assert.equal(lerJsonArq(TRAVA(pasta)).computador, 'PC-A');
    await assert.rejects(b.sefaz.sincronizar(), e => e.status === 409 && /Outro computador \(PC-A\)/.test(e.message));
    assert.equal((await b.sefaz.status()).compartilhada.emUsoPor, 'PC-A');
  } finally { liberar(); }
  await emAndamento;
  solta();
  // 429 (espera de 1 hora)
  await assert.rejects(a.sefaz.sincronizar(), e => e.status === 429); solta();
  // 656 na sincronização
  const a2 = await servico(t, pasta, 'PC-A2');
  a2.relogio.t += S.HORA + 1000;
  a2.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '656', xMotivo: 'Consumo Indevido' }) });
  await assert.rejects(a2.sefaz.sincronizar(), e => e.status === 429 && /656/.test(e.message)); solta();
  // cStat inesperado
  a2.relogio.t += S.HORA + 1000;
  a2.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '593', xMotivo: 'Rejeicao' }) });
  await assert.rejects(a2.sefaz.sincronizar(), e => e.status === 502); solta();
  // erro de arquivo no meio (índice virou pasta): mensagem clara, nada de 500, trava solta, ponteiro não andou
  fs.mkdirSync(path.join(NOTAS(pasta), 'indice.json'), { recursive: true });
  a2.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000009', maxNSU: '000000000000009', docs: [doc('000000000000009', A.resNFe({ chave: CHAVE_A }))] }) });
  await assert.rejects(a2.sefaz.sincronizar(), e => e.status === 503 && /Não consegui acessar a pasta compartilhada das notas \("NFE COMPRAS \(SEFAZ\)"\)/.test(e.message)); solta();
  assert.equal(lerJsonArq(path.join(pasta, 'sefaz.estado.json'))[`${CNPJ}-homologacao`].ultNSU, '000000000000000');
  // importada e ciência também soltam
  await assert.rejects(a2.sefaz.importada(CHAVE_A), e => e.status === 503); solta();
  a2.falsa.filas.evento.push({ corpo: A.retEvento({ cStat: '215' }) });
  await assert.rejects(a2.sefaz.ciencia([CHAVE_A]), /não processou o lote/); solta();
});

// ---------------------------------------------------------------- (e) migração
test('(e) migração: os dados locais do primeiro PC vão para a pasta compartilhada uma vez, sem sobrescrever nem apagar; o segundo PC não migra', async t => {
  const pasta = pastaComum(t);
  // PC A trabalhou até hoje sozinho, no disco local
  const a = await servico(t, undefined, 'PC-A');
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000003', maxNSU: '000000000000003',
    docs: [doc('000000000000001', A.resNFe({ chave: CHAVE_A })), doc('000000000000003', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  await a.sefaz.sincronizar();
  const localNotas = path.join(a.dir, 'NFe', 'Entrada_Homologacao');
  assert.ok(fs.existsSync(path.join(localNotas, `${CHAVE_B}.xml`)));
  // já existe na compartilhada um XML com o mesmo nome (não pode ser sobrescrito)
  fs.mkdirSync(NOTAS(pasta), { recursive: true });
  fs.writeFileSync(path.join(NOTAS(pasta), `${CHAVE_B}.xml`), 'JA-ESTAVA-AQUI');
  // o dono liga a pasta compartilhada no PC A
  const cfg = lerJsonArq(a.config);
  fs.writeFileSync(a.config, JSON.stringify({ ...cfg, pastaCompartilhada: pasta }));
  const st = await a.sefaz.status();
  assert.equal(st.compartilhada.migrado, true);
  assert.equal(st.ultNSU, '000000000000003'); assert.equal(st.qtdNotas, 2); assert.equal(st.proximaConsultaHora, '11:00');
  const est = lerJsonArq(path.join(pasta, 'sefaz.estado.json'))[`${CNPJ}-homologacao`];
  assert.equal(est.ultNSU, '000000000000003');
  assert.deepEqual(Object.keys(lerJsonArq(path.join(NOTAS(pasta), 'indice.json')).notas).sort(), [CHAVE_A, CHAVE_B].sort());
  assert.equal(fs.readFileSync(path.join(NOTAS(pasta), `${CHAVE_B}.xml`), 'utf8'), 'JA-ESTAVA-AQUI', 'não sobrescreve');
  assert.ok(fs.existsSync(path.join(localNotas, 'indice.json')) && fs.existsSync(path.join(a.dir, 'Servico', 'sefaz.estado.json')), 'não apaga o local');
  assert.equal((await a.sefaz.status()).compartilhada.migrado, undefined, 'avisa uma vez');
  assert.ok(!fs.existsSync(TRAVA(pasta)));
  // PC B também tinha dados locais (outra fila), mas a compartilhada já tem: não mistura
  const b = await servico(t, pasta, 'PC-B');
  const outra = A.gerarChave({ numero: 999 });
  fs.writeFileSync(path.join(b.dir, 'Servico', 'sefaz.estado.json'), JSON.stringify({ [`${CNPJ}-homologacao`]: { ultNSU: '000000000000999' } }));
  fs.mkdirSync(path.join(b.dir, 'NFe', 'Entrada_Homologacao'), { recursive: true });
  fs.writeFileSync(path.join(b.dir, 'NFe', 'Entrada_Homologacao', 'indice.json'), JSON.stringify({ versao: 1, notas: { [outra]: { chave: outra, situacao: 'resumo' } } }));
  const sb = await b.sefaz.status();
  assert.equal(sb.compartilhada.migrado, undefined);
  assert.equal(sb.ultNSU, '000000000000003');
  assert.ok(!(await b.sefaz.notas()).notas.some(n => n.chave === outra));
  await assert.rejects(b.sefaz.sincronizar(), e => e.status === 429, 'a espera de 1 hora migrada vale para B');
  assert.equal(b.falsa.pedidos.length, 0);
});

test('(e) migração também acontece na primeira operação (sem abrir o status antes)', async t => {
  const pasta = pastaComum(t);
  const a = await servico(t, undefined, 'PC-A');
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000003', maxNSU: '000000000000004', docs: [doc('000000000000003', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '656', xMotivo: 'x' }) });
  await assert.rejects(a.sefaz.sincronizar(), e => e.status === 429);
  fs.writeFileSync(a.config, JSON.stringify({ ...lerJsonArq(a.config), pastaCompartilhada: pasta }));
  assert.equal((await a.sefaz.importada(CHAVE_B)).nota.situacao, 'importada');
  assert.equal(lerJsonArq(path.join(NOTAS(pasta), 'indice.json')).notas[CHAVE_B].situacao, 'importada');
  assert.ok(lerJsonArq(path.join(pasta, 'sefaz.estado.json'))[`${CNPJ}-homologacao`].bloqueadoAte > a.relogio.t, 'o bloqueio 656 foi junto');
  assert.equal(lerJsonArq(path.join(a.dir, 'NFe', 'Entrada_Homologacao', 'indice.json')).notas[CHAVE_B].situacao, 'completa', 'o local fica como estava');
});

// ---------------------------------------------------------------- (f) pasta inacessível
test('(f) pasta compartilhada inacessível: erro claro (503), status 200 com acessivel=false, e nada gravado no disco local', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-fora-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(base, 'arquivo.txt'), 'não é pasta');
  const pasta = path.join(base, 'arquivo.txt', 'NOTAS');          // impossível de criar (o "pai" é um arquivo)
  const a = await servico(t, pasta, 'PC-A');
  const msg = /Não consegui acessar a pasta compartilhada das notas \("NOTAS"\)/;
  await assert.rejects(a.sefaz.sincronizar(), e => e.status === 503 && msg.test(e.message) && e.extra.pastaCompartilhadaInacessivel === true);
  await assert.rejects(a.sefaz.baixar(CHAVE_A), e => e.status === 503 && msg.test(e.message));
  await assert.rejects(a.sefaz.ciencia([CHAVE_A]), e => e.status === 503 && msg.test(e.message));
  await assert.rejects(a.sefaz.importada(CHAVE_A), e => e.status === 503 && msg.test(e.message));
  await assert.rejects(a.sefaz.notas(), e => e.status === 503 && msg.test(e.message));
  await assert.rejects(a.sefaz.xml(CHAVE_A), e => e.status === 503 && msg.test(e.message));
  const st = await a.sefaz.status();
  assert.equal(st.configurada, true);
  assert.deepEqual(st.compartilhada, { ativa: true, acessivel: false, pasta: 'NOTAS' });
  assert.ok(st.avisos.some(x => msg.test(x)));
  assert.equal(st.qtdNotas, null); assert.equal(st.ultNSU, null);
  assert.equal(a.falsa.pedidos.length, 0, 'sem pasta, não consulta a SEFAZ (o ponteiro não teria onde ficar)');
  semNadaLocal(a);
  // pela rota HTTP: 503 com a mensagem, nunca 500
  const res = { writeHead(s) { this.s = s; }, end(c) { this.c = c; } };
  await a.sefaz.tratar({ headers: { host: '127.0.0.1:3917', 'content-type': 'application/json' }, method: 'GET' }, res, new URL('http://127.0.0.1/sefaz/notas'), { origemPermitida: true });
  assert.equal(res.s, 503); assert.match(JSON.parse(res.c).error, msg);
});

test('(f) índice danificado na pasta compartilhada não é tratado como vazio (não apaga as notas de todos)', async t => {
  const { pasta, a } = await dois(t);
  fs.mkdirSync(NOTAS(pasta), { recursive: true });
  fs.writeFileSync(path.join(NOTAS(pasta), 'indice.json'), '{"versao":1,"notas":{');
  await assert.rejects(a.sefaz.notas(), e => e.status === 503 && /indice\.json da pasta compartilhada das notas está danificado/.test(e.message));
  await assert.rejects(a.sefaz.importada(CHAVE_A), e => e.status === 503 && /danificado/.test(e.message));
  assert.equal(fs.readFileSync(path.join(NOTAS(pasta), 'indice.json'), 'utf8'), '{"versao":1,"notas":{', 'intacto');
  assert.ok(!fs.existsSync(TRAVA(pasta)));
  const st = await a.sefaz.status();
  assert.equal(st.compartilhada.acessivel, false);
  assert.ok(st.avisos.some(x => /danificado/.test(x)));
});

// ---------------------------------------------------------------- (g) sem pastaCompartilhada
test('(g) sem pastaCompartilhada: tudo no disco do PC, sem trava de arquivo, status diz compartilhada.ativa=false', async t => {
  const a = await servico(t, undefined, 'PC-A');
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000001', maxNSU: '000000000000001', docs: [doc('000000000000001', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  await a.sefaz.sincronizar();
  await a.sefaz.importada(CHAVE_B);
  assert.ok(fs.existsSync(path.join(a.dir, 'Servico', 'sefaz.estado.json')));
  assert.ok(fs.existsSync(path.join(a.dir, 'NFe', 'Entrada_Homologacao', `${CHAVE_B}.xml`)));
  const st = await a.sefaz.status();
  assert.deepEqual(st.compartilhada, { ativa: false });
  assert.equal(st.pasta, path.join(a.dir, 'NFe', 'Entrada_Homologacao'));
  const todos = [];
  const andar = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andar(p); else todos.push(e.name); } };
  andar(a.dir);
  assert.ok(!todos.some(n => n.includes('sefaz.trava') || n.endsWith('.tmp')), todos.join(','));
});

// ---------------------------------------------------------------- (h) importada concorrente
test('(h) "importada" em paralelo nos dois PCs: nenhuma atualização do índice se perde', async t => {
  const { pasta, a, b } = await dois(t, { esperaTrava: { longa: 150, curta: 5000 } });
  const chaves = Array.from({ length: 8 }, (_, i) => A.gerarChave({ numero: 700 + i }));
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000008', maxNSU: '000000000000008',
    docs: chaves.map((c, i) => doc(String(i + 1).padStart(15, '0'), A.procNFe({ chave: c, dest: CNPJ, numero: String(700 + i) }))) }) });
  await a.sefaz.sincronizar();
  const pedidos = [];
  for (const c of chaves) { pedidos.push(a.sefaz.importada(c)); pedidos.push(b.sefaz.importada(c)); }
  const r = await Promise.allSettled(pedidos);
  assert.deepEqual(r.filter(x => x.status === 'rejected').map(x => x.reason.message), []);
  const ind = lerJsonArq(path.join(NOTAS(pasta), 'indice.json'));
  assert.deepEqual(chaves.map(c => ind.notas[c].situacao), chaves.map(() => 'importada'));
  assert.ok(!fs.existsSync(TRAVA(pasta)));
  assert.ok(fs.readdirSync(NOTAS(pasta)).every(n => !n.endsWith('.tmp')));
});

// ---------------------------------------------------------------- PC sem acesso ao certificado
test('PC sem acesso ao .pfx, com a pasta compartilhada: somente consulta (lista, XML e importada), sem falar com a SEFAZ', async t => {
  const { a, b } = await dois(t);
  a.falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000001', maxNSU: '000000000000001', docs: [doc('000000000000001', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  await a.sefaz.sincronizar();
  fs.rmSync(path.join(b.dir, 'empresa.pfx'));                 // o certificado não está acessível no PC B
  const st = await b.sefaz.status();
  assert.equal(st.configurada, true); assert.equal(st.somenteConsulta, true); assert.equal(st.certificado, null);
  assert.equal(st.qtdNotas, 1);
  assert.ok(st.avisos.some(x => /Certificado indisponível neste computador: Não encontrei o arquivo do certificado/.test(x)));
  assert.equal((await b.sefaz.notas()).notas.length, 1);
  assert.match(await b.sefaz.xml(CHAVE_B), /<nfeProc/);
  assert.equal((await b.sefaz.importada(CHAVE_B)).nota.situacao, 'importada');
  await assert.rejects(b.sefaz.sincronizar(), e => e.status === 503 && /certificado/.test(e.message));
  await assert.rejects(b.sefaz.baixar(CHAVE_A), e => e.status === 503);
  assert.equal(b.falsa.pedidos.length, 0);
  // sem pasta compartilhada continua como sempre: sem certificado = não configurada
  const c = await servico(t, undefined, 'PC-C');
  fs.rmSync(path.join(c.dir, 'empresa.pfx'));
  assert.equal((await c.sefaz.status()).configurada, false);
  await assert.rejects(c.sefaz.notas(), e => e.status === 503);
});

// ---------------------------------------------------------------- (i) nada sensível no status
test('(i) status com pasta compartilhada: sem senha, sem caminho do .pfx e sem o caminho completo da pasta', async t => {
  const { pasta, a } = await dois(t);
  const st = JSON.stringify(await a.sefaz.status());
  assert.ok(!st.includes(pfx.senha), 'senha');
  assert.ok(!st.includes('empresa.pfx') && !st.includes(a.dir.replace(/\\/g, '\\\\')), 'caminho do .pfx / pasta do PC');
  assert.ok(!st.includes(path.dirname(pasta).replace(/\\/g, '\\\\')) && !st.includes(path.dirname(pasta)), 'caminho completo da pasta compartilhada');
  assert.ok(st.includes('"pasta":"NFE COMPRAS (SEFAZ)"'));
  assert.ok(!st.includes('BEGIN'));
  // a mensagem de pasta fora do ar também não leva o caminho
  const fora = await servico(t, path.join(a.dir, 'empresa.pfx', 'X'), 'PC-C');
  const e = await fora.sefaz.sincronizar().catch(x => x);
  assert.equal(e.status, 503);
  assert.ok(!e.message.includes(fora.dir) && !e.message.includes('empresa.pfx'));
});
