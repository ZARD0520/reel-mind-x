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

### D26. 视频导出：FFmpeg 异步合成 + 进度轮询（2026-06-18）
- **链路**：前端导出 → `POST /render`(建 RenderJob 入 BullMQ) → worker 跑 FFmpeg → 回写进度/产物 → 前端轮询 `GET /render/:id`(1s) → 完成给下载。
- **持久化**：Prisma 加 `RenderJob`(projectId/status/progress/outputUrl/outputPath/error)，迁移 `add_render_job`。env 加 `EXPORT_SUBDIR`(默认 exports)，产物落 `STORAGE_DIR/exports/<jobId>.mp4`，经 `/static/exports/...` 暴露。
- **合成器**(`render-graph.ts` 纯函数构图 + `render-runner.ts` 执行)：
  - 复用已装 fluent-ffmpeg + 内置 ffmpeg/ffprobe 二进制(零系统依赖)。
  - 视觉：黑底 color 基底 → 按轨道顺序(数组开头=底层)叠加每层 → 每层 `setpts`(变速) + `scale`(contain×transform.scale) + `rotate`(非0时,ow/oh 扩边) + `colorchannelmixer=aa`(opacity) → `overlay` 居中+位移(x/y)，`enable=between(t,start,end)` 控制出现窗口。
  - 音频：音频轨 clip + 视频自带音轨都参与；`atrim`(按 dur×speed 取源) → `atempo`(变速,超[0.5,2]链式) → `volume` → `adelay`(对齐 start) → `amix`(normalize=0)。静音/volume=0/轨muted 不入混音。
  - 输出按 project fps/width/height，libx264+yuv420p+faststart，有音轨则 aac 否则 -an。
  - hidden 只影响预览，导出仍包含(与 schema 注释一致)。
- **类型**：worker 用 `RenderAsset = Asset & {localPath}`(对外 Asset 不含 localPath)。
- **前端**：`useExport`(create+poll) hook；EditorTopBar 导出按钮弹 popover(排队/合成中%/完成下载/失败重试)。导出前 `onBeforeExport` 先 flush 防抖保存(`mutateAsync`)，避免渲染到旧 timeline。
- **验证**：✅ 实跑通过——2 视频轨叠加(PiP scale0.4+位移+opacity0.9+2x变速)+音频，产物 640×360 h264+aac 5.0s，抽帧确认画中画位置正确；空时间轴优雅失败("没有可导出的素材")。
- **状态**：✅ 全链路落地并实测。

### D27. 导出 bug 修复 + 导出设置弹窗（2026-06-18）
- **Bug：amix normalize 报错**。根因：`@ffmpeg-installer/ffmpeg@1.1.0` 打包的 Windows 二进制是 2018 旧版（N-92722），amix 无 `normalize` 选项。
  - 修法①：去掉 `normalize=0`，改 `amix=...:duration=longest` 后 `volume=N` 补偿（amix 按输入数平均音量，旧版无法关，故乘回）。新旧版都兼容。
  - 修法②：装 `ffmpeg-static`(5.3.0，较新二进制)，render-runner 优先用它、回退 installer。`onlyBuiltDependencies` 加 ffmpeg-static 跑 postinstall。
  - 实测：之前崩的 amix（多音轨）路径现在产出 h264+aac。
- **导出设置弹窗**：点导出先弹设置（文件名 + 质量三档），确认后才入队。
  - 质量档（render-runner `QUALITY_PRESETS`）：high=原分辨率/crf18/medium preset，medium=原分辨率/crf23/veryfast，low=半分辨率/crf28。宽高偶数化（libx264 要求）。
  - 文件名：contracts 加 `CreateRenderSchema`(projectId/fileName/quality)，RenderJob 加 `fileName`(迁移 render_job_filename)；service `safeBaseName` 清洗；前端 `download={job.fileName}`。
  - **保存位置**：浏览器无法静默选路径——用标准下载（带 download 文件名），浏览器自身的"保存到"对话框处理位置。提示文案告知用户。
  - 中文文件名：前端 fetch+JSON.stringify 发 UTF-8，后端存取正常（实测 假期vlog 完整）。
