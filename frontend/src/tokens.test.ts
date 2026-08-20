import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from './context/settings-context';

/**
 * Guarda de contraste dos tokens de cor de `app.css`.
 *
 * A fundação 4c-0 promoveu a paleta Supabaze para `:root` e recolore o app
 * inteiro; os lotes 4c-1..4c-5 continuam mexendo em cor. Este teste é a rede
 * que impede uma troca de token de derrubar a legibilidade sem ninguém ver.
 *
 * Afere WCAG 2.1 (luminância relativa) só nos pares que carregam texto.
 */

// Normaliza CRLF: o repositório é editado no Windows e os seletores abaixo
// são casados por texto literal.
const CSS = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf-8')
  .replace(/\r\n/g, '\n');

const AA_TEXTO_PEQUENO = 4.5;
const AA_TEXTO_GRANDE = 3;

function luminanciaRelativa(hex: string): number {
  const canais = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminanciaRelativa(a), luminanciaRelativa(b)];
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Extrai os tokens hex de um bloco de `app.css` identificado pelo seletor. */
function tokensDoBloco(seletor: string): Record<string, string> {
  const inicio = CSS.indexOf(seletor + ' {');
  expect(inicio, `bloco "${seletor}" não encontrado em app.css`).toBeGreaterThan(-1);
  const corpo = CSS.slice(inicio, CSS.indexOf('\n}', inicio));
  const tokens: Record<string, string> = {};
  for (const [, nome, valor] of corpo.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    tokens[nome] = valor.toLowerCase();
  }
  return tokens;
}

const CLARO = tokensDoBloco(':root');
const ESCURO = tokensDoBloco(':root[data-theme="dark"]');

