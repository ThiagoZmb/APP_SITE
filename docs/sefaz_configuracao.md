# Notas de compra pela SEFAZ: configuração no PC da empresa

O sistema web acha na SEFAZ as NF-e emitidas contra o CNPJ da empresa e importa o XML na entrada de estoque.
Quem fala com a SEFAZ é o **serviço local** deste PC (o mesmo que grava os PDFs). O certificado digital A1 (.pfx)
e a senha **ficam só neste PC**: nunca vão para o servidor (Render), para o GitHub, para o navegador nem para o chat.

## 1. Instalar ou atualizar o serviço local

1. Na pasta `local` do sistema, dê duplo clique em `instalar_salvador_pdf.bat`.
2. Ele instala o Node.js se faltar, copia o serviço para `C:\Programa Elegance\Servico`, baixa os componentes da
   SEFAZ (precisa de internet nesse momento), liga o serviço e faz ele iniciar com o Windows.
3. No fim deve aparecer `PRONTO`. Pode rodar de novo sempre que o sistema for atualizado (a configuração não é apagada).

## 2. Colocar o certificado

1. Crie a pasta `C:\Programa Elegance\Certificado`.
2. Copie para ela o arquivo do certificado A1 da empresa (`.pfx` ou `.p12`), por exemplo `empresa.pfx`.
3. Só administradores do PC deveriam ter acesso a essa pasta (botão direito > Propriedades > Segurança).

## 3. Criar o `sefaz.config.json`

1. Em `C:\Programa Elegance\Servico`, copie `sefaz.config.exemplo.json` e renomeie a cópia para `sefaz.config.json`.
2. Abra no Bloco de Notas e preencha (exemplo SEM dados reais):

```json
{
  "cnpj": "00000000000000",
  "uf": "SP",
  "ambiente": "homologacao",
  "certificado": "C:\\Programa Elegance\\Certificado\\empresa.pfx",
  "senha": "COLOQUE-A-SENHA-AQUI-SOMENTE-NESTE-PC"
}
```

- `cnpj`: CNPJ da empresa (só números ou com pontuação).
- `uf`: sigla do estado da empresa (vira o `cUFAutor`).
- `ambiente`: `homologacao` (teste) ou `producao`.
- `certificado`: caminho completo do `.pfx`, com barras duplas `\\`.
- `senha`: senha do certificado. **Alternativa**: deixe `"senha": ""` e crie a variável de ambiente do Windows
  `ELEGANCE_SEFAZ_SENHA` com a senha (Painel de Controle > Sistema > Variáveis de ambiente, do usuário que roda o
  serviço); a variável vale mais que o arquivo. Depois de criar a variável, reinicie o Windows.
- Opcional: `"cadeiaSefaz": "C:\\Programa Elegance\\Certificado\\cadeia_sefaz.pem"` só se a tela disser que o
  certificado do servidor da SEFAZ não foi reconhecido neste PC (arquivo `.pem` com a cadeia ICP-Brasil).
- Opcional: `"pastaCompartilhada"`: deixe `""` (vazio) se só um computador usa as notas de compra. Para usar em
  vários computadores, veja a seção 6.

Nunca envie esse arquivo, a senha ou o `.pfx` por e-mail, WhatsApp ou chat, e não os coloque na pasta do GitHub.

## 4. Testar primeiro em homologação

1. Com `"ambiente": "homologacao"`, abra no sistema **Estoque > Notas de compra (SEFAZ)** neste PC.
2. O quadro de cima deve mostrar `Homologação (teste)`, o CNPJ e a validade do certificado. Se aparecer
   "SEFAZ não configurada", a mensagem diz o que falta (arquivo, CNPJ, senha errada, certificado vencido...).
3. Clique em **Sincronizar com a SEFAZ**. Em homologação normalmente não há notas; o importante é não dar erro de
   certificado. As notas de teste ficam em `C:\Programa Elegance\NFe\Entrada_Homologacao`, separadas das reais.
4. Funcionou: troque para `"ambiente": "producao"` e sincronize de novo. As notas reais ficam em
   `C:\Programa Elegance\NFe\Entrada`.

## 5. Uso no dia a dia

- **Sincronizar**: traz o resumo das notas novas. Se a SEFAZ responder que não há nada novo, ela só aceita nova
  busca 1 hora depois; a tela mostra o horário liberado. Insistir antes disso bloqueia a empresa por 1 hora.
