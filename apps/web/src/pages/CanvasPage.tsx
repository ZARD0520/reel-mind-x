import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Asset,
  Canvas,
  CanvasGraph,
  GeneratedText,
  Project,
  VideoDuration,
} from '@reel/contracts';
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MiniMap,
  NodeToolbar,
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
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Check,
  AlignLeft,
  ArrowUp,
  Copy,
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
  Scissors,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  NodeModelSelect,
  normalizeCanvasModel,
  type CanvasModelId,
  type CanvasNodeKind,
} from '../features/canvas/components/NodeModelSelect';
import { Select, type SelectOption } from '../components/ui/Select';
import {
  IMAGE_SIZE_BY_RATIO,
  RATIO_OPTIONS,
  VIDEO_SIZE_BY_RATIO,
  type AspectRatioKey,
} from '../features/editor/constants';
import { ApiError, api } from '../lib/api';

type WorkflowNodeKind = CanvasNodeKind;
type GenerationCount = 1 | 2 | 4;
type GenerationCountValue = `${GenerationCount}`;
type VideoGenerationPresetValue = `${AspectRatioKey}|${VideoDuration}`;
type NodeSearchKind = 'all' | WorkflowNodeKind;

const DEFAULT_IMAGE_ASPECT_RATIO: AspectRatioKey = '1:1';
const DEFAULT_VIDEO_ASPECT_RATIO: AspectRatioKey = '16:9';
const DEFAULT_VIDEO_DURATION: VideoDuration = 5;
const DEFAULT_VIDEO_WITH_AUDIO = true;
const IMAGE_NODE_HEIGHT = 360;

const GENERATION_COUNT_OPTIONS: SelectOption<GenerationCountValue>[] = [
  { value: '1', label: '1 个' },
  { value: '2', label: '2 个' },
  { value: '4', label: '4 个' },
];

const IMAGE_ASPECT_RATIO_OPTIONS: SelectOption<AspectRatioKey>[] = RATIO_OPTIONS.map(
  ({ key, label }) => ({ value: key, label }),
);

const VIDEO_ASPECT_RATIO_OPTIONS = RATIO_OPTIONS.filter(
  ({ key }) => key === '16:9' || key === '9:16' || key === '1:1',
);

const VIDEO_RATIO_PANEL_OPTIONS: {
  label: string;
  value?: AspectRatioKey;
  iconClassName: string;
}[] = [
  { label: '16:9', value: '16:9', iconClassName: 'h-2.5 w-6' },
  { label: '4:3', iconClassName: 'h-3.5 w-5' },
  { label: '1:1', value: '1:1', iconClassName: 'h-4 w-4' },
  { label: '3:4', iconClassName: 'h-5 w-4' },
  { label: '9:16', value: '9:16', iconClassName: 'h-6 w-3.5' },
  { label: '21:9', iconClassName: 'h-2 w-7' },
];

const VIDEO_GENERATION_PRESET_OPTIONS: SelectOption<VideoGenerationPresetValue>[] =
  VIDEO_ASPECT_RATIO_OPTIONS.flatMap(({ key }) =>
    ([5, 10] as const).map((duration) => ({
      value: `${key}|${duration}` as VideoGenerationPresetValue,
      label: `${key} · ${duration} 秒`,
    })),
  );

const NODE_SEARCH_FILTERS: { value: NodeSearchKind; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
];

type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  title: string;
  content: string;
  prompt?: string;
  model?: string;
  assetId?: string;
  url?: string | null;
  status?: 'idle' | 'generating' | 'ready' | 'failed';
  error?: string;
  referenceNodeIds?: string[];
  generationCount?: GenerationCount;
  editorProjectId?: string;
  aspectRatio?: AspectRatioKey;
  videoDuration?: VideoDuration;
  videoWithAudio?: boolean;
};

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

const nodeTemplates: Record<WorkflowNodeKind, Omit<WorkflowNodeData, 'title'>> = {
  text: { kind: 'text', content: '' },
  image: { kind: 'image', content: '', aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO },
  video: {
    kind: 'video',
    content: '',
    aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
    videoDuration: DEFAULT_VIDEO_DURATION,
    videoWithAudio: DEFAULT_VIDEO_WITH_AUDIO,
  },
};

const nodeLabels: Record<WorkflowNodeKind, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
};

const nodeIcons = {
  text: AlignLeft,
  image: ImageIcon,
  video: Film,
};

const edgeDefaults = {
  type: 'bezier',
  pathOptions: { curvature: 0.38 },
  style: { stroke: '#6e7075', strokeWidth: 1.5 },
};

function normalizeImageAspectRatio(value: unknown): AspectRatioKey {
  return RATIO_OPTIONS.some(({ key }) => key === value)
    ? (value as AspectRatioKey)
    : DEFAULT_IMAGE_ASPECT_RATIO;
}

function normalizeVideoAspectRatio(value: unknown): AspectRatioKey {
  return VIDEO_ASPECT_RATIO_OPTIONS.some(({ key }) => key === value)
    ? (value as AspectRatioKey)
    : DEFAULT_VIDEO_ASPECT_RATIO;
}

function mediaNodeWidth(
  aspectRatio: AspectRatioKey | undefined,
  fallback: AspectRatioKey = DEFAULT_IMAGE_ASPECT_RATIO,
): number {
  const [width = 1, height = 1] = (aspectRatio ?? fallback).split(':').map(Number);
  return Math.round((IMAGE_NODE_HEIGHT * width) / height);
}

function followConnectionHandle(event: React.PointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const offsetX = Math.max(
    -32,
    Math.min(32, (event.clientX - (bounds.left + bounds.width / 2)) * 0.65),
  );
  const offsetY = Math.max(
    -32,
    Math.min(32, (event.clientY - (bounds.top + bounds.height / 2)) * 0.65),
  );
  event.currentTarget.style.setProperty('--connection-handle-x', `${offsetX}px`);
  event.currentTarget.style.setProperty('--connection-handle-y', `${offsetY}px`);
}

function resetConnectionHandle(event: React.PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty('--connection-handle-x', '0px');
  event.currentTarget.style.setProperty('--connection-handle-y', '0px');
}

