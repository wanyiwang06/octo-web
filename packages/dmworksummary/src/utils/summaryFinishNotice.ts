import type { CoverageGap, CreateAgentSummaryResult } from '../types/summary';

/**
 * WEB-02 · v2 完成状态展示辅助(纯函数,便于单测)。
 * 契约见后端 SS-07/SS-11:保存成功响应带 finish_status(COMPLETE/PARTIAL)+ gaps;
 * FAILED 不会成功,而是 HTTP 422 / code 42200 由 axios 抛出。
 */

/** 完成校验未通过的后端 envelope code(HTTP 422)。FAILED 时保留对话、不清 session。 */
export const FINISH_FAILED_CODE = 42200;

/** 是否 PARTIAL:已保存但有覆盖缺口,应给用户警示 + 缺口披露。 */
export function isPartialFinish(
    result: Pick<CreateAgentSummaryResult, 'finish_status'> | null | undefined,
): boolean {
    return result?.finish_status === 'PARTIAL';
}

/**
 * 从任意 catch 到的错误里取后端 envelope code(axios 错误 err.response.data.code)。
 * 取不到返回 undefined(网络层/非信封错误)。
 */
export function extractEnvelopeCode(err: unknown): number | undefined {
    if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: { code?: number } } }).response;
        const code = resp?.data?.code;
        return typeof code === 'number' ? code : undefined;
    }
    return undefined;
}

/** 保存是否因 FAILED 完成校验被拒(应保留对话)。 */
export function isFinishFailedError(err: unknown): boolean {
    return extractEnvelopeCode(err) === FINISH_FAILED_CODE;
}

/**
 * 把 PARTIAL 的 gaps 汇成一句可读提示:`<prefix>：<detail1>；<detail2>`。
 * 无 gaps 时只返回 prefix。用于 PARTIAL 的 warning toast。
 */
export function formatGapNotice(gaps: CoverageGap[] | undefined, prefix: string): string {
    const details = (gaps ?? []).map((g) => g.detail).filter((d): d is string => !!d);
    return details.length > 0 ? `${prefix}：${details.join('；')}` : prefix;
}
