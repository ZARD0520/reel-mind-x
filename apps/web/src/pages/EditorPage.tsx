import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAssets, useProject, useUpdateProject } from '../features/editor/hooks';
import { useEditorStore } from '../features/editor/store';
import { EditorTopBar } from '../features/editor/components/EditorTopBar';
import { AiMixDialog } from '../features/editor/components/AiMixDialog';
import { LeftPanel } from '../features/editor/components/LeftPanel';
import { PreviewCanvas } from '../features/editor/components/PreviewCanvas';
import { PropertiesPanel } from '../features/editor/components/PropertiesPanel';
import { Timeline } from '../features/editor/components/Timeline';
import { PREVIEW_FPS } from '../features/editor/constants';

export function EditorPage() {
  const { id = '' } = useParams();
  const { data: project, isLoading } = useProject(id);
  const { data: assets = [] } = useAssets();
  const updateProject = useUpdateProject(id);

  const { timeline, selectedClipId, setTimeline, selectClip } = useEditorStore();
  const removeClip = useEditorStore((s) => s.removeClip);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  // 项目加载完成后初始化 store。
  useEffect(() => {
    if (project?.timeline && !timeline) setTimeline(project.timeline);
  }, [project?.timeline, timeline, setTimeline]);

  // 键盘：Delete 删除选中片段；Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z（或 Ctrl+Y）重做。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        removeClip(selectedClipId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, removeClip, undo, redo]);

  // 自动保存：timeline 变化后 1.5s 防抖提交。
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!timeline) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateProject.mutate({ timeline });
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // 播放时钟
  // 计算时间轴总时长（秒，用于导出文件大小估算）
  const exportTotalFrames = (() => {
    if (!timeline) return 0;
    let max = 0;
    for (const t of timeline.tracks) {
      for (const c of t.clips) max = Math.max(max, c.start + c.durationInFrames);
      if (t.kind === 'text' && t.textClips) {
        for (const tc of t.textClips) max = Math.max(max, tc.start + tc.durationInFrames);
      }
    }
    return max;
  })();
  const durationSec = exportTotalFrames / (timeline?.settings.fps ?? 30);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [aiMixOpen, setAiMixOpen] = useState(false);
  const lastRef = useRef(0);

  const fps = timeline?.settings.fps ?? PREVIEW_FPS;
  const totalFrames = (() => {
    if (!timeline) return PREVIEW_FPS * 30;
    let max = PREVIEW_FPS * 5;
    for (const t of timeline.tracks) {
      // 包含媒体片段和文本片段的末尾
      for (const c of t.clips) max = Math.max(max, c.start + c.durationInFrames);
      if (t.kind === 'text' && t.textClips) {
        for (const tc of t.textClips) max = Math.max(max, tc.start + tc.durationInFrames);
      }
    }
    return max;
  })();

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setCurrentFrame((f) => {
        const next = f + dt * fps;
        if (next >= totalFrames) { setIsPlaying(false); return totalFrames; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, fps, totalFrames]);

  const handleTogglePlay = () => {
    setCurrentFrame((f) => (f >= totalFrames ? 0 : f));
    setIsPlaying((p) => !p);
  };
  const handleSeek = (frame: number) => {
    setIsPlaying(false);
    setCurrentFrame(Math.max(0, Math.min(frame, totalFrames)));
  };

  if (isLoading || !timeline) {
    return (
      <div className="flex h-full items-center justify-center bg-base text-fg-secondary">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      <EditorTopBar
        projectId={id}
        projectName={project?.name}
        isSaving={updateProject.isPending}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onRename={(name) => updateProject.mutate({ name })}
        onOpenAiMix={() => setAiMixOpen(true)}
        durationSec={durationSec}
        width={timeline?.settings.width ?? 1920}
        height={timeline?.settings.height ?? 1080}
        onBeforeExport={async () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (timeline) await updateProject.mutateAsync({ timeline });
        }}
      />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <PreviewCanvas
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
        />
        <PropertiesPanel />
      </div>
      <Timeline
        timeline={timeline}
        assets={assets}
        currentFrame={currentFrame}
        selectedClipId={selectedClipId}
        onSeek={handleSeek}
        onSelectClip={selectClip}
      />
      <AiMixDialog
        open={aiMixOpen}
        projectId={id}
        assets={assets}
        onClose={() => setAiMixOpen(false)}
        onApply={(draftTimeline) => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          setIsPlaying(false);
          setCurrentFrame(0);
          setTimeline(draftTimeline);
          selectClip(null);
          updateProject.mutate({ timeline: draftTimeline });
          setAiMixOpen(false);
        }}
      />
    </div>
  );
}
