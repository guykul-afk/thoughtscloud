import { useAppStore, type StravaActivity } from '../store';

const CLIENT_ID = 'YOUR_STRAVA_CLIENT_ID'; // Replace with your Client ID
const CLIENT_SECRET = 'YOUR_STRAVA_CLIENT_SECRET'; // Replace with your Client Secret
const REDIRECT_URI = window.location.origin + '/strava-callback';

/**
 * Generates the Strava Authorization URL
 */
export function getStravaAuthUrl() {
    return `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=activity:read_all`;
}

/**
 * Exchanges the authorization code for an access token and refresh token
 */
export async function exchangeCodeForToken(code: string) {
    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to exchange code for token');
    }

    const data = await response.json();
    const { setStravaAuth } = useAppStore.getState();

    setStravaAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at * 1000, // Convert to ms
    });

    return data;
}

/**
 * Refreshes the access token using the refresh token
 */
export async function refreshStravaToken() {
    const { stravaAuth, setStravaAuth } = useAppStore.getState();

    if (!stravaAuth?.refreshToken) {
        throw new Error('No refresh token available');
    }

    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: stravaAuth.refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to refresh token');
    }

    const data = await response.json();
    setStravaAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at * 1000,
    });

    return data.access_token;
}

/**
 * Fetches activities after a specific timestamp
 */
export async function fetchStravaActivities(afterTimestamp?: number): Promise<StravaActivity[]> {
    const { stravaAuth, setStravaActivities, setLastStravaSync } = useAppStore.getState();

    if (!stravaAuth?.accessToken) {
        throw new Error('Not authenticated with Strava');
    }

    // Refresh token if expired
    let token = stravaAuth.accessToken;
    if (stravaAuth.expiresAt && Date.now() > stravaAuth.expiresAt - 60000) {
        token = await refreshStravaToken();
    }

    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    if (afterTimestamp) {
        url.searchParams.append('after', Math.floor(afterTimestamp / 1000).toString());
    }

    const response = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch activities');
    }

    const activities: any[] = await response.json();
    
    const processedActivities: StravaActivity[] = activities.map(a => ({
        id: a.id,
        name: a.name,
        sport_type: a.sport_type,
        start_date: a.start_date,
        distance: a.distance,
        moving_time: a.moving_time,
        total_elevation_gain: a.total_elevation_gain,
        average_heartrate: a.average_heartrate,
        suffer_score: a.suffer_score,
    }));

    // Update store with new activities (deduplicated by ID)
    const { stravaActivities } = useAppStore.getState();
    const existingIds = new Set(stravaActivities.map(a => a.id));
    const newActivities = processedActivities.filter(a => !existingIds.has(a.id));
    
    const finalActivities = [...newActivities, ...stravaActivities].slice(0, 100); // Keep last 100
    setStravaActivities(finalActivities);
    setLastStravaSync(new Date().toLocaleDateString('en-CA'));

    return processedActivities;
}
