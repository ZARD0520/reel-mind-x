import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse()
      .status(400)
      .json({
        statusCode: 400,
        message: error.issues.map((issue) => issue.message),
        error: 'Bad Request',
      });
  }
}