- **Ciência da operação**: manifestação oficial da empresa como destinatária (feita com o certificado). Libera o XML
  completo; não confirma nem recusa a compra. Pode ser feita por nota ou para até 20 selecionadas.
- **Baixar XML**: busca a nota completa pela chave (no máximo 20 por hora). Depois da ciência, o XML costuma ficar
  disponível em alguns minutos (ou chega sozinho na próxima sincronização).
- **Importar na entrada de estoque**: abre a Entrada de nota já preenchida com o XML; confira e lance como sempre.
  Ao lançar, a nota fica marcada como "Importada".

## 6. Vários computadores usando as mesmas notas

Sem configuração extra, cada computador guarda as notas e o "ponteiro" da fila da SEFAZ no próprio disco
(`C:\Programa Elegance\NFe\...` e `sefaz.estado.json`). Aí a lista fica vazia nos outros computadores e, pior, dois
computadores consultando a SEFAZ com o mesmo CNPJ fazem a SEFAZ bloquear **a empresa toda** por 1 hora
("consumo indevido", 656).

A solução é uma **pasta compartilhada** na rede onde ficam, para todos os computadores: as notas (XML), a lista
(`indice.json`), o ponteiro da fila e as esperas de 1 hora (`sefaz.estado.json`) e a trava (`sefaz.trava`).

### Como a pasta fica organizada

Chamando de `XML SEFAZ` a pasta configurada:

```
XML SEFAZ\
  <chave>-nfe.xml                  XML das notas reais (produção); mesmo padrão de nome da contabilidade
  _Homologacao\<chave>-nfe.xml     XML de teste (homologação), separado das notas reais
  _controle\                       controle do sistema: NÃO mexer à mão
      sefaz.estado.json            ponteiro da fila e esperas de 1 hora
      sefaz.trava                  existe só enquanto um computador fala com a SEFAZ
      indice.json                  lista de notas (produção)
      indice_Homologacao.json      lista de notas (homologação)
```

- A pasta `XML SEFAZ` é **nova de propósito**: use uma pasta vazia, **não** as pastas por mês da contabilidade, para os
  arquivos do sistema não se misturarem com os dela.
- A pasta `_controle` não deve ser aberta, renomeada, movida nem apagada à mão (veja os cuidados mais abaixo). Os XML
  podem ser consultados e copiados à vontade.
- O serviço lê também XML com o nome antigo `<chave>.xml`, mas grava sempre `<chave>-nfe.xml`. Se já existir um
  `<chave>-nfe.xml` válido (por exemplo, colocado pela contabilidade), ele é mantido e não é sobrescrito.

### Como configurar

1. Crie uma pasta nova e vazia no servidor que todos os computadores enxergam, por exemplo
   `\\pc-serverdell\SERVIDOR ELEGANCE\SIMONE\NFE ENTRADA Fornecedores\XML SEFAZ`. Os usuários do Windows que
   usam o sistema precisam poder **ler e gravar** nela. Ela pode começar vazia; o serviço cria `_controle` e
   `_Homologacao`.
2. **Não** coloque o `.pfx`, a senha nem o `sefaz.config.json` dentro dessa pasta: ela guarda só notas, estado e trava.
3. No `sefaz.config.json` de **cada** computador acrescente a linha `pastaCompartilhada` com **o mesmo caminho em
   todos**:

```json
{
  "cnpj": "00000000000000",
  "uf": "SP",
  "ambiente": "producao",
  "certificado": "\\\\pc-serverdell\\SERVIDOR ELEGANCE\\SIMONE\\CERTIFICADO DIGITAL NFE\\empresa.pfx",
  "senha": "COLOQUE-A-SENHA-AQUI-SOMENTE-NESTE-PC",
  "pastaCompartilhada": "\\\\pc-serverdell\\SERVIDOR ELEGANCE\\SIMONE\\NFE ENTRADA Fornecedores\\XML SEFAZ"
}
```

> **ATENÇÃO ÀS BARRAS.** Dentro do arquivo JSON **cada barra invertida é escrita duas vezes**. O caminho de rede
> começa com duas barras (`\\pc-serverdell`), então no JSON ele começa com **quatro**: `"\\\\pc-serverdell\\..."`.
> Escrever só duas no começo (`"\\pc-serverdell\\..."`) é o erro mais comum (já aconteceu): o Windows leria isso como
> uma pasta do disco `C:`. O serviço recusa esse caminho e a tela mostra "o caminho de rede precisa começar com DUAS
> barras invertidas". Uma letra de unidade mapeada também é aceita (`"Z:\\NFE ENTRADA Fornecedores\\XML SEFAZ"`), mas o caminho de rede
> é mais seguro, porque a letra pode não existir quando o serviço inicia.

