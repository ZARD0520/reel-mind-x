# ReelMind X 项目教学文档

> 说明：本文档以项目内实际代码为分析依据，不以 README、docs 等说明文档作为结论来源。也就是说，如果代码实现和旧文档描述不一致，以代码为准。

这份文档按“先理解整体，再拆功能，再讲难点”的顺序写。目标不是只告诉你这个项目用了什么库，而是让你能看懂它为什么这样设计，并且以后能自己改、自己扩展。

## 1. 项目一句话

ReelMind X 是一个 AI 视频剪辑工具：

- 前端提供类似剪映的时间轴、多轨编辑、预览、素材库、文本层、属性面板、导出入口。
- 后端负责登录、项目/素材管理、AI 文案、AI 图片/视频生成、AI 混编、FFmpeg 导出。
- 数据库保存用户、项目、素材、渲染任务。
- Redis + BullMQ 承担耗时任务队列，例如视频导出和 AI 媒体生成。

最核心的一句话：项目把“剪辑工程”抽象成一份 `Timeline JSON`，前端编辑它，数据库保存它，后端导出也消费它。

## 2. 技术栈和目录

根目录是 pnpm workspace + Turborepo monorepo：

```text
apps/
  web/         React + Vite 前端剪辑器
  api/         NestJS 后端 API 与 Worker
packages/
  contracts/   前后端共享 Zod schema 与 TypeScript 类型
  db/          Prisma schema 与生成的 client
  llm/         LLM provider 抽象与 GLM 实现
  ai-gen/      AI 图片/视频 provider 抽象与智谱实现
```

常用入口：

- 前端路由：`apps/web/src/app/router.tsx`
- 前端请求封装：`apps/web/src/lib/api.ts`
- 编辑器页面：`apps/web/src/pages/EditorPage.tsx`
- 编辑器状态：`apps/web/src/features/editor/store.ts`
- 时间轴 UI：`apps/web/src/features/editor/components/Timeline.tsx`
- 预览区：`apps/web/src/features/editor/components/PreviewCanvas.tsx`
- 后端模块注册：`apps/api/src/app.module.ts`
- 数据库 schema：`packages/db/prisma/schema.prisma`
- 共享契约：`packages/contracts/src/index.ts`

## 3. 最重要的架构思想：共享契约

`packages/contracts/src/index.ts` 是前后端共同使用的类型层。项目没有让前端、后端各自手写一套 DTO，而是用 Zod 做单一事实来源：

```ts
export const TimelineSchema = z.object({
  settings: ProjectSettingsSchema,
  tracks: z.array(TrackSchema).default([]),
});
export type Timeline = z.infer<typeof TimelineSchema>;
```

这带来三个好处：

1. 前端拿到接口响应后，类型和后端一致。
2. 后端可以用 `nestjs-zod` 自动校验请求。
3. 数据库里的 `Project.timeline` 虽然是 JSON，但进出系统时会被 `TimelineSchema` 校验。

你以后扩展功能时，建议先从 contracts 改起。例如要加“滤镜”，应该先想清楚滤镜属于 `ClipTransform`、`Clip`，还是单独的 `EffectTrack`。

## 4. 数据库模型教学

Prisma schema 在 `packages/db/prisma/schema.prisma`。

### User

`User` 保存账号基础信息：

- `email` 唯一
- `passwordHash` 保存 PBKDF2 后的密码，不保存明文
- `status` 用于禁用账号

### Project

`Project` 是剪辑工程：

- `userId` 归属用户
- `name` 项目名
- `timeline Json` 保存完整剪辑状态
- `deletedAt` 做软删除

为什么 timeline 用 JSON？

视频剪辑工程本质是一个嵌套结构：settings -> tracks -> clips -> transforms。如果把每个 clip 都拆表，CRUD 会复杂很多，频繁自动保存也更难。当前项目选择把整个剪辑状态作为 JSON 保存，适合个人项目和 MVP。

代价是：数据库很难直接查询“某个 clip 在哪些项目里”，也不好做细粒度协作。以后做多人协作或大型工程，可以考虑 event sourcing 或 clip 表拆分。

### Asset

`Asset` 是素材库条目，不等于时间轴片段：

- 一个 Asset 是一个上传或 AI 生成的媒体文件。
- 一个 Clip 是这个素材在时间轴上的一次使用。
- 同一个 Asset 可以被多个 Clip 引用。

核心字段：

- `kind`: `video | image | audio`
- `source`: `upload | ai`
- `status`: `ready | generating | failed`
- `url`: 前端访问地址
- `localPath`: 后端导出时读取的真实路径
- `durationInFrames`, `width`, `height`: ffprobe 探测出的元信息

### RenderJob

`RenderJob` 记录导出任务：

- `status`: queued/rendering/completed/failed
- `progress`: 进度
- `outputUrl`: 完成后的下载地址
- `outputPath`: 服务端本地文件路径

这个表让“导出”从同步 HTTP 请求变成异步任务：前端发起任务，然后轮询状态。

## 5. 时间轴数据结构

项目的时间单位统一用“帧”，不是秒。

```ts
Clip {
  assetId: string
  start: number              // 起始帧
  durationInFrames: number   // 占用帧数
  trimStart: number          // 从素材源第几帧开始取
  transform: ClipTransform
  transitionOut: Transition | null
}
```

为什么用帧？

- 视频剪辑最终是逐帧导出，帧比秒更稳定。
- UI 拖拽可以把像素换算成帧。
- FFmpeg 导出时再用 `frame / fps` 转成秒。

你需要记住这个公式：

```text
秒 = 帧 / fps
像素 = 帧 / fps * pxPerSecond
帧 = 像素 / pxPerSecond * fps
```

前端 `timeline.ts` 负责帧和像素互转，`EditorPage.tsx` 用 `requestAnimationFrame` 推动播放头。

## 6. 前端整体流程

### 6.1 首页与登录

`HomePage.tsx` 做两件事：

- 未登录时显示登录/注册表单。
- 已登录时显示项目列表。

登录状态通过 `api.auth.me()` 判断。所有请求都设置：

```ts
credentials: 'include'
```

这表示浏览器会自动带上后端设置的 httpOnly cookie。

注册/登录成功后：

- 后端设置 session cookie。
- 前端把用户写入 TanStack Query 缓存。
- 项目列表重新请求。

项目数量限制在后端 `ProjectsService.maxActiveProjects = 3`，前端也做一层提示，但真正可信的是后端。

### 6.2 编辑器页面

`EditorPage.tsx` 是编辑器的组装层：

- 通过 `useProject(id)` 拉项目。
- 通过 `useAssets(id)` 拉素材。
- 项目加载后调用 `setTimeline(project.timeline)` 初始化 Zustand。
- timeline 变化后 1.5 秒防抖保存。
- 监听键盘快捷键：删除、撤销、重做。
- 控制播放头 `currentFrame` 和 `isPlaying`。

这里的职责分得很好：页面不直接写复杂剪辑逻辑，只负责把状态和组件串起来。

## 7. Zustand 编辑状态教学

核心文件：`apps/web/src/features/editor/store.ts`

状态包括：

- `timeline`: 当前剪辑工程
- `selectedClipId`: 当前选中的媒体或文本片段
- `past/future`: 撤销/重做历史
- `propTab`: 属性面板 tab

### 7.1 为什么用 Zustand

剪辑器有大量高频交互：

- 拖动 clip
- 裁剪左右边缘
- 拖动画布上的 transform 框
- 播放头实时刷新

如果所有状态都放 React 父组件里，props 会很深，渲染也容易乱。Zustand 让任意组件可以直接订阅需要的状态和 action。

### 7.2 历史栈设计

`pushPast(state)` 会把当前 timeline 放进 `past`，然后清空 `future`。

普通操作，例如添加、删除、分割，会立即入历史。

高频操作，例如拖动、缩放、trim，不会每一帧都入历史，而是：

1. pointerDown 时保存 snapshot。
2. pointerMove 时实时更新当前 timeline。
3. pointerUp 时调用 `commitHistory(snapshot)`。

这样 Ctrl+Z 一次就能撤销整个拖拽，而不是撤销拖拽中的每个像素。

### 7.3 添加素材

`addAsset(asset, target?)` 支持三种方式：

- 不传 target：点击添加，放到同类型轨道末尾。
- `{ trackId, atFrame }`：拖到已有轨道指定帧。
- `{ newTrackAt, atFrameForNew }`：拖到新轨道区域，创建新轨。

素材和轨道类型会隔离：

- audio 只能进 audio 轨。
- video/image 只能进 video 轨。

### 7.4 文本片段

文本不是普通 Asset。它作为 `TextClip` 放在 `Track.textClips` 里，因为文本不需要文件源，也不需要 assetId。

这是一种很常见的建模选择：

- 文件型素材：Asset + Clip
- 工程内生成的图层：直接存在 timeline 里

## 8. 碰撞、吸附、裁剪

核心文件：`apps/web/src/features/editor/collision.ts`

### 8.1 不重叠约束

同一轨道上的片段不能重叠。`resolveMove(proposedStart, duration, neighbors)` 做的事情是：

1. 把邻居片段转成已占用区间 `[start, end]`。
2. 从 0 开始找空闲区间。
3. 如果目标位置能放下，就放目标位置。
4. 如果目标位置会撞到别人，就找最近的合法空位。

这是一个很实用的算法：不要在拖拽 UI 里到处写碰撞判断，而是抽成纯函数。

### 8.2 左裁剪

左裁剪会同时改变三个值：

```text
start 变大/变小
trimStart 变大/变小
durationInFrames 反向变化
```

例如一个 clip 从第 100 帧开始，长度 90 帧，源素材从第 0 帧开始取。你把左边缘往右拖 30 帧：

```text
start = 130
trimStart = 30
durationInFrames = 60
```

意思是：时间轴上的片段晚出现 30 帧，同时源素材也跳过前 30 帧。

### 8.3 右裁剪

右裁剪只改 `durationInFrames`，但要受两个限制：

- 不能小于最小帧数 `MIN_FRAMES`
- 不能超过源素材剩余时长
- 不能撞到右边邻居

### 8.4 磁吸

Timeline 里拖拽时会收集吸附目标：

- 播放头位置
- 0 点
- 所有片段的 start/end

如果片段左边缘或右边缘距离目标点小于 8px 对应的帧数，就吸过去并显示辅助线。

这个实现很有教学意义：吸附阈值用像素更符合用户手感，但底层计算仍然转成帧。

## 9. Timeline UI

核心文件：`Timeline.tsx`

Timeline 做了很多剪辑器交互：

- 标尺刻度
- 播放头拖拽
- 缩放
- 轨道显隐/静音
- 轨道排序
- clip 移动
- clip 左右 trim
- clip 分割、复制、删除
- 跨轨移动
- 新建轨道落位
- ripple 插入推挤

### 9.1 像素到帧

鼠标位置转帧的关键函数是：

```ts
const x = clientX - rect.left + el.scrollLeft - LEFT_W;
return Math.max(0, pxToFrames(x, fps, pxPerSecond));
```

解释：

- `clientX - rect.left`: 鼠标在滚动容器内的可视 x。
- `+ el.scrollLeft`: 加上横向滚动偏移。
- `- LEFT_W`: 减掉左侧轨道控制列宽度。
- 最后把像素转成帧。

### 9.2 ghost 拖拽

跨轨移动时，真实片段会回到原位，界面显示一个 ghost 预览。松手后才真正迁移。

这样做的原因：

- 同轨拖动可以实时更新，手感直接。
- 跨轨拖动涉及从一个数组移到另一个数组，频繁更新更容易出状态问题。
- ghost 让用户看到落点，但状态提交更干净。

### 9.3 ripple 插入

当同轨拖动越过邻居中点时，项目会走 `insertClipAndPush`：

1. 按 start 排序同轨片段。
2. 找插入位置。
3. 被插入点之后的片段整体往后排。

这就是很多剪辑软件里的“插入并推挤”语义。

## 10. 预览区实现

核心文件：`PreviewCanvas.tsx`

预览区不是 canvas 绘制，而是用 HTML 元素叠层：

- 图片用 `<img>`
- 视频用 `VideoLayer`
- 文本用 `TextLayer`
- 音频用隐藏的 `<audio>`

### 10.1 图层顺序

`tracks` 数组顺序就是图层顺序：

```text
tracks[0] = 底层
tracks[tracks.length - 1] = 顶层
```

预览时正序遍历，后渲染的层盖在前面的层上。

### 10.2 当前帧命中

一个 clip 在当前帧可见，需要满足：

```text
currentFrame >= clip.start
currentFrame < clip.start + clip.durationInFrames
```

这是视频编辑器里最基础、最常用的判断。

### 10.3 项目尺寸映射

项目设置可能是 1920x1080、1080x1920、1:1 等。预览区会根据容器大小算出 object-contain 后的显示尺寸。

关键变量：

- `projectW/projectH`: 工程真实分辨率
- `stageW/stageH`: 预览区域可用尺寸
- `contentScale`: 工程像素到屏幕像素的缩放
- `displayScale`: transform.x/y 映射到屏幕的比例

所以 clip 的 `transform.x = 100` 表示在工程坐标系里偏移 100 像素，预览时要乘 `displayScale`。

### 10.4 视频同步

`VideoLayer` 会根据当前播放头计算视频元素的 `currentTime`：

```text
sourceTime = ((currentFrame - clip.start) * speed + trimStart) / fps
```

这句话非常重要：

- `currentFrame - clip.start`: 片段内已经播放了多少帧。
- `* speed`: 变速后源素材消耗速度。
- `+ trimStart`: 源素材起点偏移。
- `/ fps`: 转成秒给 video.currentTime。

### 10.5 音频混音

`AudioMixer.tsx` 为每个音频片段创建一个隐藏 `<audio>`，每帧同步：

- 当前帧在片段范围内才播放。
- 轨道静音或片段音量为 0 就暂停。
- 设置 `playbackRate` 支持变速。
- 计算 fadeIn/fadeOut 后的最终 volume。

