# Arquitetura — Distributed Wagering Processor

> Documento de decisões arquiteturais. Complementa o `README.md` (que é a especificação autoritativa, citada por seção). Consolida as decisões registradas no mapa em `.scratch/wagering-processor/map.md` e seus tickets.

## 1. Visão geral

O sistema é um **processador financeiro distribuído** que recebe operações de apostas (`BET → WIN | LOSS | REFUND | ROLLBACK`) de múltiplos provedores de jogos, via **HTTP** e **SQS**, e as aplica a **wallets** de jogadores com garantias de correção financeira: sem crédito/débito duplicado, sem eventos confirmados perdidos e sem saldo negativo.

A postura central é **correção primeiro**: correção financeira (20 pts), concorrência (20), idempotência (15) e mensageria/falhas (15) formam a espinha dorsal (70 pts da rubrica). Autenticação e teste de carga ficam **fora de escopo** (ver §11).

## 2. Stack e decisões-chave

| Área | Decisão | Justificativa |
|---|---|---|
| Runtime / PM / testes | **Bun 1.x** | obrigatório (§4) |
| Linguagem | **TypeScript estrito** | obrigatório (§4) |
| Framework | **NestJS** | obrigatório (§4) |
| Banco | **PostgreSQL** | obrigatório (§4); `numeric` é decimal exato (sem float) |
| Mensageria | **AWS SQS via MiniStack** | ver §2.1 |
| ORM | **MikroORM** | ver §2.2 |
| Dinheiro | **`big.js`** atrás do value object `Money` | ver §2.3 |
| IDs | **UUIDv7**, gerados na aplicação | ver §2.4 |
| Orquestração local | **Docker Compose** | obrigatório (§4) |
| Migrations | versionadas e reversíveis | obrigatório (§4) |

### 2.1 Mensageria — MiniStack (LocalStack × MiniStack)

Escolhemos **MiniStack** (`ministackorg/ministack`) para o SQS local. Ambos atendem todos os requisitos funcionais de §10 (filas FIFO, DLQ com redrive via `maxReceiveCount`, entrega at-least-once via visibility timeout, compatibilidade com AWS SDK v3). O MiniStack vence nos eixos que importam para um challenge com Docker Compose:

- **Zero fricção**: MIT, sem conta/token/telemetria. O LocalStack hoje exige `LOCALSTACK_AUTH_TOKEN` até no tier gratuito.
- **Menor e mais rápido**: imagem ~65 MB, ~30 MB RAM ociosa, ~2 s de startup (vs ~332 MB do LocalStack).
- **Paridade no tier gratuito + persistência**: `PERSIST_STATE=1` e endpoint `/_ministack/reset` para estado limpo por teste.

**Limitação aceita**: o MiniStack implementa 18 das 23 operações SQS — faltam as 4 APIs de *redrive* de DLQ (`StartMessageMoveTask` etc.), que movem mensagens **para fora** da DLQ. §10 só exige mover mensagens **para dentro** da DLQ, o que o MiniStack suporta integralmente. (Detalhes e fontes: `docs/research/07-sqs-emulator.md`.)

### 2.2 ORM — MikroORM

**MikroORM** em vez de TypeORM. §4 já indica MikroORM como preferencial, e as razões técnicas são as que a rubrica premia:

- **Unit of Work + Identity Map explícitos**: o agregado `Wallet` é carregado e persistido como uma unidade consistente.
- **`EntityManager.transactional()`**: expressa naturalmente a atomicidade de §11 (saldo + ledger + inbox + outbox na mesma transação SQL).
- **`LockMode.PESSIMISTIC_WRITE`**: o lock por wallet de §5 é suportado de forma idiomática (ver §5).

TypeORM exigiria mais disciplina para manter as mesmas garantias e não compraria nada em troca. Prisma está fora de escopo (§4).

### 2.3 Dinheiro — `big.js` + `Money`

`Money` é um value object imutável que encapsula um `Big` de **`big.js`** (campo `private readonly value`). A escolha:

- `Money` só precisa de `add`, `subtract` e `negate` (sem divisão), e o `big.js` garante que **essas operações são exatas, sempre, sem configuração** (o `decimal.js`, por contraste, arredonda *toda* operação para `precision`).
- O `big.js` **rejeita `NaN`/`Infinity` nativamente** (alinhado a §6.1), é ~6 KB, sem dependências, e roda em qualquer engine ES3 (incluindo o JavaScriptCore do Bun).
- `Big.strict = true` impede que um `number` IEEE-754 vaze para o valor.

Validação de entrada é responsabilidade de `Money.from`: a regex `^\d+(?:\.\d{1,2})?$` rejeita `NaN`, `Infinity`, notação científica, string vazia, mais de 2 casas e valores negativos; a serialização usa `toFixed(2)` para escala fixa de 2 casas. (Detalhes: `docs/research/01-money-representation.md`.)

### 2.4 Identificadores — UUIDv7

**UUIDv7** (RFC 9562), gerado na aplicação via uma porta `IdGenerator` (usada pelas factories do domínio), armazenado em coluna `uuid` nativa. Os exemplos do README (`0192f28f-…-7d58-…`) são literalmente UUIDv7 (o `7` é o nibble de versão). É ordenado por tempo → boa localidade de índice B-tree nas tabelas de alto volume (ledger, transações, outbox) e serve de desempate no cursor do ledger (§7). Geração na aplicação (não `gen_random_uuid()`, que é v4) mantém o domínio puro e permite IDs antes da persistência. ULID rejeitado (não é UUID); UUIDv4 rejeitado (aleatório → fragmentação).

## 3. Modelo de domínio

Classes puras (sem dependência de ORM/NestJS/SQS — §6.1), com construtor privado e factories estáticas (`create`/`from`/`rehydrate`; a `rehydrate` não revalida transições, §6.0):

- **`Money`** — valor monetário imutável (`big.js` + moeda ISO-4217).
- **`Wallet`** — agregado raiz: `id`, `playerId`, `currency`, `_balance`, `_version`, timestamps. Métodos `debit`/`credit` aplicam a movimentação mantendo saldo e ledger consistentes.
- **`WagerTransaction`** — a operação recebida, com a máquina de estados `PENDING → PENDING_REFERENCE → PROCESSED | REJECTED | FAILED` (os três últimos são terminais). `OPENING` é interno (não submetível).
- **`WalletLedgerEntry`** — lançamento imutável (`balanceBefore ± money === balanceAfter`, verificado na factory).
- **`InboxMessage`** / **`OutboxMessage`** — dedup de entrada e publicação de eventos de saída.

Regras de negócio (§7) implementadas no agregado/entidades, nunca em SQL: `BET` debita (rejeita sem saldo), `WIN` credita, `LOSS` não move saldo, `REFUND`/`ROLLBACK` revertem uma transação `PROCESSED` uma única vez.

## 4. Modelo de dados (schema)

As garantias de §5.9 (unicidade, imutabilidade, não-negatividade) vivem **no schema**, não apenas no código:

- **`wallet`**: `id` PK; `UNIQUE (player_id, currency)`; `balance numeric(20,2)` + `CHECK (balance >= 0)`; `version int` (inicia 1, incrementa só quando o saldo muda).
- **`wager_transaction`**: `UNIQUE (idempotency_key)`; `UNIQUE (provider_id, external_transaction_id)`; `wallet_id` FK; `payload_hash`; `kind`, `status`, `amount`/`currency`, `reference_external_transaction_id`, `reference_transaction_id`, `failure_code`, timestamps; `attempts int DEFAULT 0` e `next_attempt_at` (para o worker de referência pendente); índices `(wallet_id)`, `(status)`, `(wallet_id, created_at)`.
- **`wallet_ledger_entry`** (imutável): `UNIQUE (transaction_id)` (no máximo um lançamento por transação); `direction`, `amount`, `currency`, `balance_before`, `balance_after`; índice `(wallet_id, created_at, id)`; **`CHECK` aritmético** `(direction='CREDIT' AND balance_after = balance_before + amount) OR (direction='DEBIT' AND balance_after = balance_before - amount)`; **imutabilidade via GRANT**: o role da aplicação recebe apenas `SELECT`+`INSERT` (sem `UPDATE`/`DELETE`), sem trigger.
- **`inbox_message`**: `UNIQUE (consumer_name, message_id)`.
- **`outbox_message`**: `payload jsonb`, `attempts`, `next_attempt_at`, `published_at`; índice parcial `(next_attempt_at) WHERE published_at IS NULL`.

