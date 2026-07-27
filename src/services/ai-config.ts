import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the SDK with the user-provided API key
export const getGenAI = (apiKey: string) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
        throw new Error("Missing Gemini API Key. Please enter it in the top settings.");
    }
    return new GoogleGenerativeAI(trimmedKey);
};

export const SUPPORTED_MODELS = [
    { name: 'gemini-3.6-flash', version: 'v1beta' },
    { name: 'gemini-3.5-flash', version: 'v1beta' },
    { name: 'gemini-2.5-flash', version: 'v1beta' },
    { name: 'gemini-2.5-pro', version: 'v1beta' },
    { name: 'gemini-2.0-flash-001', version: 'v1beta' }
];

export let activeModelName = 'gemini-3.6-flash';
export let activeApiVersion = 'v1beta';
export let liteModelName = 'gemini-3.6-flash';

export const setActiveModel = (name: string, version: string = 'v1beta') => {
    activeModelName = name;
    activeApiVersion = version;
    liteModelName = name;
};

export async function autoDiscoverModel(apiKey: string): Promise<{name: string, version: string} | null> {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) return null;
        const data = await response.json();
        const models = data.models || [];
        const modelNames = models.map((m: any) => m.name.replace('models/', ''));
        
        const priorityList = [
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.1-flash-lite',
            'gemini-3.0-flash',
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-2.0-flash-001'
        ];

        for (const preferred of priorityList) {
            if (modelNames.includes(preferred)) {
                setActiveModel(preferred, 'v1beta');
                console.log("Auto-discovered optimal model:", preferred);
                return { name: preferred, version: 'v1beta' };
            }
        }
    } catch (e) {
        console.warn("Failed to auto-discover models:", e);
    }
    return null;
}

export async function generateTextEmbedding(text: string, apiKey: string): Promise<number[]> {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    try {
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}
