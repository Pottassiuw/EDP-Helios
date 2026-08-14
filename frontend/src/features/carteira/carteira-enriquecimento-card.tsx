import React from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Eyebrow } from '@/components/branded/section';

import type {
  CarteiraEnriquecimento,
  DadosCarteiraEnriquecimento,
} from './types';
import { useCarteiraEnriquecimento } from './use-carteira-enriquecimento';

const CAMPOS: Array<{
  chave: keyof DadosCarteiraEnriquecimento;
  rotulo: string;
}> = [
  { chave: 'sintoma', rotulo: 'Sintoma' },
  { chave: 'componente_novo', rotulo: 'Componente novo' },
  { chave: 'kit', rotulo: 'Kit' },
  { chave: 'n_trafo', rotulo: 'Transformador' },
  { chave: 'dispositivo_protecao', rotulo: 'Dispositivo de proteção' },
  { chave: 'status_sap', rotulo: 'Status SAP' },
  { chave: 'prioridade_sap', rotulo: 'Prioridade SAP' },
];

function exibir(valor: string | number | null): string {
  return valor === null || valor === '' ? '—' : String(valor);
}

function formatarData(valor: string | null): string {
  if (valor === null || valor === '') return '—';

  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? valor
    : data.toLocaleString('pt-BR');
}

interface ContentProps {
  resultado: CarteiraEnriquecimento | undefined;
  carregando: boolean;
  erro: Error | null;
  onRetry: () => void;
  onIrParaSincronizacao: () => void;
}

export function CarteiraEnriquecimentoContent({
  resultado,
  carregando,
  erro,
  onRetry,
  onIrParaSincronizacao,
}: ContentProps): React.JSX.Element {
  if (carregando) {
    return (
      <Card aria-busy="true" aria-label="Carregando dados da base COFFEE">
        <CardHeader className="p-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-3/4" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 pt-0 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (erro !== null) {
    return (
      <Card role="alert" className="border-red/30">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle aria-hidden="true" className="mt-0.5 text-red" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Não foi possível consultar a base COFFEE.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 min-h-11"
              onClick={onRetry}
            >
              <RefreshCw aria-hidden="true" />
              Tentar novamente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (
    resultado === undefined
    || resultado.estado === 'sem_correspondencia'
  ) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4 text-sm text-text-mute">
          <Database aria-hidden="true" />
          <span>Sem correspondência na base COFFEE.</span>
        </CardContent>
      </Card>
    );
  }

  if (resultado.estado === 'base_nao_sincronizada') {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium">
            A Carteira ainda não foi sincronizada.
          </p>
          <p className="mt-1 text-sm text-text-mute">
            Sincronize a projeção antes de consultar o enriquecimento.
          </p>
          <Button
            type="button"
            variant="link"
            className="mt-2 min-h-11"
            onClick={onIrParaSincronizacao}
          >
            Ir para Sincronização
          </Button>
        </CardContent>
      </Card>
    );
  }

  const dados = resultado.dados;
  if (dados === null) {
    return (
      <Card role="alert" className="border-red/30">
        <CardContent className="p-4">
          <p className="text-sm text-red">
            Resposta inválida da base COFFEE.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 min-h-11"
            onClick={onRetry}
          >
            <RefreshCw aria-hidden="true" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const camposIndisponiveis = new Set(
    resultado.avisos.flatMap((aviso) => aviso.campos),
  );
  const exibirCampo = (chave: keyof DadosCarteiraEnriquecimento): string => (
    camposIndisponiveis.has(chave) ? 'Indisponível' : exibir(dados[chave])
  );

  return (
    <Card>
      <CardHeader className="gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Dados da base COFFEE</Eyebrow>
          <Badge variant="outline">Somente leitura</Badge>
        </div>
        <CardTitle className="text-lg">
          {exibirCampo('descricao_conjunto')}
        </CardTitle>
        <p className="font-mono text-sm text-text-mute">
          Conjunto {exibirCampo('conjunto')}
        </p>
        {resultado.estado === 'ausente_na_origem' && (
          <p
            role="status"
            className="rounded-md bg-amber/10 p-2 text-sm text-amber"
          >
            Ausente na origem desde{' '}
            {formatarData(resultado.ausente_na_origem_em)}.
          </p>
        )}
        {resultado.avisos.length > 0 && (
          <section
            role="status"
            aria-live="polite"
            aria-labelledby="carteira-enriquecimento-avisos"
            className="rounded-md bg-amber/10 p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber"
              />
              <div>
                <p
                  id="carteira-enriquecimento-avisos"
                  className="font-medium"
                >
                  Dados parcialmente indisponíveis
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-text-mute">
                  {resultado.avisos.map((aviso) => (
                    <li key={aviso.codigo}>{aviso.mensagem}</li>
                  ))}
                </ul>
                <p className="mt-2 text-text-mute">
                  {resultado.avisos[0].acao}
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 min-h-11 px-0"
                  onClick={onIrParaSincronizacao}
                >
                  Ir para Sincronização
                </Button>
              </div>
            </div>
          </section>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAMPOS.map(({ chave, rotulo }) => (
            <div key={chave} className="min-w-0 rounded-md bg-surface-2 p-3">
              <Eyebrow asChild><dt>{rotulo}</dt></Eyebrow>
              <dd className="mt-1 break-words font-mono text-sm">
                {exibirCampo(chave)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

interface CardProps {
  numeroSap: number | null;
  enabled: boolean;
  onIrParaSincronizacao: () => void;
}

export function CarteiraEnriquecimentoCard({
  numeroSap,
  enabled,
  onIrParaSincronizacao,
}: CardProps): React.JSX.Element {
  const query = useCarteiraEnriquecimento(numeroSap, enabled);

  return (
    <CarteiraEnriquecimentoContent
      resultado={query.data}
      carregando={query.isLoading}
      erro={query.error instanceof Error ? query.error : null}
      onRetry={() => {
        void query.refetch();
      }}
      onIrParaSincronizacao={onIrParaSincronizacao}
    />
  );
}
