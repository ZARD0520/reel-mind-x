import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Clapperboard, Loader2, Plus, User } from 'lucide-react';
import type { Project } from '@reel/contracts';
import { api } from '../lib/api';

export function HomePage() {
  const navigate = useNavigate();

  // 新建剪辑：后端创建项目，拿到 ID 后进入剪辑页（保证项目在 DB 存在）。
  const createProject = useMutation({
    mutationFn: () => api.projects.create('未命名项目') as Promise<Project>,
    onSuccess: (project) => navigate(`/editor/${project.id}`),
  });

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent">
            <Clapperboard className="h-[18px] w-[18px]" />
          </div>
          <span className="text-lg font-bold">ReelMind</span>
        </div>
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-elevated">
          <User className="h-[18px] w-[18px] text-fg-secondary" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-3.5">
        <p className="text-[13px] font-semibold tracking-[2px] text-accent">AI 视频创作</p>
        <h1 className="text-[44px] font-bold">开始你的创作</h1>
        <p className="text-base text-fg-secondary">一键新建项目，进入剪辑工作台</p>

        <div className="flex flex-col items-center gap-3 pt-7">
          <button
            type="button"
            onClick={() => createProject.mutate()}
            disabled={createProject.isPending}
            className="flex items-center justify-center gap-2.5 rounded-[14px] bg-accent px-8 py-4 text-lg font-semibold text-fg shadow-[0_8px_24px_0_#4e7cff55] transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {createProject.isPending ? (
              <Loader2 className="h-[22px] w-[22px] animate-spin" />
            ) : (
              <Plus className="h-[22px] w-[22px]" />
            )}
            开始创作
          </button>
          {createProject.isError && (
            <p className="text-[13px] text-red-400">创建失败，请确认后端已启动</p>
          )}
        </div>
      </main>
    </div>
  );
}
