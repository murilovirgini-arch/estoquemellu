# MelLu Inventário

Aplicativo recuperado de `mellu-inventario-v2-foto.zip`, com leitura de EAN,
contagem por local, cadastro por foto com revisão e exportação Excel.

## Estado

**Preparado para homologação. Não publicado nem validado em produção.**

- `npm test`: 29 verificações com PostgreSQL local via Netlify Database Dev
  e execução do código Apps Script contra uma simulação da API Sheets.
- `npm run check` e `npm run build`: aprovados.
- Não foram feitas gravações no banco hospedado ou na planilha real.
- O site atual deve ser preservado até terminar o checklist abaixo.

## Recursos identificados

- Repositório: `murilovirgini-arch/estoquemellu`, produção `main`.
- Netlify: `mellu-estoque`, ID `4b3b2264-31d7-4b58-a47c-2543ad71aa47`.
- O deploy ativo inspecionado era manual, sem funções; conferir a ligação Git
  na configuração antes de habilitar publicação automática.
- A planilha existente foi localizada pela conexão Google Drive. Sua aba
  `Página1` contém registros reais e deve permanecer intacta.
- Inspecionar o Apps Script em uso na conta antes de alterar `doPost`.

## Execução

Node 22.12 ou superior. `npm ci`, `npm test`, `npm run build`.
Para desenvolvimento completo, use Netlify CLI atual e `netlify dev`.
A pasta `.netlify/` está ignorada e não deve entrar no repositório.

## Preservação

As três migrações recuperadas foram mantidas. A quarta adiciona pedidos
idempotentes e uma fila de sincronização; não redefine nem remove tabelas.
Migrações hospedadas são aplicadas exclusivamente pelo deploy Netlify.
Não usar reset, DROP, edição de migrações aplicadas ou DDL direto no banco hospedado.

A base original de 8.140 produtos permanece no pacote recuperado. Foi retirada
de `public/` e não deve entrar neste repositório público. Importe o JSON pela
aba Relatórios depois de configurar o acesso protegido. A importação insere
códigos novos e preserva produtos e contagens existentes.

Correções em `localStorage.mellu_inventory_corrections` permanecem intactas.
Há um botão para baixar esse conteúdo em Relatórios no mesmo dispositivo/origem.
Não são convertidas automaticamente em contagens aditivas: é necessário
reconciliar as quantidades absolutas antigas e os lançamentos por local.
Os registros antigos da planilha permanecem em sua aba original.

## Google Sheets

Variáveis Netlify em escopo Functions, nunca no frontend:

| Variável | Uso |
| --- | --- |
| `INVENTORY_PIN` | Senha forte de acesso; mínimo técnico de 6 caracteres |
| `SHEETS_WEB_APP_URL` | URL `/exec` da implantação conferida do Apps Script |
| `SHEETS_SYNC_SECRET` | Segredo aleatório de pelo menos 32 caracteres |
| `SHEETS_TARGET` | `test` em homologação; `production` somente em produção |

Configure valores separados por contexto. A função também exige
`CONTEXT=production` para escrever no destino de produção.

Adicione `apps-script/MelLuSync.gs` ao projeto existente após revisar e
preservar seu código atual. Configure as Script Properties
`MELLU_SPREADSHEET_ID` (planilha existente) e `MELLU_SYNC_SECRET` (mesmo segredo).
Durante o corte coordenado, encaminhe `doPost(e)` para
`melluHandleSignedPost(e)`. Não crie dois `doPost` no mesmo projeto.

O receptor usa HMAC SHA-256, janela de cinco minutos, bloqueio e deduplicação
por UUID na mesma linha dos dados. EANs são texto; fórmulas são neutralizadas.
Usa abas novas: `Teste de Integração v2` e `Histórico de Inventário v2`.
A aba existente nunca é reformatada ou substituída.

Contagem e fila entram na mesma transação SQL. Falta de confirmação mantém a
pendência; repetir não duplica linhas. A interface distingue gravação no banco
de confirmação na planilha. Uma função agendada tenta pendências a cada cinco
minutos. Também existem `POST /api/inventory?action=sync` e
`GET /api/inventory?action=sync-status`, ambos autenticados.
O responsável é um nome declarado, não uma identidade verificada.

## Antes de publicar — pendente

1. Autorizar acesso às contas Google e Netlify corretas no navegador seguro.
2. Conferir o Apps Script vinculado e guardar cópia do código atual.
3. Confirmar recursos/limites Netlify; não comprar créditos ou planos automaticamente.
   Verificar e preservar qualquer banco provisionado.
4. Conferir migrações hospedadas; criar snapshot do banco existente, quando
   disponível, sem restaurar nem excluir dados.
5. Configurar Git e variáveis por contexto. Não fazer merge em `main` antes
   da homologação nem publicar com variáveis ausentes.
6. Fazer preview com banco isolado e destino Sheets `test`.
7. Conferir na planilha real: gravação, repetição do evento, soma por local,
   correção, acesso negado sem PIN, assinatura inválida e recuperação da fila.
   Comparar banco e aba de teste e confirmar que a aba original não mudou.
8. Testar no smartphone: leitura real de EAN, foto/OCR com revisão e Excel.
   O teste local não valida a câmera física.
9. Reconciliar os dados antigos antes de considerar a nova base completa.
10. Só então fazer merge na produção, verificar deploy, autenticação e leitura.

Não existe validação online concluída nesta entrega. O deploy atual foi mantido.
