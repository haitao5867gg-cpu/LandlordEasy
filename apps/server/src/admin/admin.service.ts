import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

/** 系统设置(第一版用文件存储,后续可迁移到数据库表) */
export interface SystemSettings {
  reminderPreDays: number;
  reminderOverdueInterval: number;
  qrcodeImageUrl: string;
}

const SETTINGS_FILE = path.join(process.cwd(), 'data/settings.json');
const UPLOAD_DIR = path.join(process.cwd(), 'data/uploads');

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // === 白名单管理 ===

  async getLandlords() {
    return this.prisma.landlord.findMany({ orderBy: { id: 'asc' } });
  }

  async addLandlord(openid: string, name: string) {
    const existing = await this.prisma.landlord.findUnique({ where: { openid } });
    if (existing) throw new BadRequestException('该 openid 已存在');

    return this.prisma.landlord.create({ data: { openid, name, isActive: true } });
  }

  async updateLandlord(id: number, data: { name?: string; isActive?: boolean }) {
    const landlord = await this.prisma.landlord.findUnique({ where: { id } });
    if (!landlord) throw new NotFoundException('房东不存在');

    return this.prisma.landlord.update({ where: { id }, data });
  }

  async removeLandlord(id: number, currentUserId: number) {
    if (id === currentUserId) {
      throw new BadRequestException('不能移除自己');
    }
    const landlord = await this.prisma.landlord.findUnique({ where: { id } });
    if (!landlord) throw new NotFoundException('房东不存在');

    // 软删除:设为 inactive
    return this.prisma.landlord.update({ where: { id }, data: { isActive: false } });
  }

  // === 系统设置 ===

  getSettings(): SystemSettings {
    return this.loadSettings();
  }

  updateSettings(updates: Partial<SystemSettings>): SystemSettings {
    const settings = this.loadSettings();
    Object.assign(settings, updates);
    this.saveSettings(settings);
    return settings;
  }

  // === 收款码图片上传 ===

  uploadQrcode(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('请上传文件');

    // 确保上传目录存在
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const ext = path.extname(file.originalname) || '.png';
    const filename = `qrcode_${Date.now()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, file.buffer);

    // 更新设置中的收款码 URL
    const url = `/uploads/${filename}`;
    this.updateSettings({ qrcodeImageUrl: url });

    return { url, filename };
  }

  private loadSettings(): SystemSettings {
    const defaults: SystemSettings = {
      reminderPreDays: 3,
      reminderOverdueInterval: 3,
      qrcodeImageUrl: '',
    };

    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        return { ...defaults, ...data };
      }
    } catch {
      // 文件损坏,返回默认值
    }
    return defaults;
  }

  private saveSettings(settings: SystemSettings) {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
