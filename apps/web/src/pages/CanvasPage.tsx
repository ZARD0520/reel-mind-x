import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Canvas, CanvasGraph } from '@reel/contracts';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Check,
  FileText,
  Film,
  Focus,
  Folder,
  Grid3X3,
  History,
  Image as ImageIcon,
  LayoutPanelTop,
  Loader2,
  Map,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type WorkflowNodeKind = 'script' | 'image' | 'video';

type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  title: string;
  description: string;
};

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

const nodeTemplates: Record<WorkflowNodeKind, Omit<WorkflowNodeData, 'title'>> = {
  script: { kind: 'script', description: '输入创意描述，生成分镜脚本' },
  image: { kind: 'image', description: '根据提示词生成视觉素材' },
  video: { kind: 'video', description: '组合素材并生成视频片段' },
};

const nodeLabels: Record<WorkflowNodeKind, string> = {
  script: '脚本',
  image: '图片',
  video: '视频',
};

const nodeIcons = {
  script: FileText,
  image: ImageIcon,
  video: Film,
};

const edgeDefaults = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#6e7075' },
  style: { stroke: '#6e7075', strokeWidth: 1.5 },
};

function normalizeNode(node: CanvasGraph['nodes'][number]): WorkflowNode {
  const rawData = node.data as Partial<WorkflowNodeData>;
  const kind: WorkflowNodeKind =
    rawData.kind === 'image' || rawData.kind === 'video' ? rawData.kind : 'script';
  return {
    id: node.id,
    type: 'workflow',
    position: node.position,
    data: {
      kind,
      title: typeof rawData.title === 'string' ? rawData.title : nodeLabels[kind],
      description:
        typeof rawData.description === 'string'
          ? rawData.description
          : nodeTemplates[kind].description,
    },
  };
}

function normalizeEdge(edge: CanvasGraph['edges'][number]): Edge {
  return { ...edge, ...edgeDefaults };
}

