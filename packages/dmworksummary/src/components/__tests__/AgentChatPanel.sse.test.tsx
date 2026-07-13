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
        await waitFor(() => expect(onUserMessage).toHaveBeenCalledWith('test message'), { timeout: 2000 });

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

    it('should update sessionId when backend returns different session_id', async () => {
        let savedHandlers: any = null;
        const onAssistantMessage = vi.fn();
        const mockWriteSession = vi.fn();

        // Mock writeAgentChatSession
        vi.mock('../../utils/agentChatSession', () => ({
            writeAgentChatSession: mockWriteSession,
            readAgentChatSession: vi.fn(),
            genSessionId: () => 'client-generated-id',
        }));

        // Mock agentChatStream to capture handlers
        (summaryApi.agentChatStream as any).mockImplementation((params: any, handlers: any) => {
            savedHandlers = handlers;
            return { close: vi.fn() };
        });

        let messages: ChatMessage[] = [{ role: 'user' as const, content: 'test' }];
        let currentSessionId = 'client-session-abc';

        const TestWrapper = () => {
            const [sessionId, setSessionId] = React.useState(currentSessionId);

            return (
                <I18nContext.Provider value={{ t: mockT, locale: 'zh-CN' }}>
                    <AgentChatPanel
                        messages={messages}
                        onSend={vi.fn()}
                        sending={false}
                        useStream={true}
                        sessionId={sessionId}
                        profile="summary"
                        onUserMessage={vi.fn()}
                        onAssistantMessage={(text, newSessionId) => {
                            onAssistantMessage(text, newSessionId);
                            if (newSessionId && newSessionId !== sessionId) {
                                // Simulate parent component behavior
                                setSessionId(newSessionId);
                                currentSessionId = newSessionId;
                            }
                        }}
                    />
                </I18nContext.Provider>
            );
        };

        render(<TestWrapper />);

        const textarea = screen.getByPlaceholderText('summary.create.agentChatPlaceholder');
        const sendButton = screen.getByText('summary.create.send');

        // Send message with client-session-abc
        fireEvent.change(textarea, { target: { value: 'test question' } });
        fireEvent.click(sendButton);

        // Wait for stream to be set up
        await waitFor(() => expect(savedHandlers).not.toBeNull(), { timeout: 1000 });

        // Backend returns different session_id (server normalized/migrated)
        act(() => {
            savedHandlers.onDone({
                reply: 'Server response',
                session_id: 'server-session-xyz',  // ← Different from client's abc
            });
        });

        // Verify onAssistantMessage was called with BOTH text and new session_id
        await waitFor(() => {
            expect(onAssistantMessage).toHaveBeenCalledWith('Server response', 'server-session-xyz');
        }, { timeout: 1000 });

        // Verify the new session_id would be used (parent should update state)
        expect(currentSessionId).toBe('server-session-xyz');
    });

    it('should toggle process panel expand/collapse when progress events arrive', async () => {
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

        // Trigger progress event
        act(() => {
            savedHandlers.onProgress({ phase: 'explore', step: 1, detail: 'test progress' });
        });

        // Wait for progress panel to appear
        let panel: Element | null = null;
        await waitFor(() => {
            panel = container.querySelector('.agent-chat-process-panel');
            expect(panel).not.toBeNull();
        }, { timeout: 2000 });

        // Panel should be expanded by default
        expect(panel).not.toHaveClass('agent-chat-process-panel--collapsed');

        // Find and click the toggle button
        const toggleButton = panel?.querySelector('.agent-chat-process-toggle');
        expect(toggleButton).not.toBeNull();

        // Click to collapse
        act(() => {
            fireEvent.click(toggleButton!);
        });

        expect(panel).toHaveClass('agent-chat-process-panel--collapsed');

        // Click again to expand
        act(() => {
            fireEvent.click(toggleButton!);
        });

        expect(panel).not.toHaveClass('agent-chat-process-panel--collapsed');
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
});