function MagneticConnectionHandle({
  type,
  selected,
}: {
  type: 'source' | 'target';
  selected: boolean;
}) {
  const isTarget = type === 'target';
  const label = isTarget ? '连接到此节点' : '从此节点创建连线';

  return (
    <div
      onPointerMove={followConnectionHandle}
      onPointerLeave={resetConnectionHandle}
      className={`nodrag nopan absolute top-[calc(50%+18px)] z-[9] flex h-28 w-28 -translate-y-1/2 cursor-crosshair items-center justify-center ${isTarget ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'}`}
    >
      <span
        className={`pointer-events-none flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#242424] text-white shadow-[0_6px_18px_rgba(0,0,0,0.48)] transition-[opacity,background-color,box-shadow] group-hover:bg-[#303030] ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          transform: 'translate(var(--connection-handle-x, 0px), var(--connection-handle-y, 0px))',
        }}
      >
        <Plus className="h-6 w-6 stroke-[2.4]" />
      </span>
      <Handle
        type={type}
        position={isTarget ? Position.Left : Position.Right}
        aria-label={label}
        title={label}
        style={{
          left: '50%',
          right: 'auto',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
        className="!z-10 !h-10 !w-10 !cursor-crosshair !border-0 !bg-transparent !opacity-0"
      />
    </div>
  );
}

const CanvasIdContext = createContext('');

type DependencySelectionContextValue = {
  targetId: string | null;
  nodes: WorkflowNode[];
  edges: Edge[];
  start: (targetId: string) => void;
  cancel: () => void;
  remove: (edgeId: string) => void;
};

const DependencySelectionContext = createContext<DependencySelectionContextValue>({
  targetId: null,
  nodes: [],
  edges: [],
  start: () => undefined,
  cancel: () => undefined,
  remove: () => undefined,
});

function normalizeNode(node: CanvasGraph['nodes'][number]): WorkflowNode {
  const rawData = node.data as Partial<WorkflowNodeData>;
  const kind: WorkflowNodeKind =
    rawData.kind === 'image' || rawData.kind === 'video' ? rawData.kind : 'text';
  return {
    id: node.id,
    type: 'workflow',
    position: node.position,
    data: {
      kind,
      title: typeof rawData.title === 'string' ? rawData.title : nodeLabels[kind],
      content: typeof rawData.content === 'string' ? rawData.content : '',
      prompt: typeof rawData.prompt === 'string' ? rawData.prompt : '',
      model: typeof rawData.model === 'string' ? rawData.model : undefined,
      assetId: typeof rawData.assetId === 'string' ? rawData.assetId : undefined,
      url: typeof rawData.url === 'string' ? rawData.url : null,
      status:
        rawData.status === 'generating' || rawData.status === 'ready' || rawData.status === 'failed'
          ? rawData.status
          : 'idle',
      error: typeof rawData.error === 'string' ? rawData.error : '',
      referenceNodeIds: Array.isArray(rawData.referenceNodeIds)
        ? rawData.referenceNodeIds.filter((id): id is string => typeof id === 'string')
        : [],
      generationCount:
        rawData.generationCount === 2 || rawData.generationCount === 4
          ? rawData.generationCount
          : 1,
      editorProjectId:
        typeof rawData.editorProjectId === 'string' ? rawData.editorProjectId : undefined,
      aspectRatio:
        kind === 'image'
          ? normalizeImageAspectRatio(rawData.aspectRatio)
          : kind === 'video'
            ? normalizeVideoAspectRatio(rawData.aspectRatio)
            : undefined,
      videoDuration:
        kind === 'video' && rawData.videoDuration === 10
          ? 10
          : kind === 'video'
            ? DEFAULT_VIDEO_DURATION
            : undefined,
      videoWithAudio:
        kind === 'video' && typeof rawData.videoWithAudio === 'boolean'
          ? rawData.videoWithAudio
          : kind === 'video'
            ? DEFAULT_VIDEO_WITH_AUDIO
            : undefined,
    },
  };
}

function normalizeEdge(edge: CanvasGraph['edges'][number]): Edge {
  return { ...edge, ...edgeDefaults };
}

function serializeCanvasGraph(
  nodes: WorkflowNode[],
  edges: Edge[],
  viewport: Viewport,
): CanvasGraph {
  return {
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
    viewport,
  };
}

type GenerationResult = { type: 'text'; value: GeneratedText } | { type: 'media'; value: Asset };
type GenerationBatchResult = { values: GenerationResult[]; failedCount: number };

function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { message?: string | string[] };
      if (Array.isArray(body.message)) return body.message.join('；');
      if (body.message) return body.message;
    } catch {
      if (error.body.trim()) return error.body.trim();
    }
  }
  return error instanceof Error ? error.message : '生成请求失败，请稍后重试';
}

function NodeGenerationPrompt({
  nodeId,
  canvasId,
  kind,
  data,
}: {
  nodeId: string;
  canvasId: string;
  kind: WorkflowNodeKind;
  data: WorkflowNodeData;
}) {
  const { addEdges, addNodes, getNode, updateNodeData } = useReactFlow<WorkflowNode, Edge>();
  const dependencySelection = useContext(DependencySelectionContext);
  const [prompt, setPrompt] = useState(data.prompt ?? '');
  const [model, setModel] = useState<CanvasModelId>(normalizeCanvasModel(kind, data.model));
  const [generationCount, setGenerationCount] = useState<GenerationCount>(
    data.generationCount ?? 1,
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>(
    kind === 'video'
      ? normalizeVideoAspectRatio(data.aspectRatio)
      : normalizeImageAspectRatio(data.aspectRatio),
  );
  const [videoDuration, setVideoDuration] = useState<VideoDuration>(
    data.videoDuration === 10 ? 10 : DEFAULT_VIDEO_DURATION,
  );
  const [videoWithAudio, setVideoWithAudio] = useState(
    data.videoWithAudio ?? DEFAULT_VIDEO_WITH_AUDIO,
  );
  const [batchNotice, setBatchNotice] = useState('');
  const selectedReferenceIds = data.referenceNodeIds ?? [];

  const generation = useMutation<
    GenerationBatchResult,
    Error,
    { prompt: string; count: GenerationCount }
  >({
    mutationFn: async ({ prompt: nextPrompt, count }) => {
      let generateOne: () => Promise<GenerationResult>;
      if (kind === 'text') {
        const references = dependencySelection.edges
          .filter((edge) => edge.target === nodeId && selectedReferenceIds.includes(edge.source))
          .map((edge) => dependencySelection.nodes.find((node) => node.id === edge.source))
          .filter((node): node is WorkflowNode => !!node)
          .map((node) => {
            const reference = node.data.content || node.data.prompt || node.data.title;
            return `【${node.data.title}】${reference}`;
          });
        const promptWithReferences = references.length
          ? `请参考以下内容：\n${references.join('\n')}\n\n生成要求：${nextPrompt}`
          : nextPrompt;
        generateOne = async () => {
          const value = (await api.textGen.generate({
            prompt: promptWithReferences,
            maxLength: 2000,
            model,
          })) as GeneratedText;
          return { type: 'text', value };
        };
      } else {
        const imageReferences =
          kind === 'image'
            ? dependencySelection.edges
                .filter(
                  (edge) => edge.target === nodeId && selectedReferenceIds.includes(edge.source),
                )
                .map((edge) => dependencySelection.nodes.find((node) => node.id === edge.source))
                .filter((node): node is WorkflowNode => !!node && node.data.kind === 'text')
                .map((node) => node.data.content || node.data.prompt || node.data.title)
            : [];
        const imagePrompt = imageReferences.length
          ? `参考文本：\n${imageReferences.join('\n')}\n\n画面要求：${nextPrompt}`
          : nextPrompt;
        const videoReferenceNodes =
          kind === 'video'
            ? selectedReferenceIds
                .filter((referenceNodeId) =>
                  dependencySelection.edges.some(
                    (edge) => edge.target === nodeId && edge.source === referenceNodeId,
                  ),
                )
                .map((referenceNodeId) =>
                  dependencySelection.nodes.find((node) => node.id === referenceNodeId),
                )
                .filter(
                  (node): node is WorkflowNode =>
                    !!node && (node.data.kind === 'text' || node.data.kind === 'image'),
                )
            : [];
        const videoTextReferences = videoReferenceNodes
          .filter((node) => node.data.kind === 'text')
          .map((node) => `【${node.data.title}】${node.data.content || node.data.prompt}`);
        const videoPrompt = (
          videoTextReferences.length
            ? `视频要求：${nextPrompt}\n\n参考文本：\n${videoTextReferences.join('\n')}`
            : nextPrompt
        ).slice(0, 512);
        const videoImageNodes = videoReferenceNodes
          .filter((node) => node.data.kind === 'image')
          .slice(0, 2);
        const videoFrameAspectRatios = videoImageNodes.map((node) =>
          normalizeVideoAspectRatio(node.data.aspectRatio),
        );
        if (new Set(videoFrameAspectRatios).size > 1) {
          throw new Error('首帧和尾帧的比例需要保持一致');
        }
        const videoRequestAspectRatio = videoFrameAspectRatios[0] ?? aspectRatio;
        const videoImageAssetIds = videoImageNodes
          .map((node) => node.data.assetId)
          .filter((assetId): assetId is string => !!assetId);
        if (videoImageAssetIds.length !== videoImageNodes.length) {
          throw new Error('首尾帧图片尚未生成完成');
        }
        generateOne = async () => {
          const value = (
            kind === 'image'
              ? await api.aiGenMedia.generateImage({
                  canvasId,
                  prompt: imagePrompt,
                  size: IMAGE_SIZE_BY_RATIO[aspectRatio],
                  model,
                })
              : await api.aiGenMedia.generateVideo({
                  canvasId,
                  prompt: videoPrompt,
                  size: VIDEO_SIZE_BY_RATIO[videoRequestAspectRatio],
                  duration: videoDuration,
                  withAudio: videoWithAudio,
                  model,
                  imageAssetIds: videoImageAssetIds,
                })
          ) as Asset;
          return { type: 'media', value };
        };
      }

      const settled = await Promise.allSettled(Array.from({ length: count }, () => generateOne()));
      const values = settled
        .filter(
          (result): result is PromiseFulfilledResult<GenerationResult> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value);
      if (values.length === 0) {
        const firstFailure = settled.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        throw firstFailure?.reason instanceof Error
          ? firstFailure.reason
          : new Error('生成请求失败，请稍后重试');
      }
      return { values, failedCount: count - values.length };
    },
    onMutate: ({ prompt: nextPrompt, count }) => {
      setBatchNotice('');
      updateNodeData(nodeId, {
        prompt: nextPrompt,
        model,
        generationCount: count,
        ...(kind === 'image' || kind === 'video' ? { aspectRatio } : {}),
        ...(kind === 'video' ? { videoDuration, videoWithAudio } : {}),
        status: 'generating',
        error: '',
      });
    },
    onSuccess: ({ values, failedCount }, request) => {
      const [result, ...additionalResults] = values;
      if (!result) return;
      setPrompt('');
      if (result.type === 'text') {
        updateNodeData(nodeId, {
          content: result.value.text,
          prompt: '',
          model: result.value.model,
          status: 'ready',
          error: '',
        });
      } else {
        updateNodeData(nodeId, {
          assetId: result.value.id,
          editorProjectId: undefined,
          prompt: '',
          url: result.value.url,
          status: result.value.status,
          error: '',
        });
      }

      const sourceNode = getNode(nodeId);
      if (sourceNode && additionalResults.length > 0) {
        const horizontalGap =
          kind === 'video' || kind === 'image'
            ? mediaNodeWidth(
                aspectRatio,
                kind === 'video' ? DEFAULT_VIDEO_ASPECT_RATIO : DEFAULT_IMAGE_ASPECT_RATIO,
              ) + 40
            : 400;
        const nextNodes = additionalResults.map(
          (additionalResult, index): WorkflowNode => ({
            id: crypto.randomUUID(),
            type: 'workflow',
            position: {
              x: sourceNode.position.x + horizontalGap * (index + 1),
              y: sourceNode.position.y,
            },
            data: {
              ...data,
              title: `${data.title} ${index + 2}`,
              prompt: '',
              model: additionalResult.type === 'text' ? additionalResult.value.model : model,
              generationCount: request.count,
              aspectRatio: kind === 'image' || kind === 'video' ? aspectRatio : undefined,
              videoDuration: kind === 'video' ? videoDuration : undefined,
              videoWithAudio: kind === 'video' ? videoWithAudio : undefined,
              content: additionalResult.type === 'text' ? additionalResult.value.text : '',
              assetId: additionalResult.type === 'media' ? additionalResult.value.id : undefined,
              url: additionalResult.type === 'media' ? additionalResult.value.url : null,
              status: additionalResult.type === 'text' ? 'ready' : additionalResult.value.status,
              error: '',
              editorProjectId: undefined,
              referenceNodeIds: [...selectedReferenceIds],
            },
          }),
        );
        addNodes(nextNodes);

        const incomingEdges = dependencySelection.edges.filter((edge) => edge.target === nodeId);
        addEdges(
          nextNodes.flatMap((nextNode) =>
            incomingEdges.map((edge) => ({
              ...edge,
              id: crypto.randomUUID(),
              target: nextNode.id,
            })),
          ),
        );
      }

      if (failedCount > 0) {
        setBatchNotice(`已生成 ${values.length} 个，另有 ${failedCount} 个请求失败`);
      }
    },
    onError: (error) => {
      updateNodeData(nodeId, { status: 'failed', error: generationErrorMessage(error) });
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || generation.isPending) return;
    generation.mutate({ prompt: nextPrompt, count: generationCount });
  };

  const referenceDependencies = dependencySelection.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => ({
      edge,
      node: dependencySelection.nodes.find((node) => node.id === edge.source),
    }))
    .filter(
      (dependency): dependency is { edge: Edge; node: WorkflowNode } =>
        !!dependency.node &&
        (kind === 'text' ||
          (kind === 'image' && dependency.node.data.kind === 'text') ||
          (kind === 'video' &&
            (dependency.node.data.kind === 'text' || dependency.node.data.kind === 'image'))),
    );

  const selectedReferenceNodes = selectedReferenceIds
    .map((referenceNodeId) => referenceDependencies.find(({ node }) => node.id === referenceNodeId))
    .filter((dependency): dependency is { edge: Edge; node: WorkflowNode } => !!dependency)
    .map(({ node }) => node);
  const videoImageReferenceIds = selectedReferenceNodes
    .filter((node) => node.data.kind === 'image')
    .map((node) => node.id);
  const selectedVideoFrameAspectRatio = selectedReferenceNodes.find(
    (node) => node.data.kind === 'image',
  )?.data.aspectRatio;
  const lockedVideoAspectRatio = selectedVideoFrameAspectRatio
    ? normalizeVideoAspectRatio(selectedVideoFrameAspectRatio)
    : undefined;

  useEffect(() => {
    if (kind !== 'video' || !lockedVideoAspectRatio || lockedVideoAspectRatio === aspectRatio)
      return;
    setAspectRatio(lockedVideoAspectRatio);
    updateNodeData(nodeId, { aspectRatio: lockedVideoAspectRatio });
  }, [aspectRatio, kind, lockedVideoAspectRatio, nodeId, updateNodeData]);

  const addReferenceToInput = (referenceNodeId: string) => {
    if (selectedReferenceIds.includes(referenceNodeId)) return;
    const referenceNode = referenceDependencies.find(
      ({ node }) => node.id === referenceNodeId,
    )?.node;
    if (kind === 'video' && referenceNode?.data.kind === 'image') {
      const referenceAspectRatio = normalizeVideoAspectRatio(referenceNode.data.aspectRatio);
      if (lockedVideoAspectRatio && lockedVideoAspectRatio !== referenceAspectRatio) {
        setBatchNotice('首帧和尾帧的比例需要保持一致');
        return;
      }
      setAspectRatio(referenceAspectRatio);
      setBatchNotice('');
      updateNodeData(nodeId, {
        referenceNodeIds: [...selectedReferenceIds, referenceNodeId],
        aspectRatio: referenceAspectRatio,
      });
      return;
    }
    setBatchNotice('');
    updateNodeData(nodeId, {
      referenceNodeIds: [...selectedReferenceIds, referenceNodeId],
    });
  };

  const removeReferenceFromInput = (referenceNodeId: string) => {
    updateNodeData(nodeId, {
      referenceNodeIds: selectedReferenceIds.filter((id) => id !== referenceNodeId),
    });
  };

  const removeLastReferenceFromInput = () => {
    const lastReferenceId = selectedReferenceIds.at(-1);
    if (lastReferenceId) removeReferenceFromInput(lastReferenceId);
  };

  return (
    <form
      onSubmit={submit}
      className={`nodrag nopan nowheel rounded-2xl border border-white/[0.14] bg-[#242424] p-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.48)] ${kind === 'video' ? 'w-[640px]' : kind === 'image' ? 'w-[460px]' : 'w-[360px]'}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-1 flex min-h-8 items-center gap-1.5 px-2">
        <div className="reel-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {referenceDependencies.map(({ edge, node }) => {
            const ReferenceIcon = nodeIcons[node.data.kind];
            const frameIndex = videoImageReferenceIds.indexOf(node.id);
            return (
              <div
                key={edge.id}
                role="button"
                tabIndex={0}
                onClick={() => addReferenceToInput(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    addReferenceToInput(node.id);
                  }
                }}
                className={`group/reference flex h-7 max-w-36 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-[#d0d0d2] transition-colors ${selectedReferenceIds.includes(node.id) ? 'bg-white/[0.13]' : 'bg-white/[0.07] hover:bg-white/[0.1]'}`}
                title={node.data.title}
              >
                <ReferenceIcon className="h-3.5 w-3.5 shrink-0" />
                {kind === 'video' && frameIndex >= 0 && (
                  <span className="shrink-0 text-[10px] text-[#929297]">
                    {frameIndex === 0 ? '首帧' : '尾帧'}
                  </span>
                )}
                <span className="truncate">{node.data.title}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeReferenceFromInput(node.id);
                    dependencySelection.remove(edge.id);
                  }}
                  className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#8f8f94] opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-white group-hover/reference:opacity-100"
                  aria-label={`删除依赖 ${node.data.title}`}
                  title="删除依赖"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            updateNodeData(nodeId, {
              prompt,
              model,
              ...(kind === 'video' ? { aspectRatio, videoDuration, videoWithAudio } : {}),
            });
            dependencySelection.start(nodeId);
          }}
          disabled={generation.isPending}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#b8b8bd] hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          aria-label="添加参考节点"
          title="从画布选择参考节点"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-14 w-full flex-wrap content-start items-start gap-1.5 px-2 py-1">
        {selectedReferenceNodes.map((node) => {
          const ReferenceIcon = nodeIcons[node.data.kind];
          const frameIndex = videoImageReferenceIds.indexOf(node.id);
          return (
            <span
              key={node.id}
              className="mt-0.5 flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.1] px-2 text-xs text-[#e0e0e2]"
              title={node.data.title}
            >
              <ReferenceIcon className="h-3.5 w-3.5 shrink-0" />
              {kind === 'video' && frameIndex >= 0 && (
                <span className="shrink-0 text-[10px] text-[#a4a4a9]">
                  {frameIndex === 0 ? '首帧' : '尾帧'}
                </span>
              )}
              <span className="truncate">{node.data.title}</span>
            </span>
          );
        })}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !prompt && selectedReferenceIds.length > 0) {
              event.preventDefault();
              removeLastReferenceFromInput();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={generation.isPending}
          rows={selectedReferenceNodes.length > 0 ? 1 : 2}
          placeholder={
            kind === 'text'
              ? '描述你想生成的脚本...'
              : kind === 'image'
                ? '描述你想生成的图片...'
                : '描述你想生成的视频...'
          }
          className="reel-scroll min-h-7 min-w-32 flex-1 resize-none bg-transparent font-[inherit] text-sm leading-7 text-white outline-none placeholder:text-[#8f8f94] disabled:opacity-60"
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <NodeModelSelect
            kind={kind}
            value={model}
            onChange={setModel}
            disabled={generation.isPending}
          />
          {kind === 'image' && (
            <Select
              value={aspectRatio}
              options={IMAGE_ASPECT_RATIO_OPTIONS}
              onValueChange={(value) => {
                setAspectRatio(value);
                updateNodeData(nodeId, { aspectRatio: value });
              }}
              ariaLabel="选择图片比例"
              disabled={generation.isPending}
              size="compact"
              className="w-[108px]"
              triggerClassName="w-full"
              menuClassName="!w-36"
            />
          )}
          {kind === 'video' && (
            <Select
              value={`${aspectRatio}|${videoDuration}` as VideoGenerationPresetValue}
              options={VIDEO_GENERATION_PRESET_OPTIONS}
              onValueChange={(value) => {
                const [nextAspectRatio, nextDuration] = value.split('|');
                const normalizedAspectRatio = normalizeVideoAspectRatio(nextAspectRatio);
                const normalizedDuration: VideoDuration = nextDuration === '10' ? 10 : 5;
                setAspectRatio(normalizedAspectRatio);
                setVideoDuration(normalizedDuration);
                updateNodeData(nodeId, {
                  aspectRatio: normalizedAspectRatio,
                  videoDuration: normalizedDuration,
                });
              }}
              triggerContent={`${aspectRatio} · ${videoDuration}s · ${videoWithAudio ? '有声' : '静音'}`}
              panel={
                <div className="space-y-3.5 p-2.5">
                  <section>
                    <div className="mb-2 text-xs font-medium text-[#9c9ca1]">比例</div>
                    <div className="grid grid-cols-6 gap-1 rounded-2xl bg-white/[0.06] p-1">
                      {VIDEO_RATIO_PANEL_OPTIONS.map((option) => {
                        const isSelected = option.value === aspectRatio;
                        const isLockedByFrame =
                          !!option.value &&
                          !!lockedVideoAspectRatio &&
                          option.value !== lockedVideoAspectRatio;
                        return (
                          <button
                            key={option.label}
                            type="button"
                            disabled={!option.value || isLockedByFrame || generation.isPending}
                            onClick={() => {
                              if (!option.value) return;
                              setAspectRatio(option.value);
                              updateNodeData(nodeId, { aspectRatio: option.value });
                            }}
                            aria-pressed={isSelected}
                            aria-label={`视频比例 ${option.label}`}
                            title={
                              !option.value
                                ? '当前模型暂不支持'
                                : isLockedByFrame
                                  ? '视频比例已由首尾帧锁定'
                                  : option.label
                            }
                            className={`flex h-13 min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition-colors ${isSelected ? 'bg-white/[0.12] text-white' : 'text-[#77777c] hover:bg-white/[0.06] hover:text-[#c7c7ca]'} disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[#77777c]`}
                          >
                            <span
                              className={`rounded-[3px] border-2 ${option.iconClassName} ${isSelected ? 'border-white' : 'border-current'}`}
                            />
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="mb-2 text-xs font-medium text-[#9c9ca1]">生成时长</div>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
                      {([5, 10] as const).map((duration) => (
                        <button
                          key={duration}
                          type="button"
                          disabled={generation.isPending}
                          onClick={() => {
                            setVideoDuration(duration);
                            updateNodeData(nodeId, { videoDuration: duration });
                          }}
                          aria-pressed={videoDuration === duration}
                          className={`h-8 rounded-lg text-xs font-semibold transition-colors ${videoDuration === duration ? 'bg-white/[0.12] text-white' : 'text-[#77777c] hover:bg-white/[0.06] hover:text-[#c7c7ca]'}`}
                        >
                          {duration}s
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-2 text-xs font-medium text-[#9c9ca1]">生成音频</div>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
                      {[
                        { value: true, label: '开启' },
                        { value: false, label: '关闭' },
                      ].map((option) => (
                        <button
                          key={String(option.value)}
                          type="button"
                          disabled={generation.isPending}
                          onClick={() => {
                            setVideoWithAudio(option.value);
                            updateNodeData(nodeId, { videoWithAudio: option.value });
                          }}
                          aria-pressed={videoWithAudio === option.value}
                          className={`h-8 rounded-lg text-xs font-semibold transition-colors ${videoWithAudio === option.value ? 'bg-white/[0.12] text-white' : 'text-[#77777c] hover:bg-white/[0.06] hover:text-[#c7c7ca]'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              }
              ariaLabel="选择视频生成设置"
              disabled={generation.isPending}
              size="compact"
              className="w-[140px]"
              triggerClassName="w-full"
              menuClassName="!max-h-none !w-[320px] !overflow-visible !rounded-[18px] !p-1.5"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Select
            value={String(generationCount) as GenerationCountValue}
            options={GENERATION_COUNT_OPTIONS}
            onValueChange={(value) => {
              const count = Number(value) as GenerationCount;
              setGenerationCount(count);
              updateNodeData(nodeId, { generationCount: count });
            }}
            ariaLabel="选择生成数量"
            disabled={generation.isPending}
            size="compact"
            className="w-[72px]"
            triggerClassName="w-full"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || generation.isPending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f3f0] text-[#151515] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`生成${kind === 'text' ? '脚本' : kind === 'image' ? '图片' : '视频'}`}
          >
            {generation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4 stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
      {(generation.isError || (data.status === 'failed' && data.error)) && (
        <div className="px-2 pb-1 pt-2 text-xs text-red-400">
          {generation.isError ? generationErrorMessage(generation.error) : data.error}
        </div>
      )}
      {batchNotice && !generation.isError && (
        <div className="px-2 pb-1 pt-2 text-xs text-amber-300">{batchNotice}</div>
      )}
    </form>
  );
}

function WorkflowCard({ id, data, selected }: NodeProps<WorkflowNode>) {
  const canvasId = useContext(CanvasIdContext);
  const dependencySelection = useContext(DependencySelectionContext);
  const { updateNodeData } = useReactFlow<WorkflowNode, Edge>();
  const Icon = nodeIcons[data.kind];
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) titleInputRef.current?.select();
  }, [isRenaming]);

  useEffect(() => {
    if (!isRenaming) setTitleDraft(data.title);
  }, [data.title, isRenaming]);

  const startRenaming = (event: React.MouseEvent) => {
    if (!selected) return;
    event.stopPropagation();
    setTitleDraft(data.title);
    setIsRenaming(true);
  };

  const commitTitle = () => {
    const title = titleDraft.trim();
    setIsRenaming(false);
    setTitleDraft(title || data.title);
    if (title && title !== data.title) updateNodeData(id, { title });
  };

  const asset = useQuery<Asset>({
    queryKey: ['asset', data.assetId],
    queryFn: () => api.assets.get(data.assetId!) as Promise<Asset>,
    enabled: data.kind !== 'text' && !!data.assetId,
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' || data.status === 'generating' ? 3000 : false,
  });

  useEffect(() => {
    if (!asset.data) return;
    if (asset.data.status === data.status && asset.data.url === data.url) return;
    updateNodeData(id, {
      url: asset.data.url,
      status: asset.data.status,
      error: asset.data.status === 'failed' ? '生成失败' : '',
    });
  }, [asset.data, data.status, data.url, id, updateNodeData]);

  const isVideo = data.kind === 'video';
  const nodeWidth = isVideo
    ? mediaNodeWidth(data.aspectRatio, DEFAULT_VIDEO_ASPECT_RATIO)
    : data.kind === 'image'
      ? mediaNodeWidth(data.aspectRatio)
      : 360;
  const isSelectingDependency = dependencySelection.targetId !== null;
  const dependencyTarget = dependencySelection.nodes.find(
    (node) => node.id === dependencySelection.targetId,
  );
  const dependencyTargetImageCount = dependencySelection.edges.filter((edge) => {
    if (edge.target !== dependencySelection.targetId) return false;
    if (dependencyTarget?.data.kind !== 'video') return true;
    return dependencySelection.nodes.find((node) => node.id === edge.source)?.data.kind === 'image';
  }).length;
  const isDependencyCandidate =
    isSelectingDependency &&
    id !== dependencySelection.targetId &&
    (dependencyTarget?.data.kind !== 'image' || data.kind === 'text') &&
    (dependencyTarget?.data.kind !== 'video' ||
      data.kind === 'text' ||
      (data.kind === 'image' && dependencyTargetImageCount < 2)) &&
    !dependencySelection.edges.some(
      (edge) => edge.source === id && edge.target === dependencySelection.targetId,
    );
  return (
    <div
      className={`group transition-[width,opacity,filter] duration-200 ${isSelectingDependency && !isDependencyCandidate ? 'pointer-events-none opacity-20 grayscale' : ''} ${isDependencyCandidate ? 'cursor-copy drop-shadow-[0_0_14px_rgba(255,255,255,0.16)]' : ''}`}
      style={{ width: nodeWidth }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <NodeToolbar
        isVisible={selected && !isSelectingDependency}
        position={Position.Bottom}
        offset={12}
      >
        <NodeGenerationPrompt nodeId={id} canvasId={canvasId} kind={data.kind} data={data} />
      </NodeToolbar>
      <div className="workflow-node-title mb-2 flex h-7 min-w-0 items-center gap-2 px-2 text-base font-semibold">
        <Icon className="h-[18px] w-[18px]" />
        {isRenaming ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setTitleDraft(data.title);
                setIsRenaming(false);
              }
            }}
            maxLength={200}
            aria-label="修改节点名称"
            className="nodrag nopan nowheel min-w-0 flex-1 rounded-md border border-white/[0.16] bg-white/[0.07] px-2 py-0.5 text-base font-semibold text-white outline-none focus:border-[#49a8dc]"
          />
        ) : (
          <button
            type="button"
            onClick={startRenaming}
            onDoubleClick={(event) => event.stopPropagation()}
            className={`min-w-0 flex-1 truncate text-left ${selected ? 'cursor-text rounded px-1 hover:bg-white/[0.06]' : 'cursor-default'}`}
            title={selected ? '点击修改节点名称' : data.title}
          >
            {data.title}
          </button>
        )}
      </div>
      <MagneticConnectionHandle type="target" selected={selected} />
      {data.kind === 'text' ? (
        <div
          className={`h-[360px] overflow-hidden rounded-[24px] border bg-[#202020] p-5 shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-[border-color,box-shadow] ${selected ? 'border-[#49a8dc] shadow-[0_0_0_1px_rgba(73,168,220,0.2),0_18px_45px_rgba(0,0,0,0.34)]' : 'border-[#38383a]'}`}
        >
          <textarea
            value={data.content}
            onChange={(event) => updateNodeData(id, { content: event.target.value })}
            onWheel={(event) => event.stopPropagation()}
            placeholder="尚无文本内容"
            aria-label={`${data.title}内容`}
            className="workflow-node-editor reel-scroll nopan nowheel h-full w-full resize-none overflow-y-auto bg-transparent text-base font-normal leading-7 outline-none"
          />
        </div>
      ) : (
        <div
          className={`relative flex h-[360px] items-center justify-center overflow-hidden rounded-[24px] border bg-[#202020] shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-[border-color,box-shadow] ${selected ? 'border-[#49a8dc] shadow-[0_0_0_1px_rgba(73,168,220,0.2),0_18px_45px_rgba(0,0,0,0.34)]' : 'border-[#38383a]'}`}
        >
          {data.url ? (
            data.kind === 'image' ? (
              <img src={data.url} alt={data.title} className="h-full w-full object-contain" />
            ) : (
              <video
                src={data.url}
                controls
                className="nopan nowheel h-full w-full object-contain"
              />
            )
          ) : (
            <Icon className="h-16 w-16 stroke-[1.5] text-[#505054]" />
          )}
          {data.status === 'generating' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-sm text-[#d0d0d2] backdrop-blur-[2px]">
              <Loader2 className="h-6 w-6 animate-spin" />
              正在生成{data.kind === 'image' ? '图片' : '视频'}...
            </div>
          )}
          {data.status === 'failed' && !data.url && (
            <div className="absolute bottom-5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              生成失败，请重新尝试
            </div>
          )}
        </div>
      )}
      <MagneticConnectionHandle type="source" selected={selected} />
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

function InfiniteCanvas({
  canvas,
  onDependencySelectionChange,
}: {
  canvas: Canvas;
  onDependencySelectionChange: (active: boolean) => void;
}) {
  const navigate = useNavigate();
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
  const [showNodeSearch, setShowNodeSearch] = useState(false);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [nodeSearchKind, setNodeSearchKind] = useState<NodeSearchKind>('all');
  const nodeSearchInputRef = useRef<HTMLInputElement>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [dependencyTargetId, setDependencyTargetId] = useState<string | null>(null);
  const [nodeActionMenu, setNodeActionMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [nodeActionError, setNodeActionError] = useState<string | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const renderedEdges = useMemo(() => {
    if (!showEdges) return [];
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    return edges.map((edge) => {
      const isConnectedToSelection =
        selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
      return {
        ...edge,
        markerEnd: undefined,
        zIndex: isConnectedToSelection ? 1 : 0,
        style: {
          ...edge.style,
          stroke: isConnectedToSelection ? '#f7f7f2' : '#6e7075',
          strokeWidth: isConnectedToSelection ? 2.6 : 1.5,
        },
      };
    });
  }, [edges, nodes, showEdges]);

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

  const editVideo = useMutation<Project, Error, string>({
    mutationFn: async (nodeId) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.kind !== 'video') throw new Error('视频节点不存在');
      if (!node.data.assetId || node.data.status !== 'ready') {
        throw new Error('视频尚未生成完成，暂时无法编辑');
      }

      if (node.data.editorProjectId) {
        try {
          return (await api.projects.get(node.data.editorProjectId)) as Project;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }

      const project = (await api.projects.createFromCanvasVideo({
        assetId: node.data.assetId,
        name: `${node.data.title} 剪辑`,
      })) as Project;
      const nextNodes = nodes.map((candidate) =>
        candidate.id === nodeId
          ? { ...candidate, data: { ...candidate.data, editorProjectId: project.id } }
          : candidate,
      );
      setNodes(nextNodes);
      await saveGraph.mutateAsync(serializeCanvasGraph(nextNodes, edges, viewportRef.current));
      return project;
    },
    onMutate: () => setNodeActionError(null),
    onSuccess: (project) => {
      setNodeActionMenu(null);
      navigate(`/editor/${project.id}?canvasId=${encodeURIComponent(canvas.id)}`);
    },
    onError: (error) => setNodeActionError(generationErrorMessage(error)),
  });

  useEffect(() => {
    onDependencySelectionChange(dependencyTargetId !== null);
    return () => onDependencySelectionChange(false);
  }, [dependencyTargetId, onDependencySelectionChange]);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDependencyTargetId(null);
        setNodeActionMenu(null);
        setNodeActionError(null);
        setShowNodeSearch(false);
      }
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, []);

  useEffect(() => {
    if (!showNodeSearch) return undefined;
    const frame = window.requestAnimationFrame(() => nodeSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showNodeSearch]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    setSaveStatus('idle');
    const timeout = window.setTimeout(() => {
      saveGraphRef.current(serializeCanvasGraph(nodes, edges, viewportRef.current));
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [edges, nodes, viewportRevision]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false;
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      if (targetNode.data.kind === 'image') return sourceNode.data.kind === 'text';
      if (targetNode.data.kind === 'video') {
        const existingInputCount = edges.filter(
          (edge) =>
            edge.target === targetNode.id &&
            edge.id !== ('id' in connection ? connection.id : '') &&
            nodes.find((node) => node.id === edge.source)?.data.kind === 'image',
        ).length;
        return (
          sourceNode.data.kind === 'text' ||
          (sourceNode.data.kind === 'image' && existingInputCount < 2)
        );
      }
      return true;
    },
    [edges, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (dependencyTargetId || !isValidConnection(connection)) return;
      setEdges((currentEdges) => addEdge({ ...connection, ...edgeDefaults }, currentEdges));
    },
    [dependencyTargetId, isValidConnection, setEdges],
  );

  const chooseDependency = useCallback(
    (sourceId: string) => {
      if (!dependencyTargetId || sourceId === dependencyTargetId) return;
      const sourceNode = nodes.find((node) => node.id === sourceId);
      const targetNode = nodes.find((node) => node.id === dependencyTargetId);
      if (!sourceNode || !targetNode) return;
      if (targetNode.data.kind === 'image' && sourceNode.data.kind !== 'text') return;
      if (targetNode.data.kind === 'video') {
        const inputCount = edges.filter(
          (edge) =>
            edge.target === targetNode.id &&
            nodes.find((node) => node.id === edge.source)?.data.kind === 'image',
        ).length;
        if (
          sourceNode.data.kind !== 'text' &&
          (sourceNode.data.kind !== 'image' || inputCount >= 2)
        ) {
          return;
        }
      }
      if (edges.some((edge) => edge.source === sourceId && edge.target === dependencyTargetId)) {
        return;
      }
      setEdges((currentEdges) =>
        addEdge(
          {
            id: crypto.randomUUID(),
            source: sourceId,
            target: dependencyTargetId,
            ...edgeDefaults,
          },
          currentEdges,
        ),
      );
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          selected: node.id === dependencyTargetId,
        })),
      );
      setShowEdges(true);
      setDependencyTargetId(null);
    },
    [dependencyTargetId, edges, nodes, setEdges, setNodes],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      if (!instance || !wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const center = instance.screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
      const nextNode: WorkflowNode = {
        id: crypto.randomUUID(),
        type: 'workflow',
        position: { x: center.x - (kind === 'video' ? 320 : 180), y: center.y - 195 },
        data: {
          ...nodeTemplates[kind],
          title: nodeLabels[kind],
        },
      };
      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        nextNode,
      ]);
      setShowAddMenu(false);
    },
    [instance, setNodes],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      setNodes((currentNodes) => {
        const sourceNode = currentNodes.find((node) => node.id === nodeId);
        if (!sourceNode) return currentNodes;
        const duplicatedNode: WorkflowNode = {
          ...sourceNode,
          id: crypto.randomUUID(),
          position: { x: sourceNode.position.x + 36, y: sourceNode.position.y + 36 },
          selected: true,
          data: {
            ...sourceNode.data,
            title: `${sourceNode.data.title} 副本`,
            referenceNodeIds: [],
            editorProjectId: undefined,
          },
        };
        return [...currentNodes.map((node) => ({ ...node, selected: false })), duplicatedNode];
      });
      setNodeActionMenu(null);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      );
      setDependencyTargetId((targetId) => (targetId === nodeId ? null : targetId));
      setNodeActionMenu(null);
    },
    [setEdges, setNodes],
  );

  const openNodeActionMenu = useCallback(
    (event: React.MouseEvent, node: WorkflowNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (dependencyTargetId || !wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      setShowAddMenu(false);
      setShowNodeSearch(false);
      setNodeActionError(null);
      setNodeActionMenu({
        nodeId: node.id,
        x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 144)),
        y: Math.max(8, Math.min(event.clientY - bounds.top + 8, bounds.height - 132)),
      });
    },
    [dependencyTargetId],
  );
  const actionMenuNode = nodeActionMenu
    ? nodes.find((node) => node.id === nodeActionMenu.nodeId)
    : undefined;
  const normalizedNodeSearchQuery = nodeSearchQuery.trim().toLocaleLowerCase();
  const searchedNodes = nodes.filter(
    (node) =>
      (nodeSearchKind === 'all' || node.data.kind === nodeSearchKind) &&
      (!normalizedNodeSearchQuery ||
        node.data.title.toLocaleLowerCase().includes(normalizedNodeSearchQuery)),
  );

  const focusNodeFromSearch = (node: WorkflowNode) => {
    setNodes((currentNodes) =>
      currentNodes.map((candidate) => ({ ...candidate, selected: candidate.id === node.id })),
    );
    const width =
      node.measured?.width ??
      (node.data.kind === 'video'
        ? mediaNodeWidth(node.data.aspectRatio, DEFAULT_VIDEO_ASPECT_RATIO)
        : node.data.kind === 'image'
          ? mediaNodeWidth(node.data.aspectRatio)
          : 360);
    const height = node.measured?.height ?? 397;
    const zoom = instance ? Math.min(Math.max(instance.getZoom(), 0.75), 1.1) : 1;
    void instance?.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom,
      duration: 320,
    });
    setShowNodeSearch(false);
  };

  return (
    <div
      ref={wrapperRef}
      className={`absolute inset-0 ${dependencyTargetId ? 'canvas-dependency-selecting' : ''}`}
      onPointerDownCapture={(event) => {
        if (
          nodeActionMenu &&
          event.target instanceof Element &&
          !event.target.closest('[data-node-action-menu]')
        ) {
          setNodeActionMenu(null);
        }
      }}
    >
      <CanvasIdContext.Provider value={canvas.id}>
        <DependencySelectionContext.Provider
          value={{
            targetId: dependencyTargetId,
            nodes,
            edges,
            start: (targetId) => {
              setShowAddMenu(false);
              setDependencyTargetId(targetId);
            },
            cancel: () => setDependencyTargetId(null),
            remove: (edgeId) => {
              setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
            },
          }}
        >
          <ReactFlow<WorkflowNode, Edge>
            nodes={nodes}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            connectOnClick
            connectionRadius={12}
            connectionLineType={ConnectionLineType.Bezier}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => {
              setNodeActionMenu(null);
              chooseDependency(node.id);
            }}
            onNodeDragStart={(event) => {
              if (event.target instanceof HTMLTextAreaElement) event.target.blur();
            }}
            onNodeDoubleClick={openNodeActionMenu}
            onNodeContextMenu={openNodeActionMenu}
            onInit={setInstance}
            onMove={(_, viewport) => {
              viewportRef.current = viewport;
              setZoom(Math.round(viewport.zoom * 100));
            }}
            onMoveEnd={(_, viewport) => {
              viewportRef.current = viewport;
              setViewportRevision((value) => value + 1);
            }}
            onPaneClick={() => {
              setShowAddMenu(false);
              setNodeActionMenu(null);
              setNodeActionError(null);
              setDependencyTargetId(null);
            }}
            defaultViewport={canvas.graph.viewport}
            minZoom={0.25}
            maxZoom={2}
            nodeDragThreshold={4}
            nodeClickDistance={4}
            snapToGrid={snapToGrid}
            snapGrid={[24, 24]}
            nodesDraggable={!dependencyTargetId}
            nodesConnectable={!dependencyTargetId}
            panOnDrag={!dependencyTargetId}
            panOnScroll={!dependencyTargetId}
            zoomOnScroll={!dependencyTargetId}
            selectionOnDrag={!dependencyTargetId}
            deleteKeyCode={dependencyTargetId ? null : ['Backspace', 'Delete']}
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
              color="#5a5a60"
              bgColor="#050505"
            />
            {showMiniMap && !dependencyTargetId && (
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(node) =>
                  node.data.kind === 'text'
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
        </DependencySelectionContext.Provider>
      </CanvasIdContext.Provider>

      {nodeActionMenu && (
        <div
          data-node-action-menu
          className="nodrag nopan nowheel absolute z-30 w-32 overflow-hidden rounded-xl border border-white/[0.13] bg-[#292929] p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.52)]"
          style={{ left: nodeActionMenu.x, top: nodeActionMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {actionMenuNode?.data.kind === 'video' && (
            <button
              type="button"
              onClick={() => editVideo.mutate(nodeActionMenu.nodeId)}
              disabled={
                editVideo.isPending ||
                !actionMenuNode.data.assetId ||
                actionMenuNode.data.status !== 'ready'
              }
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title={
                actionMenuNode.data.status === 'ready' ? '进入剪辑页' : '视频生成完成后才能编辑'
              }
            >
              {editVideo.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Scissors className="h-4 w-4" />
              )}
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={() => duplicateNode(nodeActionMenu.nodeId)}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <Copy className="h-4 w-4" />
            复制
          </button>
          <button
            type="button"
            onClick={() => deleteNode(nodeActionMenu.nodeId)}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#ef9b9b] transition-colors hover:bg-red-500/[0.12] hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      )}

      {nodeActionError && (
        <div className="absolute left-1/2 top-20 z-40 max-w-md -translate-x-1/2 rounded-xl border border-red-400/20 bg-[#2a1717] px-4 py-2.5 text-sm text-red-300 shadow-xl">
          {nodeActionError}
        </div>
      )}

      {showNodeSearch && !dependencyTargetId && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-5 backdrop-blur-[2px]"
          onPointerDown={() => setShowNodeSearch(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="搜索节点"
            className="nodrag nopan nowheel flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#242424] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-white/[0.08] p-4 pb-3">
              <div className="flex h-11 items-center gap-2.5 rounded-xl border border-white/[0.12] bg-white/[0.055] px-3 focus-within:border-white/[0.24]">
                <Search className="h-4.5 w-4.5 shrink-0 text-[#85858a]" />
                <input
                  ref={nodeSearchInputRef}
                  value={nodeSearchQuery}
                  onChange={(event) => setNodeSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && searchedNodes[0]) {
                      event.preventDefault();
                      focusNodeFromSearch(searchedNodes[0]);
                    }
                  }}
                  placeholder="搜索节点名称"
                  aria-label="搜索节点名称"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#77777c]"
                />
                {nodeSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setNodeSearchQuery('');
                      nodeSearchInputRef.current?.focus();
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white"
                    aria-label="清空搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1" aria-label="节点分类筛选">
                {NODE_SEARCH_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setNodeSearchKind(filter.value)}
                    className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${nodeSearchKind === filter.value ? 'bg-[#f3f3f0] text-[#151515]' : 'text-[#a4a4a8] hover:bg-white/[0.07] hover:text-white'}`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="reel-scroll min-h-40 flex-1 overflow-y-auto p-2">
              {searchedNodes.length > 0 ? (
                <div className="space-y-1">
                  {searchedNodes.map((node) => {
                    const NodeIcon = nodeIcons[node.data.kind];
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => focusNodeFromSearch(node)}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-[#b8b8bd] group-hover:text-white">
                          <NodeIcon className="h-4.5 w-4.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[#eeeeef]">
                            {node.data.title}
                          </span>
                          <span className="mt-1 block text-xs text-[#77777c]">
                            {nodeLabels[node.data.kind]}节点
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center text-center">
                  <Search className="h-6 w-6 text-[#55555a]" />
                  <p className="mt-3 text-sm text-[#9a9a9f]">没有找到匹配节点</p>
                  <p className="mt-1 text-xs text-[#66666b]">尝试更换关键词或节点分类</p>
                </div>
              )}
            </div>
            <div className="border-t border-white/[0.08] px-4 py-2.5 text-xs text-[#66666b]">
              共 {searchedNodes.length} 个节点
            </div>
          </section>
        </div>
      )}

      {dependencyTargetId && (
        <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-xl border border-white/[0.14] bg-[#292929] px-4 py-2 text-sm text-[#e1e1e3] shadow-xl">
          选择一个未连接节点作为参考
          <span className="ml-2 text-xs text-[#8f8f94]">Esc 或点击空白处取消</span>
        </div>
      )}

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

      <aside
        className={`absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[24px] border border-white/[0.13] bg-[#252525] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.48)] transition-opacity ${dependencyTargetId ? 'pointer-events-none opacity-20' : ''}`}
      >
        <IconButton
          label="添加节点"
          active={showAddMenu}
          onClick={() => setShowAddMenu((value) => !value)}
        >
          <Plus className="h-6 w-6" />
        </IconButton>
        <IconButton
          label="搜索"
          active={showNodeSearch}
          onClick={() => {
            setShowAddMenu(false);
            setNodeActionMenu(null);
            setNodeActionError(null);
            setShowNodeSearch((value) => !value);
          }}
        >
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

      {showAddMenu && !dependencyTargetId && (
        <div className="absolute left-[76px] top-1/2 z-20 w-52 -translate-y-[142px] rounded-2xl border border-white/[0.13] bg-[#252525] p-2 shadow-[0_20px_55px_rgba(0,0,0,0.55)]">
          <div className="px-3 pb-2 pt-1 text-xs text-[#77777b]">添加节点</div>
          {(['text', 'image', 'video'] as const).map((kind) => {
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
                    {kind === 'text'
                      ? '编写文本内容'
                      : kind === 'image'
                        ? '添加图片素材'
                        : '添加视频素材'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className={`absolute bottom-4 left-1/2 z-10 -translate-x-1/2 transition-opacity ${dependencyTargetId ? 'pointer-events-none opacity-20' : ''}`}
      >
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
  const [isDependencySelecting, setIsDependencySelecting] = useState(false);
  const cancelNameEditRef = useRef(false);

  useEffect(() => {
    const preventHorizontalHistoryNavigation = (event: WheelEvent) => {
      if (!event.cancelable || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
    };

    window.addEventListener('wheel', preventHorizontalHistoryNavigation, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener('wheel', preventHorizontalHistoryNavigation, true);
    };
  }, []);

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
    <div className="relative h-full overflow-hidden overscroll-x-none bg-[#050505] text-[#f7f7f2]">
      <InfiniteCanvas canvas={canvas.data} onDependencySelectionChange={setIsDependencySelecting} />

      <div
        className={`absolute left-5 top-5 z-10 flex items-center gap-3 transition-opacity ${isDependencySelecting ? 'pointer-events-none opacity-20' : ''}`}
      >
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
