# @reel/llm

LLM 提供商抽象层：统一接口调用不同大模型，业务代码不耦合具体厂商。

## 架构

```
@reel/llm
├── types.ts          # 抽象接口：LlmProvider、ChatMessage、ChatResult 等
├── providers/
│   └── glm.ts        # 智谱 GLM-4 实现
└── index.ts          # 统一导出
```

## 设计原则

- **单一抽象**：所有 provider 实现 `LlmProvider` 接口的 `chat()` 方法
- **配置注入**：provider 实例化时传入 `apiKey` / `baseUrl` / `model`，不读环境变量
- **统一错误**：所有上游错误包装为 `LlmError`，带 HTTP 状态码和原始错误

## 新增模型

在 `providers/` 新建 `xxx.ts`，实现 `LlmProvider`：

```typescript
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  constructor(config: LlmProviderConfig) { /* ... */ }
  async chat(messages, options) { /* 调用 OpenAI API */ }
}
```

然后在 `apps/api/src/modules/llm/llm.service.ts` 注册：

```typescript
this.providers.set('openai', new OpenAiProvider({ ... }));
```

业务侧无需改动，调用 `llmService.chat(messages, options, 'openai')` 即可。

## 当前支持

- **GLM-4**（智谱 AI）：`glm-4-flash`（默认）/ `glm-4-plus` / `glm-4-air`
  - API 文档：https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5
  - OpenAI-compatible `/chat/completions` 端点
  - 需要 API Key：https://open.bigmodel.cn/usercenter/apikeys

## 使用示例（Nest 注入）

```typescript
import { LlmService } from '../llm/llm.service';

@Injectable()
export class MyService {
  constructor(private readonly llm: LlmService) {}

  async generate() {
    const result = await this.llm.chat([
      { role: 'system', content: '你是文案助手' },
      { role: 'user', content: '帮我写一句广告语' },
    ], {
      temperature: 0.8,
      maxTokens: 100,
    });
    console.log(result.text, result.model, result.usage);
  }
}
```

## 编译产物

- 目标：CommonJS（`module: "CommonJS"`），供 NestJS（Node CJS 运行时）消费
- 入口：`dist/index.js`（`tsc` 从 `src/index.ts` 编译）
- 构建：`pnpm build`（执行 `tsc -p tsconfig.build.json`）
