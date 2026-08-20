import React from 'react';
import { ChartNoAxesCombined, ChevronDown } from 'lucide-react';
import type { AppSection, CarteiraSubPage, CoffeeSubPage, RelatoriosPage } from '../types';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { COFFEE_SUBS } from '../features/coffee/subs';
import { RELATORIOS_TABS } from '../features/relatorios/navigation';
import { INPUT_SUBS } from '../features/input/subs';
import { CARTEIRA_SUBS } from '../features/carteira/subs';
import type { AbaInput } from '../features/input/types';

// ─── Ícones inline ────────────────────────────────────────────────────────────
const svgBase = {
  width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const BrandGlyph = (): React.JSX.Element => (
  <svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="50" cy="50" r="30" fill="none" stroke="var(--indigo)" strokeWidth="9" />
    <circle cx="50" cy="50" r="18" fill="none" stroke="var(--blue)" strokeWidth="9" />
    <circle cx="50" cy="50" r="7" fill="none" stroke="var(--green)" strokeWidth="9" />
  </svg>
);
const IconCoffee = (): React.JSX.Element => (
  <svg {...svgBase}><path d="M5 9h12v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z" /><path d="M17 10h2.4a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3c-.5 1 .5 1.6 0 2.6M12 3c-.5 1 .5 1.6 0 2.6" /></svg>
);
const IconInput = (): React.JSX.Element => (
  <svg {...svgBase}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></svg>
);
const IconBI = (): React.JSX.Element => (
  <svg {...svgBase}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const IconCarteira = (): React.JSX.Element => (
  <svg {...svgBase}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></svg>
);
const IconGear = (): React.JSX.Element => (
  <svg {...svgBase}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);


interface AppSidebarProps {
  section: AppSection;
  setSection: (s: AppSection) => void;
  relatoriosPage: RelatoriosPage;
  setRelatoriosPage: (page: RelatoriosPage) => void;
  coffeeSub: CoffeeSubPage;
  setCoffeeSub: (s: CoffeeSubPage) => void;
  inputSub: AbaInput;
  setInputSub: (s: AbaInput) => void;
  carteiraSub: CarteiraSubPage;
  setCarteiraSub: (s: CarteiraSubPage) => void;
}

const AUTO_CLOSE_DELAY_MS = 25000;

export function AppSidebar({
  section,
  setSection,
  relatoriosPage,
  setRelatoriosPage,
  coffeeSub,
  setCoffeeSub,
  inputSub,
  setInputSub,
  carteiraSub,
  setCarteiraSub,
}: AppSidebarProps): React.JSX.Element {
  const { open, setOpen, openMobile, setOpenMobile, isMobile } = useSidebar();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetAutoCloseTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const isOpen = isMobile ? openMobile : open;
    if (isOpen) {
      timerRef.current = setTimeout(() => {
        if (isMobile) {
          setOpenMobile(false);
        } else {
          setOpen(false);
        }
      }, AUTO_CLOSE_DELAY_MS);
    }
  }, [open, openMobile, isMobile, setOpen, setOpenMobile]);

  React.useEffect(() => {
    resetAutoCloseTimer();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [resetAutoCloseTimer]);

  const handleActivity = React.useCallback(() => {
    resetAutoCloseTimer();
  }, [resetAutoCloseTimer]);

  function selectRelatoriosPage(page: RelatoriosPage): void {
    setRelatoriosPage(page);
    setSection("relatorios");
  }

  function selectSub(sub: CoffeeSubPage): void {
    setCoffeeSub(sub);
    setSection("coffee");
  }
  function selectInputSub(sub: AbaInput): void {
    setInputSub(sub);
    setSection("input");
  }
  function selectCarteiraSub(sub: CarteiraSubPage): void {
    setCarteiraSub(sub);
    setSection("carteira");
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseEnter={handleActivity}
      onMouseMove={handleActivity}
      onClick={handleActivity}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:px-0">
              <span className="flex items-center group-data-[collapsible=icon]:hidden">
                <BrandGlyph />
              </span>
              <span className="font-semibold text-sm truncate group-data-[collapsible=icon]:hidden">
                EDP-Helios
              </span>
              <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:mx-auto" />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Plataforma</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <Collapsible defaultOpen className="group/relatorios">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Relatórios"
                    isActive={section === "relatorios"}
                    onClick={() => setSection("relatorios")}
                  >
                    <ChartNoAxesCombined size={16} />
                    <span>Relatórios</span>
                    <ChevronDown
                      size={14}
                      className="ml-auto transition-transform duration-200 group-data-[state=open]/relatorios:rotate-180"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {RELATORIOS_TABS.map((tab) => (
                      <SidebarMenuSubItem key={tab.id}>
                        <SidebarMenuSubButton
                          className="cursor-pointer"
                          isActive={section === "relatorios" && relatoriosPage === tab.id}
                          onClick={() => selectRelatoriosPage(tab.id)}
                        >
                          {tab.rotulo}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <Collapsible defaultOpen className="group/coffee">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip="COFFEE"
                    isActive={section === "coffee"}
                    onClick={() => setSection("coffee")}
                  >
                    <IconCoffee />
                    <span>COFFEE</span>
                    <ChevronDown
                      size={14}
                      className="ml-auto transition-transform duration-200 group-data-[state=open]/coffee:rotate-180"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {COFFEE_SUBS.map((s) => (
                      <SidebarMenuSubItem key={s.id}>
                        <SidebarMenuSubButton
                          className="cursor-pointer"
                          isActive={section === "coffee" && coffeeSub === s.id}
                          onClick={() => selectSub(s.id)}
                        >
                          {s.rotulo}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <Collapsible defaultOpen className="group/input">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Input"
                    isActive={section === "input"}
                    onClick={() => setSection("input")}
                  >
                    <IconInput />
                    <span>Input</span>
                    <ChevronDown
                      size={14}
                      className="ml-auto transition-transform duration-200 group-data-[state=open]/input:rotate-180"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {INPUT_SUBS.map((s) => (
                      <SidebarMenuSubItem key={s.id}>
                        <SidebarMenuSubButton
                          className="cursor-pointer"
                          isActive={section === "input" && inputSub === s.id}
                          onClick={() => selectInputSub(s.id)}
                        >
                          {s.rotulo}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <Collapsible defaultOpen className="group/carteira">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Carteira"
                    isActive={section === "carteira"}
                    onClick={() => setSection("carteira")}
                  >
                    <IconCarteira />
                    <span>Carteira</span>
                    <ChevronDown
                      size={14}
                      className="ml-auto transition-transform duration-200 group-data-[state=open]/carteira:rotate-180"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {CARTEIRA_SUBS.map((s) => (
                      <SidebarMenuSubItem key={s.id}>
                        <SidebarMenuSubButton
                          className="cursor-pointer"
                          isActive={section === "carteira" && carteiraSub === s.id}
                          onClick={() => selectCarteiraSub(s.id)}
                        >
                          {s.rotulo}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton disabled className="opacity-40">
                <IconBI />
                <span>De olho no BI</span>
                <span className="ml-auto text-[9px] group-data-[collapsible=icon]:hidden">soon</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <Separator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Configurações"
              isActive={section === "configuracoes"}
              onClick={() => setSection("configuracoes")}
            >
              <IconGear />
              <span>Configurações</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
