import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { LlmError } from '@reel/llm';

/**
 * 全局异常过滤器：把 LlmError 映射成合适的 HTTP 响应。
 * 401/403 → 400（配置错误：API Key 无效）
 * 其他 → 502（上游服务错误）
 * 复用 BaseExceptionFilter 输出标准 Nest 错误体，无需依赖 express 类型。
 */
@Catch(LlmError)
export class LlmExceptionFilter extends BaseExceptionFilter {
  catch(exception: LlmError, host: ArgumentsHost) {
    const status =
      exception.status === 401 || exception.status === 403
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.BAD_GATEWAY;

    const message =
      status === HttpStatus.BAD_REQUEST
        ? `LLM API 配置错误：${exception.message}`
        : `LLM 服务调用失败：${exception.message}`;

    // 交给 BaseExceptionFilter 统一输出标准错误体。
    super.catch(new HttpException(message, status), host);
  }
}
