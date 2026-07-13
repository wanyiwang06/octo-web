import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agentChatStream } from '../summaryApi';

// Mock WKApp
global.WKApp = {
    loginInfo: { token: 'test-token' },
    shared: { currentSpaceId: 'test-space' },
} as any;

describe('agentChatStream', () => {
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should parse SSE frames split across multiple chunks', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        // Simulate a frame split across two read() calls:
        // First chunk: "event: progress\n"
        // Second chunk: "data: {\"phase\":\"explore\",\"step\":1,\"detail\":\"test\"}\n\n"
        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('event: progress\n'),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('data: {"phase":"explore","step":1,"detail":"test"}\n\n'),
                })
                .mockResolvedValueOnce({
                    done: true,
                    value: undefined,
                }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                question: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
                onComplete: vi.fn(),
            },
        );

        // Wait for async processing
        await new Promise(resolve => setTimeout(resolve, 100));

        // The event should be parsed and dispatched
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith({
            phase: 'explore',
            step: 1,
            detail: 'test',
        });

        close();
    });

    it('should parse multiple SSE events in sequence', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        const sseData = `event: progress
data: {"phase":"explore","step":1,"detail":"searching"}

event: progress
data: {"phase":"fetch","step":2,"detail":"fetching data"}

event: done
data: {"final_answer":"test result"}

`;

        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode(sseData),
                })
                .mockResolvedValueOnce({
                    done: true,
                    value: undefined,
                }),
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                question: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
                onComplete: vi.fn(),
            },
        );

        // Wait for async processing
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenNthCalledWith(1, {
            phase: 'explore',
            step: 1,
            detail: 'searching',
        });
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            phase: 'fetch',
            step: 2,
            detail: 'fetching data',
        });

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith({
            final_answer: 'test result',
        });

        close();
    });

    it('should call onError when fetch fails', async () => {
        const onProgress = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        fetchMock.mockRejectedValueOnce(new Error('Network error'));

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                question: 'test question',
                profile: 'summary',
            },
            {
                onProgress,
                onDone,
                onError,
                onComplete: vi.fn(),
            },
        );

        // Wait for async processing
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({
            code: 50000,
            message: 'Network error',
        });

        expect(onProgress).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();

        close();
    });

    it('should cleanup reader when close() is called', async () => {
        const mockReader = {
            read: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
            cancel: vi.fn(),
            releaseLock: vi.fn(),
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader,
            },
        });

        const { close } = agentChatStream(
            {
                session_id: 'test-session',
                question: 'test question',
                profile: 'summary',
            },
            {
                onProgress: vi.fn(),
                onDone: vi.fn(),
                onError: vi.fn(),
                onComplete: vi.fn(),
            },
        );

        // Wait a bit for fetch to resolve and reader to be assigned
        await new Promise(resolve => setTimeout(resolve, 50));

        // Call close
        close();

        // Verify cancel was called
        expect(mockReader.cancel).toHaveBeenCalled();
    });
});
