import { describe, expect, it } from 'vitest';
import { DesignParseError, parseDesign, serializeDesign } from '../src/engine/schema';

const minimal = {
  name: 'x',
  nodes: [
    { id: 'c', type: 'client', position: { x: 0, y: 0 } },
    { id: 'db', type: 'sqlDb', params: { capacity: 500 } },
  ],
  edges: [{ source: 'c', target: 'db' }],
};

describe('parseDesign', () => {
  it('fills defaults for missing params', () => {
    const d = parseDesign(minimal);
    const db = d.nodes.find((n) => n.id === 'db')!;
    expect(db.params.capacity).toBe(500);
    expect(db.params.replicas).toBe(0);
    expect(db.params.instances).toBe(1);
    expect(d.edges[0].id).toBe('e-c-db');
    expect(d.workload.readRatio).toBeGreaterThan(0);
  });

  it('round-trips through JSON', () => {
    const d = parseDesign(minimal);
    expect(parseDesign(JSON.parse(serializeDesign(d)))).toEqual(d);
  });

  it('rejects unknown types, duplicate ids and dangling edges', () => {
    expect(() => parseDesign({ nodes: [{ id: 'a', type: 'mainframe' }], edges: [] })).toThrow(DesignParseError);
    expect(() =>
      parseDesign({ nodes: [{ id: 'a', type: 'client' }, { id: 'a', type: 'client' }], edges: [] }),
    ).toThrow(/Duplicate/);
    expect(() => parseDesign({ nodes: [{ id: 'a', type: 'client' }], edges: [{ source: 'a', target: 'zz' }] })).toThrow(
      /unknown node/,
    );
    expect(() => parseDesign('nope')).toThrow(DesignParseError);
  });
});
