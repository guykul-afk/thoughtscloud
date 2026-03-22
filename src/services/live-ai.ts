/**
 * Real-time Voice Service for Gemini Multimodal Live API
 * Handles WebSocket connection, PCM audio streaming (mic to AI), 
 * and PCM audio playback (AI to speakers).
 */

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
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private processor: ScriptProcessorNode | null = null;
    private options: LiveChatOptions;
    private nextStreamTime: number = 0;
    private recognition: any = null;

    constructor(options: LiveChatOptions) {
        this.options = {
            model: 'gemini-2.0-flash',
            ...options
        };
    }

    private setStatus(status: LiveChatStatus) {
        this.options.onStatusChange?.(status);
    }

    public async connect() {
        if (this.ws) return;

        this.setStatus('connecting');

        try {
            // Multimodal Live API endpoint
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BiDiGenerateContent?key=${this.options.apiKey}`;

            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.sendSetup();
                this.setStatus('connected');
                this.startMic();
            };

            this.ws.onmessage = async (event) => {
                const response = JSON.parse(new TextDecoder().decode(event.data));
                this.handleResponse(response);
            };

            this.ws.onerror = (e) => {
                console.error("WebSocket Error Detail:", e);
                const errorMsg = `חיבור ה-WebSocket נכשל.
וודא שהגדרת את הדומיין כמורשה ב-Google Cloud Console.
(Authorized JavaScript Origins)`;
                this.options.onError?.(errorMsg);
                this.setStatus('error');
            };

            this.ws.onclose = () => {
                this.stop();
            };

        } catch (error: any) {
            this.options.onError?.(error.message);
            this.setStatus('error');
        }
    }

    private sendSetup() {
        const setupMessage = {
            setup: {
                model: `models/${this.options.model}`,
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: {
                                voice_name: this.options.voice || "Aoede" // Aoede often sounds good for Hebrew
                            }
                        }
                    }
                },
                system_instruction: {
                    parts: [{ text: this.options.systemInstruction || "You are a helpful assistant." }]
                }
            }
        };
        this.ws?.send(JSON.stringify(setupMessage));
    }

    private async startMic() {
        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 16kHz, Mono, 16-bit PCM as required by Gemini Live
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                // Convert Float32 to Int16
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Data[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }

                // Pack into base64 for the API
                if (this.ws?.readyState === WebSocket.OPEN) {
                    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
                    this.ws.send(JSON.stringify({
                        realtime_input: {
                            media_chunks: [{
                                data: base64Audio,
                                mime_type: "audio/pcm;rate=16000"
                            }]
                        }
                    }));
                }
            };

            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            // Setup Web Speech API for Hebrew transcription of the user's side
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
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        try { this.recognition?.start(); } catch (e) {}
                    }
                };

                try { this.recognition.start(); } catch (e) {
                    console.log("Could not start SpeechRecognition", e);
                }
            }

            this.setStatus('listening');

        } catch (error: any) {
            console.error("Mic Access Error:", error);
            if (error.name === 'NotAllowedError') {
                this.options.onError?.("הגישה למיקרופון נחסמה. אנא אפשר גישה בהגדרות הדפדפן שלך.");
            } else if (error.name === 'NotFoundError') {
                this.options.onError?.("לא נמצא מיקרופון מחובר.");
            } else {
                this.options.onError?.(`שגיאת מיקרופון: ${error.message}`);
            }
            this.stop();
        }
    }

    private handleResponse(response: any) {
        if (response.serverContent?.modelTurn?.parts) {
            for (const part of response.serverContent.modelTurn.parts) {
                if (part.inlineData?.mimeType === 'audio/pcm;rate=24000') {
                    this.playAudioChunk(part.inlineData.data);
                }
                if (part.text) {
                    this.options.onTranscriptUpdate?.(part.text, false);
                }
            }
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

        // Schedule playback to avoid gaps
        const startTime = Math.max(this.audioContext.currentTime, this.nextStreamTime);
        source.start(startTime);
        this.nextStreamTime = startTime + audioBuffer.duration;

        source.onended = () => {
            if (this.audioContext && this.audioContext.currentTime >= this.nextStreamTime) {
                this.setStatus('listening');
            }
        };
    }

    public stop() {
        this.ws?.close();
        this.ws = null;
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
        this.setStatus('disconnected');
    }
}
