import React, { Component, createRef } from 'react';
import { Button, Modal, Input, Toast } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import type { ChatMessage, AgentProgressEvent, AgentDoneEvent, AgentErrorEvent } from '../types/summary';
import { agentChatStream, agentChat } from '../api/summaryApi';
import './AgentChatPanel.css';

interface AgentChatPanelProps {
    messages: ChatMessage[];
    onSend: (text: string) => void;
    sending: boolean;
    welcome?: string;
    onSaveAsSummary?: (title: string) => Promise<boolean>;
    savingSummary?: boolean;
    onNewSession?: () => void;
    useStream?: boolean;
    sessionId?: string;
    profile?: string;
    onAssistantMessage?: (text: string, sessionId?: string) => void;
    onUserMessage?: (text: string) => void;
}

interface ProgressStep {
    phase: string;
    step: number;
    detail: string;
    timestamp: number;
}

interface AgentChatPanelState {
    input: string;
    showSaveDialog: boolean;
    summaryTitle: string;
    isStreaming: boolean;
    progressSteps: ProgressStep[];
    processExpanded: boolean;
    streamStartTime: number;
}

export default class AgentChatPanel extends Component<AgentChatPanelProps, AgentChatPanelState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private listRef = createRef<HTMLDivElement>();
    private streamCloseHandle: (() => void) | null = null;

    state: AgentChatPanelState = { 
        input: '', 
        showSaveDialog: false,
        summaryTitle: '',
        isStreaming: false,
        progressSteps: [],
        processExpanded: true,
        streamStartTime: 0,
    };

    componentDidMount() {
        this.scrollToBottom();
    }

    componentDidUpdate(prev: AgentChatPanelProps, prevState: AgentChatPanelState) {
        if (
            prev.messages.length !== this.props.messages.length || 
            prev.sending !== this.props.sending ||
            prevState.isStreaming !== this.state.isStreaming ||
            prevState.progressSteps.length !== this.state.progressSteps.length
        ) {
            this.scrollToBottom();
        }
    }

    componentWillUnmount() {
        if (this.streamCloseHandle) {
            this.streamCloseHandle();
            this.streamCloseHandle = null;
        }
    }

    private scrollToBottom = () => {
        const el = this.listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    };

    private handleSend = () => {
        const text = this.state.input.trim();
        if (!text || this.props.sending || this.state.isStreaming) return;

        if (this.props.useStream) {
            this.startSSEStream(text);
        } else {
            this.props.onSend(text);
            this.setState({ input: '' });
        }
    };

    private startSSEStream = async (text: string) => {
        const { sessionId, profile, onUserMessage, onAssistantMessage } = this.props;
        if (!sessionId || !profile) {
            console.error('[AgentChatPanel] useStream=true but missing sessionId/profile');
            Toast.error('SSE 模式需要 sessionId 和 profile');
            return;
        }

        this.setState({
            input: '',
            isStreaming: true,
            progressSteps: [],
            processExpanded: true,
            streamStartTime: Date.now(),
        });

        // 先本地追加 user 消息(纯 UI,不发请求)
        onUserMessage?.(text);

        try {
            const { close } = agentChatStream({
                session_id: sessionId,
                message: text,
                profile,
            }, {
                onProgress: (evt: AgentProgressEvent) => {
                    this.setState(prev => ({
                        progressSteps: [
                            ...prev.progressSteps,
                            {
                                phase: evt.phase,
                                step: evt.step,
                                detail: evt.detail,
                                timestamp: Date.now(),
                            },
                        ],
                    }));
                },
                onDone: (evt: AgentDoneEvent) => {
                    const reply = evt.reply || '（无回复）';
                    onAssistantMessage?.(reply, evt.session_id);
                    this.setState({
                        isStreaming: false,
                        processExpanded: false,
                    });
                    this.streamCloseHandle = null;
                },
                onError: (evt: AgentErrorEvent) => {
                    const { t } = this.context;
                    Toast.error(`${t('summary.common.agentChat.error')}: ${evt.message}`);
                    this.fallbackToNormalChat(text, sessionId, profile);
                },
                onComplete: () => {
                    this.streamCloseHandle = null;
                },
            });

            this.streamCloseHandle = close;

        } catch (err: any) {
            const { t } = this.context;
            console.error('[AgentChatPanel] SSE stream failed:', err);
            Toast.warning(t('summary.common.agentChat.streamInterrupted'));
            this.fallbackToNormalChat(text, sessionId, profile);
        }
    };

    private fallbackToNormalChat = async (text: string, sessionId: string, profile: string) => {
        const { t } = this.context;
        const { onAssistantMessage } = this.props;
        try {
            const result = await agentChat({
                session_id: sessionId,
                message: text,
                profile,
            });
            const reply = result.reply || '（无回复）';
            onAssistantMessage?.(reply);
        } catch (err: any) {
            Toast.error(t('summary.common.createFailed'));
            console.error('[AgentChatPanel] Fallback agentChat failed:', err);
        } finally {
            this.setState({ isStreaming: false });
        }
    };

    private handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || (e as any).keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    };

    private hasAssistantOutput = (): boolean => {
        return this.props.messages.some(m => m.role === 'assistant');
    };

    private handleOpenSaveDialog = () => {
        const { t } = this.context;
        if (!this.hasAssistantOutput()) {
            Toast.warning(t('summary.create.noOutputToSave'));
            return;
        }
        this.setState({ showSaveDialog: true, summaryTitle: '' });
    };

    private handleSaveConfirm = async () => {
        const { t } = this.context;
        const title = this.state.summaryTitle.trim();
        if (!title) {
            Toast.warning(t('summary.create.titleRequired'));
            return;
        }
        if (!this.props.onSaveAsSummary) return;
        
        const success = await this.props.onSaveAsSummary(title);
        if (success) {
            this.setState({ showSaveDialog: false, summaryTitle: '' });
        }
    };

    private renderProcessPanel = () => {
        const { t } = this.context;
        const { progressSteps, processExpanded, streamStartTime, isStreaming } = this.state;

        if (!this.props.useStream || progressSteps.length === 0) return null;

        const elapsed = streamStartTime ? Math.round((Date.now() - streamStartTime) / 1000) : 0;

        return (
            <div className={`agent-chat-process-panel${processExpanded ? '' : ' agent-chat-process-panel--collapsed'}`}>
                <button
                    className="agent-chat-process-toggle"
                    onClick={() => this.setState(prev => ({ processExpanded: !prev.processExpanded }))}
                >
                    {processExpanded ? '▼' : '▶'} {t('summary.common.agentChat.viewGenerationProcess')} ({progressSteps.length} {t('summary.common.agentChat.stepsCount')})
                </button>
                
                {processExpanded && (
                    <>
                        <div className="agent-chat-process-timeline" aria-live="polite">
                            {progressSteps.map((step, i) => (
                                <div key={i} className="agent-chat-process-item">
                                    <span className="agent-chat-process-label">
                                        {t(`summary.common.agentChat.progress.${step.phase}`) || step.phase}
                                    </span>
                                    <span className="agent-chat-process-detail">: {step.detail}</span>
                                </div>
                            ))}
                            {isStreaming && (
                                <div className="agent-chat-process-item agent-chat-process-item--loading">
                                    <span className="agent-chat-process-spinner">⏳</span>
                                    <span>{t('summary.common.agentChat.generating')}</span>
                                </div>
                            )}
                        </div>
                        <div className="agent-chat-process-meta">
                            {t('summary.common.agentChat.generationTime')}: {elapsed}s
                        </div>
                    </>
                )}
            </div>
        );
    };

    render() {
        const { messages, sending, welcome, savingSummary, onNewSession } = this.props;
        const { input, showSaveDialog, summaryTitle, isStreaming } = this.state;
        const { t } = this.context;
        const canSave = this.hasAssistantOutput() && this.props.onSaveAsSummary;

        const isBusy = sending || isStreaming;

        return (
            <div className="agent-chat-panel">
                {onNewSession && (
                    <div className="agent-chat-panel-header">
                        <Button
                            theme="borderless"
                            size="small"
                            disabled={isBusy}
                            onClick={onNewSession}
                        >
                            {t('summary.create.newSession')}
                        </Button>
                    </div>
                )}
                <div className="agent-chat-panel-list" ref={this.listRef}>
                    {welcome && (
                        <div className="agent-chat-msg agent-chat-msg--assistant">
                            <div className="agent-chat-bubble">{welcome}</div>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div
                            key={i}
                            className={`agent-chat-msg agent-chat-msg--${m.role}`}
                        >
                            <div className="agent-chat-bubble">
                                {m.content}
                                {m.role === 'assistant' && i === messages.length - 1 && this.props.useStream && (
                                    this.renderProcessPanel()
                                )}
                            </div>
                        </div>
                    ))}
                    {isStreaming && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
                        <div className="agent-chat-msg agent-chat-msg--assistant">
                            <div className="agent-chat-bubble">
                                {this.renderProcessPanel()}
                            </div>
                        </div>
                    )}
                </div>
                <div className="agent-chat-panel-input">
                    <textarea
                        className="agent-chat-textarea"
                        value={input}
                        placeholder={t('summary.create.agentChatPlaceholder')}
                        disabled={isBusy}
                        rows={1}
                        onChange={(e) => this.setState({ input: e.target.value })}
                        onKeyDown={this.handleKeyDown}
                    />
                    <Button
                        theme="solid"
                        size="default"
                        loading={isBusy}
                        disabled={isBusy || !input.trim()}
                        onClick={this.handleSend}
                    >
                        {t('summary.create.send')}
                    </Button>
                    {canSave && (
                        <Button
                            size="default"
                            disabled={!this.hasAssistantOutput() || savingSummary}
                            loading={savingSummary}
                            onClick={this.handleOpenSaveDialog}
                            style={{ marginLeft: 8 }}
                        >
                            {t('summary.create.saveAsSummary')}
                        </Button>
                    )}
                </div>

                <Modal
                    title={t('summary.create.saveDialogTitle')}
                    visible={showSaveDialog}
                    onOk={this.handleSaveConfirm}
                    onCancel={() => this.setState({ showSaveDialog: false })}
                    okText={t('summary.common.confirm')}
                    cancelText={t('summary.common.cancel')}
                    confirmLoading={savingSummary}
                >
                    <Input
                        placeholder={t('summary.create.titlePlaceholder')}
                        value={summaryTitle}
                        onChange={v => this.setState({ summaryTitle: v })}
                        maxLength={100}
                        showClear
                        autoFocus
                    />
                </Modal>
            </div>
        );
    }
}
