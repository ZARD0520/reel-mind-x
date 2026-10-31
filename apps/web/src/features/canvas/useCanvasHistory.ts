import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { CanvasHistory } from './history';

export function useCanvasHistory<N extends Node>(nodes: N[], edges: Edge[], setNodes: Dispatch<SetStateAction<N[]>>, setEdges: Dispatch<SetStateAction<Edge[]>>) {
  const history = useRef<CanvasHistory<N>>();
  if (!history.current) history.current = new CanvasHistory({ nodes, edges });
  const graph = useRef({ nodes, edges });
  graph.current = { nodes, edges };
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    if (history.current!.observe({ nodes, edges })) refresh(value => value + 1);
  }, [nodes, edges]);
  const travel = useCallback((direction: 'undo' | 'redo') => {
    const result = history.current!.travel(graph.current, direction);
    if (!result) return;
    graph.current = result;
    setNodes(result.nodes);
    setEdges(result.edges);
    refresh(value => value + 1);
  }, [setNodes, setEdges]);
  return {
    undo: useCallback(() => travel('undo'), [travel]),
    redo: useCallback(() => travel('redo'), [travel]),
    breakGroup: useCallback(() => history.current!.breakGroup(), []),
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
  };
}