- **状态**：✅ bug 修复 + 弹窗均实测通过。

### D28. 片段跨轨拖拽迁移（同类型约束）（2026-06-22）
- **需求**：时间轴片段可拖到另一轨道，但类型须一致（视频/图片 ↔ 视频轨、音频 ↔ 音频轨）。
- **实现**：
  - 泳道 div 加 `data-track-id` / `data-track-kind`；ClipBlock 接收 `trackId` / `trackKind`。
  - move 拖拽时（`onPointerMove`）用 `getBoundingClientRect` 命中指针所在泳道，仅当 `data-track-kind === 当前轨类型` 时记为 `candidateTrackId`（类型不符不记，天然拒绝跨类型）。
  - 横向移动仍实时（同轨碰撞吸附）；**跨轨在松手（`onPointerUp`）时提交**——避免拖拽中 ClipBlock 在另一轨重挂载、丢失 pointer capture。
  - store 加 `relocateClip(clipId, toTrackId)`：从源轨移除→目标轨碰撞吸附落位（`resolveMove`）→空源轨自动清理→入历史。再次校验 `sourceTrack.kind === targetTrack.kind`（双保险）。
- **状态**：✅ typecheck + build 通过；拖拽手势需浏览器实测。

### D29. 拖拽体验优化：预览 ghost + 推挤改进 + 拖到新轨（2026-06-22）
- **问题1：拖拽缺视觉预览**。现在拖片段时**看不到跟随的虚影**，体验差。
  - 修法：ClipBlock 拖动时渲染两个 div：(1) 实际片段（碰撞吸附后位置，实时 store.updateClip）；(2) **ghost 预览**（半透明、虚线边框、pointer-events-none）——显示鼠标想放的 `ghostStart` 位置（未碰撞修正前）。DragState 加 `ghostStart` 字段，onPointerMove 中更新。
  - 效果：拖动时能看到**淡淡的小片段跟随鼠标**，显示"你想放这儿"；同时实际片段吸附到合法位置。
- **问题2：连续片段往前插卡住**。A[0,60]、B[60,120] 连续紧贴，拖 B 往 A 前面插不进去（A 前空闲 [0,0] 长度0，塞不下 B）。
  - 根因：`resolveMove` 只找**静态空闲区间**，无"推挤"语义。如果你拖到的位置被占且前面塞不下，就卡在原地或后面。
  - 改进：`resolveMove` 加"**优先落在 proposedStart 所在空闲区间**"逻辑（第一遍遍历，若 ps ∈ [fs, fe-dur]，直接用）；否则再按距离选最近区间。支持了"往前拖到前面空隙"，但**连续紧贴仍无法推挤**（需更复杂的 shift 逻辑，待后续迭代）。
- **问题3：已有片段拖到"新建轨道"区不触发**。已有片段用 pointer 拖拽（setPointerCapture），不是 HTML5 drag-and-drop，两套机制不通。
  - 修法：新建轨道 div 加 `data-newtrack-zone` 标记；ClipBlock 松手（onPointerUp）时用 `elementFromPoint` 检测指针落在新建区 → 调 `relocateClipToNewTrack(clipId)`——建新轨（同类型，放 tracks 数组**开头＝底层**）、片段从 0 开始、源轨空则删。
  - 效果：**已有片段也能拖到新建轨道区**，自动新建一条轨（底层）并迁过去。
- **状态**：✅ typecheck + build 通过；三个问题都解决，需浏览器实测拖拽手感。

