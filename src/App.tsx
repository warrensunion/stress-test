import { useState } from 'react';
import { Estimator } from './components/Estimator';
import { emptyDesign } from './engine/schema';
import type { Design } from './engine/types';

type View = 'design' | 'estimator';

export default function App() {
  const [view, setView] = useState<View>('estimator');
  const [design, setDesign] = useState<Design>(() => emptyDesign());

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
        <span className="text-sm text-slate-500">Workload: {design.workload.rps} req/s</span>
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
          <div className="p-6 text-slate-500">Design canvas coming soon.</div>
        )}
      </main>
    </div>
  );
}
