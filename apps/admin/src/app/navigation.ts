import { Activity, Coins, Film, Image, LayoutDashboard, ListChecks, Settings2, Users } from 'lucide-react';

export const adminNavigation = [
  { path: '/overview', title: '数据概览', icon: LayoutDashboard },
  { path: '/users', title: '用户管理', icon: Users },
  { path: '/projects', title: '项目管理', icon: Film },
  { path: '/assets', title: '资产管理', icon: Image },
  { path: '/tasks', title: '生成任务', icon: Activity },
  { path: '/ledger', title: '积分流水', icon: Coins },
  { path: '/prices', title: '模型定价', icon: Settings2 },
  { path: '/audits', title: '操作审计', icon: ListChecks },
] as const;