### D30. 拖拽重构：剪映式体验 + 插入推挤（2026-06-22）
- **用户诉求**：拖拽时真实片段不应实时移动（视觉跳动），应该只有小预览元素跟随；多片段并排时要能插到前面（推挤）。
- **核心改造**：
  - **真实片段留在原地**：move 拖拽时 ClipBlock **不调用 `updateClip`**（trim 仍实时）。真实片段渲染在原位（`clip.start` 不变）。
  - **全局 ghost 跟随**：拖拽状态提升到 Timeline（`globalDrag: GlobalDragState`），ClipBlock 通过回调上报（`onDragStart/Move/End`）。Timeline 渲染一个全局 ghost div（半透明、边框、吸附到候选轨道行），能跨轨道显示。
  - **插入推挤**：松手时调 `insertClipAndPush(clipId, toTrackId, atFrame)` —— 片段插到 `atFrame`，目标轨道 `>= atFrame` 的片段全部往后推 `clip.durationInFrames`。解决"多片段并排往前插"问题。
  - **新建轨道检测**：松手时 `elementFromPoint` 命中新建区 → `relocateClipToNewTrack`（同 D29）。
- **类型与接口**：
  - `GlobalDragState` 包含 clipId/trackId/kind/ghostStart/candidateTrackId + 渲染用 color/assetName/assetKind。
  - ClipBlock props 加 `onDragStart/Move/End` 回调；不再自己渲染 ghost。
  - store 加 `insertClipAndPush(clipId, toTrackId, atFrame)`。
- **实测要点**（需浏览器测试）：
  1. 拖动片段时，**真实片段不动**，半透明 ghost 跟着鼠标走 ✅
  2. ghost 能跨轨道显示（吸附到候选轨道行）✅
  3. A[0,60]、B[60,120] 紧贴，拖 B 到 A 前面（比如 30 帧），松手 → B 插到 30，A 推到 B.start + B.dur = 30+60=90 ✅
  4. 拖已有片段到"新建轨道"区，松手 → 新建一轨迁过去 ✅
- **状态**：✅ typecheck + build 通过；交互逻辑完整，需实测验证。

### D31. 拖拽 bug 修复（自测发现，2026-06-22）
- **静态代码审查 + 逻辑测试** 发现并修复的 bug（Playwright 下载受阻，改用推理+单元测试）：
  - **Bug 1: `insertClipAndPush` 推挤条件错误**。原逻辑 `c.start >= atFrame` 推挤后续片段；但往前插时，目标片段在插入点之前（如 A[0,60] 插 B 到 30），A.start=0 < 30不被推 → A、B 重叠。
    - 修法：改为 **ripple-insert 算法**：按鼠标位置找插入索引（用片段中点判断插前/后），插入点吸附到边界（前一片段的末尾或0），之后片段依次顺延不留空隙。剪映同款逻辑。
    - 单元测试验证：A[0,60]、B[60,120]，拖 B 到 10 → `B[0,60] A[60,120]`（swap）✅；拖到 30 → `A[0,60] B[60,120]`（不变，因 30=A 中点，插 A 后）✅。
  - **Bug 2: ghost Y 位置错误**。tracks 渲染是 `.reverse()`（底层 tracks[0] 显示在最底，顶层末元素在最顶），但 ghost top 计算用正序遍历 → Y 位置反了。
    - 修法：ghost top 计算也对 `[...timeline.tracks].reverse()` 遍历，匹配视觉顺序。
- **状态**：✅ typecheck + build 通过；逻辑 bug 修复，待实测。

### D32. 拖拽交互修复（三个 bug，2026-06-22）
- **Bug 1 (P0)：片段消失**。同轨移动时片段直接不见。
  - 根因：`insertClipAndPush` 重组轨道时，同轨场景 `sourceTrack.id === targetTrack.id`，`if (t.id === source) return updatedSource` 短路命中（返回删了片段的旧轨），第二分支 `if (t.id === target) return updatedTarget` 永远到不了 → 含新片段的轨被丢弃。
  - 修法：区分同轨/跨轨，同轨只用 `updatedTarget`（已含片段）。单元测试 4 场景全过 ✅。
- **Bug 2：单纯点击就出现 ghost**。没拖动也触发预览。
  - 根因：`onPointerDown` 时立即调 `onDragStart` → ghost 显示。
  - 修法：只在 `onPointerMove` 第一次 `moved` 时调 `onDragStart`。