`Money` é persistido em duas colunas: `amount numeric(20,2)` (decimal exato do Postgres; o driver `pg` retorna `numeric` como string, casando 1:1 com o `big.js`) + `currency text`. A entidade reidrata via `Money.from`, nunca um `number` JS.

## 5. Concorrência e transacionalidade

**Lock pessimista por wallet.** A unidade de concorrência é o `walletId` (§8). Dentro de `em.transactional()`, a primeira operação é `SELECT … FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) sobre a linha da wallet — o que elimina o anti-padrão read→calculate→update (§5.7) e torna o *lost update* impossível.

- A unidade atômica de §11 (saldo + lançamento + status da transação + inbox/outbox) comita **sob o lock mantido**; nada é publicado antes do commit (§5.4).
- O lock é **por linha**, não global (§5.6): wallets diferentes processam em paralelo; operações da *mesma* wallet serializam — que é exatamente o ordenamento exigido.
- Cenário obrigatório (§8): duas apostas de 80.00 sobre saldo 100.00 → a primeira aplica (100→20), a segunda espera o lock, lê 20 e rejeita por saldo insuficiente. Um único lançamento de débito.
- `version` é mantida (§6.2) para auditoria e eventual fallback otimista futuro, mas **não** é o mecanismo de correção.

## 6. Idempotência

Idempotência **persistente**, nunca em memória (§5.2):

- `Idempotency-Key` (header HTTP) é a fonte da verdade; default `"{providerId}:{externalTransactionId}"`.
- `payload_hash` = **SHA-256 (hex minúsculo)** do **JSON canônico** (chaves ordenadas recursivamente, sem whitespace, UTF-8) do **subconjunto de negócio**: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money{amount,currency}`, e `referenceExternalTransactionId` quando presente. Header e metadados de transporte **não** entram no hash. No caminho SQS, hash do mesmo objeto `data`, não do envelope.
- Mesma key + mesmo hash → **replay** (`idempotentReplay: true`, mesma resposta original); mesma key + hash diferente → **conflito** (409).

## 7. Mensageria

### Entrada (SQS) — filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo`

- Provedores publicam `WagerTransactionRequested` em `wager-transactions.fifo`; o consumidor reutiliza **o mesmo use case** da entrada HTTP (§10).
- **Dedup** via inbox `UNIQUE (consumer_name, message_id)` gravado na mesma transação SQL da mudança financeira.
- **Ack somente após o commit** (`DeleteMessage` após a transação commitar).
- **Classificação de erro** (§10): *rejeição de negócio* → registra `REJECTED` + evento e faz **ack** (desfecho válido); *transitório* → não ack, visibility timeout redelivers com backoff exponencial; *permanente/malformado* → não ack, redrive por `maxReceiveCount` move para a **DLQ**.
- `PENDING_REFERENCE` → **ack** (processado como "aguardando referência"; o worker da §7.1 avança).
- `SIGTERM`: para o polling, conclui a mensagem em voo (commit + ack) ou devolve à visibility; nunca ack antes do commit.
- A redelivery (expiração de visibility, redrive, publish duplicado) é idempotente por construção graças ao inbox.

### Referências fora de ordem — worker de `PENDING_REFERENCE`

`REFUND`/`ROLLBACK` que chegam antes da transação referenciada são persistidos como `PENDING_REFERENCE`. Um **worker agendado** (~30 s) varre as linhas devidas, as reivindica com `FOR UPDATE SKIP LOCKED` e tenta resolver a referência (aplicando via o lock da wallet). Backoff exponencial `30s × 2^n` (teto 10 min), máximo **8 tentativas** e **TTL de 24 h** (o que vier primeiro). Esgotado → `REJECTED` com `REFERENCE_NOT_FOUND` + evento.