浏览器自动播放策略会阻止未交互时播放音频，所以项目有 `useAudioUnlock` 做用户交互后的解锁。

### 10.6 前端如何用 Timeline 数据实现预览

如果面试官问“前端拿到 timeline 后，具体怎么预览”，你可以按这条链路讲：

```text
Project.timeline
  -> EditorPage 加载后 setTimeline 到 Zustand
  -> EditorPage 维护 currentFrame 播放头
  -> PreviewCanvas 从 Zustand 读取 timeline
  -> 根据 currentFrame 筛选当前命中的图层
  -> 用 img/video/text/audio DOM 元素渲染
  -> 每一帧根据 currentFrame 同步媒体 currentTime、transform、opacity、volume
```

代码对应关系：

- `EditorPage.tsx`: 拉取项目，把 `project.timeline` 放进 `useEditorStore`。
- `EditorPage.tsx`: 用 `requestAnimationFrame` 推进 `currentFrame`。
- `PreviewCanvas.tsx`: 读取 `timeline`、`selectedClipId`、素材列表。
- `findActiveLayers`: 从 timeline 里筛出当前帧应该显示的视频/图片层。
- `VideoLayer.tsx`: 根据 clip 数据同步 `<video>`。
- `TextLayer.tsx`: 根据 TextClip 数据渲染文字。
- `AudioMixer.tsx`: 根据 audio clips 同步隐藏 `<audio>`。

#### 10.6.1 第一步：加载 Timeline 到本地状态

项目数据来自后端：

```text
GET /api/projects/:id
  -> Project
  -> Project.timeline
```

`EditorPage` 在项目加载完成后执行：

```text
setTimeline(project.timeline)
```

之后预览区、时间轴、属性面板都不直接操作接口返回对象，而是读 Zustand 里的当前 timeline。

这样做的原因：

- timeline 会被频繁编辑。
- Zustand 能让多个组件共享最新状态。
- 自动保存可以防抖提交，不影响实时预览。

#### 10.6.2 第二步：播放头 currentFrame 驱动预览

预览不是靠视频自己决定全局时间，而是由编辑器维护统一播放头：

```text
currentFrame = 当前时间轴帧
```

播放时：

```text
requestAnimationFrame
  -> dt = 两帧之间经过的秒数
  -> currentFrame += dt * fps
```

暂停、拖动播放头、点击时间轴时，都会调用 `onSeek(frame)` 修改 currentFrame。

这点很关键：多视频、多音频、多文本必须共享同一个全局时钟，否则每个媒体元素自己播放会慢慢漂移。

#### 10.6.3 第三步：筛选当前帧应该显示哪些视觉层

`PreviewCanvas` 里有 `findActiveLayers`。

它做的事情是：

```text
遍历 timeline.tracks
  只处理 video track
  hidden track 跳过
  遍历 track.clips
    如果 currentFrame 落在 clip 时间范围内
    根据 clip.assetId 找到 Asset
    Asset ready 且有 url
    加入 layers
```

命中条件：

```text
frame >= clip.start
frame < clip.start + clip.durationInFrames
```

最后得到：

```ts
ActiveLayer[] = [
  { clip, asset, track },
  { clip, asset, track },
]
```

这个数组就是当前这一帧要显示的所有视频/图片层。

#### 10.6.4 第四步：按轨道顺序渲染 DOM 图层

预览区按 `layers.map` 渲染。

图片：

```text
<img src=asset.url style={transform, opacity, zIndex}>
```

视频：

```text
<VideoLayer clip asset transform ...>
```

文本：

```text
timeline.tracks
  -> filter text track
  -> flatMap textClips
  -> 根据 currentFrame 命中
  -> <TextLayer>
```

音频：

```text
<AudioMixer timeline assetById currentFrame isPlaying>
```

注意：画面层和音频层的筛选方式不完全一样。

- 视频/图片要在 PreviewCanvas 中变成可见 DOM。
- 音频不显示画面，但 AudioMixer 会为命中的音频片段控制 `<audio>` 播放。
- 文本是独立的 TextClip，不走 Asset。

#### 10.6.5 第五步：把工程坐标映射到屏幕坐标

Timeline 里的 `transform.x/y` 是工程坐标。

前端要先根据项目分辨率和预览容器算：

```text
displayScale = 预览画面宽度 / 项目真实宽度
```

然后：

```text
screenX = clip.transform.x * displayScale
screenY = clip.transform.y * displayScale
```

视频层最终 transform：

```text
translate(screenX, screenY)
scale(clip.transform.scale)
rotate(clip.transform.rotation)
```

文本层类似，只是用 TextClip 自己的 `x/y/scale/rotation/opacity/style`。

#### 10.6.6 第六步：同步 video.currentTime

`VideoLayer` 根据 timeline 数据计算当前应该播放源素材的哪一秒：

```text
targetTime = ((currentFrame - clip.start) * clip.transform.speed + clip.trimStart) / fps
```

如果正在播放：

- 设置 `video.playbackRate = speed`
- 如果 `video.currentTime` 和 `targetTime` 差距超过 0.3 秒，就 seek 纠偏
- 如果暂停则调用 `play()`

如果不播放：

- pause
- 直接设置 `currentTime = targetTime`

为什么播放时不每帧强制 seek？

因为频繁 seek 会让视频解码卡顿。浏览器自己播放更流畅，只在漂移明显时纠偏。

#### 10.6.7 第七步：同步音频

音频同步公式和视频一样：

```text
targetTime = ((currentFrame - clip.start) * speed + trimStart) / fps
```

但音频还会计算淡入淡出：

```text
finalVolume = clip.volume * fadeGain
```

如果轨道 muted 或 clip volume 为 0，就暂停或静音。

#### 10.6.8 第八步：处理转场预览

视觉层筛选时还会调用：

```text
previewTransitions(track.clips, fps)
```

如果当前帧落在转场区：

- from clip 按转场进度淡出/位移/裁切。
- to clip 提前加入 layers，按转场进度淡入/位移/裁切。

前端用 CSS 模拟：

- opacity
- transform
- clip-path

这保证用户在预览时能看到转场大致效果。

#### 10.6.9 前端预览的标准面试回答

可以这样回答：

```text
前端预览是用 Timeline JSON 直接驱动的。项目加载后把 Project.timeline 放进 Zustand，EditorPage 维护 currentFrame 作为统一播放头。PreviewCanvas 根据 currentFrame 遍历 timeline.tracks，筛出当前帧命中的 video/image clips，按 tracks 顺序渲染 img 或 VideoLayer；文本轨筛出命中的 TextClip 渲染 TextLayer；音频轨交给 AudioMixer 创建隐藏 audio。

每个视频层根据公式 ((currentFrame - clip.start) * speed + trimStart) / fps 计算源素材 currentTime，用 playbackRate 处理变速，用 transform.x/y/scale/rotation/opacity 映射到 CSS。x/y 存的是工程坐标，预览时乘 displayScale 映射到屏幕坐标。这样多轨、画中画、文本、音频、转场都由同一个 currentFrame 和同一份 timeline 驱动。
```

## 11. 属性面板

核心文件：`PropertiesPanel.tsx`

属性面板根据当前选中对象决定显示：

- 选中媒体 clip：显示画面、音频、变速、转场等属性。
- 选中文本 clip：显示文本内容、字号、颜色、对齐、描边、背景等。
- 未选中：显示空状态。

属性更新大多走 `updateClipTransform` 或 `updateTextClip`。这类滑块变化频繁，所以一般不立即入历史，真正交互结束时再提交历史会更合理。当前项目部分输入是直接改状态，后续可以继续优化成“开始编辑保存快照，结束编辑提交历史”。

## 12. 转场设计

前端转场在 `transitions.ts`，后端转场在 `render-graph.ts`。

### 12.1 数据模型

转场挂在前一个片段上：

```ts
transitionOut: {
  type: 'fade',
  duration: 0.5
}
```

语义是：从这个片段过渡到同轨紧邻的下一个片段。

为什么要求“紧邻”？

如果两个片段之间有空隙，转场应该怎么发生不清晰。项目用 `next.start === clip.start + clip.durationInFrames` 限制转场只发生在硬切边界。

### 12.2 前端预览

前端用 CSS 近似 FFmpeg xfade：

- fade/dissolve 用 opacity
- slide 用 transform
- wipe/circle 用 clip-path

前端预览不追求像素级完全一致，而是让用户知道转场大概是什么效果。

### 12.3 后端导出

后端使用 FFmpeg `xfade` 滤镜。实现上有一个重要设计：无位移模型。

也就是说，转场不改变时间轴总长度。转场区发生在 A 结尾前 D 秒，B 的首帧会提前冻结参与过渡，B 到达自己的 start 后再正常播放。

好处：

- 前端 timeline 不需要因为转场而压缩或移动片段。
- 用户看到的片段位置就是实际时间位置。
- 预览和导出的语义容易对齐。

## 13. 素材上传链路

链路：

```text
LeftPanel 选择文件
  -> useUploadAsset
  -> POST /api/assets?projectId=...
  -> Multer 保存到 storage/users/:userId/uploads
  -> ffprobe 探测元信息
  -> 必要时转码
  -> Asset 入库
  -> 前端刷新素材列表
```

后端关键文件：

- `assets.controller.ts`: 接收 multipart 文件
- `assets.service.ts`: 校验项目归属、探测、转码、入库
- `media-probe.ts`: 调 ffprobe
- `transcode.ts`: 判断是否需要转码并执行

这里有两个安全点：

1. 上传目录按 `userId` 隔离。
2. `assertProjectOwned(userId, projectId)` 防止把素材写进别人的项目。

## 14. 文件访问安全

文件接口在 `FilesController`：

```text
GET /files/users/:userId/:scope/:filename
```

它会检查：

- 当前登录用户必须等于 URL 里的 userId。
- scope 只能是 `uploads` 或 `exports`。
- filename 必须等于 `path.basename(filename)`，防止路径穿越。
- 文件必须真实存在。

这比直接把 storage 目录静态暴露出来安全。

## 15. 项目持久化

项目创建时：

- 如果没有传 timeline，就用 `TimelineSchema.parse({ settings: {} })` 创建默认空工程。

项目更新时：

- 前端传 `{ timeline }` 或 `{ name }`。
- 后端用 Zod DTO 校验。
- Prisma 把 timeline 整体写回 JSON 字段。

前端自动保存：

```text
timeline 变化
  -> 清理上一个 timer
  -> 1.5 秒后 PATCH /projects/:id
```

导出前会先执行 `onBeforeExport`，强制把最新 timeline 保存到后端，再入队渲染。这个细节很关键，否则用户刚拖完片段马上导出，worker 可能读到旧 timeline。

## 16. 导出系统

导出链路：

```text
EditorTopBar 点击导出
  -> POST /api/render
  -> RenderService 创建 RenderJob
  -> BullMQ 入队
  -> RenderProcessor 消费任务
  -> 读取 Project.timeline
  -> 查询 Asset localPath
  -> buildGraph 编译 FFmpeg filter graph
  -> renderTimeline 执行 FFmpeg
  -> 更新进度和 outputUrl
  -> 前端轮询 /api/render/:id
```

### 16.1 为什么用队列

视频导出可能耗时很久。如果直接在 HTTP 请求里等 FFmpeg 完成，会遇到：

- 请求超时
- 浏览器等待体验差
- 服务重启后状态不可追踪

队列化后，HTTP 只负责创建任务，worker 负责慢任务，前端通过轮询拿状态。

### 16.2 buildGraph 的职责

`render-graph.ts` 把 timeline 编译成 FFmpeg 需要的三类内容：

- `inputs`: 每个素材文件作为 FFmpeg 输入。
- `complexFilter`: 视频、音频、文字、转场的滤镜图。
- `maps`: 最终输出的视频流和音频流。

这可以理解为一个小型编译器：

```text
Timeline JSON -> 中间结构 VisualEntry/AudioEntry -> FFmpeg filter graph
```

### 16.3 视频合成

导出先创建黑色底图：

```text
color=c=black:s=WIDTHxHEIGHT:r=FPS:d=DURATION[base]
```

然后每个视频/图片片段：

1. trim 到需要的源时长。
2. setpts 归零。
3. 按 speed 调整 PTS。
4. scale 到工程画布。
5. rotation/opacity。
6. overlay 到黑底上的目标时间段。

图片会用 `-loop 1 -t duration` 变成一段视频流。

### 16.4 音频合成

每个音频片段：

1. `atrim` 截取源时长。
2. `atempo` 处理变速。由于 FFmpeg 单个 atempo 只适合 0.5 到 2，所以代码用 `atempoChain` 把大倍率拆成多个滤镜。
3. `afade` 处理淡入淡出。
4. `volume` 处理音量。
5. 前后补静音，让这条音频流对齐整条时间线。
6. 多条音频用 `amix` 混合。

这里的难点是：每条音频必须先对齐到全局时间轴，否则混音会从 0 秒一起开始。

### 16.5 文字导出

文本用 FFmpeg `drawtext`：

- `text`
- `fontsize`
- `fontcolor`
- `x/y`
- `enable=between(t,start,end)`
- `borderw/bordercolor`
- `box/boxcolor`

项目还做了跨平台字体候选：

- Windows: 微软雅黑/黑体
- macOS: PingFang
- Linux: Noto CJK

这是中文项目非常实用的细节。没有合适字体时，FFmpeg 很容易导出乱码或方框。

## 17. AI 文案生成

链路：

```text
TextGenDialog
  -> POST /api/text-gen/generate
  -> TextGenService
  -> LlmService
  -> packages/llm GlmProvider
  -> 返回 GeneratedText
  -> 前端一键加入 TextClip
```

`TextGenService` 的关键设计：

- 后端统一注入 system prompt，前端不能随意覆盖。
- 支持单轮 `prompt`，也支持多轮 `messages`。
- `maxLength` 控制文案字数。
- 模型返回后再硬截断，保证接口契约。

Provider 抽象在 `packages/llm`，以后要换 OpenAI、Claude、DeepSeek，只需要新增 provider 并在 `LlmService` 注册。

## 18. AI 图片/视频生成

链路：

