import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, HardDrive, ShieldCheck, X } from 'lucide-react';

export const FIRST_USE_GUIDE_STORAGE_KEY = 'alpha:first-use-guide:2026-08';
export const OPEN_FIRST_USE_GUIDE_EVENT = 'alpha:open-first-use-guide';

const steps = [
  {
    title: '数据默认留在本机',
    body: '项目、持仓、研究资料和会话历史默认保存在本机。只有你发起模型调用时，必要的对话、附件和上下文才会发送给所选大模型服务方。',
    note: '发送前请移除不必要的个人信息、账户资料和商业秘密。',
  },
  {
    title: '先创建项目，再确认备份',
    body: '为项目选择本地工作目录后再开始研究。重要资料请同时纳入你自己的 Time Machine、企业备份或其他可靠备份方案。',
    note: '卸载应用不等于删除所有本地数据，处置设备前请自行清理。',
  },
  {
    title: '费用与投资风险',
    body: '系统不提供在线支付或退款，后台只记录已收到款项和模型用量。模型输出可能出错，也不会替你自动交易。',
    note: '涉及证券的结论必须由你独立核验和决策。',
  },
] as const;

export function FirstUseGuide({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => (
    typeof window !== 'undefined' && !window.localStorage.getItem(FIRST_USE_GUIDE_STORAGE_KEY)
  ));
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_FIRST_USE_GUIDE_EVENT, reopen);
    return () => window.removeEventListener(OPEN_FIRST_USE_GUIDE_EVENT, reopen);
  }, []);

  const finish = () => {
    window.localStorage.setItem(FIRST_USE_GUIDE_STORAGE_KEY, new Date().toISOString());
    setOpen(false);
  };

  return (
    <>
      {children}
      {open && (
        <div className="first-use-guide-backdrop" role="presentation">
          <section className="first-use-guide" role="dialog" aria-modal="true" aria-labelledby="first-use-guide-title">
            <button className="first-use-guide-close" type="button" aria-label="稍后查看" onClick={finish}><X size={17} /></button>
            <div className="first-use-guide-mark"><ShieldCheck size={24} /></div>
            <span className="first-use-guide-kicker">首次使用 · {step + 1}/{steps.length}</span>
            <h2 id="first-use-guide-title">{steps[step].title}</h2>
            <p>{steps[step].body}</p>
            <div className="first-use-guide-note"><HardDrive size={16} /><span>{steps[step].note}</span></div>
            <div className="first-use-guide-progress" aria-label={`第 ${step + 1} 步，共 ${steps.length} 步`}>
              {steps.map((item, index) => <span key={item.title} className={index <= step ? 'active' : ''} />)}
            </div>
            <div className="first-use-guide-actions">
              <button type="button" className="secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ChevronLeft size={15} />上一步</button>
              {step < steps.length - 1 ? (
                <button type="button" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>下一步<ChevronRight size={15} /></button>
              ) : (
                <button type="button" onClick={finish}><Check size={15} />开始使用</button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
