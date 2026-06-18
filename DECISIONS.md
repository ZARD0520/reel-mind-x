# 决策记录（Decision Log）

> 本文件记录 reel-mind-x 所有关键技术/产品决策，供后续迭代回溯。**新决策一律追加到这里**，不要散落各处。
> 格式：每条含 **决策 / 原因 / 状态**。日期为决定日。

---

## 架构与技术栈

### D1. Monorepo 结构（2026-06-15）
- **决策**：pnpm workspaces + Turborepo；`apps/*`（可部署应用）+ `packages/*`（共享库）；包 scope `@reel/*`，引用走 `workspace:*`，只从入口导入。
- **原因**：前后端 + 共享契约统一管理，类型/校验跨端复用。
- **状态**：✅ 已落地。

### D2. 技术栈（2026-06-15）
- **决策**：后端 NestJS；前端 React CSR（Vite）；TypeScript 全栈；队列 BullMQ + Redis；数据库 PostgreSQL + Prisma。后续可能加 Next.js 官网/营销 SEO。
- **状态**：✅ 已落地（api / web / contracts / db）。

### D3. agent 不独立成 app（2026-06-16）
- **决策**：agent 逻辑作为 `apps/api` 内的一个 module（`src/modules/agent/`），不单独拆服务。
- **原因**：MVP 阶段无需独立部署/接口，放后端内更简单。
- **状态**：✅ 已落地。

### D4. 共享包必须导出 JS 而非 .ts（2026-06-17）
- **决策**：`@reel/db` 入口直接指向 Prisma 生成的 CJS client（`generated/client`，无需编译）；`@reel/contracts`（纯 TS）用 tsc 编译到 `dist`（CJS），入口指向 dist。turbo `dev` 加 `dependsOn: ["^build"]`。
- **原因**：NestJS 是 Node CJS 运行时，`require` 原始 `.ts` 入口会在 `export` 处报错（Vite 能吃 TS 但 Node 不行）。
- **状态**：✅ 已落地。详见 `.claude/rules/prisma.md`。

### D5. 本地端口避让（2026-06-16）
- **决策**：本项目 docker 宿主机端口 Postgres=**5433**、Redis=**6380**（容器内仍 5432/6379）。
- **原因**：本机已有另一项目（malouassistant）占用 5432/6379。
- **状态**：✅ 已落地（docker-compose + 各 .env）。

---

## 前端

### D6. 路由与样式（2026-06-16）
- **决策**：路由 React Router v7（全屏页面，无共享导航布局）；样式 Tailwind CSS v4（`@tailwindcss/vite` 插件，配色 token 写在 `index.css` 的 `@theme`）。
- **状态**：✅ 已落地。

### D7. 页面风格参考剪映（CapCut）（2026-06-16）
- **决策**：首页 + 剪辑页均参考剪映深色专业工具风。配色变量统一（accent 蓝 #4E7CFF、深色 bg 层级、clip-video/audio 等）。
- **状态**：✅ 设计稿（home.pen / edit.pen）+ 页面实现完成。

### D8. 首页交互（2026-06-16，更新 2026-06-17）
- **决策**：首页「开始创作」按钮 → `POST /projects` 创建项目（后端生成 id）→ 跳转 `/editor/:id`。
- **原因**：原方案（前端 `crypto.randomUUID()` 直接跳转）会导致编辑页 `GET /projects/:id` 404。改为创建后跳转，id 仍在 URL，UX 不变，但项目在 DB 中真实存在。按钮有 loading 态和错误提示。
- **状态**：✅ 已更新。

---

## 视频合成（核心架构约束）

### D9. 禁用需付费授权的依赖（Remotion）（2026-06-17）⭐
- **决策**：**不使用 Remotion**（含 `@remotion/player` 前端预览 与 `@remotion/renderer`/Lambda 服务端渲染）。已从 `apps/web` 移除。
- **原因**：项目**会商用**、团队**会超 3 人**，硬约束是**不能有额外第三方授权成本**。Remotion 对 >3 人公司需购买 Company License。
- **影响**：选型时一律先查许可，拒绝任何对商用/团队规模收费的库。
- **状态**：✅ 已移除 Remotion。