### Saída (outbox)

Eventos de integração (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`) são gravados na `outbox_message` na **mesma transação** da mudança financeira (§11). Um **worker** publica os pendentes:

- **Polling** + reivindicação `FOR UPDATE SKIP LOCKED` (seguro para N publishers concorrentes).
- **At-least-once**: (1) tx curta reivindica e incrementa `attempts`; (2) publica no SQS fora de transação; (3) tx curta marca `published_at`. Morrer entre (2) e (3) → publish duplicado, que o consumidor deduplica por `eventId`.
- Backoff exponencial e teto de tentativas (dead-letter) para nada retry indefinidamente.
- Destino: fila SQS configurável (`wager-events.fifo` por convenção, via env). O consumidor downstream está fora de escopo.

## 8. API HTTP

Os cinco desfechos de §9 têm status HTTP **distintos e consistentes** em todos os endpoints:

| Desfecho | Status |
|---|---|
| Payload inválido | **400** |
| Conflito de idempotência | **409** |
| Rejeição por regra de negócio | **422** (corpo carrega o `failureCode` + `status: REJECTED`) |
| Aceito, processamento pendente (`PENDING_REFERENCE`) | **202** |
| Falha transitória de infra | **503** |

- `POST /wallets` → 201 / 409 (duplicado `playerId,currency`) / 400; leituras → 200 / 404; `POST /wagering/transactions` → 200/202/422/409/400/503; reconciliação → 200 (com flag `consistent`).
- **Replay idempotente**: retorna o *status e corpo originais* + `idempotentReplay: true` (um `REJECTED` repetido devolve 422 de novo, não 200).
- **Envelope de erro** consistente: `{ "error": { "code", "message", "details" } }`, onde `code` é o `failureCode` (§7.2); `500` reservado para erro inesperado de servidor.

### Códigos de falha (§7.2)

12 códigos estáveis e legíveis por máquina: `INVALID_PAYLOAD`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND`, `CURRENCY_MISMATCH`, `INSUFFICIENT_BALANCE`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_VALUE_MISMATCH`, `REFERENCE_INVALID_KIND`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_NOT_PROCESSED`. A distinção exigida por §7.9 (`INSUFFICIENT_BALANCE` × `REVERSAL_WOULD_OVERDRAW`) é honrada; os quatro `REFERENCE_*` de borda são interpretações documentadas (§7).

> **Nota:** a criação de wallet duplicada usa `409` com o código `WALLET_ALREADY_EXISTS` — um conflito de *endpoint* (`POST /wallets`), distinto dos 12 `failureCode` de *rejeição de transação* (§7.2). O estado `FAILED` (§6.3) está definido no domínio mas não é produzido em runtime: erros permanentes de infra são rolados de volta e caem na DLQ (SQS) ou `503` (HTTP), em vez de persistir um `FAILED` (persistir um `FAILED` quando o próprio banco falha é circular).

### Cursor do ledger (§9)

Paginação **keyset** sobre `(created_at, id)` (ascendente, `id` como desempate), cursor **opaco** base64url, consulta `WHERE wallet_id = ? AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 50`. Keyset (não OFFSET) para estabilidade sob inserts concorrentes.

## 9. Arquitetura de módulos

Quatro camadas, dependências apontando para dentro:

```
interface ──► application ──► domain
     ▲            │
     └── infrastructure   (implementa as portas da application)
```

- **`domain`** — TypeScript puro, zero dependências: `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, enums, `FailureCode`, erros de domínio, `IntegrationEvent` + eventos concretos.
- **`application`** — casos de uso (`open-wallet`, `submit-transaction`, `reconcile`, consultas) + **portas**, e o limite transacional.
- **`infrastructure`** — adaptadores: entidades/repositórios MikroORM, cliente SQS (MiniStack), publisher de outbox, consumidor de inbox, worker de referência pendente, `IdGenerator` (UUIDv7), `Clock`, migrations.
- **`interface`** — transporte: controllers HTTP + DTOs, e o entry point do consumidor SQS.

**Portas (seams)** — conjunto mínimo, cada uma com adaptador real + adaptador de teste:

`WalletRepository` (`findForUpdate`/`findById`/`save`), `WagerTransactionRepository` (`findByIdempotencyKey`/`findByProviderExternal`/`save`), `LedgerEntryRepository` (`append`/`page`), `OutboxWriter` (`enqueue`), `IdGenerator` (`nextId`), `Clock` (`now`), `UnitOfWork` (`transactional`).

Sem porta `IdempotencyStore` (a idempotência vive dentro do `WagerTransactionRepository`); o lançamento é persistido atomicamente com a wallet via `UnitOfWork`. Cada porta deve ser **profunda**: interface pequena escondendo o comportamento real.

> **Nota de build (não é decisão de arquitetura):** o map lista 7 portas; a build adicionou uma 8ª, `InboxRepository` (`record`/`exists`), porque a atomicidade do inbox (§11) exige um seam de persistência próprio — a dedup por `(consumer_name, message_id)` precisa de INSERT no mesmo tx, e nenhuma das 7 portas cobre isso. A idempotência de *chave* continua no `WagerTransactionRepository`; o inbox é dedup de *mensagem*.

## 10. Trade-offs e limitações

- **Lock pessimista vs throughput**: operações da *mesma* wallet serializam por construção. É o comportamento exigido (§8), não uma deficiência; o custo é throughput por wallet quente. Wallets diferentes não são afetadas.
- **`numeric(20,2)` arredonda (não rejeita)** um valor com mais de 2 casas no INSERT; a rejeição estrita de >2 casas fica em `Money.from` (aplicação), e a coluna é o backstop.
- **`big.js` tem `c`/`e`/`s` mutáveis e sem tipos embutidos**: neutralizado mantendo o `Big` privado em `Money` e usando `@types/big.js`.
- **MiniStack não tem as 4 APIs de redrive de DLQ** (mover para fora): irrelevante para §10, que só move para dentro; trocar por LocalStack só se precisarmos de redrive explícito.
- **MikroORM no Bun** não é plataforma de primeira classe (é Node-first): verificado na build — funciona com a API de decorators da **v6** (a v7 removeu os decorators `@Entity`/`@Property`, então a build fixou `@mikro-orm/*@^6`). Não é fator decisivo pois Bun é a stack obrigatória (§4).
- **CLI de migrations é Node-first**: o binário `mikro-orm` (do pacote `@mikro-orm/cli@6`) é um script Node e, via `bunx` sem flags, rodaria sob Node sem suporte nativo a `.ts` — por isso os scripts `migration:*` usam `bunx --bun`, que executa a CLI sob o Bun e transpila o `mikro-orm.config.ts` e as migrations `.ts` nativamente (sem `ts-node`/`tsx`).
- **Constantes de tuning** (`maxReceiveCount` ~5, visibility ~30 s, teto de tentativas do outbox, lock timeout) são valores de build, não decisões de arquitetura.
- **FKs deferíveis**: as FKs `wallet_id`/`transaction_id` são `DEFERRABLE INITIALLY DEFERRED` para permitir o flush do MikroORM em qualquer ordem dentro do tx (o MikroORM sem relações declaradas não ordena os INSERTs); a checagem acontece no COMMIT, preservando a atomicidade de §11.
- **Ordem do lock e da idempotência**: no `SubmitTransaction` o `SELECT … FOR UPDATE` da wallet vem **antes** do check de idempotência — assim requisições com a mesma chave serializam no lock da wallet e a dedup é race-safe sob redelivery concorrente.

## 11. Fora de escopo

- **Autenticação** (§2) — fora de escopo por decisão do candidato; o README aceita a omissão. Um `AuthGuard` no-op / `ProviderIdentityPort` pode ser deixado como ponto de extensão na build, mas nenhuma decisão de auth é tomada aqui.
- **Teste de carga** (§14, diferencial opcional) — fora de escopo.
- **Consumidor downstream dos eventos de outbox** — o outbox publica em `wager-events.fifo`; nada neste challenge consome esses eventos.
