# Processador de Apostas (Wagering)

Glossário do domínio do Distributed Wagering Processor. Define os termos usados no código e nos documentos para que signifiquem sempre a mesma coisa.

## Language

### Atores

**Provedor (Provider)**:
Sistema externo de jogos que envia operações de aposta para serem processadas.
_Avoid_: fonte, remetente, parceiro

**Jogador (Player)**:
Pessoa dona de uma ou mais wallets (uma por moeda).
_Avoid_: usuário, cliente

### Dinheiro

**Wallet**:
Saldo de um jogador em uma única moeda; o agregado raiz do domínio.
_Avoid_: conta, carteira genérica

**Saldo (Balance)**:
Montante monetário atual de uma wallet; nunca negativo.

**Moeda (Currency)**:
Código ISO-4217 de três letras (ex.: `BRL`); operações entre moedas diferentes são rejeitadas.

**Money**:
Valor monetário imutável — uma quantia decimal exata (sempre 2 casas) + uma moeda.
_Avoid_: valor, quantia, montante solto

### Operações

**Rodada (Round)**:
Rodada de jogo que agrupa as operações de um mesmo fluxo (`BET → WIN | LOSS | REFUND | ROLLBACK`).
_Avoid_: sessão, partida

**Operação (Operation)**:
Ação de aposta submetida por um provedor — um `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK`.
_Avoid_: requisição, evento

**Transação (WagerTransaction)**:
Registro de uma operação recebida, com sua máquina de estados (`PENDING → PENDING_REFERENCE → PROCESSED | REJECTED | FAILED`).
_Avoid_: operação (a operação é o que o provedor envia; a transação é o registro dela)

**Referência (Reference)**:
Vínculo de uma reversão à transação que ela reverte; resolvida por `(providerId, referenceExternalTransactionId)`.
_Avoid_: vínculo, dependência

**Reversão**:
`REFUND` ou `ROLLBACK` — a operação que desfaz uma transação `PROCESSED`, uma única vez.
_Avoid_: estorno, cancelamento

### Registro financeiro

**Ledger**:
Histórico completo e imutável dos lançamentos de uma wallet.
_Avoid_: extrato

**Lançamento (Ledger Entry)**:
Um movimento de saldo imutável, com `balanceBefore` e `balanceAfter`; reconstrói o saldo pela soma.
_Avoid_: registro, movimento genérico

**Reconciliação (Reconciliation)**:
Verificação de que o saldo armazenado da wallet é igual ao saldo reconstruído pela soma do ledger.

### Mensageria e idempotência

**Idempotência (Idempotency Key)**:
Chave que identifica unicamente uma operação; repetições retornam o resultado original, payload divergente é conflito.
_Avoid_: dedup key

**Inbox**:
Registro persistente de que uma mensagem de entrada já foi processada, para deduplicar redeliveries.
_Avoid_: fila de entrada

**Outbox**:
Registro persistente de eventos de integração a publicar, gravado na mesma transação da mudança financeira.
_Avoid_: fila de saída
