import { create } from 'zustand';
import type { Asset, Clip, Timeline, Track, TrackKind } from '@reel/contracts';
import { others, resolveMove } from './collision';

// 图片默认时长（秒）；落帧时乘 project fps。
const IMAGE_DEFAULT_SECONDS = 3;

function uuid(): string {
  return crypto.randomUUID();
}

function defaultTransform(): Clip['transform'] {
  return { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1 };
}

/** 素材应落在哪种轨道：音频→audio，视频/图片→video */
function trackKindForAsset(asset: Asset): TrackKind {
  return asset.kind === 'audio' ? 'audio' : 'video';
}

/** 该素材作为片段的时间轴时长（帧） */
function clipDuration(asset: Asset, fps: number): number {
  if (asset.durationInFrames && asset.durationInFrames > 0) return asset.durationInFrames;
  return Math.round(IMAGE_DEFAULT_SECONDS * fps);
}

function trackEnd(track: Track): number {
  return track.clips.reduce((max, c) => Math.max(max, c.start + c.durationInFrames), 0);
}

function newTrack(kind: TrackKind): Track {
  return { id: uuid(), kind, muted: false, hidden: false, clips: [] };
}

/** 移除无片段的轨道（空轨自动消失） */
function pruneEmptyTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.clips.length > 0);
}

/** 拖放落点：放到已有轨道某帧，或在某索引新建一轨 */
export type DropTarget =
  | { trackId: string; atFrame: number }
  | { newTrackAt: number; atFrameForNew?: number };

const HISTORY_LIMIT = 50;

interface EditorState {
  timeline: Timeline | null;
  selectedClipId: string | null;
  past: Timeline[];
  future: Timeline[];
  setTimeline: (timeline: Timeline) => void;
  selectClip: (clipId: string | null) => void;
  /**
   * 把素材放到时间轴。
   * - 不传 target：追加到对应类型轨道末尾（无则新建），兼容点击添加。
   * - target.trackId + atFrame：放到指定轨道的指定帧（拖放落点；自动吸附避让）。
   * - target.newTrackAt：在该索引处新建一轨并放入（拖到空白区分层）。
   */
  addAsset: (asset: Asset, target?: DropTarget) => void;
  /** 切换轨道显隐（预览跳过隐藏视频轨） */
  toggleTrackHidden: (trackId: string) => void;
  /** 切换轨道静音（音频轨：是否可听） */
  toggleTrackMuted: (trackId: string) => void;
  /** 拖拽排序：把轨道从 from 移到 to（数组索引；末尾＝上层） */
  moveTrack: (from: number, to: number) => void;
  /** 切换单个片段静音（用 transform.volume===0 表示静音） */
  toggleClipMuted: (clipId: string) => void;
  /** 删除片段（轨道清空后一并移除） */
  removeClip: (clipId: string) => void;
  /** 更新片段时间属性（拖移/trim）；只允许改 start/durationInFrames/trimStart。不入历史（拖拽期间高频调用） */
  updateClip: (
    clipId: string,
    patch: Partial<Pick<Clip, 'start' | 'durationInFrames' | 'trimStart'>>,
  ) => void;
  /** 更新片段 transform（预览里缩放/位移）；不入历史（拖拽期间高频调用，结束时 commitHistory） */
  updateClipTransform: (clipId: string, patch: Partial<Clip['transform']>) => void;
  /** 在指定帧处分割选中片段为两段（分割点须落在片段内部） */
  splitClip: (clipId: string, atFrame: number) => void;
  /** 复制片段，放到同轨最近的空闲位置并选中 */
  duplicateClip: (clipId: string) => void;
  /** 把一个快照压入历史（拖拽结束时提交 pre-drag 快照） */
  commitHistory: (snapshot: Timeline) => void;
  undo: () => void;
  redo: () => void;
}

/** 历史推进：把当前 timeline 压入 past、清空 future */
function pushPast(state: EditorState): Pick<EditorState, 'past' | 'future'> {
  if (!state.timeline) return { past: state.past, future: [] };
  return { past: [...state.past, state.timeline].slice(-HISTORY_LIMIT), future: [] };
}

/** 在 tracks 中找到某片段所属的轨道 */
function findTrack(tracks: Track[], clipId: string): Track | undefined {
  return tracks.find((t) => t.clips.some((c) => c.id === clipId));
}

function mapClipTrack(
  tracks: Track[],
  clipId: string,
  fn: (clip: Clip) => Clip,
): Track[] {
  return tracks.map((t) => {
    if (!t.clips.some((c) => c.id === clipId)) return t;
    return { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) };
  });
}

