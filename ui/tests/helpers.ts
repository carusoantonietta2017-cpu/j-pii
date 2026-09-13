// Helper Playwright riusabili (WP0): nodi di navigazione annotati via data-testid.
// Uso: import { T, seedWiki, openPair, convertFake } from "./helpers.ts"
// I selettori restano stabili anche se cambiano id/classi: usare sempre T.*.
export const T = {
  sidebar: '[data-testid="nav-sidebar"]',
  sources: '[data-testid="nav-sources"]',
  wikiList: '[data-testid="nav-wiki-list"]',
  crumbs: '[data-testid="nav-crumbs"]',
  split: '[data-testid="viewer-split"]',
  viewer: '[data-testid="viewer-original"]',
  editor: '[data-testid="editor-md"]',
  dock: '[data-testid="dock"]',
  dockLog: '[data-testid="dock-log"]',
  dockModel: '[data-testid="dock-model"]',
  // id legacy (da migrare a data-testid quando tocchi il markup)
  dockform: '#dockform',
  gsearch: '#gsearch',
  dlg: '#dlg',
  toast: '#toast',
} as const;

export async function seedWiki(base: string, slug = 'demo', title = 'Nota', body = '# Nota\nriga iva qui 12,00\n') {
  const j = (p: string, init?: RequestInit) => fetch(base + p, init).then((r) => r.json());
  await j('/api/wiki', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }).catch(() => ({}));
  // crea md temporaneo via API add (il server scrive il file da solo se markdown passato)
  await j(`/api/wiki/${encodeURIComponent(slug)}/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: body, title }),
  }).catch(() => ({}));
}

export async function openPair(page: any, wiki: string, file: string) {
  await page.goto(`#/w/${encodeURIComponent(wiki)}/v/${encodeURIComponent(file)}`);
  await page.waitForSelector(T.editor, { timeout: 8000 });
}

export async function convertFake(page: any, localFile: string) {
  await page.evaluate(`localStorage.setItem('ocr-pi-opt', JSON.stringify({engine:'fake'}))`);
  await page.setInputFiles('label.filebtn input, #upick', localFile).catch(() => {});
}

export function pairFromMeta(meta: { docs: Array<{ file: string; raw?: string; name: string }> }, identifier: string) {
  const ident = String(identifier);
  for (const d of meta.docs) {
    if (ident === d.file || ident === d.name) return { doc: d.file, raw: d.raw ?? '', name: d.name };
  }
  const rbase = ident.split('/').pop() ?? '';
  for (const d of meta.docs) {
    if ((d.raw ?? '').split('/').pop() === rbase) return { doc: d.file, raw: d.raw ?? '', name: d.name };
  }
  return { doc: '', raw: '', name: '' };
}
