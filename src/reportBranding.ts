import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './codexBridge';

export const DEFAULT_REPORT_NAME = '元流涌现';
export const DEFAULT_REPORT_LOGO = '/neostream-logo.png';
export const REPORT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const STORAGE_KEY = 'alpha-studio.report-branding.v1';

export interface ReportBranding {
  name: string;
  logoDataUrl: string | null;
}

export async function loadReportBranding(): Promise<ReportBranding> {
  if (isTauriRuntime()) return invoke<ReportBranding>('report_branding_load');
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : { name: '', logoDataUrl: null };
}

export async function saveReportBranding(branding: ReportBranding): Promise<ReportBranding> {
  const normalized = { ...branding, name: branding.name.trim() };
  if (isTauriRuntime()) return invoke<ReportBranding>('report_branding_save', { request: normalized });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readReportLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error('请选择 PNG、JPG 或 WebP 图片。'));
  }
  if (!file.size || file.size > REPORT_LOGO_MAX_BYTES) {
    return Promise.reject(new Error('Logo 大小需在 2 MB 以内，且不能为空。'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取 Logo 失败，请重新选择。'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onerror = () => reject(new Error('图片无法打开，请选择有效的 Logo 图片。'));
      image.onload = () => resolve(dataUrl);
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
