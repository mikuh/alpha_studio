import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ReportBrandingSettings } from './ReportBrandingSettings';
import { loadReportBranding, readReportLogo, saveReportBranding } from './reportBranding';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('report branding settings', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('previews, saves, reloads and resets customer branding', async () => {
    const user = userEvent.setup();
    const view = render(<ReportBrandingSettings />);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存品牌设置' })).toBeEnabled());
    expect(screen.getByRole('img', { name: '元流涌现 Logo' })).toHaveAttribute('src', '/neostream-logo.png');
    await user.type(screen.getByLabelText('客户名称'), '  客户研究  ');
    expect(screen.getByRole('img', { name: '客户研究 Logo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存品牌设置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已保存');
    view.unmount();
    render(<ReportBrandingSettings />);
    await waitFor(() => expect(screen.getByLabelText('客户名称')).toHaveValue('客户研究'));
    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    await user.click(screen.getByRole('button', { name: '保存品牌设置' }));
    expect(await loadReportBranding()).toEqual({ name: '', logoDataUrl: null });
  });

  it('retains the customer name when a custom logo is removed', async () => {
    await saveReportBranding({ name: '客户研究', logoDataUrl: 'data:image/png;base64,dGVzdA==' });
    const user = userEvent.setup();
    render(<ReportBrandingSettings />);
    await user.click(await screen.findByRole('button', { name: '移除 Logo' }));
    expect(screen.getByRole('img', { name: '客户研究 Logo' })).toHaveAttribute('src', '/neostream-logo.png');
    await user.click(screen.getByRole('button', { name: '保存品牌设置' }));
    expect(await loadReportBranding()).toEqual({ name: '客户研究', logoDataUrl: null });
  });

  it('rejects unsupported or oversized logo files without losing the saved settings', async () => {
    await expect(readReportLogo(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG');
    await expect(readReportLogo(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).rejects.toThrow('2 MB');
    render(<ReportBrandingSettings />);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存品牌设置' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('选择客户 Logo'), { target: { files: [new File(['text'], 'logo.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG');
    expect(screen.getByRole('img', { name: '元流涌现 Logo' })).toBeInTheDocument();
  });

  it('uses native storage and surfaces a failed save without reporting success', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockResolvedValueOnce({ name: '客户研究', logoDataUrl: null });
    const user = userEvent.setup();
    render(<ReportBrandingSettings />);
    await waitFor(() => expect(screen.getByLabelText('客户名称')).toHaveValue('客户研究'));
    vi.mocked(invoke).mockRejectedValueOnce(new Error('磁盘不可写'));
    await user.click(screen.getByRole('button', { name: '保存品牌设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘不可写');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith('report_branding_save', { request: { name: '客户研究', logoDataUrl: null } });
  });
});