### D10. 服务端合成走 FFmpeg（2026-06-17）⭐
- **决策**：视频合成用 **FFmpeg**（在 BullMQ worker 内调用，LGPL/GPL 免费）。前端预览用**原生 `<video>`/`<canvas>` + WebAudio**，本地时钟（rAF）驱动时间轴播放头。
- **原因**：D9 排除 Remotion 后，FFmpeg 是最成熟的零授权成本方案。
- **已接受的代价**：① 预览(canvas/video)与成片(ffmpeg)是两套渲染，需刻意保持参数一致；② 复杂效果（转场/动画/特效）需手写 filtergraph，比 React 难维护 → MVP 先做最简拼接。
- **状态**：✅ 预览已改原生时钟驱动；FFmpeg 合成待 P0-#7 实现。

---

## 数据模型

### D11. 剪辑状态 schema（2026-06-17）
- **决策**：放 `packages/contracts`（Zod 单一真相）。结构：`Asset`（素材库，可复用，独立于时间轴）/ `Clip`（时间轴放置，引用 assetId）/ `Track`（video|audio，数组顺序=图层顺序）/ `Timeline`（settings + tracks，核心载荷）/ `Project` / `RenderJob`。
- **关键决策**：
  - **时间单位 = 帧**（整数）+ project 级 fps。无浮点漂移，转秒给 FFmpeg 精确，预览=成片最易对齐。
  - **Asset 与 Clip 分离**：一个素材可被多个片段引用。
  - 片段时间模型用 `start + durationInFrames + trimStart`（统一，图片忽略 trimStart）。
  - **transform 已预留**（scale/x/y/rotation/opacity/volume，带默认值），MVP 可不编辑。
  - `ProjectSettings`（fps/width/height）是预览与 FFmpeg 共用的输出规格。
  - UI 状态（选中/播放头/缩放）不进 schema。
- **待补**：跨字段约束（片段不重叠、trim 不超源时长、audio 只能在 audio 轨）等接真实编辑流程时再加 `.refine()`。
- **状态**：✅ 已落地。

### D12. 项目持久化（2026-06-17）
- **决策**：Prisma `Project` model，`timeline` 存 **jsonb**；`projects` 模块 CRUD（NestJS），DTO 用 nestjs-zod `createZodDto` 复用 contracts schema，全局 `ZodValidationPipe`。读出时 `ProjectSchema.parse` 校验 jsonb 完整性。
- **MVP 简化**：接口**暂无鉴权**（已有 User model 占位，等用户体系再加）。
- **状态**：✅ 已落地，CRUD 端到端验证通过。

---

## 素材

### D13. AI 生成素材延后（2026-06-17）
- **决策**：AI 生成素材管线**先不做**，后续迭代。
- **原因**：涉及"用什么生成"（自托管开源模型 vs 付费 API），且受 D9 无第三方成本约束，需单独评估。
- **状态**：⏸ 推迟。

