# Filtro por inspetor(es) e exibição do gerador na fila — Verificar

Data: 2026-08-05

## Contexto

A feature Verificar já cruza a matrícula da coluna `colaborador` de cada
nota com `De-Para Membros.xlsx` e anexa um objeto `gerador`
(`matricula`, `nome`, `uf`, `inspetor`) a toda nota, independente de quem
gerou ser inspetor de planejamento ES/SP ou não (`main.py:150-158`).

Dois problemas atuais:

1. O filtro **Gerada por** (`dashboard.tsx:155-162`) é binário — "Todas"
   vs. "Inspetores ES/SP" — sem permitir isolar um ou mais inspetores
   específicos.
2. A linha "Gerada por X · UF" na fila de notas (`dashboard.tsx:282`) só
   aparece quando o filtro está em modo "Inspetores ES/SP"
   (`gerador === "inspectors"`), então notas geradas por quem não é
   inspetor nunca mostram o colaborador na fila — mesmo o dado já estando
   disponível no `gerador` de toda nota. (O painel de detalhe já mostra
   sempre, `dashboard.tsx:372`.)

Além disso, quando a matrícula da nota não existe no De-Para, o
`gerador` de fallback usa a própria matrícula como nome
(`main.py:153-158`), sem indicar que não é um nome cadastrado — o que
pode ser lido erroneamente como o nome real de alguém.

## Objetivo

- Permitir filtrar a fila por um ou mais inspetores específicos de
  ES/SP, não só pelo grupo inteiro.
- Mostrar sempre, na fila, quem gerou cada nota (não só quando o filtro
  de inspetor está ativo).
- Distinguir visualmente quando o gerador não tem registro no De-Para
  (matrícula não cadastrada), para não confundir com um nome real.

## Não-objetivos

- Não altera o cruzamento De-Para em si (colunas lidas, arquivo de
  origem, `DE_PARA_MEMBROS_PATH`).
- Não expõe lista de inspetores fora do lote carregado — as opções do
  filtro continuam derivadas das notas presentes na triagem atual
  (mesmo padrão de `ufOpts`/`setorOpts`), não um cadastro completo do
  De-Para.

## Design

### 1. Backend (`backend/main.py`) — flag `cadastrado`

`carregar_membros()` passa a incluir `"cadastrado": True` no dict de
cada colaborador encontrado no De-Para. `enriquecer_gerador()` passa a
setar `"cadastrado": False` no fallback (matrícula sem registro no
De-Para), mantendo o nome como a própria matrícula crua — o rótulo
"não cadastrado" é responsabilidade do frontend, não do backend.

```python
resultado[matricula] = {
    "matricula": matricula,
    "nome": nome or matricula,
    "uf": uf,
    "inspetor": uf in {"ES", "SP"} and "inspetor_planejamento" in permissoes,
    "cadastrado": True,
}
```

```python
registro["gerador"] = membros.get(matricula, {
    "matricula": matricula,
    "nome": matricula or "Não informado",
    "uf": "",
    "inspetor": False,
    "cadastrado": False,
})
```

`test_upload.py:100-127` (`test_upload_enriquece_gerador_com_de_para`)
precisa do campo `cadastrado: True` no dict esperado. Adicionar um novo
teste cobrindo o caso de matrícula não cadastrada (`cadastrado: False`).

### 2. Frontend — tipos (`frontend/src/types.ts`)

`NoteGenerator` ganha `cadastrado: boolean`.

### 3. Frontend — filtro multi-select de inspetores (`dashboard.tsx`)

Troca o estado `gerador: "all" | "inspectors"` por
`geradorInspetores: string[]` (matrículas selecionadas), persistido sob
nova chave `edp_verify_gerador_insp` (a chave antiga `edp_verify_gerador`
não é migrada — guarda um valor de formato diferente e não vale a pena
carregar lógica de migração para um filtro persistido localmente).

Opções derivadas do lote atual, mesmo padrão de `ufOpts`/`setorOpts`:

```ts
const inspetorOpts = React.useMemo(() => {
  const map = new Map<string, { matricula: string; nome: string; uf: string }>();
  notes.forEach((n) => {
    if (n.gerador?.inspetor) map.set(n.gerador.matricula, n.gerador);
  });
  return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}, [notes]);
```

UI: `ToggleGroup type="multiple"` (Radix já suporta seleção múltipla
nativamente — sem componente novo) listando `inspetorOpts`, um item por
inspetor (`"Nome (UF)"`). O campo "Gerada por" some por completo
(fragment vazio, mesmo padrão do `MalhaFinaPanel`) quando
`inspetorOpts.length === 0` — sem inspetor no lote, não há o que
filtrar.

Filtro em `matches()`:

```ts
if (geradorInspetores.length && !geradorInspetores.includes(n.gerador?.matricula ?? "")) return false;
```

Seleção vazia = sem filtro (mostra tudo). Um chip por inspetor
selecionado em "Ativos" (`"Gerada por: <nome>"`), each com `clear`
individual removendo só aquela matrícula do array; "Limpar filtros"
continua zerando tudo.

### 4. Frontend — exibição sempre visível na fila (`dashboard.tsx:282`)

Remove a condição `gerador === "inspectors"`; a linha aparece sempre que
a nota tiver `gerador`:

```tsx
{n.gerador && (
  <div className="text-[11px] text-text-mute whitespace-nowrap overflow-hidden text-ellipsis">
    Gerada por {n.gerador.nome}
    {n.gerador.uf && ` · ${n.gerador.uf}`}
    {!n.gerador.cadastrado && " (matrícula não cadastrada)"}
  </div>
)}
```

### 5. Frontend — painel de detalhe (`dashboard.tsx:372`)

Mesmo rótulo de não cadastrado, sem alterar a condição existente (já
mostra sempre):

```tsx
["Gerada por", sel.gerador
  ? `${sel.gerador.nome} · ${sel.gerador.matricula}${sel.gerador.cadastrado ? "" : " (não cadastrado)"}`
  : v(sel.colaborador)],
```

## Documentação a atualizar

- `docs/dev/01-frontend-verificar.md` — descrição do filtro "Gerada
  por" (linhas 11-12, 59-61) precisa refletir multi-select por
  inspetor em vez de alternância binária, e a exibição sempre visível
  na fila.
- `docs/dev/00-overview.md` — sem menção direta ao comportamento do
  filtro; não deve precisar de mudança, mas revisar durante a
  implementação.

## Testes

- `backend/test_upload.py`: atualizar
  `test_upload_enriquece_gerador_com_de_para` com `cadastrado: True`;
  adicionar teste para matrícula sem registro no De-Para
  (`cadastrado: False`, nome = matrícula).
- Frontend: sem suíte de testes automatizados identificada para
  `dashboard.tsx` além de verificação manual — validar visualmente
  multi-select, chip de remoção individual, e rótulo "não cadastrado"
  em nota de teste.

## Riscos / trade-offs

- Opções do filtro dependem do lote carregado: se o usuário quer
  filtrar por um inspetor que não gerou nenhuma nota no upload atual,
  a opção simplesmente não aparece (comportamento consistente com
  `ufOpts`/`setorOpts`, não é regressão).
- Nova chave de `localStorage` deixa a chave antiga (`edp_verify_gerador`)
  órfã — não é lida nem escrita mais; não causa erro, só ocupa espaço
  residual no navegador de quem já usou o filtro antigo.
