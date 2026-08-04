import aiAndInvestmentRiskDisclosure from '../docs/legal/ai-and-investment-risk-disclosure.md?raw';
import privacyPolicy from '../docs/legal/privacy-policy.md?raw';
import softwareLicenseAndServiceAgreement from '../docs/legal/software-license-and-service-agreement.md?raw';
import thirdPartyModelDataNotice from '../docs/legal/third-party-model-data-notice.md?raw';

export type LegalDocumentId =
  | 'serviceTerms'
  | 'privacyPolicy'
  | 'thirdPartyModelNotice'
  | 'researchRiskDisclosure';

export interface LegalDocumentDefinition {
  id: LegalDocumentId;
  title: string;
  shortTitle: string;
  version: string;
  summary: string;
  content: string;
}

export interface ClientAgreementAcceptance {
  serviceTermsVersion: string;
  serviceTermsAccepted: boolean;
  privacyPolicyVersion: string;
  privacyPolicyAccepted: boolean;
  thirdPartyModelNoticeVersion: string;
  thirdPartyModelNoticeAccepted: boolean;
  researchRiskDisclosureVersion: string;
  researchRiskDisclosureAccepted: boolean;
}

export type LegalAcceptanceState = Record<LegalDocumentId, boolean>;

const LEGAL_VERSION = '2026-08-04';

export const LEGAL_DOCUMENTS: readonly LegalDocumentDefinition[] = [
  {
    id: 'serviceTerms',
    title: 'Alpha Studio 软件许可及用户服务协议',
    shortTitle: '软件许可及用户服务协议',
    version: LEGAL_VERSION,
    summary: '软件授权、一次性软件费、Token 计费、设备和账号使用规则。',
    content: softwareLicenseAndServiceAgreement,
  },
  {
    id: 'privacyPolicy',
    title: 'Alpha Studio 隐私政策',
    shortTitle: '隐私政策',
    version: LEGAL_VERSION,
    summary: '本地数据、授权与计费元数据，以及用户的数据权利。',
    content: privacyPolicy,
  },
  {
    id: 'thirdPartyModelNotice',
    title: '大模型服务方数据传输告知与同意',
    shortTitle: '大模型服务方数据传输告知',
    version: LEGAL_VERSION,
    summary: '仅在发起调用时，将必要会话内容发送给所选大模型服务方。',
    content: thirdPartyModelDataNotice,
  },
  {
    id: 'researchRiskDisclosure',
    title: 'AI 与投资研究风险揭示书',
    shortTitle: 'AI 与投资研究风险揭示书',
    version: LEGAL_VERSION,
    summary: 'AI、行情和研究结论可能错误，投资决定必须人工独立复核。',
    content: aiAndInvestmentRiskDisclosure,
  },
] as const;

export const EMPTY_LEGAL_ACCEPTANCE: LegalAcceptanceState = {
  serviceTerms: false,
  privacyPolicy: false,
  thirdPartyModelNotice: false,
  researchRiskDisclosure: false,
};

export function allLegalDocumentsAccepted(state: LegalAcceptanceState): boolean {
  return LEGAL_DOCUMENTS.every((document) => state[document.id]);
}

export function currentClientAgreementAcceptance(
  state: LegalAcceptanceState,
): ClientAgreementAcceptance {
  return {
    serviceTermsVersion: LEGAL_VERSION,
    serviceTermsAccepted: state.serviceTerms,
    privacyPolicyVersion: LEGAL_VERSION,
    privacyPolicyAccepted: state.privacyPolicy,
    thirdPartyModelNoticeVersion: LEGAL_VERSION,
    thirdPartyModelNoticeAccepted: state.thirdPartyModelNotice,
    researchRiskDisclosureVersion: LEGAL_VERSION,
    researchRiskDisclosureAccepted: state.researchRiskDisclosure,
  };
}
