import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { TRANSCRIPTION_MAX_BYTES, TranscriptionService } from './transcription.service';

@Controller('audio')
@UseGuards(AuthGuard)
export class TranscriptionController {
  constructor(private readonly transcription: TranscriptionService) {}

  @Post('transcriptions')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: TRANSCRIPTION_MAX_BYTES, files: 1, fields: 0 } }))
  transcribe(@UploadedFile() file?: Express.Multer.File) {
    return this.transcription.transcribe(file);
  }
}
