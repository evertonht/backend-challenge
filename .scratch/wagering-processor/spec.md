Status: ready-for-agent

# Spec — Distributed Wagering Processor

> Spec de implementação do Distributed Wagering Processor. A fonte da verdade das decisões é `ARCHITECTURE.md`; o vocabulário é o de `CONTEXT.md`; a especificação de requisitos é o `README.md` (citado por seção). Este documento consolida o *o quê* construir e *como* testar.

## Problem Statement

Um provedor de jogos precisa processar operações de aposta (`BET → WIN | LOSS | REFUND | ROLLBACK`) sobre wallets de jogadores, de forma **financeiramente correta** sob condições hostis: entrega at-least-once, mensagens duplicadas, chegada fora de ordem e múltiplas instâncias tocando a mesma wallet ao mesmo tempo. Hoje não existe sistema; qualquer implementação ingênua duplicaria créditos/débitos, permitiria saldo negativo ou perderia eventos confirmados. O candidato precisa entregar um serviço que mantenha os invariantes globais — sem crédito duplicado, sem débito duplicado, sem eventos confirmados perdidos, sem saldo negativo — e que documente as decisões que sustentam essa correção.

## Solution

Construir o serviço NestJS (Bun 1.x + TypeScript estrito + PostgreSQL + SQS via MiniStack) descrito em `ARCHITECTURE.md`: um agregado `Wallet` com ledger imutável, idempotência persistente, lock pessimista por wallet, inbox/outbox transacional para mensageria at-least-once, uma API HTTP e um consumidor SQS que convergem no mesmo caso de uso, e um endpoint de reconciliação. A correção é garantida no schema (constraints), no agregado (invariantes) e no limite transacional (atomicidade §11) — nunca por convenção ou por cache em memória.

## User Stories

**Wallets**

1. Como provedor, quero criar uma wallet para um jogador com um saldo inicial, para que o jogador possa começar a apostar.
2. Como provedor, quero que criar uma wallet duplicada para o mesmo `playerId` + moeda falhe como conflito, para não criar dois saldos para o mesmo jogador na mesma moeda.
3. Como provedor, quero que um saldo inicial maior que zero gere uma transação interna `OPENING` com o lançamento `CREDIT` correspondente na mesma transação SQL, para que o ledger seja completo desde o primeiro centavo.
4. Como provedor, quero consultar o saldo e a versão atuais de uma wallet, para exibir o saldo ao jogador.

**Submissão de operações**

5. Como provedor, quero submeter um `BET`, para que o saldo do jogador seja debitado.
6. Como provedor, quero que um `BET` com saldo insuficiente seja rejeitado, para que o jogador não aposte mais do que possui.
7. Como provedor, quero submeter um `WIN`, para que o saldo do jogador seja creditado.
8. Como provedor, quero submeter um `LOSS`, para que o resultado seja registrado sem mover saldo.
9. Como provedor, quero submeter um `REFUND` que reverta um `BET` `PROCESSED` uma única vez, para devolver uma aposta cancelada.
10. Como provedor, quero submeter um `ROLLBACK` que reverta uma transação `PROCESSED` uma única vez, para corrigir uma operação indevida.
11. Como provedor, quero que `REFUND` e `ROLLBACK` exijam uma referência, para que o sistema saiba exatamente o que reverter.
12. Como provedor, quero que uma reversão cuja referência ainda não chegou seja estacionada como pendente e aplicada depois, para que a entrega fora de ordem não perca a reversão.
13. Como provedor, quero que uma reversão que produziria saldo negativo seja rejeitada com um `failureCode` distinto do de uma aposta sem saldo, para distinguir as duas situações operacionais.
14. Como provedor, quero que uma reversão não referencie um tipo inválido (ex.: `REFUND` sobre `WIN`), para que o sistema rejeite operações semanticamente inválidas.

**Idempotência**

15. Como provedor, quero reenviar uma operação idêntica e receber o resultado original com `idempotentReplay: true`, para que a entrega at-least-once seja segura.
16. Como provedor, quero que reenviar a mesma chave de idempotência com um payload diferente seja rejeitado como conflito, para detectar corrupção ou divergência de payload.

**Consultas**

17. Como provedor, quero consultar uma transação pelo seu id interno, para acompanhar o estado de uma operação.
18. Como provedor, quero consultar uma transação por `(providerId, externalTransactionId)`, para localizar uma operação pela minha chave.
19. Como provedor, quero paginar o ledger de uma wallet com um cursor estável e opaco, para auditar o histórico completo sem duplicar ou pular lançamentos.
20. Como operador, quero reconciliar uma wallet (saldo armazenado × saldo calculado pela soma do ledger), para detectar divergências — que devem ser sinalizadas, logadas e contabilizadas, nunca corrigidas silenciosamente.

**Mensageria**

