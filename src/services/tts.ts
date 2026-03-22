/**
 * Google Cloud Text-to-Speech Service
 */

export async function synthesizeSpeech(text: string, apiKey: string): Promise<string> {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

    const requestBody = {
        input: { text },
        voice: {
            languageCode: 'he-IL',
            name: 'he-IL-Neural2-A',
            ssmlGender: 'FEMALE'
        },
        audioConfig: {
            audioEncoding: 'MP3',
            pitch: -2.0,
            speakingRate: 0.85
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("TTS API Error:", errorData);
        // Include the actual error message from Google Cloud
        const msg = errorData.error?.message || "Failed to synthesize speech";
        const code = errorData.error?.status || "UNKNOWN";
        throw new Error(`${code}: ${msg}`);
    }

    const result = await response.json();
    return `data:audio/mp3;base64,${result.audioContent}`;
}
