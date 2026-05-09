import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { GoogleAuthGuard } from '../auth/google-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { CvsService } from './cvs.service';

@ApiTags('cvs')
@ApiBearerAuth()
@UseGuards(GoogleAuthGuard)
@Controller('cvs')
export class CvsController {
  constructor(private readonly cvs: CvsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded under field "file"');
    return this.cvs.uploadCv({
      userId: user.id,
      filename: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
    });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.cvs.listForUser(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cvs.getWithDownloadUrl(id, user.id);
  }
}
