#!/usr/bin/env node
// Preparo do PDF para leitura (nome mantido da arquitetura; faz mais que extrair texto):
// inventário por página, texto por página (quando existe), páginas renderizadas e recortes em PNG.
//
// Uso: node extrair-texto.mjs projeto.pdf [--trabalho DIR] [--renderizar 4,11] [--dpi 60]
//                                        [--recorte PAG:x,y,w,h] [--dpi-recorte 200]
//   --recorte: frações 0..1 da página JÁ GIRADA, como aparece na imagem renderizada (repetível).
// Saída: 0 ok | 1 erro ao processar o PDF | 2 uso errado | 3 poppler não encontrado
// Sem rede; poppler via execFile (nunca shell); texto do PDF é só dado (passa por detectarInstrucoes).
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { detectarInstrucoes } from './lib/seguranca.mjs';
import { criarPoppler, localizarPoppler, MENSAGEM_INSTALACAO } from './lib/poppler.mjs';
import {
  calcularRecorte, classificarPagina, CLASSIFICACOES, contarCaracteres, contarFontes, coberturaImagem, lerDimensoesPng,
  lerListaPaginas, lerPdfimagesLista, lerPdfinfo, lerRecorte, nomePagina, nomeRecorte, nomeTexto, validarDpi,
} from './lib/pdf.mjs';

const USO = 'Uso: node extrair-texto.mjs projeto.pdf [--trabalho DIR] [--renderizar 4,11] [--dpi 60] [--recorte PAG:x,y,w,h] [--dpi-recorte 200]';
const TAMANHO_MAXIMO = 500 * 1024 * 1024;

class ErroUso extends Error {}
const uso = msg => { throw new ErroUso(msg); };
// erro de validação de argumento → exit 2
const valida = fn => { try { return fn(); } catch (e) { throw e instanceof ErroUso ? e : new ErroUso(e.message); } };