```text
AiMediaGenDialog
  -> POST /api/ai-gen-media/image 或 /video
  -> 创建 generating Asset
  -> BullMQ 入队
  -> AiGenMediaProcessor 调智谱生成
  -> 下载远程媒体到本地 storage
  -> ffprobe 探测尺寸/时长
  -> 更新 Asset 为 ready
  -> 前端素材列表每 3 秒轮询
```

这个设计的亮点是“生成任务即素材占位”：

- 用户提交后，素材库马上出现一个 `generating` 卡片。
- 生成成功后同一个 Asset 变成 ready。
- 生成失败后同一个 Asset 变成 failed。

前端不需要额外维护复杂任务列表，只要轮询 assets。

## 19. AI 混编

AI 混编当前是规则生成，不是真正调用大模型。

链路：

```text
AiMixDialog 选择素材、时长、风格、卖点、CTA
  -> POST /api/ai-mix
  -> generateAdMixTimeline
  -> 返回 draftTimeline
  -> 用户点击应用
  -> replaceTimeline(draftTimeline)
  -> 保存项目
```

生成逻辑在 `ai-mix.generator.ts`：

- 根据风格决定每个视觉片段的 slot 时长。
- 循环使用 video/image 素材填满目标时长。
- 如果有 audio，放一条背景音轨。
- 自动生成 hook、卖点、CTA 三类文本。

这里的教学重点：AI 功能不一定第一版就必须调用模型。先用确定性规则生成一个可用 timeline，可以快速打通产品闭环。后续再把“规则参数”交给模型生成。

## 20. 登录鉴权

后端鉴权在 `AuthService` 和 `AuthGuard`。

### 20.1 密码

密码用 PBKDF2：

```text
pbkdf2:iterations:salt:hash
```

校验时用 `timingSafeEqual` 防止时序攻击。

### 20.2 session

session token 结构：

```text
base64url(payload).signature
```

payload 包含：

- `sub`: userId
- `exp`: 过期时间

signature 用 HMAC-SHA256 和 `SESSION_SECRET` 签名。

cookie 设置：

- `httpOnly: true`，前端 JS 读不到。
- `sameSite: 'lax'`
- production 下 `secure: true`

### 20.3 AuthGuard

每个需要登录的 controller 都 `@UseGuards(AuthGuard)`。Guard 从 cookie 里拿 token，验证后把 user 挂到 request 上，controller 再通过 `@CurrentUser()` 获取。

## 21. 技术难点与亮点

### 21.1 Timeline JSON 是系统核心协议

难点：前端拖拽、后端导出、数据库保存必须理解同一份数据。

亮点：用 `packages/contracts` 统一 schema，减少前后端语义漂移。

### 21.2 帧制时间模型

难点：UI 是像素，播放是秒，导出是 FFmpeg 时间戳，业务存储是帧。

亮点：所有业务状态都用帧，只有边界转换，降低误差和心智负担。

### 21.3 剪辑器交互

难点：拖动、trim、跨轨、新建轨、碰撞、磁吸、ripple 插入同时存在。

亮点：把碰撞算法抽成纯函数，拖拽过程用 snapshot + commitHistory 控制撤销粒度。

### 21.4 预览和导出语义对齐

难点：浏览器预览和 FFmpeg 导出是两套完全不同技术。

亮点：它们共享同一套 timeline 坐标、transform、transition 语义。预览用 CSS/HTML，导出用 filter graph。

### 21.5 异步任务工程化

难点：AI 生成和视频导出都可能很慢。

亮点：BullMQ + 数据库任务表 + 前端轮询，把慢任务做成可追踪状态机。

### 21.6 文件安全边界

难点：用户上传文件不能被其他用户读取，也不能被路径穿越攻击利用。

亮点：storage 按 userId 分区，文件读取 controller 显式校验用户、scope、basename。

### 21.7 FFmpeg filter graph 编译

难点：视频、图片、音频、文字、转场、变速、淡入淡出都要变成 FFmpeg 命令。

亮点：`render-graph.ts` 把生成 graph 的逻辑独立出来，`render-runner.ts` 只负责执行。

## 22. 每个功能怎么自己实现一遍

### 22.1 实现登录注册

步骤：

1. 设计 `User` 表。
2. 用 Zod 写 `RegisterSchema/LoginSchema`。
3. 后端注册时检查 email 唯一。
4. 密码加盐哈希后保存。
5. 登录时验证密码。
6. 生成签名 session token。
7. 设置 httpOnly cookie。
8. 前端所有请求带 `credentials: 'include'`。
9. 受保护接口通过 Guard 取当前用户。

### 22.2 实现项目列表

步骤：

1. `Project` 表加 `userId/name/timeline/deletedAt`。
2. 创建项目时写默认空 timeline。
3. 列表只查当前用户且 `deletedAt = null`。
4. 删除项目用软删除。
5. 前端用 TanStack Query 管理列表缓存。

### 22.3 实现素材上传

步骤：

1. 前端 `<input type="file">` 选择文件。
2. FormData 传给后端。
3. Multer 写入用户目录。
4. ffprobe 探测 kind、duration、width、height。
5. 判断编码是否适合浏览器，不适合则转码。
6. Asset 入库。
7. 前端刷新素材列表。

### 22.4 实现素材拖到时间轴

步骤：

1. 素材卡片设置 draggable。
2. `dataTransfer` 写入 assetId。
3. 时间轴 lane 处理 drop。
4. 根据鼠标 x 算出 atFrame。
5. 根据 asset.kind 找轨道类型。
6. 创建 Clip。
7. 用 `resolveMove` 找合法 start。
8. 写入 Zustand timeline。
9. 自动保存。

### 22.5 实现播放预览

步骤：

1. 用 `requestAnimationFrame` 推动 currentFrame。
2. 当前帧命中哪些 clip，就渲染哪些 layer。
3. 图片直接显示。
4. 视频根据 currentFrame 同步 currentTime。
5. 音频用隐藏 audio 同步 currentTime。
6. 文本按 TextClip 渲染。
7. transform 从工程坐标映射到预览坐标。

### 22.6 实现撤销重做

步骤：

1. 状态里放 `past` 和 `future`。
2. 普通操作前把当前 timeline 放进 past。
3. undo：当前 timeline 放入 future，past 最后一项变当前。
4. redo：future 第一项变当前，当前放回 past。
5. 高频拖拽只在 pointerUp 提交一次历史。

### 22.7 实现分割

步骤：

1. 判断分割帧是否在 clip 内部。
2. 左段保留原 id，duration 改成 `frame - start`。
3. 右段新 id，start 改成 frame。
4. 右段 trimStart 加上左段长度。
5. 选中新生成的右段。

文本分割类似，只是不需要 trimStart。

### 22.8 实现导出

步骤：

1. 前端导出前保存最新 timeline。
2. 后端创建 RenderJob。
3. BullMQ 入队。
4. Worker 读取 timeline 和素材 localPath。
5. buildGraph 生成 filter graph。
6. fluent-ffmpeg 执行。
7. progress 写回数据库。
8. 完成后设置 outputUrl。
9. 前端轮询并展示下载链接。

### 22.9 实现 AI 文案

步骤：

1. 前端维护 messages。
2. 提交时把完整对话发给后端。
3. 后端注入 system prompt。
4. LlmService 调 provider。
5. provider 调模型 API。
6. 后端做字数兜底截断。
7. 前端把结果作为 TextClip 添加。

### 22.10 实现 AI 媒体生成

步骤：

1. 前端输入 prompt。
2. 后端创建 `status=generating` 的 Asset。
3. BullMQ 入队。
4. Worker 调 AI provider。
5. 下载结果文件到本地。
6. ffprobe 探测元信息。
7. 更新 Asset 为 ready。
8. 前端轮询 assets，状态自然刷新。

### 22.11 实现 AI 混编

步骤：

1. 选择素材、目标时长、风格、卖点、CTA。
2. 后端读取素材并过滤 ready。
3. 生成视觉 clips 填满总时长。
4. 生成文本轨，包括 hook、卖点、CTA。
5. 可选生成音频轨。
6. 返回 draftTimeline。
7. 前端应用时用 `replaceTimeline`，保留 undo 能力。

## 23. 推荐阅读顺序

如果你想真正掌握这个项目，建议按下面顺序读：

1. `packages/contracts/src/index.ts`
2. `packages/db/prisma/schema.prisma`
3. `apps/web/src/lib/api.ts`
4. `apps/web/src/pages/HomePage.tsx`
5. `apps/web/src/pages/EditorPage.tsx`
6. `apps/web/src/features/editor/store.ts`
7. `apps/web/src/features/editor/collision.ts`
8. `apps/web/src/features/editor/components/Timeline.tsx`
9. `apps/web/src/features/editor/components/PreviewCanvas.tsx`
10. `apps/api/src/modules/projects/projects.service.ts`
11. `apps/api/src/modules/assets/assets.service.ts`
12. `apps/api/src/modules/render/render-graph.ts`
13. `apps/api/src/modules/render/render.processor.ts`
14. `apps/api/src/modules/text-gen/text-gen.service.ts`
15. `apps/api/src/modules/ai-gen-media/ai-gen-media.processor.ts`

读的时候一直问自己三个问题：

- 这个功能改的是 timeline、asset、project，还是 job？
- 时间单位现在是帧、秒，还是像素？
- 当前操作是同步请求，还是异步任务？

## 24. 当前项目可以继续提升的地方

### 24.1 测试不足

目前 package script 里基本是 `echo "no tests yet"`。建议优先补纯函数测试：

- `collision.ts`
- `transitions.ts`
- `render-graph.ts`
- `ai-mix.generator.ts`

这些模块没有 UI 依赖，最适合先测。

### 24.2 AI 混编任务是内存 Map

`AiMixService` 当前用内存 Map 保存 job。服务重启后任务丢失。短期可接受，生产建议落库或走 BullMQ。

### 24.3 timeline JSON 整体保存

整体保存简单，但未来协作、冲突合并、版本恢复会比较难。可以考虑：

- 保存 timeline 版本历史。
- 增加更新时间戳冲突检测。
- 长期拆成操作日志。

### 24.4 前端预览与 FFmpeg 仍有近似差异

CSS 转场和 FFmpeg xfade 不可能完全一致。当前项目已经统一了语义，但像素级效果可能不同。后续可给关键转场做更精确的 WebGL/canvas 预览。

### 24.5 文件清理策略

删除 Asset 会删本地文件，但项目软删除、旧 uploads、失败任务文件等可以进一步做定期清理。

### 24.6 权限与部署

生产环境要重点检查：

- `SESSION_SECRET` 必须足够随机。
- `PUBLIC_URL/CORS_ORIGIN` 必须正确。
- cookie secure 与 HTTPS 配套。
- storage 目录持久化。
- Redis/Postgres 备份。

## 25. 你应该掌握的核心能力

学完这个项目，你应该能掌握：

- 如何设计一个前后端共享的数据契约。
- 如何用 JSON 保存复杂编辑器状态。
- 如何实现帧制时间轴。
- 如何处理拖拽、trim、磁吸、碰撞。
- 如何用 Zustand 管理复杂本地编辑状态。
- 如何用 TanStack Query 管理服务端状态。
- 如何用 NestJS + Guard 做 cookie session 鉴权。
- 如何用 Multer + ffprobe 处理媒体上传。
- 如何用 BullMQ 处理慢任务。
- 如何把业务 timeline 编译成 FFmpeg filter graph。
- 如何把 AI 能力接入为素材、文案、自动编排。

## 26. 最后的理解模型

你可以把整个项目想成四层：

```text
交互层：React 组件，让用户拖、剪、看、导出
状态层：Zustand + Timeline JSON，描述剪辑工程
服务层：NestJS API，负责鉴权、持久化、任务入队
执行层：Worker + FFmpeg + AI provider，负责慢任务和真实产物
```

只要你理解 `Timeline` 是核心协议，理解“帧、秒、像素”的转换，理解 Asset 和 Clip 的区别，这个项目的大部分功能都会变得清晰。

## 27. 从代码重新画一遍系统数据流

这个项目最值得学习的地方，是它不是“页面请求接口、接口查表返回”这么简单，而是有三类状态在互相配合。

### 27.1 本地编辑状态

位置：`apps/web/src/features/editor/store.ts`

本地编辑状态是剪辑器交互的核心。它存在浏览器内存里，响应速度必须非常快。

典型数据：

- 当前 timeline
- 当前选中的 clip
- 撤销栈 past
- 重做栈 future
- 属性面板 tab

为什么不每拖动一下就请求后端？

因为拖动可能每秒触发几十次，如果每次都走 HTTP：

- 延迟会让 UI 卡顿。
- 后端压力大。
- 自动保存顺序容易乱。
- 撤销逻辑很难做。

所以项目的策略是：

```text
用户高频操作
  -> 只改 Zustand 本地状态
  -> 页面通过本地状态立即重绘
  -> 停止变化 1.5 秒后自动保存
```

### 27.2 服务端缓存状态

位置：TanStack Query hooks，`apps/web/src/features/editor/hooks.ts`

服务端状态来自 API：

- 当前项目 `useProject`
- 素材列表 `useAssets`
- 渲染任务 `useExport`
- AI 混编任务 `useAiMix`

这些状态有明显的“远程真相”：

- 素材是否生成完成，需要后端告诉前端。
- 导出是否完成，需要 worker 更新数据库后前端轮询。
- 项目列表属于账号维度，需要后端查库。

TanStack Query 负责：

- 缓存请求结果
- mutation 成功后刷新或更新缓存
- 按条件轮询
- 避免组件自己写一堆 loading/error 状态

### 27.3 持久化状态

位置：PostgreSQL + storage 文件系统

数据库保存结构化数据：

- User
- Project
- Asset
- RenderJob

文件系统保存大文件：

- 上传素材
- AI 生成素材下载后的本地副本
- 导出视频

为什么文件不直接存数据库？

视频和图片属于大对象，直接塞数据库会让备份、查询、迁移都变慢。常见做法是：

```text
数据库存元信息和路径
文件系统或对象存储存二进制文件
```