export const useEditorStore = create<EditorState>((set) => ({
  timeline: null,
  selectedClipId: null,
  past: [],
  future: [],

  // 初始化/加载项目：重置历史。
  setTimeline: (timeline) => set({ timeline, past: [], future: [] }),
  selectClip: (clipId) => set({ selectedClipId: clipId }),

  addAsset: (asset, target) =>
    set((state) => {
      if (!state.timeline) return state;
      const fps = state.timeline.settings.fps;
      const kind = trackKindForAsset(asset);
      const duration = clipDuration(asset, fps);

      const clip: Clip = {
        id: uuid(),
        assetId: asset.id,
        start: 0,
        durationInFrames: duration,
        trimStart: 0,
        transform: defaultTransform(),
      };

      let tracks = [...state.timeline.tracks];

      if (target && 'trackId' in target) {
        // 放到指定轨道的指定帧（碰撞吸附到最近空位）。
        const idx = tracks.findIndex((t) => t.id === target.trackId);
        if (idx === -1) return state;
        const tk = tracks[idx]!;
        // 类型隔离：音频素材只能进音频轨，视频/图片只能进视频轨。类型不符则忽略本次拖放。
        if (tk.kind !== kind) return state;
        clip.start = resolveMove(target.atFrame, duration, tk.clips);
        tracks[idx] = { ...tk, clips: [...tk.clips, clip] };
      } else if (target && 'newTrackAt' in target) {
        // 在指定位置新建一轨并放入（拖到空白区分层）。
        clip.start = Math.max(0, target.atFrameForNew ?? 0);
        const at = Math.max(0, Math.min(target.newTrackAt, tracks.length));
        tracks.splice(at, 0, { ...newTrack(kind), clips: [clip] });
      } else {
        // 无落点（点击添加）：追加到同类型轨道末尾，无则新建。
        const idx = tracks.findIndex((t) => t.kind === kind);
        if (idx === -1) {
          tracks.push({ ...newTrack(kind), clips: [clip] });
        } else {
          const tk = tracks[idx]!;
          clip.start = trackEnd(tk);
          tracks[idx] = { ...tk, clips: [...tk.clips, clip] };
        }
      }

      tracks = pruneEmptyTracks(tracks);
      return {
        ...pushPast(state),
        timeline: { ...state.timeline, tracks },
        selectedClipId: clip.id,
      };
    }),

  toggleTrackHidden: (trackId) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = state.timeline.tracks.map((t) =>
        t.id === trackId ? { ...t, hidden: !t.hidden } : t,
      );
      // 显隐是查看态，不入历史。
      return { timeline: { ...state.timeline, tracks } };
    }),

  toggleTrackMuted: (trackId) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = state.timeline.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted } : t,
      );
      // 静音是查看态，不入历史。
      return { timeline: { ...state.timeline, tracks } };
    }),

  moveTrack: (from, to) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = [...state.timeline.tracks];
      if (from < 0 || from >= tracks.length || to < 0 || to >= tracks.length || from === to) {
        return state;
      }
      const [moved] = tracks.splice(from, 1);
      tracks.splice(to, 0, moved!);
      return { ...pushPast(state), timeline: { ...state.timeline, tracks } };
    }),

  toggleClipMuted: (clipId) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = mapClipTrack(state.timeline.tracks, clipId, (c) => ({
        ...c,
        transform: { ...c.transform, volume: c.transform.volume === 0 ? 1 : 0 },
      }));
      return { ...pushPast(state), timeline: { ...state.timeline, tracks } };
    }),

  removeClip: (clipId) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = state.timeline.tracks
        .map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }))
        .filter((t) => t.clips.length > 0); // 空轨道一并清理
      return {
        ...pushPast(state),
        timeline: { ...state.timeline, tracks },
        selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      };
    }),

  updateClip: (clipId, patch) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = mapClipTrack(state.timeline.tracks, clipId, (c) => ({ ...c, ...patch }));
      return { timeline: { ...state.timeline, tracks } };
    }),

  updateClipTransform: (clipId, patch) =>
    set((state) => {
      if (!state.timeline) return state;
      const tracks = mapClipTrack(state.timeline.tracks, clipId, (c) => ({
        ...c,
        transform: { ...c.transform, ...patch },
      }));
      return { timeline: { ...state.timeline, tracks } };
    }),

  splitClip: (clipId, atFrame) =>
    set((state) => {
      if (!state.timeline) return state;
      const frame = Math.round(atFrame);
      const newId = uuid();
      let didSplit = false;

      const tracks = state.timeline.tracks.map((t) => {
        if (!t.clips.some((c) => c.id === clipId)) return t;
        const clips: Clip[] = [];
        for (const c of t.clips) {
          // 分割点必须严格落在片段内部（两侧各留 ≥1 帧）。
          if (c.id === clipId && frame > c.start && frame < c.start + c.durationInFrames) {
            const leftDur = frame - c.start;
            clips.push({ ...c, durationInFrames: leftDur });
            clips.push({
              ...c,
              id: newId,
              start: frame,
              trimStart: c.trimStart + leftDur, // 右段从源的对应位置开始
              durationInFrames: c.durationInFrames - leftDur,
            });
            didSplit = true;
          } else {
            clips.push(c);
          }
        }
        return { ...t, clips };
      });

      if (!didSplit) return state; // 播放头不在片段内，不动
      return {
        ...pushPast(state),
        timeline: { ...state.timeline, tracks },
        selectedClipId: newId,
      };
    }),

  duplicateClip: (clipId) =>
    set((state) => {
      if (!state.timeline) return state;
      const track = findTrack(state.timeline.tracks, clipId);
      const src = track?.clips.find((c) => c.id === clipId);
      if (!track || !src) return state;

      // 放到原片段右侧最近的空闲位置（碰撞吸附）。
      const newId = uuid();
      const start = resolveMove(
        src.start + src.durationInFrames,
        src.durationInFrames,
        others(track.clips, clipId),
      );
      const dup: Clip = { ...src, id: newId, start };

      const tracks = state.timeline.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: [...t.clips, dup] } : t,
      );
      return {
        ...pushPast(state),
        timeline: { ...state.timeline, tracks },
        selectedClipId: newId,
      };
    }),

  commitHistory: (snapshot) =>
    set((state) => ({
      past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
      future: [],
    })),

  undo: () =>
    set((state) => {
      const prev = state.past[state.past.length - 1];
      if (!prev || !state.timeline) return state;
      return {
        timeline: prev,
        past: state.past.slice(0, -1),
        future: [state.timeline, ...state.future].slice(0, HISTORY_LIMIT),
        selectedClipId: null,
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next || !state.timeline) return state;
      return {
        timeline: next,
        past: [...state.past, state.timeline].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedClipId: null,
      };
    }),
}));
