# Changelog

## 0.1.0 — 2026-10-26

Primeira versão: núcleo comum, independente de domínio e de PDF.

- Contrato `ValorRastreavel` e schema `projeto-tecnico` 1.0.0 (JSON Schema draft-07).
- Validação (schema + 7 regras semânticas) com erros apontando o caminho JSON.
- Construtores `confirmado`, `inferido`, `ausente`, `conflitante`, `calculado` e `confirmarHumano`.
- Unidades: conversão exata para mm (mm, cm, m, pol), números pt-BR com detecção de ambiguidade, leitura de cotas.
- Verificação cruzada: soma de cotas (tolerância 0 mm, pendente de aprovação) e contagens.
- Detecção de texto suspeito (injeção de prompt) em texto de PDF.
- Relatório em Markdown determinístico e CLIs `validar-projeto.mjs` e `gerar-relatorio.mjs`.
- Não incluído: extração de PDF, regras de portas, cálculo de peças, plano de corte.
