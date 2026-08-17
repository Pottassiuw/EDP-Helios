import React from "react";
import { Eyebrow } from "@/components/branded/section";
import { Badge } from "@/components/ui/badge";
import type { FieldProps, NoteStatus, TriageForwarding } from "../../types";

export const LOGO_DARK =
  "/assets/RGB/Dark/Regular/NEG/EDP_Group_MasterLogo_RGB_Dark_NEG.png";
export const LOGO_LIGHT =
  "/assets/RGB/Light/Regular/POS/EDP_Group_MasterLogo_RRGB_Light_POS.png";

const PRIO_BORDER: Record<string, string> = {
  high: "var(--status-red-border)",
  med: "var(--status-amber-border)",
  low: "var(--status-green-border)",
};

function prioMeta(p: number): ["high" | "med" | "low" | "none", string | number] {
  if (p >= 99) return ["none", "—"];
  if (p <= 2) return ["high", p];
  if (p <= 4) return ["med", p];
  return ["low", p];
}

const PRIO_VARIANT = {
  high: "prioHigh", med: "prioMed", low: "prioLow", none: "prioNone",
} as const;

export const PriorityChip: React.FC<{ p: number }> = ({ p }) => {
  const [cls, label] = prioMeta(p);
  return (
    <Badge variant={PRIO_VARIANT[cls]} style={cls === "none" ? undefined : { borderColor: PRIO_BORDER[cls] }}>
      {label}
    </Badge>
  );
};

export const StatusTag: React.FC<{
  status: NoteStatus;
  done: boolean;
  dup?: boolean;
  encaminhamento?: TriageForwarding;
}> = ({ status, done, dup, encaminhamento }) => {
  if (dup)
    return (
      <Badge variant="tagDup">
        <span className="w-[6px] h-[6px] rounded-full bg-current" />
        Duplicata
      </Badge>
    );
  if (encaminhamento?.situacao === "retornada")
    return (
      <Badge variant="tagDone" style={{ backgroundColor: "var(--accent-tint)", color: "var(--accent)" }}>
        <span className="w-[6px] h-[6px] rounded-full bg-current" />
        Retornada
      </Badge>
    );
  if (encaminhamento?.situacao === "falha_operacional")
    return (
      <Badge variant="tagErr" title={encaminhamento.erro ?? "Falha operacional"}>
        <span className="w-[6px] h-[6px] rounded-full bg-current" />
        Falha operacional
      </Badge>
    );
  if (encaminhamento)
    return (
      <Badge variant="tagDone">
        <span className="w-[6px] h-[6px] rounded-full bg-current" />
        Encaminhada
      </Badge>
    );
  if (done)
    return (
      <Badge variant="tagDone">
        <span className="w-[6px] h-[6px] rounded-full bg-current" />
        Encaminhada
      </Badge>
    );
  return status === "ok" ? (
    <Badge variant="tagOk">
      <span className="w-[6px] h-[6px] rounded-full bg-current" />
      Conforme
    </Badge>
  ) : (
    <Badge variant="tagErr">
      <span className="w-[6px] h-[6px] rounded-full bg-current" />
      Com erro
    </Badge>
  );
};

export const Field: React.FC<FieldProps> = ({
  label,
  accent,
  children,
  grow,
}) => (
  <label
    className="flex flex-col gap-[5px]"
    style={{
      flex: grow ? 1 : "none",
      minWidth: grow ? 150 : 0,
    }}
  >
    <Eyebrow style={{ color: accent ? "var(--green)" : "var(--text-mute)" }}>
      {label}
    </Eyebrow>
    {children}
  </label>
);
