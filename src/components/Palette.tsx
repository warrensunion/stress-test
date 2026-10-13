import { COMPONENT_SPECS } from '../engine/components';
import { COMPONENT_TYPES, type ComponentType } from '../engine/types';
import { DRAG_MIME } from './DesignCanvas';
import { TYPE_STYLE } from './theme';

export function Palette({ onAdd }: { onAdd: (t: ComponentType) => void }) {
  return (
    <div className="space-y-1.5 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Components</h2>
      {COMPONENT_TYPES.map((t) => (
        <div
          key={t}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, t);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDoubleClick={() => onAdd(t)}
          title={`${COMPONENT_SPECS[t].description}\nDrag onto the canvas (or double-click to add).`}
          className="flex cursor-grab items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm hover:border-indigo-300 active:cursor-grabbing"
          data-testid={`palette-${t}`}
        >
          <span className="w-8 rounded text-center text-[10px] font-bold text-white" style={{ background: TYPE_STYLE[t].color }}>
            {TYPE_STYLE[t].abbr}
          </span>
          {COMPONENT_SPECS[t].label}
        </div>
      ))}
      <p className="pt-2 text-xs text-slate-400">
        Drag to add. Connect right handle → left handle. Select + Delete to remove.
      </p>
    </div>
  );
}