4. `cnpj`, `uf`, `ambiente`, `certificado` e `senha` também devem ser **iguais em todos** os computadores. O `.pfx`
   precisa ser aberto só pelo computador que **sincroniza / baixa XML / dá ciência**. Um computador que não alcança o
   certificado (ou não tem a senha certa) fica em **"Somente consulta"**: vê a lista, abre o XML e importa na entrada de
   estoque, mas os botões que falam com a SEFAZ ficam travados. Mesmo assim ele precisa do `sefaz.config.json` completo
   (o serviço confere todos os campos).
5. Não é preciso reiniciar o serviço: a configuração é relida a cada operação.

### Em que ordem ligar (migração)

1. **Primeiro**, ligue no computador que **já vinha sincronizando** (o que tem as notas no disco). Abra a tela
   **Notas de compra (SEFAZ)** nele: na primeira vez o serviço **copia** para a pasta compartilhada o ponteiro da fila,
   a lista e os XML desse computador (os XML passam a se chamar `<chave>-nfe.xml`; não apaga nada do disco local e não
   sobrescreve arquivos que já estejam lá).
   A tela mostra "Notas compartilhadas com os outros computadores".
2. **Depois**, ligue nos outros. Como a pasta compartilhada já tem dados, eles **não** copiam nada do disco deles (para
   não misturar duas filas): passam a usar a da pasta. As notas antigas que só estavam no disco desses outros
   computadores continuam lá, fora da lista.
3. Se nenhum computador tinha notas, tanto faz a ordem.

### O que a trava faz

- Antes de falar com a SEFAZ (sincronizar, baixar XML, ciência) ou de mexer na lista (marcar "Importada"), o serviço
  cria o arquivo `sefaz.trava` na pasta `_controle` da pasta compartilhada com o nome do computador, e apaga ao terminar (inclusive quando
  dá erro ou quando a SEFAZ manda esperar).
- Se outro computador estiver no meio de uma consulta, a tela mostra (em amarelo, não é erro) "Outro computador (NOME)
  está falando com a SEFAZ neste momento. Aguarde e tente de novo." Marcar "Importada" espera até uns 5 segundos antes
  de desistir (e, se desistir, tenta de novo na próxima vez que a tela abrir).
- As regras da SEFAZ valem para a empresa toda: se um computador acabou de sincronizar e a SEFAZ disse "nada novo",
  os outros também recebem "próxima consulta liberada às HH:MM", **sem** consultar a SEFAZ.

### Trava abandonada

Se um computador desligar ou perder a rede no meio de uma consulta, a trava fica na pasta. Depois de **20 minutos**
ela é considerada abandonada e o próximo computador a usa normalmente (a tela avisa "Uma trava abandonada do
computador NOME foi retomada"). Se o próprio computador que caiu voltar antes disso, ele retoma a trava na hora.
Não precisa fazer nada; só em último caso, com **todos** os computadores fora da tela de notas, apague o arquivo
`sefaz.trava` da pasta `_controle`.

### Se a pasta não estiver acessível

Se o servidor estiver desligado, a rede cair ou faltar permissão, a tela mostra "Não consegui acessar a pasta
compartilhada das notas…" e nada é feito. O serviço **nunca** usa o disco local no lugar dela (isso criaria duas filas
e o bloqueio 656). Quando a pasta voltar, é só clicar em **Atualizar**.

Se aparecer que `indice.json` (ou `indice_Homologacao.json`) ou `sefaz.estado.json` "está danificado", restaure o
arquivo de uma cópia de segurança do servidor (todos ficam em `_controle`). Em último caso, apagar `sefaz.estado.json`
faz a próxima sincronização buscar de novo todo o histórico (pode levar a uma espera de 1 hora da SEFAZ); apagar o
índice esvazia a lista até a próxima sincronização.

### Cuidados

- Mantenha o **relógio** dos computadores certo (o Windows acerta sozinho pela internet): a trava e as esperas de 1 hora
  usam o horário de quem gravou.
- Se o antivírus bloquear a troca de arquivos na pasta (o serviço grava num temporário e renomeia), coloque a pasta
  compartilhada como exceção dele.
- Para voltar ao modo de um computador só, deixe `"pastaCompartilhada": ""`. As notas que estão na pasta compartilhada
  não voltam sozinhas para o disco local.
