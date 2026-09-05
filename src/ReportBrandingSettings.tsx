import { useEffect, useRef, useState } from 'react';
import { DEFAULT_REPORT_LOGO, DEFAULT_REPORT_NAME, loadReportBranding, readReportLogo, saveReportBranding, type ReportBranding } from './reportBranding';
import './reportBranding.css';

export function ReportBrandingSettings() {
  const [draft, setDraft] = useState<ReportBranding>({ name: '', logoDataUrl: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadReportBranding().then((value) => { if (!cancelled) setDraft(value); })
      .catch((reason) => { if (!cancelled) { setError(String(reason)); setLoadFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const logoDataUrl = await readReportLogo(file);
      setDraft((value) => ({ ...value, logoDataUrl }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setDraft(await saveReportBranding(draft));
      setNotice('已保存，后续生成的报告将使用此品牌。');
    } catch (reason) { setError(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  }

  const name = draft.name.trim() || DEFAULT_REPORT_NAME;
  const disabled = loading || busy || loadFailed;
  return (
    <div className="report-branding-settings">
      <p className="report-branding-description">设置报告封面、署名和页脚使用的客户品牌。名称或 Logo 留空时，对应部分使用元流涌现默认值。</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={disabled}>
          <label className="report-branding-field" htmlFor="report-brand-name">客户名称
            <input id="report-brand-name" className="settings-input" maxLength={60} value={draft.name} placeholder={DEFAULT_REPORT_NAME}
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setNotice(''); }} />
          </label>
          <div className="report-branding-field">
            <span>客户 Logo</span>
            <div className="report-branding-actions">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择客户 Logo" hidden
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
              <button type="button" className="settings-btn" onClick={() => fileInput.current?.click()}>上传 Logo</button>
              {draft.logoDataUrl && <button type="button" className="settings-btn" onClick={() => { setDraft({ ...draft, logoDataUrl: null }); setNotice(''); }}>移除 Logo</button>}
              <span className="report-branding-hint">PNG、JPG、WebP，最大 2 MB</span>
            </div>
          </div>
          <div className="report-branding-preview" aria-label="报告品牌预览">
            <span className="report-branding-hint">报告品牌预览</span>
            <div className="report-branding-lockup"><img src={draft.logoDataUrl || DEFAULT_REPORT_LOGO} alt={`${name} Logo`} /><strong>{name}</strong></div>
            <div className="report-branding-preview-title">每日主题研究报告</div>
            <span className="report-branding-hint">{name} · 主题策略与市场研究</span>
          </div>
          <div className="report-branding-actions">
            <button type="submit" className="settings-btn primary">{loading ? '正在加载…' : busy ? '正在处理…' : '保存品牌设置'}</button>
            <button type="button" className="settings-btn" onClick={() => { setDraft({ name: '', logoDataUrl: null }); setNotice(''); }}>恢复默认</button>
          </div>
        </fieldset>
      </form>
      {error && <p className="settings-inline-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