本项目在本地用 storage 目录，生产上可以迁移到 S3、OSS、COS 这类对象存储。

## 28. 技术栈逐个讲

### 28.1 pnpm workspace

根目录 `pnpm-workspace.yaml` 把多个包组织到一个仓库里。

好处：

- `apps/web` 和 `apps/api` 可以直接依赖 `packages/contracts`。
- 修改共享类型后，前后端马上都能感知。
- 一个 lockfile 管理全仓库依赖版本。

你需要理解 workspace 依赖写法：

```json
"@reel/contracts": "workspace:*"
```

这不是从 npm 下载，而是引用本仓库里的包。

### 28.2 Turborepo

根目录脚本：

```json
"build": "turbo run build",
"dev": "turbo run dev",
"typecheck": "turbo run typecheck"
```

Turbo 负责在 monorepo 中调度每个 package 的脚本。比如 `pnpm build` 会分别跑 web、api、contracts、db 等包的 build。

你可以把 Turbo 理解成“多包任务调度器”，不是业务框架。

### 28.3 React

React 负责 UI 组件化。这个项目里 React 组件大致分三类：

- 页面级：`HomePage`, `EditorPage`
- 布局/工作区级：`LeftPanel`, `PreviewCanvas`, `Timeline`, `PropertiesPanel`
- 小交互级：`ClipBlock`, `TextClipBlock`, `TransformBox`, `VideoLayer`, `TextLayer`

学习重点不是 JSX 语法，而是组件边界：

- `EditorPage` 管数据装配。
- `Timeline` 管时间轴交互。
- `PreviewCanvas` 管当前帧渲染。
- `PropertiesPanel` 管选中对象属性。

好的 React 项目，组件的职责应该能一句话说清楚。

### 28.4 Vite

Vite 是前端开发服务器和打包器。它的好处是启动快、热更新快。

本项目 API 请求用相对路径 `/api`，生产部署里 web 容器或 nginx 可以把 `/api` 反代到后端。

### 28.5 Zustand

Zustand 是轻量状态管理库。

为什么这里不用 Redux？

不是 Redux 不行，而是剪辑器有大量局部 action，Zustand 更直接：

```ts
const updateClip = useEditorStore((s) => s.updateClip);
```

组件只订阅自己需要的字段，可以减少无关渲染。

### 28.6 TanStack Query

TanStack Query 管远程请求，不适合管拖拽这种本地高频状态。

可以记住这个分工：

```text
Zustand：用户正在编辑什么
TanStack Query：服务端现在有什么
```

### 28.7 Tailwind CSS

项目用 Tailwind class 直接写样式，例如：

```tsx
className="flex h-full flex-col bg-base text-fg"
```

这里还结合了 CSS 变量，如 `bg-base`、`text-fg`，实际颜色在 `index.css` 里定义。这样可以让设计 token 集中管理。

### 28.8 NestJS

NestJS 是后端框架，项目按模块拆分：

- AuthModule
- ProjectsModule
- AssetsModule
- RenderModule
- TextGenModule
- AiGenMediaModule
- AiMixModule
- LlmModule

典型 Nest 结构：

```text
controller：处理 HTTP 入参和路由
service：业务逻辑
module：注册依赖
guard：鉴权
filter：异常格式处理
processor：BullMQ worker
```

学习 Nest 时要抓住依赖注入：

```ts
constructor(private readonly prisma: PrismaService) {}
```

你不需要手动 new，Nest 容器会创建并注入。

### 28.9 Prisma

Prisma 是 ORM：

- schema.prisma 定义表结构
- migrate 生成迁移
- client 提供类型安全查询

例如：

```ts
this.prisma.project.findFirst({
  where: { id, userId, deletedAt: null },
});
```

这比手写 SQL 更适合中小型 TypeScript 项目。

### 28.10 BullMQ

BullMQ 基于 Redis 做队列。

项目用它处理：

- render 队列
- ai-gen-media 队列

核心思想：

```text
API 线程：快速创建任务并返回
Worker 线程：慢慢执行耗时任务
DB：记录任务状态
前端：轮询任务状态
```

### 28.11 FFmpeg / ffprobe

ffprobe 用来读媒体信息：

- 时长
- 分辨率
- 音视频编码

FFmpeg 用来转码和导出：

- 上传时转 Web 兼容格式
- 导出时合成完整视频

视频项目里 FFmpeg 是很核心的底层能力。你可以把它理解为“命令行视频引擎”。

### 28.12 Zod

Zod 用于运行时校验和类型推导。

TypeScript 类型只在编译期有效，运行时接口传来的 JSON 可能是错的。Zod 解决这个问题：

```ts
TimelineSchema.parse(project.timeline)
```

如果数据库里的 timeline 结构坏了，parse 会抛错，避免坏数据继续进入导出流程。

## 29. API 模块逐个导读

### 29.1 AppModule

位置：`apps/api/src/app.module.ts`

AppModule 是后端总装配。

它做了几件事：

- 读取环境变量并用 Zod 校验。
- 配置 BullMQ Redis 连接。
- 注册 PrismaModule。
- 注册所有业务模块。
- 全局注册 ZodValidationPipe。
- 全局注册 AI/LLM 异常过滤器。

如果某个接口 404 或模块没生效，先看这个模块有没有 import。

### 29.2 env 配置

位置：`apps/api/src/config/env.ts`

关键环境变量：

- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `STORAGE_DIR`
- `PUBLIC_URL`
- `SESSION_SECRET`
- `CORS_ORIGIN`
- `GLM_API_KEY`
- `GLM_MODEL`
- `GLM_IMAGE_MODEL`
- `GLM_VIDEO_MODEL`

这里用 Zod 做 env 校验。好处是服务启动时就失败，而不是运行到一半才发现缺 key。

### 29.3 AuthController / AuthService

Controller 只暴露接口：

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Service 才做真正逻辑：

- 注册用户
- 密码哈希
- 密码校验
- 签 session
- 设置 cookie
- 解析当前用户

这是后端代码的基本分层：Controller 越薄越好，Service 才是业务核心。

### 29.4 AuthGuard

位置：`apps/api/src/modules/auth/auth.guard.ts`

它手写了一个 `getCookie`，从 header 里取 session cookie。

注意：这里没有用 `cookie-parser` 依赖，而是自己解析。逻辑很短：

```text
cookie header
  -> 按 ; 拆开
  -> 找 reel_session=
  -> decodeURIComponent
```

拿到 token 后调用 `auth.getSessionUser(token)`。如果返回 null，就抛 401。

### 29.5 ProjectsService

项目模块有几个产品约束：

- 每个用户最多 3 个 active project。
- 删除是软删除。
- 查找/更新/删除都必须带 userId。

这叫“多租户隔离”。即使用户猜到别人的 projectId，也不能访问，因为查询条件永远包含 `userId`。

### 29.6 AssetsService

素材创建流程里有几个值得学的点：

1. 先校验项目归属。
2. 探测媒体元信息。
3. 修正文件名编码：

```ts
Buffer.from(file.originalname, 'latin1').toString('utf8')
```

这是为了解决某些上传中文文件名时编码不对的问题。

4. 判断是否需要转码。
5. 如果转码成功，删除原始文件。
6. Asset 入库并返回共享契约类型。

### 29.7 FilesController

它不是普通静态目录服务，而是带鉴权的文件服务。

这意味着前端访问图片、视频、导出文件时也要带 cookie。项目 fetch API 带 cookie，但 `<img src>`、`<video src>` 请求同源资源时浏览器也会带 cookie，所以可以正常访问。

### 29.8 RenderService / RenderProcessor

`RenderService` 做同步部分：

- 校验 project 属于当前用户。
- 创建 RenderJob。
- 往队列放任务。

`RenderProcessor` 做异步部分：

- 标记 rendering。
- 读取项目 timeline。
- 查询素材。
- 探测视频是否有音频流。
- 创建导出目录。
- 调 `renderTimeline`。
- 更新 progress。
- 完成后写 outputUrl。
- 失败后写 error。

这里体现了很好的职责边界：入队和执行分开。

## 30. 前端模块逐个导读

### 30.1 api.ts

位置：`apps/web/src/lib/api.ts`

它封装了所有 HTTP 请求。核心函数：

```ts
async function request<T>(path: string, init?: RequestInit): Promise<T>
```

注意它统一做了：

- base path `/api`
- `credentials: 'include'`
- 非 2xx 抛 `ApiError`
- 返回 JSON

统一请求封装的好处是：业务组件不用重复写错误处理和 cookie 设置。

### 30.2 hooks.ts

位置：`apps/web/src/features/editor/hooks.ts`

这个文件把 API 包成 React hooks：

- `useProject`
- `useUpdateProject`
- `useAssets`
- `useGenerateMedia`
- `useUploadAsset`
- `useDeleteAsset`
- `useExport`
- `useAiMix`

有一个值得学的轮询写法：

```ts
refetchInterval: (q) =>
  (q.state.data ?? []).some((a) => a.status === 'generating') ? 3000 : false
```

意思是：只要有素材在生成中，就每 3 秒刷新；全部完成后自动停止轮询。

### 30.3 HomePage

HomePage 虽然看起来只是首页，但它包含完整账号和项目入口：

- 登录注册切换
- 表单校验
- 密码强度提示
- toast 错误
- 项目列表
- 删除确认弹窗
- 项目数量限制提示

这里你可以学习“前端乐观约束 + 后端强约束”的配合：

- 前端看到超过 3 个就禁用按钮。
- 后端仍然检查最多 3 个，防止绕过前端。

### 30.4 EditorTopBar

它负责：

- 返回首页
- 项目重命名
- 撤销/重做按钮
- 保存状态显示
- AI 混编入口
- 导出弹窗

导出弹窗里还有质量档：

- high
- medium
- low

前端会根据分辨率、时长、质量粗略估算文件大小。这不是精确值，但能给用户心理预期。

### 30.5 LeftPanel

左侧面板按 tab 切：

- 媒体
- 音频
- 文本
- 贴纸
- 特效

当前真正实现的是媒体、音频、文本和 AI 生成入口。贴纸/特效是占位。

素材卡片支持两种加入时间轴：

- 点击添加
- 拖拽到时间轴

拖拽时写入：

```ts
e.dataTransfer.setData('application/x-reel-asset', asset.id);
```

时间轴 drop 时再根据 assetId 找素材。

### 30.6 AiMediaGenDialog

这个弹窗负责收 prompt、比例，然后转换成模型支持的 size。

比例不是直接传 `16:9`，而是映射：

```text
16:9 -> 1344x768 或 1280x720
9:16 -> 768x1344 或 720x1280
1:1 -> 1024x1024 或 960x960
```

这里体现了一个适配层思想：用户选择产品语义，代码转换成供应商 API 参数。

### 30.7 TextGenDialog

它是一个轻量聊天框。

每次用户输入后：

1. 把用户消息加入本地 messages。
2. 把完整 messages 发给后端。
3. 后端返回 assistant 文案。
4. 前端追加 assistant 消息。
5. 用户可以点击“用这条”加入时间轴。

这就是最小可用的多轮 AI 文案功能。

## 31. 视频预览技术细讲

### 31.1 为什么不用 canvas

项目预览是 DOM 叠层，不是 `<canvas>`。

DOM 方案优点：

- 浏览器原生 video 解码性能好。
- img/video/text 分别用原生元素，代码简单。
- CSS transform、opacity、clip-path 可直接做预览效果。
- 文本编辑更容易。

缺点：

- 和 FFmpeg 导出的像素级效果不一定完全一致。
- 多视频层同时播放时，浏览器解码压力会变大。
- 复杂滤镜、遮罩、粒子效果不好做。

如果未来要做更专业的预览，可以考虑 WebGL 或 WebCodecs，但复杂度会明显上升。

### 31.2 VideoLayer 的纠偏策略

`VideoLayer` 不会每帧强制设置 `currentTime`，而是：

```ts
if (Math.abs(video.currentTime - targetTime) > 0.3) {
  video.currentTime = targetTime;
}
```

为什么？

每帧 seek 会非常卡，因为浏览器要重新定位解码。让 video 自己播放，只在漂移超过 0.3 秒时纠偏，是性能和准确度的折中。

暂停时则直接设置 currentTime，保证拖动播放头看到正确画面。

### 31.3 transform 坐标

Clip transform 存的是工程坐标，不是屏幕坐标：

```text
transform.x = 工程像素偏移
transform.y = 工程像素偏移
```

预览时：

```text
屏幕偏移 = 工程偏移 * displayScale
```

这样做的好处是：不管预览窗口多大，导出结果都一致。否则你在小窗口拖了 20px，导出到 1920x1080 时就不知道该是多少。

### 31.4 TransformBox 的缩放

`TransformBox` 的缩放是中心锚点缩放：

- 先算内容中心点 cx/cy。
- 根据 scale 算盒子宽高。
- 四角手柄拖动时，用鼠标到中心距离变化计算新 scale。

这比“拖右下角改变宽高”更适合视频图层，因为视频通常保持比例。

## 32. 文本系统细讲

### 32.1 TextClip 为什么独立

TextClip 不引用 Asset，因为文字不是上传文件。它的数据足够小，直接存 timeline 里即可。

```ts
TextClip {
  text
  start
  durationInFrames
  x/y/scale/rotation/opacity
  style
}
```

### 32.2 文本预览和导出字体对齐

`TextLayer.tsx` 里有一个中文字体栈：

```ts
"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", ...
```

后端 `render-graph.ts` 也会按系统查找类似字体。

这是非常现实的工程问题：中文字体如果预览和导出不同，用户看到的换行、字宽、描边都会变。

### 32.3 描边实现

前端：

```css
WebkitTextStroke
paintOrder: stroke
```

后端：

```text
drawtext borderw / bordercolor
```

这就是“不同平台用各自能力实现同一语义”。

## 33. FFmpeg 知识拓展

### 33.1 输入、滤镜、输出

一个 FFmpeg 命令大致由三部分组成：

```text
ffmpeg
  -i input1.mp4
  -i input2.png
  -filter_complex "..."
  -map "[vout]"
  -map "[aout]"
  output.mp4
```