describe('tokens de cor — tema claro (canvas branco autoritativo)', () => {
  it('lê a paleta clara de app.css', () => {
    expect(CLARO['--bg']).toBe('#ffffff');
    expect(CLARO['--text']).toBe('#171717');
  });

  it.each([
    ['tinta sobre canvas', '--text', '--bg'],
    ['tinta sobre superfície', '--text', '--surface'],
    ['tinta secundária sobre canvas', '--text-dim', '--bg'],
    ['status âmbar sobre canvas', '--amber', '--bg'],
    ['status vermelho sobre canvas', '--red', '--bg'],
    ['status violeta sobre canvas', '--indigo', '--bg'],
  ])('%s passa AA para texto pequeno', (_rotulo, tinta, fundo) => {
    expect(contraste(CLARO[tinta], CLARO[fundo])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });

  it('tipo sobre a marca esmeralda é quase-preto, não branco (DESIGN.md)', () => {
    // "the button reads as a lit surface with dark type, not a colored chip".
    expect(contraste(CLARO['--on-green'], CLARO['--green'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
    expect(contraste('#ffffff', CLARO['--green'])).toBeLessThan(AA_TEXTO_PEQUENO);
  });

  it('tipo sobre índigo passa AA nos dois temas', () => {
    expect(contraste(CLARO['--on-dark'], CLARO['--indigo'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
    expect(contraste(ESCURO['--on-dark'], ESCURO['--indigo'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });

  it('tipo destrutivo passa AA nos dois temas', () => {
    expect(contraste(CLARO['--destructive-foreground'], CLARO['--red'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
    const foregroundEscuro = ESCURO['--destructive-foreground'];
    expect(foregroundEscuro).toBeDefined();
    expect(contraste(foregroundEscuro!, ESCURO['--red'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });

  it('--on-green não é redeclarado no escuro: o verde da marca não muda com o tema', () => {
    expect(ESCURO['--on-green']).toBeUndefined();
  });

  it('--green-3 serve como número display (AA de texto grande)', () => {
    // Só é usado no KPI de 26px (`.edp-num`), onde o mínimo é 3:1.
    expect(contraste(CLARO['--green-3'], CLARO['--bg'])).toBeGreaterThanOrEqual(AA_TEXTO_GRANDE);
  });

  it('--text-mute é tinta terciária: cumpre texto grande, não texto pequeno', () => {
    // Baseline herdado da Carteira aprovada (DESIGN.md ink-mute-2 #9a9a9a).
    // Registrado como dívida conhecida, não introduzido pela 4c-0.
    expect(contraste(CLARO['--text-mute'], CLARO['--bg'])).toBeLessThan(AA_TEXTO_PEQUENO);
  });
});

describe('tokens de cor — tema escuro (canvas-night)', () => {
  it('usa canvas-night do DESIGN.md, não a paleta navy legada', () => {
    expect(ESCURO['--bg']).toBe('#1c1c1c');
    expect(ESCURO['--bg-2']).toBe('#202020');
  });

  it.each([
    ['tinta sobre canvas', '--text', '--bg'],
    ['tinta secundária sobre canvas', '--text-dim', '--bg'],
    ['tinta terciária sobre canvas', '--text-mute', '--bg'],
    ['status âmbar sobre superfície', '--amber', '--surface'],
    ['status vermelho sobre superfície', '--red', '--surface'],
    ['status violeta sobre superfície', '--indigo', '--surface'],
    ['status azul sobre superfície', '--blue', '--surface'],
    ['verde de leitura sobre canvas', '--green-3', '--bg'],
  ])('%s passa AA para texto pequeno', (_rotulo, tinta, fundo) => {
    expect(contraste(ESCURO[tinta], ESCURO[fundo])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });

  it('a marca esmeralda é legível sobre canvas-night', () => {
    expect(contraste(CLARO['--green'], ESCURO['--bg'])).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });
});

describe('presets de accent', () => {
  // O accent é escrito inline no <html> e vira --primary/--primary-foreground.
  // O quarto valor do preset (tipo sobre o sólido) NÃO é derivável do tema: o
  // esmeralda pede quase-preto e os acentos escuros pedem branco. Sem esta
  // guarda, todo botão primário do app fica ilegível em pelo menos um tema.
  it.each(ACCENT_PRESETS)('o preset %s pareia tipo legível sobre o sólido', (solido, _hover, _tint, tipo) => {
    expect(contraste(tipo, solido)).toBeGreaterThanOrEqual(AA_TEXTO_PEQUENO);
  });

  it('o preset padrão é o esmeralda do DESIGN.md', () => {
    expect(ACCENT_PRESETS[0][0]).toBe('#3ecf8e');
  });
});

describe('herança dos hexes legados', () => {
  it.each(['#161e2b', '#6b5ce6', '#1f9fd6', '#00a859', '#eef2f8'])(
    'a paleta EDP legada %s não sobrevive em app.css',
    (hexLegado) => {
      expect(CSS.toLowerCase()).not.toContain(hexLegado);
    },
  );

  it('a paleta é declarada uma vez só, sem nenhum escopo por classe', () => {
    // A 4c-fim removeu `.carteira-scope` e a classe raiz `.edp`: não sobrou
    // escopo de token por classe, então a paleta clara existe num lugar só.
    const regras = CSS.replace(/\/\*[\s\S]*?\*\//g, ''); // comentários citam o legado
    expect(regras.match(/--bg:\s+#ffffff/g)).toHaveLength(1);
    expect(regras).not.toContain('.carteira-scope');
    expect(regras).not.toContain('.edp');
  });

  it('nenhuma classe .edp-* sobreviveu nos componentes', () => {
    // Trava dos lotes 4c-1..4c-5: a anatomia legada saiu do CSS e foi para
    // components/ui e components/branded. `rounded-edp-*` são utilities
    // Tailwind legítimas geradas pelo bridge, e 'edp-verify' é o nome do
    // banco IndexedDB — nenhum dos dois é classe de skin.
    const raiz = fileURLToPath(new URL('.', import.meta.url));
    const arquivos = readdirSync(raiz, { recursive: true, encoding: 'utf-8' })
      .filter((f) => f.endsWith('.tsx'));
    const culpados = arquivos.filter((f) => {
      const codigo = readFileSync(join(raiz, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')   // comentário de bloco cita as classes antigas
        .replace(/\/\/.*$/gm, '')
        .replace(/\brounded-edp[a-z-]*/g, '');
      return /\bedp-(?!verify\b)[a-z]/.test(codigo);
    });
    expect(culpados).toEqual([]);
  }, 15000);

  it('tema e densidade são atributos de :root, não da classe .edp', () => {
    expect(CSS).toContain(':root[data-theme="dark"]');
    expect(CSS).toContain(':root[data-density="compact"]');
    expect(CSS).not.toContain('.edp[data-theme=');
    expect(CSS).not.toContain('.edp[data-density=');
  });
});
