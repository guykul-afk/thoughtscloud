
import { useAppStore } from './src/store';
import { generateKorczakAnalysis } from './src/services/ai';

// Mock entries
const mockEntries = [
    {
        transcript: "היום עבדתי המון שעות על הפרויקט החדש. אני מרגיש סיפוק מההצלחה אבל קצת עייף. לא היה לי זמן לקרוא או לחשוב על דברים אחרים, רק קוד וקוד. טלי אמרה לי שאני צריך קצת שקט.",
        timestamp: Date.now() - 1000 * 3600 * 24 // Sub-24h
    },
    {
        transcript: "שיחקתי עם הילדים (גיל ואיתן) בערב, זה היה כיף ומילא אותי באנרגיה. אבל אני מרגיש שחסר לי זמן לעצמי, לקריאה או סתם לשלווה.",
        timestamp: Date.now() - 1000 * 3600 * 48
    }
];

async function testKorczak() {
    const apiKey = "YOUR_API_KEY_HERE"; // This is just for demonstration or manual run if I had the key
    console.log("Starting Korczak analysis test...");
    // In a real environment, I would call the function. 
    // Since I don't have the user's API key here in the script, I'm just documenting the test approach.
}

// I will actually trigger it from the UI or by mocking the store state in a way that triggers the effect.