本项目用 fluent-ffmpeg 生成这些命令。

### 33.2 filter label

在 filter graph 中，中括号是流标签：

```text
[0:v]scale=1920:-1[v0]
[base][v0]overlay=x=0:y=0[out]
```

意思是：

- 取第 0 个输入的视频流 `[0:v]`
- 缩放后命名为 `[v0]`
- 把 `[v0]` 叠到 `[base]`
- 输出命名为 `[out]`

项目里的 `vc0`、`full0`、`ov0`、`aout` 都是这种临时标签。

### 33.3 PTS

PTS 是 Presentation Timestamp，表示帧应该在什么时候显示。

常见写法：

```text
setpts=PTS-STARTPTS
```

意思是把流时间归零。处理单个 clip 时一般先归零，再用：

```text
setpts=PTS+start/TB
```

把它放到全局时间轴位置。

### 33.4 trim 和 atrim

- `trim` 处理视频流。
- `atrim` 处理音频流。

项目根据 clip 的 `trimStart` 和 `durationInFrames` 计算 `-ss`、`-t` 或 filter duration。

### 33.5 overlay

overlay 是视频合成的核心：

```text
[background][foreground]overlay=x=...:y=...:enable='between(t,start,end)'[out]
```

enable 控制只在某个时间段显示这层。

### 33.6 amix

多条音频混合用 `amix`：

```text
[a0][a1][a2]amix=inputs=3:duration=longest[aout]
```

项目先给每条音频前后补静音，再 amix。这样每条音频都在正确时间点出现。

### 33.7 atempo 限制

FFmpeg 的 atempo 单个滤镜适合 0.5 到 2。项目用 `atempoChain` 拆倍率：

```text
4x -> atempo=2,atempo=2
0.25x -> atempo=0.5,atempo=0.5
```

这是非常实用的 FFmpeg 细节。

## 34. 安全知识拓展

### 34.1 不信任前端

前端做限制是为了体验，后端做限制才是安全。

项目例子：

- 前端不让超过 3 个项目。
- 后端 `ProjectsService` 仍然用 transaction count 检查。

### 34.2 用户资源必须带 userId

凡是查项目、素材、渲染任务，都应该包含 userId：

```ts
where: { id, userId }
```

否则用户只要猜到 UUID，就可能越权访问。

### 34.3 文件路径穿越

危险请求：

```text
/files/users/u1/uploads/../../secret.env
```

项目用：

```ts
if (filename !== path.basename(filename)) throw new NotFoundException()
```

阻止 filename 里带路径。

### 34.4 httpOnly cookie

httpOnly cookie 的好处是前端 JS 读不到 token。即使页面有 XSS，攻击者也不能直接 `localStorage.token` 这样拿走。

但注意：XSS 仍然可以代替用户发请求，所以仍然要防 XSS。

## 35. 代码里的可改进点，按优先级

### 35.1 给纯函数补测试

优先测这些：

- `resolveMove`
- `resolveTrimLeft`
- `resolveTrimRight`
- `previewTransitions`
- `clampTransitionDuration`
- `generateAdMixTimeline`
- `buildGraph`

这些函数是核心业务逻辑，测起来成本低、收益高。

### 35.2 文本编辑历史

当前文本属性编辑有些是实时更新，不一定每个编辑动作都有理想的 undo 粒度。可以统一成：

```text
focus 时保存 snapshot
input/change 时实时更新
blur 时 commitHistory(snapshot)
```

### 35.3 素材删除与 timeline 引用

当前删除 Asset 会删素材记录和文件。但如果 timeline 里还有 clip 引用这个 asset，预览会找不到素材。

可选策略：

- 删除素材时同时删除引用它的 clips。
- 禁止删除正在被 timeline 使用的素材。
- 删除后让 clip 显示 missing 状态。

### 35.4 AI 生成任务表

AI 生成媒体当前以 Asset.status 表示任务状态，这个很简洁。但如果要展示详细进度、失败原因、重试历史，可以加 `AiGenJob` 表。

contracts 里已经有 `AiGenJobSchema`，但数据库 schema 里还没有对应 model。

### 35.5 AiMix 持久化

AI 混编 job 当前存在内存 Map。服务重启会丢。

如果要产品化，可以改成：

- 建 `AiMixJob` 表。
- 或直接不用 job，接口同步返回 draftTimeline。
- 或真正接入 BullMQ，支持 running/progress。

### 35.6 导出并发控制

现在 RenderQueue attempts 是 1，没看到显式并发限制配置。生产上要考虑：

- 单机同时跑几个 FFmpeg。
- 每个用户是否只能一个导出任务。
- 导出任务失败是否允许重试。
- 临时文件如何清理。

### 35.7 预览性能

多视频轨同时播放可能比较吃性能。后续可以优化：

- 非当前可见视频暂停。
- 只预加载附近片段。
- 缩略图缓存。
- 用 OffscreenCanvas/WebCodecs 做更底层的预览。

## 36. 你可以按这个路线练习

### 36.1 第一阶段：读懂数据结构

目标：能不看文档说出 Asset、Clip、Track、Timeline 的区别。

练习：

1. 打开 `packages/contracts/src/index.ts`。
2. 手画一个 timeline JSON，包含一个视频轨、一个音频轨、一个文本轨。
3. 标出每个 clip 的 start/end。
4. 把帧换算成秒。

### 36.2 第二阶段：读懂前端编辑

目标：能解释拖拽一个 clip 后发生了什么。

练习：

1. 从 `Timeline.tsx` 找到 pointerDown。
2. 跟到 pointerMove。
3. 找到 `resolveMove`。
4. 跟到 `updateClip`。
5. 找到 pointerUp 的 `commitHistory`。

### 36.3 第三阶段：读懂预览

目标：能解释 currentFrame 如何变成画面。

练习：

1. 从 `EditorPage.tsx` 找到播放时钟。
2. 找 `PreviewCanvas` 的 `findActiveLayers`。
3. 找 `VideoLayer` 如何算 targetTime。
4. 找 `TextLayer` 如何算位置。
5. 找 `AudioMixer` 如何同步音频。

### 36.4 第四阶段：读懂后端

目标：能解释一个上传文件如何变成素材卡片。

练习：

1. 从 `LeftPanel` 的 upload mutation 开始。
2. 跟到 `api.assets.upload`。
3. 跟到 `AssetsController.upload`。
4. 跟到 `AssetsService.createFromUpload`。
5. 看 `probeMedia` 和 `needsTranscode`。
6. 看 Prisma create。

### 36.5 第五阶段：读懂导出

目标：能解释一个 timeline 如何变成 mp4。

练习：

1. 从 `EditorTopBar` 的导出按钮开始。
2. 跟到 `useExport`。
3. 跟到 `RenderService.enqueue`。
4. 跟到 `RenderProcessor.process`。
5. 跟到 `renderTimeline`。
6. 重点读 `buildGraph`。

### 36.6 第六阶段：自己加一个小功能

推荐从小功能开始：

- 给 clip 增加水平翻转 `flipX`。
- 给文本增加阴影。
- 给导出质量增加 `ultra`。
- 给素材删除增加“被使用时禁止删除”提示。

以“文本阴影”为例：

1. contracts 里给 `TextStyleSchema` 加 shadow 字段。
2. PropertiesPanel 增加 UI 控件。
3. TextLayer 用 CSS textShadow 预览。
4. render-graph 用 drawtext shadow 参数导出。
5. 测试保存、刷新、导出。

这就是一次完整的全链路功能开发。

## 37. 常见概念对照表

| 概念 | 在本项目里是什么 | 你要注意什么 |
|---|---|---|
| Asset | 素材库文件 | 有 url/localPath/status |
| Clip | 素材在时间轴上的一次引用 | 有 start/duration/trimStart |
| Track | 一条轨道 | kind 决定 video/audio/text |
| Timeline | 整个剪辑工程 | 存在 Project.timeline JSON |
| currentFrame | 当前播放头 | 前端预览用 |
| fps | 每秒帧数 | 帧和秒互转 |
| pxPerSecond | 时间轴缩放 | 帧和像素互转 |
| transform | 片段画面/音频属性 | 预览和导出都消费 |
| transitionOut | 到下一个片段的转场 | 只对紧邻片段生效 |
| RenderJob | 导出任务 | BullMQ worker 更新状态 |
| generating Asset | AI 生成占位素材 | 前端轮询直到 ready/failed |

## 38. 一些容易踩坑的点

### 38.1 durationInFrames 的参考 fps

上传素材探测时使用参考 fps=30 把秒转成帧。项目 timeline 默认也是 30fps，但如果用户把项目 fps 改成别的值，就要注意素材时长帧数的语义。

更严谨的方案是保存素材原始 durationSec，clip 落入 timeline 时再按项目 fps 转帧。

### 38.2 hidden 不影响导出

contracts 注释里写了 `hidden` 预览跳过视频轨，不影响导出。也就是说用户隐藏轨道只是编辑查看，不是禁用导出。

如果产品希望隐藏轨也不导出，需要改 `render-graph.ts`，跳过 hidden video track。

### 38.3 文本轨 removeTextClip 没有 prune 空文本轨

`removeClip` 会过滤空轨，`removeTextClip` 当前只是清空 textClips，没有过滤空 text 轨。这个不一定是 bug，但会让空文本轨保留。可以按产品预期调整。

### 38.4 图片默认时长

图片没有天然时长，前端添加时用默认 3 秒：

```ts
const IMAGE_DEFAULT_SECONDS = 3;
```

AI 混编里图片 slot 时长则由风格函数决定。

### 38.5 sourceDurationSec 与 speed

导出时视频/音频源消耗时长：

```text
sourceDurationSec = timelineDuration * speed
```

如果 speed=2，时间轴占 3 秒，源素材要消耗 6 秒。

如果 speed=0.5，时间轴占 3 秒，源素材只消耗 1.5 秒。

这个公式是变速剪辑的核心。

## 39. 用一句话理解每个关键文件

- `packages/contracts/src/index.ts`: 定义系统数据协议。
- `packages/db/prisma/schema.prisma`: 定义持久化模型。
- `apps/api/src/app.module.ts`: 组装后端所有模块。
- `apps/api/src/config/env.ts`: 校验运行环境。
- `apps/api/src/modules/auth/auth.service.ts`: 注册、登录、session 签发与验证。
- `apps/api/src/modules/auth/auth.guard.ts`: 把 cookie token 转成当前用户。
- `apps/api/src/modules/projects/projects.service.ts`: 当前用户的剪辑项目 CRUD。
- `apps/api/src/modules/assets/assets.service.ts`: 上传素材探测、转码、入库。
- `apps/api/src/modules/files/files.controller.ts`: 带鉴权的文件读取。
- `apps/api/src/modules/render/render-graph.ts`: 把 timeline 编译成 FFmpeg filter graph。
- `apps/api/src/modules/render/render-runner.ts`: 执行 FFmpeg 并汇报进度。
- `apps/api/src/modules/render/render.processor.ts`: 导出 worker。
- `apps/api/src/modules/text-gen/text-gen.service.ts`: AI 文案业务层。
- `packages/llm/src/providers/glm.ts`: GLM chat API 适配器。
- `apps/api/src/modules/ai-gen-media/ai-gen-media.processor.ts`: AI 图片/视频生成 worker。
- `packages/ai-gen/src/providers/zhipu.ts`: 智谱图片/视频 API 适配器。
- `apps/web/src/lib/api.ts`: 前端 HTTP 封装。
- `apps/web/src/pages/HomePage.tsx`: 登录注册与项目列表。
- `apps/web/src/pages/EditorPage.tsx`: 编辑器页面总装配。
- `apps/web/src/features/editor/store.ts`: 剪辑器本地状态和所有编辑 action。
- `apps/web/src/features/editor/collision.ts`: 碰撞、trim 约束算法。
- `apps/web/src/features/editor/timeline.ts`: 时间轴缩放、刻度、帧像素转换。
- `apps/web/src/features/editor/components/Timeline.tsx`: 时间轴交互 UI。
- `apps/web/src/features/editor/components/PreviewCanvas.tsx`: 预览画布和图层筛选。
- `apps/web/src/features/editor/components/VideoLayer.tsx`: 单视频层同步播放。
- `apps/web/src/features/editor/components/AudioMixer.tsx`: 多音频片段同步混音。
- `apps/web/src/features/editor/components/TextLayer.tsx`: 文本预览图层。
- `apps/web/src/features/editor/components/TransformBox.tsx`: 预览区拖动缩放框。
- `apps/web/src/features/editor/components/PropertiesPanel.tsx`: 选中对象属性编辑。

## 40. 最后给你的学习建议

不要一开始就试图记住所有文件。这个项目最核心的能力链只有一条：

```text
Timeline 数据结构
  -> 前端编辑它
  -> 前端预览它
  -> 后端保存它
  -> Worker 导出它
```

你每学一个功能，都把它放回这条链上问：

- 它增加了 timeline 的哪个字段？
- 它怎么在前端被编辑？
- 它怎么被保存？
- 它怎么被预览？
- 它怎么被导出？

能回答这五个问题，就说明你真正理解了这个功能。

## 41. 面试重点：前端预览和导出如何保持一致

这个问题非常容易被面试官追问，因为视频剪辑项目最难的不是“前端能放视频”，而是用户在前端看到的效果，导出后是否还能保持同样语义。

你可以先给出一句总回答：

```text
项目用同一份 Timeline JSON 作为预览和导出的共同协议。前端预览用 DOM/CSS/HTMLMediaElement 解释 Timeline，后端导出用 FFmpeg filter graph 解释同一份 Timeline。两端不共享渲染引擎，但共享坐标、时间、图层、transform、音频、文本和转场语义。
```

### 41.1 一致性的核心不是“同一套代码”，而是“同一份语义”

前端和后端不可能完全复用同一套渲染代码：

- 前端在浏览器里，用 `<video>`、`<img>`、DOM 文本、CSS transform。
- 后端在 Node worker 里，用 FFmpeg 的 `scale`、`overlay`、`drawtext`、`amix`、`xfade`。

