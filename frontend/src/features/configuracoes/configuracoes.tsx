import React from 'react';
import { ACCENT_PRESETS, useSettings } from '../../context/settings-context';
import { PageHeader } from '@/components/branded/section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ConfiguracoesPage(): React.JSX.Element {
  const { settings, setSetting } = useSettings();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-8 md:px-8">
        <div className="mb-6">
          <PageHeader title="Configurações" subtitle="Aparência e preferências do EDP-Helios." />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Aparência</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Row label="Tema">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={settings.theme}
                  onValueChange={(v) => { if (v) setSetting("theme", v as typeof settings.theme); }}
                >
                  <ToggleGroupItem value="system" aria-label="Sistema">Sistema</ToggleGroupItem>
                  <ToggleGroupItem value="light"  aria-label="Claro">Claro</ToggleGroupItem>
                  <ToggleGroupItem value="dark"   aria-label="Escuro">Escuro</ToggleGroupItem>
                </ToggleGroup>
              </Row>

              <Row label="Densidade">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={settings.density}
                  onValueChange={(v) => { if (v) setSetting("density", v as typeof settings.density); }}
                >
                  <ToggleGroupItem value="compact" aria-label="Compacto">Compacto</ToggleGroupItem>
                  <ToggleGroupItem value="cozy"    aria-label="Confortável">Confortável</ToggleGroupItem>
                </ToggleGroup>
              </Row>

              <Row label="Cor de destaque">
                <div className="flex gap-2">
                  {ACCENT_PRESETS.map((preset) => {
                    const isActive = settings.accent[0] === preset[0];
                    return (
                      <button
                        type="button"
                        key={preset[0]}
                        aria-label={`Cor de destaque ${preset[0]}`}
                        onClick={() => setSetting("accent", preset)}
                        className="size-7 rounded-full transition-transform hover:scale-110"
                        style={{
                          background: preset[0],
                          outline: isActive ? `2px solid ${preset[0]}` : "none",
                          outlineOffset: 2,
                          boxShadow: isActive ? "0 0 0 4px var(--background)" : "none",
                        }}
                      />
                    );
                  })}
                </div>
              </Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exibição</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <label htmlFor="show-kpis" className="cursor-pointer text-sm text-muted-foreground">
                  Mostrar KPIs
                </label>
                <Switch
                  id="show-kpis"
                  checked={settings.showKpis}
                  onCheckedChange={(v) => setSetting("showKpis", v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <label htmlFor="dev-logs" className="cursor-pointer text-sm text-muted-foreground">
                  Habilitar logs de Dev
                </label>
                <Switch
                  id="dev-logs"
                  checked={settings.devLogs}
                  onCheckedChange={(v) => setSetting("devLogs", v)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
