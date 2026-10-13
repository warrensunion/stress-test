import { ReactFlowProvider } from '@xyflow/react';
import { useRef, useState } from 'react';
import { DesignCanvas } from './components/DesignCanvas';
import { Estimator } from './components/Estimator';
import { Inspector } from './components/Inspector';
import { Palette } from './components/Palette';
import { addNode } from './engine/designOps';
import { parseDesign, serializeDesign } from './engine/schema';
import type { Design } from './engine/types';
import { starterDesign } from './presets/starter';

type View = 'design' | 'estimator';

export default function App() {
  const [view, setView] = useState<View>('design');
  const [design, setDesign] = useState<Design>(starterDesign);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDesign = (d: Design) => {
    setDesign(d);
    setSelectedId(null);
    setCanvasKey((k) => k + 1);
  };

  const exportJson = () => {
    const blob = new Blob([serializeDesign(design)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${design.name.replace(/[^\w-]+/g, '_') || 'design'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      loadDesign(parseDesign(JSON.parse(await file.text())));
      setNotice(`Imported "${file.name}"`);
    } catch (err) {
      setNotice(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-lg font-bold text-indigo-700">Stress Test</h1>
        <nav className="flex gap-1">
          {(['design', 'estimator'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 text-sm capitalize ${view === v ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {notice && <span className="text-slate-500">{notice}</span>}
          <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={exportJson}>
            Export JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {view === 'estimator' ? (
          <Estimator
            onApply={(w) => {
              setDesign({ ...design, workload: w });
              setView('design');
            }}
          />
        ) : (
          <div className="flex h-full">
            <aside className="w-48 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
              <Palette
                onAdd={(t) => {
                  const [next, id] = addNode(design, t, { x: 100 + design.nodes.length * 30, y: 300 });
                  setDesign(next);
                  setSelectedId(id);
                }}
              />
            </aside>
            <section className="min-w-0 flex-1">
              <ReactFlowProvider key={canvasKey}>
                <DesignCanvas
                  design={design}
                  onChange={setDesign}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  decor={Object.fromEntries(design.nodes.filter((n) => n.type === 'client').map((n, _i, cs) => [n.id, { rps: design.workload.rps / cs.length }]))}
                />
              </ReactFlowProvider>
            </section>
            <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
              <Inspector design={design} selectedId={selectedId} onChange={setDesign} onDeselect={() => setSelectedId(null)} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