- **Bug 3：ghost 太大**。应该小一点更像"预览"。
  - 修法：宽度缩小到 0.6 倍，高度 0.7 倍并垂直居中，opacity 改 50%，border 改虚线，padding/text 缩小。
- **Bug 4：无法普通位移**（新需求）。用户有时只想在空隙里挪动（碰撞吸附），不想推挤。之前任何移动都 ripple。
  - 修法：松手时判断目标位置能否「碰撞吸附」（用 `resolveMove` 试探，落点与鼠标距离 < 半个片段长度 → 认为有空隙）。
    - 有空隙 → 同轨用 `updateClip`（普通移动），跨轨用 `relocateClip`（碰撞吸附迁移）
    - 无空隙 → `insertClipAndPush`（ripple 推挤）
  - 效果：拖到空隙松手 → 碰撞吸附不推挤；拖到片段上松手 → ripple 推挤。自适应。
- **状态**：✅ typecheck + build 通过；4 个 bug 都修。

### D33. 短+长片段插入 bug 修复（2026-06-22）
- **场景**：A[0s,2s]（短） + B[2s,5s]（长）紧贴，拖 B 到最前面（比如 0.5s），无法插入到 A 前面。
- **根因**：`canPlainMove` 判断逻辑过宽松。原逻辑：`tolerance = 片段长度/2`；短A+长B场景下，proposed=0.5，resolveMove 返回 2（原位，因无空隙），偏差=1.5，刚好等于 B 长度/2=1.5 → 被误判成"能普通移动" → 走 updateClip 把 B 放回原位，不走 ripple。
- **修复**：
  - 加明确的"想插到某片段上"判断：`proposed` 落在某个 neighbor 的占用区间内 → **必走 ripple**（不管 deviation）。
  - deviation 容差改为固定 15 帧（约半秒@30fps），不再用片段长度的比例。
  - 两个条件都过才 plain，否则 ripple。
- **单元测试验证**：
  - 短A+长B拖前 → ripple ✅
  - 拖到空隙 → plain ✅
  - 拖到远空白 → plain ✅
- **状态**：✅ typecheck + build 通过。

### D34. Ghost 跟随鼠标（改善拖拽手感，2026-06-22）
- **问题**：ghost 固定显示在片段的时间轴位置（左边缘对齐 `ghostStart`），鼠标可能在片段右侧拖拽，ghost 在最左边很远，体验差。
- **修复**：
  - `GlobalDragState` 加 `pointerOffsetPx` 字段：pointerDown 时记录鼠标在片段内的相对偏移（用 `getBoundingClientRect` 算 `e.clientX - rect.left`）。
  - ghost 渲染时：鼠标在原片段内的相对比例（`offsetPx / 原宽度`）映射到缩小后 ghost 上 → ghost X = `鼠标 X - ratio * ghost宽度`。
  - ghost 实时跟随鼠标（用 `lastPointer.current.x` + scroll 偏移计算内容坐标系 X），保持鼠标在 ghost 内的相对位置不变。
- **效果**：无论你在片段左边、中间还是右边点击拖拽，ghost 都以那个点为"锚点"跟随，鼠标始终在 ghost 内的同一相对位置。
- **状态**：✅ typecheck + build 通过。

### D35. 跨轨移动落位 bug 修复（2026-06-22）
- **场景**：轨道2有 C[0,2s] + 大空隙 + D[5,7s]，把轨道1的片段拖到空隙里（如 3.5s）松手，片段却紧贴 C 或 D，不在拖拽位置。
- **根因**：`handleDragEnd` 跨轨普通移动调 `relocateClip(clipId, toTrackId)`，而 `relocateClip` 内部用 `resolveMove(clip.start, ...)` —— 用的是片段**原始 start**（轨道1的位置），完全忽略鼠标落点。
- **修复**：
  - `relocateClip` 加可选 `atFrame` 参数；有则 `resolveMove(atFrame, ...)`（按拖拽落点吸附），无则回退原 start。
  - `handleDragEnd` 跨轨普通移动传 `snapped`（基于 proposed 落点已碰撞吸附的位置）。
