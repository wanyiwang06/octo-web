import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AgentChatPanel from '../AgentChatPanel';
import type { ChatMessage } from '../../types/summary';
import * as summaryApi from '../../api/summaryApi';
import { I18nContext } from '@octo/base';

// Mock dependencies
vi.mock('../../api/summaryApi', () => ({
    agentChatStream: vi.fn(),
    agentChat: vi.fn(),
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} {...rest}>
            {children}
        </button>
    ),
    Modal: ({ children, visible }: any) => (visible ? <div data-testid="modal">{children}</div> : null),
    Input: ({ value, onChange, ...rest }: any) => (
        <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    ),
    Toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
    },
}));

const mockT = (key: string) => key;

describe('AgentChatPanel SSE Mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle disconnect and fallback to agentChat', async () => {
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();
        const onSend = vi.fn();

        // Mock agentChatStream to return immediately and call onError
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            // Call onError immediately (simulating immediate failure)
            setImmediate(() => {
                handlers.onError({ code: 500, message: 'Connection lost' });
            });
            return { close: vi.fn() };
        });

        // Mock agentChat fallback
        (summaryApi.agentChat as any).mockResolvedValue({
            reply: 'Fallback reply',
            session_id: 'test-session',
        });

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={onSend}
                    sending={false}
                    useStream={true}
                    sessionId="test-session"
                    profile="summary"
                    onUserMessage={onUserMessage}
                    onAssistantMessage={onAssistantMessage}
                />
            </I18nContext.Provider>,
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Type and send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for user message callback
        await waitFor(() => expect(onUserMessage).toHaveBeenCalledWith('test message', expect.any(String)), { timeout: 2000 });

        // Wait for error handling and fallback
        await waitFor(() => expect(summaryApi.agentChat).toHaveBeenCalled(), { timeout: 2000 });

        // Verify agentChat was called with correct params
        expect(summaryApi.agentChat).toHaveBeenCalledWith({
            session_id: 'test-session',
            message: 'test message',
            profile: 'summary',
        });

        // Wait for assistant message callback
        await waitFor(() => expect(onAssistantMessage).toHaveBeenCalledWith('Fallback reply'), { timeout: 2000 });

        // Verify onSend was NOT called (SSE branch should not use onSend)
        expect(onSend).not.toHaveBeenCalled();
    });

    it('should handle successful SSE stream completion', async () => {
        let savedHandlers: any = null;
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            // Verify request parameters have correct field names
            expect(params).toEqual(
                expect.objectContaining({
                    session_id: 'test-session',
                    message: 'test message',
                    profile: 'summary',
                })
            );
            return { close: vi.fn() };
        });

        let messages: ChatMessage[] = [];
        const TestWrapper = () => {
            const [msgs, setMsgs] = React.useState<ChatMessage[]>(messages);

            return (
                <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                    <AgentChatPanel
                        messages={msgs}
                        onSend={vi.fn()}
                        sending={false}
                        useStream={true}
                        sessionId="test-session"
                        profile="summary"
                        onUserMessage={(text) => {
                            const newMsgs = [...msgs, { role: 'user' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                        onAssistantMessage={(text) => {
                            onAssistantMessage(text);
                            const newMsgs = [...msgs, { role: 'assistant' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                    />
                </I18nContext.Provider>
            );
        };

        const { container } = render(<TestWrapper />);

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Simulate progress
        act(() => {
            savedHandlers.onProgress({ phase: 'explore', step: 1, detail: 'searching' });
        });

        // Verify process panel is expanded during streaming
        await waitFor(() => {
            const panel = container.querySelector('.agent-chat-process-panel');
            expect(panel).not.toBeNull();
            expect(panel).not.toHaveClass('agent-chat-process-panel--collapsed');
        }, { timeout: 1000 });

        // Trigger onDone with correct field name (reply, not final_answer)
        act(() => {
            savedHandlers.onDone({ reply: 'Success response', session_id: 'test-session' });
        });

        // Verify onAssistantMessage was called with the reply
        await waitFor(() => {
            expect(onAssistantMessage).toHaveBeenCalledWith('Success response');
        }, { timeout: 1000 });
        // Verify panel is collapsed after completion
        await waitFor(() => {
            const panel = container.querySelector('.agent-chat-process-panel');
            expect(panel).not.toBeNull();
            if (panel) {
                expect(panel.classList.contains('agent-chat-process-panel--collapsed')).toBe(true);
            }
        }, { timeout: 2000 });
    });

    it('should pass session_id from onDone event to onAssistantMessage callback', async () => {
        let savedHandlers: any = null;
        const onAssistantMessage = vi.fn();

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            return { close: vi.fn() };
        });

        let messages: ChatMessage[] = [{ role: 'user' as const, content: 'test' }];

        render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={messages}
                    onSend={vi.fn()}
                    sending={false}
                    useStream={true}
                    sessionId="client-session-abc"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={onAssistantMessage}
                />
            </I18nContext.Provider>
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test question' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Backend returns different session_id in done event
        act(() => {
            savedHandlers.onDone({
                reply: 'Server response',
                session_id: 'server-session-xyz',
            });
        });

        // Verify panel passes BOTH text and session_id to the callback
        // (Parent component is responsible for persisting and updating state)
        await waitFor(() => {
            expect(onAssistantMessage).toHaveBeenCalledWith('Server response', 'server-session-xyz');
        }, { timeout: 1000 });
    });

    it('should cleanup stream on unmount', async () => {
        const closeFn = vi.fn();

        // Mock agentChatStream
        (summaryApi.agentChatStream as any).mockImplementation(() => {
            return { close: closeFn };
        });

        const { unmount } = render(
            <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                <AgentChatPanel
                    messages={[]}
                    onSend={vi.fn()}
                    sending={false}
                    useStream={true}
                    sessionId="test-session"
                    profile="summary"
                    onUserMessage={vi.fn()}
                    onAssistantMessage={vi.fn()}
                />
            </I18nContext.Provider>,
        );

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message to start stream
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to start
        await waitFor(() => expect(summaryApi.agentChatStream).toHaveBeenCalled(), { timeout: 1000 });

        // Unmount component
        unmount();

        // Verify close was called
        expect(closeFn).toHaveBeenCalled();
    });

    it('should add aria-live to process timeline', async () => {
        let savedHandlers: any = null;
        let messages: ChatMessage[] = [];

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            return { close: vi.fn() };
        });

        const TestWrapper = () => {
            const [msgs, setMsgs] = React.useState<ChatMessage[]>(messages);

            return (
                <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                    <AgentChatPanel
                        messages={msgs}
                        onSend={vi.fn()}
                        sending={false}
                        useStream={true}
                        sessionId="test-session"
                        profile="summary"
                        onUserMessage={(text) => {
                            const newMsgs = [...msgs, { role: 'user' as const, content: text }];
                            setMsgs(newMsgs);
                            messages = newMsgs;
                        }}
                        onAssistantMessage={vi.fn()}
                    />
                </I18nContext.Provider>
            );
        };

        const { container } = render(<TestWrapper />);

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message
        fireEvent.change(textarea, { target: { value: 'test message' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Trigger progress event to make panel appear
        act(() => {
            savedHandlers.onProgress({ phase: 'explore', step: 1, detail: 'test progress' });
        });

        // Wait for timeline to appear and check aria-live
        await waitFor(() => {
            const timeline = container.querySelector('.agent-chat-process-timeline');
            expect(timeline).not.toBeNull();
            expect(timeline).toHaveAttribute('aria-live', 'polite');
        }, { timeout: 2000 });
    });

    it('should allow first send with empty sessionId and pass it to backend', async () => {
        const onUserMessage = vi.fn();
        const onAssistantMessage = vi.fn();
        
        // Unmock agentChatStream temporarily so it uses real fetch
        const originalAgentChatStream = await vi.importActual<typeof summaryApi>('../../api/summaryApi');
        vi.mocked(summaryApi.agentChatStream).mockImplementation(originalAgentChatStream.agentChatStream);
        
        // Mock fetch to capture the actual HTTP request body
        const originalFetch = global.fetch;
        const fetchMock = vi.fn().mockImplementation(() => {
            // Return a mock ReadableStream for SSE
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('event: done\n'));
                    controller.enqueue(encoder.encode('data: {"reply":"Backend response","session_id":"new-session-123"}\n\n'));
                    controller.close();
                },
            });
            
            return Promise.resolve({
                ok: true,
                body: stream,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
            });
        });
        global.fetch = fetchMock as any;
        
        try {
            const { container } = render(
                <I18nContext.Provider value={{ t: mockT, locale: 'zh_CN' }}>
                    <AgentChatPanel
                        useStream={true}
                        sessionId=""
                        profile="summary"
                        onUserMessage={onUserMessage}
                        messages={[]}
                        onAssistantMessage={onAssistantMessage}
                        onSend={vi.fn()}
                    />
                </I18nContext.Provider>
            );
            
            const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
            const sendButton = screen.getByText('summary.create.send');
            
            // Type and send first message with empty sessionId
            await act(async () => {
                fireEvent.change(textarea, { target: { value: 'First message' } });
            });
            
            await act(async () => {
                fireEvent.click(sendButton);
            });
            
            // Wait for fetch to be called and verify the request body
            await waitFor(() => {
                expect(fetchMock).toHaveBeenCalledTimes(1);
            }, { timeout: 1000 });
            
            // Parse the request body and verify sessionId is NOT empty
            const fetchCall = fetchMock.mock.calls[0];
            const requestInit = fetchCall[1] as RequestInit;
            const body = JSON.parse(requestInit.body as string);
            
            // Critical assertion: sessionId must NOT be empty string
            expect(body.session_id).not.toBe('');
            expect(body.session_id).toBeTruthy();
            expect(body.session_id).toMatch(/./);  // At least 1 character
            expect(body.message).toBe('First message');
            expect(body.profile).toBe('summary');
            
            // Verify onUserMessage was called with non-empty sessionId
            expect(onUserMessage).toHaveBeenCalledWith('First message', expect.stringMatching(/./));
            expect(onUserMessage.mock.calls[0][1]).not.toBe('');
            
            // Wait for onAssistantMessage to be called
            await waitFor(() => {
                expect(onAssistantMessage).toHaveBeenCalledWith('Backend response', 'new-session-123');
            }, { timeout: 1000 });
        } finally {
            // Restore original fetch
            global.fetch = originalFetch;
            // Restore mock
            vi.mocked(summaryApi.agentChatStream).mockReset();
        }
    });
});
