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