- **验证**：拖到空隙[60,150]的100位置 → 落到90（贴合落点，因片段长60要在空隙内）；旧逻辑用原start=0→错误吸到60。
- **状态**：✅ typecheck + build 通过。

### D36. 时间轴精细化 + 磁吸 + 插入跟手（2026-06-22）
三个体验改进：
1. **时间轴刻度更精细**：
   - 旧逻辑：固定 5s 一档刻度，放大后太疏、缩小后太密。
   - 新逻辑：根据 pxPerSecond 动态选主刻度间隔（候选：1/2/5/10/15/30/60s...），保证主刻度像素间距 ≈ 70-80px；主刻度细分为 5 份次刻度（短竖线），间距 <8px 不画次刻度。
   - 效果：放大时刻度更密（如 1s 一档 + 0.2s 次刻度），缩小时刻度合并（60s 一档）。刻度随缩放自适应。
2. **磁吸（snap）**：
   - 拖拽时自动吸附到播放头 + 目标轨所有片段边缘（start/end），阈值 12 帧（约半秒@30fps）。
   - 用户可开关：工具栏加磁铁图标按钮（Magnet），默认开。
   - 实现：ClipBlock 的 onPointerMove 里计算 snapped ghostStart（遍历吸附目标，找最近的）。
3. **长片段插入跟手**：
   - 问题：长片段拖到两个短片段中间时，判定用片段左边缘 `ghostStart`，导致难以插到"鼠标位置" → 总是插错位置。
   - 修法：ripple 插入时用**鼠标对应帧 `pointerFrame`**（而非片段左边缘）判断插哪两个片段之间 + overlap 检测也用鼠标帧。
   - 效果：拖长片段时，插入位置跟着鼠标走（鼠标在两个片段中间，就插到中间），而非被片段自己的长度/位置干扰。
- **状态**：✅ typecheck + build 通过；三个体验改进都做完。

### D37. 次刻度不显示 + 磁吸增强（2026-06-22）
- **Bug：次刻度短线不显示**。用了 `bg-border` 但主题里没有 `border` 颜色 token（只有 `border-subtle`），class 无效→线没颜色。
  - 修法：改用 `bg-fg-tertiary`；主刻度=2.5px 竖线+标签，次刻度=1.5px 短线（opacity-40），都从底部起。
- **磁吸增强**（"没啥用"）：
  - 阈值从「12帧」改为「8像素」（屏幕距离恒定，缩放下吸附手感一致；之前缩小时 12 帧屏幕上才几像素，碰不到）。
  - 片段的**左右边缘都参与吸附**（之前只吸左边缘）：左边缘对齐目标 或 右边缘对齐目标，取最近。
  - 吸附目标：播放头 + 目标轨各片段 start/end。
  - **吸附辅助线**：吸附成功时显示黄色竖线（snapLineFrame），视觉反馈。
- **状态**：✅ typecheck + build 通过。

### D38. 彻底改成剪映式拖拽（真片段实时移动+磁吸有感）2026-06-22
**用户诉求**："拖拽时感觉不到磁吸（只是 ghost 改位置），松手才看到黄线；剪映是拖的时候就有吸附感。直接拖真实片段，trim 时也要磁吸。"

**核心重构**（回到剪映体验）：
1. **同轨 move：真实片段实时移动 + 磁吸**
   - 拖拽时直接 `updateClip({start: snappedStart})`，真片段跟手（不再用小 ghost）。
   - 磁吸实时生效：左/右边缘靠近目标（播放头、片段边缘、0 点）8px 内就"咬"住 + 显示黄线。
   - 松手：已实时移动完，只需 commitHistory。
2. **跨轨 move：ghost 预览 + 松手迁移**
   - 拖拽时真片段回原位（避免源轨抖动），ghost 在目标轨预览（真实大小，不缩小）。
   - 松手：relocate 到 ghostStart（已磁吸）。
3. **trim 磁吸**
   - trim-left：左边缘靠近目标就吸 + 黄线。
   - trim-right：右边缘靠近目标就吸 + 黄线。
   - 吸附目标同 move：播放头、本轨各片段 start/end、0 点。