所以项目追求的是“语义一致”：

| 语义 | 前端预览 | 后端导出 |
|---|---|---|
| 时间 | `currentFrame` 判断 clip 是否命中 | `start / fps`、`duration / fps` |
| 图层 | tracks 顺序 + DOM zIndex | 依次 overlay 到 base |
| 位置 | `transform.x/y * displayScale` | `overlay x=(W-w)/2+x` |
| 缩放 | CSS `scale()` | FFmpeg `scale` |
| 旋转 | CSS `rotate()` | FFmpeg `rotate` |
| 透明度 | CSS opacity | `colorchannelmixer=aa` |
| 音量 | media.volume | FFmpeg `volume` |
| 变速 | playbackRate + currentTime 公式 | `setpts` + `atempo` |
| 淡入淡出 | 前端计算 gain | `afade`，视频透明度部分由 transform/opacity 支持 |
| 文本 | DOM TextLayer | FFmpeg `drawtext` |
| 转场 | CSS opacity/transform/clip-path 近似 | FFmpeg `xfade` |

你面试时要主动强调：像素级完全一致很难，尤其是字体排版、浏览器解码、CSS clip-path 和 FFmpeg xfade 算法，但这个项目通过统一数据模型，把“用户操作的语义”保持一致。

### 41.2 统一时间模型：所有业务状态都用帧

预览和导出最容易不一致的地方是时间。这个项目把所有 timeline 时间都存成帧：

```ts
start: number
durationInFrames: number
trimStart: number
```

前端播放时：

```text
当前秒 = currentFrame / fps
```

后端导出时：

```text
startSec = clip.start / fps
durSec = clip.durationInFrames / fps
trimStartSec = clip.trimStart / fps
```

这样只要 fps 一致，前端和后端就不会出现“前端第 3 秒出现，导出第 3.2 秒出现”的问题。

如果面试官问：“为什么不用秒存？”

可以回答：

```text
视频剪辑最终落到帧。用秒存会引入浮点误差，拖拽、吸附、裁剪时也容易出现 29.999999 帧这种边界问题。用帧作为内部单位，只有在 UI 显示和 FFmpeg 参数边界才转成秒，可控性更强。
```

### 41.3 统一空间模型：transform 存工程坐标，不存屏幕坐标

Clip 的 transform：

```ts
transform: {
  scale,
  x,
  y,
  rotation,
  opacity,
  volume,
  speed,
  fadeInDuration,
  fadeOutDuration
}
```

其中 `x/y` 是工程坐标里的像素偏移，不是浏览器上拖动后的 CSS 像素。

前端预览里：

```text
screenX = transform.x * displayScale
screenY = transform.y * displayScale
```

后端导出里：

```text
overlayX = (W - w) / 2 + transform.x
overlayY = (H - h) / 2 + transform.y
```

这就是预览和导出一致的关键。

如果前端直接保存屏幕坐标，会有严重问题：

- 用户在 640px 宽预览窗口拖动 50px。
- 导出是 1920px 宽。
- 到底应该偏移 50px，还是 150px？

现在保存工程坐标，就没有这个问题。

### 41.4 统一画布比例和 letterbox 映射

预览区不是直接按浏览器容器拉伸，而是按项目比例 object-contain。

前端计算：

```text
projectAspect = projectW / projectH
stageAspect = stageW / stageH
contentScale = min(stageW / projectW, stageH / projectH)
baseWidth = projectW * contentScale
baseHeight = projectH * contentScale
baseLeft = (stageW - baseWidth) / 2
baseTop = (stageH - baseHeight) / 2
```

含义：

- `stageW/stageH` 是预览容器。
- `baseWidth/baseHeight` 是真正视频画面区域。
- `baseLeft/baseTop` 是上下或左右黑边偏移。

导出端没有 letterbox，因为导出就是目标分辨率 `W x H`。前端通过这套映射，把工程坐标准确投影到预览画面区域，而不是投影到整个浏览器容器。

面试官可能问：“竖屏 9:16 时拖动元素，导出位置会不会偏？”

回答：

```text
不会，因为 transform.x/y 始终以项目分辨率为坐标系，前端只是用 contentScale 显示，导出直接用项目分辨率定位。横屏、竖屏、方形都走同一套坐标定义。
```

### 41.5 统一图层顺序

前端：

```text
tracks[0] 底层
tracks[1] 更上层
tracks[n] 顶层
```

`PreviewCanvas.findActiveLayers` 正序遍历 tracks，最后渲染的层视觉上盖在前面。

后端：

`render-graph.ts` 也是按 `timeline.tracks` 顺序处理 visualTracks，每个视觉片段依次 `overlay` 到上一轮结果。

可以把后端想成这样：

```text
last = black base
for each visual layer in track order:
  last = overlay(last, layer)
videoOut = last
```

所以多轨道画中画、上下层遮挡关系，本质都来自同一个 `tracks` 数组顺序。

### 41.6 统一片段命中逻辑

前端判断当前帧是否显示 clip：

```text
frame >= clip.start
frame < clip.start + clip.durationInFrames
```

后端导出时 overlay enable：

```text
enable='between(t,startSec,endSec)'
```

语义是一样的：只在 clip 的时间范围内显示。

注意 FFmpeg `between` 边界是秒，前端是帧。由于二者都来自同一个 `start/duration/fps`，所以整体一致。

### 41.7 统一素材裁剪和变速

预览里视频当前源时间：

```text
targetTime = ((currentFrame - clip.start) * speed + trimStart) / fps
```

导出里源消耗时长：

```text
sourceDurationSec = clip.durationInFrames * speed / fps
```

导出输入会从 `trimStart / fps` 开始取，取 `sourceDurationSec`。

变速含义：

- speed=2：时间轴播放 1 秒，源素材消耗 2 秒，画面变快。
- speed=0.5：时间轴播放 1 秒，源素材消耗 0.5 秒，画面变慢。

面试官可能问：“trimStart 和 speed 同时存在时怎么处理？”

回答：

```text
trimStart 决定源素材起点，speed 决定时间轴推进时源素材消耗速度。预览端 targetTime = ((当前帧 - 片段起点) * speed + trimStart) / fps；导出端用 -ss trimStartSec 取源，再用 setpts/atempo 改变播放速度。
```

### 41.8 统一文本语义

文本预览：

- DOM 居中容器
- x/y 偏移
- scale/rotation/opacity
- 字体大小、颜色、粗斜体、描边、背景

文本导出：

- FFmpeg `drawtext`
- `x=(w-text_w)/2+x`
- `y=(h-text_h)/2+y`
- `fontsize=style.fontSize * scale`
- `fontcolor=color@opacity`
- `enable=between(t,start,end)`
- `borderw/bordercolor`
- `box/boxcolor`

这里有一个取舍：前端 TextLayer 支持 rotation，但当前后端 drawtext 部分没有对文本 rotation 做 rotate 子图处理。你面试时如果被问到“文本旋转导出是否一致”，要诚实回答：

```text
当前代码里文本位置、字号、颜色、描边、背景、透明度和时间范围做了预览/导出对齐，但文本 rotation 在前端 TextLayer 有预览，导出 drawtext 还没有完整实现旋转。如果要补齐，需要先把文字画到透明子画布流，再 rotate 后 overlay 到主画面，而不是直接 drawtext 到 videoOut。
```

这是一个很好的加分点：你不仅知道做了什么，也知道哪里还没完全一致。

### 41.9 统一转场语义，但承认效果近似

转场挂在前一个 clip 的 `transitionOut`。

生效条件：

```text
同轨下一个片段存在
next.start === clip.start + clip.durationInFrames
```

前端：

- `previewTransitions` 找到转场区。
- `transitionStyle` 用 CSS 模拟。

后端：

- `resolveTransitionDuration` 钳制时长。
- FFmpeg `xfade=transition=...`。

一致点：

- 转场属于 A -> B。
- 转场发生在 A 结尾前 D 秒。
- B 的首帧提前参与过渡。
- 时间轴总长度不因为转场改变。

不完全一致点：

- CSS dissolve 只是 fade 近似。
- CSS wipe/circle 和 FFmpeg xfade 的像素算法不完全相同。

面试回答：

```text
项目保证转场的时间位置、参与片段、持续时长和大致视觉语义一致；具体像素级算法由浏览器 CSS 和 FFmpeg xfade 分别实现，因此复杂转场会有近似差异。要做到完全一致，需要前端也使用同类 shader/WebGL 实现，或导出前渲染低清 FFmpeg 预览，但成本更高。
```

### 41.10 导出前保存最新 timeline

另一个一致性细节在 `EditorPage` 和 `EditorTopBar`：

导出前调用：

```text
onBeforeExport
  -> 清掉自动保存 timer
  -> updateProject.mutateAsync({ timeline })
  -> 再创建 render job
```

为什么关键？

如果用户刚拖完 clip，自动保存还没触发，立刻点导出。worker 是从数据库读取 timeline 的，如果不先强制保存，就可能导出旧版本。

面试官问：“如何避免导出读到旧工程？”

回答：

```text
导出按钮不是直接入队，而是先 await 保存当前 Zustand timeline 到 Project.timeline，保存成功后才调用 /render 创建任务。这样 worker 从数据库读取的一定是最新 timeline。
```

## 42. 面试重点：多轨道画中画如何实现

“画中画”本质上不是一个单独功能，而是多视频轨 + 每个 clip 独立 transform + 图层 overlay 的组合。

一句话回答：

```text
项目通过多条 video track 表示多个视觉图层，每个 clip 有独立的 scale/x/y/rotation/opacity。前端按 tracks 顺序把命中的视频或图片绝对定位叠在预览区；后端导出时按同样顺序把每个视觉流 scale/rotate/opacity 后 overlay 到黑色 base 上，所以小窗视频、上下叠加、透明叠层都属于同一套机制。
```

### 42.1 数据层如何支持画中画

画中画不需要新增一个 `pip` 字段。现有 ClipTransform 已经够用：

```ts
{
  scale: 0.35,
  x: 520,
  y: -260,
  rotation: 0,
  opacity: 1
}
```

含义：

- `scale=0.35`: 缩小到 35%。
- `x=520`: 相对画面中心向右偏移 520 工程像素。
- `y=-260`: 相对画面中心向上偏移 260 工程像素。

只要这个 clip 位于更上层的 video track，它就会覆盖底层主视频，形成画中画。

### 42.2 前端预览如何渲染画中画

PreviewCanvas 会找到当前帧所有 active video/image layer：

```text
for track of timeline.tracks:
  if track.kind !== 'video' skip
  if track.hidden skip
  for clip of track.clips:
    if currentFrame 命中 clip:
      layers.push({ clip, asset, track })
```

渲染时：

```tsx
layers.map(({ clip, asset }, i) => (
  <VideoLayer
    transform={layerTransform(clip)}
  />
))
```

`layerTransform`：

```text
translate(x * displayScale, y * displayScale)
scale(scale)
rotate(rotation)
```

如果 clip 缩小并偏移，预览里自然就是画中画。

### 42.3 后端导出如何渲染画中画

`render-graph.ts` 对每个视觉 clip 做：

1. 读取输入流。
2. trim 到源片段。
3. scale。
4. rotate。
5. opacity。
6. overlay 到主画面。

关键定位公式：

```text
x = (W - w) / 2 + transform.x
y = (H - h) / 2 + transform.y
```

解释：

- `W/H`: 输出画布大小。
- `w/h`: 当前 clip 缩放后的尺寸。
- `(W-w)/2`, `(H-h)/2`: 默认居中。
- `+ x/y`: 用户拖动后的工程坐标偏移。

所以画中画在导出里就是一个缩小后的视频流，被 overlay 到主画面的某个位置。

### 42.4 多轨道叠加和单轨道片段有什么区别

同一轨道内：

- 片段通常不允许重叠。
- 用来表示时间上的先后剪辑。

不同轨道之间：

- 可以在同一时间重叠。
- 用来表示图层叠加。

所以：

```text
主视频：video track 1，从 0s 到 10s
画中画：video track 2，从 2s 到 8s，scale=0.3，x=500，y=-250
```

最终效果：

- 0-2s：只有主视频。
- 2-8s：主视频 + 右上角小窗视频。
- 8-10s：只有主视频。

### 42.5 轨道顺序决定谁盖住谁

tracks 数组越靠后越上层。

例如：

```text
tracks[0] 主视频
tracks[1] 画中画视频
tracks[2] 文本
```

视觉效果：

```text
文本盖住画中画
画中画盖住主视频
主视频在最底
```

如果面试官问：“怎么调整画中画在上层还是下层？”

回答：

```text
通过 moveTrack 调整 tracks 数组顺序。前端预览和后端导出都按 tracks 顺序叠加，所以轨道顺序就是图层顺序。
```

### 42.6 画中画和裁剪/遮罩有什么区别

当前项目的画中画是“整体缩放后叠加”，没有实现裁剪形状或圆角遮罩。

已有能力：

- 缩放
- 位移
- 旋转
- 透明度
- 多轨叠加

还没有完整实现：

- 小窗圆角
- 裁剪区域
- 边框
- 阴影
- 遮罩
- 混合模式

如果要加圆角画中画，设计路径是：

1. contracts 给 ClipTransform 增加 `borderRadius` 或 `mask`。
2. 前端 VideoLayer 用 CSS `border-radius` + `overflow:hidden`。
3. 后端 FFmpeg 要用 alpha mask 或 `geq/format/alphamerge` 构造圆角遮罩，再 overlay。
4. 属性面板加控件。

面试回答要体现你知道当前边界：

```text
当前代码支持基于 scale/x/y 的矩形画中画叠加；圆角、边框、阴影属于额外视觉属性，前端容易实现，但要保证导出一致，需要同步扩展 FFmpeg filter graph。
```

### 42.7 多个画中画会不会卡

前端方面：

- 多个 `<video>` 同时解码会增加浏览器压力。
- 当前只渲染当前帧命中的 active layers。
- 但如果同一帧命中很多视频轨，仍然会有多个 video 同时播放。

后端方面：

