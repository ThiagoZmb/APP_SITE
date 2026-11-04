# Portal do cliente, etapa 3c: PDF do pedido e DANFE (design)

Data: 2026-11-04. Parte da etapa 3 do spec `2026-11-03-portal-do-cliente-seguranca-design.md` (seção 7, "Documentos"). A 3a (pedidos) e a 3b (financeiro) já estão na main; esta etapa reaproveita o isolamento por empresa delas.

## 1. Objetivo e decisões

O cliente logado, com `documentos.ver`, abre o **PDF do pedido (sem preços)** e o **DANFE (nota fiscal em PDF)** dos pedidos da própria empresa. Só leitura; cada abertura é auditada.

Decisões do dono (04/11/2026): PDF do pedido **sem preços** (modo `verValores=false` que já existe); seguir direto até o fim, sem ciclos de revisão intermediários.

Rulings do controlador (reversíveis): (1) **`OBS_GERAL` não sai no PDF do portal** (pode ter nota interna); (2) o DANFE abre só se a chave estiver entre as notas ligadas **àquele** pedido (vínculo manual ou financeiro, as mesmas fontes de `GET /danfe/pedido/:n`); (3) refatorar as duas rotas internas para compartilhar código com o portal, protegidas pelos testes atuais; (4) limite de abertura por usuário.

## 2. Rotas

Todas por `registro.portal('get', ..., ['documentos.ver'], ...)`, nas listas fixas de `registro.rotasPortal()`:

- `GET /portal/api/pedidos/:numero/documentos` → `{ pdfPedido: true, notas: [{ chave, numeroNf, serie }] }` (lista vazia se não há nota ligada; nunca `semArquivo`, `origem` nem `enviadoEm`).
- `GET /portal/api/pedidos/:numero/pdf` → stream do PDF do pedido.
- `GET /portal/api/pedidos/:numero/danfe/:chave` → stream do PDF da nota.

As duas rotas de arquivo levam limite por usuário (`express-rate-limit`, chave `req.portal.usuarioId`, 30 aberturas por 10 minutos, só em memória; 429 `{ error: 'Muitas aberturas de documento. Aguarde alguns minutos.' }`).

## 3. Isolamento

- A empresa vem só de `req.portal.empresaCodigo`. A posse do pedido é conferida primeiro, em uma consulta: `SELECT p.NUMERO, p.RAZAO_SOCIAL FROM ped_orc p JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL WHERE c.CODIGO = ? AND p.TIPO = 'Pedido' AND p.NUMERO = ? LIMIT 1`.
- Pedido alheio, inexistente, orçamento, `:numero` mal formado (`numeroValido`), `:chave` inválida (`lerChave`) e chave que não está entre as notas ligadas ao pedido respondem o **mesmo 404** `{ error: 'Documento não encontrado.' }` (status, corpo e cabeçalhos idênticos).
- Nenhum DANFE é buscado só pela chave.

## 4. PDF do pedido

- Mesmo gerador `pdf/ped_orc.js` (`desenharPedOrc`) com `{ verValores: false, producao: false }`. Além disso, defesa em profundidade: `SUB_TOTAL`, `TOTAL`, `DESCONTO` e `OBS_GERAL` do cabeçalho e os campos `UNITARIO`, `VALOR_UNITARIO`, `VALOR_TOTAL`, `VALOR`, `SUB_TOTAL`, `TOTAL`, `DESCONTO` dos itens e complementos são zerados antes de desenhar (teste: nenhum valor sentinela chega ao gerador).
- Nunca a guia de produção, nunca orçamento, nunca PDF de vidros. Desenhos das portas (PNG validado com o carimbo) seguem como na rota interna.

## 5. Serviço dos arquivos

`Content-Type: application/pdf`, `Content-Disposition: inline; filename="Pedido-<n>.pdf"` ou `"NF-<numeroNf>.pdf"` (só dígitos), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` e `Content-Security-Policy: sandbox` (DANFEs são PDFs enviados por pessoas e saem da mesma origem do portal).

## 6. Auditoria

Cada abertura bem-sucedida grava `auditarPortal(..., { evento: 'documento_aberto', usuarioId, clienteCodigo, ip, detalhe })`, detalhe `tipo=pdf;pedido=<n>` ou `tipo=danfe;pedido=<n>;nf=<numeroNf>` (nunca a chave inteira nem valores). Falha de gravação não impede a abertura. A listagem `/documentos` não é auditada (não entrega documento). Retenção: os 12 meses de `limparPortal`.

## 7. Refatorações (comportamento idêntico, protegidas pelos testes atuais)

- `rotas/danfe_ligacao.js`: `criarLigacaoDanfe({ pool }) -> { cnpjEmpresa(db), notasDoFinanceiro(db, pedido, empresa), pedidosDaNota(d, empresa), notasDoPedido(numero) -> { notas: [{ chave, numeroNf, serie, origem, enviadoEm }], semArquivo: number[] } }`, extraído de `rotas/danfe.js`, que passa a usá-lo (`GET /danfe/pedido/:n` mantém a mesma resposta).
- `pdf/carregar_ped_orc.js`: `carregarCabecalhoPedOrc(pool, numero, tipo) -> cab|null` e `carregarCorpoPedOrc(pool, { numero, tipo, cab, producao }) -> { itens, v4, serr, comps, compSerr, furos, medicao, desenhos }`, extraídos de `GET /dados_pdf` em `index.js`, que passa a usá-los (mesma ordem: cabeçalho, checagem de estados, depois o corpo).

## 8. Tela

`portal/public/pedido.html` + `pedido.js` (`?numero=N`, número validado com `/^\d{1,9}$/`): status do pedido (rota de detalhe da 3a, que ganha tela) e, só com `documentos.ver` em `/portal/api/eu`, os botões "PDF do pedido" e "Nota fiscal NF <n>" (um por nota). Os botões abrem o arquivo numa nova aba por `<a target="_blank" rel="noopener">` com href montado só de número validado (nunca de texto do servidor além do número da nota e da chave de 44 dígitos validados por regex). Na lista (`pedidos.js`) o número do pedido vira link para `pedido.html?numero=N`. Sem script nem estilo inline, `textContent`.

## 9. Testes (resumo; detalhes no plano)

Isolamento com 2 empresas e prova de mutação; 404 idêntico; DANFE só de nota ligada ao pedido da empresa (e nota de outra empresa, ligada a pedido alheio, nunca); PDF sem preços (valores sentinela e `OBS_GERAL` não chegam ao gerador; `verValores=false`); cabeçalhos dos arquivos; auditoria só no 200; limite 429; 403 sem `documentos.ver`; refatorações com os testes `danfe_*` e `pdf_*` existentes verdes; páginas novas sob a CSP do portal.

## 10. Fora do escopo

Guia de produção, orçamentos, PDF de vidros, notas sem arquivo enviado, download em lote, preços no PDF, criação de usuários (etapa 4).

## 11. Não testável aqui

MySQL real (consultas só em banco falso), o PDF e o DANFE abertos num navegador real, o gerador `pdfkit` com dados reais de produção. Entra no roteiro da seção 12 de `docs/portal_configuracao.md`.