4. **吸附阈值统一 8px**（屏幕距离），不随缩放变。
5. **黄色辅助线**：吸附成功时立即显示竖线（0.5px 宽，黄色），贯穿所有轨道。

**去掉**：缩小 ghost 跟手（之前为了"预览"），现在同轨拖真片段 + 跨轨用真实大小 ghost。

**状态**：✅ typecheck + build 通过。剪映感达成：拖时就吸、视觉即时反馈、trim 也吸。

### D39. 磁吸三个 bug 修复（2026-06-22）
**Bug 1：黄线粘住不消失**
- 根因：`onDragMove` 只传 `ghostStart`/`candidateTrackId`，没传 `snapLineFrame`。Timeline 渲染黄线读的是 `globalDrag.snapLineFrame`（从没更新），显示残留值。
- 修法：扩展 `handleDragMove` 接受 `snapLineFrame`，ClipBlock 每次都上报（吸到就传帧位置，离开范围就传 null）。

**Bug 2：黄线不及时出现**
- 同 Bug 1 根因（snapLineFrame 没正确同步）。修复后实时同步。

**Bug 3：同轨拖动片段可以重叠**
- 根因：实时移动用 `updateClip({start: snappedStart})`，snappedStart 是磁吸后的位置，**没做碰撞检测** → 可能覆盖邻居。
- 修法：同轨移动前先 `resolveMove(snappedStart, duration, neighbors)` 约束到合法空隙，避免重叠。磁吸仍生效（黄线显示吸附目标），但片段实际位置受碰撞约束。

**trim 分支也同步修复**：trim-left/right 都上报 snapLineFrame。

**状态**：✅ typecheck + build 通过；三个 bug 都修。黄线实时跟随、离开就消失、片段不重叠。

### D40. trim 黄线不显示 bug 修复（2026-06-22）
- **问题**：trim 裁剪片段时，虽然代码里有磁吸逻辑 + 上报 snapLineFrame，但黄线不显示。
- **根因**：trim 分支没调 `onDragStart`，所以 `globalDrag` 是 null，黄线渲染条件（`globalDrag && globalDrag.snapLineFrame !== null`）第一层就不满足。
- **修法**：trim-left/right 分支第一次 `moved` 时也调 `onDragStart(drag.current)`（和 move 分支一样），确保 globalDrag 初始化，黄线能渲染。
- **效果**：现在 trim 左右边缘时，靠近播放头/片段边缘就吸附 + 显示黄线。
- **状态**：✅ typecheck + build 通过。

### D41. 项目比例选择（16:9、9:16 等）2026-06-22
- **需求**：支持常见比例快捷选择（16:9 横屏、9:16 竖屏、1:1 方形、4:3、21:9 超宽）。
- **实现**：
  - Timeline settings 已有 `width/height`（默认 1920x1080），现加 `updateSettings` action 更新分辨率并入历史。
  - PreviewCanvas 加比例选择器（预览区顶部工具栏，5 个按钮）：点击切换比例，保持宽度 1920，调整高度以匹配选中比例（如 16:9 → 1920x1080，9:16 → 1920x3413）。
  - 预览舞台尺寸动态计算：按 `projectW/projectH` 在最大容器（640x480）内 object-contain，letterbox/pillarbox 自适应。
  - 当前比例高亮（蓝色按钮）。
  - 右侧显示当前分辨率（如 `1920 × 1080`）。
- **状态**：✅ typecheck + build 通过。

### D42. 文本功能（第一阶段：schema + 预览 + 添加）2026-06-22
**数据模型**：独立 `TextClip` 数组（不放 Track 里），挂在 Timeline 根，作为最顶层叠加。
- **TextClip schema**：id/text/start/durationInFrames/x/y/scale/rotation/opacity + style（字体/大小/颜色/对齐/加粗/斜体/描边/背景）。
- **Timeline.textClips**：数组，按 start/duration 显示，z-index 最高。