### D14. 素材上传先做本地"假上传"（2026-06-17）⭐
- **决策**：当前本地起服务，**不传线上存储**。做**本地存储**：multipart 上传到 NestJS → 文件存本机目录 → Asset 记录存**本机文件路径/本地 URL**。本地服务后续直接拿本机文件处理（FFmpeg）。
- **原因**：本地开发阶段，无需对象存储。存储层抽象好，后续换 S3 只改实现。
- **实现要点**：
  - `POST /assets`（multipart，字段名 `file`）→ Multer diskStorage 存到 `STORAGE_DIR/uploads`，文件名用 UUID + 原扩展名。
  - ffprobe（`@ffprobe-installer/ffprobe` + `fluent-ffmpeg`，自带二进制零系统依赖）探测 kind/时长/宽高。
  - `Asset.localPath`（本机绝对路径）**只存库不暴露**给前端；前端只拿 `url`（`/static/uploads/...`，由 `ServeStaticModule` 暴露 `STORAGE_DIR`）。
  - 还有 `GET /assets`、`GET /assets/:id`。
  - **已知限制**：`Asset.durationInFrames` 用参考 fps=30 折算（项目默认 fps 也是 30）。若将来支持多 fps，需改存秒/源时长，下单独决策。
  - **存储目录依 cwd 解析**：dev 用 `nest start`（cwd=`apps/api`）→ `apps/api/storage`。换启动目录会变，注意。
  - 素材当前**不绑定 project**（全局素材库），clip 通过 assetId 引用。
- **状态**：✅ 上传/探测/落库/静态访问端到端验证通过。AI 生成部分见 D13（推迟）。

---

## MVP 范围

### D15. MVP 功能优先级（2026-06-17）
- **P0（闭环必需）**：①schema ✅ ②项目持久化 ✅ ③素材上传(本地) ✅ / AI生成⏸ ④时间轴接真实片段 ✅ ⑤片段操作 ✅ ⑥预览驱动(原生video/canvas) ✅ ⑦导出=BullMQ+FFmpeg
- **P1**：导出进度/状态反馈、自动保存✅、音频音量
- **P2（暂不做）**：转场/特效/文字贴纸/变速/关键帧/撤销重做/协作
- **状态**：进行中，P0①~⑥ 完成，⑦ 导出/合成待做。

### D17. 片段操作与实时预览（2026-06-17）
- **片段操作**：
  - **拖移**：ClipBlock 主区 `onPointerDown`+`setPointerCapture`，横向移动改 `clip.start`（clamp ≥ 0）。
  - **Trim 右边缘**：拖右侧 8px 热区，改 `clip.durationInFrames`（不超 asset 源时长，最小 15 帧）。
  - **Trim 左边缘**：拖左侧 8px 热区，同时改 `clip.start`、`clip.trimStart`、`clip.durationInFrames`（保持源内容对齐）。
  - **删除**：工具栏 Trash 按钮（选中时高亮）+ 键盘 `Delete`/`Backspace`（输入框聚焦时忽略）。空轨道自动清理。
  - 所有改动走 `store.updateClip/removeClip` → 触发 1.5s 防抖自动保存。
- **实时预览**：
  - `PreviewCanvas` 从 store 读 timeline、从 TanStack Query 读 assets（去重缓存）。
  - 当前帧 → 找最顶层 video 轨的活动片段（`clip.start ≤ frame < clip.start + duration`）。
  - 图片片段 → `<img>` 展示；视频片段 → `<video>` 元素（常驻 DOM 保持 ref 稳定），用 `video.currentTime` scrubbing（`= (frame - clip.start + clip.trimStart) / fps`）。
  - 无活动片段 → 黑底占位文字。
  - **MVP 限制**：纯 scrubbing 模式，不调 `video.play()`，所以视频帧逐帧步进而非流畅播放。后续可加原生 play/pause 支持。
- **状态**：✅ 已落地，typecheck + build 通过。

### D18. 素材删除 + 时间轴点击修正（2026-06-17）
- **素材删除**：后端 `DELETE /assets/:id`（删本机文件 + 删 DB 记录，文件删除失败不阻断），前端缩略图 hover 出现删除按钮（X），`useDeleteAsset` 删后失效素材缓存。端到端验证通过（上传→204→GET 404）。
- **修复点击片段误移播放头**：时间轴轨道容器的 `onClick=handleSeek` 会因事件冒泡在点击片段时触发 seek，导致无法选中片段做操作。ClipBlock 加 `onClick={e => e.stopPropagation()}` 拦截冒泡，现在点片段只选中、不动播放头。
- **确认**：本地素材区无 mock 占位，空时显示"还没有素材，点上方导入"，用户自行导入。
- **状态**：✅ 已落地。