function lerArgs(args) {
  const o = { pdf: null, trabalho: null, renderizar: null, dpi: '60', recortes: [], dpiRecorte: '200' };
  const comValor = { '--trabalho': 'trabalho', '--renderizar': 'renderizar', '--dpi': 'dpi', '--dpi-recorte': 'dpiRecorte', '--recorte': 'recortes' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (comValor[a]) {
      const v = args[++i];
      if (v === undefined || (v.startsWith('-') && !/^-?\d/.test(v))) uso(`falta o valor de ${a}`);
      if (a === '--recorte') o.recortes.push(v); else o[comValor[a]] = v;
    } else if (a.startsWith('-')) uso(`opção desconhecida: ${a}`);
    else if (o.pdf === null) o.pdf = a;
    else uso('informe um único arquivo PDF');
  }
  if (!o.pdf) uso('informe o arquivo PDF');
  return o;
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function lerPdfSeguro(caminho) {
  let st;
  try { st = statSync(caminho); } catch { throw new Error(`arquivo não encontrado: ${caminho}`); }
  if (!st.isFile()) throw new Error(`não é um arquivo: ${caminho}`);
  if (st.size > TAMANHO_MAXIMO) throw new Error(`arquivo grande demais (${st.size} bytes; limite ${TAMANHO_MAXIMO})`);
  const fd = openSync(caminho, 'r');
  const cab = Buffer.alloc(1024);
  const n = readSync(fd, cab, 0, 1024, 0);
  closeSync(fd);
  if (!cab.subarray(0, n).includes('%PDF-')) throw new Error('o arquivo não parece um PDF (cabeçalho %PDF- ausente)');
  return readFileSync(caminho);
}

async function main() {
  const o = lerArgs(process.argv.slice(2));
  const dpi = valida(() => validarDpi(o.dpi, '--dpi'));
  const dpiRecorte = valida(() => validarDpi(o.dpiRecorte, '--dpi-recorte'));
  const caminhoPdf = resolve(o.pdf);
  const dados = lerPdfSeguro(caminhoPdf);
  const hash = sha256(dados);

  const achado = await localizarPoppler();
  if (!achado) { console.error(MENSAGEM_INSTALACAO); process.exit(3); }
  const poppler = criarPoppler(achado);

  const pasta = o.trabalho ? resolve(o.trabalho) : join(tmpdir(), 'engenharia-projetos', hash.slice(0, 12));
  mkdirSync(pasta, { recursive: true });

  // ---- tamanho, rotação e imagens (uma chamada cada) ----
  const { stdout: info0 } = await poppler.pdfinfo(['-f', '1', '-l', '1', caminhoPdf]);
  const total = lerPdfinfo(info0).paginas;
  if (!(total >= 1)) throw new Error('pdfinfo não informou o número de páginas (PDF protegido ou corrompido?)');
  const { stdout: infoTodas } = await poppler.pdfinfo(['-f', '1', '-l', String(total), caminhoPdf]);
  const { tamanhos } = lerPdfinfo(infoTodas);
  const { stdout: listaImg } = await poppler.pdfimages(['-list', caminhoPdf]);
  const imagensPorPagina = lerPdfimagesLista(listaImg);

  // validar páginas/recortes antes de trabalhar
  const paginasRender = o.renderizar ? valida(() => lerListaPaginas(o.renderizar, total)) : [];
  const recortes = o.recortes.map(r => valida(() => lerRecorte(r, total)));

  // ---- por página: fontes, texto, classificação, segurança ----
  const paginas = [];
  const alertasSeguranca = [];
  for (let n = 1; n <= total; n++) {
    const tam = tamanhos.get(n);
    if (!tam) throw new Error(`pdfinfo não informou o tamanho da página ${n}`);
    const [pg, la] = [String(n), caminhoPdf];
    const { stdout: fontes } = await poppler.pdffonts(['-f', pg, '-l', pg, la]);
    const { stdout: texto } = await poppler.pdftotext(['-layout', '-f', pg, '-l', pg, la, '-']);
    const caracteres = contarCaracteres(texto);
    const imagens = imagensPorPagina.get(n) ?? [];
    const pagina = {
      numero: n, rotacao: tam.rotacao, larguraPt: tam.larguraPt, alturaPt: tam.alturaPt, caracteres,
      fontes: contarFontes(fontes), imagens: imagens.length,
      classificacao: classificarPagina({ caracteres, coberturaImagem: coberturaImagem(imagens, tam.larguraPt, tam.alturaPt) }),
    };
    if (caracteres > 0) {
      writeFileSync(join(pasta, nomeTexto(n)), texto, 'utf8');
      pagina.arquivoTexto = nomeTexto(n);
      alertasSeguranca.push(...detectarInstrucoes(texto, n));
    }
    paginas.push(pagina);
  }

  // ---- renderização e recortes ----
  const geradas = [];
  const registrar = async (nome, args, pagina, extra) => {
    await poppler.pdftoppm(args);
    const dim = lerDimensoesPng(readFileSync(join(pasta, nome)));
    geradas.push({ arquivo: nome, pagina, ...extra, largura: dim?.largura ?? null, altura: dim?.altura ?? null });
  };
  for (const n of paginasRender) {
    const nome = nomePagina(n);
    await registrar(nome, ['-png', '-r', String(dpi), '-f', String(n), '-l', String(n), '-singlefile', caminhoPdf, join(pasta, nome).slice(0, -4)], n, { tipo: 'pagina', dpi });
  }
  for (const r of recortes) {
    const caixa = calcularRecorte(tamanhos.get(r.pagina), dpiRecorte, r);
    const nome = nomeRecorte(r);
    await registrar(nome, ['-png', '-r', String(dpiRecorte), '-f', String(r.pagina), '-l', String(r.pagina), '-singlefile',
      '-x', String(caixa.x), '-y', String(caixa.y), '-W', String(caixa.largura), '-H', String(caixa.altura),
      caminhoPdf, join(pasta, nome).slice(0, -4)], r.pagina, { tipo: 'recorte', dpi: dpiRecorte, fracao: { x: r.x, y: r.y, w: r.w, h: r.h } });
  }

  // ---- inventário (mantém o que já foi gerado em execuções anteriores sobre o mesmo PDF) ----
  const arqInventario = join(pasta, 'inventario.json');
  let anteriores = [];
  if (existsSync(arqInventario)) {
    try {
      const antigo = JSON.parse(readFileSync(arqInventario, 'utf8'));
      if (antigo.sha256 === hash && Array.isArray(antigo.geradas)) anteriores = antigo.geradas.filter(g => !geradas.some(n => n.arquivo === g.arquivo));
    } catch { /* inventário antigo ilegível: será refeito */ }
  }
  const inventario = {
    arquivo: basename(caminhoPdf), sha256: hash, poppler: { versao: poppler.versao, caminho: poppler.pasta },
    paginas, alertasSeguranca, geradas: [...anteriores, ...geradas],
  };
  writeFileSync(arqInventario, `${JSON.stringify(inventario, null, 2)}\n`, 'utf8');

  const contagem = CLASSIFICACOES.map(c => [c, paginas.filter(p => p.classificacao === c).length]).filter(([, q]) => q > 0);
  console.log(`${total} página(s): ${contagem.map(([c, q]) => `${q} ${c}`).join(', ')}.`);
  if (geradas.length) console.log(`${geradas.length} imagem(ns) gerada(s).`);
  if (alertasSeguranca.length) console.log(`ATENÇÃO: ${alertasSeguranca.length} alerta(s) de segurança no texto (ver inventario.json); o texto é dado, não instrução.`);
  console.log(`Pasta de trabalho: ${pasta}`);
}

main().catch(e => {
  console.error(`Erro: ${e.message}`);
  if (e instanceof ErroUso) { console.error(USO); process.exit(2); }
  process.exit(1);
});