- FFmpeg 会为每个视觉片段创建输入流和滤镜链。
- 多轨、多片段、转场越多，filter graph 越复杂，导出越慢。

可优化方向：

- 前端限制同时活跃视频层数量。
- 给素材生成低清代理文件用于预览。
- 导出 worker 控制并发。
- 预览时对非选中上层降低解码质量。
- 长期可以用 WebCodecs/WebGL 做统一渲染管线。

## 43. 面试官可能逐功能追问，你可以这样答

下面是按功能整理的追问清单。你不需要背每个字，但要理解回答逻辑。

### 43.1 项目为什么用 monorepo

问：为什么前后端放一个仓库？

答：

```text
因为这个项目有强共享类型需求。Timeline、Asset、RenderJob 这些结构前端要消费，后端要校验，worker 也要消费。monorepo 可以把 contracts 抽成 workspace package，避免前后端重复定义 DTO，减少接口漂移。
```

追问：缺点是什么？

答：

```text
仓库变大后 CI、依赖版本、构建缓存要管理好；团队边界复杂时也可能互相影响。这个项目用 Turborepo 统一调度 build/typecheck，适合当前规模。
```

### 43.2 为什么 timeline 存 JSON

问：为什么不把 Track、Clip 都拆成表？

答：

```text
剪辑器编辑时通常是整份工程频繁保存，timeline 是嵌套结构，JSON 保存能让自动保存和回放简单很多。当前项目不需要跨项目检索单个 clip，也没有多人协作，所以 JSON 是更务实的选择。
```

追问：以后多人协作怎么办？

答：

```text
可以引入版本号、操作日志或者 CRDT。也可以把 clip 拆表，但那会增加事务、排序、批量保存和冲突合并的复杂度。
```

### 43.3 如何实现撤销/重做

问：撤销重做怎么做？

答：

```text
Zustand store 里维护 past/future 两个 timeline 快照栈。普通操作执行前把当前 timeline 推入 past；undo 时把当前 timeline 放入 future，再取 past 最后一项恢复；redo 反过来。
```

追问：拖拽过程中会不会产生很多历史？

答：

```text
不会。拖拽 pointerDown 时保存 snapshot，pointerMove 只实时更新当前 timeline，不入历史；pointerUp 时 commitHistory(snapshot)，所以一次拖拽只产生一次可撤销记录。
```

### 43.4 如何处理同轨碰撞

问：同一轨道不允许重叠怎么实现？

答：

```text
把同轨其他片段转成占用区间，计算空闲区间。拖动时调用 resolveMove，把 proposedStart 钳制到最近的可容纳空闲区间。trim 左右边缘也分别用 prevClipEnd 和 nextClipStart 限制，避免越过邻居。
```

追问：跨轨呢？

答：

```text
跨轨只允许同类型轨道，比如 video/image 进 video 轨、audio 进 audio 轨、text 进 text 轨。松手时 relocateClip 到目标轨，并在目标轨调用 resolveMove 找合法位置。
```

### 43.5 磁吸怎么实现

问：播放头和片段边缘磁吸怎么做？

答：

```text
拖拽时收集吸附目标：播放头、0 点、所有片段 start/end。用 8px 转换成当前缩放下的帧阈值。如果片段左边缘或右边缘距离某个目标小于阈值，就调整 start，并记录 snapLineFrame 显示辅助线。
```

追问：为什么阈值用 px 而不是帧？

答：

```text
用户感知的是屏幕距离。不同缩放级别下，固定帧数会导致手感不一致。用 8px 再转帧，可以保持视觉手感一致。
```

### 43.6 分割怎么实现

问：视频分割怎么处理 trimStart？

答：

```text
分割点必须在 clip 内部。左段保留原 id，duration 改为 splitFrame - start；右段新 id，start=splitFrame，duration=原 duration - 左段 duration，trimStart=原 trimStart + 左段 duration。这样右段从源素材对应位置继续播放。
```

### 43.7 音频混音怎么实现

问：前端预览多音频怎么同步？

答：

```text
AudioMixer 为每个音频 clip 创建隐藏 audio 元素，根据 currentFrame 判断是否 active。active 且播放中就按 ((frame-start)*speed + trimStart)/fps 设置目标 currentTime，设置 playbackRate、volume、fadeGain。轨道静音或片段静音时暂停。
```

问：导出多音频怎么同步？

答：

```text
后端每条音频先 atrim、atempo、afade、volume，然后在前后 concat 静音段，让它对齐整条时间线。所有对齐后的音频流再用 amix 混合。
```

### 43.8 为什么导出用队列

问：为什么不直接 HTTP 等导出完成？

答：

```text
FFmpeg 导出耗时长，直接 HTTP 容易超时，也无法可靠追踪进度。项目用 RenderJob 表记录状态，用 BullMQ 把任务交给 worker 执行，前端轮询 /render/:id 获取进度和结果。
```

追问：worker 失败怎么办？

答：

```text
当前代码捕获异常后把 RenderJob 标成 failed 并记录 error。队列 attempts 是 1，生产可以增加重试、失败清理、并发控制和告警。
```

### 43.9 AI 生成素材为什么先创建 Asset

问：为什么 AI 生成时先创建 generating Asset？

答：

```text
这是为了把 AI 生成结果自然接入素材库。用户提交 prompt 后立即看到一个 generating 卡片；worker 成功后更新同一个 Asset 为 ready，失败则 failed。前端只需要轮询 assets，不需要额外维护复杂任务列表。
```

### 43.10 AI 混编是真 AI 吗

问：AI 混编具体调用大模型了吗？

答：

```text
当前代码里的 AI 混编是规则生成，不是 LLM 生成。它根据素材、时长、风格、卖点和 CTA，生成一份 draftTimeline。这个实现先打通自动编排闭环，后续可以把镜头选择、文案节奏、转场选择交给模型。
```

这个回答要诚实。不要把规则生成包装成大模型能力。

### 43.11 上传素材为什么要转码

问：为什么上传后要判断 codec？

答：

```text
浏览器 video/audio 元素不是支持所有编码。项目用 ffprobe 探测音视频编码，如果不是 Web 兼容编码，就用 FFmpeg 转成 H.264 + AAC 的 mp4 或 AAC 的 m4a。这样前端预览更稳定。
```

### 43.12 文件访问如何防越权

问：别人能不能访问我的素材 URL？

答：

```text
文件不是直接静态暴露，而是走 /files/users/:userId/:scope/:filename，并且挂 AuthGuard。Controller 会检查 URL 里的 userId 必须等于当前登录用户，还检查 scope 和 filename basename，防止越权和路径穿越。
```

### 43.13 前端预览为什么不用 canvas

问：为什么不用 canvas 做预览？

答：

```text
当前阶段 DOM 方案实现成本低，浏览器原生 video/img/text 能力足够支持多轨叠加、transform、opacity、简单转场和音频同步。缺点是和 FFmpeg 不是同一渲染引擎，复杂效果只能语义一致不能像素级一致。未来专业化可以考虑 WebGL/WebCodecs。
```

### 43.14 如何保证接口类型安全

问：前后端类型如何同步？

答：

```text
packages/contracts 用 Zod 定义 schema，再用 z.infer 推导 TypeScript 类型。前端直接 import 类型，后端 DTO 用 createZodDto 复用 schema，全局 ZodValidationPipe 做请求校验。数据库 JSON 读出后也用 schema parse。
```

### 43.15 多轨画中画如果要加圆角怎么办

答：

```text
需要全链路扩展。contracts 给 ClipTransform 加 borderRadius；前端 VideoLayer 用 border-radius 和 overflow hidden；属性面板加控制；后端 render-graph 不能只 overlay，需要对视频流加 alpha mask 或圆角遮罩后再 overlay，确保导出一致。
```

## 44. 功能实现追问矩阵

这张表适合你面试前快速复习。

| 功能 | 面试官可能问 | 你回答的关键词 |
|---|---|---|
| 登录注册 | 密码怎么存 | PBKDF2、salt、timingSafeEqual、httpOnly cookie |
| 鉴权 | 如何防越权 | AuthGuard、CurrentUser、查询都带 userId |
| 项目保存 | 自动保存怎么做 | Zustand timeline、1.5s debounce、PATCH Project.timeline |
| 导出一致性 | 导出是不是最新状态 | 导出前 await 保存最新 timeline |
| 时间轴 | 为什么用帧 | 避免浮点误差、剪辑天然按帧 |
| 缩放刻度 | zoom 怎么做 | pxPerSecond、framesToPx、pxToFrames、动态 rulerTicks |
| 拖拽 | 如何算落点 | clientX + scrollLeft - LEFT_W -> frame |
| 碰撞 | 如何避免重叠 | occupied intervals、free intervals、resolveMove |
| trim | 左右裁剪区别 | 左裁剪改 start/trimStart/duration，右裁剪改 duration |
| 分割 | 源素材如何连续 | 右段 trimStart 加左段长度 |
| 多轨 | 谁盖住谁 | tracks 数组顺序，越后越上层 |
| 画中画 | 怎么实现 | 多 video track + scale/x/y + overlay |
| 预览 | 如何同步视频 | currentFrame -> targetTime，漂移超过 0.3s 才 seek |
| 音频 | 多路怎么混 | 前端多 audio，后端补静音后 amix |
| 文本 | 中文字体一致性 | 前端字体栈，后端 resolveFontFile + drawtext |
| 转场 | 何时生效 | transitionOut，只对同轨紧邻下一片段 |
| 素材上传 | 怎么知道时长 | ffprobe，durationSec * reference fps |
| 转码 | 为什么需要 | 浏览器 codec 兼容性，H.264/AAC |
| AI 文案 | 如何接模型 | TextGenService -> LlmService -> GlmProvider |
| AI 图片视频 | 异步状态怎么展示 | generating Asset + BullMQ + assets 轮询 |
| AI 混编 | 如何生成方案 | 规则生成 draftTimeline，可 undo 应用 |
| 导出 | FFmpeg 怎么合成 | buildGraph、input、filter_complex、map |
| 任务进度 | 怎么展示 | RenderJob progress + 前端轮询 |
| 文件安全 | 如何防路径穿越 | basename 校验、scope 白名单 |

## 45. 如果面试官让你现场讲“预览到导出”的完整链路

你可以按下面这段讲，逻辑会比较完整：

```text
用户在前端编辑器里拖动素材，本质是在修改 Zustand 里的 Timeline JSON。Timeline 里所有时间用帧保存，所有视觉位移用项目坐标保存。预览区拿 currentFrame 去筛选当前命中的 clips，按 tracks 顺序渲染 DOM 图层；视频层通过 currentFrame、clip.start、trimStart、speed 算出 video.currentTime，transform.x/y 乘 displayScale 映射到屏幕。

自动保存会把 timeline 写入 Project.timeline。用户点击导出时，先强制保存当前 timeline，再创建 RenderJob 入队。Worker 从数据库读取同一份 timeline，查询素材 localPath，然后 buildGraph 把每个 clip 编译成 FFmpeg 输入和 filter。视频和图片按 start/duration overlay 到黑色 base；音频按 start 补静音后 amix；文本用 drawtext；转场用 xfade。最终输出 mp4，并把 outputUrl 写回 RenderJob。前端轮询任务状态，完成后提供下载。

所以预览和导出不是同一套渲染代码，但它们共享同一份 Timeline 协议和同一套时间、坐标、图层语义。
```

这段基本可以回答 80% 的架构追问。

## 46. 如果面试官让你现场讲“多轨画中画”的完整链路

你可以这样讲：

```text
画中画在这个项目里不是单独的数据类型，而是多轨叠加能力的一种使用方式。底层主视频放在较低的 video track，上层小窗视频放在更靠后的 video track。小窗 clip 的 transform.scale 设置小于 1，transform.x/y 设置到右上角或其他位置。

前端 PreviewCanvas 当前帧会找出所有命中的 video/image clips，按照 tracks 顺序渲染。VideoLayer 用 CSS transform: translate(...) scale(...) rotate(...) 把小窗视频缩小并移动，所以浏览器预览里就是画中画。

导出时 render-graph 对同一份 timeline 做 FFmpeg 编译。每个视觉 clip 都会 scale 成对应大小，再用 overlay 叠到 base 上，overlay 的坐标是 (W-w)/2 + x、(H-h)/2 + y。由于后端也按 tracks 顺序 overlay，所以上层小窗会盖在底层主视频之上。这个机制天然支持多个画中画，只是前端解码和后端导出性能会随视频层数量增加。
```

如果被追问“如何支持圆角小窗”，接着说：

```text
当前支持矩形小窗。圆角需要扩展 ClipTransform，并在前端用 CSS border-radius，后端用 FFmpeg alpha mask 做圆角后再 overlay，否则只能预览生效、导出不一致。
```

## 47. 你要主动暴露的工程边界

面试时不要把项目说成完美无缺。真正懂项目的人，会知道边界在哪里。

### 47.1 已经做得比较好的地方

- Timeline 是统一协议。
- 前后端共享 Zod schema。
- 时间统一用帧。
- 拖拽历史粒度控制合理。
- 素材和 clip 分离。
- 慢任务队列化。
- 文件访问有鉴权。
- FFmpeg graph 生成逻辑独立。
- AI 生成以 Asset 状态自然接入素材库。

### 47.2 当前还可以增强的地方

- 文本 rotation 预览和导出未完全对齐。
- CSS 转场和 FFmpeg xfade 只能语义近似。
- hidden 轨道当前不影响导出，产品语义要确认。
- 删除 Asset 后 timeline 引用缺少完整处理。
- AI 混编 job 用内存 Map，服务重启会丢。
- 缺少系统化单元测试和 E2E 测试。
- 多视频轨预览性能未来需要代理文件或 WebCodecs 优化。

### 47.3 面试中怎么表达这些边界

可以这样说：

```text
这个项目当前的目标是做一个可用的 AI 视频剪辑 MVP，所以优先保证核心链路：素材上传、时间轴编辑、预览、自动保存、AI 生成、导出。预览和导出通过统一 Timeline 保证语义一致，但复杂视觉效果还没有做到像素级一致。后续如果产品要更专业，可以把文本旋转、圆角画中画、滤镜、代理文件、导出并发控制和测试体系继续补齐。
```