21. Como provedor, quero enviar operações via SQS e que elas sejam processadas pelo mesmo caso de uso da entrada HTTP, para ter um único caminho de negócio.
22. Como provedor, quero que mensagens SQS duplicadas sejam deduplicadas de forma persistente, para que a redelivery não aplique o efeito duas vezes.
23. Como operador, quero que mensagens que esgotam as tentativas sejam movidas para a DLQ, para que falhas permanentes fiquem auditáveis.
24. Como operador, quero que o sistema se recupere após uma queda (antes/depois do commit, antes/depois do ack), para que nenhum evento confirmado seja perdido.
25. Como operador, quero que o desligamento (`SIGTERM`) conclua as mensagens em voo ou as devolva à visibility, para nunca perder trabalho em andamento.

**Eventos de integração**

26. Como consumidor downstream, quero receber `WagerTransactionProcessed` quando uma operação é aplicada (inclusive `LOSS`), para reagir a operações efetivadas.
27. Como consumidor downstream, quero receber `WagerTransactionRejected` quando uma operação é rejeitada por regra de negócio, para tratar rejeições.
28. Como consumidor downstream, quero receber `WalletBalanceChanged` somente quando o saldo muda, para reagir a mudanças reais de saldo.
29. Como consumidor downstream, quero receber `WagerTransactionPendingReference` quando uma referência está ausente, para saber que uma reversão está aguardando.

**Concorrência e correção**

30. Como provedor, quero que apostas concorrentes sobre a mesma wallet sejam serializadas corretamente, para que exatamente uma vença quando o saldo é insuficiente.
31. Como operador, quero que o sistema permaneça correto com três ou mais instâncias simultâneas, para suportar escala horizontal.
32. Como operador, quero que wallets distintas processem em paralelo, para não serializar o sistema inteiro.

**Observabilidade**

33. Como operador, quero logs estruturados (JSON) com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`, para rastrear uma operação ponta a ponta.
34. Como operador, quero métricas de transações por status, duplicatas detectadas, retries, mensagens na DLQ, conflitos de lock, outbox lag e latência, para diagnosticar o sistema.
35. Como operador, quero health checks separados de liveness e readiness (sem autenticação), para orquestração e monitoramento.

## Implementation Decisions

**Stack (fixada por §4):** Bun 1.x, TypeScript estrito, NestJS, PostgreSQL, SQS via MiniStack, Docker Compose, migrations versionadas e reversíveis.

**ORM — MikroORM.** Unit of Work + Identity Map explícitos, `EntityManager.transactional()` e `LockMode` são a base da atomicidade (§11) e do lock por wallet (§8). TypeORM rejeitado (sem ganho, mais disciplina); Prisma fora de escopo.

**Dinheiro — `big.js` atrás de `Money`.** `Money` é imutável, encapsula um `Big` privado, e só expõe `add`/`subtract`/`negate` (exatas por construção). Validação em `Money.from` via regex `^\d+(?:\.\d{1,2})?$`; serialização `toFixed(2)` para escala fixa de 2 casas. Persistência em `amount numeric(20,2)` + `currency text`, reidratando via `Money.from` (o driver `pg` retorna `numeric` como string). Nunca `number` JS.

**Identificadores — UUIDv7**, gerados na aplicação via porta `IdGenerator`, armazenados em coluna `uuid`.

**Concorrência — lock pessimista por wallet.** Dentro da transação, o primeiro statement é `SELECT … FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) sobre a linha da wallet. A unidade atômica (saldo + lançamento + status da transação + inbox/outbox) comita sob o lock. Lock por linha, não global.

