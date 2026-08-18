import { describe, it, expect } from 'vitest';
import {
    isPartialFinish,
    extractEnvelopeCode,
    isFinishFailedError,
    formatGapNotice,
    FINISH_FAILED_CODE,
} from '../summaryFinishNotice';

describe('summaryFinishNotice (WEB-02 v2 finish-status helpers)', () => {
    describe('isPartialFinish', () => {
        it('true only for PARTIAL', () => {
            expect(isPartialFinish({ finish_status: 'PARTIAL' })).toBe(true);
            expect(isPartialFinish({ finish_status: 'COMPLETE' })).toBe(false);
            expect(isPartialFinish({})).toBe(false);
            expect(isPartialFinish(null)).toBe(false);
            expect(isPartialFinish(undefined)).toBe(false);
        });
    });

    describe('extractEnvelopeCode / isFinishFailedError', () => {
        it('reads err.response.data.code from an axios error', () => {
            const err = { response: { data: { code: 42200 } } };
            expect(extractEnvelopeCode(err)).toBe(42200);
            expect(isFinishFailedError(err)).toBe(true);
        });
        it('42200 constant matches the backend FAILED code', () => {
            expect(FINISH_FAILED_CODE).toBe(42200);
        });
        it('undefined for non-axios / missing code', () => {
            expect(extractEnvelopeCode(new Error('net'))).toBeUndefined();
            expect(extractEnvelopeCode({})).toBeUndefined();
            expect(extractEnvelopeCode({ response: { data: {} } })).toBeUndefined();
            expect(isFinishFailedError(new Error('net'))).toBe(false);
            expect(isFinishFailedError({ response: { data: { code: 40004 } } })).toBe(false);
        });
    });

    describe('formatGapNotice', () => {
        it('appends gap details after the prefix', () => {
            const gaps = [
                { kind: 'coverage', detail: '频道 X 未覆盖' },
                { kind: 'tool_error', detail: '抓取超时', error_code: 'TIMEOUT' },
            ];
            expect(formatGapNotice(gaps, '部分完成')).toBe('部分完成：频道 X 未覆盖；抓取超时');
        });
        it('returns just the prefix when there are no gaps', () => {
            expect(formatGapNotice([], '部分完成')).toBe('部分完成');
            expect(formatGapNotice(undefined, '部分完成')).toBe('部分完成');
        });
        it('skips gaps with empty detail', () => {
            expect(formatGapNotice([{ kind: 'x', detail: '' }], 'p')).toBe('p');
        });
    });
});