### D16. 前端编辑器数据架构（2026-06-17）
- **决策**：
  - 服务端状态走 **TanStack Query**（`features/editor/hooks.ts`：useProject/useUpdateProject/useAssets/useUploadAsset），统一 fetch 封装在 `lib/api.ts`（走 `/api` 前缀，vite 代理到 :3888
  - 剪辑状态（timeline）放 **Zustand store**（`features/editor/store.ts`）：编辑时改 store，**1.5s 防抖自动保存** PATCH 到后端。selectedClipId 等 UI 态也在 store（不持久化）。
  - 时间轴渲染由 store.timeline 驱动；片段位置用帧↔px 换算（`timeline.ts` 的 framesToPx/pxToFrames，依 project fps）。
  - 添加素材：点左侧素材 → store.addAsset → 按 kind 落 video/audio 轨（无则新建），追加到轨末尾，时长取 asset.durationInFrames（图片默认 3s）。
- **状态**：✅ 已落地，端到端验证通过（创建→上传→加片段→GET 持久化）。

### D19. 时间轴交互升级：拖拽/分割/复制/碰撞（2026-06-17）
- **播放头可拖拽**：刻度条 + 三角手柄绑定 pointer 事件 scrub（`setPointerCapture`），由 `frameFromClientX` 推算帧。原点击 seek 保留。
- **分割（Scissors）**：`store.splitClip(clipId, atFrame)`，在播放头帧处把选中片段切两段（右段 `trimStart += 左段时长`），分割点须严格落在片段内部，否则 no-op。
- **复制（Copy）**：`store.duplicateClip(clipId)`，克隆到同轨右侧最近空闲位（走碰撞吸附），选中新片段。
- **碰撞限制**（`collision.ts`）：同轨片段不可重叠。
  - 移动：`resolveMove` 算轨道空闲区间，吸附到能容纳的最近空隙——拖到别的素材身上会自动贴到最近空隙边缘。
  - trim 右边缘：不越过右邻居起点、不超源时长。trim 左边缘：不越过左邻居终点、trimStart≥0、保留最小 15 帧。
- **左侧未实现 tab**：音频/文本/贴纸/特效点击切换显示"敬请期待 + 功能开发中"，仅"媒体"tab 有导入+素材库。
- **状态**：✅ 已落地，typecheck + build 通过（纯前端交互，需浏览器实测）。

### D20. 轨道缩放 + 撤销重做 + 播放卡顿修复（2026-06-18）
- **轨道缩放**：`PX_PER_SECOND` 从常量改为可变 `pxPerSecond`（Timeline 本地 state，6~120 px/s，1.5× 步进）；`framesToPx/pxToFrames` 加 `pxPerSecond` 参数；工具栏 ZoomOut/ZoomIn 接上，显示百分比。碰撞逻辑在帧域不受缩放影响。
- **撤销/重做**：store 加 `past/future` 历史栈（上限 50）。
  - 离散操作（addAsset/removeClip/splitClip/duplicateClip）内部 `pushPast` 入历史。
  - 拖拽/trim 的高频 `updateClip` **不入历史**；ClipBlock 在 pointerDown 抓 pre-drag 快照，pointerUp 时**仅当真正移动过**才 `commitHistory(snapshot)`，整段拖拽算一步。
  - `setTimeline`（加载项目）重置历史。撤销/重做清空 selectedClipId。
  - 入口：顶栏 Undo/Redo 按钮（带禁用态）+ 快捷键 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y。
- **播放卡顿修复**：根因＝旧 PreviewCanvas 纯 scrubbing，播放时每帧 `setCurrentTime` 强制 video 不停 seek。改为：播放中用浏览器**原生 `video.play()`**（流畅解码），仅当与时间轴时钟漂移 >0.3s 才纠偏；暂停/拖动时才精确 `currentTime` scrub。
- **状态**：✅ 已落地，typecheck + build 通过（纯前端，需浏览器实测）。