function WorkflowCard({ data, selected }: NodeProps<WorkflowNode>) {
  const Icon = nodeIcons[data.kind];
  return (
    <div
      className={`w-[300px] overflow-hidden rounded-2xl border bg-[#202020] shadow-[0_18px_45px_rgba(0,0,0,0.38)] transition-[border-color,box-shadow] ${selected ? 'border-[#49a8dc] shadow-[0_0_0_1px_rgba(73,168,220,0.25),0_18px_45px_rgba(0,0,0,0.42)]' : 'border-white/[0.14]'}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[#151515] !bg-[#8b8d91]"
      />
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.07] text-[#c8c8ca]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#efefec]">
          {data.title}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-[#6fba8a]">
          <Check className="h-3 w-3" />
          就绪
        </span>
      </div>
      {data.kind === 'script' ? (
        <div className="min-h-[112px] px-4 py-3 text-xs leading-6 text-[#a5a5a8]">
          {data.description}
          <div className="mt-2 text-[#707075]">在后续迭代中，这里会接入提示词编辑和脚本生成。</div>
        </div>
      ) : (
        <div
          className={`m-3 flex h-[126px] items-center justify-center rounded-xl border border-white/[0.06] ${data.kind === 'image' ? 'bg-[radial-gradient(circle_at_50%_70%,#17455a_0%,#0d1e29_36%,#111214_75%)]' : 'bg-[linear-gradient(145deg,#172933,#0b1115_55%,#171719)]'}`}
        >
          <Icon className="h-8 w-8 text-white/25" />
        </div>
      )}
      <div className="px-4 pb-3 text-xs text-[#747478]">{data.description}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#151515] !bg-[#49a8dc]"
      />
    </div>
  );
}

const MemoWorkflowCard = memo(WorkflowCard);
const nodeTypes = { workflow: MemoWorkflowCard };

function IconButton({
  label,
  children,
  active = false,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${active ? 'bg-[#f7f7f2] text-[#111]' : 'text-[#b9b9ba] hover:bg-white/[0.08] hover:text-[#f7f7f2]'}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function InfiniteCanvas({ canvas }: { canvas: Canvas }) {
  const queryClient = useQueryClient();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>(canvas.graph.viewport);
  const initializedRef = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(
    canvas.graph.nodes.map(normalizeNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    canvas.graph.edges.map(normalizeEdge),
  );
  const [instance, setInstance] = useState<ReactFlowInstance<WorkflowNode, Edge> | null>(null);
  const [zoom, setZoom] = useState(Math.round(canvas.graph.viewport.zoom * 100));
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const saveGraph = useMutation({
    mutationFn: (graph: CanvasGraph) =>
      api.canvases.update(canvas.id, { graph }) as Promise<Canvas>,
    onMutate: () => setSaveStatus('saving'),
    onSuccess: (updatedCanvas) => {
      queryClient.setQueryData(['canvas', canvas.id], updatedCanvas);
      void queryClient.invalidateQueries({ queryKey: ['canvases'] });
      setSaveStatus('saved');
    },
    onError: () => setSaveStatus('error'),
  });
  const saveGraphRef = useRef(saveGraph.mutate);
  saveGraphRef.current = saveGraph.mutate;

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    setSaveStatus('idle');
    const timeout = window.setTimeout(() => {
      const graph: CanvasGraph = {
        version: 1,
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type ?? 'workflow',
          position: node.position,
          data: node.data,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
        viewport: viewportRef.current,
      };
      saveGraphRef.current(graph);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [edges, nodes, viewportRevision]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => addEdge({ ...connection, ...edgeDefaults }, currentEdges));
    },
    [setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      if (!instance || !wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const center = instance.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
      const number = nodes.filter((node) => node.data.kind === kind).length + 1;
      const nextNode: WorkflowNode = {
        id: crypto.randomUUID(),
        type: 'workflow',
        position: { x: center.x - 150, y: center.y - 100 },
        data: {
          ...nodeTemplates[kind],
          title: `${nodeLabels[kind]} ${number}`,
        },
      };
      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        nextNode,
      ]);
      setShowAddMenu(false);
    },
    [instance, nodes, setNodes],
  );

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <ReactFlow<WorkflowNode, Edge>
        nodes={nodes}
        edges={showEdges ? edges : []}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setInstance}
        onMove={(_, viewport) => {
          viewportRef.current = viewport;
          setZoom(Math.round(viewport.zoom * 100));
        }}
        onMoveEnd={(_, viewport) => {
          viewportRef.current = viewport;
          setViewportRevision((value) => value + 1);
        }}
        onPaneClick={() => setShowAddMenu(false)}
        defaultViewport={canvas.graph.viewport}
        minZoom={0.25}
        maxZoom={2}
        snapToGrid={snapToGrid}
        snapGrid={[24, 24]}
        panOnScroll
        selectionOnDrag
        deleteKeyCode={['Backspace', 'Delete']}
        fitView={
          canvas.graph.nodes.length > 0 &&
          canvas.graph.viewport.zoom === 1 &&
          canvas.graph.viewport.x === 0 &&
          canvas.graph.viewport.y === 0
        }
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#303033"
          bgColor="#050505"
        />
        {showMiniMap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(node) =>
              node.data.kind === 'script'
                ? '#77777c'
                : node.data.kind === 'image'
                  ? '#347a98'
                  : '#555d65'
            }
            maskColor="rgba(5,5,5,0.72)"
            className="!bottom-4 !right-4 !m-0 !h-[120px] !w-[190px] !rounded-xl !border !border-white/[0.12] !bg-[#1d1d1d]"
          />
        )}
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="-translate-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.12] bg-[#171717] text-[#7b7b80]">
              <Workflow className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-lg font-semibold">开始构建素材工作流</h1>
            <p className="mt-2 text-sm text-[#7b7b80]">点击左侧加号添加第一个节点</p>
          </div>
        </div>
      )}

      <aside className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[24px] border border-white/[0.13] bg-[#252525] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.48)]">
        <IconButton
          label="添加节点"
          active={showAddMenu}
          onClick={() => setShowAddMenu((value) => !value)}
        >
          <Plus className="h-6 w-6" />
        </IconButton>
        <IconButton label="搜索">
          <Search className="h-5 w-5" />
        </IconButton>
        <IconButton label="素材库">
          <Folder className="h-5 w-5" />
        </IconButton>
        <IconButton label="节点列表">
          <LayoutPanelTop className="h-5 w-5" />
        </IconButton>
        <IconButton label="对话">
          <MessageCircle className="h-5 w-5" />
        </IconButton>
        <IconButton label="历史记录">
          <History className="h-5 w-5" />
        </IconButton>
      </aside>

      {showAddMenu && (
        <div className="absolute left-[76px] top-1/2 z-20 w-52 -translate-y-[142px] rounded-2xl border border-white/[0.13] bg-[#252525] p-2 shadow-[0_20px_55px_rgba(0,0,0,0.55)]">
          <div className="px-3 pb-2 pt-1 text-xs text-[#77777b]">添加节点</div>
          {(['script', 'image', 'video'] as const).map((kind) => {
            const Icon = nodeIcons[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addNode(kind)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.07]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-[#c8c8ca]">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm text-[#efefec]">{nodeLabels[kind]}节点</span>
                  <span className="mt-0.5 block text-[11px] text-[#77777b]">
                    {nodeTemplates[kind].description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
        <div className="flex h-12 items-center gap-1 rounded-2xl border border-white/[0.12] bg-[#252525] px-2 shadow-lg">
          <IconButton
            label="小地图"
            active={showMiniMap}
            onClick={() => setShowMiniMap((value) => !value)}
          >
            <Map className="h-5 w-5" />
          </IconButton>
          <IconButton
            label="连接关系"
            active={showEdges}
            onClick={() => setShowEdges((value) => !value)}
          >
            <Workflow className="h-5 w-5" />
          </IconButton>
          <IconButton
            label="网格吸附"
            active={snapToGrid}
            onClick={() => setSnapToGrid((value) => !value)}
          >
            <Grid3X3 className="h-5 w-5" />
          </IconButton>
          <IconButton
            label="适应画布"
            onClick={() => void instance?.fitView({ padding: 0.25, duration: 300 })}
          >
            <Focus className="h-5 w-5" />
          </IconButton>
          <button
            type="button"
            onClick={() => void instance?.zoomOut({ duration: 180 })}
            className="ml-1 flex h-8 w-8 items-center justify-center text-[#b9b9ba] hover:text-white"
            aria-label="缩小"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs text-[#b9b9ba]">{zoom}%</span>
          <button
            type="button"
            onClick={() => void instance?.zoomIn({ duration: 180 })}
            className="flex h-8 w-8 items-center justify-center text-[#b9b9ba] hover:text-white"
            aria-label="放大"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 top-6 z-10 flex items-center gap-1.5 text-[11px] text-[#67676b]">
        {saveStatus === 'saving' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            正在保存
          </>
        )}
        {saveStatus === 'saved' && (
          <>
            <Check className="h-3 w-3" />
            已保存
          </>
        )}
        {saveStatus === 'error' && <span className="text-red-400">保存失败</span>}
      </div>
    </div>
  );
}

export function CanvasPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [hasNameError, setHasNameError] = useState(false);
  const cancelNameEditRef = useRef(false);
  const canvas = useQuery<Canvas>({
    queryKey: ['canvas', id],
    queryFn: () => api.canvases.get(id) as Promise<Canvas>,
    enabled: !!id,
    retry: false,
  });
  const updateName = useMutation({
    mutationFn: (nextName: string) =>
      api.canvases.update(id, { name: nextName }) as Promise<Canvas>,
    onSuccess: (updatedCanvas) => {
      queryClient.setQueryData(['canvas', id], updatedCanvas);
      void queryClient.invalidateQueries({ queryKey: ['canvases'] });
      setName(updatedCanvas.name);
      setHasNameError(false);
    },
    onError: () => {
      setName(canvas.data?.name ?? '');
      setHasNameError(true);
    },
  });

  useEffect(() => {
    if (canvas.data) setName(canvas.data.name);
  }, [canvas.data]);

  const saveName = () => {
    const nextName = name.trim();
    const currentName = canvas.data?.name ?? '';
    if (cancelNameEditRef.current) {
      cancelNameEditRef.current = false;
      setName(currentName);
      return;
    }
    if (!nextName) {
      setName(currentName);
      return;
    }
    if (nextName === currentName || updateName.isPending) {
      setName(currentName);
      return;
    }
    updateName.mutate(nextName);
  };

  if (canvas.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#050505] text-[#7b7b80]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!canvas.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#050505] text-[#b9b9ba]">
        <p>无法打开这个工作流画布</p>
        <button
          type="button"
          onClick={() => navigate('/project')}
          className="rounded-xl border border-white/[0.14] px-4 py-2 text-sm text-[#f7f7f2] hover:bg-white/[0.07]"
        >
          返回工作空间
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#050505] text-[#f7f7f2]">
      <InfiniteCanvas canvas={canvas.data} />

      <div className="absolute left-5 top-5 z-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/project')}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.12] bg-[#202020] text-[#b9b9ba] shadow-lg transition-colors hover:bg-[#292929] hover:text-white"
          aria-label="返回工作空间"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="relative">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setHasNameError(false);
            }}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                cancelNameEditRef.current = true;
                setName(canvas.data.name);
                event.currentTarget.blur();
              }
            }}
            maxLength={200}
            className={`h-10 w-[120px] rounded-xl border bg-[#202020] px-4 pr-10 text-sm font-semibold text-[#f7f7f2] shadow-lg outline-none transition-colors placeholder:text-[#7b7b80] sm:w-[160px] ${hasNameError ? 'border-red-400/60' : 'border-white/[0.12] hover:border-white/[0.2] focus:border-white/[0.3]'}`}
            aria-label="画布名称"
          />
          {updateName.isPending && (
            <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-[#7b7b80]" />
          )}
        </div>
      </div>
    </div>
  );
}