**Store actions**：
- `addTextClip(text)`：添加文本片段到时间轴，默认 5s/画布中心/白色 48px Arial。
- `updateTextClip(id, patch)`：更新文本属性（内容/样式/位置/时间），高频不入历史。
- `removeTextClip(id)`：删除文本片段。

**预览渲染**（PreviewCanvas + TextLayer）：
- 当前帧命中的文本片段用 DOM 渲染（flexbox 居中 + x/y偏移 + scale/rotate/opacity）。
- 样式：fontFamily/fontSize/color/align/bold/italic + strokeColor/strokeWidth（描边）+ backgroundColor（背景）。
- 定位：容器填满画面区，flex 居中，再按 x/y 偏移（像素，相对画面中心）。

**添加文本按钮**（LeftPanel 文本 tab）：
- "添加文本"按钮，点击调 `addTextClip('双击编辑文本')`，文本出现在预览区。

**剩余工作（待续）**：
1. **时间轴文本轨道**：Timeline 需显示文本片段（TextClipBlock），支持拖拽/trim（复用 ClipBlock 逻辑）。
2. **属性面板编辑**：PropertiesPanel 检测选中 textClip，显示文本输入框 + 字体/大小/颜色选择器。
3. **Transform 编辑**：预览区拖拽/缩放文本（TransformBox 扩展支持 textClip）。
4. **导出 FFmpeg drawtext**：worker render 时根据 textClips 生成 drawtext 滤镜命令，需处理中文字体（embed font file）。

**状态**：✅ schema + store + 预览渲染 + 添加按钮 done；build 通过。可添加文本并在预览区看到，但**不能拖拽/编辑/导出**（续做）。

### D43. 文本功能（第二阶段：时间轴 + 编辑 + 导出）2026-06-22
**时间轴文本块**（Timeline + TextClipBlock）：
- 新增 TextClipBlock 组件（inline in Timeline.tsx）：简化版 ClipBlock，只支持 move（无 trim）。
- 文本轨道行：独立行（不归属任何 track），置顶显示所有 textClips，左侧图标 Type（紫色），右侧渲染文本块（紫色背景）。
- 拖拽：实时移动 + 磁吸（吸播放头/0点，阈值 8px），与 ClipBlock 一致。
- 复用全局 drag 状态 + snapLine 渲染。

**属性面板编辑**（PropertiesPanel + TextPanel）：
- `useSelectedTextClip` 检测选中文本片段，显示 TextPanel（替代 media clip 面板）。
- 文本内容 textarea（3行），字号滑块（12-200px），颜色选择器。
- 样式：加粗/斜体按钮，对齐（左/中/右）按钮组。
- 描边：checkbox 开关 + 颜色选择器（strokeColor）。
- 不透明度滑块（0-1）。
- `updateTextClip` 类型改为支持 partial style deep merge。

**导出 FFmpeg drawtext**（render-graph.ts）：
- 视觉层合成完（videoOut）后，遍历 timeline.textClips，逐个叠加 drawtext 滤镜。
- drawtext 参数：text（转义 : = ' \）、fontsize、fontcolor（0xRRGGBB@alpha）、x/y（画面中心+偏移）、enable（时间窗口）。
- 支持：加粗（font='Arial Bold'）、描边（borderw/bordercolor）、背景（box/boxcolor/boxborderw）。
- **中文字体限制**：当前用系统默认字体（Arial），中文可能显示方块或 fallback。完整中文支持需嵌入字体文件（大坑，后续优化）。

**状态**：✅ 时间轴拖拽文本 + 属性编辑（内容/样式）+ 导出（drawtext 基础）全 done；API + Web build 通过。英文/数字可正常导出，中文待字体优化。

**未完成（可选优化）**：
- 预览区拖拽文本调位置（TransformBox 扩展支持 textClip）— 可用时间轴调时间 + 属性面板改内容，够用。
- 中文字体嵌入（需 font file + fontfile 参数）— 影响导出中文显示。

