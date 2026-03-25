/**
 * Real-time Voice Service for Gemini Multimodal Live API
 * Uses the official @google/genai SDK with ai.live.connect()
 */

import { GoogleGenAI, Modality } from '@google/genai';

export type LiveChatStatus = 'disconnected' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'error';

export interface LiveChatOptions {
    apiKey: string;
    model?: string;
    systemInstruction?: string;
    onStatusChange?: (status: LiveChatStatus) => void;
    onTranscriptUpdate?: (text: string, isUser: boolean) => void;
    onError?: (error: string) => void;
    voice?: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';
}

export class GeminiLiveService {
    private session: any = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private processor: ScriptProcessorNode | null = null;
    private options: LiveChatOptions;
    private nextStreamTime: number = 0;
    private recognition: any = null;

    constructor(options: LiveChatOptions) {
        this.options = {
            model: 'gemini-2.0-flash', // General Availability model for Live API
            ...options
        };
    }

    private setStatus(status: LiveChatStatus) {
        console.log(`TRACE: GeminiLiveService - Status Change: ${status}`);
        this.options.onStatusChange?.(status);
    }

    public async connect() {
        if (this.session) {
            console.log('TRACE: GeminiLiveService - Session already exists, skipping connect');
            return;
        }

        this.setStatus('connecting');

        try {
            console.log('TRACE: GeminiLiveService - Initializing GoogleGenAI SDK...');
            const ai = new GoogleGenAI({ 
                apiKey: this.options.apiKey
            });

            const config: any = {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: this.options.voice || 'Aoede'
                        }
                    }
                }
            };

            if (this.options.systemInstruction) {
                config.systemInstruction = {
                    parts: [{ text: this.options.systemInstruction }]
                };
            }

            console.log(`TRACE: GeminiLiveService - Attempting ai.live.connect to model: ${this.options.model}...`);

            this.session = await ai.live.connect({
                model: this.options.model!,
                config,
                callbacks: {
                    onopen: () => {
                        console.log('TRACE: GeminiLiveService - CALLBACK: onopen');
                        this.setStatus('connected');
                        this.startMic();
                    },
                    onmessage: (message: any) => {
                        // Minimal TRACE for message to avoid bloating logs
                        this.handleResponse(message);
                    },
                    onerror: (e: any) => {
                        console.error('TRACE: GeminiLiveService - CALLBACK: onerror', e);
                        const msg = e?.message || 'שגיאת WebSocket/SDK לא ידועה';
                        this.options.onError?.(`שגיאת חיבור ל-AI: ${msg}`);
                        this.setStatus('error');
                    },
                    onclose: (e: any) => {
                        console.log(`TRACE: GeminiLiveService - CALLBACK: onclose. Code: ${e?.code}, Reason: ${e?.reason}`);
                        this.cleanup();
                    }
                }
            });

            console.log('TRACE: GeminiLiveService - ai.live.connect promise resolved');

        } catch (error: any) {
            console.error('TRACE: GeminiLiveService - Connection EXCEPTION:', error);
            this.options.onError?.(error.message || 'חריגה בהתחברות ל-AI');
            this.setStatus('error');
        }
    }

    private async startMic() {
        console.log('TRACE: GeminiLiveService - Starting Microphone sequences...');
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            console.log('TRACE: GeminiLiveService - AudioContext created. Requesting getUserMedia...');
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('TRACE: GeminiLiveService - Mic access GRANTED');

            if (!this.audioContext || !this.session) {
                console.warn('TRACE: GeminiLiveService - AudioContext or Session lost during mic request');
                return;
            }

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Data[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }

                if (this.session && this.session.readyState === 1) { // 1 = OPEN in some SDK versions, or check active
                    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
                    this.session.sendRealtimeInput({
                        audio: {
                            data: base64Audio,
                            mimeType: 'audio/pcm;rate=16000'
                        }
                    });
                }
            };

            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            console.log('TRACE: GeminiLiveService - Audio chain CONNECTED');

            // Web Speech API for Hebrew transcription
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.lang = 'he-IL';
                this.recognition.continuous = true;
                this.recognition.interimResults = false;

                this.recognition.onresult = (event: any) => {
                    let finalTranscript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript + ' ';
                        }
                    }
                    if (finalTranscript.trim()) {
                        this.options.onTranscriptUpdate?.(finalTranscript.trim(), true);
                    }
                };

                this.recognition.onend = () => {
                    if (this.session) {
                        try { this.recognition?.start(); } catch (e) {}
                    }
                };

                try { this.recognition.start(); } catch (e) {
                    console.log('Could not start SpeechRecognition', e);
                }
            }

            this.setStatus('listening');

        } catch (error: any) {
            console.error('TRACE: GeminiLiveService - Mic Access EXCEPTION:', error);
            if (error.name === 'NotAllowedError') {
                this.options.onError?.('הגישה למיקרופון נחסמה. אנא אפשר גישה בהגדרות הדפדפן שלך.');
            } else {
                this.options.onError?.(`שגיאת מיקרופון: ${error.message}`);
            }
            this.stop();
        }
    }

    private handleResponse(response: any) {
        // Detect serverContent structure
        const content = response.serverContent;
        if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
                if (part.inlineData) {
                    console.log('TRACE: GeminiLiveService - Receiving Audio Chunk');
                    this.playAudioChunk(part.inlineData.data);
                }
                if (part.text) {
                    console.log(`TRACE: GeminiLiveService - Receiving Text: ${part.text.substring(0, 20)}...`);
                    this.options.onTranscriptUpdate?.(part.text, false);
                }
            }
        }
        
        // Handle tool calls if any
        if (response.toolCall) {
            console.log('TRACE: GeminiLiveService - Received Tool Call (not implemented)');
        }
    }

    private playAudioChunk(base64Data: string) {
        if (!this.audioContext) return;

        this.setStatus('speaking');

        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Buffer = new Int16Array(bytes.buffer);
        const float32Buffer = new Float32Array(int16Buffer.length);
        for (let i = 0; i < int16Buffer.length; i++) {
            float32Buffer[i] = int16Buffer[i] / 32768.0;
        }

        const audioBuffer = this.audioContext.createBuffer(1, float32Buffer.length, 24000);
        audioBuffer.getChannelData(0).set(float32Buffer);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const startTime = Math.max(this.audioContext.currentTime, this.nextStreamTime);
        source.start(startTime);
        this.nextStreamTime = startTime + audioBuffer.duration;

        source.onended = () => {
            if (this.audioContext && this.audioContext.currentTime >= this.nextStreamTime) {
                this.setStatus('listening');
            }
        };
    }

    private cleanup() {
        this.processor?.disconnect();
        this.audioContext?.close();
        this.audioContext = null;
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        if (this.recognition) {
            this.recognition.onend = null;
            try { this.recognition.stop(); } catch (e) {}
            this.recognition = null;
        }
        this.session = null;
        this.setStatus('disconnected');
    }

    public stop() {
        console.log('TRACE: GeminiLiveService - Manual STOP triggered');
        this.session?.close();
        this.cleanup();
    }
}