### D21. 多轨道 + 轨道显隐/静音 + 预览变换框（2026-06-18）
- **多轨道**：`Track` 加 `hidden` 字段（区别于 `muted`）。store 加 `addTrack(kind)`/`removeTrack`/`toggleTrackHidden`/`toggleTrackMuted`。工具栏「+视频轨/+音频轨」按钮；视频轨叠上层（数组末尾＝上层）、音频轨置底。
- **轨道头**：Timeline 每轨 sticky 左侧头部（`position:sticky; left:0`，横滚不消失，不动 frameFromClientX 几何）。
  - **视频轨眼睛 = hidden（可看/不可看）**：预览 `findActiveItem` 跳过 hidden 视频轨 → 隐藏顶层即可看下层（分层调试）。
  - **音频轨喇叭 = muted（可听/不可听）**：语义区别于视频显隐。
  - 显隐/静音都是查看态，**不入历史**。删轨按钮（X）。
- **预览变换框**（第二步）：`TransformBox` 组件——选中当前活动片段时在预览叠加交互框；拖动改 `transform.x/y`（项目像素），四角**等比缩放**改 `transform.scale`（中心锚点）。store 加 `updateClipTransform`（不入历史，拖拽结束 commitHistory）。预览 video/img 按 `translate(x,y) scale(s)` 渲染，transformOrigin=center。坐标用 `contentScale = min(stageW/projW, stageH/projH)` 在项目像素↔显示空间映射。
- **已知限制**：
  - 音频轨 muted 目前**仅数据/UI 生效**——预览只播放顶层视频自带音轨，独立音频轨播放未实现（待后续音频功能或导出合成）。
  - 性能：显隐+顶层优先方案**永远只解码一路视频**，规避多路解码卡顿。
- **状态**：✅ 已落地，typecheck + build 通过（纯前端交互，需浏览器实测）。

### D22. 时间轴两栏布局 + 轨道排序 + 片段静音 + 音频混音（2026-06-18）
- **两栏布局重构**（解决「显隐不占时间轨道」+「时间轴固定不被滚走」）：Timeline 改为单个双向滚动容器，左列轨道控制区(80px)用 `sticky left-0`、刻度尺行用 `sticky top-0` 固定。左列只放：拖拽手柄 + 眼睛(视频 hidden)/喇叭(音频 muted)，垂直居中；去掉删除按钮。
- **轨道拖拽排序**：store 加 `moveTrack(from,to)`（入历史）；左列 GripVertical 手柄 pointer 拖拽，松手用 `elementFromPoint` + `data-track-idx` 命中目标行重排。
- **片段静音**：复用 `transform.volume===0` 表示单片段静音（schema 不动）。store 加 `toggleClipMuted`；工具栏加片段静音按钮；片段块显示 🔇 角标。整轨静音仍走 `track.muted`。
- **预览音频混音**（性能确认：音频解码极轻，几十路并发不卡，区别于多路视频）：新增 `AudioMixer` 组件，为每个音频片段挂隐藏 `<audio>`，按播放时钟同步 currentTime，遵守 轨muted||片段volume0。顶层视频自带音轨的 `video.muted` 也按 轨muted||片段volume0 设置。
- **状态**：✅ 已落地，typecheck + build 通过（纯前端交互，需浏览器实测）。

