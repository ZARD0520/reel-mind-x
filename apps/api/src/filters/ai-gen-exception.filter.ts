import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { AiGenError } from '@reel/ai-gen';

/**
 * 全局异常过滤器：把 AiGenError 映射成合适的 HTTP 响应。
 * 401/403 → 400（配置错误：API Key 无效）
 * 其他 → 502（上游服务错误）
 */
@Catch(AiGenError)
export class AiGenExceptionFilter extends BaseExceptionFilter {
  catch(exception: AiGenError, host: ArgumentsHost) {
    const status =
      exception.status === 401 || exception.status === 403
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.BAD_GATEWAY;

    const message =
      status === HttpStatus.BAD_REQUEST
        ? `AI 生成配置错误：${exception.message}`
        : `AI 生成服务调用失败：${exception.message}`;

    super.catch(new HttpException(message, status), host);
  }
}
