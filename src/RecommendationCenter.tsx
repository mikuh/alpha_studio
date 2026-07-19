import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ExternalLink, Search } from 'lucide-react';
import {
  AI_RISK_LABELS,
  DAILY_DECISION_CHANGED_EVENT,
  OPEN_DAILY_DECISION_EVENT,
  RECOMMENDATION_ACTION_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  currentRiskAssessment,
  loadDailyDecisionState,
  type DailyDecisionState,
  type RecommendationStatus,
} from './dailyDecision';
import { useChatStore } from './store';

type StatusFilter = 'all' | RecommendationStatus;

const STATUS_LABELS: Record<RecommendationStatus, string> = {
  draft: '草稿',
  risk_stale: '待风险复核',
  risk_ready: '待确认',
  confirmed: '待人工处理',
  deferred: '暂缓',
  rejected: '否决',
  source_outdated: '来源已更新',
};

const FILTERS: StatusFilter[] = ['all', 'draft', 'risk_stale', 'risk_ready', 'confirmed', 'deferred', 'rejected', 'source_outdated'];

export function RecommendationCenter() {
  const conversations = useChatStore((state) => state.conversations);
  const [state, setState] = useState<DailyDecisionState>(() => loadDailyDecisionState());
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const sync = () => setState(loadDailyDecisionState());
    window.addEventListener(DAILY_DECISION_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DAILY_DECISION_CHANGED_EVENT, sync);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const recommendations = useMemo(() => state.recommendations
    .filter((item) => filter === 'all' || item.status === filter)
    .filter((item) => !normalizedQuery || [
      item.themeName,
      ...item.stockNames,
      ...item.stockCodes,
      RECOMMENDATION_ACTION_LABELS[item.action],
      RECOMMENDATION_PRIORITY_LABELS[item.priority],
      item.createdAt.slice(0, 10),
    ].join(' ').toLowerCase().includes(normalizedQuery))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [filter, normalizedQuery, state.recommendations]);

  return (
    <section className="recommendation-center" aria-label="研究建议清单">
      <header className="recommendation-center-head">
        <div>
          <h3>研究建议</h3>
          <p>本地研究记录 · 不会提交真实订单</p>
        </div>
        <span>{recommendations.length} 条</span>
      </header>
      <div className="recommendation-filters">
        <label>
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="日期、主题、标的、动作或优先级" />
        </label>
        <div className="recommendation-filter-chips">
          {FILTERS.map((status) => {
            const count = status === 'all'
              ? state.recommendations.length
              : state.recommendations.filter((item) => item.status === status).length;
            return (
              <button key={status} type="button" className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>
                {status === 'all' ? '全部' : STATUS_LABELS[status]}<em>{count}</em>
              </button>
            );
          })}
        </div>
      </div>
      <div className="recommendation-center-list">
        {recommendations.length === 0 ? (
          <div className="recommendation-center-empty">暂无符合条件的研究建议。</div>
        ) : recommendations.map((recommendation) => {
          const risk = currentRiskAssessment(state, recommendation);
          const source = conversations.find((conversation) => conversation.id === recommendation.conversationId);
          const sourceAvailable = Boolean(source && !source.archivedAt);
          return (
            <article key={recommendation.id} className={`recommendation-center-card status-${recommendation.status}`}>
              <div className="recommendation-center-card-head">
                <div>
                  <strong>{recommendation.themeName}</strong>
                  <span>{recommendation.stockNames.join('、') || '主题级建议'}</span>
                </div>
                <b>{STATUS_LABELS[recommendation.status]}</b>
              </div>
              <div className="recommendation-center-meta">
                <span>{RECOMMENDATION_ACTION_LABELS[recommendation.action]}</span>
                <span>{RECOMMENDATION_PRIORITY_LABELS[recommendation.priority]}优先级</span>
                <span>v{recommendation.version}</span>
                <time>{new Date(recommendation.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time>
              </div>
              <p>{recommendation.thesis.join('；') || '尚未填写核心依据。'}</p>
              {risk && <div className="recommendation-center-risk"><AlertTriangle size={13} />AI风险评估：{AI_RISK_LABELS[risk.conclusion]} · {risk.summary}</div>}
              {recommendation.reviewAt && <div className="recommendation-center-review"><CalendarClock size={13} />复核时间：{recommendation.reviewAt}</div>}
              <footer>
                <span>{sourceAvailable ? source?.title : '来源对话不可用'}</span>
                <button
                  type="button"
                  disabled={!sourceAvailable}
                  onClick={() => window.dispatchEvent(new CustomEvent(OPEN_DAILY_DECISION_EVENT, { detail: { conversationId: recommendation.conversationId } }))}
                >
                  <ExternalLink size={13} />打开来源日报
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
