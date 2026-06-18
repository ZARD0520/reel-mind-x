# NestJS 规则

## 模块化
- 一个 feature 一个 module（controller + service + dto）。
- 业务逻辑放 service，controller 保持薄（只做参数接收和响应）。

## 校验
- 入参用 **Zod**（`nestjs-zod`）做 DTO 校验，复用 `packages/contracts` 的 schema。
- 全局启用 `ValidationPipe`。

## 配置
- 所有环境变量走 `ConfigService`，并用 Zod 校验启动配置。
- **禁止直接读 `process.env`**。

## 错误处理
- 用早返回 / 卫语句处理边界条件，避免深层嵌套。
- 统一异常过滤器；禁止裸 `throw new Error(...)`，用 Nest 的 `HttpException` 体系或自定义异常。
