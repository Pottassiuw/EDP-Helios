import React from 'react';
import { Copy, FileSpreadsheet, Search } from 'lucide-react';
import type { CoffeeConclusaoFiltro } from '../../../../types';
import { SegTabs } from '@/components/branded/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type ConcluidasPeriodo = '7d' | '30d' | 'tudo';

interface ConcluidasToolbarProps {
  filtro: CoffeeConclusaoFiltro;
  onFiltroChange: (filtro: CoffeeConclusaoFiltro) => void;
  query: string;
  onQueryChange: (value: string) => void;
  periodo: ConcluidasPeriodo;
  onPeriodoChange: (value: ConcluidasPeriodo) => void;
  contagens: { todas: number; gerada: number; corrigida: number };
  copyDisabled: boolean;
  onCopy: () => void;
  exportDisabled: boolean;
  exportPending: boolean;
  onExport: () => void;
}

export function ConcluidasToolbar({
  filtro,
  onFiltroChange,
  query,
  onQueryChange,
  periodo,
  onPeriodoChange,
  contagens,
  copyDisabled,
  onCopy,
  exportDisabled,
  exportPending,
  onExport,
}: ConcluidasToolbarProps): React.JSX.Element {

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line px-[22px] py-4">
      <SegTabs
        ariaLabel="Resultado das notas concluídas"
        value={filtro}
        onChange={onFiltroChange}
        tabs={[
          { id: 'todas', rotulo: `Todas ${contagens.todas}` },
          { id: 'gerada', rotulo: `Geradas ${contagens.gerada}` },
          { id: 'corrigida', rotulo: `Corrigidas ${contagens.corrigida}` },
        ]}
      />
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-text-mute">
        Buscar ID, SAP ou local
        <span className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-8"
          />
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-mute">
        Período
        <Select
          value={periodo}
          onValueChange={(value) => onPeriodoChange(value as ConcluidasPeriodo)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent >
            <SelectItem value="7d">7 dias</SelectItem>
            <SelectItem value="30d">30 dias</SelectItem>
            <SelectItem value="tudo">Todo período</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Button
        variant="outline"
        size="sm"
        disabled={copyDisabled}
        onClick={onCopy}
      >
        <Copy /> Copiar IDs
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={exportDisabled || exportPending}
        onClick={onExport}
      >
        <FileSpreadsheet /> {exportPending ? 'Exportando…' : 'Exportar Excel'}
      </Button>
    </div>
  );
}
