# BullMQ + Redis 规则

## 命名
- 队列名和任务名集中定义：`enum QueueNames` + `const JobNames`。
- **禁止魔法字符串**，所有 `add()` / `@Processor()` 引用枚举常量。

## 结构
- 一个 concern 一个队列（如 `email`、`media-processing`、`notifications`），便于隔离与调试。
- 连接用 `BullModule.forRootAsync` + `ConfigService` 注入 Redis 配置，不写死。

## 可靠性
- 默认配置 `attempts` + 指数退避 `backoff`。
- 超出重试的任务进 **DLQ（死信队列）**，队列名约定 `<name>-dlq`。

## 资源
- 每个 job 必配 `removeOnComplete` / `removeOnFail`，防止 Redis 膨胀。
- 持有 worker/queue 的地方在 `onModuleDestroy` 优雅关闭，让在途任务跑完，不 SIGKILL。

## 数据分层
- Redis 只放瞬态队列数据；持久数据一律进 PostgreSQL。
- 注意：独立进程的 processor 拿不到 Nest DI 容器，依赖需在 processor 内自行获取。
