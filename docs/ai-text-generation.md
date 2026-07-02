# AI 文案生成使用指南

剪辑页集成了 AI 文案生成功能，基于智谱 GLM-4 实现，限制 100 字。

## 功能位置

**左侧面板 → 文本 tab → "AI 生成文案" 按钮**（在"添加文本"按钮上方）

## 交互流程

1. 点击「AI 生成文案」打开聊天式弹窗
2. 在输入框描述需求（如："给一款主打续航的手机写卖点文案"）
3. 点击「生成」按钮，AI 回复一条文案（100 字以内）
4. 每条 AI 回复下方有「用这条」按钮，点击后：
   - **如果当前选中了文本片段**：覆盖该片段的文字内容
   - **如果没有选中任何文本片段**：自动创建新文本片段（放在文本轨末尾）
5. 可以多轮对话：继续输入调整要求（如"再短一点"、"更活泼"），AI 会基于你的新需求生成新文案

## 本地开发测试

1. **后端环境变量**：在 `apps/api/.env` 填入真实的智谱 API Key
   ```bash
   GLM_API_KEY=your-actual-api-key-from-bigmodel.cn
   GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
   GLM_MODEL=glm-4-flash
   ```
   获取 Key：https://open.bigmodel.cn/usercenter/apikeys

2. **启动服务**：
   ```bash
   # 启动 PostgreSQL (5433) + Redis (6380)
   # 然后启动后端和前端
   cd apps/api && pnpm dev    # 后端 http://localhost:3888
   cd apps/web && pnpm dev    # 前端 http://localhost:5173
   ```

3. **测试路径**：
   - 进入任意项目编辑页
   - 左侧面板切到「文本」tab
   - 点击「AI 生成文案」
   - 输入："给一款主打续航的手机写卖点文案"
   - 点击生成，等待 AI 回复
   - 点击「用这条」应用到时间轴

## 提示词建议

- **卖点文案**："给一款{产品特点}的{产品}写卖点文案"
- **调整风格**："再短一点"、"用更口语化的表达"、"更有冲击力"
- **场景化**："给一条健身 Vlog 写开头引导文案"

## 技术实现

- 后端：`POST /api/text-gen/generate` → `apps/api/src/modules/text-gen`
- LLM 抽象层：`packages/llm` (支持扩展其他模型)
- 前端组件：`apps/web/src/features/editor/components/TextGenDialog.tsx`
- 集成位置：`apps/web/src/features/editor/components/LeftPanel.tsx`

详见 `DECISIONS.md` D47/D48。