这类回答会比“都实现了”更可信。

## 48. 面试重点：Timeline 数据如何转换成 FFmpeg 命令

这个问题必须讲准确。项目里不是“前端预览 DOM 直接转换成 FFmpeg 命令”，而是：

```text
前端编辑 Timeline JSON
  -> 自动保存到 Project.timeline
  -> 用户点击导出
  -> 后端 worker 读取 Project.timeline
  -> render-graph.ts 把 Timeline 编译成 FFmpeg inputs + filter_complex + map
  -> render-runner.ts 用 fluent-ffmpeg 执行
```

所以真正转换发生在后端：

- `apps/api/src/modules/render/render.processor.ts`
- `apps/api/src/modules/render/render-graph.ts`
- `apps/api/src/modules/render/render-runner.ts`

前端预览只是在浏览器里“解释”同一份 Timeline。它不会生成 FFmpeg 命令。

### 48.1 为什么不能直接把前端预览转 FFmpeg

前端预览是 DOM 结构：

```text
<div stage>
  <video style="transform: ...">
  <img style="transform: ...">
  <div text layer>
</div>
```

FFmpeg 不认识这些 DOM、CSS、React 组件。FFmpeg 需要的是：

```text
输入文件列表
滤镜图 filter_complex
输出流映射 map
编码参数
输出路径
```

所以项目采用“共同中间表示”的思路：

```text
Timeline JSON 是中间表示
前端用它渲染 DOM 预览
后端用它生成 FFmpeg filter graph
```

这类似编译器：

```text
Timeline AST
  -> Browser renderer
  -> FFmpeg renderer
```

面试时可以说：

```text
前端预览不是 FFmpeg 命令的来源，Timeline 才是来源。这样避免从 DOM 反推视频语义，也避免 CSS 和 FFmpeg 之间做脆弱转换。
```

### 48.2 导出入口从哪里开始

前端点击导出在 `EditorTopBar.tsx`。

关键流程：

```text
confirmExport()
  -> await onBeforeExport()
  -> start({ fileName, quality })
```

`onBeforeExport` 来自 `EditorPage.tsx`：

```text
清除自动保存 timer
updateProject.mutateAsync({ timeline })
```

这一步保证后端读到的是最新 Timeline。

然后 `useExport` 调：

```text
POST /api/render
```

后端 `RenderService.enqueue`：

1. 校验项目属于当前用户。
2. 创建 RenderJob。
3. BullMQ 入队。

Worker `RenderProcessor.process`：

1. 从数据库读取 Project。
2. 用 `TimelineSchema.parse(project.timeline)` 校验 timeline。
3. 收集 timeline 里引用的 assetId。
4. 查 Asset 的 `localPath`。
5. 调 `renderTimeline(timeline, assetById, outputPath, quality, onProgress)`。

### 48.3 renderTimeline 做什么

位置：`apps/api/src/modules/render/render-runner.ts`

它不是直接拼接字符串，而是先调用：

```ts
const graph = buildGraph(timeline, assetById);
```

`graph` 里有：

```ts
interface BuiltGraph {
  inputs: GraphInput[];
  complexFilter: string[];
  maps: string[];
  hasAudio: boolean;
  durationSec: number;
}
```

然后 fluent-ffmpeg 大致执行：

```text
ffmpeg()
  .input(input.path)
  .inputOptions(input.options)
  .complexFilter(graph.complexFilter)
  .outputOptions([
    -map graph.maps...
    -r fps
    -s outW x outH
    -c:v libx264
    -pix_fmt yuv420p
    -preset ...
    -crf ...
    -movflags +faststart
    -t duration
    -c:a aac 或 -an
  ])
  .save(outputPath)
```

也就是说：

```text
render-graph.ts 负责“生成命令需要的图”
render-runner.ts 负责“把图交给 FFmpeg 执行”
```

### 48.4 buildGraph 的输入是什么

输入是两样：

```ts
buildGraph(timeline, assetById)
```

`timeline` 来自数据库里的 `Project.timeline`。

`assetById` 是一个 Map：

```text
assetId -> Asset + localPath + hasAudioStream
```

为什么需要 Asset？

Timeline 的 Clip 只存 `assetId`，不直接存文件路径。导出时必须根据 assetId 找到真实文件：

```text
clip.assetId
  -> assetById.get(assetId)
  -> asset.localPath
  -> ffmpeg input
```

这也是 Asset 和 Clip 分离的意义。

### 48.5 第一步：收集输入文件 inputs

`buildGraph` 遍历 timeline tracks：

```text
for track of timeline.tracks:
  if track.kind === 'text':
    暂时跳过，后面 drawtext
  else:
    for clip of track.clips:
      asset = assetById.get(clip.assetId)
      根据 asset.kind 决定如何作为 FFmpeg input
```

视频素材 input：

```text
-ss trimStartSec
-t sourceDurationSec
-ac 2
-i asset.localPath
```

图片素材 input：

```text
-loop 1
-t durSec
-i asset.localPath
```

音频素材 input：

```text
-ss trimStartSec
-t sourceDurationSec
-ac 2
-i asset.localPath
```

注意：

- 图片没有天然时长，所以用 `-loop 1 -t durSec` 变成一段视频流。
- 视频和音频要考虑 trimStart 和 speed。
- `-ac 2` 是转成双声道，方便后面混音。

### 48.6 第二步：把 Clip 转成 VisualEntry 和 AudioEntry

`render-graph.ts` 内部会生成两类中间结构。

视觉片段：

```ts
interface VisualEntry {
  inputIdx
  clip
  asset
  startSec
  durSec
  sourceDurationSec
  inD
  outD
  outType
}
```

音频片段：

```ts
interface AudioEntry {
  inputIdx
  clip
  startSec
  sourceDurationSec
  trackMuted
}
```

这些结构是为了把原始 Timeline 变得更适合生成 FFmpeg graph。

例如 Clip 里的时间是帧：

```text
clip.start = 90
clip.durationInFrames = 150
fps = 30
```

转换后：

```text
startSec = 3
durSec = 5
```

### 48.7 第三步：创建黑色底画布

导出视频必须有一个基础画布。代码生成类似：

```text
color=c=black:s=1920x1080:r=30:d=10[base]
```

含义：

- 创建 1920x1080 黑色视频
- 帧率 30
- 持续 10 秒
- 命名为 `[base]`

之后所有视频、图片、画中画、文字都叠到这个 base 上。

### 48.8 第四步：处理单个视频或图片片段

一个视觉 clip 大概会生成这样的滤镜链：

```text
[0:v]
trim=duration=5,
setpts=PTS-STARTPTS,
scale=...,
format=rgba,
rotate=...,
colorchannelmixer=aa=...
[vc0]
```

每一步对应 Timeline 里的一个语义：

| Timeline 字段 | FFmpeg 处理 |
|---|---|
| `durationInFrames` | `trim=duration=durSec` |
| `speed` | `setpts=(1/speed)*PTS` |
| `scale` | `scale=...` |
| `rotation` | `rotate=...` |
| `opacity` | `colorchannelmixer=aa=opacity` |

前端对应的是：

```text
CSS transform scale/rotate
CSS opacity
video currentTime/playbackRate
```

### 48.9 第五步：overlay 到时间轴位置

处理完单个视觉流后，还要把它放到全局时间轴。

项目里会先移动 PTS：

```text
[vc0]setpts=PTS+startSec/TB[sh_vc0]
```

然后叠到上一层：

```text
[last][sh_vc0]overlay=x='(W-w)/2+x':y='(H-h)/2+y':enable='between(t,startSec,endSec)'[ov0]
```

这里就是多轨、画中画、图层叠加的核心。

对应关系：

| Timeline/预览语义 | FFmpeg |
|---|---|
| clip.start | `setpts=PTS+startSec/TB` |
| clip.duration | `enable=between(t,start,end)` |
| transform.x/y | overlay x/y |
| tracks 顺序 | overlay 顺序 |
| 多轨画中画 | 多次 overlay |

### 48.10 第六步：处理转场

如果一个 clip 有 `transitionOut`，且下一个 clip 紧邻：

```text
next.start === clip.start + clip.durationInFrames
```

后端会计算转场持续时间 D，然后生成：

```text
[tailA][headB]xfade=transition=fade:duration=D:offset=0[seg]
```

再把转场段 overlay 到 A 结尾前 D 秒的位置。

关键点：

- A 的尾部真实播放。
- B 的首帧提前冻结参与转场。
- 时间轴总长度不改变。

所以这不是把两个片段真的重叠存储，而是在导出 graph 里临时生成转场段。

### 48.11 第七步：处理文本 drawtext

Timeline 里的文本：

```ts
TextClip {
  text,
  start,
  durationInFrames,
  x,
  y,
  scale,
  opacity,
  style
}
```

会变成 FFmpeg `drawtext`：

```text
[videoOut]
drawtext=
  text='...':
  fontsize=...:
  fontcolor=0xFFFFFF@1:
  x='(w-text_w)/2+x':
  y='(h-text_h)/2+y':
  enable='between(t,startSec,endSec)':
  borderw=...:
  bordercolor=...
[vtxt0]
```

每个 TextClip 都是在当前视频流基础上再 draw 一次，最后得到带文字的视频流。

注意当前边界：

- 文本位置、字号、颜色、描边、背景、透明度、时间范围导出有实现。
- 文本 rotation 前端有预览，导出还没完全实现。

### 48.12 第八步：处理音频

每个音频片段生成一条音频流：

```text
[input:a]
aformat=...,
atrim=duration=sourceDurationSec,
asetpts=PTS-STARTPTS,
atempo=...,
afade=...,
volume=...
[aclip0]
```

然后根据 `clip.start` 补前置静音：

```text
anullsrc...,atrim=duration=startSec[pre]
[pre][aclip0][tail]concat=n=3:v=0:a=1[a0]
```

所有音频流对齐后：

```text
[a0][a1][a2]amix=inputs=3:duration=longest[amixraw]
[amixraw]volume=3,atrim=duration=durationSec[aout]
```

为什么要补静音？

因为 FFmpeg 的 amix 会从每条输入流的 0 秒开始混。如果不补静音，一个应该在第 10 秒出现的音频会从第 0 秒就开始响。

### 48.13 第九步：生成 map 和输出参数

最终 graph 返回：

```text
maps = ["[vtrimmed]", "[aout]"]
```

如果没有音频：

```text
maps = ["[vtrimmed]"]
output options 加 -an
```

输出参数包括：

```text
-r fps
-s widthxheight
-c:v libx264
-pix_fmt yuv420p
-preset medium/veryfast
-crf 18/23/28
-movflags +faststart
-t durationSec
-c:a aac
-b:a 192k/128k/96k
```

这些由导出质量档决定：

| quality | CRF | preset | 分辨率 | 音频码率 |
|---|---:|---|---|---|
| high | 18 | medium | 原分辨率 | 192k |
| medium | 23 | veryfast | 原分辨率 | 128k |
| low | 28 | veryfast | 0.5 倍 | 96k |

CRF 越小质量越高、文件越大。

### 48.14 一个简化例子

假设 Timeline 是：

```text
项目：1920x1080, 30fps
Track 0:
  Clip A: video1.mp4, start=0, duration=90, scale=1, x=0, y=0
Track 1:
  Clip B: video2.mp4, start=30, duration=60, scale=0.3, x=500, y=-300
Text Track:
  Text: "Hello", start=0, duration=90, y=350
```

业务含义：

- 0-3 秒主视频播放。
- 1-3 秒右上角出现小窗视频。
- 0-3 秒底部有文字 Hello。

后端会生成类似的 FFmpeg 思路：

```text
输入：
  input0 = video1.mp4, 取 3 秒
  input1 = video2.mp4, 取 2 秒

滤镜：
  创建黑色 base，3 秒
  input0 缩放为主视频，overlay 到 base，0-3 秒
  input1 缩放到 0.3，overlay 到上一步结果，1-3 秒，位置 = 居中 + x/y
  drawtext Hello，0-3 秒

输出：
  map 最终视频流
  libx264 编码成 mp4
```

真实命令会比这个复杂，因为要处理 label、PTS、format、音频等，但本质就是这个过程。

### 48.15 面试标准回答

如果面试官问：“前端预览的 timeline 数据是如何转换成 FFmpeg 命令的？”

你可以这样答：

```text
严格来说，前端预览不会直接转换成 FFmpeg 命令。前端和后端共享的是 Timeline JSON。前端用这份 Timeline 做 DOM 预览；导出时先把最新 Timeline 保存到数据库，然后后端 worker 读取它，在 render-graph.ts 里编译成 FFmpeg 的 inputs、filter_complex 和 map。

编译过程是：遍历 tracks 和 clips，按 assetId 找到素材 localPath；把帧时间转换成秒；视频和图片生成视觉输入，按 transform 生成 scale/rotate/opacity 滤镜，再根据 start/duration 用 setpts 和 overlay 放到全局时间轴；文本用 drawtext；音频用 atrim、atempo、afade、volume，补静音后 amix；转场用 xfade；最后 render-runner.ts 设置编码参数，用 fluent-ffmpeg 执行输出 mp4。

所以项目保证一致性的关键是 Timeline 作为共同协议，而不是从前端 DOM 反推 FFmpeg。
```

### 48.16 如果面试官继续追问“能否打印出最终 FFmpeg 命令”

当前代码没有显式把完整 FFmpeg 命令字符串写进文档或接口返回，但 fluent-ffmpeg 支持监听 `start` 事件拿到命令行：

```ts
cmd.on('start', (commandLine) => {
  console.log('[RENDER] ffmpeg command:', commandLine);
});
```

可以把这段加到 `render-runner.ts` 的 fluent-ffmpeg 链上，用于调试。

生产上要注意：

- 命令可能很长。
- 路径里可能包含用户信息。
- 日志量会很大。
- 不要把敏感路径暴露给普通用户。

所以建议只在 debug 环境打印。