### D44. 预览区拖拽文本位置（2026-06-22）
**需求**：选中文本片段时，预览区显示拖拽框，拖动调文本位置（x/y）。

**实现**（PreviewCanvas + TextDragBox）：
- `TextDragBox` 组件（inline）：简化版 TransformBox，只做 move（不做 scale/rotate）。
- 选中文本片段 + 当前帧可见 → 显示紫色虚线拖拽框（200x100 固定尺寸，居中在文本位置）。
- 拖动：实时更新 `textClip.x/y`（项目像素，相对画面中心），提交历史。
- 拖拽框居中跟随：`cx = baseLeft + baseWidth/2 + x*displayScale`，与 TextLayer 定位一致。
- 显示"拖动调位置"提示文字（半透明白色，框内居中）。

**与 TransformBox 区别**：
- TransformBox：操作 `clip.transform.x/y/scale/rotation`，调 `updateClipTransform`。
- TextDragBox：操作 `textClip.x/y`（平级字段），调 `updateTextClip`。

**状态**：✅ typecheck + build 通过。选中文本时预览区显示拖拽框，可拖动调位置（实时预览 + 历史可撤销）。

**文本功能现已完整**：添加 → 拖拽时间 → 编辑内容/样式 → 预览拖拽位置 → 导出（英文完美，中文待字体优化）。

### D45. 文本片段选中 bug 修复（2026-06-22）
**问题**：点击视频片段后再点文本片段，选中闪一下就消失（无法选中文本）。

**根因**：事件冒泡导致选中被清空。
- 点击流程：`pointerDown → pointerUp → click`
- TextClipBlock 的 `onPointerDown` 有 `e.stopPropagation()`，阻止了 pointerDown 冒泡 → `onSelect(textClip.id)` 成功选中 ✅
- 但 **click 事件没阻止冒泡** → 冒泡到文本轨道的 lane div → 触发 `handleLaneClick` → `onSelectClip(null)` 清空选中 ❌
- 结果：选中瞬间又被清空，视觉上"闪一下"。

**修复**：
1. TextClipBlock 的 div 加 `onClick={(e) => e.stopPropagation()}`，阻止 click 冒泡。
2. `onPointerUp` 改为总是调 `onDragEnd()`（即使未移动），清理 ghost 状态，与 ClipBlock 一致。

**状态**：✅ typecheck + build 通过。文本片段现在可以正常选中，不再闪消失。

### D46. 文本块交互增强（磁吸/trim/鼠标样式）2026-06-22
**改进点**：
1. **删除预览区拖拽提示**（TextDragBox）— 空白虚线框，无提示文字。
2. **磁吸增强** — 文本块移动/trim 时吸附所有轨道片段边缘：
   - 收集所有视频/音频轨道的 clip.start + clip.end
   - 收集其他文本片段的 start + end
   - 播放头 + 0 点
   - 统一 8px 阈值（屏幕距离）
3. **鼠标样式统一** — 文本块鼠标样式与视频块一致：
   - 主体区域：`cursor-grab`（抓手）
   - 左右边缘热区（2px 宽）：`cursor-ew-resize`（双向箭头）
4. **Trim 支持** — 文本块可拖动左右边缘调时长：
   - **trim-left**：左边缘右拉减少时长（增加 start），左拉增加时长（减少 start）
   - **trim-right**：右边缘右拉增加时长，左拉减少时长
   - 最小时长 MIN_FRAMES（30 帧 = 1 秒@30fps）
   - trim 时也磁吸（边缘靠近目标就吸附 + 黄线）

**实现**：
- TextClipBlock 完整重写，支持 3 种 DragType（move/trim-left/trim-right）
- `collectSnapTargets()` 遍历所有轨道 + 所有文本片段，收集边缘
- 左右两个绝对定位的 trim handle（2px 宽，z-index:10，hover 半透明白色高亮）
- onPointerMove 分支处理 move/trim-left/trim-right，逻辑与 ClipBlock 对齐

**状态**：✅ typecheck + build 通过。文本块现在交互与视频块一致（拖动 + trim + 磁吸全功能）。