**Idempotência — persistente.** `payload_hash` = SHA-256 (hex) do JSON canônico (chaves ordenadas) do subconjunto de negócio (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId` quando presente). Mesma key + mesmo hash → replay; mesma key + hash diferente → conflito (409).

**Schema (§5.9) — invariantes no banco:**

- `wallet`: `UNIQUE (player_id, currency)`; `CHECK (balance >= 0)`; `version int`.
- `wager_transaction`: `UNIQUE (idempotency_key)`; `UNIQUE (provider_id, external_transaction_id)`; `attempts` + `next_attempt_at` para referência pendente.
- `wallet_ledger_entry` (imutável): `UNIQUE (transaction_id)`; `CHECK` aritmético `(direction='CREDIT' AND balance_after = balance_before + amount) OR (direction='DEBIT' AND balance_after = balance_before - amount)`; role da aplicação com apenas `SELECT`+`INSERT` (sem `UPDATE`/`DELETE`).
- `inbox_message`: `UNIQUE (consumer_name, message_id)`.
- `outbox_message`: índice parcial `(next_attempt_at) WHERE published_at IS NULL`.

**Máquina de estados da transação** (vinda do §6.3; transições terminais são irreversíveis):

```
PENDING ──► PROCESSED          (aplicada; terminal)
   ├─────► PENDING_REFERENCE   (aguardando a transação referenciada)
   │           ├──► PROCESSED  (referência chegou → aplica)
   │           └──► REJECTED   (referência nunca chegou → REFERENCE_NOT_FOUND)
   ├─────► REJECTED            (regra de negócio; terminal)
   └─────► FAILED              (erro permanente de infra; terminal)
```

`OPENING` é interno (não submetível). `PROCESSED`/`REJECTED`/`FAILED` não mudam mais de estado.

**Mensageria de entrada (SQS).** Filas `wager-transactions.fifo` + `wager-transactions-dlq.fifo`. Consumidor reutiliza o caso de uso HTTP; dedup via inbox; ack só após commit; classificação: rejeição de negócio → ack, transitório → visibility + backoff, permanente/malformado → `maxReceiveCount` → DLQ; `PENDING_REFERENCE` → ack. `SIGTERM` drena ou devolve à visibility.

**Referência pendente.** Worker agendado (~30 s) com `FOR UPDATE SKIP LOCKED` + lock da wallet; backoff `30s × 2^n` (teto 10 min); máximo 8 tentativas ou TTL 24 h; esgotado → `REJECTED` com `REFERENCE_NOT_FOUND` + evento.

**Mensageria de saída (outbox).** Eventos gravados na mesma transação da mudança financeira; worker com polling + `FOR UPDATE SKIP LOCKED`; at-least-once (claim → publish → mark, em transações curtas); backoff + teto de tentativas; destino `wager-events.fifo` (configurável).

**API HTTP.** `400` payload inválido, `409` conflito de idempotência, `422` rejeição de negócio (corpo com `failureCode`), `202` pendente, `503` transitório; `201`/`409` para wallets; `404` para leituras ausentes. Replay devolve status/corpo originais + `idempotentReplay: true`. Envelope de erro `{ "error": { "code", "message", "details" } }`.

**Códigos de falha.** 12 códigos: `INVALID_PAYLOAD`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND`, `CURRENCY_MISMATCH`, `INSUFFICIENT_BALANCE`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_VALUE_MISMATCH`, `REFERENCE_INVALID_KIND`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_NOT_PROCESSED`.

**Cursor do ledger.** Paginação keyset sobre `(created_at, id)`, cursor opaco base64url.

**Arquitetura de módulos.** Quatro camadas (dependências para dentro): `domain` (puro, zero dependências) → `application` (casos de uso + portas + limite transacional) → `infrastructure` (MikroORM, SQS, workers, migrations) / `interface` (HTTP + consumidor SQS). Sete portas: `WalletRepository`, `WagerTransactionRepository`, `LedgerEntryRepository`, `OutboxWriter`, `IdGenerator`, `Clock`, `UnitOfWork`.

## Testing Decisions

**O que faz um bom teste:** testar o comportamento externo — saldo final, entradas do ledger, status/`failureCode` da transação e eventos publicados — e não detalhes de implementação. O invariante final de todo teste é `wallet.balance == saldo reconstruído pelo ledger`.

**Seams:** o caso de uso (camada `application`) é o seam primário de comportamento; o domínio (camada `domain`) é o seam de testes unitários; o transporte (HTTP/SQS) é testado de forma fina (roteamento, mapeamento de status, envelope, ack/DLQ). Os adaptadores MikroORM/Postgres + MiniStack são usados em integração/concorrência com **containers reais** — sem mocks (§13 proíbe substituir PostgreSQL e SQS por mocks).

**Testes unitários (domínio):** operações e validações de `Money` (escala, arredondamento, entradas inválidas); invariantes da `Wallet`; regras de `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`; conflito de moeda; chave de idempotência com payload divergente; máquina de estados da `WagerTransaction`.

**Testes de integração (PostgreSQL + MiniStack reais):** migrations e constraints; atomicidade entre wallet, ledger, inbox e outbox; inbox e redelivery; publishers concorrentes sobre a mesma outbox; retry e DLQ; recuperação após reinicialização.

**Testes de concorrência (paralelismo real):** a mesma aposta enviada 50 vezes em paralelo → um único débito; duas apostas disputando o mesmo saldo (cenário §8: 100.00, dois `BET` 80.00 → um `PROCESSED`, um `REJECTED`, saldo 20.00, um lançamento de débito); wallets distintas em paralelo; ≥3 processos/instâncias; worker morto depois do commit e antes do ack; dois publishers sobre a mesma outbox; `ROLLBACK`/`REFUND` entregue antes da referência; reinício do serviço com comprovação de consistência final.

## Out of Scope

- **Autenticação** (§2) — fora de escopo; pode-se deixar um `AuthGuard` no-op / `ProviderIdentityPort` como ponto de extensão, mas nenhum mecanismo de auth é implementado.
- **Teste de carga** (§14, diferencial opcional) — fora de escopo.
- **Consumidor downstream dos eventos de outbox** — os eventos são publicados em `wager-events.fifo`; nenhum consumidor é construído neste challenge.

## Further Notes

- Runtime em moeda única **BRL**; o modelo permanece multi-moeda e os conflitos de moeda são testados (§6.1).
- `ARCHITECTURE.md` é a fonte da verdade das decisões e trade-offs; `CONTEXT.md` define o vocabulário do domínio; o mapa em `.scratch/wagering-processor/map.md` rastreia cada decisão ao seu ticket.
- As decisões de tuning (valores exatos de `maxReceiveCount`, visibility timeout, teto de tentativas do outbox, lock timeout) são constantes de build, não decisões de arquitetura.