### D23. 空轨自动消失 + 拖拽分层创建多轨（2026-06-18）
- **空轨自动消失**：store 加 `pruneEmptyTracks`，addAsset 后统一清理；removeClip 本就清理。无片段的轨道立即移除。
- **去掉手动加轨按钮**：与「空轨消失」冲突（建出来立刻消失），移除 `addTrack`/`removeTrack` 及工具栏 +视频轨/+音频轨 按钮。
- **拖拽分层创建多轨**（替代手动加轨）：
  - LeftPanel 素材项 `draggable`，dataTransfer 带 `application/x-reel-asset = assetId`。
  - `addAsset(asset, target?)`：target 可为 `{trackId, atFrame}`（放到指定轨该帧，碰撞吸附）或 `{newTrackAt, atFrameForNew}`（新建一轨放入）；无 target＝点击添加（追加同类型轨末尾）。
  - Timeline：轨道泳道 onDrop→放到该轨落点；底部「拖到这里新建轨道」放置区 onDrop→新建一轨（拖拽时高亮）。点击素材仍可快速添加。
- **轨道控制列与泳道间距**：左列 `width: LEFT_W-8 + mr-2`，泳道仍从 LEFT_W 起（与刻度尺/播放头对齐），视觉上有 8px 间距。
- **状态**：✅ 已落地，typecheck + build 通过。

### D24. 多轨视频叠加合成 + 音频导入打磨（2026-06-18）
- **背景**：D21 当初为防卡只在预览渲染「最顶层一个视频」。本期要做多轨叠加（画中画），改为同时渲染/解码多层。
- **多轨叠加**（核心）：
  - PreviewCanvas 的 `findActiveItem`(单个) → `findActiveLayers`(数组，底→顶；数组开头=底层、末尾=顶层，正序遍历即底→顶)。
  - 新增 `VideoLayer` 组件：单层自管 `<video>`，按时间轴时钟同步 currentTime（漂移>0.3s 才纠偏，与原单层逻辑一致），各自 muted（轨muted||片段volume0）。
  - 预览按图层 `zIndex: i` 叠放每个命中片段（视频/图片），各自走自己的 `transform`（缩放/位移）。
  - TransformBox 改为跟随「选中片段若在可见层里」(`selectedLayer`)。
  - 性能：典型叠加 2~3 层（背景+画中画+贴图）可接受；多路视频解码成本回归，后续如需可加层数上限/提示。
- **音频导入**：基建本就齐（上传 accept audio/*、ffprobe 探测、AudioMixer 混音、落音频轨）。本期补打磨：LeftPanel 音频缩略图显示时长(mm:ss)、视频缩略图加时长角标；时长按探测参考 fps=30 折算。
- **顺带修**：拖到底部新建轨道改为插入数组开头(`newTrackAt:0`)＝最底层，不再默认盖住现有内容。
- **状态**：✅ 已落地，typecheck + build 通过（需浏览器实测多层叠加播放/性能）。

### D25. 属性面板三 tab 实功能：画面/音频/变速（2026-06-18）
- 原 PropertiesPanel 是静态 mock。改为读取选中片段、实连 store。未选中时提示「选中片段以编辑」。
- **画面 tab**：缩放(scale 0.1~3)、不透明度(opacity 0~1)、旋转(rotation -180~180)，滑块实时写 `updateClipTransform`(不入历史)。预览 `layerTransform` 加 rotate、每层应用 opacity。音频片段画面 tab 提示无画面属性。
- **音频 tab**：音量(volume 0~1) + 静音按钮。VideoLayer/AudioMixer 都按 volume 设元素音量。
- **变速 tab**：speed 0.25~4x（滑块 + 0.5/1/1.5/2 快捷按钮）。新增 schema 字段 `ClipTransform.speed`(默认1)。
  - store `setClipSpeed`：源帧数固定=`当前duration×当前speed`，新占用=`源/新speed`，**联动重算时间轴长度**(变慢变长/变快变短)，并 clamp 不越过同轨下一片段(碰撞)、不小于 MIN_FRAMES。
  - 预览 VideoLayer/AudioMixer：`playbackRate=speed`，源时间映射 = `(timeline帧偏移×speed + trimStart)/fps`。
- 属性 tab 状态放 store(`propTab`)。滑块拇指样式 `.reel-slider`(accent)。
- **状态**：✅ 已落地，typecheck + build 通过。
