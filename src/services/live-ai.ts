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

// Fixed prioritized list of models for bidiGenerateContent
const LIVE_MODEL_CANDIDATES = [
    'gemini-3.1-flash-live-preview',     // Current recommended model (2025)
    'gemini-2.5-flash-preview-native-audio-12-2025', // Another recent model
    'gemini-2.5-flash-native-audio-preview-12-2025', // Variant naming
    'gemini-live-2.5-flash-preview',     // Preview name variant
    'gemini-2.0-flash-live-001',        // GA version
    'gemini-2.0-flash-exp',              // Experimental
    'gemini-2.0-flash',                  // Generic
];

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
            model: LIVE_MODEL_CANDIDATES[0],
            ...options
        };
    }

    private setStatus(status: LiveChatStatus) {
        console.log(`TRACE: GeminiLiveService - Status: ${status}`);
        this.options.onStatusChange?.(status);
    }

    public async connect() {
        if (this.session) return;
        this.setStatus('connecting');

        // Build a dynamic list of attempts based on our prioritized candidates
        const versions: (string | undefined)[] = [undefined, 'v1alpha']; // undefined means v1beta default
        const attempts: { apiVersion: string | undefined; model: string }[] = [];
        
        for (const model of LIVE_MODEL_CANDIDATES) {
            for (const apiVersion of versions) {
                attempts.push({ apiVersion, model });
            }
        }

        for (const attempt of attempts) {
            try {
                const label = `${attempt.apiVersion || 'v1beta'}/${attempt.model}`;
                console.log(`TRACE: GeminiLiveService - Trying ${label}`);
                await this.connectWithModel(attempt.model, attempt.apiVersion);
                console.log(`TRACE: GeminiLiveService - SUCCESS: ${label}`);
                return;
            } catch (err: any) {
                console.warn(`TRACE: Failed ${attempt.apiVersion || 'v1beta'}/${attempt.model}: ${err.message?.substring(0, 80)}`);
                // Continue to next attempt
            }
        }

        this.options.onError?.(
            'מפתח ה-API אינו מורשה ל-Live API או שהמודל אינו זמין באזורך. 💡 נסה להחליף מפתח או לבדוק את הגדרות הפרויקט.'
        );
        this.setStatus('error');
    }

    private async connectWithModel(model: string, apiVersion?: string): Promise<void> {
        const ai = new GoogleGenAI({ 
            apiKey: this.options.apiKey,
            ...(apiVersion ? { apiVersion } : {})
        });

        return new Promise((resolve, reject) => {
            let hasOpened = false;
            let setupTimeout = setTimeout(() => {
                if (!hasOpened) reject(new Error('Timeout connecting to server'));
            }, 5000);

            ai.live.connect({
                model,
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: this.options.systemInstruction ? {
                        parts: [{ text: this.options.systemInstruction }]
                    } : undefined,
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: this.options.voice || 'Aoede' } }
                    }
                },
                callbacks: {
                    onopen: () => {
                        console.log(`TRACE: GeminiLiveService - onopen fired for ${model}`);
                        hasOpened = true;
                        clearTimeout(setupTimeout);
                        
                        // We wait 1.5 seconds to see if the server closes it immediately (common for model errors)
                        setTimeout(() => {
                            if (this.session) {
                                resolve();
                                this.setStatus('connected');
                                this.startMic();
                            }
                        }, 1500);
                    },
                    onmessage: (msg: any) => this.handleResponse(msg),
                    onerror: (e: any) => {
                        console.error('TRACE: GeminiLiveService - onerror:', e);
                        if (!hasOpened) reject(new Error(e?.message || 'WebSocket Error'));
                    },
                    onclose: (e: any) => {
                        console.warn(`TRACE: GeminiLiveService - onclose for ${model}. Code: ${e?.code}, Reason: ${e?.reason}`);
                        this.session = null;
                        if (!hasOpened) {
                            reject(new Error(e?.reason || 'Closed before open'));
                        } else {
                            // If it closed within our 1.5s window, reject so we try next model
                            reject(new Error(e?.reason || 'Closed immediately after open'));
                            this.cleanup();
                        }
                    }
                }
            }).then(sess => {
                this.session = sess;
            }).catch(err => {
                if (!hasOpened) reject(err);
            });
        });
    }

    private async startMic() {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!this.audioContext || !this.session) return;

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Data[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }
                if (this.session) {
                    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
                    try {
                        this.session.sendRealtimeInput({ audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' } });
                    } catch (err) {}
                }
            };
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.lang = 'he-IL';
                this.recognition.continuous = true;
                this.recognition.onresult = (event: any) => {
                    let transcript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) transcript += event.results[i][0].transcript + ' ';
                    }
                    if (transcript.trim()) this.options.onTranscriptUpdate?.(transcript.trim(), true);
                };
                this.recognition.onend = () => { if (this.session) try { this.recognition?.start(); } catch (e) {} };
                try { this.recognition.start(); } catch (e) {}
            }
            this.setStatus('listening');
        } catch (error: any) {
            this.options.onError?.(`שגיאת מיקרופון: ${error.message}`);
            this.stop();
        }
    }

    private handleResponse(response: any) {
        const content = response.serverContent;
        if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
                if (part.inlineData) this.playAudioChunk(part.inlineData.data);
                if (part.text) this.options.onTranscriptUpdate?.(part.text, false);
            }
        }
    }

    private playAudioChunk(base64Data: string) {
        if (!this.audioContext) return;
        this.setStatus('speaking');
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Buffer = new Int16Array(bytes.buffer);
        const float32Buffer = new Float32Array(int16Buffer.length);
        for (let i = 0; i < int16Buffer.length; i++) float32Buffer[i] = int16Buffer[i] / 32768.0;
        const audioBuffer = this.audioContext.createBuffer(1, float32Buffer.length, 24000);
        audioBuffer.getChannelData(0).set(float32Buffer);
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        const startTime = Math.max(this.audioContext.currentTime, this.nextStreamTime);
        source.start(startTime);
        this.nextStreamTime = startTime + audioBuffer.duration;
        source.onended = () => {
            if (this.audioContext && this.audioContext.currentTime >= this.nextStreamTime) this.setStatus('listening');
        };
    }

    private cleanup() {
        this.processor?.disconnect();
        this.audioContext?.close();
        this.audioContext = null;
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        if (this.recognition) { this.recognition.onend = null; try { this.recognition.stop(); } catch (e) {} this.recognition = null; }
        this.session = null;
        this.setStatus('disconnected');
    }

    public stop() {
        try { this.session?.close(); } catch (e) {}
        this.cleanup();
    }
}
